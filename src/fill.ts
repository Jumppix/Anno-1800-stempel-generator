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
/** Versorgungsgebäude (wie BLOCKED, braucht aber Straßenanschluss). */
export const SERVICE = 5;
/** Brücke: Straße über Wasser (zählt für Wege, ist aber kein Bauplatz). */
export const BRIDGE = 6;

/** Straße oder Brücke (für Wege und Zusammenhang des Netzes). */
export const isWay = (v: number): boolean => v === ROAD || v === BRIDGE;

/** Grenzt Kachel i an eine Brücke (Brückenkopf)? Solche Straßen bleiben immer stehen. */
export function touchesBridge(cell: Uint8Array, w: number, i: number): boolean {
  const x = i % w;
  return (
    (x > 0 && cell[i - 1] === BRIDGE) ||
    (x < w - 1 && cell[i + 1] === BRIDGE) ||
    (i >= w && cell[i - w] === BRIDGE) ||
    (i + w < cell.length && cell[i + w] === BRIDGE)
  );
}

export interface FillHouse {
  x: number;
  y: number;
  /** Linie im Gitter (0/1) oder −1 für frei gesetzte Häuser. */
  line: number;
}

export interface FillState {
  w: number;
  h: number;
  /** Je Kachel: 0 Wasser, 1 frei, 2 Straße, 3 Haus, 4 belegt (Rathaus), 5 Versorgungsgebäude. */
  cell: Uint8Array;
  houses: FillHouse[];
}

export interface FillResult extends FillState {
  orientation: Orientation;
  ox: number;
  oy: number;
  housesPerLine: number;
  /** Verschiebung der Längsstraßen je Band (0…6), leer = keine. */
  shifts: number[];
  latticeHouses: number;
  extraHouses: number;
  extraRoads: number;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

export function footprintFree(s: FillState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x + 3 > s.w || y + 3 > s.h) return false;
  for (let dy = 0; dy < 3; dy++) {
    const row = (y + dy) * s.w + x;
    for (let dx = 0; dx < 3; dx++) if (s.cell[row + dx] !== FREE) return false;
  }
  return true;
}

/** Berührt die 3×3-Fläche eine Straße (seitlich, nicht diagonal)? */
export function touchesRoad(s: FillState, x: number, y: number): boolean {
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
export function snugness(s: FillState, x: number, y: number): number {
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

export function placeHouse(s: FillState, x: number, y: number, line: number): void {
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
export function gainOfRoad(s: FillState, tx: number, ty: number): number {
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

export function adjacentToRoad(s: FillState, i: number): boolean {
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
    const needs = (v: number): boolean => v === HOUSE || v === SERVICE || v === BRIDGE;
    return (
      (x > 0 && needs(cell[i - 1])) ||
      (x < w - 1 && needs(cell[i + 1])) ||
      (y > 0 && needs(cell[i - w])) ||
      (y < h - 1 && needs(cell[i + w]))
    );
  };
  const degree = (i: number): number => {
    const x = i % w;
    const y = (i - x) / w;
    let d = 0;
    if (x > 0 && isWay(cell[i - 1])) d++;
    if (x < w - 1 && isWay(cell[i + 1])) d++;
    if (y > 0 && isWay(cell[i - w])) d++;
    if (y < h - 1 && isWay(cell[i + w])) d++;
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

export function labelComponents(w: number, h: number, inSet: (i: number) => boolean): Int32Array {
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

/**
 * Gitter mit Hausplätzen über die ganze Insel legen (Schritt 1).
 *
 * Senkrechte Gruppen: Querstraßen (waagerecht) bei y ≡ oy (mod py) trennen
 * Bänder; in jedem Band liegen die Längsstraßen bei x ≡ ox + shift[Band]
 * (mod px). Die Bänder dürfen also gegeneinander verschoben sein – nur die
 * Querstraßen verbinden sie. Waagerechte Gruppen: dasselbe mit x/y vertauscht.
 */
export function latticeFill(
  mask: LandMask,
  orientation: Orientation,
  housesPerLine: number,
  ox: number,
  oy: number,
  blocked?: Uint8Array,
  shifts?: ReadonlyArray<number>,
): FillState {
  const { w, h, data } = mask;
  const n = housesPerLine;
  const vertical = orientation === 'vertical';
  const gw = vertical ? 6 : 3 * n;
  const gh = vertical ? 3 * n : 6;
  const px = gw + 1;
  const py = gh + 1;
  const cell = new Uint8Array(w * h);
  for (let i = 0; i < cell.length; i++) cell[i] = data[i] ? (blocked?.[i] ? BLOCKED : FREE) : WATER;
  const s: FillState = { w, h, cell, houses: [] };
  const mod = (a: number, m: number): number => ((a % m) + m) % m;
  // Bandrichtung: senkrecht → Bänder übereinander (Koordinate y, Periode py),
  // Querstraßen-Koordinate in Band: x (Periode px). Waagerecht vertauscht.
  const bandPeriod = vertical ? py : px;
  const bandOrigin = vertical ? oy : ox;
  const crossPeriod = vertical ? px : py;
  const crossOrigin = vertical ? ox : oy;
  const bandStart = mod(bandOrigin, bandPeriod) - bandPeriod;
  const bandOf = (b: number): number => Math.floor((b - bandStart) / bandPeriod);
  const shiftOf = (k: number): number => (shifts && k >= 0 && k < shifts.length ? shifts[k] : 0);

  // Straßen: Querstraßen voll, Längsstraßen je Band verschoben.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cell[i] !== FREE) continue;
      const b = vertical ? y : x;
      const c = vertical ? x : y;
      if (mod(b - bandOrigin, bandPeriod) === 0 || mod(c - crossOrigin - shiftOf(bandOf(b)), crossPeriod) === 0) {
        cell[i] = ROAD;
      }
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
  const bandLimit = vertical ? h : w;
  const crossLimit = vertical ? w : h;
  for (let rb = bandStart; rb < bandLimit; rb += bandPeriod) {
    const k = bandOf(rb + 1);
    const c0 = mod(crossOrigin + shiftOf(k), crossPeriod) - crossPeriod;
    for (let rc = c0; rc < crossLimit; rc += crossPeriod) {
      const rx = vertical ? rc : rb;
      const ry = vertical ? rb : rc;
      const a = vertical ? 2 : n;
      const bb = vertical ? n : 2;
      for (let c = 0; c < a; c++) {
        for (let r = 0; r < bb; r++) {
          const x = rx + 1 + c * 3;
          const y = ry + 1 + r * 3;
          if (footprintFree(s, x, y) && touchesRoad(s, x, y)) {
            placeHouse(s, x, y, vertical ? c : r);
          }
        }
      }
    }
  }
  pruneRoads(s);
  return s;
}

/** Anzahl der Bänder (für `shifts`) einer Gitterlage. */
export function bandCount(mask: LandMask, orientation: Orientation, housesPerLine: number, ox: number, oy: number): number {
  const vertical = orientation === 'vertical';
  const period = vertical ? 3 * housesPerLine + 1 : 3 * housesPerLine + 1;
  const origin = vertical ? oy : ox;
  const limit = vertical ? mask.h : mask.w;
  const start = (((origin % period) + period) % period) - period;
  return Math.ceil((limit - start) / period) + 1;
}

/** Kompletter Ablauf für eine Gitterlage: Gitter, Füllen, Straßen verlängern. */
export function fillWithLattice(
  mask: LandMask,
  orientation: Orientation,
  housesPerLine: number,
  ox: number,
  oy: number,
  blocked?: Uint8Array,
  shifts?: ReadonlyArray<number>,
): FillResult {
  const s = latticeFill(mask, orientation, housesPerLine, ox, oy, blocked, shifts);
  const latticeHouses = s.houses.length;
  greedyFill(s);
  const extraRoads = extendRoads(s);
  return {
    ...s,
    orientation,
    ox,
    oy,
    housesPerLine,
    shifts: shifts ? [...shifts] : [],
    latticeHouses,
    extraHouses: s.houses.length - latticeHouses,
    extraRoads,
  };
}

/** Häuser nach Gitter + gierigem Füllen (schnelle Bewertung einer Gitterlage). */
function quickScore(
  mask: LandMask,
  o: Orientation,
  n: number,
  ox: number,
  oy: number,
  shifts?: ReadonlyArray<number>,
  blocked?: Uint8Array,
): number {
  const s = latticeFill(mask, o, n, ox, oy, blocked, shifts);
  greedyFill(s);
  return s.houses.length;
}

/**
 * Bänder einzeln verschieben (Koordinatenabstieg): Jedes Band zwischen zwei
 * Querstraßen bekommt die Längsstraßen-Verschiebung, die insgesamt die
 * meisten Häuser ergibt. Wiederholen, bis sich nichts mehr verbessert.
 */
export function optimizeShifts(
  mask: LandMask,
  o: Orientation,
  n: number,
  ox: number,
  oy: number,
  deadline: number,
  blocked?: Uint8Array,
  initial?: ReadonlyArray<number>,
): { shifts: number[]; score: number } {
  const bands = bandCount(mask, o, n, ox, oy);
  const cross = 7;
  const shifts = Array.from({ length: bands }, (_, k) => initial?.[k] ?? 0);
  let score = quickScore(mask, o, n, ox, oy, shifts, blocked);
  for (let sweep = 0; sweep < 4; sweep++) {
    let improved = false;
    for (let k = 0; k < bands; k++) {
      if (Date.now() > deadline) return { shifts, score };
      const keep = shifts[k];
      let bestShift = keep;
      for (let d = 0; d < cross; d++) {
        if (d === keep) continue;
        shifts[k] = d;
        const v = quickScore(mask, o, n, ox, oy, shifts, blocked);
        if (v > score) {
          score = v;
          bestShift = d;
          improved = true;
        }
      }
      shifts[k] = bestShift;
    }
    if (!improved) break;
  }
  return { shifts, score };
}

/**
 * Beste Gitterlage suchen: grob alle Verschiebungen nur mit Gitter + Füllen
 * bewerten, für die besten die Bänder einzeln verschieben und vollständig
 * (inkl. Straßenverlängerung) rechnen.
 */
export function searchFill(
  mask: LandMask,
  options: { orientation: 'auto' | Orientation; housesPerLine: number; deadline?: number; bandShifts?: boolean },
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
        coarse.push({ o, ox, oy, score: quickScore(mask, o, n, ox, oy) });
      }
    }
  }
  coarse.sort((a, b) => b.score - a.score);
  const useShifts = options.bandShifts !== false;
  const finalists = coarse.slice(0, Math.min(useShifts ? 4 : 6, coarse.length));
  let best: FillResult | null = null;
  finalists.forEach((c, i) => {
    if (best && options.deadline && Date.now() > options.deadline) return;
    const shifts = useShifts
      ? optimizeShifts(mask, c.o, n, c.ox, c.oy, options.deadline ?? Date.now() + 60_000).shifts
      : undefined;
    const r = fillWithLattice(mask, c.o, n, c.ox, c.oy, undefined, shifts);
    if (!best || r.houses.length > best.houses.length) best = r;
    onProgress?.(best, i + 1, finalists.length);
  });
  return best as unknown as FillResult;
}

// ---------------------------------------------------------------------------
// Brücken über Flussarme
// ---------------------------------------------------------------------------

/**
 * Getrennte Straßennetze (Inselteile zwischen Flussarmen) mit Brücken
 * verbinden: gerade über höchstens `maxLen` Wasserkacheln, Start und Ende auf
 * Straße oder freiem Land direkt an einer Straße (wird zur Straße). Erst die
 * kürzesten Brücken, die alles verbinden (Kruskal), dann je Paar bis zu zwei
 * weitere, mindestens 40 Kacheln von den vorhandenen entfernt (kürzere Wege
 * für die Versorgung). Parallele Brücken halten 1 Kachel Abstand (Spielregel).
 * Liefert die Zahl der Brücken.
 */
export function addBridges(s: FillState, maxLen: number): number {
  if (maxLen <= 0) return 0;
  const { w, h, cell } = s;
  const net = labelComponents(w, h, (i) => isWay(cell[i]));
  const netOf = (i: number, skip: number): number => {
    if (cell[i] === ROAD) return net[i];
    if (cell[i] !== FREE) return -1;
    const x = i % w;
    const y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && j !== skip && cell[j] === ROAD) return net[j];
    }
    return -1;
  };
  interface Cand {
    a: number;
    b: number;
    tiles: number[];
    ends: [number, number];
    cost: number;
    mx: number;
    my: number;
    dir: 0 | 1;
  }
  const cands: Cand[] = [];
  const dirs: Array<[number, number]> = [
    [1, 0],
    [0, 1],
  ];
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] !== ROAD && cell[i] !== FREE) continue;
    const x0 = i % w;
    const y0 = (i - x0) / w;
    dirs.forEach(([dx, dy], di) => {
      const first = (y0 + dy) * w + x0 + dx;
      if (x0 + dx >= w || y0 + dy >= h || cell[first] !== WATER) return;
      const tiles: number[] = [];
      let x = x0 + dx;
      let y = y0 + dy;
      while (x < w && y < h && cell[y * w + x] === WATER && tiles.length <= maxLen) {
        tiles.push(y * w + x);
        x += dx;
        y += dy;
      }
      if (x >= w || y >= h || tiles.length === 0 || tiles.length > maxLen) return;
      const j = y * w + x;
      if (cell[j] !== ROAD && cell[j] !== FREE) return;
      const a = netOf(i, tiles[0]);
      const b = netOf(j, tiles[tiles.length - 1]);
      if (a < 0 || b < 0 || a === b) return;
      const cost = tiles.length + (cell[i] === FREE ? 1 : 0) + (cell[j] === FREE ? 1 : 0);
      const mid = tiles[tiles.length >> 1];
      cands.push({ a, b, tiles, ends: [i, j], cost, mx: mid % w, my: Math.floor(mid / w), dir: di as 0 | 1 });
    });
  }
  cands.sort((p, q) => p.cost - q.cost);
  const parent = new Map<number, number>();
  const find = (k: number): number => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  const built: Cand[] = [];
  const blocked = (c: Cand): boolean =>
    c.tiles.some((t) => cell[t] !== WATER) ||
    c.ends.some((e) => cell[e] !== ROAD && cell[e] !== FREE) ||
    // Abstand zu parallelen Brücken: Nachbarkacheln quer zur Richtung frei.
    c.tiles.some((t) => {
      const side = c.dir === 0 ? [t - w, t + w] : [t - 1, t + 1];
      return side.some((n) => n >= 0 && n < cell.length && cell[n] === BRIDGE);
    });
  const build = (c: Cand): void => {
    for (const t of c.tiles) cell[t] = BRIDGE;
    for (const e of c.ends) if (cell[e] === FREE) cell[e] = ROAD;
    built.push(c);
  };
  for (const c of cands) {
    const ra = find(c.a);
    const rb = find(c.b);
    if (ra === rb || blocked(c)) continue;
    build(c);
    parent.set(ra, rb);
  }
  // Zusätzliche Brücken je Netzpaar für kürzere Wege.
  for (const c of cands) {
    if (built.includes(c) || blocked(c)) continue;
    const same = built.filter((b) => (b.a === c.a && b.b === c.b) || (b.a === c.b && b.b === c.a));
    if (same.length === 0 || same.length >= 3) continue;
    if (same.some((b) => Math.abs(b.mx - c.mx) + Math.abs(b.my - c.my) < 40)) continue;
    build(c);
  }
  return built.length;
}

/**
 * Straßenstummel durch Häuser ersetzen: Ein 3×3-Platz aus freien Kacheln und
 * höchstens drei Straßenkacheln wird bebaut, wenn das Straßennetz ohne diese
 * Kacheln zusammenhängt, alle angrenzenden Häuser/Gebäude angeschlossen
 * bleiben und das neue Haus selbst an einer Straße liegt. Wiederholt, bis
 * nichts mehr geht; danach gieriges Füllen. Liefert neue Häuser.
 */
export function replaceRoadStubs(s: FillState): number {
  const { w, h, cell } = s;
  const nb = (i: number): number[] => {
    const x = i % w;
    const out: number[] = [];
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (i >= w) out.push(i - w);
    if (i + w < w * h) out.push(i + w);
    return out;
  };
  const separates = (tiles: number[]): boolean => {
    const removed = new Set(tiles);
    const ends = new Set<number>();
    // Nur Landstraßen: Jedes Ufer bleibt für sich zusammenhängend, sonst
    // würde eine Brücke zur Sackgasse.
    for (const t of tiles) for (const n of nb(t)) if (cell[n] === ROAD && !removed.has(n)) ends.add(n);
    if (ends.size <= 1) return false;
    const list = [...ends];
    const seen = new Set<number>([list[0]]);
    const queue = [list[0]];
    let found = 1;
    for (let k = 0; k < queue.length; k++) {
      for (const n of nb(queue[k])) {
        if (cell[n] !== ROAD || removed.has(n) || seen.has(n)) continue;
        seen.add(n);
        if (ends.has(n) && ++found === ends.size) return false;
        queue.push(n);
      }
    }
    return true;
  };
  // Hausindex je Kachel, um angrenzende Häuser zu prüfen.
  const houseAt = new Int32Array(w * h).fill(-1);
  s.houses.forEach((hs, k) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) houseAt[(hs.y + dy) * w + hs.x + dx] = k;
  });
  const hasAccess = (x: number, y: number, bw: number, bh: number): boolean => {
    for (let d = 0; d < bw; d++) {
      if (y > 0 && isWay(cell[(y - 1) * w + x + d]) && cell[(y - 1) * w + x + d] === ROAD) return true;
      if (y + bh < h && cell[(y + bh) * w + x + d] === ROAD) return true;
    }
    for (let d = 0; d < bh; d++) {
      if (x > 0 && cell[(y + d) * w + x - 1] === ROAD) return true;
      if (x + bw < w && cell[(y + d) * w + x + bw] === ROAD) return true;
    }
    return false;
  };
  let added = 0;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let y = 0; y + 3 <= h; y++) {
      for (let x = 0; x + 3 <= w; x++) {
        const roads: number[] = [];
        let ok = true;
        for (let dy = 0; dy < 3 && ok; dy++) {
          for (let dx = 0; dx < 3; dx++) {
            const i = (y + dy) * w + x + dx;
            if (cell[i] === ROAD) roads.push(i);
            else if (cell[i] !== FREE) {
              ok = false;
              break;
            }
          }
        }
        if (!ok || roads.length === 0 || roads.length > 3) continue;
        if (roads.some((r) => touchesBridge(cell, w, r)) || separates(roads)) continue;
        for (const i of roads) cell[i] = FREE;
        // Nachbarn (Häuser, Versorgungsgebäude) müssen weiter eine Straße berühren.
        let fine = touchesRoad(s, x, y);
        if (fine) {
          const touched = new Set<number>();
          for (const r of roads) for (const n of nb(r)) if (cell[n] === HOUSE) touched.add(houseAt[n]);
          for (const k of touched) {
            const hs = s.houses[k];
            if (!hs || !touchesRoad(s, hs.x, hs.y)) fine = false;
          }
          for (const r of roads) {
            for (const n of nb(r)) {
              if (cell[n] !== SERVICE) continue;
              // Versorgungsgebäude: irgendeine Straße am Rand des zusammenhängenden SERVICE-Blocks?
              let bx0 = n % w;
              let by0 = Math.floor(n / w);
              let bx1 = bx0;
              let by1 = by0;
              const stack = [n];
              const seen = new Set<number>([n]);
              while (stack.length) {
                const j = stack.pop() as number;
                const jx = j % w;
                const jy = Math.floor(j / w);
                bx0 = Math.min(bx0, jx);
                by0 = Math.min(by0, jy);
                bx1 = Math.max(bx1, jx);
                by1 = Math.max(by1, jy);
                for (const q of nb(j)) if (cell[q] === SERVICE && !seen.has(q)) (seen.add(q), stack.push(q));
              }
              if (!hasAccess(bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1)) fine = false;
            }
          }
        }
        if (!fine) {
          for (const i of roads) cell[i] = ROAD;
          continue;
        }
        placeHouse(s, x, y, -1);
        const k = s.houses.length - 1;
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) houseAt[(y + dy) * w + x + dx] = k;
        added++;
        changed = true;
      }
    }
    if (!changed) break;
  }
  added += greedyFill(s);
  pruneRoads(s);
  return added;
}

/**
 * Brücken ohne Anschluss auf beiden Ufern entfernen (wieder Wasser). Eine
 * Brücke ist eine zusammenhängende Gruppe von Brückenkacheln; nützlich nur,
 * wenn mindestens zwei Landstraßen-Kacheln sie berühren. Liefert die Zahl der
 * entfernten Brücken.
 */
export function pruneBridges(s: FillState): number {
  const { w, cell } = s;
  const seen = new Uint8Array(cell.length);
  let removed = 0;
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] !== BRIDGE || seen[i]) continue;
    const tiles: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop() as number;
      tiles.push(j);
      const x = j % w;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) {
        if (k >= 0 && k < cell.length && cell[k] === BRIDGE && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    const heads = new Set<number>();
    for (const j of tiles) {
      const x = j % w;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) {
        if (k >= 0 && k < cell.length && cell[k] === ROAD) heads.add(k);
      }
    }
    if (heads.size >= 2) continue;
    for (const j of tiles) cell[j] = WATER;
    removed++;
  }
  return removed;
}
