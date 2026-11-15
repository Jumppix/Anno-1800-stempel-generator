// Stadtplaner Phase 5: geclippte Produktion auf der Wohninsel.
//
// Clipping (bestätigt durch die Stempel des Nutzers, test-stamps-fix/
// Clipping_Hochraeder_*): Ein Produktionsgebäude steht genau auf der Mitte
// zwischen zwei Handelskammern, deren Mittelpunkte genau 30 auseinander liegen
// (Radien 15 berühren sich, überlappen nicht). Die Gebäudemitte hat dann zu
// beiden Kammern Abstand 15,0 – beide wirken. Das geht nur mit gerader Breite
// und Länge (Mitte auf einer halben Kachel wie bei der 4×4-Kammer).
//
// Ganzzahlige Abstände 30: (30, 0), (0, 30), (18, 24), (24, 18). Daraus
// entstehen Gitter von Handelskammern, deren Kanten (Abstand genau 30) je ein
// Produktionsgebäude tragen:
//   - quadratisch (30, 0)/(0, 30): wie der Stempel „quadratisch“, alle Größen;
//   - Raute (24, ±18) bzw. (±18, 24): wie der Stempel „Raute“;
//   - gedrehtes Quadrat (24, 18)/(−18, 24).
// Schräge Kanten nur für quadratische Gebäude (Angabe des Nutzers).
//
// Suche: für jedes Gitter und jede Verschiebung wächst gierig eine Formation
// (neue Kante zwischen vorhandenen Kammern, neue Kammer mit ihren Kanten oder
// ein neues Kammerpaar), bis alle gewünschten Gebäude stehen – jeweils die
// Erweiterung mit den geringsten Kosten je Gebäude (verdrängte Häuser,
// überbaute Straßen). Die besten Formationen prüft services.ts dann im echten
// Plan (Straßennetz, Anschlüsse).

import { CLIPPABLE, footprint, lookup } from './catalog';
import { BLOCKED, BRIDGE, HOUSE, ROAD, SERVICE, WATER, type FillState } from './fill';

export const TRADE_UNION_GUID = 1010516;
/** Straßenreichweite Produktion → Lagerhaus (Annahme, im Spiel prüfen). */
export const PRODUCTION_WAREHOUSE_RANGE = 20;

export interface ProductionRequest {
  guid: number;
  count: number;
}

export interface ProductionOptions {
  requests: ProductionRequest[];
  /** Jedes Produktionsgebäude in Reichweite eines Kraftwerks. */
  power: boolean;
  /**
   * Auch das schräge Quadrat (Kanten (24, 18)/(−18, 24)) zulassen. Jede Kante
   * ist wie in der Raute, die Form selbst ist aber nicht im Spiel getestet.
   */
  tiltedSquare?: boolean;
}

export interface ProductionReport {
  requested: number;
  placed: number;
  /** Gesetzte Gebäude je GUID. */
  byGuid: Record<number, number>;
  tradeUnions: number;
  lattice: string;
  /** Verdrängte Häuser (Formation + Häuser ohne Anschluss danach). */
  houses: number;
  powerPlants: number;
}

export interface FormationRect {
  guid: number;
  x: number;
  y: number;
  w: number;
  h: number;
  turns: number;
}

export interface Formation {
  lattice: string;
  rects: FormationRect[];
  cost: number;
  placed: number;
  tradeUnions: number;
}

interface Lattice {
  name: string;
  a: [number, number];
  b: [number, number];
  /** Kanten schräg → nur quadratische Gebäude. */
  squareOnly: boolean;
  /** Form wie in den Clipping-Stempeln des Nutzers. */
  tested: boolean;
}

const LATTICES: readonly Lattice[] = [
  { name: 'quadratisch', a: [30, 0], b: [0, 30], squareOnly: false, tested: true },
  { name: 'Raute', a: [24, 18], b: [24, -18], squareOnly: true, tested: true },
  { name: 'Raute', a: [18, 24], b: [-18, 24], squareOnly: true, tested: true },
  { name: 'Quadrat schräg', a: [24, 18], b: [-18, 24], squareOnly: true, tested: false },
  { name: 'Quadrat schräg', a: [18, 24], b: [-24, 18], squareOnly: true, tested: false },
];

/** Kosten einer überbauten Straßenkachel (Umwege, Anschlüsse). */
const ROAD_TILE_COST = 40;

export function isClippable(guid: number): boolean {
  return CLIPPABLE.some((c) => c.guid === guid);
}

interface RectTable {
  w: number;
  h: number;
  /** Kosten je linker oberer Kachel (Infinity = ungültig). */
  cost: Float64Array;
}

/**
 * Sucht die günstigsten Formationen für die gewünschten Gebäude.
 * `houseCost(k)`: Wert des Hauses k (Einwohner). Liefert bis zu `keep`
 * Formationen, beste zuerst (meiste Gebäude, dann geringste Kosten).
 */
export function findFormations(
  s: FillState,
  requests: readonly ProductionRequest[],
  houseCost: (k: number) => number,
  keep = 40,
  tiltedSquare = false,
): Formation[] {
  const { w, h, cell } = s;
  const types = requests
    .filter((r) => r.count > 0 && isClippable(r.guid))
    .map((r) => {
      const entry = lookup(r.guid);
      const [sx, sz] = entry.size;
      return { guid: r.guid, count: r.count, square: sx === sz, area: sx * sz };
    })
    // Große Gebäude zuerst: sie finden am schwersten Platz.
    .sort((p, q) => q.area - p.area);
  const total = types.reduce((n, t) => n + t.count, 0);
  if (!total) return [];

  const houseAt = new Int32Array(w * h).fill(-1);
  s.houses.forEach((hs, k) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) houseAt[(hs.y + dy) * w + hs.x + dx] = k;
  });
  const hc = s.houses.map((_, k) => houseCost(k));
  const seen = new Int32Array(s.houses.length);
  let stamp = 0;

  /** Kostentabelle für eine Fläche bw×bh: Häuser + Straßen, ungültig auf Wasser usw. oder ohne Straße daneben. */
  const tables = new Map<string, RectTable>();
  const tableFor = (bw: number, bh: number): RectTable => {
    const key = `${bw}x${bh}`;
    const known = tables.get(key);
    if (known) return known;
    const cost = new Float64Array(w * h).fill(Infinity);
    for (let y = 0; y + bh <= h; y++) {
      for (let x = 0; x + bw <= w; x++) {
        stamp++;
        let c = 0;
        let ok = true;
        for (let dy = 0; dy < bh && ok; dy++) {
          for (let dx = 0; dx < bw; dx++) {
            const i = (y + dy) * w + x + dx;
            const v = cell[i];
            if (v === WATER || v === BLOCKED || v === SERVICE || v === BRIDGE) {
              ok = false;
              break;
            }
            if (v === HOUSE) {
              const k = houseAt[i];
              if (seen[k] !== stamp) {
                seen[k] = stamp;
                c += hc[k];
              }
            } else if (v === ROAD) c += ROAD_TILE_COST;
          }
        }
        if (!ok) continue;
        // Straße am Rand (vor dem Überbauen; die Prüfung im Plan folgt später).
        let road = false;
        for (let d = 0; d < bw && !road; d++) {
          if (y > 0 && cell[(y - 1) * w + x + d] === ROAD) road = true;
          if (y + bh < h && cell[(y + bh) * w + x + d] === ROAD) road = true;
        }
        for (let d = 0; d < bh && !road; d++) {
          if (x > 0 && cell[(y + d) * w + x - 1] === ROAD) road = true;
          if (x + bw < w && cell[(y + d) * w + x + bw] === ROAD) road = true;
        }
        if (road) cost[y * w + x] = c;
      }
    }
    const t = { w: bw, h: bh, cost };
    tables.set(key, t);
    return t;
  };
  const rectCost = (t: RectTable, x: number, y: number): number =>
    x < 0 || y < 0 || x + t.w > w || y + t.h > h ? Infinity : t.cost[y * w + x];

  const hk = tableFor(4, 4);
  // Je Typ die beiden Drehungen (Kachelachsen).
  const shapes = types.map((t) => {
    const entry = lookup(t.guid);
    const out: Array<{ turns: number; table: RectTable }> = [];
    for (const turns of [0, 1]) {
      const f = footprint(entry, turns);
      if (out.some((o) => o.table.w === f.w && o.table.h === f.h)) continue;
      out.push({ turns, table: tableFor(f.w, f.h) });
    }
    return out;
  });

  const results: Formation[] = [];
  const canonical = new Set<string>();
  for (const lat of LATTICES) {
    if (lat.squareOnly && !types.some((t) => t.square)) continue;
    if (!lat.tested && !tiltedSquare) continue;
    const [ax, ay] = lat.a;
    const [bx, by] = lat.b;
    const det = ax * by - ay * bx;
    // Gitterkoordinaten (s, t) eines Punkts: p = s·a + t·b.
    const toST = (px: number, py: number): [number, number] => [(px * by - py * bx) / det, (ax * py - ay * px) / det];
    for (let oy = 0; oy < 60; oy++) {
      for (let ox = 0; ox < 60; ox++) {
        // Verschiebung auf das Grundgebiet reduzieren (jede nur einmal).
        const [s0, t0] = toST(ox, oy);
        const fs = s0 - Math.floor(s0 + 1e-9);
        const ft = t0 - Math.floor(t0 + 1e-9);
        const key = `${lat.a},${lat.b}:${Math.round(fs * ax + ft * bx)},${Math.round(fs * ay + ft * by)}`;
        if (canonical.has(key)) continue;
        canonical.add(key);
        const f = grow(ox, oy);
        if (f) results.push(f);
      }
    }

    function grow(ox: number, oy: number): Formation | null {
      // Gitterpunkte im Bereich der Insel.
      const corners = [
        toST(-ox - 4, -oy - 4),
        toST(w - ox, -oy - 4),
        toST(-ox - 4, h - oy),
        toST(w - ox, h - oy),
      ];
      const smin = Math.floor(Math.min(...corners.map((c) => c[0])));
      const smax = Math.ceil(Math.max(...corners.map((c) => c[0])));
      const tmin = Math.floor(Math.min(...corners.map((c) => c[1])));
      const tmax = Math.ceil(Math.max(...corners.map((c) => c[1])));
      const nodeX: number[] = [];
      const nodeY: number[] = [];
      const nodeCost: number[] = [];
      const index = new Map<number, number>();
      const SPAN = tmax - tmin + 1;
      for (let si = smin; si <= smax; si++) {
        for (let ti = tmin; ti <= tmax; ti++) {
          const x = ox + si * ax + ti * bx;
          const y = oy + si * ay + ti * by;
          const c = rectCost(hk, x, y);
          if (!Number.isFinite(c)) continue;
          index.set((si - smin) * SPAN + (ti - tmin), nodeX.length);
          nodeX.push(x);
          nodeY.push(y);
          nodeCost.push(c);
        }
      }
      const n = nodeX.length;
      if (n < 2) return null;
      const nodeOf = (x: number, y: number): number => {
        const [si, ti] = toST(x - ox, y - oy);
        return index.get((Math.round(si) - smin) * SPAN + (Math.round(ti) - tmin)) ?? -1;
      };
      // Kanten: zu den Nachbarn +a und +b.
      const eFrom: number[] = [];
      const eTo: number[] = [];
      const adj: number[][] = Array.from({ length: n }, () => []);
      for (let k = 0; k < n; k++) {
        for (const [dx, dy] of [lat.a, lat.b]) {
          const j = nodeOf(nodeX[k] + dx, nodeY[k] + dy);
          if (j < 0) continue;
          const e = eFrom.length;
          eFrom.push(k);
          eTo.push(j);
          adj[k].push(e);
          adj[j].push(e);
        }
      }
      const need = types.map((t) => t.count);
      /** Günstigste Belegung einer Kante mit einem noch gebrauchten Typ. */
      const edgeOption = (e: number): { cost: number; type: number; turns: number; x: number; y: number; w: number; h: number } | null => {
        const mx = (nodeX[eFrom[e]] + nodeX[eTo[e]]) / 2 + 2;
        const my = (nodeY[eFrom[e]] + nodeY[eTo[e]]) / 2 + 2;
        for (let ti = 0; ti < types.length; ti++) {
          if (need[ti] <= 0) continue;
          if (lat.squareOnly && !types[ti].square) continue;
          let best: { cost: number; type: number; turns: number; x: number; y: number; w: number; h: number } | null = null;
          for (const sh of shapes[ti]) {
            const x = mx - sh.table.w / 2;
            const y = my - sh.table.h / 2;
            const c = rectCost(sh.table, x, y);
            if (Number.isFinite(c) && (!best || c < best.cost)) best = { cost: c, type: ti, turns: sh.turns, x, y, w: sh.table.w, h: sh.table.h };
          }
          // Größter noch gebrauchter Typ, der passt.
          if (best) return best;
        }
        return null;
      };

      const chosenNode = new Uint8Array(n);
      const chosenEdge = new Uint8Array(eFrom.length);
      const rects: FormationRect[] = [];
      let placed = 0;
      let cost = 0;
      let unions = 0;
      const takeNode = (k: number): void => {
        chosenNode[k] = 1;
        cost += nodeCost[k];
        unions++;
        rects.push({ guid: TRADE_UNION_GUID, x: nodeX[k], y: nodeY[k], w: 4, h: 4, turns: 0 });
      };
      const takeEdge = (e: number): boolean => {
        const o = edgeOption(e);
        if (!o) return false;
        chosenEdge[e] = 1;
        need[o.type]--;
        placed++;
        cost += o.cost;
        rects.push({ guid: types[o.type].guid, x: o.x, y: o.y, w: o.w, h: o.h, turns: o.turns });
        return true;
      };
      while (placed < total) {
        let bestRatio = Infinity;
        let bestGain = 0;
        let act: (() => void) | null = null;
        // 1. Kante zwischen zwei gesetzten Kammern
        // 2. neue Kammer neben gesetzten (mit allen Kanten dorthin)
        // 3. neues Kammerpaar
        for (let k = 0; k < n; k++) {
          if (chosenNode[k]) {
            for (const e of adj[k]) {
              if (chosenEdge[e] || !chosenNode[eFrom[e]] || !chosenNode[eTo[e]] || eFrom[e] !== k) continue;
              const o = edgeOption(e);
              if (o && o.cost < bestRatio) {
                bestRatio = o.cost;
                bestGain = 1;
                act = () => void takeEdge(e);
              }
            }
            continue;
          }
          const edges: number[] = [];
          let c = nodeCost[k];
          let pairEdge = -1;
          let pairCost = Infinity;
          for (const e of adj[k]) {
            const other = eFrom[e] === k ? eTo[e] : eFrom[e];
            const o = edgeOption(e);
            if (!o) continue;
            if (chosenNode[other]) {
              edges.push(e);
              c += o.cost;
            } else if (eFrom[e] === k) {
              const pc = nodeCost[k] + nodeCost[other] + o.cost;
              if (pc < pairCost) {
                pairCost = pc;
                pairEdge = e;
              }
            }
          }
          const room = total - placed;
          if (edges.length && edges.length <= room) {
            const ratio = c / edges.length;
            if (ratio < bestRatio || (ratio === bestRatio && edges.length > bestGain)) {
              bestRatio = ratio;
              bestGain = edges.length;
              act = () => {
                takeNode(k);
                for (const e of edges) takeEdge(e);
              };
            }
          }
          if (pairEdge >= 0 && pairCost < bestRatio) {
            bestRatio = pairCost;
            bestGain = 1;
            const e = pairEdge;
            act = () => {
              takeNode(eFrom[e]);
              takeNode(eTo[e]);
              takeEdge(e);
            };
          }
        }
        if (!act) break;
        act();
      }
      if (!placed) return null;
      return { lattice: lat.name, rects, cost, placed, tradeUnions: unions };
    }
  }
  results.sort((p, q) => q.placed - p.placed || p.cost - q.cost);
  return results.slice(0, keep);
}
