// Nachverdichtung („zerstören und neu aufbauen“): Nach dem Rasterfüllen bleibt
// Platz neben Rathäusern und an Rändern ungenutzt, weil das starre 3er-Raster
// nicht passt. Hier wird lokal umgebaut:
//
// 1. Fenster (≈ 12–16 Kacheln) um jede Restfläche und um jedes Rathaus.
// 2. Alle Häuser, die ganz im Fenster liegen, werden entfernt und das Fenster
//    neu belegt – beste von vielen gierigen Reihenfolgen, Häuser dürfen frei
//    (außerhalb des Rasters) liegen, optional mit einer zusätzlichen
//    Straßenkachel am bestehenden Netz.
// 3. Liegt ein Rathaus im Fenster, werden Verschiebungen um bis zu 3 Kacheln
//    probiert (Abstand ≥ 40 zu anderen Rathäusern bleibt gewahrt).
// 4. Übernommen wird nur, was mehr Wert bringt: Häuser × 225 + Häuser im
//    Rathausradius × 31 (≈ Einwohner je Hochhaus bzw. Item-Bonus).
// Straßen werden nie entfernt (außer ungenutzte Sackgassen am Ende), damit
// Häuser außerhalb des Fensters ihren Anschluss behalten.

import {
  BLOCKED,
  FREE,
  ROAD,
  HOUSE,
  SERVICE,
  isWay,
  footprintFree,
  labelComponents,
  pruneRoads,
  replaceRoadStubs,
  snugness,
  touchesRoad,
  type FillHouse,
  type FillState,
} from './fill';

export interface TownHallPos {
  x: number;
  y: number;
}

export interface CompactOptions {
  deadline: number;
  seed?: number;
  /** Einwohnerwert je Haus und je Haus im Rathausradius (Item-Bonus). */
  houseValue?: number;
  coverValue?: number;
  onProgress?: (gained: number) => void;
}

export interface CompactResult {
  gained: number;
  windows: number;
  improvements: number;
  townHallsMoved: number;
}

interface Window {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wie weit ein Rathaus je Schritt verschoben werden darf (Kacheln). */
const MOVE = 6;

/** Trennt das Wegnehmen der Straßenkacheln `tiles` (bereits entfernt) das Netz? */
function separatesRoads(s: FillState, tiles: number[]): boolean {
  const { w, h, cell } = s;
  const removed = new Set(tiles);
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
  for (const t of tiles) for (const n of neighbours(t)) if (isWay(cell[n]) && !removed.has(n)) ends.add(n);
  if (ends.size <= 1) return false;
  const list = [...ends];
  const seen = new Set<number>([list[0]]);
  const queue = [list[0]];
  let found = 1;
  for (let q = 0; q < queue.length; q++) {
    for (const n of neighbours(queue[q])) {
      if (!isWay(cell[n]) || seen.has(n)) continue;
      seen.add(n);
      if (ends.has(n) && ++found === ends.size) return false;
      queue.push(n);
    }
  }
  return true;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function compact(s: FillState, townHalls: TownHallPos[], options: CompactOptions): CompactResult {
  const { w, h, cell } = s;
  const rnd = mulberry32(options.seed ?? 99);
  const HV = options.houseValue ?? 225;
  const CV = options.coverValue ?? 31;
  const result: CompactResult = { gained: 0, windows: 0, improvements: 0, townHallsMoved: 0 };
  let effortScale = 1;

  const rhCenter = (t: TownHallPos): [number, number] => [t.x + 1.5, t.y + 1.5];
  const covers = (t: TownHallPos, hs: { x: number; y: number }): boolean => {
    const [cx, cy] = rhCenter(t);
    return Math.hypot(hs.x + 1 - cx, hs.y + 1 - cy) <= 20 + 1e-9;
  };
  const coveredByAny = (hs: { x: number; y: number }): boolean => townHalls.some((t) => covers(t, hs));

  const setRect = (x: number, y: number, size: number, v: number): void => {
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) cell[(y + dy) * w + x + dx] = v;
  };

  /** Beste Belegung freier Plätze im Fenster (viele gierige Reihenfolgen). */
  const bestPacking = (win: Window, tries: number): Array<[number, number]> => {
    const positions: Array<[number, number, number]> = [];
    for (let y = win.y0; y + 3 <= win.y1; y++) {
      for (let x = win.x0; x + 3 <= win.x1; x++) {
        if (footprintFree(s, x, y) && touchesRoad(s, x, y)) positions.push([x, y, snugness(s, x, y)]);
      }
    }
    if (!positions.length) return [];
    let best: Array<[number, number]> = [];
    const overlaps = (a: [number, number], b: [number, number]): boolean =>
      Math.abs(a[0] - b[0]) < 3 && Math.abs(a[1] - b[1]) < 3;
    for (let t = 0; t < tries; t++) {
      let order: Array<[number, number, number]>;
      if (t === 0) order = [...positions].sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0]);
      else if (t === 1) order = [...positions].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      else if (t === 2) order = [...positions].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      else if (t === 3) order = [...positions].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
      else if (t === 4) order = [...positions].sort((a, b) => b[0] - a[0] || b[1] - a[1]);
      else order = positions.map((p) => [p[0], p[1], p[2] + rnd() * 6] as [number, number, number]).sort((a, b) => b[2] - a[2]);
      const chosen: Array<[number, number]> = [];
      for (const p of order) {
        const q: [number, number] = [p[0], p[1]];
        if (!chosen.some((c) => overlaps(c, q))) chosen.push(q);
      }
      if (chosen.length > best.length) best = chosen;
    }
    return best;
  };

  /** Wert der Häuser im Fenster: Häuser × HV + abgedeckte × CV. */
  const valueOf = (list: ReadonlyArray<{ x: number; y: number }>): number =>
    list.reduce((sum, hs) => sum + HV + (coveredByAny(hs) ? CV : 0), 0);

  const tryWindow = (win: Window): void => {
    result.windows++;
    const inside = (hs: FillHouse): boolean => hs.x >= win.x0 && hs.y >= win.y0 && hs.x + 3 <= win.x1 && hs.y + 3 <= win.y1;
    const removed = s.houses.filter(inside);
    const keep = s.houses.filter((hs) => !inside(hs));
    for (const hs of removed) setRect(hs.x, hs.y, 3, FREE);
    const oldValue = valueOf(removed);

    let bestValue = oldValue;
    let bestHouses: Array<[number, number]> | null = null;
    let bestRoad = -1;
    let bestRh: { index: number; x: number; y: number } | null = null;
    const val = (list: Array<[number, number]>): number =>
      list.reduce((sum, [x, y]) => sum + HV + (coveredByAny({ x, y }) ? CV : 0), 0);

    const evaluate = (rh: { index: number; x: number; y: number } | null, outsideDelta: number, effort: number): void => {
      const consider = (pack: Array<[number, number]>, road: number): void => {
        const v = val(pack) + outsideDelta;
        if (v > bestValue + 1e-9) {
          bestValue = v;
          bestHouses = pack;
          bestRoad = road;
          bestRh = rh;
        }
      };
      consider(bestPacking(win, (6 + 18 * effort) * effortScale), -1);
      // Mit einer zusätzlichen Straßenkachel am Netz
      const roadCands: number[] = [];
      for (let y = win.y0; y < win.y1; y++) {
        for (let x = win.x0; x < win.x1; x++) {
          const i = y * w + x;
          if (cell[i] !== FREE) continue;
          if (
            (x > 0 && cell[i - 1] === ROAD) ||
            (x < w - 1 && cell[i + 1] === ROAD) ||
            (y > 0 && cell[i - w] === ROAD) ||
            (y < h - 1 && cell[i + w] === ROAD)
          ) {
            roadCands.push(i);
          }
        }
      }
      for (let k = roadCands.length - 1; k > 0; k--) {
        const j = Math.floor(rnd() * (k + 1));
        [roadCands[k], roadCands[j]] = [roadCands[j], roadCands[k]];
      }
      for (const i of roadCands.slice(0, (3 + 9 * effort) * effortScale)) {
        cell[i] = ROAD;
        const pack = bestPacking(win, (4 + 6 * effort) * effortScale);
        cell[i] = FREE;
        consider(pack, i);
      }
    };

    evaluate(null, 0, 1);

    // Rathäuser ganz im Fenster: verschieben probieren.
    townHalls.forEach((t, ti) => {
      if (t.x < win.x0 || t.y < win.y0 || t.x + 4 > win.x1 || t.y + 4 > win.y1) return;
      const ox = t.x;
      const oy = t.y;
      const near = keep.filter((hs) => Math.abs(hs.x - ox) < 28 && Math.abs(hs.y - oy) < 28);
      const coveredNear = (): number => near.reduce((n, hs) => n + (coveredByAny(hs) ? 1 : 0), 0);
      const before = coveredNear();
      setRect(ox, oy, 4, FREE);
      const saved = new Uint8Array(16);
      for (let dy = -MOVE; dy <= MOVE; dy++) {
        for (let dx = -MOVE; dx <= MOVE; dx++) {
          if (!dx && !dy) continue;
          const nx = ox + dx;
          const ny = oy + dy;
          if (nx < win.x0 || ny < win.y0 || nx + 4 > win.x1 || ny + 4 > win.y1) continue;
          let free = true;
          const roadTiles: number[] = [];
          for (let yy = 0; yy < 4 && free; yy++) {
            for (let xx = 0; xx < 4; xx++) {
              const i = (ny + yy) * w + nx + xx;
              if (cell[i] === ROAD) {
                // Keine Straße wegnehmen, an der ein Versorgungsgebäude hängt.
                if (cell[i - 1] === SERVICE || cell[i + 1] === SERVICE || cell[i - w] === SERVICE || cell[i + w] === SERVICE) {
                  free = false;
                }
                roadTiles.push(i);
              }
              else if (cell[i] !== FREE) free = false;
            }
          }
          if (!free) continue;
          const ok = townHalls.every((o, oi) => oi === ti || Math.hypot(o.x - nx, o.y - ny) >= 40 - 1e-9);
          if (!ok) continue;
          for (let k = 0; k < 16; k++) saved[k] = cell[(ny + (k >> 2)) * w + nx + (k & 3)];
          setRect(nx, ny, 4, BLOCKED);
          // Auf einer Straße nur, wenn das Netz zusammenhängt und alle Häuser angeschlossen bleiben.
          if (roadTiles.length && (separatesRoads(s, roadTiles) || near.some((hs) => !touchesRoad(s, hs.x, hs.y)))) {
            for (let k = 0; k < 16; k++) cell[(ny + (k >> 2)) * w + nx + (k & 3)] = saved[k];
            continue;
          }
          townHalls[ti] = { x: nx, y: ny };
          // Abdeckung ändert sich auch für Häuser außerhalb des Fensters.
          const outsideDelta = (coveredNear() - before) * CV;
          evaluate({ index: ti, x: nx, y: ny }, outsideDelta, 0);
          for (let k = 0; k < 16; k++) cell[(ny + (k >> 2)) * w + nx + (k & 3)] = saved[k];
          townHalls[ti] = { x: ox, y: oy };
        }
      }
      setRect(ox, oy, 4, BLOCKED);
    });

    if (bestHouses === null) {
      for (const hs of removed) setRect(hs.x, hs.y, 3, HOUSE);
      return;
    }
    // Übernehmen
    const chosenRh = bestRh as { index: number; x: number; y: number } | null;
    if (chosenRh) {
      const t = townHalls[chosenRh.index];
      setRect(t.x, t.y, 4, FREE);
      townHalls[chosenRh.index] = { x: chosenRh.x, y: chosenRh.y };
      setRect(chosenRh.x, chosenRh.y, 4, BLOCKED);
      result.townHallsMoved++;
    }
    if (bestRoad >= 0) cell[bestRoad] = ROAD;
    const newHouses: FillHouse[] = [];
    for (const [x, y] of bestHouses as Array<[number, number]>) {
      if (!footprintFree(s, x, y) || !touchesRoad(s, x, y)) continue;
      setRect(x, y, 3, HOUSE);
      newHouses.push({ x, y, line: -1 });
    }
    s.houses = [...keep, ...newHouses];
    result.gained += newHouses.length - removed.length;
    result.improvements++;
  };

  // Fenster: Restflächen und Rathäuser zuerst, danach zufällige Fenster.
  const windows: Window[] = [];
  const clamp = (x0: number, y0: number, x1: number, y1: number): Window => ({
    x0: Math.max(0, x0),
    y0: Math.max(0, y0),
    x1: Math.min(w, x1),
    y1: Math.min(h, y1),
  });
  const buildWindows = (): void => {
    windows.length = 0;
    for (const t of townHalls) windows.push(clamp(t.x - MOVE - 3, t.y - MOVE - 3, t.x + MOVE + 7, t.y + MOVE + 7));
    const label = labelComponents(w, h, (i) => cell[i] === FREE);
    const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number; n: number }>();
    for (let i = 0; i < cell.length; i++) {
      const l = label[i];
      if (l < 0) continue;
      const x = i % w;
      const y = (i - x) / w;
      const b = boxes.get(l);
      if (!b) boxes.set(l, { x0: x, y0: y, x1: x + 1, y1: y + 1, n: 1 });
      else {
        b.x0 = Math.min(b.x0, x);
        b.y0 = Math.min(b.y0, y);
        b.x1 = Math.max(b.x1, x + 1);
        b.y1 = Math.max(b.y1, y + 1);
        b.n++;
      }
    }
    const list = [...boxes.values()].filter((b) => b.n >= 3).sort((a, b) => b.n - a.n);
    for (const b of list) {
      for (let y = b.y0; y < b.y1; y += 10) {
        for (let x = b.x0; x < b.x1; x += 10) windows.push(clamp(x - 5, y - 5, x + 11, y + 11));
      }
    }
  };

  // Durchläufe: gezielte Fenster (Rathäuser, Restflächen) und zufällige Fenster
  // verschiedener Größe. Bringt ein Durchlauf nichts, wird die Suche je Fenster
  // gründlicher (mehr Reihenfolgen, mehr Straßenversuche), bis Stufe 4.
  let level = 1;
  let windowsTried = 0;
  while (now() < options.deadline && level <= 4) {
    buildWindows();
    for (let k = 0; k < 150 * level; k++) {
      const x = Math.floor(rnd() * w);
      const y = Math.floor(rnd() * h);
      const r = 5 + Math.floor(rnd() * 5);
      windows.push(clamp(x - r, y - r, x + r + 1, y + r + 1));
    }
    const improvementsBefore = result.improvements;
    for (const win of windows) {
      if (now() >= options.deadline) break;
      tryWindow(win);
      if (++windowsTried % 50 === 0) options.onProgress?.(result.gained);
    }
    options.onProgress?.(result.gained);
    if (result.improvements === improvementsBefore) {
      level++;
      effortScale = level;
    }
  }
  result.gained += replaceRoadStubs(s);
  pruneRoads(s);
  return result;
}
