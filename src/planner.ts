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
import { FARMER_HOUSE, STREET_GUIDS } from './catalog';
import { BLOCKED, extendRoads, FREE, greedyFill, HOUSE, ROAD, WATER, type FillResult, type FillState } from './fill';
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
}

/** Abzug je verdrängtem Haus in „abgedeckten Häusern“. */
export const HOUSE_PENALTY = 6;

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
  for (let i = 0; i < allowed.length; i++) allowed[i] = mask.data[i] && !plan.roads[i] ? 1 : 0;
  return {
    target: { w, h, data: centers, landCount: plan.houses.length },
    allowed,
    penalty: { ids, weight: HOUSE_PENALTY },
  };
}

export interface CityPlan {
  plan: GridPlan;
  townHalls: Array<{ x: number; y: number }>;
  houses: PlannedHouse[];
  removedHouses: number;
  droppedTownHalls: number;
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
  const covers = (t: { x: number; y: number }, list: readonly PlannedHouse[]): number =>
    list.filter((hs) => Math.hypot(hs.x + 1 - (t.x + 1.5), hs.y + 1 - (t.y + 1.5)) <= 20 + 1e-9).length;
  const overlaps = (t: { x: number; y: number }, hs: PlannedHouse): boolean =>
    hs.x < t.x + 4 && hs.x + 3 > t.x && hs.y < t.y + 4 && hs.y + 3 > t.y;

  let kept = [...townHalls];
  let houses = [...plan.houses];
  // Wiederholen, bis jedes Rathaus nach dem Entfernen genug Häuser abdeckt.
  for (let round = 0; round < 5; round++) {
    houses = plan.houses.filter((hs) => !kept.some((t) => overlaps(t, hs)));
    const next = kept.filter((t) => covers(t, houses) >= minCovered);
    if (next.length === kept.length) break;
    kept = next;
  }
  houses = plan.houses.filter((hs) => !kept.some((t) => overlaps(t, hs)));
  return {
    plan,
    townHalls: kept,
    houses,
    removedHouses: plan.houses.length - houses.length,
    droppedTownHalls: townHalls.length - kept.length,
  };
}

export interface PlanStampOptions {
  coast: boolean;
  coastGuid: number;
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
  const streets: StampStreet[] = [];
  for (let i = 0; i < city.plan.roads.length; i++) {
    if (!city.plan.roads[i] || occupied[i]) continue;
    streets.push({ x: i % w, y: Math.floor(i / w), guid: STREET_GUIDS.paved });
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
  for (const b of items.buildings) get(b.y).buildings.push(b);
  for (const s of items.streets) get(s.y).streets.push(s);
  return [...bands.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

// ---------------------------------------------------------------------------
// Vollständige Bebauung (fill.ts) als Plan
// ---------------------------------------------------------------------------

function countNetworks(roads: Uint8Array, w: number): number {
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
  let roadCount = 0;
  for (let i = 0; i < roads.length; i++) {
    if (r.cell[i] === ROAD) {
      roads[i] = 1;
      roadCount++;
    }
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
    networks: countNetworks(roads, r.w),
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
  let free = 0;
  for (let i = 0; i < used.length; i++) if (mask.data[i] && !used[i]) free++;
  return free;
}

/** Nach dem Setzen der Rathäuser die Lücken wieder mit Häusern füllen. */
export function refillAroundTownHalls(mask: LandMask, city: CityPlan): CityPlan & { refilled: number } {
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
  const before = s.houses.length;
  greedyFill(s);
  extendRoads(s);
  const roads = new Uint8Array(w * h);
  let roadCount = 0;
  for (let i = 0; i < roads.length; i++) {
    if (cell[i] === ROAD) {
      roads[i] = 1;
      roadCount++;
    }
  }
  const houses = s.houses.map((hs) => ({ x: hs.x, y: hs.y, line: hs.line, group: -1 }));
  return {
    ...city,
    plan: { ...city.plan, roads, roadCount, networks: countNetworks(roads, w), houses },
    houses,
    refilled: s.houses.length - before,
  };
}
