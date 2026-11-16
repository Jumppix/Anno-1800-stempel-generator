// Stadtplaner Phase 2: Wohnraster aus 8er-Gruppen und Rathäuser.
//
// Die ganze Landfläche wird bebaut (fill.ts): 8er-Raster über die ganze Insel
// inkl. angeschnittener Zellen, Restflächen gierig gefüllt, Straßen bei Bedarf
// verlängert. `planGrid` (nur volle Gruppen) bleibt als einfache Variante.
//
// Rathäuser: der Handelskammer-/Rathaus-Solver (solver.ts) mit eigenem Ziel –
// abgedeckt werden Hausmittelpunkte (Mittelpunkt im Radius 20), Bauplatz ist
// Land ohne Straße; jedes verdrängte Haus kostet `HOUSE_PENALTY` abgedeckte
// Häuser. Danach werden verdrängte Häuser entfernt.

import { outerBoundary } from './coast';
import { FARMER_HOUSE, lookup, STREET_GUIDS } from './catalog';
import { BLOCKED, BRIDGE, extendRoads, FREE, greedyFill, HOUSE, pruneBridges, realignLanes, replaceRoadStubs, ROAD, SERVICE, touchesRoad, WATER, type FillResult, type FillState } from './fill';
import { placePostBoxes, type PostReport } from './post';
import { compact, type CompactOptions, type CompactResult } from './compact';
import { placeServices, type PlacedService, type ServiceOptions, type ServiceReport } from './services';
import { thinCrossRoads, type ThinOptions, type ThinReport } from './thin';
import type { LandMask, OverlapPenalty } from './solver';
import type { StampBuilding, StampStreet } from './stamp';

export type Orientation = 'vertical' | 'horizontal';

export interface GridOptions {
  /** Häuser je Linie (8er-Gruppe = 4). */
  housesPerLine: number;
  orientation: 'auto' | Orientation;
}

export interface PlannedHouse {
  x: number;
  y: number;
  /** Linie innerhalb der Gruppe (0 = erste Spalte bzw. obere Reihe), −1 = frei gesetzt. */
  line: number;
  group: number;
}

export interface GridPlan {
  w: number;
  h: number;
  orientation: Orientation;
  /** Lage des Straßengitters (Straßen bei x ≡ ox mod px, y ≡ oy mod py). */
  ox: number;
  oy: number;
  px: number;
  py: number;
  groups: Array<{ x: number; y: number; w: number; h: number }>;
  houses: PlannedHouse[];
  /** 1 = Pflasterstraße des Rasters. */
  roads: Uint8Array;
  roadCount: number;
  /** Zusammenhängende Straßennetze (1 = alles verbunden). */
  networks: number;
  /** Brückenkacheln (Straße über Wasser), nicht Teil von `roads`. */
  bridges?: number[];
  /** Ausrichtung je Kachel (1 = waagerecht), wenn Landstücke eigene Raster haben. */
  orientationMap?: Uint8Array;
}

/** Abzug je verdrängtem Haus in „abgedeckten Häusern“. */
export const HOUSE_PENALTY = 10;

export function planGrid(mask: LandMask, options: GridOptions): GridPlan {
  const { w, h, data } = mask;
  // Präfixsumme der Landkacheln für Rechteck-Tests in O(1).
  const P = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      run += data[y * w + x] ? 1 : 0;
      P[(y + 1) * (w + 1) + x + 1] = P[y * (w + 1) + x + 1] + run;
    }
  }
  const allLand = (x0: number, y0: number, x1: number, y1: number): boolean => {
    if (x0 < 0 || y0 < 0 || x1 > w || y1 > h) return false;
    const s = P[y1 * (w + 1) + x1] - P[y0 * (w + 1) + x1] - P[y1 * (w + 1) + x0] + P[y0 * (w + 1) + x0];
    return s === (x1 - x0) * (y1 - y0);
  };

  const n = Math.max(1, Math.round(options.housesPerLine));
  const orientations: Orientation[] =
    options.orientation === 'auto' ? ['vertical', 'horizontal'] : [options.orientation];

  let best: { o: Orientation; ox: number; oy: number; count: number } | null = null;
  for (const o of orientations) {
    const gw = o === 'vertical' ? 6 : 3 * n;
    const gh = o === 'vertical' ? 3 * n : 6;
    const px = gw + 1;
    const py = gh + 1;
    for (let ox = 0; ox < px; ox++) {
      for (let oy = 0; oy < py; oy++) {
        let count = 0;
        for (let ry = oy; ry + py <= h; ry += py) {
          for (let rx = ox; rx + px <= w; rx += px) {
            // Zelle samt Ringstraße: [rx, rx+px] × [ry, ry+py] (inklusive).
            if (allLand(rx, ry, rx + px + 1, ry + py + 1)) count++;
          }
        }
        if (!best || count > best.count) best = { o, ox, oy, count };
      }
    }
  }

  const o = best?.o ?? 'vertical';
  const gw = o === 'vertical' ? 6 : 3 * n;
  const gh = o === 'vertical' ? 3 * n : 6;
  const px = gw + 1;
  const py = gh + 1;
  const ox = best?.ox ?? 0;
  const oy = best?.oy ?? 0;

  const roads = new Uint8Array(w * h);
  const groups: GridPlan['groups'] = [];
  const houses: PlannedHouse[] = [];
  for (let ry = oy; ry + py <= h; ry += py) {
    for (let rx = ox; rx + px <= w; rx += px) {
      if (!allLand(rx, ry, rx + px + 1, ry + py + 1)) continue;
      const g = groups.length;
      groups.push({ x: rx + 1, y: ry + 1, w: gw, h: gh });
      for (let x = rx; x <= rx + px; x++) {
        roads[ry * w + x] = 1;
        roads[(ry + py) * w + x] = 1;
      }
      for (let y = ry; y <= ry + py; y++) {
        roads[y * w + rx] = 1;
        roads[y * w + rx + px] = 1;
      }
      if (o === 'vertical') {
        for (let c = 0; c < 2; c++) {
          for (let r = 0; r < n; r++) houses.push({ x: rx + 1 + c * 3, y: ry + 1 + r * 3, line: c as 0 | 1, group: g });
        }
      } else {
        for (let c = 0; c < n; c++) {
          for (let r = 0; r < 2; r++) houses.push({ x: rx + 1 + c * 3, y: ry + 1 + r * 3, line: r as 0 | 1, group: g });
        }
      }
    }
  }

  // Zusammenhängende Straßennetze zählen.
  let roadCount = 0;
  let networks = 0;
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < roads.length; i++) {
    if (!roads[i]) continue;
    roadCount++;
    if (seen[i]) continue;
    networks++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop() as number;
      const x = j % w;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) {
        if (k >= 0 && k < roads.length && roads[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
  }

  return { w, h, orientation: o, ox, oy, px, py, groups, houses, roads, roadCount, networks };
}

/** Eingaben für den Rathaus-Solver: Ziel = Hausmittelpunkte, Bauplatz = Land ohne Straße. */
export function townHallProblem(
  mask: LandMask,
  plan: GridPlan,
  options: { onCrossRoads?: boolean } = {},
): { target: LandMask; allowed: Uint8Array; penalty: OverlapPenalty } {
  const { w, h } = plan;
  const centers = new Uint8Array(w * h);
  const ids = new Int32Array(w * h);
  plan.houses.forEach((house, i) => {
    centers[(house.y + 1) * w + house.x + 1] = 1;
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) ids[(house.y + dy) * w + house.x + dx] = i + 1;
    }
  });
  const allowed = new Uint8Array(w * h);
  const crossRoad = options.onCrossRoads === false ? new Uint8Array(w * h) : crossRoadTiles(plan);
  for (let i = 0; i < allowed.length; i++) allowed[i] = mask.data[i] && (!plan.roads[i] || crossRoad[i]) ? 1 : 0;
  return {
    target: { w, h, data: centers, landCount: plan.houses.length },
    allowed,
    penalty: { ids, weight: HOUSE_PENALTY },
  };
}

/**
 * Querstraßen-Kacheln, auf denen ein Rathaus stehen darf: Bei senkrechten
 * Gruppen hängen die Häuser an den Längsstraßen; die Querstraßen verbinden
 * nur. Ein Rathaus darauf kostet etwa zwei statt vier Häuser. Erlaubt sind
 * Kacheln, die keine durchgehende Längsstraße sind (Querstraße, T-Einmündung),
 * in Abschnitten von mindestens 4 Kacheln, deren Wegfall das Netz nicht trennt.
 * `finishPlan` prüft den Zusammenhang am Ende noch einmal.
 */
export function crossRoadTiles(plan: GridPlan): Uint8Array {
  const { w, h } = plan;
  const roads = plan.roads;
  // Straßenkacheln am Brückenkopf (grenzen an eine Brücke).
  let bridgeHead: Uint8Array | null = null;
  if (plan.bridges?.length) {
    bridgeHead = new Uint8Array(roads.length);
    for (const b of plan.bridges) {
      const bx = b % w;
      for (const k of [bx > 0 ? b - 1 : -1, bx < w - 1 ? b + 1 : -1, b - w, b + w]) {
        if (k >= 0 && k < roads.length && roads[k]) bridgeHead[k] = 1;
      }
    }
  }
  const out = new Uint8Array(roads.length);
  // Ausrichtung je Kachel (getrennte Landstücke können eigene Raster haben).
  const map = plan.orientationMap;
  const isVertical = (i: number): boolean => (map ? map[i] === 0 : plan.orientation === 'vertical');
  for (const vertical of [true, false]) {
    if (!map && vertical !== (plan.orientation === 'vertical')) continue;
    crossRoadPass(vertical);
  }
  return out;

  function crossRoadPass(vertical: boolean): void {
  const cand = new Uint8Array(roads.length);
  for (let i = 0; i < roads.length; i++) {
    if (!roads[i] || isVertical(i) !== vertical) continue;
    const x = i % w;
    const y = (i - x) / w;
    const a = vertical ? (y > 0 ? roads[i - w] : 0) : x > 0 ? roads[i - 1] : 0;
    const b = vertical ? (y < h - 1 ? roads[i + w] : 0) : x < w - 1 ? roads[i + 1] : 0;
    // Entlang der Querstraße muss es weitergehen.
    const c = vertical ? (x > 0 ? roads[i - 1] : 0) : y > 0 ? roads[i - w] : 0;
    const d = vertical ? (x < w - 1 ? roads[i + 1] : 0) : y < h - 1 ? roads[i + w] : 0;
    if (!(a && b) && (c || d)) cand[i] = 1;
  }
  const step = vertical ? 1 : w;
  const lines = vertical ? h : w;
  const length = vertical ? w : h;
  const removed = new Uint8Array(roads.length);
  for (let l = 0; l < lines; l++) {
    const at = (k: number): number => (vertical ? l * w + k : k * w + l);
    let k = 0;
    while (k < length) {
      if (!cand[at(k)]) {
        k++;
        continue;
      }
      let end = k;
      while (end < length && cand[at(end)]) end++;
      for (let s = k; s + 4 <= end; s++) {
        const tiles = [at(s), at(s) + step, at(s) + 2 * step, at(s) + 3 * step];
        for (const t of tiles) removed[t] = 1;
        // Nur Landstraßen prüfen (jedes Ufer bleibt zusammenhängend), Brückenköpfe nie überbauen.
        const head = bridgeHead ? tiles.some((t) => bridgeHead[t]) : false;
        if (!head && !separates(roads, w, h, removed, tiles)) for (const t of tiles) out[t] = 1;
        for (const t of tiles) removed[t] = 0;
      }
      k = end;
    }
  }
  }
}

/** Trennt das Entfernen von `tiles` die angrenzenden Straßenkacheln voneinander? */
function separates(roads: Uint8Array, w: number, h: number, removed: Uint8Array, tiles: number[]): boolean {
  const neighbours = (i: number): number[] => {
    const x = i % w;
    const y = (i - x) / w;
    const out: number[] = [];
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (y > 0) out.push(i - w);
    if (y < h - 1) out.push(i + w);
    return out;
  };
  const ends = new Set<number>();
  for (const t of tiles) for (const n of neighbours(t)) if (roads[n] && !removed[n]) ends.add(n);
  if (ends.size <= 1) return false;
  const list = [...ends];
  const seen = new Set<number>([list[0]]);
  const queue = [list[0]];
  let found = 1;
  for (let q = 0; q < queue.length; q++) {
    for (const n of neighbours(queue[q])) {
      if (!roads[n] || removed[n] || seen.has(n)) continue;
      seen.add(n);
      if (ends.has(n) && ++found === ends.size) return false;
      queue.push(n);
    }
  }
  return true;
}

/** Zahl der Straßennetze, wenn `removed` (Kacheln) zusätzlich fehlen. */
function networksWithout(roads: Uint8Array, w: number, removed: Uint8Array): number {
  const r = new Uint8Array(roads.length);
  for (let i = 0; i < r.length; i++) r[i] = roads[i] && !removed[i] ? 1 : 0;
  return countNetworks(r, w);
}

function housesWithoutAccess(houses: readonly PlannedHouse[], roads: Uint8Array, w: number, h: number): Set<PlannedHouse> {
  const out = new Set<PlannedHouse>();
  for (const hs of houses) {
    let ok = false;
    for (let d = 0; d < 3 && !ok; d++) {
      if (hs.y > 0 && roads[(hs.y - 1) * w + hs.x + d]) ok = true;
      else if (hs.y + 3 < h && roads[(hs.y + 3) * w + hs.x + d]) ok = true;
      else if (hs.x > 0 && roads[(hs.y + d) * w + hs.x - 1]) ok = true;
      else if (hs.x + 3 < w && roads[(hs.y + d) * w + hs.x + 3]) ok = true;
    }
    if (!ok) out.add(hs);
  }
  return out;
}

export interface CityPlan {
  plan: GridPlan;
  townHalls: Array<{ x: number; y: number }>;
  houses: PlannedHouse[];
  removedHouses: number;
  droppedTownHalls: number;
  /** Versorgungsgebäude und Lagerhäuser (Phase 3). */
  services?: PlacedService[];
}

/**
 * Rathäuser übernehmen: Häuser unter Rathausflächen entfernen, Rathäuser mit
 * zu wenig abgedeckten Häusern verwerfen.
 */
export function finishPlan(
  plan: GridPlan,
  townHalls: ReadonlyArray<{ x: number; y: number }>,
  minCovered: number,
): CityPlan {
  const { w, h } = plan;
  const overlaps = (t: { x: number; y: number }, hs: PlannedHouse): boolean =>
    hs.x < t.x + 4 && hs.x + 3 > t.x && hs.y < t.y + 4 && hs.y + 3 > t.y;
  const footprint = (list: ReadonlyArray<{ x: number; y: number }>): Uint8Array => {
    const m = new Uint8Array(w * h);
    for (const t of list) for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) m[(t.y + dy) * w + t.x + dx] = 1;
    return m;
  };
  const onRoad = (t: { x: number; y: number }): boolean => {
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) if (plan.roads[(t.y + dy) * w + t.x + dx]) return true;
    return false;
  };

  // Rathäuser auf Querstraßen nur, wenn das Straßennetz zusammenhängend bleibt.
  // Landstraßen je Ufer müssen zusammenhängend bleiben (Brücken zählen hier nicht).
  const baseLandNetworks = countNetworks(plan.roads, w);
  let kept: Array<{ x: number; y: number }> = [];
  for (const t of townHalls) {
    if (onRoad(t) && networksWithout(plan.roads, w, footprint([...kept, t])) > baseLandNetworks) continue;
    kept.push(t);
  }

  const build = (list: ReadonlyArray<{ x: number; y: number }>): { houses: PlannedHouse[]; roads: Uint8Array } => {
    const fp = footprint(list);
    const roads = new Uint8Array(plan.roads.length);
    for (let i = 0; i < roads.length; i++) roads[i] = plan.roads[i] && !fp[i] ? 1 : 0;
    const standing = plan.houses.filter((hs) => !list.some((t) => overlaps(t, hs)));
    const cut = housesWithoutAccess(standing, roads, w, h);
    return { houses: standing.filter((hs) => !cut.has(hs)), roads };
  };
  const covers = (t: { x: number; y: number }, list: readonly PlannedHouse[]): number =>
    list.filter((hs) => Math.hypot(hs.x + 1 - (t.x + 1.5), hs.y + 1 - (t.y + 1.5)) <= 20 + 1e-9).length;

  // Wiederholen, bis jedes Rathaus nach dem Entfernen genug Häuser abdeckt.
  let state = build(kept);
  for (let round = 0; round < 5; round++) {
    const next = kept.filter((t) => covers(t, state.houses) >= minCovered);
    if (next.length === kept.length) break;
    kept = next;
    state = build(kept);
  }
  let roadCount = 0;
  for (let i = 0; i < state.roads.length; i++) roadCount += state.roads[i];
  return {
    plan: {
      ...plan,
      roads: state.roads,
      roadCount,
      networks: countNetworks(state.roads, w, plan.bridges),
      houses: state.houses,
    },
    townHalls: kept,
    houses: state.houses,
    removedHouses: plan.houses.length - state.houses.length,
    droppedTownHalls: townHalls.length - kept.length,
  };
}

export interface PlanStampOptions {
  coast: boolean;
  coastGuid: number;
  /** Brücken als Pflasterstraße mitschreiben (nur für Ansicht/Analyse, nicht für den Export). */
  bridges?: boolean;
}

/** Gebäude und Straßen des Plans für den Stempel (Bauernhäuser, Pflaster, Rathäuser). */
export function planToStampItems(
  mask: LandMask,
  city: CityPlan,
  options: PlanStampOptions,
): { buildings: StampBuilding[]; streets: StampStreet[] } {
  const { w } = city.plan;
  const buildings: StampBuilding[] = [];
  const occupied = new Uint8Array(city.plan.roads.length);
  const mark = (x: number, y: number, bw: number, bh: number): void => {
    for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) occupied[(y + dy) * w + x + dx] = 1;
  };
  for (const hs of city.houses) {
    buildings.push({ guid: FARMER_HOUSE, x: hs.x, y: hs.y, w: 3, h: 3, turns: 0 });
    mark(hs.x, hs.y, 3, 3);
  }
  for (const t of city.townHalls) {
    buildings.push({ guid: 100415, x: t.x, y: t.y, w: 4, h: 4, turns: 0 });
    mark(t.x, t.y, 4, 4);
  }
  for (const sv of city.services ?? []) {
    buildings.push({ guid: sv.guid, x: sv.x, y: sv.y, w: sv.w, h: sv.h, turns: sv.turns, owner: sv.owner });
    mark(sv.x, sv.y, sv.w, sv.h);
  }
  const streets: StampStreet[] = [];
  for (let i = 0; i < city.plan.roads.length; i++) {
    if (!city.plan.roads[i] || occupied[i]) continue;
    streets.push({ x: i % w, y: Math.floor(i / w), guid: STREET_GUIDS.paved });
  }
  if (options.bridges) {
    for (const i of city.plan.bridges ?? []) streets.push({ x: i % w, y: Math.floor(i / w), guid: STREET_GUIDS.paved });
  }
  if (options.coast) {
    const edge = outerBoundary(mask);
    for (let i = 0; i < edge.length; i++) {
      if (!edge[i] || occupied[i] || city.plan.roads[i]) continue;
      streets.push({ x: i % w, y: Math.floor(i / w), guid: options.coastGuid });
    }
  }
  return { buildings, streets };
}

/** Teilt Gebäude/Straßen in waagerechte Bänder mit höchstens `maxArea` Kacheln. */
export function splitBands(
  items: { buildings: StampBuilding[]; streets: StampStreet[] },
  maxArea: number,
): Array<{ buildings: StampBuilding[]; streets: StampStreet[] }> {
  if (!Number.isFinite(maxArea)) return [items];
  const xs = [...items.buildings.map((b) => b.x), ...items.streets.map((s) => s.x)];
  const xe = [...items.buildings.map((b) => b.x + b.w), ...items.streets.map((s) => s.x + 1)];
  const ys = [...items.buildings.map((b) => b.y), ...items.streets.map((s) => s.y)];
  if (!xs.length) return [];
  const width = Math.max(...xe) - Math.min(...xs);
  const band = Math.max(8, Math.floor(maxArea / Math.max(1, width)) - 4);
  const y0 = Math.min(...ys);
  const bands = new Map<number, { buildings: StampBuilding[]; streets: StampStreet[] }>();
  const get = (y: number): { buildings: StampBuilding[]; streets: StampStreet[] } => {
    const k = Math.floor((y - y0) / band);
    let b = bands.get(k);
    if (!b) {
      b = { buildings: [], streets: [] };
      bands.set(k, b);
    }
    return b;
  };
  // Komplexe (Lufthafen + Module) bleiben in einem Teilstempel.
  const ownerY = new Map<number, number>();
  for (const b of items.buildings) if (b.owner !== undefined) ownerY.set(b.owner, Math.min(ownerY.get(b.owner) ?? Infinity, b.y));
  for (const b of items.buildings) get(b.owner !== undefined ? (ownerY.get(b.owner) as number) : b.y).buildings.push(b);
  for (const s of items.streets) get(s.y).streets.push(s);
  return [...bands.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

// ---------------------------------------------------------------------------
// Vollständige Bebauung (fill.ts) als Plan
// ---------------------------------------------------------------------------

function countNetworks(roads: Uint8Array, w: number, bridges?: readonly number[]): number {
  if (bridges?.length) {
    const all = Uint8Array.from(roads);
    for (const i of bridges) all[i] = 1;
    roads = all;
  }
  let networks = 0;
  const seen = new Uint8Array(roads.length);
  for (let i = 0; i < roads.length; i++) {
    if (!roads[i] || seen[i]) continue;
    networks++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop() as number;
      const x = j % w;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) {
        if (k >= 0 && k < roads.length && roads[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
  }
  return networks;
}

export function planFromFill(r: FillResult): GridPlan {
  const roads = new Uint8Array(r.cell.length);
  const bridges: number[] = [];
  let roadCount = 0;
  for (let i = 0; i < roads.length; i++) {
    if (r.cell[i] === ROAD) {
      roads[i] = 1;
      roadCount++;
    } else if (r.cell[i] === BRIDGE) bridges.push(i);
  }
  const n = r.housesPerLine;
  return {
    w: r.w,
    h: r.h,
    orientation: r.orientation,
    ox: r.ox,
    oy: r.oy,
    px: (r.orientation === 'vertical' ? 6 : 3 * n) + 1,
    py: (r.orientation === 'vertical' ? 3 * n : 6) + 1,
    groups: [],
    houses: r.houses.map((hs) => ({ x: hs.x, y: hs.y, line: hs.line, group: -1 })),
    roads,
    roadCount,
    networks: countNetworks(roads, r.w, bridges),
    bridges,
    orientationMap: r.orientationMap,
  };
}

/** Freie Landkacheln (weder Haus, Straße noch Rathaus). */
export function freeTiles(mask: LandMask, city: CityPlan): number {
  const used = new Uint8Array(mask.data.length);
  for (let i = 0; i < used.length; i++) if (city.plan.roads[i]) used[i] = 1;
  const mark = (x: number, y: number, s: number): void => {
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) used[(y + dy) * mask.w + x + dx] = 1;
  };
  for (const hs of city.houses) mark(hs.x, hs.y, 3);
  for (const t of city.townHalls) mark(t.x, t.y, 4);
  for (const sv of city.services ?? []) {
    for (let dy = 0; dy < sv.h; dy++) for (let dx = 0; dx < sv.w; dx++) used[(sv.y + dy) * mask.w + sv.x + dx] = 1;
  }
  let free = 0;
  for (let i = 0; i < used.length; i++) if (mask.data[i] && !used[i]) free++;
  return free;
}

function cityToState(mask: LandMask, city: CityPlan): FillState {
  const { w, h } = mask;
  const cell = new Uint8Array(w * h);
  for (let i = 0; i < cell.length; i++) cell[i] = mask.data[i] ? (city.plan.roads[i] ? ROAD : FREE) : WATER;
  const s: FillState = { w, h, cell, houses: city.houses.map((hs) => ({ x: hs.x, y: hs.y, line: hs.line })) };
  for (const hs of city.houses) {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) cell[(hs.y + dy) * w + hs.x + dx] = HOUSE;
  }
  for (const t of city.townHalls) {
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) cell[(t.y + dy) * w + t.x + dx] = BLOCKED;
  }
  for (const sv of city.services ?? []) {
    for (let dy = 0; dy < sv.h; dy++) for (let dx = 0; dx < sv.w; dx++) cell[(sv.y + dy) * w + sv.x + dx] = SERVICE;
  }
  for (const i of city.plan.bridges ?? []) cell[i] = BRIDGE;
  return s;
}

function stateToCity(s: FillState, city: CityPlan, townHalls: Array<{ x: number; y: number }>): CityPlan {
  pruneBridges(s);
  const bridges: number[] = [];
  for (let i = 0; i < s.cell.length; i++) if (s.cell[i] === BRIDGE) bridges.push(i);
  const roads = new Uint8Array(s.w * s.h);
  let roadCount = 0;
  for (let i = 0; i < roads.length; i++) {
    if (s.cell[i] === ROAD) {
      roads[i] = 1;
      roadCount++;
    }
  }
  const houses = s.houses.map((hs) => ({ x: hs.x, y: hs.y, line: hs.line, group: -1 }));
  return {
    ...city,
    plan: { ...city.plan, roads, roadCount, networks: countNetworks(roads, s.w, bridges), houses, bridges },
    houses,
    townHalls,
  };
}

/** Nach dem Setzen der Rathäuser die Lücken wieder mit Häusern füllen. */
export function refillAroundTownHalls(mask: LandMask, city: CityPlan): CityPlan & { refilled: number } {
  const s = cityToState(mask, city);
  const before = s.houses.length;
  greedyFill(s);
  extendRoads(s);
  return { ...stateToCity(s, city, [...city.townHalls]), refilled: s.houses.length - before };
}

/**
 * Nachverdichtung (compact.ts): Häuser und Rathäuser lokal verschieben, um
 * Restflächen zu nutzen. Liefert den neuen Plan und die Bilanz.
 */
export function compactCity(
  mask: LandMask,
  city: CityPlan,
  options: CompactOptions,
  /** Zwischenstand für die Live-Ansicht (höchstens alle `snapshotMs`). */
  onSnapshot?: (city: CityPlan, gained: number) => void,
  snapshotMs = 2500,
): { city: CityPlan; result: CompactResult } {
  const s = cityToState(mask, city);
  const townHalls = city.townHalls.map((t) => ({ x: t.x, y: t.y }));
  let last = performance.now();
  const result = compact(s, townHalls, {
    ...options,
    onProgress: (gained) => {
      options.onProgress?.(gained);
      if (onSnapshot && performance.now() - last > snapshotMs) {
        last = performance.now();
        onSnapshot(stateToCity(s, city, townHalls.map((t) => ({ x: t.x, y: t.y }))), gained);
      }
    },
  });
  // Häuserspalten zwischen Hindernissen exakt neu belegen („Reihen verschieben“).
  const before = s.houses.length;
  realignLanes(s);
  greedyFill(s);
  result.gained += s.houses.length - before;
  return { city: stateToCity(s, city, townHalls), result };
}

/**
 * Phase 3: Versorgungsgebäude und Lagerhäuser setzen (services.ts), danach
 * die Lücken wieder mit Häusern füllen.
 */
export function planServices(
  mask: LandMask,
  city: CityPlan,
  options: ServiceOptions,
): { city: CityPlan; report: ServiceReport; refilled: number } {
  const s = cityToState(mask, city);
  // Straßenstummel vorher bebauen: danach dürfen sich Wege nicht mehr
  // verlängern, sonst fällt ein Lagerhaus aus der Reichweite.
  replaceRoadStubs(s);
  const { services, report } = placeServices(s, city.townHalls, options);
  const before = s.houses.length;
  greedyFill(s);
  extendRoads(s);
  const next = stateToCity(s, city, [...city.townHalls]);
  return { city: { ...next, services: [...(city.services ?? []), ...services] }, report, refilled: s.houses.length - before };
}

/** Überflüssige Straßenstummel durch Häuser ersetzen (fill.ts `replaceRoadStubs`). */
export function fillRoadStubs(mask: LandMask, city: CityPlan): { city: CityPlan; added: number } {
  const s = cityToState(mask, city);
  const added = replaceRoadStubs(s);
  return { city: { ...stateToCity(s, city, [...city.townHalls]), services: city.services }, added };
}

/**
 * Post: Briefkästen in freie Restkacheln setzen, bis die Produktion den
 * Bedarf deckt (post.ts). `residentsAt`: Einwohner je Haus („x,y“).
 */
export function planPost(
  mask: LandMask,
  city: CityPlan,
  residentsAt: Map<string, number>,
  need: number,
  valuePerTon: number,
): { city: CityPlan; report: PostReport & { removedHouses: number } } {
  const s = cityToState(mask, city);
  const { boxes, report, removedHouses } = placePostBoxes(s, residentsAt, need, valuePerTon);
  const next = removedHouses ? stateToCity(s, city, [...city.townHalls]) : city;
  return { city: { ...next, services: [...(city.services ?? []), ...boxes] }, report: { ...report, removedHouses } };
}

// ---------------------------------------------------------------------------
// Phase 6: Plan von Hand bearbeiten (verschieben, drehen, entfernen)
// ---------------------------------------------------------------------------

/** Ein Sonderbauwerk im Plan: Rathaus (Index) oder Versorgungsgebäude (Index). */
export type EditTarget = { kind: 'townHall'; index: number } | { kind: 'service'; index: number };

export interface EditResult {
  city: CityPlan;
  ok: boolean;
  message: string;
  /** Verdrängte (bzw. ohne Anschluss entfernte) und neu gebaute Häuser. */
  removedHouses: number;
  addedHouses: number;
}

/** Gebäude an einer Kachel (Maskenkoordinaten) finden. */
export function editTargetAt(city: CityPlan, x: number, y: number): EditTarget | null {
  const t = city.townHalls.findIndex((th) => x >= th.x && y >= th.y && x < th.x + 4 && y < th.y + 4);
  if (t >= 0) return { kind: 'townHall', index: t };
  const sv = (city.services ?? []).findIndex((s) => x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h);
  return sv >= 0 ? { kind: 'service', index: sv } : null;
}

/**
 * Sonderbauwerk verschieben (dx, dy), um 90° drehen (`rotate`) oder entfernen.
 * Häuser unter der neuen Fläche weichen; Straßen darunter nur, wenn das Netz
 * zusammenhängt und das Gebäude danach noch an einer Straße liegt (Rathaus
 * braucht keine). Häuser ohne Anschluss werden entfernt, frei gewordene Fläche
 * wird mit Häusern aufgefüllt. Komplexe (Lufthafen + Module) bewegen sich
 * gemeinsam und lassen sich nicht drehen.
 */
export function editCity(
  mask: LandMask,
  city: CityPlan,
  target: EditTarget,
  op: { type: 'move'; dx: number; dy: number } | { type: 'rotate' } | { type: 'remove' },
): EditResult {
  const fail = (message: string): EditResult => ({ city, ok: false, message, removedHouses: 0, addedHouses: 0 });
  const s = cityToState(mask, city);
  const { w, h, cell } = s;
  const services = [...(city.services ?? [])];
  const townHalls = city.townHalls.map((t) => ({ x: t.x, y: t.y }));
  // Betroffene Rechtecke (bei Komplexen alle Teile).
  type Part = { x: number; y: number; w: number; h: number; si: number };
  let parts: Part[];
  let label: string;
  if (target.kind === 'townHall') {
    const t = townHalls[target.index];
    if (!t) return fail('Gebäude nicht gefunden.');
    parts = [{ x: t.x, y: t.y, w: 4, h: 4, si: -1 }];
    label = 'Rathaus';
  } else {
    const sv = services[target.index];
    if (!sv) return fail('Gebäude nicht gefunden.');
    const group = sv.owner !== undefined ? services.map((x, i) => ({ x, i })).filter((p) => p.x.owner === sv.owner) : [{ x: sv, i: target.index }];
    parts = group.map((p) => ({ x: p.x.x, y: p.x.y, w: p.x.w, h: p.x.h, si: p.i }));
    label = sv.owner !== undefined ? 'Lufthafen-Komplex' : sv.name;
    if (op.type === 'rotate' && sv.owner !== undefined) return fail('Komplexe (Lufthafen mit Modulen) lassen sich nicht drehen.');
  }
  // Alte Fläche freimachen.
  for (const p of parts) for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) cell[(p.y + dy) * w + p.x + dx] = FREE;
  const housesBefore = s.houses.length;
  let next: Part[] = [];
  let turnsDelta = 0;
  if (op.type === 'move') next = parts.map((p) => ({ ...p, x: p.x + op.dx, y: p.y + op.dy }));
  else if (op.type === 'rotate') {
    // Um die Mitte drehen (Breite/Höhe tauschen), auf Kacheln gerundet.
    const p = parts[0];
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    next = [{ ...p, w: p.h, h: p.w, x: Math.round(cx - p.h / 2), y: Math.round(cy - p.w / 2) }];
    turnsDelta = 1;
  }
  const isTownHall = target.kind === 'townHall';
  // Kreisradien gleichartiger Gebäude dürfen sich nicht überlappen
  // (Mittelpunktabstand ≥ 2 × Radius; Rathaus 40, Handelskammer 30, Post 24).
  if (op.type !== 'remove' && next.length === 1) {
    const p = next[0];
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const others: Array<{ cx: number; cy: number }> = [];
    let radius = 0;
    if (isTownHall) {
      radius = 20;
      townHalls.forEach((t, i) => {
        if (i !== target.index) others.push({ cx: t.x + 2, cy: t.y + 2 });
      });
    } else {
      const sv = services[target.index];
      radius = lookup(sv.guid).radius ?? 0;
      services.forEach((o, i) => {
        if (i !== target.index && o.kind === sv.kind) others.push({ cx: o.x + o.w / 2, cy: o.y + o.h / 2 });
      });
    }
    if (radius && others.some((o) => Math.hypot(o.cx - cx, o.cy - cy) < 2 * radius - 1e-9)) {
      return fail(`Der Radius (${radius}) würde sich mit einem gleichartigen Gebäude überlappen.`);
    }
  }
  const roadsBefore = city.plan.networks;
  const own = new Set<number>();
  const coveredRoads: number[] = [];
  for (const p of next) {
    if (p.x < 0 || p.y < 0 || p.x + p.w > w || p.y + p.h > h) return fail('Außerhalb der Insel.');
    for (let dy = 0; dy < p.h; dy++) {
      for (let dx = 0; dx < p.w; dx++) {
        const i = (p.y + dy) * w + p.x + dx;
        const v = cell[i];
        if (v === WATER) return fail('Die Fläche liegt nicht ganz auf Land.');
        if (v === BLOCKED || v === SERVICE) return fail('Dort steht schon ein anderes Gebäude.');
        if (v === BRIDGE) return fail('Auf einer Brücke kann nicht gebaut werden.');
        if (v === ROAD) coveredRoads.push(i);
      }
    }
  }
  // Häuser unter der neuen Fläche weichen.
  const inNext = (x: number, y: number): boolean => next.some((p) => x >= p.x && y >= p.y && x < p.x + p.w && y < p.y + p.h);
  s.houses.forEach((hs, k) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) if (inNext(hs.x + dx, hs.y + dy)) own.add(k);
  });
  const freeHouse = (k: number): void => {
    const hs = s.houses[k];
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) cell[(hs.y + dy) * w + hs.x + dx] = FREE;
  };
  for (const k of own) freeHouse(k);
  const mark = isTownHall ? BLOCKED : SERVICE;
  for (const p of next) for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) cell[(p.y + dy) * w + p.x + dx] = mark;
  // Netz darf nicht zerfallen.
  if (coveredRoads.length) {
    const roads = new Uint8Array(w * h);
    const bridges: number[] = [];
    for (let i = 0; i < cell.length; i++) {
      if (cell[i] === ROAD) roads[i] = 1;
      else if (cell[i] === BRIDGE) bridges.push(i);
    }
    if (countNetworks(roads, w, bridges) > roadsBefore) return fail('Das würde das Straßennetz trennen.');
  }
  const ring = (p: Part): number[] => {
    const out: number[] = [];
    const add = (x: number, y: number): void => {
      if (x >= 0 && y >= 0 && x < w && y < h) out.push(y * w + x);
    };
    for (let d = 0; d < p.w; d++) {
      add(p.x + d, p.y - 1);
      add(p.x + d, p.y + p.h);
    }
    for (let d = 0; d < p.h; d++) {
      add(p.x - 1, p.y + d);
      add(p.x + p.w, p.y + d);
    }
    return out;
  };
  if (!isTownHall && next.length && !next.some((p) => ring(p).some((i) => cell[i] === ROAD))) {
    return fail('Das Gebäude hätte dort keinen Straßenanschluss.');
  }
  // Häuser ohne Anschluss entfernen, dann Lücken füllen.
  const orphans: number[] = [];
  s.houses.forEach((hs, k) => {
    if (!own.has(k) && !touchesRoad(s, hs.x, hs.y)) orphans.push(k);
  });
  for (const k of orphans) freeHouse(k);
  const gone = new Set([...own, ...orphans]);
  s.houses = s.houses.filter((_, k) => !gone.has(k));
  const kept = s.houses.length;
  greedyFill(s);
  const added = s.houses.length - kept;
  // Gebäude übernehmen.
  if (isTownHall) {
    if (op.type === 'remove') townHalls.splice(target.index, 1);
    else townHalls[target.index] = { x: next[0].x, y: next[0].y };
  } else if (op.type === 'remove') {
    const drop = new Set(parts.map((p) => p.si));
    for (let i = services.length - 1; i >= 0; i--) if (drop.has(i)) services.splice(i, 1);
  } else {
    next.forEach((p) => {
      const old = services[p.si];
      services[p.si] = { ...old, x: p.x, y: p.y, w: p.w, h: p.h, turns: (old.turns + turnsDelta) % 4 };
    });
  }
  const out = { ...stateToCity(s, city, townHalls), services };
  const removed = gone.size;
  const verb = op.type === 'move' ? 'verschoben' : op.type === 'rotate' ? 'gedreht' : 'entfernt';
  return {
    city: out,
    ok: true,
    message: `${label} ${verb}${removed ? ` · ${removed} Häuser weichen` : ''}${added ? ` · ${added} Häuser neu` : ''} (${s.houses.length - housesBefore >= 0 ? '+' : ''}${s.houses.length - housesBefore} Häuser)`,
    removedHouses: removed,
    addedHouses: added,
  };
}

/** Häuserspalten exakt neu belegen (fill.ts `realignLanes`), danach Lücken füllen. */
export function realignCity(mask: LandMask, city: CityPlan): { city: CityPlan; gained: number } {
  const s = cityToState(mask, city);
  const before = s.houses.length;
  realignLanes(s);
  greedyFill(s);
  return { city: { ...stateToCity(s, city, [...city.townHalls]), services: city.services }, gained: s.houses.length - before };
}

/**
 * Querstraßen ausdünnen und Reihen zusammenschieben (thin.ts), nachdem die
 * Versorgung steht. Danach Lücken füllen.
 */
export function thinCity(
  mask: LandMask,
  city: CityPlan,
  options: Omit<ThinOptions, 'townHalls'>,
): { city: CityPlan; report: ThinReport } {
  const s = cityToState(mask, city);
  const report = thinCrossRoads(s, city.services ?? [], { ...options, townHalls: city.townHalls });
  const before = s.houses.length;
  greedyFill(s);
  report.gained += s.houses.length - before;
  return { city: { ...stateToCity(s, city, [...city.townHalls]), services: city.services }, report };
}
