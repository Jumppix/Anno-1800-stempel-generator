// „Läden von Anfang an“: Querstraßen nach Bedarf einfügen.
//
// Ausgangslage: lange Häuserreihen (wenige Querstraßen, meiste Häuser) und
// bereits gesetzte Versorgung. Querstraßen verkürzen die Wege von Läden und
// Kraftwerken zu den Häusern; jede kostet aber Platz. Hier wird für jede
// mögliche Stelle (ein 6 Kacheln langes Stück zwischen zwei parallelen
// Längsstraßen) berechnet:
//   + Wert der Häuser, die dadurch neu in Reichweite eines Ladens/Kraftwerks
//     kommen (Wert je Art aus SERVICE_SPECS, Rathaus-Item-Zuschlag)
//   − verlorene Häuser × Hauswert. Die beiden Häuserspalten werden dabei
//     exakt neu belegt (`realignLanes`): Hat eine Spalte 1–2 Kacheln Rest,
//     kostet die Straße dort oft gar kein Haus.
// Gierig mit verzögerter Neubewertung (lazy greedy): nur die jeweils beste
// Stelle wird neu gerechnet, bevor sie übernommen wird.

import { lookup, type BuildingKind } from './catalog';
import { FREE, HOUSE, isWay, realignLanes, ROAD, type FillState } from './fill';
import { SERVICE_SPECS, type PlacedService } from './services';

export interface InsertOptions {
  deadline: number;
  houseValue?: number;
  townHalls: ReadonlyArray<{ x: number; y: number }>;
  ministry?: { range: number; welfare: number; web: number };
  /** Mindestgewinn je Straße (Einwohner-Gegenwert). */
  minGain?: number;
  onProgress?: (inserted: number, lost: number) => void;
}

export interface InsertReport {
  candidates: number;
  inserted: number;
  tiles: number;
  /** Häuser weniger durch die neuen Straßen (netto). */
  housesLost: number;
  /** Geschätzter Wert der neu erreichten Versorgung. */
  coverageGain: number;
}

interface Candidate {
  tiles: number[];
  /** Kreuzungen mit Längsstraßen entlang der Kette (Abstand je 7). */
  junctions: number[];
}

export function insertCrossRoads(s: FillState, services: readonly PlacedService[], options: InsertOptions): InsertReport {
  const { w, h } = s;
  const N = w * h;
  const HV = options.houseValue ?? 300;
  const minGain = options.minGain ?? 60;
  const report: InsertReport = { candidates: 0, inserted: 0, tiles: 0, housesLost: 0, coverageGain: 0 };

  const ringOf = (x: number, y: number, bw: number, bh: number): number[] => {
    const out: number[] = [];
    const add = (xx: number, yy: number): void => {
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) out.push(yy * w + xx);
    };
    for (let d = 0; d < bw; d++) {
      add(x + d, y - 1);
      add(x + d, y + bh);
    }
    for (let d = 0; d < bh; d++) {
      add(x - 1, y + d);
      add(x + bw, y + d);
    }
    return out;
  };

  // --- Breitensuche (Wege), Ergebnis in einem Abstandsfeld
  const queue = new Int32Array(N);
  const bfsInto = (cell: Uint8Array, starts: readonly number[], startDist: number, range: number, dist: Int16Array, list?: number[]): void => {
    let head = 0;
    let tail = 0;
    for (const i of starts) {
      if (!isWay(cell[i]) || dist[i]) continue;
      dist[i] = startDist;
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++];
      list?.push(i);
      const d = dist[i];
      if (d >= range) continue;
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of nb) {
        if (j < 0 || j >= N || dist[j] || !isWay(cell[j])) continue;
        dist[j] = d + 1;
        queue[tail++] = j;
      }
    }
  };

  // --- Ministerium (Reichweiten-Zuschlag) und Versorger
  const ministrySv = options.ministry ? services.find((sv) => sv.kind === 'localDepartment') : undefined;
  const inMinistry = new Uint8Array(services.length);
  if (ministrySv && options.ministry) {
    const d = new Int16Array(N);
    bfsInto(s.cell, ringOf(ministrySv.x, ministrySv.y, ministrySv.w, ministrySv.h), 1, options.ministry.range, d);
    services.forEach((sv, k) => {
      if (ringOf(sv.x, sv.y, sv.w, sv.h).some((i) => d[i] > 0)) inMinistry[k] = 1;
    });
  }
  const specOf = new Map(SERVICE_SPECS.map((sp) => [sp.kind, sp]));
  interface Provider {
    kind: BuildingKind;
    ring: number[];
    range: number;
    dist: Int16Array;
  }
  const providers: Provider[] = [];
  services.forEach((sv, k) => {
    // Universität (abgestufte Wirkung, kleiner Wert) bleibt hier außen vor.
    if (!specOf.has(sv.kind) || sv.kind === 'university') return;
    const entry = lookup(sv.guid);
    let bonus = 0;
    if (options.ministry && inMinistry[k]) {
      if (entry.welfare) bonus += options.ministry.welfare;
      if (sv.kind === 'powerPlant') bonus += options.ministry.web;
    }
    providers.push({ kind: sv.kind, ring: ringOf(sv.x, sv.y, sv.w, sv.h), range: (entry.roadRange ?? 0) + bonus, dist: new Int16Array(N) });
  });
  const kinds = [...new Set(providers.map((p) => p.kind))];
  const kindIndex = new Map(kinds.map((k, i) => [k, i]));
  const refreshProvider = (p: Provider): void => {
    p.dist.fill(0);
    bfsInto(s.cell, p.ring.filter((i) => s.cell[i] === ROAD), 1, p.range, p.dist);
  };
  for (const p of providers) refreshProvider(p);

  // --- Häuser: angrenzende Wegkacheln, Wert je Art, Abdeckung je Art
  let houseAt = new Int32Array(N);
  let covered: Uint8Array[] = [];
  let inTownHall: boolean[] = [];
  const refreshHouses = (): void => {
    houseAt = new Int32Array(N).fill(-1);
    s.houses.forEach((hs, k) => {
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) houseAt[(hs.y + dy) * w + hs.x + dx] = k;
    });
    inTownHall = s.houses.map((hs) =>
      options.townHalls.some((t) => Math.hypot(hs.x + 1 - (t.x + 1.5), hs.y + 1 - (t.y + 1.5)) <= 20 + 1e-9),
    );
    covered = kinds.map(() => new Uint8Array(s.houses.length));
    for (const p of providers) {
      const ki = kindIndex.get(p.kind) as number;
      s.houses.forEach((hs, k) => {
        if (covered[ki][k]) return;
        if (ringOf(hs.x, hs.y, 3, 3).some((i) => p.dist[i] > 0)) covered[ki][k] = 1;
      });
    }
  };
  refreshHouses();
  const valueOf = (kind: BuildingKind, k: number): number => {
    const sp = specOf.get(kind);
    return sp ? sp.value + (inTownHall[k] ? sp.itemValue : 0) : 0;
  };

  // --- Kandidaten: 6 Kacheln (Haus/frei) zwischen zwei parallelen Längsstraßen
  const along = (i: number, horizontalRoad: boolean): boolean => {
    const x = i % w;
    return horizontalRoad
      ? (x > 0 && s.cell[i - 1] === ROAD) || (x < w - 1 && s.cell[i + 1] === ROAD)
      : (i >= w && s.cell[i - w] === ROAD) || (i + w < N && s.cell[i + w] === ROAD);
  };
  const candidates: Candidate[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = y * w + x;
      if (s.cell[a] !== ROAD) continue;
      // senkrechtes Stück zwischen zwei waagerechten Straßen
      if (y + 7 < h) {
        const b = (y + 7) * w + x;
        const tiles = [1, 2, 3, 4, 5, 6].map((d) => (y + d) * w + x);
        if (s.cell[b] === ROAD && along(a, true) && along(b, true) && tiles.every((i) => s.cell[i] === HOUSE || s.cell[i] === FREE)) {
          candidates.push({ tiles, junctions: [a, b] });
        }
      }
      // waagerechtes Stück zwischen zwei senkrechten Straßen
      if (x + 7 < w) {
        const b = y * w + x + 7;
        const tiles = [1, 2, 3, 4, 5, 6].map((d) => y * w + x + d);
        if (s.cell[b] === ROAD && along(a, false) && along(b, false) && tiles.every((i) => s.cell[i] === HOUSE || s.cell[i] === FREE)) {
          candidates.push({ tiles, junctions: [a, b] });
        }
      }
    }
  }
  // Ketten: Stücke, die geradlinig aneinander anschließen (Ende = nächster Anfang),
  // bilden eine durchgehende Querstraße über mehrere Reihen.
  const byStart = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const list = byStart.get(c.junctions[0]);
    if (list) list.push(c);
    else byStart.set(c.junctions[0], [c]);
  }
  const singles = [...candidates];
  for (const c of singles) {
    const dir = c.junctions[1] - c.junctions[0];
    let chain: Candidate = c;
    for (let len = 2; len <= 12; len++) {
      const last = chain.junctions[chain.junctions.length - 1];
      const nextSeg = (byStart.get(last) ?? []).find((n) => n.junctions[1] - n.junctions[0] === dir);
      if (!nextSeg) break;
      chain = { tiles: [...chain.tiles, ...nextSeg.tiles], junctions: [...chain.junctions, nextSeg.junctions[1]] };
      if ([2, 3, 4, 6, 8, 12].includes(len)) candidates.push(chain);
    }
  }
  report.candidates = candidates.length;

  // --- Bewertung
  const local = new Int16Array(N);
  const reachFrom = (start: number): { tiles: number[]; dist: Int16Array } => {
    const list: number[] = [];
    bfsInto(s.cell, [start], 1, 62 + 22 + 15, local, list);
    const dist = new Int16Array(list.length);
    list.forEach((i, k) => (dist[k] = local[i]));
    for (const i of list) local[i] = 0;
    return { tiles: list, dist };
  };
  type Eval = { score: number; gain: number; lost: number; state: FillState };
  const evaluate = (c: Candidate): Eval | null => {
    if (c.tiles.some((i) => s.cell[i] !== HOUSE && s.cell[i] !== FREE)) return null;
    if (c.junctions.some((j) => s.cell[j] !== ROAD)) return null;
    // 1. Versorgungsgewinn: entlang der Kette sind die Kreuzungen je 7 Kacheln
    //    voneinander entfernt; neue Abstände je Kreuzung, dann Breitensuche von
    //    jeder verbesserten Kreuzung.
    const J = c.junctions;
    const gained = kinds.map(() => new Set<number>());
    const reachCache = new Map<number, { tiles: number[]; dist: Int16Array }>();
    for (const p of providers) {
      const ki = kindIndex.get(p.kind) as number;
      const known = J.map((j) => p.dist[j]);
      if (known.every((d) => !d)) continue;
      for (let i = 0; i < J.length; i++) {
        let best = 0;
        for (let j = 0; j < J.length; j++) {
          if (!known[j] || j === i) continue;
          const v = known[j] + 7 * Math.abs(i - j);
          if (!best || v < best) best = v;
        }
        if (!best || best > p.range || (known[i] && known[i] <= best)) continue;
        let r = reachCache.get(J[i]);
        if (!r) {
          r = reachFrom(J[i]);
          reachCache.set(J[i], r);
        }
        for (let k = 0; k < r.tiles.length; k++) {
          const v = r.tiles[k];
          const nd = best + r.dist[k] - 1;
          if (nd > p.range || (p.dist[v] && p.dist[v] <= nd)) continue;
          const x = v % w;
          for (const q of [x > 0 ? v - 1 : -1, x < w - 1 ? v + 1 : -1, v - w, v + w]) {
            if (q < 0 || q >= N) continue;
            const hk = houseAt[q];
            if (hk >= 0 && !covered[ki][hk]) gained[ki].add(hk);
          }
        }
      }
    }
    let gain = 0;
    gained.forEach((set, ki) => {
      for (const hk of set) gain += valueOf(kinds[ki], hk);
    });
    if (gain < minGain) return null;
    // 2. Kosten: Straße setzen, Häuser darunter weg, Spalten neu belegen
    const cell = s.cell.slice();
    const st: FillState = { w, h, cell, houses: s.houses.map((hs) => ({ ...hs })) };
    const hit = new Set<number>();
    for (const i of c.tiles) if (houseAt[i] >= 0) hit.add(houseAt[i]);
    for (const k of hit) {
      const hs = s.houses[k];
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) cell[(hs.y + dy) * w + hs.x + dx] = FREE;
    }
    st.houses = st.houses.filter((_, k) => !hit.has(k));
    for (const i of c.tiles) cell[i] = ROAD;
    const xs = c.tiles.map((i) => i % w);
    const ys = c.tiles.map((i) => Math.floor(i / w));
    realignLanes(st, { x0: Math.min(...xs) - 3, y0: Math.min(...ys) - 3, x1: Math.max(...xs) + 3, y1: Math.max(...ys) + 3 });
    const lost = s.houses.length - st.houses.length;
    const score = gain - lost * HV;
    return { score, gain, lost, state: st };
  };

  // --- Faule Gier: Startwerte, dann jeweils die beste neu rechnen.
  const scores: Array<{ c: Candidate; score: number }> = [];
  for (const c of candidates) {
    if (performance.now() > options.deadline) break;
    const e = evaluate(c);
    if (e && e.score > minGain) scores.push({ c, score: e.score });
  }
  scores.sort((p, q) => q.score - p.score);
  while (scores.length && performance.now() < options.deadline) {
    const top = scores.shift() as { c: Candidate; score: number };
    const e = evaluate(top.c);
    if (!e || e.score <= minGain) continue;
    if (scores.length && e.score < scores[0].score) {
      // Wert gesunken: wieder einsortieren
      top.score = e.score;
      let lo = 0;
      let hi = scores.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (scores[mid].score > e.score) lo = mid + 1;
        else hi = mid;
      }
      scores.splice(lo, 0, top);
      continue;
    }
    // Übernehmen
    s.cell.set(e.state.cell);
    s.houses = e.state.houses;
    report.inserted++;
    report.tiles += top.c.tiles.length;
    report.housesLost += e.lost;
    report.coverageGain += e.gain;
    for (const p of providers) if (top.c.junctions.some((j) => p.dist[j])) refreshProvider(p);
    refreshHouses();
    options.onProgress?.(report.inserted, report.housesLost);
  }
  return report;
}
