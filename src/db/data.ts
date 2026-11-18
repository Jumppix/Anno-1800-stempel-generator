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

export const DB_BASE = `${import.meta.env.BASE_URL}db/`;

export interface Db {
  meta: Meta;
  buildings: Building[];
  items: Item[];
  names: Names;
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
  const [meta, buildings, items, names] = await Promise.all([
    get<Meta>('meta.json'),
    get<Building[]>('buildings.json'),
    get<Item[]>('items.json'),
    get<Names>('names.json'),
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
  return { meta, buildings, items, names, buildingBy, itemBy, itemsFor };
}

/** Seltenheit absteigend (legendär zuerst, Erzählung/Quest zuletzt). */
export const RARITY_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common', 'narrative'];
export const rarityRank = (r: string): number => {
  const i = RARITY_ORDER.indexOf(r);
  return i < 0 ? RARITY_ORDER.length : i;
};
