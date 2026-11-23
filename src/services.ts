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
import { skyscraperResidents, UNIVERSITY_MAX_RANGE, universityFactor, type SkyLevel, type SkyTier } from './rules';
import { BLOCKED, BRIDGE, FREE, HOUSE, isWay, ROAD, SERVICE, WATER, touchesBridge, touchesRoad, type FillState } from './fill';
import { findFormations, PRODUCTION_WAREHOUSE_RANGE, type ProductionOptions, type ProductionReport } from './production';

export interface PlacedService {
  guid: number;
  kind: BuildingKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  turns: number;
  /** Gemeinsame Komplex-ID (Lufthafen + Module). */
  owner?: number;
}

export interface ServiceSpec {
  kind: BuildingKind;
  guid: number;
  /**
   * Einwohner je versorgtem Haus (Mittel Ingenieur/Investor, Stufe 3, Wiki
   * „Needs“), zusätzlich im Rathausradius (Zofe/Saint), zusätzlich im
   * Rathausradius, wenn Waren nur über den Lieferdienst kommen.
   */
  value: number;
  itemValue: number;
  deliveryValue: number;
  /**
   * Betriebsaufwand je Gebäude in Einwohner-Gegenwert: Läden brauchen 240
   * Handwerker, drei Waren und Strom; das Kraftwerk Gas und Arbeitskraft.
   */
  fixedCost: number;
  /**
   * Optionales Gebäude ohne Einwohner-Wirkung (Feuerwache, Polizei, Hospital,
   * Bank, Varieté, Clubhaus): `value` ist dann ein Abdeckungswert je Haus,
   * damit (fast) alle Häuser mit möglichst wenig Verlust erreicht werden.
   */
  optional?: boolean;
}

/**
 * Reihenfolge = Priorität. Strom: Ingenieure 2 / Investoren 8 plus +5 je
 * Panorama-Stufe (Strom ist eines der Panorama-Bedürfnisse) ≈ 30 bei intensiv.
 * Drogerie wirkt nur bei Ingenieuren (Investoren erst
 * ab Stufe 5): 5 + Zofe 5; mit Lieferdienst-Violinen zusätzlich 5 + Zofe 5.
 * Kaufhaus: 20/25 + Zofe 5; mit Lieferdienst-Kaugummi zusätzlich 10.
 * Universität: Ingenieure 6 (+ Saint 2), abgeschwächt bis 131 Kacheln.
 */
export const SERVICE_SPECS: readonly ServiceSpec[] = [
  { kind: 'departmentStore', guid: 135100, value: 22.5, itemValue: 5, deliveryValue: 10, fixedCost: 450 },
  { kind: 'furnitureStore', guid: 135099, value: 10, itemValue: 5, deliveryValue: 0, fixedCost: 450 },
  { kind: 'powerPlant', guid: 117547, value: 30, itemValue: 0, deliveryValue: 0, fixedCost: 225 },
  { kind: 'university', guid: 1010362, value: 3, itemValue: 1, deliveryValue: 0, fixedCost: 0 },
  { kind: 'drugStore', guid: 134629, value: 2.5, itemValue: 2.5, deliveryValue: 5, fixedCost: 450 },
  // Optional (keine Einwohner): Abdeckungswert 30 je Haus → ein Gebäude lohnt,
  // solange es deutlich mehr Häuser neu erreicht, als es verdrängt.
  { kind: 'fireStation', guid: 1010463, value: 30, itemValue: 0, deliveryValue: 0, fixedCost: 0, optional: true },
  { kind: 'policeStation', guid: 1010462, value: 30, itemValue: 0, deliveryValue: 0, fixedCost: 0, optional: true },
  { kind: 'hospital', guid: 1010464, value: 30, itemValue: 0, deliveryValue: 0, fixedCost: 0, optional: true },
  { kind: 'bank', guid: 1010365, value: 30, itemValue: 0, deliveryValue: 0, fixedCost: 0, optional: true },
  { kind: 'varietyTheatre', guid: 1010361, value: 30, itemValue: 0, deliveryValue: 0, fixedCost: 0, optional: true },
  { kind: 'membersClub', guid: 1010364, value: 30, itemValue: 0, deliveryValue: 0, fixedCost: 0, optional: true },
];

export const WAREHOUSE_GUID = 1010371;
export const TRADE_UNION_GUID = 1010516;
export const CLAY_PIT_GUID = 100416;
export const MINISTRY_GUID = 269602;
/** Palast (9×9) und Palastflügel (3×3) – Palastinsel (Crown Falls). */
export const PALACE_GUID = 249947;
export const PALACE_WING_GUID = 249950;
export const PALACE_OWNER = 9002;

/** Teil eines Komplexes (Hauptgebäude oder Modul) im ungedrehten Rechteck. */
export interface ComplexPart {
  guid: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Gebäude mit Modulen als Rechteck aus gleich großen Feldern (`cw` × `ch` Kacheln):
 * Hauptgebäude (`mainCols` × `mainRows` Felder) unten in der Mitte – seine Unterkante
 * liegt außen, dort hängt es an der Straße –, Module links, rechts und darüber, alle über
 * Nachbarn mit dem Hauptgebäude verbunden (nahe zuerst). Nicht gebrauchte Felder (obere
 * Ecken) bleiben frei. `shape` wählt zwischen gleich großen Formen (0 = möglichst quadratisch,
 * 1 = breit, 2 = hoch).
 */
export function moduleComplex(
  spec: { main: number; module: number; cw: number; ch: number; mainCols: number; mainRows: number },
  n: number,
  shape = 0,
): { w: number; h: number; main: ComplexPart; modules: ComplexPart[] } {
  const count = Math.max(0, Math.round(n));
  const { cw, ch, mainCols, mainRows } = spec;
  let best: { a: number; b: number; score: number } | null = null;
  for (let a = 0; a <= 40; a++) {
    for (let b = 0; b <= 80; b++) {
      const cols = mainCols + 2 * a;
      const rows = mainRows + b;
      if (cols * rows - mainCols * mainRows < count) continue;
      const W = cols * cw;
      const H = rows * ch;
      const area = W * H;
      const skew = shape === 1 ? H / W : shape === 2 ? W / H : Math.max(W / H, H / W);
      const score = area * (1 + 0.15 * skew);
      if (!best || score < best.score) best = { a, b, score };
      break;
    }
  }
  const { a, b } = best ?? { a: 0, b: 0 };
  const cols = mainCols + 2 * a;
  const rows = mainRows + b;
  const isMain = (c: number, r: number): boolean => c >= a && c < a + mainCols && r >= b && r < b + mainRows;
  const seen = new Set<string>();
  const queue: Array<[number, number]> = [];
  for (let c = a; c < a + mainCols; c++) for (let r = b; r < b + mainRows; r++) {
    seen.add(`${c},${r}`);
    queue.push([c, r]);
  }
  for (let q = 0; q < queue.length; q++) {
    const [c, r] = queue[q];
    for (const [dc, dr] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || seen.has(`${nc},${nr}`)) continue;
      seen.add(`${nc},${nr}`);
      queue.push([nc, nr]);
    }
  }
  const cells = queue.filter(([c, r]) => !isMain(c, r)).slice(0, count);
  return {
    w: cols * cw,
    h: rows * ch,
    main: { guid: spec.main, x: a * cw, y: b * ch, w: mainCols * cw, h: mainRows * ch },
    modules: cells.map(([c, r]) => ({ guid: spec.module, x: c * cw, y: r * ch, w: cw, h: ch })),
  };
}

/** Palast (9×9) mit Flügeln (3×3). */
export const PALACE_SPEC = { main: 249947, module: 249950, cw: 3, ch: 3, mainCols: 3, mainRows: 3 };
/** Museum (8×5) mit Museumsmodulen (4×5, GUID im Stempel 100454); höchstens 100 Module. */
export const MUSEUM_GUID = 1010471;
export const MUSEUM_MODULE_GUID = 100454;
export const MUSEUM_SPEC = { main: MUSEUM_GUID, module: MUSEUM_MODULE_GUID, cw: 4, ch: 5, mainCols: 2, mainRows: 1 };
export const MUSEUM_OWNER_BASE = 9100;

export function palaceComplex(wings: number): ReturnType<typeof moduleComplex> {
  return moduleComplex(PALACE_SPEC, wings);
}

/** Rechteck des Ministeriums für Reichweiten: Regionalministerium oder Palast mit Flügeln. */
export function ministryRect(services: readonly PlacedService[]): { x: number; y: number; w: number; h: number } | undefined {
  const dep = services.find((sv) => sv.kind === 'localDepartment');
  if (dep) return dep;
  const parts = services.filter((sv) => sv.kind === 'palace' || sv.kind === 'palaceWing');
  if (!parts.length) return undefined;
  const x = Math.min(...parts.map((p) => p.x));
  const y = Math.min(...parts.map((p) => p.y));
  return { x, y, w: Math.max(...parts.map((p) => p.x + p.w)) - x, h: Math.max(...parts.map((p) => p.y + p.h)) - y };
}
export const AIRPORT_GUID = 962;
export const AIRPORT_MODULES = [966, 964];
const AIRPORT_OWNER = 9001;

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
  /** Kaugummi/Violinen nur über den Lieferdienst (siehe RuleConfig.deliveryGoods). */
  deliveryGoods?: boolean;
  /**
   * Geplante Schicht/Stufe je Haus (Schlüssel „x,y“ der linken oberen Kachel),
   * z. B. aus der Stufen-Optimierung. Dann wird je Haus genau gerechnet, was
   * ein Gebäude bringt (z. B. Universität nur für Ingenieure, Drogerie für
   * Ingenieure und Investoren 5); sonst Mittelwerte.
   */
  houseStates?: Map<string, { tier: SkyTier; level: SkyLevel }>;
  townHallItems?: boolean;
  /**
   * Regionalministerium vor der Versorgung setzen: Gebäude in seiner
   * Straßenreichweite bekommen Wohlfahrt (öffentliche Gebäude: Universität,
   * Kraftwerk …) und ggf. Stadtweites Netz (Kraftwerke). Läden sind nicht
   * betroffen.
   */
  /** `townHalls`: Ministerium für Verwaltung – möglichst viele Rathäuser in Reichweite. */
  ministry?: {
    range: number;
    welfare: number;
    web: number;
    townHalls?: boolean;
    /** Palastinsel: Palast mit so vielen Flügeln statt Regionalministerium (Reichweite 71 + 3 je Flügel). */
    palace?: { wings: number };
  };
  /**
   * Palastinsel: Museen mit Modulen für die Attraktivität, die bis `target` fehlt (Kultur
   * zuletzt). `base` = sicher ohne Museen (Palast, Flügel …), dazu Rathausreform je Rathaus
   * im Palastbereich. Das erste Set ist „Götter des Deltas“ (+ je Rathaus/Handelskammer),
   * alle weiteren das beste 3er-Set (`perSet`). Höchstens `maxModules` Module je Museum.
   */
  culture?: {
    target: number;
    base: number;
    perTownHallInRange: number;
    deltaSet: number;
    perTownHall: number;
    perTradeUnion: number;
    perSet: number;
    moduleSet: number;
    maxModules: number;
  };
  /**
   * Lehmgruben (verschiebbare Vorkommen): je Cluster bis zu 8 Gruben im Radius einer
   * Handelskammer, dazu ein Lagerhaus – als Block mit Ringstraße.
   */
  clay?: { count: number };
  /** Keine Straßen überbauen (Wege der übrigen Gebäude bleiben exakt wie geplant). */
  keepRoads?: boolean;
  /**
   * Lufthafen (15×10) mit Item-Terminal und Luftpostlager (je 3×5) an einer
   * langen Seite – wie im im Spiel geprüften Katalog-Teststempel. Möglichst
   * weit weg von der Hauptanlegestelle (`harbor`, Maskenkoordinaten), möglichst
   * wenige Häuser verdrängt. Zählt als Lagerhaus.
   */
  airport?: { harbor: { x: number; y: number } | null };
  /**
   * Geclippte Produktion (production.ts): gewünschte Gebäude zwischen je zwei
   * Handelskammern, vor allen anderen Gebäuden gesetzt (starre Formation).
   */
  production?: ProductionOptions;
  /**
   * Exakter Löser (HiGHS, WebAssembly) für die Ladenplatzierung: ganzzahliges
   * Überdeckungsproblem über die besten Kandidaten nach Gierig + lokaler Suche.
   * Fehlt er, bleibt es bei Gierig + lokaler Suche.
   */
  mip?: MipSolver;
}

/** Minimale Schnittstelle von `highs` (LP-Text im CPLEX-Format). */
export interface MipSolver {
  solve(lp: string, opts?: Record<string, unknown>): { Status: string; Columns?: Record<string, { Primal?: number }> };
}

export interface ServiceReport {
  placed: Partial<Record<BuildingKind, number>>;
  /** Lufthafen gesetzt (Abstand zur Anlegestelle in Kacheln, verdrängte Häuser). */
  airport: { placed: boolean; distance: number; houses: number };
  /** Regionalministerium gesetzt (und wie viele Häuser in seiner Reichweite liegen). */
  ministry: { placed: boolean; houses: number };
  /** Lehmgruben-Cluster (Handelskammer + Gruben + Lagerhaus). */
  clay?: { clusters: number; pits: number; houses: number };
  /** Museen für die Attraktivität (Palastinsel). */
  culture?: { museums: number; modules: number; attr: number; known: number; missing: number; houses: number };
  warehouses: number;
  removedHouses: number;
  /** Anteil der verbleibenden Häuser, die je Art versorgt sind. */
  coverage: Partial<Record<BuildingKind, number>>;
  production?: ProductionReport;
  /** Exakter Löser: Aufrufe, Verbesserungen und Gewinn (Einwohner-Bewertung). */
  mip: { tried: number; improved: number; same: number; failed: number; gain: number };
}

/**
 * Exakter Löser: so viele Kandidaten je Art (nach Einzelwert) und so viele
 * Sekunden je Modell. Mit allen ~4500 Kandidaten findet HiGHS in 20 s nicht
 * einmal die gierige Lösung; 220 Kandidaten bestätigen sie fast immer.
 */
const MIP_POOL = 500;
const MIP_SECONDS = 6;

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
  const report: ServiceReport = { placed: {}, airport: { placed: false, distance: 0, houses: 0 }, ministry: { placed: false, houses: 0 }, warehouses: 0, removedHouses: 0, coverage: {}, mip: { tried: 0, improved: 0, same: 0, failed: 0, gain: 0 } };
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
      const visit = (j: number): void => {
        if (!isWay(cell[j]) || gen[j] === g) return;
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
    // Nur Landstraßen: jedes Ufer bleibt für sich zusammenhängend (Brücken keine Sackgassen).
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
  const candidatesFor = (guid: number, rect?: { w: number; h: number; maxRoads: number }): Candidate[] => {
    const entry = lookup(guid);
    const out: Candidate[] = [];
    const seenShape = new Set<string>();
    // Große Flächen (Palast, Museen): gesperrte Kacheln per Präfixsumme vorab ausschließen und
    // in Zweierschritten suchen – sonst dauert die Suche auf großen Inseln zu lange.
    const big = !!rect && rect.w * rect.h > 400;
    let blockedSum: Int32Array | null = null;
    if (big) {
      blockedSum = new Int32Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
          const c = cell[y * w + x];
          if (c === WATER || c === BLOCKED || c === SERVICE || c === BRIDGE) row++;
          blockedSum[(y + 1) * (w + 1) + x + 1] = blockedSum[y * (w + 1) + x + 1] + row;
        }
      }
    }
    const blockedIn = (x: number, y: number, bw: number, bh: number): number => {
      const S = blockedSum as Int32Array;
      const W1 = w + 1;
      return S[(y + bh) * W1 + x + bw] - S[y * W1 + x + bw] - S[(y + bh) * W1 + x] + S[y * W1 + x];
    };
    const step = big ? 2 : 1;
    for (const turns of [0, 1]) {
      const { w: bw, h: bh } = rect ? (turns ? { w: rect.h, h: rect.w } : rect) : footprint(entry, turns);
      const shape = `${bw}x${bh}`;
      if (seenShape.has(shape)) continue;
      seenShape.add(shape);
      for (let y = 0; y + bh <= h; y += step) {
        for (let x = 0; x + bw <= w; x += step) {
          if (big && blockedIn(x, y, bw, bh) > 0) continue;
          let ok = true;
          const hs = new Set<number>();
          const roads: number[] = [];
          for (let dy = 0; dy < bh && ok; dy++) {
            for (let dx = 0; dx < bw; dx++) {
              const i = (y + dy) * w + x + dx;
              const c = cell[i];
              if (c === WATER || c === BLOCKED || c === SERVICE || c === BRIDGE) {
                ok = false;
                break;
              }
              if (c === HOUSE) hs.add(houseAt[i]);
              else if (c === ROAD) roads.push(i);
            }
          }
          if (!ok) continue;
          // Straßen unter der Fläche nur als Querstraßen-Stück (höchstens eine Zeile/Spalte),
          // nie ein Brückenkopf.
          if (roads.length > (options.keepRoads ? 0 : (rect?.maxRoads ?? Math.max(bw, bh))) || roads.some((i) => touchesBridge(cell, w, i))) continue;
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
        if (v === WATER || v === BLOCKED || v === SERVICE || v === BRIDGE) return false;
      }
    }
    if (!c.starts.some((i) => cell[i] === ROAD)) return false;
    if (!c.roads.length) return true;
    if (c.roads.some((i) => cell[i] !== ROAD)) return false;
    // Straßen probeweise wegnehmen: Netz zusammenhängend, alle Häuser/Gebäude angeschlossen?
    // (Gebäude ohne eigenen Anschluss – Module, innere Palastflügel – zählen nicht.)
    const had = services.map((sv) => ring(sv.x, sv.y, sv.w, sv.h).some((i) => cell[i] === ROAD));
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
      services.forEach((sv, k) => {
        if (had[k] && ring(sv.x, sv.y, sv.w, sv.h).every((i) => cell[i] !== ROAD)) ok = false;
      });
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

  // --- Geclippte Produktion: starre Formation zuerst (Handelskammern im
  //     Abstand 30, Gebäude auf den Kantenmitten). Die besten Formationen der
  //     Suche im echten Plan durchrechnen: Straßenstücke, die dabei vom Netz
  //     abgeschnitten werden (z. B. zwischen zwei Gebäuden auf derselben
  //     Längsstraße), entfallen; Häuser ohne Anschluss weichen mit. Jedes
  //     Gebäude und jede Kammer braucht eine Straße. Gewählt wird die Formation
  //     mit dem geringsten tatsächlichen Verlust.
  if (options.production && options.production.requests.some((r) => r.count > 0)) {
    const requested = options.production.requests.reduce((n, r) => n + Math.max(0, r.count), 0);
    const pr: ProductionReport = { requested, placed: 0, byGuid: {}, tradeUnions: 0, lattice: '', houses: 0, powerPlants: 0 };
    report.production = pr;
    const N = w * h;
    /** Zusammenhangskomponenten der Wege (Straße + Brücke). */
    const labelWays = (): { label: Int32Array; size: number[] } => {
      const label = new Int32Array(N).fill(-1);
      const size: number[] = [];
      const stack: number[] = [];
      for (let i0 = 0; i0 < N; i0++) {
        if (label[i0] >= 0 || !isWay(cell[i0])) continue;
        const id = size.length;
        let n = 0;
        label[i0] = id;
        stack.push(i0);
        while (stack.length) {
          const i = stack.pop() as number;
          n++;
          const x = i % w;
          for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
            if (j < 0 || j >= N || label[j] >= 0 || !isWay(cell[j])) continue;
            label[j] = id;
            stack.push(j);
          }
        }
        size.push(n);
      }
      return { label, size };
    };
    const original = labelWays().label;
    const MAX_FRAGMENT = 40;
    type Trial = { cost: number; own: Set<number>; orphans: number[]; fragments: number[]; tiles: Map<number, number> };
    const trial = (f: (typeof formations)[number]): Trial | null => {
      const tiles = new Map<number, number>();
      const own = new Set<number>();
      for (const r of f.rects) {
        for (let dy = 0; dy < r.h; dy++) {
          for (let dx = 0; dx < r.w; dx++) {
            const i = (r.y + dy) * w + r.x + dx;
            const v = cell[i];
            if (v === WATER || v === BLOCKED || v === SERVICE || v === BRIDGE || tiles.has(i) || touchesBridge(cell, w, i)) return null;
            tiles.set(i, v);
            if (v === HOUSE) own.add(houseAt[i]);
          }
        }
      }
      for (const i of tiles.keys()) cell[i] = SERVICE;
      // Abgeschnittene Wegstücke: je ursprünglichem Netz bleibt das größte Stück.
      const after = labelWays();
      const keep = new Map<number, { id: number; n: number }>();
      for (let i = 0; i < N; i++) {
        const a = after.label[i];
        if (a < 0) continue;
        const o = original[i];
        const k = keep.get(o);
        if (!k || (k.id !== a && after.size[a] > k.n)) keep.set(o, { id: a, n: after.size[a] });
      }
      const fragments: number[] = [];
      let tooBig = false;
      const counted = new Set<number>();
      for (let i = 0; i < N; i++) {
        const a = after.label[i];
        if (a < 0 || keep.get(original[i])?.id === a) continue;
        fragments.push(i);
        if (!counted.has(a)) {
          counted.add(a);
          if (after.size[a] > MAX_FRAGMENT) tooBig = true;
        }
      }
      let result: Trial | null = null;
      if (!tooBig) {
        for (const i of fragments) cell[i] = FREE;
        if (f.rects.every((r) => ring(r.x, r.y, r.w, r.h).some((i) => cell[i] === ROAD))) {
          const orphans: number[] = [];
          for (let k = 0; k < s.houses.length; k++) {
            if (own.has(k) || !isAlive(k)) continue;
            if (!houseRing[k].some((i) => cell[i] === ROAD)) orphans.push(k);
          }
          let cost = 0;
          for (const k of own) cost += houseCost(k);
          for (const k of orphans) cost += houseCost(k);
          result = { cost, own, orphans, fragments, tiles };
        }
        for (const i of fragments) cell[i] = ROAD;
      }
      for (const [i, v] of tiles) cell[i] = v;
      return result;
    };
    const formations = findFormations(s, options.production.requests, houseCost, 40, !!options.production.tiltedSquare);
    let best: { f: (typeof formations)[number]; t: Trial } | null = null;
    for (const f of formations) {
      if (best && f.placed < best.f.placed) break;
      const t = trial(f);
      if (t && (!best || t.cost < best.t.cost)) best = { f, t };
    }
    if (best) {
      const { f, t } = best;
      for (const i of t.tiles.keys()) cell[i] = SERVICE;
      for (const i of t.fragments) {
        cell[i] = FREE;
        origRoad[i] = 0;
      }
      for (const k of [...t.own, ...t.orphans]) removedBy[k]++;
      for (const r of f.rects) {
        const entry = lookup(r.guid);
        services.push({ guid: r.guid, kind: entry.kind, name: entry.name, x: r.x, y: r.y, w: r.w, h: r.h, turns: r.turns });
        if (entry.kind === 'production') pr.byGuid[r.guid] = (pr.byGuid[r.guid] ?? 0) + 1;
      }
      pr.placed = f.placed;
      pr.tradeUnions = f.tradeUnions;
      pr.lattice = f.lattice;
      pr.houses = t.own.size + t.orphans.length;
    }
  }

  // --- Lufthafen mit zwei Modulen: weit weg von der Anlegestelle, wenig Verlust.
  //     Lufthafen 15×10 (Drehung 0), Module je 3×5 nebeneinander an der langen
  //     Seite (unten oder oben, links- oder rechtsbündig).
  const airportStarts: number[] = [];
  if (options.airport) {
    const AW = 15;
    const AH = 10;
    const MW = 3;
    const MH = 5;
    const variants: Array<Array<[number, number, number, number]>> = [];
    for (const below of [true, false]) {
      for (const left of [true, false]) {
        const mx = left ? 0 : AW - 2 * MW;
        const my = below ? AH : -MH;
        variants.push([
          [0, 0, AW, AH],
          [mx, my, MW, MH],
          [mx + MW, my, MW, MH],
        ]);
      }
    }
    const harbor = options.airport.harbor;
    // Kacheln im Rathausradius („versorgter Platz“): dort ist jedes Haus wegen
    // der Rathaus-Items mehr wert – der Lufthafen soll diesen Platz meiden.
    const rhTile = new Uint8Array(w * h);
    for (const t of townHalls) {
      const tcx = t.x + 2;
      const tcy = t.y + 2;
      for (let y = Math.max(0, Math.floor(tcy - 21)); y < Math.min(h, Math.ceil(tcy + 21)); y++) {
        for (let x = Math.max(0, Math.floor(tcx - 21)); x < Math.min(w, Math.ceil(tcx + 21)); x++) {
          if (Math.hypot(x + 0.5 - tcx, y + 0.5 - tcy) <= 20) rhTile[y * w + x] = 1;
        }
      }
    }
    const RH_TILE_COST = 5;
    const ROAD_TILE_COST = 3;
    const DIST_WEIGHT = 0.5;
    type AirCand = { rects: Array<[number, number, number, number]>; value: number; houses: number[]; dist: number; roads: number[] };
    const found: AirCand[] = [];
    for (const rel of variants) {
      const minY = Math.min(...rel.map((r) => r[1]));
      const maxY = Math.max(...rel.map((r) => r[1] + r[3]));
      for (let y = -minY; y + maxY <= h; y++) {
        for (let x = 0; x + AW <= w; x++) {
          let ok = true;
          const hs = new Set<number>();
          const roads: number[] = [];
          let rhCount = 0;
          for (const [rx, ry, rw, rh] of rel) {
            for (let dy = 0; dy < rh && ok; dy++) {
              for (let dx = 0; dx < rw; dx++) {
                const i = (y + ry + dy) * w + x + rx + dx;
                const c = cell[i];
                if (c === HOUSE) hs.add(houseAt[i]);
                else if (c === ROAD && !touchesBridge(cell, w, i)) roads.push(i);
                else if (c !== FREE) {
                  ok = false;
                  break;
                }
                if (rhTile[i]) rhCount++;
              }
            }
            if (!ok) break;
          }
          if (!ok) continue;
          let cost = 0;
          for (const k of hs) cost += houseCost(k);
          cost += rhCount * RH_TILE_COST + roads.length * ROAD_TILE_COST;
          const dist = harbor ? Math.hypot(x + AW / 2 - harbor.x, y + AH / 2 - harbor.y) : 0;
          // Wenig verdrängte Häuser und wenig Rathaus-Fläche zählen; der Abstand zur
          // Anlegestelle entscheidet nur bei fast Gleichstand (0,5 je Kachel).
          found.push({ rects: rel.map(([rx, ry, rw, rh]) => [x + rx, y + ry, rw, rh]), value: dist * DIST_WEIGHT - cost, houses: [...hs], dist, roads });
        }
      }
    }
    found.sort((p, q) => q.value - p.value);
    // Gültig: Straßen darunter dürfen weg, wenn das Netz zusammenhängt, alle
    // übrigen Häuser/Gebäude angeschlossen bleiben und der Lufthafen selbst
    // eine Straße berührt.
    let best: (AirCand & { starts: number[] }) | null = null;
    // Nicht nur die besten 400: liegen sie alle an derselben ungünstigen Stelle
    // (Netz würde getrennt), weiter suchen – höchstens ≈ 3 s.
    const airDeadline = performance.now() + 3000;
    for (let fi = 0; fi < found.length; fi++) {
      const c = found[fi];
      if (fi >= 400 && performance.now() > airDeadline) break;
      for (const i of c.roads) cell[i] = SERVICE;
      let ok = !separates(c.roads);
      if (ok) {
        const own = new Set(c.houses);
        for (const i of c.roads) {
          for (const n of [i - 1, i + 1, i - w, i + w]) {
            if (n < 0 || n >= cell.length || cell[n] !== HOUSE || own.has(houseAt[n])) continue;
            const hs = s.houses[houseAt[n]];
            if (!touchesRoad(s, hs.x, hs.y)) ok = false;
          }
        }
        for (const sv of services) if (ring(sv.x, sv.y, sv.w, sv.h).every((i) => cell[i] !== ROAD)) ok = false;
      }
      const [ax, ay] = c.rects[0];
      const starts = ring(ax, ay, AW, AH).filter((i) => cell[i] === ROAD);
      for (const i of c.roads) cell[i] = ROAD;
      if (ok && starts.length) {
        best = { ...c, starts };
        break;
      }
    }
    if (best) {
      const guids = [AIRPORT_GUID, ...AIRPORT_MODULES];
      best.rects.forEach(([rx, ry, rw, rh], k) => {
        for (let dy = 0; dy < rh; dy++) for (let dx = 0; dx < rw; dx++) cell[(ry + dy) * w + rx + dx] = SERVICE;
        const entry = lookup(guids[k]);
        services.push({ guid: guids[k], kind: entry.kind, name: entry.name, x: rx, y: ry, w: rw, h: rh, turns: 0, owner: AIRPORT_OWNER });
      });
      for (const k of best.houses) removedBy[k]++;
      airportStarts.push(...best.starts);
      report.airport = { placed: true, distance: Math.round(best.dist), houses: best.houses.length };
    }
  }

  // --- Komplexe (Palast mit Flügeln, Museum mit Modulen): Ausrichtung und Platzierung.
  type Complex = ReturnType<typeof moduleComplex>;
  /** Teile je Drehung (0 = Hauptgebäude unten, 1/3 = seitlich, 2 = oben), in Kartenkoordinaten. */
  const complexParts = (c: Candidate, cx: Complex): Array<{ main: ComplexPart & { turns: number }; modules: Array<ComplexPart & { turns: number }> }> => {
    const out: Array<{ main: ComplexPart & { turns: number }; modules: Array<ComplexPart & { turns: number }> }> = [];
    const turned = c.turns === 1;
    for (let side = 0; side < 4; side++) {
      const swap = side % 2 === 1;
      if (cx.w !== cx.h && swap !== turned) continue;
      const tf = (p: ComplexPart): ComplexPart & { turns: number } => {
        let r: { x: number; y: number; w: number; h: number };
        if (side === 0) r = { x: p.x, y: p.y, w: p.w, h: p.h };
        else if (side === 2) r = { x: cx.w - p.x - p.w, y: cx.h - p.y - p.h, w: p.w, h: p.h };
        else if (side === 1) r = { x: cx.h - p.y - p.h, y: p.x, w: p.h, h: p.w };
        else r = { x: p.y, y: cx.w - p.x - p.w, w: p.h, h: p.w };
        return { guid: p.guid, x: c.x + r.x, y: c.y + r.y, w: r.w, h: r.h, turns: swap ? 1 : 0 };
      };
      out.push({ main: tf(cx.main), modules: cx.modules.map(tf) });
    }
    return out;
  };
  /** Beste Drehung: die meisten Straßen am Hauptgebäude; −1 = Hauptgebäude ohne Straße. */
  const complexSide = (c: Candidate, cx: Complex): number => {
    let best = -1;
    let most = 0;
    complexParts(c, cx).forEach((r, k) => {
      const n = ring(r.main.x, r.main.y, r.main.w, r.main.h).filter((i) => cell[i] === ROAD && !c.roads.includes(i)).length;
      if (n > most) {
        most = n;
        best = k;
      }
    });
    return best;
  };
  /**
   * Große Blöcke (Palast, Museen) mit Ringstraße: Der Kandidat ist 1 Kachel größer als der
   * Komplex; der Rand wird Straße. So bleiben zerschnittene Längsstraßen über den Ring
   * verbunden und das Hauptgebäude hat immer Anschluss.
   */
  const borderOf = (c: Candidate): number[] => {
    const out: number[] = [];
    for (let dy = 0; dy < c.h; dy++) {
      for (let dx = 0; dx < c.w; dx++) {
        if (dx === 0 || dy === 0 || dx === c.w - 1 || dy === c.h - 1) out.push((c.y + dy) * w + c.x + dx);
      }
    }
    return out;
  };
  const innerOf = (c: Candidate): Candidate => {
    const border = new Set(borderOf(c));
    return { ...c, x: c.x + 1, y: c.y + 1, w: c.w - 2, h: c.h - 2, roads: c.roads.filter((i) => !border.has(i)) };
  };
  const validRinged = (c: Candidate): boolean => {
    for (let dy = 0; dy < c.h; dy++) {
      for (let dx = 0; dx < c.w; dx++) {
        const v = cell[(c.y + dy) * w + c.x + dx];
        if (v === WATER || v === BLOCKED || v === SERVICE || v === BRIDGE) return false;
      }
    }
    if (c.roads.some((i) => cell[i] !== ROAD)) return false;
    const border = borderOf(c);
    const innerRoads = innerOf(c).roads;
    const had = services.map((sv) => ring(sv.x, sv.y, sv.w, sv.h).some((i) => cell[i] === ROAD));
    const saved = border.map((i) => cell[i]);
    for (const i of border) cell[i] = ROAD;
    for (const i of innerRoads) cell[i] = SERVICE;
    // Ring muss am übrigen Netz hängen
    let ok = ring(c.x, c.y, c.w, c.h).some((i) => cell[i] === ROAD) && !separates(innerRoads);
    if (ok) services.forEach((sv, k) => {
      if (had[k] && ring(sv.x, sv.y, sv.w, sv.h).every((i) => cell[i] !== ROAD)) ok = false;
    });
    for (const i of innerRoads) cell[i] = ROAD;
    border.forEach((i, k) => (cell[i] = saved[k]));
    return ok;
  };
  const placeRinged = (c: Candidate, cx: Complex, owner: number): number[] => {
    const border = borderOf(c);
    for (const i of border) cell[i] = ROAD;
    placeComplex(innerOf(c), cx, owner);
    return border;
  };
  const placeComplex = (c: Candidate, cx: Complex, owner: number): void => {
    const r = complexParts(c, cx)[Math.max(0, complexSide(c, cx))];
    for (const k of c.houses) removedBy[k]++;
    // Ganzes Rechteck räumen; nicht gebrauchte Felder werden freies Land.
    for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) cell[(c.y + dy) * w + c.x + dx] = FREE;
    for (const p of [r.main, ...r.modules]) {
      for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) cell[(p.y + dy) * w + p.x + dx] = SERVICE;
      const entry = lookup(p.guid);
      services.push({ guid: p.guid, kind: entry.kind, name: entry.name, x: p.x, y: p.y, w: p.w, h: p.h, turns: p.turns, owner });
    }
  };

  // --- Regionalministerium: zentral, möglichst viele Häuser in Straßenreichweite.
  const inMinistry = new Uint8Array(w * h);
  let ministryStarts: number[] = [];
  /** Ministeriumsbereich mit den aktuellen Straßen neu bestimmen. */
  const refreshMinistry = (): void => {
    if (!options.ministry || !ministryStarts.length) return;
    bfs(ministryStarts.filter((i) => cell[i] === ROAD), options.ministry.range);
    for (let i = 0; i < inMinistry.length; i++) inMinistry[i] = gen[i] === g ? 1 : 0;
  };
  if (options.ministry && options.ministry.range > 0) {
    const mr = options.ministry.range;
    let best: { c: Candidate; value: number } | null = null;
    // Verwaltung: Wert = Häuser im Radius der erreichten Rathäuser (4. Item, Arbeitskraft je Rathaus)
    const thRings = options.ministry.townHalls ? townHalls.map((t) => ring(t.x, t.y, 4, 4)) : [];
    const thHouses = options.ministry.townHalls
      ? townHalls.map((t) => s.houses.filter((hs) => Math.hypot(hs.x + 1 - (t.x + 1.5), hs.y + 1 - (t.y + 1.5)) <= 20 + 1e-9).length)
      : [];
    // Palastinsel: Palast mit Flügeln als ein Rechteck (Straßen darunter dürfen weg, solange das
    // Netz hält); nur die günstigsten Plätze werden auf Reichweite geprüft.
    const pal = options.ministry.palace ? palaceComplex(options.ministry.palace.wings) : null;
    const cands = pal ? candidatesFor(PALACE_GUID, { w: pal.w + 2, h: pal.h + 2, maxRoads: Infinity }) : candidatesFor(MINISTRY_GUID);
    let valid = 0;
    const palDeadline = performance.now() + 4000;
    for (const c of cands) {
      if (pal) {
        // erst gültige Plätze (Netz hält), davon höchstens 200 bzw. ≈ 4 s bewerten
        if (valid >= 200 || (valid > 0 && performance.now() > palDeadline)) break;
        if (!validRinged(c)) continue;
        valid++;
      }
      bfs(c.starts, mr);
      let n = 0;
      s.houses.forEach((_, k) => {
        if (isAlive(k) && !c.houses.includes(k) && reached(houseRing[k])) n++;
      });
      if (options.ministry.townHalls) {
        n = 0;
        thRings.forEach((r, i) => {
          if (reached(r)) n += thHouses[i] + 10;
        });
      }
      const value = n * 3 - c.cost;
      if ((!best || value > best.value) && (pal || stillValid(c))) best = { c, value };
    }
    if (best && pal) {
      ministryStarts = placeRinged(best.c, pal, PALACE_OWNER);
      bfs(ministryStarts, mr);
      for (let i = 0; i < inMinistry.length; i++) if (gen[i] === g) inMinistry[i] = 1;
      report.ministry.placed = true;
      report.ministry.houses = s.houses.filter((_, k) => isAlive(k) && reached(houseRing[k])).length;
    } else if (best) {
      place(best.c, MINISTRY_GUID);
      ministryStarts = best.c.starts;
      bfs(best.c.starts, mr);
      for (let i = 0; i < inMinistry.length; i++) if (gen[i] === g) inMinistry[i] = 1;
      report.ministry.placed = true;
      report.ministry.houses = s.houses.filter((_, k) => isAlive(k) && reached(houseRing[k])).length;
    }
  }
  // --- Palastinsel: Museen für die fehlende Attraktivität (nach Palast, vor den Läden).
  if (options.culture) {
    const cu = options.culture;
    const reachedTH = townHalls.filter((t) => ring(t.x, t.y, 4, 4).some((i) => inMinistry[i])).length;
    const tradeUnions = services.filter((sv) => sv.kind === 'tradeUnion').length;
    const known = cu.base + cu.perTownHallInRange * reachedTH;
    const delta = cu.deltaSet + cu.perTownHall * townHalls.length + cu.perTradeUnion * tradeUnions;
    let missing = cu.target - known;
    const rep = { museums: 0, modules: 0, attr: 0, known, missing: Math.max(0, missing), houses: 0 };
    report.culture = rep;
    if (missing > 0) {
      // Module: erst Götter des Deltas, dann das beste Set, bis das Ziel erreicht ist
      // Reserve: 20 % des Rathausreform-Anteils (spätere Straßenänderungen nehmen Rathäuser aus
      // dem Palastbereich; Crown Falls: 36 → 31)
      const reserve = Math.ceil((0.2 * cu.perTownHallInRange * reachedTH) / cu.perSet);
      const sets = 1 + Math.max(0, Math.ceil((missing - delta) / cu.perSet)) + reserve;
      let modules = sets * cu.moduleSet;
      const perMuseum = Math.max(cu.moduleSet, Math.floor(cu.maxModules / cu.moduleSet) * cu.moduleSet);
      // Zeit für die Museumssuche: mit der Inselgröße (große Inseln brauchen mehr Plätze)
      const deadline = performance.now() + Math.max(8000, Math.min(60000, (w * h) / 4));
      let size = perMuseum;
      while (modules > 0 && performance.now() < deadline) {
        const n = Math.min(size, modules);
        let best: { c: Candidate; cx: Complex } | null = null;
        for (const shape of [0, 1, 2]) {
          const cx = moduleComplex(MUSEUM_SPEC, n, shape);
          for (const c of candidatesFor(MUSEUM_GUID, { w: cx.w + 2, h: cx.h + 2, maxRoads: Infinity })) {
            if (best && c.cost >= best.c.cost) break;
            if (!validRinged(c)) continue;
            best = { c, cx };
            break;
          }
        }
        if (!best) {
          // Kein Platz für so viele Module am Stück: kleinere Museen
          if (n <= cu.moduleSet) break;
          size = Math.max(cu.moduleSet, Math.floor(n / 2 / cu.moduleSet) * cu.moduleSet);
          continue;
        }
        rep.houses += best.c.houses.length;
        placeRinged(best.c, best.cx, MUSEUM_OWNER_BASE + rep.museums);
        rep.museums++;
        rep.modules += n;
        modules -= n;
      }
      const setsPlaced = Math.floor(rep.modules / cu.moduleSet);
      rep.attr = setsPlaced > 0 ? delta + (setsPlaced - 1) * cu.perSet : 0;
      missing -= rep.attr;
      rep.missing = Math.max(0, missing);
    }
  }

  // --- Lehmgruben-Cluster: Handelskammer und Lagerhaus in der Mitte, Gruben ringsum (Radius 15).
  if (options.clay && options.clay.count > 0) {
    const rep = { clusters: 0, pits: 0, houses: 0 };
    report.clay = rep;
    let left = Math.round(options.clay.count);
    const deadline = performance.now() + Math.max(5000, Math.min(30000, (w * h) / 8));
    while (left > 0 && performance.now() < deadline) {
      const n = Math.min(8, left);
      const rows = Math.max(2, Math.ceil((n + 2) / 2));
      // Zwei Spalten aus 5×5-Feldern, dazwischen eine Straße; ringsum Ringstraße
      const bw = 11;
      const bh = rows * 5;
      let best: Candidate | null = null;
      for (const c of candidatesFor(CLAY_PIT_GUID, { w: bw + 2, h: bh + 2, maxRoads: Infinity })) {
        if (validRinged(c)) {
          best = c;
          break;
        }
      }
      if (!best) break;
      const inner = innerOf(best);
      const turned = best.turns === 1;
      for (const i of borderOf(best)) cell[i] = ROAD;
      for (const k of best.houses) removedBy[k]++;
      for (let dy = 0; dy < inner.h; dy++) for (let dx = 0; dx < inner.w; dx++) cell[(inner.y + dy) * w + inner.x + dx] = FREE;
      // ungedreht (lx, ly) → Karte
      const at = (lx: number, ly: number): [number, number] => (turned ? [inner.x + ly, inner.y + lx] : [inner.x + lx, inner.y + ly]);
      for (let ly = 0; ly < bh; ly++) {
        const [rx, ry] = at(5, ly);
        cell[ry * w + rx] = ROAD;
      }
      const mid = Math.floor(rows / 2);
      /** Quadratisches Gebäude an ungedrehter Stelle (lx, ly) setzen. */
      const put = (guid: number, lx: number, ly: number, size: number): void => {
        const [x, y] = at(lx, ly);
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) cell[(y + dy) * w + x + dx] = SERVICE;
        const entry = lookup(guid);
        services.push({ guid, kind: entry.kind, name: entry.name, x, y, w: size, h: size, turns: 0 });
      };
      let pits = 0;
      for (let r = 0; r < rows; r++) {
        const ly = r * 5;
        // linke Spalte x 0–4, Straße x 5, rechte Spalte x 6–10
        if (r === mid) {
          put(TRADE_UNION_GUID, 1, ly, 4); // Handelskammer an der Mittelstraße
          put(WAREHOUSE_GUID, 6, ly, 5);
          continue;
        }
        for (const lx of [0, 6]) {
          if (pits >= n) break;
          put(CLAY_PIT_GUID, lx, ly, 5);
          pits++;
        }
      }
      rep.clusters++;
      rep.pits += pits;
      rep.houses += best.houses.length;
      left -= pits;
    }
  }

  /** Reichweiten-Zuschlag eines Gebäudes, dessen Anschluss im Ministeriumsbereich liegt. */
  const bonusFor = (kind: BuildingKind, starts: readonly number[]): number => {
    let b = options.rangeBonus?.[kind] ?? 0;
    if (options.ministry && starts.some((i) => inMinistry[i])) {
      if (lookup(SERVICE_SPECS.find((sp) => sp.kind === kind)?.guid ?? 0).welfare) b += options.ministry.welfare;
      if (kind === 'powerPlant') b += options.ministry.web;
    }
    return b;
  };

  // --- Versorgungsgebäude je Art: gierig, dann lokale Suche (entfernen, verlegen)
  const specs = SERVICE_SPECS.filter((sp) => options.kinds.has(sp.kind));
  /** Wirkungsanteil je Haus über die schon stehenden Gebäude einer Art (mit den aktuellen Straßen). */
  const baselineOf = (spec: ServiceSpec): Float32Array => {
    const base = new Float32Array(s.houses.length);
    const isUni = spec.kind === 'university';
    for (const sv of services) {
      if (sv.kind !== spec.kind) continue;
      const starts = ring(sv.x, sv.y, sv.w, sv.h).filter((i) => cell[i] === ROAD);
      const bonus = bonusFor(spec.kind, starts);
      bfs(starts, isUni ? UNIVERSITY_MAX_RANGE + bonus : (lookup(spec.guid).roadRange ?? 0) + bonus);
      s.houses.forEach((_, k) => {
        let d = 0;
        for (const i of houseRing[k]) if (gen[i] === g && (!d || dist[i] < d)) d = dist[i];
        if (!d) return;
        const f = isUni ? universityFactor(d, bonus) : 1;
        if (f > base[k]) base[k] = f;
      });
    }
    return base;
  };
  const runSpec = (spec: ServiceSpec): void => {
    refreshMinistry();
    const entry = lookup(spec.guid);
    const isUniversity = spec.kind === 'university';
    const baseline = baselineOf(spec);
    const cands = candidatesFor(spec.guid);
    // Abdeckung je Kandidat: Hausindizes (aufsteigend) und Wirkungsanteil 0…1.
    const coverK: Int32Array[] = [];
    const coverF: Float32Array[] = [];
    for (const c of cands) {
      const bonusRange = bonusFor(spec.kind, c.starts);
      const range = isUniversity ? UNIVERSITY_MAX_RANGE + bonusRange : (entry.roadRange ?? 0) + bonusRange;
      bfs(c.starts, range);
      const ks: number[] = [];
      const fs: number[] = [];
      s.houses.forEach((_, k) => {
        if (!isAlive(k)) return;
        let d = 0;
        for (const i of houseRing[k]) if (gen[i] === g && (!d || dist[i] < d)) d = dist[i];
        if (!d) return;
        const f = isUniversity ? universityFactor(d, bonusRange) : 1;
        if (f <= 0) return;
        ks.push(k);
        fs.push(f);
      });
      coverK.push(Int32Array.from(ks));
      coverF.push(Float32Array.from(fs));
    }
    const factorIn = (ci: number, k: number): number => {
      const arr = coverK[ci];
      let lo = 0;
      let hi = arr.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] === k) return coverF[ci][mid];
        if (arr[mid] < k) lo = mid + 1;
        else hi = mid - 1;
      }
      return 0;
    };
    // Genauer Wert je Haus, wenn Schicht/Stufe bekannt: Einwohner mit minus ohne dieses Gebäude.
    const exact = new Float32Array(s.houses.length).fill(-1);
    if (options.houseStates && !spec.optional) {
      const all: Partial<Record<BuildingKind, boolean>> = {
        departmentStore: true,
        furnitureStore: true,
        drugStore: true,
        university: true,
        powerPlant: true,
      };
      const rules = { townHallItems: options.townHallItems ?? true, deliveryGoods: !!options.deliveryGoods };
      s.houses.forEach((hs, k) => {
        const st = options.houseStates?.get(`${hs.x},${hs.y}`);
        if (!st) return;
        const supply = { services: all, universityFactor: 1, townHall: inTownHall[k], hasRoad: true };
        const withIt = skyscraperResidents(st.tier, st.level, 5, supply, rules).residents;
        const without = skyscraperResidents(
          st.tier,
          st.level,
          5,
          { ...supply, services: { ...all, [spec.kind]: false }, universityFactor: isUniversity ? 0 : 1 },
          rules,
        ).residents;
        exact[k] = withIt - without;
      });
    }
    const valueOf = (k: number): number =>
      spec.optional
        ? spec.value
        : Math.max(
            exact[k] >= 0
              ? exact[k]
              : spec.value + (inTownHall[k] ? spec.itemValue + (options.deliveryGoods ? spec.deliveryValue : 0) : 0),
            options.fullCoverageValue ?? 0,
          );
    /** Bester Wirkungsanteil je Haus über die gewählten Gebäude dieser Art. */
    const best = Float32Array.from(baseline);
    const chosen: number[] = [];
    const bestWithout = (ci: number, k: number): number => {
      let b = baseline[k];
      for (const cj of chosen) if (cj !== ci) b = Math.max(b, factorIn(cj, k));
      return b;
    };

    /** Gewinn, wenn Kandidat ci dazukommt (im aktuellen Zustand). */
    const addGain = (ci: number): number => {
      const c = cands[ci];
      let gain = -spec.fixedCost;
      for (const k of c.houses) {
        if (!isAlive(k)) continue;
        gain -= houseCost(k) + valueOf(k) * best[k];
      }
      const ks = coverK[ci];
      const fs = coverF[ci];
      for (let n = 0; n < ks.length; n++) {
        const k = ks[n];
        if (fs[n] > best[k] && isAlive(k) && !c.houses.includes(k)) gain += valueOf(k) * (fs[n] - best[k]);
      }
      return gain;
    };
    /** Gewinn, wenn das gewählte Gebäude ci wegfällt. */
    const removeGain = (ci: number): number => {
      const c = cands[ci];
      let gain = spec.fixedCost;
      const ks = coverK[ci];
      const fs = coverF[ci];
      for (let n = 0; n < ks.length; n++) {
        const k = ks[n];
        if (!isAlive(k) || fs[n] < best[k] - 1e-6) continue;
        gain -= valueOf(k) * (best[k] - bestWithout(ci, k));
      }
      for (const k of c.houses) {
        if (removedBy[k] !== 1) continue;
        gain += houseCost(k) + valueOf(k) * bestWithout(ci, k);
      }
      return gain;
    };
    const take = (ci: number): void => {
      place(cands[ci], spec.guid);
      chosen.push(ci);
      const ks = coverK[ci];
      for (let n = 0; n < ks.length; n++) best[ks[n]] = Math.max(best[ks[n]], coverF[ci][n]);
    };
    const drop = (ci: number): void => {
      unplace(cands[ci]);
      chosen.splice(chosen.indexOf(ci), 1);
      for (const k of coverK[ci]) best[k] = bestWithout(-1, k);
    };
    const isChosen = new Uint8Array(cands.length);
    const bestAddition = (): { ci: number; gain: number } => {
      const order = cands.map((_, ci) => ci).filter((ci) => !isChosen[ci]);
      const gains = order.map((ci) => addGain(ci));
      const idx = order.map((_, k) => k).sort((p, q) => gains[q] - gains[p]);
      for (const k of idx) {
        if (gains[k] <= 0) break;
        if (stillValid(cands[order[k]])) return { ci: order[k], gain: gains[k] };
      }
      return { ci: -1, gain: 0 };
    };

    // 1. Gierig
    for (;;) {
      const { ci } = bestAddition();
      if (ci < 0) break;
      take(ci);
      isChosen[ci] = 1;
    }
    // 2. Lokale Suche: überflüssige entfernen, Gebäude verlegen, wieder ergänzen.
    const localSearch = (): void => {
      for (let round = 0; round < 6; round++) {
        let improved = false;
        for (const ci of [...chosen]) {
          if (removeGain(ci) > 1e-6) {
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
          if (cj >= 0 && cj !== ci && lose + gain > 1e-6) {
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
    };
    localSearch();

    // 3. Exakter Löser (HiGHS): ganzzahliges Überdeckungsproblem über die
    //    besten Kandidaten; danach lokale Suche. Die bessere Lösung bleibt.
    if (options.mip && !isUniversity) {
      /** Wert der aktuellen Auswahl dieser Art (wie addGain/removeGain). */
      const objective = (): number => {
        const dispThis = new Map<number, number>();
        for (const ci of chosen) for (const k of cands[ci].houses) dispThis.set(k, (dispThis.get(k) ?? 0) + 1);
        let v = -spec.fixedCost * chosen.length;
        for (let k = 0; k < s.houses.length; k++) {
          if (isAlive(k)) v += valueOf(k) * best[k];
          else if ((dispThis.get(k) ?? 0) === removedBy[k]) v -= houseCost(k);
        }
        return v;
      };
      const greedySet = [...chosen];
      const objG = objective();
      const picked = solveCoverMip(greedySet);
      report.mip.tried++;
      if (!picked) report.mip.failed++;
      else if (picked.length === greedySet.length && picked.every((ci) => greedySet.includes(ci))) report.mip.same++;
      if (picked && (picked.length !== greedySet.length || picked.some((ci) => !greedySet.includes(ci)))) {
        for (const ci of [...chosen]) {
          drop(ci);
          isChosen[ci] = 0;
        }
        for (const ci of picked) {
          if (stillValid(cands[ci])) {
            take(ci);
            isChosen[ci] = 1;
          }
        }
        localSearch();
        const objM = objective();
        if (objM < objG - 1e-6) {
          for (const ci of [...chosen]) {
            drop(ci);
            isChosen[ci] = 0;
          }
          for (const ci of greedySet) {
            take(ci);
            isChosen[ci] = 1;
          }
        } else if (objM > objG + 1e-6) {
          report.mip.improved++;
          report.mip.gain += objM - objG;
        }
      }
    }

    /** Ganzzahliges Modell: Auswahl der Kandidaten mit maximalem Wert. */
    function solveCoverMip(current: number[]): number[] | null {
      const mip = options.mip;
      if (!mip) return null;
      // Häuser, die nur durch diese Art wegfallen, gelten als vorhanden.
      const dispThis = new Map<number, number>();
      for (const ci of current) for (const k of cands[ci].houses) dispThis.set(k, (dispThis.get(k) ?? 0) + 1);
      const aliveOther = (k: number): boolean => removedBy[k] - (dispThis.get(k) ?? 0) === 0;
      // Flächen anderer Gebäude (nicht dieser Art) sind tabu.
      const ownTile = new Set<number>();
      for (const ci of current) {
        const c = cands[ci];
        for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) ownTile.add((c.y + dy) * w + c.x + dx);
      }
      const free = (c: Candidate): boolean => {
        for (let dy = 0; dy < c.h; dy++) {
          for (let dx = 0; dx < c.w; dx++) {
            const i = (c.y + dy) * w + c.x + dx;
            if (cell[i] === SERVICE && !ownTile.has(i)) return false;
          }
        }
        return true;
      };
      // Einzelwert je Kandidat, die besten ~220 (plus aktuelle Auswahl).
      const score = cands.map((c, ci) => {
        if (!free(c)) return -Infinity;
        let v = -spec.fixedCost;
        const own = new Set(c.houses);
        const ks = coverK[ci];
        for (let n = 0; n < ks.length; n++) {
          const k = ks[n];
          if (!own.has(k) && aliveOther(k) && baseline[k] < 1) v += valueOf(k) * (1 - baseline[k]);
        }
        for (const k of c.houses) if (aliveOther(k)) v -= houseCost(k) + valueOf(k) * baseline[k];
        return v;
      });
      const pool = cands
        .map((_, ci) => ci)
        .filter((ci) => score[ci] > -Infinity)
        .sort((p, q) => score[q] - score[p])
        .slice(0, MIP_POOL);
      for (const ci of current) if (!pool.includes(ci)) pool.push(ci);
      if (!pool.length) return null;
      // Häuser: Gewinn bei Versorgung, Kosten bei Verdrängung.
      const coveredBy = new Map<number, number[]>();
      const displacedBy = new Map<number, number[]>();
      for (const ci of pool) {
        const own = new Set(cands[ci].houses);
        const ks = coverK[ci];
        for (let n = 0; n < ks.length; n++) {
          const k = ks[n];
          if (own.has(k) || !aliveOther(k) || baseline[k] >= 1) continue;
          const list = coveredBy.get(k);
          if (list) list.push(ci);
          else coveredBy.set(k, [ci]);
        }
        for (const k of cands[ci].houses) {
          if (!aliveOther(k)) continue;
          const list = displacedBy.get(k);
          if (list) list.push(ci);
          else displacedBy.set(k, [ci]);
        }
      }
      const lines: string[] = [];
      const obj: string[] = [];
      const rows: string[] = [];
      const fmt = (v: number): string => (Math.round(v * 1000) / 1000).toString();
      for (const ci of pool) obj.push(`- ${fmt(spec.fixedCost)} x${ci}`);
      // Häuser ohne Verdrängungsrisiko mit gleicher Abdeckung zusammenfassen.
      const groups = new Map<string, { cands: number[]; weight: number }>();
      let yi = 0;
      for (const [k, list] of coveredBy) {
        const weight = valueOf(k) * (1 - baseline[k]);
        if (weight <= 0) continue;
        if (displacedBy.has(k)) {
          const y = `y${yi++}`;
          obj.push(`+ ${fmt(weight)} ${y}`);
          rows.push(`c${rows.length}: ${y} ${list.map((ci) => `- x${ci}`).join(' ')} <= 0`);
          for (const ci of displacedBy.get(k) as number[]) rows.push(`c${rows.length}: ${y} + x${ci} <= 1`);
          continue;
        }
        const key = list.slice().sort((a, b) => a - b).join(',');
        const g = groups.get(key);
        if (g) g.weight += weight;
        else groups.set(key, { cands: list, weight });
      }
      for (const g of groups.values()) {
        const y = `y${yi++}`;
        obj.push(`+ ${fmt(g.weight)} ${y}`);
        rows.push(`c${rows.length}: ${y} ${g.cands.map((ci) => `- x${ci}`).join(' ')} <= 0`);
      }
      let zi = 0;
      for (const [k, list] of displacedBy) {
        const z = `z${zi++}`;
        obj.push(`- ${fmt(houseCost(k) + valueOf(k) * baseline[k])} ${z}`);
        for (const ci of list) rows.push(`c${rows.length}: ${z} - x${ci} >= 0`);
      }
      // Keine Flächenüberlappung: je Kachel höchstens ein Kandidat.
      const byTile = new Map<number, number[]>();
      for (const ci of pool) {
        const c = cands[ci];
        for (let dy = 0; dy < c.h; dy++) {
          for (let dx = 0; dx < c.w; dx++) {
            const i = (c.y + dy) * w + c.x + dx;
            const list = byTile.get(i);
            if (list) list.push(ci);
            else byTile.set(i, [ci]);
          }
        }
      }
      const seenSets = new Set<string>();
      for (const list of byTile.values()) {
        if (list.length < 2) continue;
        const key = list.join(',');
        if (seenSets.has(key)) continue;
        seenSets.add(key);
        rows.push(`c${rows.length}: ${list.map((ci) => `x${ci}`).join(' + ')} <= 1`);
      }
      lines.push('Maximize');
      for (let i = 0; i < obj.length; i += 12) lines.push(` ${i === 0 ? 'obj: ' : ''}${obj.slice(i, i + 12).join(' ')}`);
      lines.push('Subject To');
      for (const r of rows) lines.push(` ${r}`);
      lines.push('Bounds');
      for (let i = 0; i < yi; i++) lines.push(` 0 <= y${i} <= 1`);
      for (let i = 0; i < zi; i++) lines.push(` 0 <= z${i} <= 1`);
      lines.push('Binary');
      for (let i = 0; i < pool.length; i += 20) lines.push(` ${pool.slice(i, i + 20).map((ci) => `x${ci}`).join(' ')}`);
      lines.push('End');
      try {
        const res = mip.solve(lines.join('\n'), { output_flag: false, time_limit: MIP_SECONDS, mip_rel_gap: 0.002 });
        const cols = res.Columns ?? {};
        const out = pool.filter((ci) => (cols[`x${ci}`]?.Primal ?? 0) > 0.5);
        return res.Status === 'Optimal' || res.Status === 'Time limit reached' ? out : null;
      } catch {
        return null;
      }
    }
  };
  for (const spec of specs) runSpec(spec);
  // Reparatur: Spätere Gebäude auf Querstraßen können Wege früherer verlängern.
  // Mit den endgültigen Straßen neu rechnen und Lücken gezielt schließen.
  for (const spec of specs) runSpec(spec);
  refreshMinistry();

  // --- Strom für die Produktion: jedes Produktionsgebäude in Reichweite eines Kraftwerks.
  const POWER_GUID = SERVICE_SPECS.find((sp) => sp.kind === 'powerPlant')?.guid ?? 117547;
  if (options.production?.power && report.production) {
    const factories = services.filter((sv) => sv.kind === 'production');
    const powered = new Uint8Array(factories.length);
    const markPowered = (starts: readonly number[]): void => {
      bfs(starts, (lookup(POWER_GUID).roadRange ?? 0) + bonusFor('powerPlant', starts));
      factories.forEach((sv, k) => {
        if (!powered[k] && reached(ring(sv.x, sv.y, sv.w, sv.h))) powered[k] = 1;
      });
    };
    for (const sv of services) if (sv.kind === 'powerPlant') markPowered(ring(sv.x, sv.y, sv.w, sv.h).filter((i) => cell[i] === ROAD));
    if (!powered.every(Boolean)) {
      const cands = candidatesFor(POWER_GUID);
      for (;;) {
        if (powered.every(Boolean)) break;
        let best = -1;
        let bestScore = 0;
        for (let ci = 0; ci < cands.length; ci++) {
          const c = cands[ci];
          bfs(c.starts, (lookup(POWER_GUID).roadRange ?? 0) + bonusFor('powerPlant', c.starts));
          let n = 0;
          factories.forEach((sv, k) => {
            if (!powered[k] && reached(ring(sv.x, sv.y, sv.w, sv.h))) n++;
          });
          if (!n) continue;
          let cost = 0;
          for (const k of c.houses) if (isAlive(k)) cost += houseCost(k);
          const score = n * 10_000 - cost;
          if (score > bestScore && stillValid(c)) {
            bestScore = score;
            best = ci;
          }
        }
        if (best < 0) break;
        place(cands[best], POWER_GUID);
        markPowered(cands[best].starts);
        report.production.powerPlants++;
      }
    }
  }
  for (const spec of specs) report.placed[spec.kind] = services.filter((sv) => sv.kind === spec.kind).length;

  // --- Lagerhäuser: jedes Gebäude mit Lagerbedarf braucht eines in Reichweite.
  const needy = services.filter((sv) => lookup(sv.guid).needsWarehouse || sv.kind === 'production');
  if (needy.length) {
    const reachMaps = needy.map((sv) => {
      bfs(ring(sv.x, sv.y, sv.w, sv.h), sv.kind === 'production' ? PRODUCTION_WAREHOUSE_RANGE : (lookup(sv.guid).roadRange ?? 0));
      const m = new Uint8Array(w * h);
      for (let i = 0; i < m.length; i++) if (gen[i] === g) m[i] = 1;
      return m;
    });
    const served = new Uint8Array(needy.length);
    // Der Lufthafen wirkt wie ein Lagerhaus.
    if (airportStarts.length) needy.forEach((_, k) => {
      if (airportStarts.some((i) => reachMaps[k][i])) served[k] = 1;
    });
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
    const reachedHouse = new Uint8Array(s.houses.length);
    for (const sv of services) {
      if (sv.kind !== spec.kind) continue;
      const starts = ring(sv.x, sv.y, sv.w, sv.h);
      bfs(starts, (lookup(spec.guid).roadRange ?? 0) + bonusFor(spec.kind, starts));
      s.houses.forEach((hs, k) => {
        if (!reachedHouse[k] && reached(ring(hs.x, hs.y, 3, 3))) reachedHouse[k] = 1;
      });
    }
    report.coverage[spec.kind] = s.houses.length ? reachedHouse.reduce((a, b) => a + b, 0) / s.houses.length : 0;
  }
  return { services, report };
}
