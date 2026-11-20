// Gemeinsame Typen und Laden der Spieldatenbank (public/db, erzeugt von
// scripts/data/build-db.mjs) für Datenbank- und Produktionsseite.

export type Bi = { de: string; en: string };
export type Amount = { p: number; a: number; ia?: number; inf?: number };

export interface Building {
  g: number;
  t: string;
  c: string;
  n: Bi;
  d?: Bi;
  i?: string;
  reg?: string[];
  sz?: [number, number];
  rad?: number;
  rng?: number;
  road?: boolean;
  cost?: Amount[];
  costInh?: boolean;
  mt?: Amount[];
  in?: Amount[];
  out?: Amount[];
  ct?: number;
  calcTpm?: number;
  ps?: { full?: number; none?: number; out?: number[] };
  pw?: number;
  pow?: 'req' | 'opt';
  /** Strombonus (+100 %) möglich. */
  eb?: 1;
  /** Bauart: Farm (Felder), Mine (Vorkommen), Fläche (Wald); sonst Fabrik. */
  kind?: 'farm' | 'mine' | 'area' | 'coast';
  mods?: { g: number[]; n?: number };
  sock?: { r?: number; a?: string };
  res?: { lvl?: number; max?: number };
  up?: number;
  ph?: number[];
  dlc?: number;
}

export interface Effect {
  grp: string;
  k: string;
  v: unknown;
}

export interface Item {
  g: number;
  t: string;
  n: Bi;
  d?: Bi;
  i?: string;
  r: string;
  s: string;
  it?: string;
  p?: number;
  tg: number[];
  tgx: number[];
  fx: Effect[];
  ex?: Array<{ k: string; v: number }>;
  dlc?: number;
  act?: boolean;
  /** Palast-Effekt: Ministerium, Richtlinie (0 = Basiseffekt), Stufe, Freischaltung, Überbringer. */
  pal?: PalaceItemMeta;
}

export interface PalaceItemMeta {
  m: MinistryKey;
  d: number;
  t: number;
  at: number;
  /** Überbringer (z. B. alle Handelskammern der Alten Welt) mit Radius und Gebäuden. */
  via?: Array<{ g: number; r?: number; x: number[] }>;
}

export type MinistryKey = 'City' | 'Culture' | 'Productivity' | 'Service' | 'Harbor';

/** public/db/palace.json – Ministerien und Richtlinien des Palasts. */
export interface PalaceData {
  /** Attraktivitätsstufen (Name → Schwelle). */
  levels: Record<string, number>;
  /** Prestige: erste Stufe ab `first`, je weitere Stufe `step` mehr. */
  paragon: { first: number; step: number };
  /** Straßenreichweite des Palasts (Spielwert, Feldweg): Basis + je Flügel. */
  range: { base: number; perWing: number };
  /** Palast und Regionalministerium (GUIDs). */
  buildings: number[];
  ministries: PalaceMinistry[];
}

export interface PalaceMinistry {
  k: MinistryKey;
  n: Bi;
  i?: string;
  /** Freischaltung (Attraktivität der Palaststadt). */
  at: number;
  lv: string;
  /** Basiseffekt (Item-GUIDs der Palast-Effekte). */
  base: number[];
  /** Prestige-Stufen 1–25: Effekte je Basis-Buff. */
  para: Array<Array<Array<{ k: string; v: unknown }>>>;
  decrees: PalaceDecree[];
}

export interface PalaceDecree {
  g: number;
  n: Bi;
  i?: string;
  /** Stufe 1–5 im Ministerium. */
  t: number;
  at: number;
  lv: string;
  /** Item-GUIDs der Palast-Effekte. */
  b: number[];
}

let palacePromise: Promise<PalaceData | null> | null = null;
/** Palast-Daten (eigene Datei, nur wo gebraucht). */
export function loadPalace(): Promise<PalaceData | null> {
  palacePromise ??= fetch(DB_BASE + 'palace.json')
    .then((r) => (r.ok ? (r.json() as Promise<PalaceData>) : null))
    .catch(() => null);
  return palacePromise;
}

export interface Meta {
  built: string;
  sources: Array<{ name: string; url: string; commit: string | null; license: string; use: string }>;
  counts: Record<string, number>;
  limits: string[];
  workforce?: number[];
  labels: { effects: Record<string, [string, string]>; rarity: Record<string, [string, string]>; expedition?: Record<string, [string, string]> };
}

export type Names = Record<string, [string, string, string?]>;

export interface GoodInfo {
  d?: Bi;
  cat?: number;
  price?: number;
  civ?: number;
  reg?: string[];
  wf?: 1;
}

export interface PopulationInfo {
  res?: number;
  max?: number;
  out: Array<{ p: number; a: number }>;
  /** Bedürfnisse: Ware, t/min je Einwohner, Einwohner-Bonus, Zufriedenheit, ab Einwohnerzahl. */
  needs: Array<{ p: number; t?: number | null; r?: number; h?: number; from?: number; bonus?: 1; unlock?: [number, number] }>;
}

export interface Info {
  goods: Record<string, GoodInfo>;
  population: Record<string, PopulationInfo>;
  pools: Record<string, number[]>;
}

export const DB_BASE = `${import.meta.env.BASE_URL}db/`;

export interface Db {
  meta: Meta;
  buildings: Building[];
  items: Item[];
  names: Names;
  info: Info;
  buildingBy: Map<number, Building>;
  itemBy: Map<number, Item>;
  /** Items je beeinflusstem Gebäude (aufgelöste Zielgruppen). */
  itemsFor: Map<number, Item[]>;
}

export async function loadDb(): Promise<Db> {
  const get = async <T>(f: string): Promise<T> => {
    const r = await fetch(DB_BASE + f);
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    return (await r.json()) as T;
  };
  const [meta, buildings, items, names, info] = await Promise.all([
    get<Meta>('meta.json'),
    get<Building[]>('buildings.json'),
    get<Item[]>('items.json'),
    get<Names>('names.json'),
    get<Info>('info.json').catch(() => ({ goods: {}, population: {}, pools: {} }) as Info),
  ]);
  const buildingBy = new Map(buildings.map((b) => [b.g, b]));
  const itemBy = new Map(items.map((i) => [i.g, i]));
  const itemsFor = new Map<number, Item[]>();
  for (const it of items) {
    for (const g of it.tgx) {
      const list = itemsFor.get(g);
      if (list) list.push(it);
      else itemsFor.set(g, [it]);
    }
  }
  return { meta, buildings, items, names, info, buildingBy, itemBy, itemsFor };
}

/** Seltenheit absteigend (legendär zuerst, Erzählung/Quest zuletzt). */
export const RARITY_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common', 'narrative'];
export const rarityRank = (r: string): number => {
  const i = RARITY_ORDER.indexOf(r);
  return i < 0 ? RARITY_ORDER.length : i;
};
