// Ölversorgung im Stadtplaner (Ölkraftwerke statt Gaskraftwerke): Ölhafen an der Küste,
// optional Raffinerien mit Bohrtürmen (eigene Ölquellen, mit „Bahnbrechende Entdeckungen“
// verschiebbar) und ein Gleisnetz zu allen Ölkraftwerken. Läuft nach allen Straßenänderungen,
// damit nichts mehr die Gleise unterbricht; danach verdichtet die Pipeline um die Gleise nach.
//
// Ziel ist allein die Einwohnerzahl: Ein Gleis kostet die Häuser, die es berührt (Wert je Haus =
// geplante Einwohner), freie Kacheln fast nichts, Abbiegen nichts. Das Netz ist ein Steinerbaum
// über Ölhafen, Raffinerien und Kraftwerke (je Bahnhof bis zu vier mögliche Ausfahrtsseiten):
// 1. Aufbau: schrittweise den günstigsten noch fehlenden Bahnhof anhängen (Dijkstra vom ganzen
//    Netz aus; ein Haus wird nur einmal bezahlt, Häuser, die schon weichen, sind frei).
// 2. Verbesserung („Schlüsselpfad-Tausch“): ein Stück zwischen zwei Abzweigen/Bahnhöfen
//    herausnehmen und die beiden Teile mit den dann gültigen Kosten neu verbinden; ein
//    Bahnhof am Ende darf dabei die Ausfahrtsseite wechseln. Übernommen, wenn weniger
//    Einwohner verloren gehen.
// 3. Neustarts mit verrauschten Hauswerten (anderer Aufbau), dann wieder 2.; der beste Baum gilt.
// Ölhafen-Lagen und Raffinerie-Plätze werden als Varianten mit vollem Aufbau verglichen.
// Bohrtürme kommen zuletzt auf die billigsten Plätze im Radius der Raffinerie – gern auf Reste
// von Häusern, die für das Gleis ohnehin weichen.
//
// Regeln aus den Teststempeln des Nutzers (docs/PLAN_Kueste.md, Abschnitt 9):
// - Gleise liegen im Stempel als gerade Stücke (Abschnitt RailwayInfos), Bahnhofsgebäude haben
//   ein Gleis durch ihre Mittellinie: Kraftwerk/Raffinerie (5×5) ganz, Kleiner Ölhafen (10×7)
//   7 Kacheln von der Landseite; Ausfahrt bei Drehung 0: Kraftwerk/Raffinerie rechts, Ölhafen
//   unten; jede Vierteldrehung dreht gegen den Uhrzeigersinn (rechts → oben → links → unten).
// - Bohrtürme hängen im Radius 12 an ihrer Raffinerie (gemeinsame ComplexOwnerID), bis zu 3.
// - Kreuzt ein Gleis eine Straße, entsteht ein Bahnübergang (Straße + Gleis auf einer Kachel);
//   höchstens 2 Übergänge direkt nebeneinander, Gleise nie längs auf Straßen.
import { lookup } from './catalog';
import { BRIDGE, FREE, HOUSE, ROAD, SERVICE, WATER, type FillState } from './fill';
import type { PlacedService } from './services';
import type { LandMask } from './solver';

export const OIL_POWER_GUID = 100780;
export const OIL_HARBOR_GUID = 100783;
export const OIL_REFINERY_GUID = 101331;
export const OIL_WELL_GUID = 101332;
export const OIL_OWNER_BASE = 9300;
/** Bohrtürme je Raffinerie (Angabe des Nutzers). */
export const WELLS_PER_REFINERY = 3;
/** Bohrtürme im Radius der Raffinerie (Spieldaten ModuleBuildRadius). */
const WELL_RADIUS = 12;

export interface OilOptions {
  /** Anzahl eigener Ölquellen (Bohrtürme, verschiebbar); 0 = Öl kommt per Schiff. */
  wells: number;
  /** Hafengebiet (Maskenkoordinaten, 1 = Kaistraße o. Ä.); ohne: Wasser am Ufer. */
  harbor?: Uint8Array;
  /** Nicht bebaubar (Kontor und seine Zufahrt). */
  blocked?: Uint8Array;
  /** Einwohner je Haus nach Lage „x,y“ (aus den geplanten Stufen); ohne: alle gleich. */
  values?: Map<string, number>;
  /** Rechenzeit für die Gleisoptimierung (ms, Standard 4000). */
  budgetMs?: number;
  seed?: number;
  /** Ölkraftwerke nach dem Gleisbau ans Netz verschieben (Standard an). */
  relocate?: boolean;
  /**
   * Ölfeld statt Gleisanschluss: Raffinerien mit den Bohrtürmen alle zusammen nahe der Küste,
   * ohne Gleise (Gaskraftwerke oder Öl per Schiff). Ohne Ölkraftwerke immer so.
   */
  field?: boolean;
  /** Raffinerien stehen fest (aus dem Stempel, in `services`): sie werden nur angeschlossen. */
  fixedRefineries?: boolean;
  /** Ölkraftwerke statt Gaskraftwerke (Standard an); aus = nur das Ölfeld (Gaskraftwerke). */
  power?: boolean;
  /**
   * Reichweite der Kraftwerke: Straßenkacheln im Palast-/Ministeriumsbereich (Maskenkoordinaten)
   * und der Zuschlag dort (Wohlfahrt + Netz). Ohne: nur Grundreichweite.
   */
  powerReach?: { ministryRoads: Uint8Array; bonus: number };
}

export interface OilReport {
  harbor: boolean;
  refineries: number;
  wells: number;
  plants: number;
  connected: number;
  railTiles: number;
  crossings: number;
  bridges: number;
  houses: number;
  /** Einwohner der verdrängten Häuser (geplante Stufen, vor dem Nachverdichten). */
  lostResidents: number;
  /** Verglichene Varianten (Ölhafen-Lage, Raffinerie-Plätze) und Verbesserungen der Gleise. */
  variants: number;
  improvements: number;
  /** Nach dem Gleisbau verschobene Ölkraftwerke. */
  moved: number;
  notes: string[];
}

type Side = 0 | 1 | 2 | 3; // 0 rechts, 1 oben, 2 links, 3 unten
const DX = [1, 0, -1, 0];
const DY = [0, -1, 0, 1];

/** Gleiskacheln im Gebäude und Ausfahrtskachel für ein 5×5-Bahnhofsgebäude (Kraftwerk/Raffinerie). */
function stationRail(x: number, y: number, side: Side): { inner: Array<[number, number]>; exit: [number, number] } {
  const inner: Array<[number, number]> = [];
  if (side === 0 || side === 2) for (let k = 0; k < 5; k++) inner.push([x + k, y + 2]);
  else for (let k = 0; k < 5; k++) inner.push([x + 2, y + k]);
  const exit: [number, number] = side === 0 ? [x + 5, y + 2] : side === 2 ? [x - 1, y + 2] : side === 1 ? [x + 2, y - 1] : [x + 2, y + 5];
  return { inner, exit };
}

/** Kleiner Ölhafen (Drehung = Ausfahrt): Fläche, Gleis (7 Kacheln von der Landseite) und Ausfahrt. */
function harborShape(x: number, y: number, turns: number): { w: number; h: number; inner: Array<[number, number]>; exit: [number, number]; side: Side } {
  // Drehung 0: 7 breit, 10 hoch, Ausfahrt unten; 1: 10 × 7 rechts; 2: oben; 3: links
  const t = ((turns % 4) + 4) % 4;
  const inner: Array<[number, number]> = [];
  if (t === 0) {
    for (let k = 3; k < 10; k++) inner.push([x + 3, y + k]);
    return { w: 7, h: 10, inner, exit: [x + 3, y + 10], side: 3 };
  }
  if (t === 1) {
    for (let k = 3; k < 10; k++) inner.push([x + k, y + 3]);
    return { w: 10, h: 7, inner, exit: [x + 10, y + 3], side: 0 };
  }
  if (t === 2) {
    for (let k = 0; k < 7; k++) inner.push([x + 3, y + k]);
    return { w: 7, h: 10, inner, exit: [x + 3, y - 1], side: 1 };
  }
  for (let k = 0; k < 7; k++) inner.push([x + k, y + 3]);
  return { w: 10, h: 7, inner, exit: [x - 1, y + 3], side: 2 };
}

/** Kleiner binärer Heap für Dijkstra (Schlüssel des zuletzt entnommenen Eintrags in `topKey`). */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  topKey = 0;
  get size(): number {
    return this.k.length;
  }
  clear(): void {
    this.k.length = 0;
    this.v.length = 0;
  }
  push(key: number, val: number): void {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.k;
    const v = this.v;
    this.topKey = k[0];
    const top = v[0];
    const lk = k.pop() as number;
    const lv = v.pop() as number;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Ausfahrtsmöglichkeit eines Bahnhofs: Anlaufkachel im Netz, feste Gleise davor (Bahnübergänge). */
interface Option {
  side: Side;
  anchor: number;
  /** Bahnübergänge zwischen Ausfahrt und Anlaufkachel. */
  between: number[];
}
interface Terminal {
  kind: 'harbor' | 'refinery' | 'plant';
  /** Index in der Gebäudeliste (Kraftwerk) bzw. −2 − k (Raffinerie k), −1 Ölhafen. */
  sv: number;
  options: Option[];
  chosen: number;
}

/** Zustand eines Gleisbaums (zum Sichern/Zurücksetzen bei der lokalen Suche). */
interface TreeState {
  inTree: Uint8Array;
  hit: Int32Array;
  fixedRail: Uint8Array;
  nb: Map<number, number[]>;
  chosen: number[];
}

/**
 * Plant die Ölversorgung in einem Zustand (Zellen, Häuser) mit gesetzten Ölkraftwerken.
 * Ergebnis: neue Gebäude (Ölhafen, Raffinerien, Bohrtürme), geänderte Kraftwerke (Drehung),
 * Gleiskacheln; entfernte Häuser sind aus `s.houses` genommen.
 */
export function planOilSupply(
  mask: LandMask,
  s: FillState,
  services: PlacedService[],
  opts: OilOptions,
): { services: PlacedService[]; rails: number[]; report: OilReport } {
  const { w, h, cell } = s;
  const N = w * h;
  const report: OilReport = {
    harbor: false,
    refineries: 0,
    wells: 0,
    plants: 0,
    connected: 0,
    railTiles: 0,
    crossings: 0,
    bridges: 0,
    houses: 0,
    lostResidents: 0,
    variants: 0,
    improvements: 0,
    moved: 0,
    notes: [],
  };
  const idx = (x: number, y: number): number => y * w + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  const out: PlacedService[] = services.map((sv) => ({ ...sv }));
  const plantIdx: number[] = [];
  out.forEach((sv, i) => {
    if (sv.guid === OIL_POWER_GUID) plantIdx.push(i);
  });
  report.plants = plantIdx.length;
  // Ölfeld (ohne Gleise): Raffinerien + Bohrtürme zusammen an der Küste
  const fieldMode = opts.wells > 0 && !opts.fixedRefineries && (!!opts.field || !plantIdx.length);
  if (fieldMode) placeOilField(mask, s, out, opts, report);
  if (!plantIdx.length) {
    if (!fieldMode && !opts.fixedRefineries) report.notes.push('keine Ölkraftwerke im Plan');
    return { services: out, rails: [], report };
  }
  const wellsToPlace = fieldMode || opts.fixedRefineries ? 0 : opts.wells;
  const deadline = performance.now() + (opts.budgetMs ?? 4000);
  let seed = ((opts.seed ?? 1) * 2654435761) >>> 0 || 1;
  const rnd = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 4294967296;
  };

  // Häuser: Kachel → Haus, Wert je Haus (Einwohner)
  const H = s.houses.length;
  const houseAt = new Int32Array(N).fill(-1);
  s.houses.forEach((hs, k) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) houseAt[idx(hs.x + dx, hs.y + dy)] = k;
  });
  const V = new Float64Array(H);
  {
    let sum = 0;
    let n = 0;
    s.houses.forEach((hs, k) => {
      const v = opts.values?.get(`${hs.x},${hs.y}`);
      if (v !== undefined && v > 0) {
        V[k] = v;
        sum += v;
        n++;
      } else V[k] = -1;
    });
    const avg = n ? sum / n : 1000;
    for (let k = 0; k < H; k++) if (V[k] < 0) V[k] = avg;
  }
  const vAvg = H ? V.reduce((a, b) => a + b, 0) / H : 1000;
  /** Kosten je Gleiskachel auf freiem Land (nur gegen Umwege), je Bahnübergang, je Brückenkachel. */
  const C_FREE = vAvg * 1e-3;
  const C_ROAD = vAvg * 0.08;
  const C_WATER = vAvg * 0.01;
  /** Geschätzte Kosten je Gleiskachel durch die Stadt (für die Wahl der Raffinerie-Plätze). */
  const C_EST = vAvg * 0.2;
  const blockedAt = (i: number): boolean => !!opts.blocked?.[i];

  // --- Ölhafen-Kandidaten: ganz im Hafengebiet (ohne Hafengebiet: offenes Meer), Ausfahrt auf Land.
  const pcx = plantIdx.reduce((a, i) => a + out[i].x + 2, 0) / plantIdx.length;
  const pcy = plantIdx.reduce((a, i) => a + out[i].y + 2, 0) / plantIdx.length;
  const harbors = harborCandidates(mask, cell, opts).map((c) => ({ ...c, cost: Math.hypot(c.ex - pcx, c.ey - pcy) }));
  if (!harbors.length) {
    report.notes.push(opts.harbor ? 'kein Platz für den Ölhafen im Hafengebiet' : 'kein Platz für den Ölhafen am Ufer (Hafengebiet im Stempel mit Kaistraße markieren)');
    return { services: out, rails: [], report };
  }
  // Verschiedene Lagen: die nächsten zu den Kraftwerken mit mindestens 25 Kacheln Abstand
  harbors.sort((a, b) => a.cost - b.cost);
  const harborPicks: typeof harbors = [];
  for (const c of harbors) {
    const e = harborShape(c.x, c.y, c.t).exit;
    const close = harborPicks.some((p) => {
      const f = harborShape(p.x, p.y, p.t).exit;
      return Math.hypot(e[0] - f[0], e[1] - f[1]) < 25;
    });
    if (close) continue;
    harborPicks.push(c);
    if (harborPicks.length >= 4) break;
  }

  // --- Gemeinsame Arbeitsfelder
  const occ = new Uint8Array(N);
  const hit = new Int32Array(H);
  const inTree = new Uint8Array(N);
  const fixedRail = new Uint8Array(N);
  let nb = new Map<number, number[]>();
  const dist = new Float64Array(N);
  const prev = new Int32Array(N);
  const jump = new Uint8Array(N); // Länge eines Sprungs (Straße/Wasser) vor dieser Kachel
  const jdir = new Uint8Array(N);
  const heap = new Heap();
  const mark = new Int32Array(N);
  let markGen = 0;

  const hitTile = (i: number, d: number): void => {
    const k = houseAt[i];
    if (k >= 0) hit[k] += d;
  };
  const pass = (i: number): boolean => !blockedAt(i) && (occ[i] === FREE || occ[i] === HOUSE) && !fixedRail[i];
  const isWet = (c: number): boolean => c === ROAD || c === WATER;
  const railOnRoad = (x: number, y: number): boolean => {
    if (!inside(x, y)) return false;
    const i = idx(x, y);
    return occ[i] === ROAD && (inTree[i] === 1 || fixedRail[i] === 1);
  };
  /** Bahnübergang hier ergäbe mehr als 2 nebeneinander (längs der Straße, quer zur Fahrt). */
  const crossingNear = (n: number, dir: number): boolean => {
    const x = n % w;
    const y = (n - x) / w;
    const ax = DY[dir] !== 0 ? 1 : 0;
    const ay = DX[dir] !== 0 ? 1 : 0;
    const p1 = railOnRoad(x + ax, y + ay);
    const m1 = railOnRoad(x - ax, y - ay);
    return (p1 && railOnRoad(x + 2 * ax, y + 2 * ay)) || (m1 && railOnRoad(x - 2 * ax, y - 2 * ay)) || (p1 && m1);
  };

  /** Anlaufkachel einer Ausfahrt: über höchstens 2 Straßenkacheln gerade weiter zur ersten Landkachel. */
  const approach = (x: number, y: number, side: Side): Option | null => {
    const between: number[] = [];
    let cx = x;
    let cy = y;
    while (inside(cx, cy) && occ[idx(cx, cy)] === ROAD && between.length < 3) {
      const i = idx(cx, cy);
      if (fixedRail[i] || inTree[i] || blockedAt(i)) return null;
      between.push(i);
      cx += DX[side];
      cy += DY[side];
    }
    if (between.length > 2 || !inside(cx, cy)) return null;
    const g = idx(cx, cy);
    if (!pass(g)) return null;
    return { side, anchor: g, between };
  };

  const addEdge = (a: number, b: number): void => {
    const la = nb.get(a);
    if (la) la.push(b);
    else nb.set(a, [b]);
    const lb = nb.get(b);
    if (lb) lb.push(a);
    else nb.set(b, [a]);
  };
  const delEdge = (a: number, b: number): void => {
    const la = nb.get(a);
    if (la) {
      const p = la.indexOf(b);
      if (p >= 0) la.splice(p, 1);
    }
    const lb = nb.get(b);
    if (lb) {
      const p = lb.indexOf(a);
      if (p >= 0) lb.splice(p, 1);
    }
  };
  const addTile = (i: number): void => {
    if (inTree[i]) return;
    inTree[i] = 1;
    hitTile(i, 1);
    if (!nb.has(i)) nb.set(i, []);
  };
  const delTile = (i: number): void => {
    if (!inTree[i]) return;
    inTree[i] = 0;
    hitTile(i, -1);
    const l = nb.get(i);
    if (l) for (const j of [...l]) delEdge(i, j);
    nb.delete(i);
  };
  const addPath = (path: number[]): void => {
    for (const i of path) addTile(i);
    for (let k = 1; k < path.length; k++) addEdge(path[k - 1], path[k]);
  };

  /**
   * Dijkstra von `sources` zur ersten Kachel mit `target(i)`. Hauswert nur beim Betreten eines
   * noch stehenden Hauses von außen; Straßen nur quer (1–2 Kacheln), Wasser bis 12 Kacheln.
   * Ergebnis: Kachelfolge von der Quelle bis zum Ziel (einschließlich übersprungener Kacheln).
   */
  const route = (sources: number[], target: (i: number) => boolean, vals: Float64Array): number[] | null => {
    dist.fill(Infinity);
    heap.clear();
    for (const i of sources) {
      dist[i] = 0;
      prev[i] = -1;
      jump[i] = 0;
      heap.push(0, i);
    }
    let found = -1;
    while (heap.size) {
      const i = heap.pop();
      const d = heap.topKey;
      if (d > dist[i]) continue;
      if (d > 0 && target(i)) {
        found = i;
        break;
      }
      const x = i % w;
      const y = (i - x) / w;
      const hi = houseAt[i];
      for (let dir = 0; dir < 4; dir++) {
        let nx = x + DX[dir];
        let ny = y + DY[dir];
        if (!inside(nx, ny)) continue;
        let n = idx(nx, ny);
        let extra = 0;
        let k = 0;
        const c = occ[n];
        if (isWet(c)) {
          const max = c === ROAD ? 2 : 12;
          while (k < max && occ[n] === c && !blockedAt(n) && !inTree[n] && !fixedRail[n] && (c !== ROAD || !crossingNear(n, dir))) {
            k++;
            nx += DX[dir];
            ny += DY[dir];
            if (!inside(nx, ny)) break;
            n = idx(nx, ny);
          }
          if (!k || !inside(nx, ny) || occ[n] === c) continue;
          extra = c === ROAD ? C_ROAD * k : C_WATER * k;
        }
        if (!target(n) && (inTree[n] || !pass(n))) continue;
        const hn = houseAt[n];
        let step = C_FREE + extra;
        if (hn >= 0 && hit[hn] === 0 && hn !== hi) step += vals[hn];
        const nd = d + step;
        if (nd < dist[n]) {
          dist[n] = nd;
          prev[n] = i;
          jump[n] = k;
          jdir[n] = dir;
          heap.push(nd, n);
        }
      }
    }
    if (found < 0) return null;
    const path: number[] = [];
    for (let i = found; i >= 0; i = prev[i]) {
      path.push(i);
      if (dist[i] === 0) break;
      const st = DX[jdir[i]] + DY[jdir[i]] * w;
      for (let m = 1; m <= jump[i]; m++) path.push(i - m * st);
    }
    return path.reverse();
  };

  const snapshot = (terms: Terminal[]): TreeState => ({
    inTree: inTree.slice(),
    hit: hit.slice(),
    fixedRail: fixedRail.slice(),
    nb: new Map([...nb].map(([k, v]) => [k, v.slice()])),
    chosen: terms.map((t) => t.chosen),
  });
  const restore = (st: TreeState, terms: Terminal[]): void => {
    inTree.set(st.inTree);
    hit.set(st.hit);
    fixedRail.set(st.fixedRail);
    nb = new Map([...st.nb].map(([k, v]) => [k, v.slice()]));
    terms.forEach((t, k) => (t.chosen = st.chosen[k]));
  };
  /** Verlust: Einwohner aller berührten Häuser + kleine Kosten je Gleis-, Übergangs-, Brückenkachel. */
  const lossOf = (): number => {
    let l = 0;
    for (let k = 0; k < H; k++) if (hit[k] > 0) l += V[k];
    for (const i of nb.keys()) l += occ[i] === ROAD ? C_ROAD : occ[i] === WATER ? C_WATER : C_FREE;
    return l;
  };
  const connectedCount = (terms: Terminal[]): number => terms.filter((t) => t.chosen >= 0).length;
  const anchorsOf = (terms: Terminal[]): Set<number> => {
    const a = new Set<number>();
    for (const t of terms) if (t.chosen >= 0) a.add(t.options[t.chosen].anchor);
    return a;
  };
  const choose = (t: Terminal, o: number): void => {
    t.chosen = o;
    for (const j of t.options[o].between) fixedRail[j] = 1;
  };
  const unchoose = (t: Terminal): void => {
    if (t.chosen < 0) return;
    for (const j of t.options[t.chosen].between) fixedRail[j] = 0;
    t.chosen = -1;
  };
  const usable = (o: Option): boolean => !o.between.some((j) => fixedRail[j] || inTree[j]) && (pass(o.anchor) || inTree[o.anchor] === 1);
  /** Mögliche Ausfahrten eines 5×5-Bahnhofs im aktuellen Zustand. */
  const stationOptions = (x: number, y: number): Option[] => {
    const list: Option[] = [];
    for (const sd of [0, 1, 2, 3] as Side[]) {
      const [ex, ey] = stationRail(x, y, sd).exit;
      if (!inside(ex, ey)) continue;
      const o = approach(ex, ey, sd);
      if (o) list.push(o);
    }
    return list;
  };

  /** Netz schrittweise aufbauen (vom Ölhafen aus); `vals` = (verrauschte) Hauswerte. */
  const construct = (terms: Terminal[], vals: Float64Array): string[] => {
    const notes: string[] = [];
    const root = terms[0];
    choose(root, 0);
    addTile(root.options[0].anchor);
    const pending = terms.slice(1);
    const targetOf = new Map<number, Array<{ t: Terminal; o: number }>>();
    while (pending.length) {
      targetOf.clear();
      for (const t of pending) {
        t.options.forEach((o, k) => {
          if (!usable(o)) return;
          const l = targetOf.get(o.anchor) ?? [];
          l.push({ t, o: k });
          targetOf.set(o.anchor, l);
        });
      }
      const done = new Set<Terminal>();
      const take = (a: number): void => {
        for (const { t, o } of targetOf.get(a) ?? []) {
          if (done.has(t)) continue;
          done.add(t);
          choose(t, o);
        }
      };
      // Anlaufkacheln, die schon im Netz liegen, direkt anschließen
      for (const a of targetOf.keys()) if (inTree[a]) take(a);
      if (!done.size) {
        const sources = [...nb.keys()].filter((i) => !isWet(occ[i]));
        const path = targetOf.size ? route(sources, (i) => targetOf.has(i), vals) : null;
        if (!path) {
          for (const t of pending) notes.push(`${t.kind === 'refinery' ? 'Raffinerie' : 'Kraftwerk'} ohne Gleisweg`);
          break;
        }
        addPath(path);
        take(path[path.length - 1]);
      }
      for (let k = pending.length - 1; k >= 0; k--) if (done.has(pending[k])) pending.splice(k, 1);
    }
    return notes;
  };

  /** Lose Enden ohne Bahnhof entfernen. */
  const prune = (terms: Terminal[]): void => {
    const anchors = anchorsOf(terms);
    const stack = [...nb.keys()];
    while (stack.length) {
      const i = stack.pop() as number;
      if (!inTree[i] || anchors.has(i)) continue;
      const l = nb.get(i) ?? [];
      if (l.length <= 1) {
        const j = l[0];
        delTile(i);
        if (j !== undefined) stack.push(j);
      }
    }
  };

  /** Schlüsselpfade: Ketten zwischen Bahnhöfen/Abzweigen (alle inneren Kacheln mit 2 Nachbarn). */
  const keyPaths = (terms: Terminal[]): number[][] => {
    const anchors = anchorsOf(terms);
    const isKey = (i: number): boolean => anchors.has(i) || (nb.get(i)?.length ?? 0) !== 2;
    const seen = new Set<number>();
    const paths: number[][] = [];
    for (const [u, list] of nb) {
      if (!isKey(u)) continue;
      for (const v of list) {
        if (seen.has(Math.min(u, v) * N + Math.max(u, v))) continue;
        const p = [u];
        let a = u;
        let b = v;
        while (!isKey(b)) {
          p.push(b);
          const l = nb.get(b) as number[];
          const c = l[0] === a ? l[1] : l[0];
          a = b;
          b = c;
        }
        p.push(b);
        seen.add(Math.min(u, v) * N + Math.max(u, v));
        seen.add(Math.min(a, b) * N + Math.max(a, b));
        paths.push(p);
      }
    }
    return paths;
  };

  /** Ein Schlüsselpfad-Tausch; true bei Verbesserung. */
  const exchange = (terms: Terminal[], p: number[]): boolean => {
    // noch gültig? (Kanten vorhanden, innere Kacheln weiterhin ohne Abzweig/Bahnhof)
    const anchors = anchorsOf(terms);
    for (let k = 1; k < p.length; k++) if (!nb.get(p[k - 1])?.includes(p[k])) return false;
    for (let k = 1; k < p.length - 1; k++) if (anchors.has(p[k]) || nb.get(p[k])?.length !== 2) return false;
    const before = lossOf();
    const st = snapshot(terms);
    const root = terms[0];
    const rootAnchor = root.options[root.chosen].anchor;
    for (let k = 1; k < p.length - 1; k++) delTile(p[k]);
    if (p.length === 2) delEdge(p[0], p[1]);
    // Teil mit dem Ölhafen
    markGen++;
    const stack = [rootAnchor];
    mark[rootAnchor] = markGen;
    const compA: number[] = [];
    while (stack.length) {
      const i = stack.pop() as number;
      compA.push(i);
      for (const j of nb.get(i) ?? []) {
        if (mark[j] !== markGen) {
          mark[j] = markGen;
          stack.push(j);
        }
      }
    }
    const compB = [...nb.keys()].filter((i) => mark[i] !== markGen);
    const landB = compB.filter((i) => !isWet(occ[i]));
    // Ein einzelner Bahnhof am Ende darf seine Ausfahrtsseite wechseln
    let leaf: Terminal | null = null;
    if (landB.length === 1) leaf = terms.find((t) => t.kind !== 'harbor' && t.chosen >= 0 && t.options[t.chosen].anchor === landB[0]) ?? null;
    let path: number[] | null = null;
    const sources = compA.filter((i) => !isWet(occ[i]));
    let targets: Map<number, number> | null = null;
    if (leaf) {
      for (const i of compB) delTile(i);
      unchoose(leaf);
      const tg = new Map<number, number>();
      leaf.options.forEach((o, k) => {
        if (inTree[o.anchor] || !usable(o)) return;
        if (!tg.has(o.anchor)) tg.set(o.anchor, k);
      });
      targets = tg;
      path = tg.size ? route(sources, (i) => tg.has(i), V) : null;
    } else if (landB.length) {
      const inB = new Set(landB);
      path = route(sources, (i) => inB.has(i), V);
    }
    if (path) {
      addPath(path);
      if (leaf && targets) choose(leaf, targets.get(path[path.length - 1]) as number);
      prune(terms);
      if (lossOf() < before - 1e-6) return true;
    }
    restore(st, terms);
    return false;
  };

  const improve = (terms: Terminal[], until: number): number => {
    let gains = 0;
    for (let round = 0; round < 50 && performance.now() < until; round++) {
      const paths = keyPaths(terms);
      for (let k = paths.length - 1; k > 0; k--) {
        const j = Math.floor(rnd() * (k + 1));
        [paths[k], paths[j]] = [paths[j], paths[k]];
      }
      let any = false;
      for (const p of paths) {
        if (performance.now() >= until) break;
        if (exchange(terms, p)) {
          gains++;
          any = true;
        }
      }
      if (!any) break;
    }
    return gains;
  };

  /** Raffinerie-Plätze (5×5): Häuser darunter + geschätzte Gleiskosten zum Netz, Platz für Bohrtürme. */
  const placeRefineries = (hx: number, hy: number, count: number, avoid: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> => {
    const placed: Array<{ x: number; y: number }> = [];
    const pts: Array<[number, number]> = [[hx, hy], ...plantIdx.map((i) => [out[i].x + 2, out[i].y + 2] as [number, number])];
    for (let r = 0; r < count; r++) {
      let best: { x: number; y: number; cost: number } | null = null;
      for (let y = 0; y + 5 <= h; y++) {
        for (let x = 0; x + 5 <= w; x++) {
          if (avoid.some((a) => Math.abs(a.x - x) < 8 && Math.abs(a.y - y) < 8)) continue;
          let ok = true;
          let cost = 0;
          const seen: number[] = [];
          for (let dy = 0; dy < 5 && ok; dy++) {
            for (let dx = 0; dx < 5; dx++) {
              const i = idx(x + dx, y + dy);
              if (!pass(i)) {
                ok = false;
                break;
              }
              const k = houseAt[i];
              if (k >= 0 && hit[k] === 0 && !seen.includes(k)) {
                seen.push(k);
                cost += V[k];
              }
            }
          }
          if (!ok) continue;
          if (!stationOptions(x, y).length) continue;
          // Platz für die Bohrtürme in Reichweite (grob, jede zweite Kachel)
          let room = 0;
          for (let dy = -WELL_RADIUS; dy <= WELL_RADIUS + 4; dy += 2) {
            for (let dx = -WELL_RADIUS; dx <= WELL_RADIUS + 4; dx += 2) {
              const px = x + dx;
              const py = y + dy;
              if (dx >= 0 && dx <= 4 && dy >= 0 && dy <= 4) continue;
              if (inside(px, py) && Math.hypot(px - x - 2, py - y - 2) <= WELL_RADIUS - 1 && pass(idx(px, py))) room++;
            }
          }
          if (room < 6 * WELLS_PER_REFINERY) continue;
          let near = Infinity;
          for (const [px, py] of pts) near = Math.min(near, Math.abs(px - x - 2) + Math.abs(py - y - 2));
          for (const q of placed) near = Math.min(near, Math.abs(q.x - x) + Math.abs(q.y - y));
          cost += C_EST * near;
          if (!best || cost < best.cost) best = { x, y, cost };
        }
      }
      if (!best) break;
      placed.push({ x: best.x, y: best.y });
      for (let dy = 0; dy < 5; dy++) {
        for (let dx = 0; dx < 5; dx++) {
          const i = idx(best.x + dx, best.y + dy);
          occ[i] = SERVICE;
          hitTile(i, 1);
        }
      }
    }
    return placed;
  };

  const refineryCount = wellsToPlace > 0 ? Math.ceil(wellsToPlace / WELLS_PER_REFINERY) : 0;
  /** Grundzustand einer Variante: Ölhafen und Raffinerien gesetzt, Netz leer. */
  const setupVariant = (
    hc: { x: number; y: number; t: number },
    refAvoid: Array<{ x: number; y: number }>,
  ): { terms: Terminal[]; refineries: Array<{ x: number; y: number }>; notes: string[] } | null => {
    occ.set(cell);
    hit.fill(0);
    inTree.fill(0);
    fixedRail.fill(0);
    nb = new Map();
    const notes: string[] = [];
    const sh = harborShape(hc.x, hc.y, hc.t);
    for (let dy = 0; dy < sh.h; dy++) {
      for (let dx = 0; dx < sh.w; dx++) {
        const i = idx(hc.x + dx, hc.y + dy);
        occ[i] = SERVICE;
        hitTile(i, 1);
      }
    }
    for (const [x, y] of sh.inner) fixedRail[idx(x, y)] = 1;
    const exit = idx(sh.exit[0], sh.exit[1]);
    if (!pass(exit)) return null;
    const terms: Terminal[] = [{ kind: 'harbor', sv: -1, options: [{ side: sh.side, anchor: exit, between: [] }], chosen: -1 }];
    // Feste Raffinerien aus dem Stempel werden nur angeschlossen (nicht im Ölfeld-Modus)
    const refineries = opts.fixedRefineries && !fieldMode
      ? out.filter((sv) => sv.guid === OIL_REFINERY_GUID).map((sv) => ({ x: sv.x, y: sv.y }))
      : refineryCount
        ? placeRefineries(sh.exit[0], sh.exit[1], refineryCount, refAvoid)
        : [];
    if (refineries.length < refineryCount) notes.push(`kein Platz für ${refineryCount - refineries.length} Raffinerie(n)`);
    refineries.forEach((r, k) => terms.push({ kind: 'refinery', sv: -2 - k, options: stationOptions(r.x, r.y), chosen: -1 }));
    for (const i of plantIdx) {
      const o = stationOptions(out[i].x, out[i].y);
      if (!o.length) notes.push('Kraftwerk ohne freie Ausfahrt');
      else terms.push({ kind: 'plant', sv: i, options: o, chosen: -1 });
    }
    return { terms, refineries, notes };
  };

  const noisy = (amp: number): Float64Array => {
    const v = new Float64Array(H);
    for (let k = 0; k < H; k++) v[k] = V[k] * (1 + amp * (2 * rnd() - 1));
    return v;
  };

  interface Variant {
    loss: number;
    conn: number;
    harbor: { x: number; y: number; t: number };
    refineries: Array<{ x: number; y: number }>;
    terms: Terminal[];
    state: TreeState;
    occ: Uint8Array;
    notes: string[];
  }
  let best: Variant | null = null;
  const better = (conn: number, loss: number, than: { conn: number; loss: number } | null): boolean =>
    !than || conn > than.conn || (conn === than.conn && loss < than.loss);
  /** Eine Variante: Aufbau + Verbesserung, dann Neustarts mit Rauschen bis `until`. */
  const tryVariant = (hc: { x: number; y: number; t: number }, refAvoid: Array<{ x: number; y: number }>, until: number): void => {
    const setup = setupVariant(hc, refAvoid);
    if (!setup) return;
    report.variants++;
    const base = snapshot(setup.terms);
    let vals: Float64Array = V;
    let top: { conn: number; loss: number; state: TreeState; notes: string[] } | null = null;
    do {
      restore(base, setup.terms);
      const notes = [...setup.notes, ...construct(setup.terms, vals)];
      prune(setup.terms);
      report.improvements += improve(setup.terms, until);
      const conn = connectedCount(setup.terms);
      const loss = lossOf();
      if (better(conn, loss, top)) top = { conn, loss, state: snapshot(setup.terms), notes };
      vals = noisy(0.35);
    } while (performance.now() < until);
    const t = top as { conn: number; loss: number; state: TreeState; notes: string[] };
    if (better(t.conn, t.loss, best)) {
      best = { loss: t.loss, conn: t.conn, harbor: hc, refineries: setup.refineries, terms: setup.terms, state: t.state, occ: occ.slice(), notes: t.notes };
    }
  };
  // Erst jede Ölhafen-Lage kurz, dann die beste mit der restlichen Zeit (bei Raffinerien
  // zusätzlich mit anderen Raffinerie-Plätzen)
  const quick = (Math.max(0, deadline - performance.now()) * 0.4) / harborPicks.length;
  for (const hc of harborPicks) tryVariant(hc, [], performance.now() + quick);
  if (best && performance.now() < deadline) {
    const b: Variant = best;
    const rest = deadline - performance.now();
    tryVariant(b.harbor, [], performance.now() + rest * (refineryCount ? 0.6 : 1));
    if (refineryCount && performance.now() < deadline) tryVariant(b.harbor, b.refineries, deadline);
  }
  if (!best) {
    report.notes.push('Ausfahrt des Ölhafens verbaut');
    return { services: out, rails: [], report };
  }
  const win: Variant = best;
  occ.set(win.occ);
  restore(win.state, win.terms);
  report.notes.push(...win.notes);

  // --- Kraftwerke ans Netz verschieben: ein Kraftwerk am Ende eines Astes darf auf einen Platz
  //     näher am Netz, wenn jedes Haus und jede Fabrik, die nur es versorgt, auch vom neuen Platz
  //     erreicht wird (Straßenentfernung, Reichweite wie in der Analyse). Übernommen, wenn der
  //     Einwohnerverlust (Häuser unter Kraftwerk und Gleis) sinkt.
  const moves: Array<{ sv: number; x: number; y: number }> = [];
  if (opts.relocate !== false) relocatePlants(win, Math.max(performance.now() + 1500, deadline + 0.25 * (opts.budgetMs ?? 4000)));
  function relocatePlants(v: Variant, until: number): void {
    const R0 = lookup(OIL_POWER_GUID).roadRange ?? 49;
    const reach = opts.powerReach;
    const isRoad = (i: number): boolean => cell[i] === ROAD || cell[i] === BRIDGE;
    const ringRoads = (x: number, y: number, ww: number, hh: number): number[] => {
      const r: number[] = [];
      const push = (px: number, py: number): void => {
        if (inside(px, py) && isRoad(idx(px, py))) r.push(idx(px, py));
      };
      for (let d = 0; d < ww; d++) {
        push(x + d, y - 1);
        push(x + d, y + hh);
      }
      for (let d = 0; d < hh; d++) {
        push(x - 1, y + d);
        push(x + ww, y + d);
      }
      return r;
    };
    const rangeOf = (starts: number[]): number => R0 + (reach && starts.some((i) => reach.ministryRoads[i]) ? reach.bonus : 0);
    // Straßensuche wie RoadSearch (Start 1, je Kachel +1, bis zur Reichweite)
    const rd = new Int32Array(N);
    const rs = new Int32Array(N);
    let rg = 0;
    const queue = new Int32Array(N);
    const roadBfs = (starts: number[], range: number): void => {
      rg++;
      let head = 0;
      let tail = 0;
      for (const i of starts) {
        if (rs[i] === rg) continue;
        rs[i] = rg;
        rd[i] = 1;
        queue[tail++] = i;
      }
      while (head < tail) {
        const i = queue[head++];
        if (rd[i] >= range) continue;
        const x = i % w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (j < 0 || j >= N || rs[j] === rg || !isRoad(j)) continue;
          rs[j] = rg;
          rd[j] = rd[i] + 1;
          queue[tail++] = j;
        }
      }
    };
    // Versorgte Ziele: stehende Häuser und Fabriken (Produktion, Lehmgruben)
    const targets: number[][] = [];
    const houseTarget = new Int32Array(H).fill(-1);
    s.houses.forEach((hs, k) => {
      houseTarget[k] = targets.length;
      targets.push(ringRoads(hs.x, hs.y, 3, 3));
    });
    for (const sv of out) if (sv.kind === 'production' || sv.kind === 'clayPit') targets.push(ringRoads(sv.x, sv.y, sv.w, sv.h));
    const alive = (t: number): boolean => t >= H || hit[t] === 0;
    const coverOf = (starts: number[]): Set<number> => {
      const set = new Set<number>();
      if (!starts.length) return set;
      roadBfs(starts, rangeOf(starts));
      targets.forEach((ring, t) => {
        for (const i of ring) {
          if (rs[i] === rg) {
            set.add(t);
            break;
          }
        }
      });
      return set;
    };
    const plantTerms = v.terms.filter((t) => t.kind === 'plant' && t.chosen >= 0);
    const cover = new Map<Terminal, Set<number>>();
    for (const t of plantTerms) cover.set(t, coverOf(ringRoads(out[t.sv].x, out[t.sv].y, 5, 5)));
    const count = new Int32Array(targets.length);
    for (const set of cover.values()) for (const t of set) count[t]++;
    // Entfernung zum Netz (alle Kacheln, Manhattan) für die Vorauswahl
    const netDist = new Int32Array(N);
    const refreshNetDist = (): void => {
      netDist.fill(-1);
      let head = 0;
      let tail = 0;
      for (const i of nb.keys()) {
        netDist[i] = 0;
        queue[tail++] = i;
      }
      while (head < tail) {
        const i = queue[head++];
        const x = i % w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (j < 0 || j >= N || netDist[j] >= 0) continue;
          netDist[j] = netDist[i] + 1;
          queue[tail++] = j;
        }
      }
    };
    refreshNetDist();
    const credit = 0.5 * vAvg; // freie Fläche des alten Platzes (Nachverdichtung)
    for (let round = 0; round < 3; round++) {
      let any = false;
      for (const t of plantTerms) {
        if (performance.now() > until) return;
        const p = out[t.sv];
        const anchor = t.options[t.chosen].anchor;
        if ((nb.get(anchor)?.length ?? 0) !== 1) continue; // nur Astenden
        const mine = cover.get(t) as Set<number>;
        const unique = [...mine].filter((g) => count[g] === 1 && alive(g));
        // Kandidaten in der Nähe: frei/Haus, Anschluss an Straße, nah am Netz
        const cands: Array<{ x: number; y: number; est: number }> = [];
        for (let y = p.y - 40; y <= p.y + 40; y++) {
          for (let x = p.x - 40; x <= p.x + 40; x++) {
            if (!inside(x, y) || !inside(x + 4, y + 4) || (x === p.x && y === p.y)) continue;
            let ok = true;
            let est = 0;
            const seen: number[] = [];
            for (let dy = 0; dy < 5 && ok; dy++) {
              for (let dx = 0; dx < 5; dx++) {
                const i = idx(x + dx, y + dy);
                const own = x + dx >= p.x && x + dx < p.x + 5 && y + dy >= p.y && y + dy < p.y + 5;
                if (!own && (!pass(i) || inTree[i])) {
                  ok = false;
                  break;
                }
                const hk = houseAt[i];
                if (hk >= 0 && hit[hk] === 0 && !seen.includes(hk)) {
                  seen.push(hk);
                  est += V[hk];
                }
              }
            }
            if (!ok) continue;
            let near = Infinity;
            for (const [ex, ey] of [[x + 5, y + 2], [x - 1, y + 2], [x + 2, y - 1], [x + 2, y + 5]]) {
              if (inside(ex, ey) && netDist[idx(ex, ey)] >= 0) near = Math.min(near, netDist[idx(ex, ey)]);
            }
            cands.push({ x, y, est: est + C_EST * near });
          }
        }
        cands.sort((a, b) => a.est - b.est);
        const before = lossOf();
        let bestMove: { x: number; y: number; loss: number; state: TreeState; options: Option[]; chosen: number; occ: Uint8Array; cov: Set<number> } | null = null;
        let tried = 0;
        for (const c of cands) {
          if (tried >= 12 || performance.now() > until) break;
          const starts = ringRoads(c.x, c.y, 5, 5);
          if (!starts.length) continue;
          const cov = coverOf(starts);
          if (!unique.every((g) => cov.has(g))) continue;
          tried++;
          // Probe: Ast abhängen, alten Platz frei, neuen belegen, neu anschließen
          const st = snapshot(v.terms);
          const occ0 = occ.slice();
          const opts0 = t.options;
          unchoose(t);
          prune(v.terms);
          for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) occ[idx(p.x + dx, p.y + dy)] = FREE;
          for (let dy = 0; dy < 5; dy++) {
            for (let dx = 0; dx < 5; dx++) {
              const i = idx(c.x + dx, c.y + dy);
              occ[i] = SERVICE;
              hitTile(i, 1);
            }
          }
          const options = stationOptions(c.x, c.y);
          const tg = new Map<number, number>();
          options.forEach((o, k) => {
            if (!inTree[o.anchor] && usable(o) && !tg.has(o.anchor)) tg.set(o.anchor, k);
          });
          const sources = [...nb.keys()].filter((i) => !isWet(occ[i]));
          const path = tg.size ? route(sources, (i) => tg.has(i), V) : null;
          if (path) {
            addPath(path);
            t.options = options;
            choose(t, tg.get(path[path.length - 1]) as number);
            const loss = lossOf() - credit;
            if (loss < before - 1e-6 && (!bestMove || loss < bestMove.loss)) {
              bestMove = { x: c.x, y: c.y, loss, state: snapshot(v.terms), options, chosen: t.chosen, occ: occ.slice(), cov };
            }
          }
          // zurück
          t.options = opts0;
          occ.set(occ0);
          restore(st, v.terms);
        }
        if (!bestMove) continue;
        // übernehmen
        t.options = bestMove.options;
        occ.set(bestMove.occ);
        restore(bestMove.state, v.terms);
        t.chosen = bestMove.chosen;
        for (const g of mine) count[g]--;
        for (const g of bestMove.cov) count[g]++;
        cover.set(t, bestMove.cov);
        moves.push({ sv: t.sv, x: p.x, y: p.y });
        p.x = bestMove.x;
        p.y = bestMove.y;
        report.moved++;
        any = true;
        refreshNetDist();
      }
      if (!any) break;
    }
  }

  // --- Bohrtürme: billigste 3×3-Plätze im Radius der Raffinerie (Reste verdrängter Häuser bevorzugt)
  const wellsPlaced: Array<{ x: number; y: number; owner: number }> = [];
  let left = wellsToPlace;
  win.refineries.forEach((r, k) => {
    const n = Math.min(WELLS_PER_REFINERY, Math.ceil(left / (win.refineries.length - k)));
    left -= n;
    const rcx = r.x + 2.5;
    const rcy = r.y + 2.5;
    for (let m = 0; m < n; m++) {
      let bw: { x: number; y: number; cost: number } | null = null;
      for (let y = r.y - WELL_RADIUS; y <= r.y + WELL_RADIUS + 2; y++) {
        for (let x = r.x - WELL_RADIUS; x <= r.x + WELL_RADIUS + 2; x++) {
          if (!inside(x, y) || !inside(x + 2, y + 2)) continue;
          // vorsichtig: alle vier Eckkacheln im Radius
          let ok = true;
          for (const [cx, cy] of [
            [x + 0.5, y + 0.5],
            [x + 2.5, y + 0.5],
            [x + 0.5, y + 2.5],
            [x + 2.5, y + 2.5],
          ]) {
            if (Math.hypot(cx - rcx, cy - rcy) > WELL_RADIUS) ok = false;
          }
          if (!ok) continue;
          let cost = 0;
          const seen: number[] = [];
          for (let dy = 0; dy < 3 && ok; dy++) {
            for (let dx = 0; dx < 3; dx++) {
              const i = idx(x + dx, y + dy);
              if (!pass(i) || inTree[i]) {
                ok = false;
                break;
              }
              const hk = houseAt[i];
              if (hk >= 0 && hit[hk] === 0 && !seen.includes(hk)) {
                seen.push(hk);
                cost += V[hk];
              }
            }
          }
          if (!ok) continue;
          cost += C_FREE * Math.hypot(x + 1.5 - rcx, y + 1.5 - rcy);
          if (!bw || cost < bw.cost) bw = { x, y, cost };
        }
      }
      if (!bw) {
        report.notes.push(`kein Platz für einen Bohrturm an Raffinerie ${k + 1}`);
        continue;
      }
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          const i = idx(bw.x + dx, bw.y + dy);
          occ[i] = SERVICE;
          hitTile(i, 1);
        }
      }
      wellsPlaced.push({ x: bw.x, y: bw.y, owner: OIL_OWNER_BASE + k });
    }
  });

  // --- Ergebnis übernehmen
  report.harbor = true;
  const hsh = harborShape(win.harbor.x, win.harbor.y, win.harbor.t);
  const add = (guid: number, x: number, y: number, ww: number, hh: number, turns: number, owner?: number): PlacedService => {
    const e = lookup(guid);
    const sv: PlacedService = { guid, kind: e.kind, name: e.name, x, y, w: ww, h: hh, turns, ...(owner !== undefined ? { owner } : {}) };
    out.push(sv);
    return sv;
  };
  add(OIL_HARBOR_GUID, win.harbor.x, win.harbor.y, hsh.w, hsh.h, win.harbor.t);
  const rail = new Uint8Array(N);
  for (const [x, y] of hsh.inner) rail[idx(x, y)] = 1;
  for (const i of nb.keys()) rail[i] = 1;
  win.refineries.forEach((r, k) => {
    const t = win.terms.find((tt) => tt.sv === -2 - k) as Terminal;
    const side: Side = t.chosen >= 0 ? t.options[t.chosen].side : 0;
    const existing = out.slice(0, services.length).find((sv) => sv.guid === OIL_REFINERY_GUID && sv.x === r.x && sv.y === r.y);
    if (existing) existing.turns = side;
    else add(OIL_REFINERY_GUID, r.x, r.y, 5, 5, side, OIL_OWNER_BASE + k);
    report.refineries++;
    if (t.chosen >= 0) for (const [x, y] of stationRail(r.x, r.y, side).inner) rail[idx(x, y)] = 1;
  });
  for (const wl of wellsPlaced) {
    add(OIL_WELL_GUID, wl.x, wl.y, 3, 3, 0, wl.owner);
    report.wells++;
  }
  for (const t of win.terms) {
    if (t.chosen < 0) continue;
    const o = t.options[t.chosen];
    for (const j of o.between) rail[j] = 1;
    if (t.kind === 'plant') {
      const p = out[t.sv];
      p.turns = o.side;
      for (const [x, y] of stationRail(p.x, p.y, o.side).inner) rail[idx(x, y)] = 1;
    }
    if (t.kind !== 'harbor') report.connected++;
  }
  // Häuser entfernen, Gebäudeflächen belegen
  const lost = new Set<number>();
  for (let k = 0; k < H; k++) {
    if (hit[k] <= 0) continue;
    lost.add(k);
    report.lostResidents += V[k];
    const hs = s.houses[k];
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const j = idx(hs.x + dx, hs.y + dy);
        if (cell[j] === HOUSE) cell[j] = FREE;
      }
    }
  }
  // Verschobene Kraftwerke: alter Platz frei (zuerst), neuer belegt
  for (const m of moves) for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) if (cell[idx(m.x + dx, m.y + dy)] === SERVICE) cell[idx(m.x + dx, m.y + dy)] = FREE;
  for (const sv of [...out.slice(services.length), ...moves.map((m) => out[m.sv])]) {
    for (let dy = 0; dy < sv.h; dy++) for (let dx = 0; dx < sv.w; dx++) cell[idx(sv.x + dx, sv.y + dy)] = SERVICE;
  }
  const rails: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!rail[i]) continue;
    rails.push(i);
    if (cell[i] === ROAD || cell[i] === BRIDGE) report.crossings++;
    else if (cell[i] === WATER) report.bridges++;
    if (cell[i] === FREE) cell[i] = SERVICE;
  }
  report.railTiles = rails.length;
  report.houses += lost.size;
  report.lostResidents = Math.round(report.lostResidents);
  s.houses = s.houses.filter((_, k) => !lost.has(k));
  return { services: out, rails, report };
}

/**
 * Mögliche Plätze für den Kleinen Ölhafen: ganz im Hafengebiet (ohne Hafengebiet: im offenen,
 * mit dem Kartenrand verbundenen Meer mit 12 Kacheln freiem Wasser davor), Ausfahrt auf Land.
 */
export function harborCandidates(
  mask: LandMask,
  cell: Uint8Array,
  opts: Pick<OilOptions, 'harbor' | 'blocked'>,
): Array<{ x: number; y: number; t: number; ex: number; ey: number }> {
  const { w, h } = mask;
  const N = w * h;
  const idx = (x: number, y: number): number => y * w + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  const blockedAt = (i: number): boolean => !!opts.blocked?.[i];
  let ocean: Uint8Array | null = null;
  if (!opts.harbor) {
    const oc = new Uint8Array(N);
    const stack: number[] = [];
    const seedW = (i: number): void => {
      if (!mask.data[i] && !oc[i]) {
        oc[i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < w; x++) {
      seedW(x);
      seedW((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      seedW(y * w);
      seedW(y * w + w - 1);
    }
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % w;
      if (x > 0) seedW(i - 1);
      if (x < w - 1) seedW(i + 1);
      if (i >= w) seedW(i - w);
      if (i + w < N) seedW(i + w);
    }
    ocean = oc;
  }
  const harborOk = (i: number): boolean =>
    (opts.harbor ? !!opts.harbor[i] : cell[i] === WATER && !!ocean?.[i]) && !blockedAt(i) && cell[i] !== SERVICE;
  const isLand = (i: number): boolean => cell[i] === FREE || cell[i] === HOUSE;
  const list: Array<{ x: number; y: number; t: number; ex: number; ey: number }> = [];
  for (let t = 0; t < 4; t++) {
    const probe = harborShape(0, 0, t);
    for (let y = 0; y + probe.h <= h; y++) {
      for (let x = 0; x + probe.w <= w; x++) {
        const sh = harborShape(x, y, t);
        const [ex, ey] = sh.exit;
        if (!inside(ex, ey)) continue;
        const ei = idx(ex, ey);
        if (!isLand(ei) || blockedAt(ei)) continue;
        let ok = true;
        for (let dy = 0; dy < sh.h && ok; dy++) {
          for (let dx = 0; dx < sh.w; dx++) {
            if (!harborOk(idx(x + dx, y + dy))) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;
        if (!opts.harbor) {
          const back = (sh.side + 2) % 4;
          const across = back % 2 === 0 ? sh.h : sh.w;
          let open = true;
          for (let d = 1; d <= 12 && open; d++) {
            for (let a = -4; a < across + 4; a++) {
              const px = back === 0 ? x + sh.w - 1 + d : back === 2 ? x - d : x + a;
              const py = back === 3 ? y + sh.h - 1 + d : back === 1 ? y - d : y + a;
              if (!inside(px, py) || !ocean?.[idx(px, py)]) {
                open = false;
                break;
              }
            }
          }
          if (!open) continue;
        }
        list.push({ x, y, t, ex, ey });
      }
    }
  }
  return list;
}

/**
 * Vorab-Schätzung für die Versorgungsplanung: Ausfahrt des Ölhafens nächst dem Schwerpunkt der
 * Häuser (dorthin zieht `ServiceOptions.oilRail` die Ölkraftwerke).
 */
export function estimateOilHarbor(
  mask: LandMask,
  cell: Uint8Array,
  houses: ReadonlyArray<{ x: number; y: number }>,
  opts: Pick<OilOptions, 'harbor' | 'blocked'>,
): { x: number; y: number } | null {
  if (!houses.length) return null;
  const cx = houses.reduce((a, hs) => a + hs.x + 1, 0) / houses.length;
  const cy = houses.reduce((a, hs) => a + hs.y + 1, 0) / houses.length;
  let best: { x: number; y: number; d: number } | null = null;
  for (const c of harborCandidates(mask, cell, opts)) {
    const d = Math.hypot(c.ex - cx, c.ey - cy);
    if (!best || d < best.d) best = { x: c.ex, y: c.ey, d };
  }
  return best && { x: best.x, y: best.y };
}

/** Ausfahrtskacheln der Bahnhöfe eines Plans (Ölhafen zuerst, dann Raffinerien und Ölkraftwerke). */
export function oilStationExits(services: readonly PlacedService[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const sv of services) if (sv.guid === OIL_HARBOR_GUID) out.push(harborShape(sv.x, sv.y, sv.turns).exit);
  for (const sv of services) {
    if (sv.guid === OIL_REFINERY_GUID || sv.guid === OIL_POWER_GUID) out.push(stationRail(sv.x, sv.y, (((sv.turns % 4) + 4) % 4) as Side).exit);
  }
  return out;
}

/**
 * Gleiskorridor für einen zweiten Durchgang (vor der Bebauung): Steinerbaum aus möglichst
 * langen geraden Stücken über die Ausfahrten `points` (erste = Wurzel). Jedes Abbiegen kostet
 * `turn` Kacheln – nur so kann das Straßengitter Lückenzeilen/-spalten dafür anlegen. Wasser
 * bis 12 Kacheln am Stück (Brücke). Ergebnis: Landkacheln des Korridors.
 */
export function designCorridor(mask: LandMask, points: ReadonlyArray<readonly [number, number]>, turn = 15): Uint8Array {
  const { w, h, data } = mask;
  const N = w * h;
  const out = new Uint8Array(N);
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  const pts = points.filter(([x, y]) => inside(x, y) && data[y * w + x]).map(([x, y]) => y * w + x);
  if (pts.length < 2) return out;
  const inTree = new Uint8Array(N);
  const tree: number[] = [pts[0]];
  inTree[pts[0]] = 1;
  out[pts[0]] = 1;
  const pending = new Set(pts.slice(1).filter((p) => p !== pts[0]));
  const dist = new Float64Array(N * 4);
  const prev = new Int32Array(N * 4);
  const heap = new Heap();
  while (pending.size) {
    dist.fill(Infinity);
    heap.clear();
    for (const i of tree) {
      for (let d = 0; d < 4; d++) {
        dist[i * 4 + d] = 0;
        prev[i * 4 + d] = -1;
        heap.push(0, i * 4 + d);
      }
    }
    let found = -1;
    while (heap.size) {
      const node = heap.pop();
      const dd = heap.topKey;
      if (dd > dist[node]) continue;
      const i = node >> 2;
      const from = node & 3;
      if (pending.has(i)) {
        found = node;
        break;
      }
      const x = i % w;
      const y = (i - x) / w;
      for (let dir = 0; dir < 4; dir++) {
        let nx = x + DX[dir];
        let ny = y + DY[dir];
        let k = 0;
        while (k < 12 && inside(nx, ny) && !data[ny * w + nx]) {
          k++;
          nx += DX[dir];
          ny += DY[dir];
        }
        if (!inside(nx, ny) || !data[ny * w + nx]) continue;
        const n = ny * w + nx;
        const nn = n * 4 + dir;
        const nd = dd + 1 + 2 * k + (dir !== from && dist[node] > 0 ? turn : 0);
        if (nd < dist[nn]) {
          dist[nn] = nd;
          prev[nn] = node;
          heap.push(nd, nn);
        }
      }
    }
    if (found < 0) break;
    for (let node = found; node >= 0; node = prev[node]) {
      const i = node >> 2;
      if (!inTree[i]) {
        inTree[i] = 1;
        tree.push(i);
        out[i] = 1;
      }
      if (dist[node] === 0) break;
    }
    pending.delete(found >> 2);
  }
  return out;
}

/**
 * Ölfeld: Raffinerien (je bis zu 3 Bohrtürme im Radius 12) alle zusammen nahe der Küste (zum
 * offenen Meer), ohne Gleise. Kosten: Einwohner der Häuser darunter + Abstand zur Küste + Abstand
 * zu den schon gesetzten Raffinerien. Häuser darunter werden aus `s.houses` genommen.
 */
function placeOilField(mask: LandMask, s: FillState, out: PlacedService[], opts: OilOptions, report: OilReport): void {
  const { w, h, cell } = s;
  const N = w * h;
  const idx = (x: number, y: number): number => y * w + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  const blockedAt = (i: number): boolean => !!opts.blocked?.[i];
  const houseAt = new Int32Array(N).fill(-1);
  s.houses.forEach((hs, k) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) houseAt[idx(hs.x + dx, hs.y + dy)] = k;
  });
  const vals = s.houses.map((hs) => opts.values?.get(`${hs.x},${hs.y}`) ?? 0);
  const known = vals.filter((v) => v > 0);
  const vAvg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1000;
  const V = vals.map((v) => (v > 0 ? v : vAvg));
  // Abstand zur Küste: Landkacheln am offenen Meer (Wasser vom Kartenrand aus)
  const ocean = new Uint8Array(N);
  const q: number[] = [];
  const seed = (i: number): void => {
    if (!mask.data[i] && !ocean[i] && cell[i] === WATER) {
      ocean[i] = 1;
      q.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i + w < N) seed(i + w);
  }
  const coast = new Int32Array(N).fill(-1);
  const bq: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!ocean[i]) continue;
    coast[i] = 0;
    bq.push(i);
  }
  for (let k = 0; k < bq.length; k++) {
    const i = bq[k];
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= N || coast[j] >= 0) continue;
      coast[j] = coast[i] + 1;
      bq.push(j);
    }
  }
  const removed = new Set<number>();
  const pass = (i: number): boolean => !blockedAt(i) && (cell[i] === FREE || cell[i] === HOUSE);
  const costRect = (x: number, y: number, ww: number, hh: number): number => {
    let cost = 0;
    const seen: number[] = [];
    for (let dy = 0; dy < hh; dy++) {
      for (let dx = 0; dx < ww; dx++) {
        if (!inside(x + dx, y + dy)) return Infinity;
        const i = idx(x + dx, y + dy);
        if (!pass(i)) return Infinity;
        const k = houseAt[i];
        if (k >= 0 && !removed.has(k) && !seen.includes(k)) {
          seen.push(k);
          cost += V[k];
        }
      }
    }
    return cost;
  };
  const occupy = (x: number, y: number, ww: number, hh: number): void => {
    for (let dy = 0; dy < hh; dy++) {
      for (let dx = 0; dx < ww; dx++) {
        const i = idx(x + dx, y + dy);
        const k = houseAt[i];
        if (k >= 0 && !removed.has(k)) {
          removed.add(k);
          const hs = s.houses[k];
          for (let ey = 0; ey < 3; ey++) for (let ex = 0; ex < 3; ex++) if (cell[idx(hs.x + ex, hs.y + ey)] === HOUSE) cell[idx(hs.x + ex, hs.y + ey)] = FREE;
        }
        cell[i] = SERVICE;
      }
    }
  };
  const add = (guid: number, x: number, y: number, ww: number, hh: number, owner: number): void => {
    const e = lookup(guid);
    out.push({ guid, kind: e.kind, name: e.name, x, y, w: ww, h: hh, turns: 0, owner });
  };
  const refineries = Math.ceil(opts.wells / WELLS_PER_REFINERY);
  const placed: Array<{ x: number; y: number }> = [];
  let left = opts.wells;
  for (let r = 0; r < refineries; r++) {
    let best: { x: number; y: number; cost: number } | null = null;
    for (let y = 0; y + 5 <= h; y++) {
      for (let x = 0; x + 5 <= w; x++) {
        const cd = coast[idx(x + 2, y + 2)];
        if (cd < 0) continue;
        let cost = costRect(x, y, 5, 5);
        if (!Number.isFinite(cost)) continue;
        let near = cd;
        for (const p of placed) near = Math.max(near, Math.abs(p.x - x) + Math.abs(p.y - y) - 6);
        cost += vAvg * 0.2 * near;
        if (best && cost >= best.cost) continue;
        // Platz für die Bohrtürme in Reichweite (grob)
        let room = 0;
        for (let dy = -WELL_RADIUS; dy <= WELL_RADIUS + 4 && room < 18; dy += 2) {
          for (let dx = -WELL_RADIUS; dx <= WELL_RADIUS + 4; dx += 2) {
            if (dx >= 0 && dx <= 4 && dy >= 0 && dy <= 4) continue;
            const px = x + dx;
            const py = y + dy;
            if (inside(px, py) && Math.hypot(px - x - 2, py - y - 2) <= WELL_RADIUS - 1 && pass(idx(px, py))) room++;
          }
        }
        if (room < 18) continue;
        best = { x, y, cost };
      }
    }
    if (!best) {
      report.notes.push(`kein Platz für Raffinerie ${r + 1} des Ölfelds`);
      break;
    }
    occupy(best.x, best.y, 5, 5);
    add(OIL_REFINERY_GUID, best.x, best.y, 5, 5, OIL_OWNER_BASE + r);
    placed.push(best);
    report.refineries++;
    const n = Math.min(WELLS_PER_REFINERY, Math.ceil(left / (refineries - r)));
    left -= n;
    const rcx = best.x + 2.5;
    const rcy = best.y + 2.5;
    for (let m = 0; m < n; m++) {
      let bw: { x: number; y: number; cost: number } | null = null;
      for (let y = best.y - WELL_RADIUS; y <= best.y + WELL_RADIUS + 2; y++) {
        for (let x = best.x - WELL_RADIUS; x <= best.x + WELL_RADIUS + 2; x++) {
          const corners: Array<[number, number]> = [
            [x + 0.5, y + 0.5],
            [x + 2.5, y + 0.5],
            [x + 0.5, y + 2.5],
            [x + 2.5, y + 2.5],
          ];
          if (corners.some(([cx, cy]) => Math.hypot(cx - rcx, cy - rcy) > WELL_RADIUS)) continue;
          let cost = costRect(x, y, 3, 3);
          if (!Number.isFinite(cost)) continue;
          cost += 1e-3 * vAvg * Math.hypot(x + 1.5 - rcx, y + 1.5 - rcy);
          if (!bw || cost < bw.cost) bw = { x, y, cost };
        }
      }
      if (!bw) {
        report.notes.push(`kein Platz für einen Bohrturm an Raffinerie ${r + 1}`);
        continue;
      }
      occupy(bw.x, bw.y, 3, 3);
      add(OIL_WELL_GUID, bw.x, bw.y, 3, 3, OIL_OWNER_BASE + r);
      report.wells++;
    }
  }
  for (const k of removed) report.lostResidents += V[k];
  report.houses += removed.size;
  report.lostResidents = Math.round(report.lostResidents);
  s.houses = s.houses.filter((_, k) => !removed.has(k));
}
