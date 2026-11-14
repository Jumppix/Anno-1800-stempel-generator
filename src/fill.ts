// Vollständige Bebauung: Die gesamte Landfläche wird mit Wohnhäusern (3×3)
// und den nötigen Straßen gefüllt – bis zur letzten Kachel.
//
// 1. Gitter: Das 8er-Raster (Straßen auf Gitterlinien, Häuser auf festen
//    Plätzen je Zelle) wird über die ganze Insel gelegt. Jeder Hausplatz mit
//    Fläche auf Land wird genutzt, auch in angeschnittenen Zellen am Rand.
//    Je Landstück bleibt das größte zusammenhängende Straßennetz; Häuser ohne
//    Anschluss daran fallen weg, ungenutzte Straßenenden werden abgebaut.
// 2. Gieriges Füllen: freie 3×3-Plätze, die eine Straße berühren, werden
//    belegt – passgenaue Plätze (viele belegte Nachbarkacheln) zuerst.
// 3. Straßen verlängern: Wo eine oder zwei neue Straßenkacheln am Netz
//    weitere Häuser anschließen, werden sie gebaut; danach wieder füllen.
// Die Gitterlage (Ausrichtung, Verschiebung) wird nach der Gesamtzahl der
// Häuser nach Schritt 3 ausgewählt.

import type { LandMask } from './solver';

export type Orientation = 'vertical' | 'horizontal';

export const WATER = 0;
export const FREE = 1;
export const ROAD = 2;
export const HOUSE = 3;
export const BLOCKED = 4;

export interface FillHouse {
  x: number;
  y: number;
  /** Linie im Gitter (0/1) oder −1 für frei gesetzte Häuser. */
  line: number;
}

export interface FillState {
  w: number;
  h: number;
  /** Je Kachel: 0 Wasser, 1 frei, 2 Straße, 3 Haus, 4 belegt (anderes Gebäude). */
  cell: Uint8Array;
  houses: FillHouse[];
}

export interface FillResult extends FillState {
  orientation: Orientation;
  ox: number;
  oy: number;
  housesPerLine: number;
  latticeHouses: number;
  extraHouses: number;
  extraRoads: number;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function footprintFree(s: FillState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x + 3 > s.w || y + 3 > s.h) return false;
  for (let dy = 0; dy < 3; dy++) {
    const row = (y + dy) * s.w + x;
    for (let dx = 0; dx < 3; dx++) if (s.cell[row + dx] !== FREE) return false;
  }
  return true;
}

/** Berührt die 3×3-Fläche eine Straße (seitlich, nicht diagonal)? */
function touchesRoad(s: FillState, x: number, y: number): boolean {
  const { w, h, cell } = s;
  for (let d = 0; d < 3; d++) {
    if (y > 0 && cell[(y - 1) * w + x + d] === ROAD) return true;
    if (y + 3 < h && cell[(y + 3) * w + x + d] === ROAD) return true;
    if (x > 0 && cell[(y + d) * w + x - 1] === ROAD) return true;
    if (x + 3 < w && cell[(y + d) * w + x + 3] === ROAD) return true;
  }
  return false;
}

/** Passgenauigkeit: belegte/ungeeignete Kacheln im Ring um die Fläche. */
function snugness(s: FillState, x: number, y: number): number {
  const { w, h, cell } = s;
  let n = 0;
  for (let dx = -1; dx <= 3; dx++) {
    for (const dy of [-1, 3]) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || cell[yy * w + xx] !== FREE) n++;
    }
  }
  for (let dy = 0; dy < 3; dy++) {
    for (const dx of [-1, 3]) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || cell[yy * w + xx] !== FREE) n++;
    }
  }
  return n;
}

function placeHouse(s: FillState, x: number, y: number, line: number): void {
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) s.cell[(y + dy) * s.w + x + dx] = HOUSE;
  s.houses.push({ x, y, line });
}

/** Gieriges Füllen aller freien Plätze mit Straßenanschluss. Liefert Anzahl neuer Häuser. */
export function greedyFill(s: FillState): number {
  let added = 0;
  for (;;) {
    const cand: Array<[number, number, number]> = [];
    for (let y = 0; y + 3 <= s.h; y++) {
      for (let x = 0; x + 3 <= s.w; x++) {
        if (footprintFree(s, x, y) && touchesRoad(s, x, y)) cand.push([x, y, snugness(s, x, y)]);
      }
    }
    if (!cand.length) break;
    cand.sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0]);
    let round = 0;
    for (const [x, y] of cand) {
      if (footprintFree(s, x, y) && touchesRoad(s, x, y)) {
        placeHouse(s, x, y, -1);
        round++;
      }
    }
    added += round;
    if (!round) break;
  }
  return added;
}

/** Häuser, die durch eine neue Straßenkachel auf (tx, ty) anschließbar würden. */
function gainOfRoad(s: FillState, tx: number, ty: number): number {
  let gain = 0;
  // Plätze, deren Fläche seitlich an (tx, ty) grenzt.
  for (let y = ty - 3; y <= ty + 1; y++) {
    for (let x = tx - 3; x <= tx + 1; x++) {
      const besideX = (tx === x - 1 || tx === x + 3) && ty >= y && ty < y + 3;
      const besideY = (ty === y - 1 || ty === y + 3) && tx >= x && tx < x + 3;
      if (!besideX && !besideY) continue;
      if (footprintFree(s, x, y) && !touchesRoad(s, x, y)) gain++;
    }
  }
  return gain;
}

function adjacentToRoad(s: FillState, i: number): boolean {
  const { w, h, cell } = s;
  const x = i % w;
  const y = (i - x) / w;
  return (
    (x > 0 && cell[i - 1] === ROAD) ||
    (x < w - 1 && cell[i + 1] === ROAD) ||
    (y > 0 && cell[i - w] === ROAD) ||
    (y < h - 1 && cell[i + w] === ROAD)
  );
}

/**
 * Straßen um eine oder zwei Kacheln verlängern, wo das neue Häuser anschließt,
 * und danach wieder füllen – bis nichts mehr geht. Liefert neue Straßenkacheln.
 */
export function extendRoads(s: FillState): number {
  const { w, h, cell } = s;
  let roads = 0;
  for (let guard = 0; guard < 5000; guard++) {
    let best = -1;
    let bestGain = 0;
    let bestSecond = -1;
    for (let i = 0; i < cell.length; i++) {
      if (cell[i] !== FREE || !adjacentToRoad(s, i)) continue;
      const x = i % w;
      const y = (i - x) / w;
      const g = gainOfRoad(s, x, y);
      if (g > bestGain) {
        bestGain = g;
        best = i;
        bestSecond = -1;
      }
    }
    if (best < 0) {
      // Zwei Kacheln: erste am Netz, zweite daneben.
      let bestPair = 0;
      for (let i = 0; i < cell.length; i++) {
        if (cell[i] !== FREE || !adjacentToRoad(s, i)) continue;
        cell[i] = ROAD;
        const x = i % w;
        const y = (i - x) / w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j < 0 || cell[j] !== FREE) continue;
          const g = gainOfRoad(s, j % w, Math.floor(j / w));
          if (g > bestPair) {
            bestPair = g;
            best = i;
            bestSecond = j;
          }
        }
        cell[i] = FREE;
      }
      if (best < 0) break;
    }
    cell[best] = ROAD;
    roads++;
    if (bestSecond >= 0) {
      cell[bestSecond] = ROAD;
      roads++;
    }
    greedyFill(s);
  }
  // Straßenkacheln, die an keinem Haus liegen und Sackgassen sind, wieder abbauen.
  roads -= pruneRoads(s);
  return roads;
}

/** Sackgassen ohne angrenzendes Haus iterativ entfernen. Liefert entfernte Kacheln. */
export function pruneRoads(s: FillState): number {
  const { w, h, cell } = s;
  const nearHouse = (i: number): boolean => {
    const x = i % w;
    const y = (i - x) / w;
    return (
      (x > 0 && cell[i - 1] === HOUSE) ||
      (x < w - 1 && cell[i + 1] === HOUSE) ||
      (y > 0 && cell[i - w] === HOUSE) ||
      (y < h - 1 && cell[i + w] === HOUSE)
    );
  };
  const degree = (i: number): number => {
    const x = i % w;
    const y = (i - x) / w;
    let d = 0;
    if (x > 0 && cell[i - 1] === ROAD) d++;
    if (x < w - 1 && cell[i + 1] === ROAD) d++;
    if (y > 0 && cell[i - w] === ROAD) d++;
    if (y < h - 1 && cell[i + w] === ROAD) d++;
    return d;
  };
  let removed = 0;
  const queue: number[] = [];
  for (let i = 0; i < cell.length; i++) if (cell[i] === ROAD) queue.push(i);
  while (queue.length) {
    const i = queue.pop() as number;
    if (cell[i] !== ROAD || nearHouse(i) || degree(i) > 1) continue;
    cell[i] = FREE;
    removed++;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) queue.push(i - 1);
    if (x < w - 1) queue.push(i + 1);
    if (y > 0) queue.push(i - w);
    if (y < h - 1) queue.push(i + w);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Gitter
// ---------------------------------------------------------------------------

function labelComponents(w: number, h: number, inSet: (i: number) => boolean): Int32Array {
  const label = new Int32Array(w * h).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (label[i] >= 0 || !inSet(i)) continue;
    label[i] = next;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop() as number;
      const x = j % w;
      const y = (j - x) / w;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) {
        if (k >= 0 && label[k] < 0 && inSet(k)) {
          label[k] = next;
          stack.push(k);
        }
      }
    }
    next++;
  }
  return label;
}

/** Gitter mit Hausplätzen über die ganze Insel legen (Schritt 1). */
export function latticeFill(
  mask: LandMask,
  orientation: Orientation,
  housesPerLine: number,
  ox: number,
  oy: number,
  blocked?: Uint8Array,
): FillState {
  const { w, h, data } = mask;
  const n = housesPerLine;
  const gw = orientation === 'vertical' ? 6 : 3 * n;
  const gh = orientation === 'vertical' ? 3 * n : 6;
  const px = gw + 1;
  const py = gh + 1;
  const cell = new Uint8Array(w * h);
  for (let i = 0; i < cell.length; i++) cell[i] = data[i] ? (blocked?.[i] ? BLOCKED : FREE) : WATER;
  const s: FillState = { w, h, cell, houses: [] };

  // Straßen auf den Gitterlinien (nur auf freiem Land).
  const mod = (a: number, m: number): number => ((a % m) + m) % m;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cell[i] === FREE && (mod(x - ox, px) === 0 || mod(y - oy, py) === 0)) cell[i] = ROAD;
    }
  }

  // Je Landstück nur das größte Straßennetz behalten.
  const land = labelComponents(w, h, (i) => cell[i] !== WATER);
  const roadLabel = labelComponents(w, h, (i) => cell[i] === ROAD);
  const sizeByRoad = new Map<number, number>();
  for (let i = 0; i < cell.length; i++) {
    if (roadLabel[i] >= 0) sizeByRoad.set(roadLabel[i], (sizeByRoad.get(roadLabel[i]) ?? 0) + 1);
  }
  const bestByLand = new Map<number, number>();
  for (let i = 0; i < cell.length; i++) {
    const r = roadLabel[i];
    if (r < 0) continue;
    const l = land[i];
    const cur = bestByLand.get(l);
    if (cur === undefined || (sizeByRoad.get(r) ?? 0) > (sizeByRoad.get(cur) ?? 0)) bestByLand.set(l, r);
  }
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] === ROAD && bestByLand.get(land[i]) !== roadLabel[i]) cell[i] = FREE;
  }

  // Feste Hausplätze je Zelle, auch in angeschnittenen Zellen.
  for (let ry = mod(oy, py) - py; ry < h; ry += py) {
    for (let rx = mod(ox, px) - px; rx < w; rx += px) {
      const a = orientation === 'vertical' ? 2 : n;
      const b = orientation === 'vertical' ? n : 2;
      for (let c = 0; c < a; c++) {
        for (let r = 0; r < b; r++) {
          const x = rx + 1 + c * 3;
          const y = ry + 1 + r * 3;
          if (footprintFree(s, x, y) && touchesRoad(s, x, y)) {
            placeHouse(s, x, y, orientation === 'vertical' ? c : r);
          }
        }
      }
    }
  }
  pruneRoads(s);
  return s;
}

/** Kompletter Ablauf für eine Gitterlage: Gitter, Füllen, Straßen verlängern. */
export function fillWithLattice(
  mask: LandMask,
  orientation: Orientation,
  housesPerLine: number,
  ox: number,
  oy: number,
  blocked?: Uint8Array,
): FillResult {
  const s = latticeFill(mask, orientation, housesPerLine, ox, oy, blocked);
  const latticeHouses = s.houses.length;
  greedyFill(s);
  const extraRoads = extendRoads(s);
  return {
    ...s,
    orientation,
    ox,
    oy,
    housesPerLine,
    latticeHouses,
    extraHouses: s.houses.length - latticeHouses,
    extraRoads,
  };
}

/**
 * Beste Gitterlage suchen: grob alle Verschiebungen nur mit Gitter + Füllen
 * bewerten, die besten vollständig (inkl. Straßenverlängerung) rechnen.
 */
export function searchFill(
  mask: LandMask,
  options: { orientation: 'auto' | Orientation; housesPerLine: number; deadline?: number },
  onProgress?: (best: FillResult, done: number, total: number) => void,
): FillResult {
  const n = Math.max(1, Math.round(options.housesPerLine));
  const orientations: Orientation[] =
    options.orientation === 'auto' ? ['vertical', 'horizontal'] : [options.orientation];
  const coarse: Array<{ o: Orientation; ox: number; oy: number; score: number }> = [];
  for (const o of orientations) {
    const px = (o === 'vertical' ? 6 : 3 * n) + 1;
    const py = (o === 'vertical' ? 3 * n : 6) + 1;
    for (let ox = 0; ox < px; ox++) {
      for (let oy = 0; oy < py; oy++) {
        const s = latticeFill(mask, o, n, ox, oy);
        greedyFill(s);
        coarse.push({ o, ox, oy, score: s.houses.length });
      }
    }
  }
  coarse.sort((a, b) => b.score - a.score);
  const finalists = coarse.slice(0, Math.min(6, coarse.length));
  let best: FillResult | null = null;
  finalists.forEach((c, i) => {
    if (best && options.deadline && Date.now() > options.deadline) return;
    const r = fillWithLattice(mask, c.o, n, c.ox, c.oy);
    if (!best || r.houses.length > best.houses.length) best = r;
    onProgress?.(best, i + 1, finalists.length);
  });
  return best as unknown as FillResult;
}
