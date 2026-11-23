// Querstraßen ausdünnen und Reihen zusammenschieben.
//
// Nach Versorgung und Lagerhäusern: Querstraßen-Stücke (kurze, gerade
// Straßenläufe zwischen zwei Längsstraßen) probeweise entfernen. Die beiden
// Häuserspalten daneben werden dabei länger und exakt neu belegt
// (`realignLanes`); drei entfernte Stücke in derselben Spalte ergeben ein Haus
// mehr je Spalte. Bewertet wird:
//   + gewonnene Häuser × Hauswert
//   − verlorene Versorgung (Kaufhaus, Einrichtungshaus, Drogerie, Strom,
//     Universität, optionale Gebäude) je Haus mit dem Wert aus SERVICE_SPECS
//   − Häuser, die ihren Straßenanschluss verlieren.
// Unverletzlich: Straßennetz bleibt zusammenhängend, jedes Gebäude behält
// einen Straßenanschluss, Läden/Kraftwerke/Produktion erreichen weiter ein
// Lagerhaus, Gebäude im Ministeriumsbereich bleiben darin.

import { lookup, type BuildingKind } from './catalog';
import { FREE, isWay, realignLanes, ROAD, type FillState } from './fill';
import { PRODUCTION_WAREHOUSE_RANGE } from './production';
import { UNIVERSITY_MAX_RANGE, universityFactor } from './rules';
import { ministryRect, SERVICE_SPECS, type PlacedService } from './services';

export interface ThinOptions {
  deadline: number;
  houseValue?: number;
  /** Rathaus-Mittelpunkte (Häuser im Radius 20 bekommen den Item-Zuschlag). */
  townHalls: ReadonlyArray<{ x: number; y: number }>;
  ministry?: { range: number; welfare: number; web: number };
  onProgress?: (removed: number, gained: number) => void;
}

export interface ThinReport {
  /** Entfernte Querstraßen-Stücke und Kacheln. */
  segments: number;
  tiles: number;
  /** Häuser mehr (netto). */
  gained: number;
  /** Geschätzter Wert (Einwohner) der verlorenen Versorgung. */
  coverageLoss: number;
  candidates?: number;
  rejected?: Record<string, number>;
}

interface Segment {
  tiles: number[];
  /** Straßenkacheln an beiden Enden (Längsstraßen) je Teilstück. */
  ends: Array<[number, number]>;
}

const WAREHOUSE_KINDS: ReadonlySet<BuildingKind> = new Set(['warehouse', 'airport']);

export function thinCrossRoads(s: FillState, services: readonly PlacedService[], options: ThinOptions): ThinReport {
  const { w, h } = s;
  const N = w * h;
  const HV = options.houseValue ?? 300;
  const report: ThinReport = { segments: 0, tiles: 0, gained: 0, coverageLoss: 0 };

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

  // --- Breitensuche über Wege (Straße + Brücke) auf einem Zellenfeld.
  const dist = new Int32Array(N);
  const gen = new Int32Array(N);
  const queue = new Int32Array(N);
  let g = 0;
  const bfs = (cell: Uint8Array, starts: readonly number[], range: number): void => {
    g++;
    let head = 0;
    let tail = 0;
    for (const i of starts) {
      if (!isWay(cell[i]) || gen[i] === g) continue;
      gen[i] = g;
      dist[i] = 1;
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i];
      if (d >= range) continue;
      const x = i % w;
      if (x > 0 && gen[i - 1] !== g && isWay(cell[i - 1])) { gen[i - 1] = g; dist[i - 1] = d + 1; queue[tail++] = i - 1; }
      if (x < w - 1 && gen[i + 1] !== g && isWay(cell[i + 1])) { gen[i + 1] = g; dist[i + 1] = d + 1; queue[tail++] = i + 1; }
      if (i >= w && gen[i - w] !== g && isWay(cell[i - w])) { gen[i - w] = g; dist[i - w] = d + 1; queue[tail++] = i - w; }
      if (i + w < N && gen[i + w] !== g && isWay(cell[i + w])) { gen[i + w] = g; dist[i + w] = d + 1; queue[tail++] = i + w; }
    }
  };
  /** Kleinste Entfernung zu einer der Kacheln (0 = nicht erreicht). */
  const nearest = (tiles: readonly number[]): number => {
    let d = 0;
    for (const i of tiles) if (gen[i] === g && (!d || dist[i] < d)) d = dist[i];
    return d;
  };

  // --- Ministerium: Bereich und betroffene Gebäude
  const ministrySv = options.ministry ? ministryRect(services) : undefined;
  const ministryRange = options.ministry?.range ?? 0;
  const inMinistryOf = (cell: Uint8Array): Uint8Array => {
    const m = new Uint8Array(services.length);
    if (!ministrySv) return m;
    bfs(cell, ringOf(ministrySv.x, ministrySv.y, ministrySv.w, ministrySv.h), ministryRange);
    services.forEach((sv, k) => {
      if (nearest(ringOf(sv.x, sv.y, sv.w, sv.h))) m[k] = 1;
    });
    return m;
  };
  const inMinistry = inMinistryOf(s.cell);

  // --- Versorger mit Reichweite und Wert je Haus
  const specOf = new Map(SERVICE_SPECS.map((sp) => [sp.kind, sp]));
  interface Provider {
    k: number;
    kind: BuildingKind;
    ring: number[];
    range: number;
    bonus: number;
    isUni: boolean;
  }
  const providers: Provider[] = [];
  services.forEach((sv, k) => {
    const spec = specOf.get(sv.kind);
    if (!spec) return;
    const entry = lookup(sv.guid);
    let bonus = 0;
    if (options.ministry && inMinistry[k]) {
      if (entry.welfare) bonus += options.ministry.welfare;
      if (sv.kind === 'powerPlant') bonus += options.ministry.web;
    }
    const isUni = sv.kind === 'university';
    providers.push({ k, kind: sv.kind, ring: ringOf(sv.x, sv.y, sv.w, sv.h), range: (entry.roadRange ?? 0) + bonus, bonus, isUni });
  });
  const inTownHall = s.houses.map((hs) =>
    options.townHalls.some((t) => Math.hypot(hs.x + 1 - (t.x + 1.5), hs.y + 1 - (t.y + 1.5)) <= 20 + 1e-9),
  );
  const valueOf = (kind: BuildingKind, house: number): number => {
    const sp = specOf.get(kind);
    if (!sp) return 0;
    return sp.value + (inTownHall[house] ? sp.itemValue : 0);
  };

  // Wirkung je Versorger auf Häuser (Lage „x,y“ → Anteil 0…1).
  const reach = (cell: Uint8Array, p: Provider, houses: FillState['houses']): Map<string, number> => {
    const out = new Map<string, number>();
    bfs(cell, p.ring.filter((i) => cell[i] === ROAD), p.isUni ? UNIVERSITY_MAX_RANGE + p.bonus : p.range);
    for (const hs of houses) {
      const d = nearest(ringOf(hs.x, hs.y, 3, 3));
      if (!d) continue;
      const f = p.isUni ? universityFactor(d, p.bonus) : 1;
      if (f > 0) out.set(`${hs.x},${hs.y}`, f);
    }
    return out;
  };
  /** Gesamtwert der Versorgung aller Häuser (bester Anteil je Art). */
  const coverageValue = (cell: Uint8Array, houses: FillState['houses'], maps: Map<string, number>[]): number => {
    let total = 0;
    houses.forEach((hs, k) => {
      const key = `${hs.x},${hs.y}`;
      const best = new Map<BuildingKind, number>();
      providers.forEach((p, pi) => {
        const f = maps[pi].get(key) ?? 0;
        if (f > (best.get(p.kind) ?? 0)) best.set(p.kind, f);
      });
      for (const [kind, f] of best) total += f * valueOf(kind, k);
    });
    void cell;
    return total;
  };

  // --- Lagerhaus-Bedarf: Gebäude → muss ein Lager in Reichweite haben
  const warehouseRings = services.filter((sv) => WAREHOUSE_KINDS.has(sv.kind)).map((sv) => ringOf(sv.x, sv.y, sv.w, sv.h));
  const needy = services
    .map((sv) => ({ sv, range: sv.kind === 'production' ? PRODUCTION_WAREHOUSE_RANGE : lookup(sv.guid).needsWarehouse ? (lookup(sv.guid).roadRange ?? 0) : 0 }))
    .filter((n) => n.range > 0);
  const warehouseOk = (cell: Uint8Array): boolean[] =>
    needy.map((n) => {
      bfs(cell, ringOf(n.sv.x, n.sv.y, n.sv.w, n.sv.h).filter((i) => cell[i] === ROAD), n.range);
      return warehouseRings.some((r) => nearest(r) > 0);
    });
  const warehouseBefore = warehouseOk(s.cell);

  // --- Querstraßen-Stücke: gerade Läufe „reiner“ Straßenkacheln (ohne
  //     Abzweig quer) der Länge 2–8, an beiden Enden eine Straße.
  const findSegments = (cell: Uint8Array): Segment[] => {
    const segs: Segment[] = [];
    for (const horizontal of [true, false]) {
      const seen = new Uint8Array(N);
      for (let i0 = 0; i0 < N; i0++) {
        if (seen[i0] || cell[i0] !== ROAD) continue;
        const x0 = i0 % w;
        const y0 = (i0 - x0) / w;
        const pure = (x: number, y: number): boolean => {
          if (x < 0 || y < 0 || x >= w || y >= h) return false;
          const i = y * w + x;
          if (cell[i] !== ROAD) return false;
          // quer dazu keine Straße
          if (horizontal) return !(y > 0 && isWay(cell[i - w])) && !(y < h - 1 && isWay(cell[i + w]));
          return !(x > 0 && isWay(cell[i - 1])) && !(x < w - 1 && isWay(cell[i + 1]));
        };
        if (!pure(x0, y0)) continue;
        // Lauf entlang der Achse
        const tiles: number[] = [];
        let x = x0;
        let y = y0;
        while (pure(x, y)) {
          tiles.push(y * w + x);
          seen[y * w + x] = 1;
          if (horizontal) x++;
          else y++;
        }
        // Enden müssen Straße sein (Abzweig)
        const before = horizontal ? (x0 > 0 ? y0 * w + x0 - 1 : -1) : y0 > 0 ? (y0 - 1) * w + x0 : -1;
        const after = horizontal ? (x < w ? y * w + x : -1) : y < h ? y * w + x : -1;
        if (tiles.length < 2 || tiles.length > 8 || before < 0 || after < 0) continue;
        if (cell[before] !== ROAD || cell[after] !== ROAD) continue;
        segs.push({ tiles, ends: [[before, after]] });
      }
    }
    // Gruppen: 2–3 Stücke derselben Spalte (gleiche Lage quer, gleiche Länge)
    // hintereinander – erst zusammen ergeben sie ein Haus mehr je Spalte.
    const byLane = new Map<string, Segment[]>();
    for (const sg of segs) {
      const a = sg.tiles[0];
      const b = sg.tiles[sg.tiles.length - 1];
      const horiz = b - a === sg.tiles.length - 1 && Math.floor(a / w) === Math.floor(b / w);
      const key = horiz ? `h${a % w}:${sg.tiles.length}` : `v${Math.floor(a / w)}:${sg.tiles.length}`;
      const list = byLane.get(key);
      if (list) list.push(sg);
      else byLane.set(key, [sg]);
    }
    const groups: Segment[] = [];
    for (const [key, list] of byLane) {
      const horiz = key.startsWith('h');
      list.sort((p, q) => (horiz ? Math.floor(p.tiles[0] / w) - Math.floor(q.tiles[0] / w) : (p.tiles[0] % w) - (q.tiles[0] % w)));
      for (let i = 0; i < list.length; i++) {
        for (const k of [2, 3]) {
          if (i + k > list.length) continue;
          const part = list.slice(i, i + k);
          // Abstand zwischen den Stücken höchstens eine Bandlänge (≤ 110 Kacheln)
          const pos = part.map((sg) => (horiz ? Math.floor(sg.tiles[0] / w) : sg.tiles[0] % w));
          if (pos[pos.length - 1] - pos[0] > 110 * (k - 1)) continue;
          groups.push({ tiles: part.flatMap((sg) => sg.tiles), ends: part.flatMap((sg) => sg.ends) });
        }
      }
    }
    return [...segs, ...groups];
  };

  /** Hängen die beiden Enden ohne das Stück noch zusammen (begrenzte Suche)? */
  const stillConnected = (cell: Uint8Array, a: number, b: number): boolean => {
    bfs(cell, [a], 400);
    return gen[b] === g;
  };

  // --- Bereiche (Kachelmasken) der Versorger, Lagerwege und des Ministeriums:
  //     ein Stück außerhalb aller Bereiche ändert dort nichts.
  const regionOf = (cell: Uint8Array, starts: readonly number[], range: number): Uint8Array => {
    bfs(cell, starts.filter((i) => cell[i] === ROAD), range);
    const m = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (gen[i] === g) m[i] = 1;
    return m;
  };
  const providerRegions = (cell: Uint8Array): Uint8Array[] =>
    providers.map((p) => regionOf(cell, p.ring, p.isUni ? UNIVERSITY_MAX_RANGE + p.bonus : p.range));
  const sideRegion = (cell: Uint8Array): Uint8Array => {
    const m = new Uint8Array(N);
    for (const n of needy) {
      const r = regionOf(cell, ringOf(n.sv.x, n.sv.y, n.sv.w, n.sv.h), n.range);
      for (let i = 0; i < N; i++) if (r[i]) m[i] = 1;
    }
    if (ministrySv) {
      const r = regionOf(cell, ringOf(ministrySv.x, ministrySv.y, ministrySv.w, ministrySv.h), ministryRange);
      for (let i = 0; i < N; i++) if (r[i]) m[i] = 1;
    }
    return m;
  };

  // Nur Gebäude, die jetzt einen Anschluss haben, müssen ihn behalten (Module des Lufthafens haben keinen).
  const connected = services.map((sv) => ringOf(sv.x, sv.y, sv.w, sv.h).some((i) => s.cell[i] === ROAD));
  const why: Record<string, number> = {};
  const count = (k: string): void => {
    why[k] = (why[k] ?? 0) + 1;
  };
  let maps = providers.map((p) => reach(s.cell, p, s.houses));
  let regions = providerRegions(s.cell);
  let side = sideRegion(s.cell);
  let baseValue = s.houses.length * HV + coverageValue(s.cell, s.houses, maps);
  const hardReject = new Set<string>();

  type Eval = { state: FillState; maps: Map<string, number>[]; value: number; gained: number; score: number };
  const evaluate = (seg: Segment): Eval | null => {
    const key = seg.tiles.join(',');
    const cell = s.cell.slice();
    for (const i of seg.tiles) cell[i] = FREE;
    if (seg.ends.some(([a, b]) => !stillConnected(cell, a, b))) {
      hardReject.add(key);
      count('netz');
      return null;
    }
    if (services.some((sv, k) => connected[k] && !ringOf(sv.x, sv.y, sv.w, sv.h).some((i) => cell[i] === ROAD))) {
      hardReject.add(key);
      count('anschluss');
      return null;
    }
    if (seg.tiles.some((i) => side[i])) {
      const wh = warehouseOk(cell);
      if (wh.some((ok, k) => warehouseBefore[k] && !ok)) {
        hardReject.add(key);
        count('lager');
        return null;
      }
      if (ministrySv) {
        const m = inMinistryOf(cell);
        if (m.some((v, k) => inMinistry[k] && !v)) {
          hardReject.add(key);
          count('ministerium');
          return null;
        }
      }
    }
    const st: FillState = { w, h, cell, houses: s.houses.map((hs) => ({ ...hs })) };
    const lost = st.houses.filter((hs) => !touchesAny(st, hs.x, hs.y));
    if (lost.length) {
      for (const hs of lost) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) cell[(hs.y + dy) * w + hs.x + dx] = FREE;
      st.houses = st.houses.filter((hs) => !lost.includes(hs));
    }
    realignLanes(st);
    const housesChanged = st.houses.length !== s.houses.length || lost.length > 0;
    const nextMaps = maps.map((m, pi) =>
      housesChanged || seg.tiles.some((i) => regions[pi][i]) ? reach(cell, providers[pi], st.houses) : m,
    );
    const value = st.houses.length * HV + coverageValue(cell, st.houses, nextMaps);
    const gain = value - baseValue;
    const gained = st.houses.length - s.houses.length;
    // Ohne Häusergewinn nur, wenn nichts verloren geht (ebnet spätere Gewinne).
    const ok = gained > 0 ? gain > 0 : gained === 0 && gain >= -1e-6;
    if (!ok) {
      count(gained > 0 ? 'wert' : gained < 0 ? 'häuser−' : 'versorgung');
      return null;
    }
    return { state: st, maps: nextMaps, value, gained, score: gain + (gained > 0 ? 1 : 0.5) };
  };
  const apply = (seg: Segment, e: Eval): void => {
    const lossBefore = baseValue - s.houses.length * HV;
    const lossAfter = e.value - e.state.houses.length * HV;
    report.coverageLoss += Math.max(0, lossBefore - lossAfter);
    report.gained += e.gained;
    report.segments++;
    report.tiles += seg.tiles.length;
    s.cell.set(e.state.cell);
    s.houses = e.state.houses;
    maps = e.maps;
    baseValue = e.value;
    regions = providerRegions(s.cell);
    side = sideRegion(s.cell);
    options.onProgress?.(report.segments, report.gained);
  };

  report.candidates = findSegments(s.cell).length;
  for (let round = 0; round < 60; round++) {
    if (performance.now() > options.deadline) break;
    const segments = findSegments(s.cell).filter((seg) => !hardReject.has(seg.tiles.join(',')));
    const found: Array<{ seg: Segment; score: number }> = [];
    for (const seg of segments) {
      if (performance.now() > options.deadline) break;
      const e = evaluate(seg);
      if (e) found.push({ seg, score: e.score });
    }
    if (!found.length) break;
    found.sort((a, b) => b.score - a.score);
    let applied = 0;
    for (const f of found) {
      if (performance.now() > options.deadline) break;
      if (f.seg.tiles.some((i) => s.cell[i] !== ROAD)) continue;
      const e = evaluate(f.seg);
      if (!e) continue;
      apply(f.seg, e);
      applied++;
    }
    if (!applied) break;
  }
  report.rejected = why;
  return report;
}

/** Berührt die 3×3-Fläche eine Straße? */
function touchesAny(s: FillState, x: number, y: number): boolean {
  const { w, h, cell } = s;
  for (let d = 0; d < 3; d++) {
    if (y > 0 && cell[(y - 1) * w + x + d] === ROAD) return true;
    if (y + 3 < h && cell[(y + 3) * w + x + d] === ROAD) return true;
    if (x > 0 && cell[(y + d) * w + x - 1] === ROAD) return true;
    if (x + 3 < w && cell[(y + d) * w + x + 3] === ROAD) return true;
  }
  return false;
}
