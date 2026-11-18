// Möglichst viele gleiche Produktionsgebäude im Wirkungsradius einer
// Handelskammer (Mittelpunkt im Radius, wie analysis.ts), jedes mit
// Straßenanschluss an ein Netz, das die Handelskammer erreicht.
//
// Vorgehen: Straßenreihen im Abstand 2·Tiefe+1 (Gebäude beidseitig) plus eine
// senkrechte Verbindungsstraße; alle Versätze und beide Drehungen werden
// durchprobiert. Je Reihe gierig von links (bei gleich langen Intervallen
// optimal), danach freie Plätze an allen Straßen auffüllen, tote Straßenenden
// entfernen. Bestes Ergebnis: meiste Gebäude, dann wenigste Straßen.

export interface LayoutBuilding {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Vierteldrehungen (0: Breite = Preset z, Höhe = Preset x). */
  turns: number;
}

export interface Layout {
  count: number;
  buildings: LayoutBuilding[];
  roads: Array<{ x: number; y: number }>;
  /** Handelskammer (4×4) mit linker oberer Kachel. */
  hk: { x: number; y: number; w: number; h: number };
  radius: number;
}

const EMPTY = 0;
const ROAD = 1;
const BLOCK = 2;
const HK = 3;

/**
 * @param size Grundfläche wie Anno Designer [x, z]
 * @param radius Wirkungsradius der Handelskammer (15)
 */
export function packAroundTradeUnion(size: [number, number], radius = 15): Layout {
  const [px, pz] = size;
  const R = radius;
  const M = Math.ceil(R) + Math.max(px, pz) + 3; // Rand des Rasters
  const N = 2 * M;
  const idx = (x: number, y: number): number => (y + M) * N + (x + M);
  const inGrid = (x: number, y: number): boolean => x >= -M && x < M && y >= -M && y < M;
  const hk = { x: -2, y: -2, w: 4, h: 4 };
  const centerOk = (x: number, y: number, w: number, h: number): boolean => Math.hypot(x + w / 2, y + h / 2) <= R + 1e-9;

  let best: Layout | null = null;
  const orientations: Array<{ w: number; h: number; turns: number }> = [{ w: pz, h: px, turns: 0 }];
  if (px !== pz) orientations.push({ w: px, h: pz, turns: 1 });

  for (const o of orientations) {
    const period = 2 * o.h + 1;
    for (let y0 = 0; y0 < period; y0++) {
      for (let spine = -2 - 1 - Math.max(o.w, 3); spine <= 2 + Math.max(o.w, 3); spine++) {
        const r = attempt(o, y0, spine);
        if (r && (!best || r.count > best.count || (r.count === best.count && r.roads.length < best.roads.length))) best = r;
      }
    }
  }
  return best ?? { count: 0, buildings: [], roads: [], hk, radius: R };

  function attempt(o: { w: number; h: number; turns: number }, y0: number, spine: number): Layout | null {
    const grid = new Uint8Array(N * N);
    const owner = new Int32Array(N * N).fill(-1);
    for (let y = hk.y; y < hk.y + hk.h; y++) for (let x = hk.x; x < hk.x + hk.w; x++) grid[idx(x, y)] = HK;
    const period = 2 * o.h + 1;
    const lim = Math.ceil(R) + Math.max(o.w, o.h);
    // Straßen: Reihen und Verbindungsstraße
    for (let y = -lim; y <= lim; y++) {
      const isRow = (((y - y0) % period) + period) % period === 0;
      for (let x = -lim; x <= lim; x++) {
        if (!inGrid(x, y) || grid[idx(x, y)] === HK) continue;
        if (isRow || x === spine) grid[idx(x, y)] = ROAD;
      }
    }
    // Nur Straßen behalten, die mit der Handelskammer verbunden sind.
    const conn = new Uint8Array(N * N);
    const queue: number[] = [];
    for (let y = hk.y - 1; y <= hk.y + hk.h; y++) {
      for (let x = hk.x - 1; x <= hk.x + hk.w; x++) {
        const edge = x === hk.x - 1 || x === hk.x + hk.w || y === hk.y - 1 || y === hk.y + hk.h;
        const corner = (x === hk.x - 1 || x === hk.x + hk.w) && (y === hk.y - 1 || y === hk.y + hk.h);
        if (edge && !corner && inGrid(x, y) && grid[idx(x, y)] === ROAD) {
          conn[idx(x, y)] = 1;
          queue.push(idx(x, y));
        }
      }
    }
    if (!queue.length) return null;
    while (queue.length) {
      const i = queue.pop() as number;
      for (const j of [i - 1, i + 1, i - N, i + N]) {
        if (j >= 0 && j < N * N && grid[j] === ROAD && !conn[j]) {
          conn[j] = 1;
          queue.push(j);
        }
      }
    }
    for (let i = 0; i < N * N; i++) if (grid[i] === ROAD && !conn[i]) grid[i] = EMPTY;

    const buildings: LayoutBuilding[] = [];
    const fits = (x: number, y: number, w: number, h: number): boolean => {
      if (!centerOk(x, y, w, h)) return false;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!inGrid(xx, yy) || grid[idx(xx, yy)] !== EMPTY) return false;
      return true;
    };
    const touchesRoad = (x: number, y: number, w: number, h: number): boolean => {
      for (let xx = x; xx < x + w; xx++) {
        if (inGrid(xx, y - 1) && grid[idx(xx, y - 1)] === ROAD) return true;
        if (inGrid(xx, y + h) && grid[idx(xx, y + h)] === ROAD) return true;
      }
      for (let yy = y; yy < y + h; yy++) {
        if (inGrid(x - 1, yy) && grid[idx(x - 1, yy)] === ROAD) return true;
        if (inGrid(x + w, yy) && grid[idx(x + w, yy)] === ROAD) return true;
      }
      return false;
    };
    const place = (x: number, y: number, w: number, h: number, turns: number): void => {
      const k = buildings.length;
      buildings.push({ x, y, w, h, turns });
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        grid[idx(xx, yy)] = BLOCK;
        owner[idx(xx, yy)] = k;
      }
    };
    // 1. Reihen beidseitig der Straßen, gierig von links.
    for (let y = -lim; y <= lim; y++) {
      if ((((y - y0) % period) + period) % period !== 0) continue;
      for (const top of [y - o.h, y + 1]) {
        for (let x = -lim; x <= lim; x++) {
          if (fits(x, top, o.w, o.h) && touchesRoad(x, top, o.w, o.h)) {
            place(x, top, o.w, o.h, o.turns);
            x += o.w - 1;
          }
        }
      }
    }
    // 2. Freie Plätze an allen Straßen auffüllen (auch gedreht).
    const shapes = [{ w: pz, h: px, turns: 0 }];
    if (px !== pz) shapes.push({ w: px, h: pz, turns: 1 });
    for (let y = -lim; y <= lim; y++) {
      for (let x = -lim; x <= lim; x++) {
        for (const s of shapes) {
          if (fits(x, y, s.w, s.h) && touchesRoad(x, y, s.w, s.h)) place(x, y, s.w, s.h, s.turns);
        }
      }
    }
    // 3. Tote Straßenenden ohne Nutzen entfernen.
    const needed = (i: number): boolean => {
      for (const j of [i - 1, i + 1, i - N, i + N]) if (j >= 0 && j < N * N && (grid[j] === BLOCK || grid[j] === HK)) return true;
      return false;
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (let i = 0; i < N * N; i++) {
        if (grid[i] !== ROAD) continue;
        let deg = 0;
        for (const j of [i - 1, i + 1, i - N, i + N]) if (j >= 0 && j < N * N && grid[j] === ROAD) deg++;
        if (deg <= 1 && !needed(i)) {
          grid[i] = EMPTY;
          changed = true;
        }
      }
    }
    const roads: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < N * N; i++) if (grid[i] === ROAD) roads.push({ x: (i % N) - M, y: Math.floor(i / N) - M });
    return { count: buildings.length, buildings, roads, hk, radius: R };
  }
}
