// Stadtplaner Phase 3: Versorgungsgebäude in den fertigen Wohnplan setzen.
//
// Kaufhaus, Einrichtungshaus, Drogerie, Universität und Gaskraftwerk wirken
// über die Straße (Breitensuche, wie in der Analyse). Jedes Gebäude ersetzt
// Häuser; gesucht sind Plätze, die viele noch unversorgte Häuser erreichen und
// wenige verdrängen (Überdeckungsproblem, gewichtet gierig):
//   Gewinn = Σ Wert der neu versorgten Häuser − Wert der verdrängten Häuser.
// Werte je Haus (Ø Ingenieur/Investor, Stufe 3): Kaufhaus 22,5 (+5 Item im
// Rathausradius), Einrichtungshaus 10 (+5), Drogerie 2,5 (+2,5), Universität
// 3 (+1), Strom 5; ein verdrängtes Haus kostet ≈ 225 (+31 im Rathausradius).
// Gebäude dürfen wie Rathäuser auf Querstraßen stehen, wenn das Netz
// zusammenhängt und kein Haus seinen Anschluss verliert.
// Danach Lagerhäuser (5×5), sodass jedes Kaufhaus/Einrichtungshaus/Drogerie/
// Kraftwerk eines in seiner Straßenreichweite hat.

import { footprint, lookup, type BuildingKind } from './catalog';
import { BLOCKED, FREE, HOUSE, ROAD, SERVICE, WATER, touchesRoad, type FillState } from './fill';

export interface PlacedService {
  guid: number;
  kind: BuildingKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  turns: number;
}

export interface ServiceSpec {
  kind: BuildingKind;
  guid: number;
  /** Wert je versorgtem Haus, zusätzlich im Rathausradius (Item-Bonus). */
  value: number;
  itemValue: number;
}

/** Reihenfolge = Priorität (höchster Wert je Haus zuerst). */
export const SERVICE_SPECS: readonly ServiceSpec[] = [
  { kind: 'departmentStore', guid: 135100, value: 22.5, itemValue: 5 },
  { kind: 'furnitureStore', guid: 135099, value: 10, itemValue: 5 },
  { kind: 'powerPlant', guid: 117547, value: 5, itemValue: 0 },
  { kind: 'university', guid: 1010362, value: 3, itemValue: 1 },
  { kind: 'drugStore', guid: 134629, value: 2.5, itemValue: 2.5 },
];

export const WAREHOUSE_GUID = 1010371;

export interface ServiceOptions {
  kinds: ReadonlySet<BuildingKind>;
  /** Wert eines Hauses (Einwohner) und Zuschlag im Rathausradius. */
  houseValue?: number;
  townHallValue?: number;
  /**
   * Vollversorgung: Mindestwert je versorgtem Haus (z. B. 50). Dann wird so
   * lange gebaut, bis ein weiteres Gebäude weniger als etwa
   * (verdrängte Häuser × 225 / 50) Häuser neu erreicht.
   */
  fullCoverageValue?: number;
  /** Reichweiten-Zuschlag je Art (z. B. Wohlfahrt), Standard 0. */
  rangeBonus?: Partial<Record<BuildingKind, number>>;
}

export interface ServiceReport {
  placed: Partial<Record<BuildingKind, number>>;
  warehouses: number;
  removedHouses: number;
  /** Anteil der verbleibenden Häuser, die je Art versorgt sind. */
  coverage: Partial<Record<BuildingKind, number>>;
}

interface Candidate {
  x: number;
  y: number;
  w: number;
  h: number;
  turns: number;
  /** Häuser (Index in s.houses), die weichen müssen. */
  houses: number[];
  /** Straßenkacheln unter der Fläche. */
  roads: number[];
  cost: number;
  /** Straßenkacheln, die das Gebäude seitlich berühren (Start der Suche). */
  starts: number[];
}

/**
 * Setzt Versorgungsgebäude in `s` (Häuser werden entfernt, Flächen als
 * SERVICE markiert). `townHalls` nur für die Abdeckungswerte.
 */
export function placeServices(
  s: FillState,
  townHalls: ReadonlyArray<{ x: number; y: number }>,
  options: ServiceOptions,
): { services: PlacedService[]; report: ServiceReport } {
  const { w, h, cell } = s;
  const HV = options.houseValue ?? 225;
  const RV = options.townHallValue ?? 31;
  const report: ServiceReport = { placed: {}, warehouses: 0, removedHouses: 0, coverage: {} };
  const services: PlacedService[] = [];

  // Hauszuordnung je Kachel, Rathausradius je Haus, Anschluss-Straßen je Haus.
  const houseAt = new Int32Array(w * h).fill(-1);
  s.houses.forEach((hs, k) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) houseAt[(hs.y + dy) * w + hs.x + dx] = k;
  });
  const inTownHall = s.houses.map((hs) =>
    townHalls.some((t) => Math.hypot(hs.x + 1 - (t.x + 1.5), hs.y + 1 - (t.y + 1.5)) <= 20 + 1e-9),
  );
  const ring = (x: number, y: number, bw: number, bh: number): number[] => {
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
  const houseRing = s.houses.map((hs) => ring(hs.x, hs.y, 3, 3));

  // Breitensuche über Straßen (Start: Entfernung 1, weiter solange < Reichweite).
  const dist = new Int32Array(w * h);
  const gen = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let g = 0;
  const bfs = (starts: readonly number[], range: number): void => {
    g++;
    let head = 0;
    let tail = 0;
    for (const i of starts) {
      if (cell[i] !== ROAD || gen[i] === g) continue;
      gen[i] = g;
      dist[i] = 1;
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i];
      if (d >= range) continue;
      const x = i % w;
      const visit = (j: number): void => {
        if (cell[j] !== ROAD || gen[j] === g) return;
        gen[j] = g;
        dist[j] = d + 1;
        queue[tail++] = j;
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i + w < w * h) visit(i + w);
    }
  };
  const reached = (tiles: readonly number[]): boolean => tiles.some((i) => gen[i] === g);

  /** Trennt das Wegnehmen der Straßenkacheln das Netz? (wie compact.ts) */
  const separates = (tiles: readonly number[]): boolean => {
    if (!tiles.length) return false;
    const removed = new Set(tiles);
    const nb = (i: number): number[] => {
      const x = i % w;
      const out: number[] = [];
      if (x > 0) out.push(i - 1);
      if (x < w - 1) out.push(i + 1);
      if (i >= w) out.push(i - w);
      if (i + w < w * h) out.push(i + w);
      return out;
    };
    const ends = new Set<number>();
    for (const t of tiles) for (const n of nb(t)) if (cell[n] === ROAD && !removed.has(n)) ends.add(n);
    if (ends.size <= 1) return false;
    const list = [...ends];
    const seen = new Set<number>([list[0]]);
    const q = [list[0]];
    let found = 1;
    for (let k = 0; k < q.length; k++) {
      for (const n of nb(q[k])) {
        if (cell[n] !== ROAD || removed.has(n) || seen.has(n)) continue;
        seen.add(n);
        if (ends.has(n) && ++found === ends.size) return false;
        q.push(n);
      }
    }
    return true;
  };

  /** Alle zulässigen Plätze für eine Fläche bw×bh (Häuser/Straßen dürfen weichen). */
  const candidatesFor = (guid: number): Candidate[] => {
    const entry = lookup(guid);
    const out: Candidate[] = [];
    const seenShape = new Set<string>();
    for (const turns of [0, 1]) {
      const { w: bw, h: bh } = footprint(entry, turns);
      const shape = `${bw}x${bh}`;
      if (seenShape.has(shape)) continue;
      seenShape.add(shape);
      for (let y = 0; y + bh <= h; y++) {
        for (let x = 0; x + bw <= w; x++) {
          let ok = true;
          const hs = new Set<number>();
          const roads: number[] = [];
          for (let dy = 0; dy < bh && ok; dy++) {
            for (let dx = 0; dx < bw; dx++) {
              const i = (y + dy) * w + x + dx;
              const c = cell[i];
              if (c === WATER || c === BLOCKED || c === SERVICE) {
                ok = false;
                break;
              }
              if (c === HOUSE) hs.add(houseAt[i]);
              else if (c === ROAD) roads.push(i);
            }
          }
          if (!ok) continue;
          // Straßen unter der Fläche nur als Querstraßen-Stück (höchstens eine Zeile/Spalte).
          if (roads.length > Math.max(bw, bh)) continue;
          const starts = ring(x, y, bw, bh).filter((i) => cell[i] === ROAD);
          if (!starts.length) continue;
          let cost = 0;
          for (const k of hs) cost += HV + (inTownHall[k] ? RV : 0);
          out.push({ x, y, w: bw, h: bh, turns, houses: [...hs], roads, cost, starts });
        }
      }
    }
    // Ausdünnen: je 4×4-Feld nur die günstigsten Plätze (Suche bleibt schnell).
    out.sort((a, b) => a.cost - b.cost || a.roads.length - b.roads.length);
    const bucket = new Map<string, number>();
    const thin: Candidate[] = [];
    for (const c of out) {
      const key = `${Math.floor(c.x / 4)},${Math.floor(c.y / 4)},${c.w}`;
      const n = bucket.get(key) ?? 0;
      if (n >= 2) continue;
      bucket.set(key, n + 1);
      thin.push(c);
    }
    return thin;
  };

  /** Prüft, ob ein Platz im aktuellen Zustand noch frei ist und das Netz hält. */
  const stillValid = (c: Candidate): boolean => {
    for (let dy = 0; dy < c.h; dy++) {
      for (let dx = 0; dx < c.w; dx++) {
        const v = cell[(c.y + dy) * w + c.x + dx];
        if (v === WATER || v === BLOCKED || v === SERVICE) return false;
      }
    }
    if (!c.starts.some((i) => cell[i] === ROAD)) return false;
    if (!c.roads.length) return true;
    if (c.roads.some((i) => cell[i] !== ROAD)) return false;
    // Straßen probeweise wegnehmen: Netz zusammenhängend, alle Häuser/Gebäude angeschlossen?
    for (const i of c.roads) cell[i] = SERVICE;
    let ok = !separates(c.roads);
    if (ok) {
      const touched = new Set<number>();
      for (const i of c.roads) {
        for (const n of [i - 1, i + 1, i - w, i + w]) {
          if (n >= 0 && n < cell.length && cell[n] === HOUSE && !c.houses.includes(houseAt[n])) touched.add(houseAt[n]);
        }
      }
      for (const k of touched) if (!touchesRoad(s, s.houses[k].x, s.houses[k].y)) ok = false;
      for (const sv of services) {
        if (ring(sv.x, sv.y, sv.w, sv.h).every((i) => cell[i] !== ROAD)) ok = false;
      }
    }
    for (const i of c.roads) cell[i] = ROAD;
    return ok;
  };

  // Belegung: Wie viele Gebäude verdrängen ein Haus? (0 = Haus steht noch)
  const removedBy = new Int32Array(s.houses.length);
  const isAlive = (k: number): boolean => removedBy[k] === 0;
  const origRoad = new Uint8Array(w * h);
  for (let i = 0; i < cell.length; i++) if (cell[i] === ROAD) origRoad[i] = 1;
  const placedOf = new Map<Candidate, PlacedService>();

  const place = (c: Candidate, guid: number): void => {
    const entry = lookup(guid);
    for (const k of c.houses) removedBy[k]++;
    for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) cell[(c.y + dy) * w + c.x + dx] = SERVICE;
    const sv: PlacedService = { guid, kind: entry.kind, name: entry.name, x: c.x, y: c.y, w: c.w, h: c.h, turns: c.turns };
    services.push(sv);
    placedOf.set(c, sv);
  };

  const unplace = (c: Candidate): void => {
    for (const k of c.houses) removedBy[k]--;
    for (let dy = 0; dy < c.h; dy++) {
      for (let dx = 0; dx < c.w; dx++) {
        const i = (c.y + dy) * w + c.x + dx;
        cell[i] = houseAt[i] >= 0 ? HOUSE : origRoad[i] ? ROAD : FREE;
      }
    }
    const sv = placedOf.get(c);
    if (sv) services.splice(services.indexOf(sv), 1);
    placedOf.delete(c);
  };

  const houseCost = (k: number): number => HV + (inTownHall[k] ? RV : 0);

  // --- Versorgungsgebäude je Art: gierig, dann lokale Suche (entfernen, verlegen)
  const specs = SERVICE_SPECS.filter((sp) => options.kinds.has(sp.kind));
  for (const spec of specs) {
    const entry = lookup(spec.guid);
    const range = (entry.roadRange ?? 0) + (options.rangeBonus?.[spec.kind] ?? 0);
    const cands = candidatesFor(spec.guid);
    // Abdeckung je Kandidat (Hausindizes)
    const cover: Int32Array[] = cands.map((c) => {
      bfs(c.starts, range);
      const list: number[] = [];
      s.houses.forEach((_, k) => {
        if (isAlive(k) && reached(houseRing[k])) list.push(k);
      });
      return Int32Array.from(list);
    });
    const valueOf = (k: number): number =>
      Math.max(spec.value + (inTownHall[k] ? spec.itemValue : 0), options.fullCoverageValue ?? 0);
    /** Wie viele gewählte Gebäude dieser Art erreichen ein Haus? */
    const coverCount = new Int32Array(s.houses.length);
    const chosen: number[] = [];
    const ownHouse = (ci: number, k: number): boolean => cands[ci].houses.includes(k);

    /** Gewinn, wenn Kandidat ci dazukommt (im aktuellen Zustand). */
    const addGain = (ci: number): number => {
      const c = cands[ci];
      let gain = 0;
      for (const k of c.houses) {
        if (!isAlive(k)) continue;
        gain -= houseCost(k);
        if (coverCount[k] > 0) gain -= valueOf(k);
      }
      for (const k of cover[ci]) {
        if (isAlive(k) && coverCount[k] === 0 && !ownHouse(ci, k)) gain += valueOf(k);
      }
      return gain;
    };
    /** Gewinn, wenn das gewählte Gebäude ci wegfällt. */
    const removeGain = (ci: number): number => {
      const c = cands[ci];
      let gain = 0;
      for (const k of cover[ci]) {
        if (isAlive(k) && coverCount[k] === 1) gain -= valueOf(k);
      }
      for (const k of c.houses) {
        if (removedBy[k] !== 1) continue;
        gain += houseCost(k);
        // Das zurückkehrende Haus ist versorgt, wenn ein anderes Gebäude es erreicht.
        let others = 0;
        for (const cj of chosen) if (cj !== ci && cover[cj].includes(k)) others++;
        if (others) gain += valueOf(k);
      }
      return gain;
    };
    const take = (ci: number): void => {
      place(cands[ci], spec.guid);
      chosen.push(ci);
      for (const k of cover[ci]) coverCount[k]++;
    };
    const drop = (ci: number): void => {
      unplace(cands[ci]);
      chosen.splice(chosen.indexOf(ci), 1);
      for (const k of cover[ci]) coverCount[k]--;
    };
    const isChosen = new Uint8Array(cands.length);
    const bestAddition = (): { ci: number; gain: number } => {
      let best = -1;
      let bestGain = 0;
      const order = cands.map((_, ci) => ci).filter((ci) => !isChosen[ci]);
      const gains = order.map((ci) => addGain(ci));
      const idx = order.map((_, k) => k).sort((p, q) => gains[q] - gains[p]);
      for (const k of idx) {
        if (gains[k] <= bestGain) break;
        if (stillValid(cands[order[k]])) {
          best = order[k];
          bestGain = gains[k];
          break;
        }
      }
      return { ci: best, gain: bestGain };
    };

    // 1. Gierig
    for (;;) {
      const { ci } = bestAddition();
      if (ci < 0) break;
      take(ci);
      isChosen[ci] = 1;
    }
    // 2. Lokale Suche: überflüssige entfernen, Gebäude verlegen, wieder ergänzen.
    for (let round = 0; round < 6; round++) {
      let improved = false;
      for (const ci of [...chosen]) {
        if (removeGain(ci) > 1e-9) {
          drop(ci);
          isChosen[ci] = 0;
          improved = true;
        }
      }
      for (const ci of [...chosen]) {
        const lose = removeGain(ci);
        drop(ci);
        isChosen[ci] = 0;
        const { ci: cj, gain } = bestAddition();
        if (cj >= 0 && cj !== ci && lose + gain > 1e-9) {
          take(cj);
          isChosen[cj] = 1;
          improved = true;
        } else {
          take(ci);
          isChosen[ci] = 1;
        }
      }
      for (;;) {
        const { ci } = bestAddition();
        if (ci < 0) break;
        take(ci);
        isChosen[ci] = 1;
        improved = true;
      }
      if (!improved) break;
    }
    report.placed[spec.kind] = chosen.length;
  }

  // --- Lagerhäuser: jedes Gebäude mit Lagerbedarf braucht eines in Reichweite.
  const needy = services.filter((sv) => lookup(sv.guid).needsWarehouse);
  if (needy.length) {
    const reachMaps = needy.map((sv) => {
      bfs(ring(sv.x, sv.y, sv.w, sv.h), lookup(sv.guid).roadRange ?? 0);
      const m = new Uint8Array(w * h);
      for (let i = 0; i < m.length; i++) if (gen[i] === g) m[i] = 1;
      return m;
    });
    const served = new Uint8Array(needy.length);
    const whCands = candidatesFor(WAREHOUSE_GUID);
    for (;;) {
      if (served.every(Boolean)) break;
      let best = -1;
      let bestScore = -Infinity;
      let bestServes: number[] = [];
      for (let ci = 0; ci < whCands.length; ci++) {
        const c = whCands[ci];
        const serves: number[] = [];
        needy.forEach((_, k) => {
          if (!served[k] && c.starts.some((i) => reachMaps[k][i])) serves.push(k);
        });
        if (!serves.length) continue;
        let cost = 0;
        for (const k of c.houses) if (isAlive(k)) cost += houseCost(k);
        const score = serves.length * 10_000 - cost;
        if (score > bestScore && stillValid(c)) {
          bestScore = score;
          best = ci;
          bestServes = serves;
        }
      }
      if (best < 0) break;
      place(whCands[best], WAREHOUSE_GUID);
      for (const k of bestServes) served[k] = 1;
      report.warehouses++;
    }
  }

  // Häuser entfernen und Zellen der weggefallenen Häuser freigeben (außer unter Gebäuden).
  report.removedHouses = s.houses.filter((_, k) => !isAlive(k)).length;
  const keep = s.houses.filter((_, k) => isAlive(k));
  s.houses.forEach((hs, k) => {
    if (isAlive(k)) return;
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const i = (hs.y + dy) * w + hs.x + dx;
        if (cell[i] === HOUSE) cell[i] = FREE;
      }
    }
  });
  s.houses = keep;

  // Abdeckung je Art auf den verbleibenden Häusern (Endzustand der Straßen).
  for (const spec of specs) {
    const range = (lookup(spec.guid).roadRange ?? 0) + (options.rangeBonus?.[spec.kind] ?? 0);
    const reachedHouse = new Uint8Array(s.houses.length);
    for (const sv of services) {
      if (sv.kind !== spec.kind) continue;
      bfs(ring(sv.x, sv.y, sv.w, sv.h), range);
      s.houses.forEach((hs, k) => {
        if (!reachedHouse[k] && reached(ring(hs.x, hs.y, 3, 3))) reachedHouse[k] = 1;
      });
    }
    report.coverage[spec.kind] = s.houses.length ? reachedHouse.reduce((a, b) => a + b, 0) / s.houses.length : 0;
  }
  return { services, report };
}
