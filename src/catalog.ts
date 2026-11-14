// Gebäudekatalog für den Stadtplaner und die Stadt-Analyse.
//
// Quellen: Anno-1800-Wiki (Reichweiten mit Pflasterstraße, Stand der
// Recherche in docs/PLAN_Stadtplaner.md, Abschnitt 10) und die Presets von
// Anno Designer (src/data/presets.json, MIT) für Namen und Größen aller übrigen
// Gebäude.
//
// Koordinaten: Die App arbeitet in Kachelachsen (x nach rechts, y nach unten),
// die aus den Stempel-Rohachsen mit (x, y) = (−rawY, −rawX) entstehen (siehe
// stampReader.ts). Ein Preset der Größe [x, z] belegt bei Dir = 0 in den
// Rohachsen x × z Kacheln, in Kachelachsen also z (Breite) × x (Höhe). Bei
// Dir = 90°/270° sind die Seiten vertauscht.

import presetsJson from './data/presets.json';

export type BuildingKind =
  | 'residence'
  | 'townHall'
  | 'tradeUnion'
  | 'departmentStore'
  | 'furnitureStore'
  | 'drugStore'
  | 'university'
  | 'bank'
  | 'varietyTheatre'
  | 'membersClub'
  | 'powerPlant'
  | 'fireStation'
  | 'policeStation'
  | 'hospital'
  | 'postOffice'
  | 'postBox'
  | 'airport'
  | 'airportModule'
  | 'localDepartment'
  | 'warehouse'
  | 'production'
  | 'other';

export type Tier = 'artisan' | 'engineer' | 'investor';

export interface CatalogEntry {
  guid: number;
  kind: BuildingKind;
  name: string;
  /** Preset-Größe [x, z] wie in Anno Designer. */
  size: readonly [number, number];
  /** Reichweite über Pflasterstraße (volle Versorgung), falls straßenbasiert. */
  roadRange?: number;
  /** Kreisradius (Mittelpunkt im Radius), falls kreisbasiert. */
  radius?: number;
  /** Bekommt den Reichweitenbonus des Wohlfahrtsministeriums. */
  welfare?: boolean;
  /** Braucht Lagerhaus/Kontor/Lufthafen in Straßenreichweite (Karren). */
  needsWarehouse?: boolean;
  tier?: Tier;
}

const E = (entry: CatalogEntry): CatalogEntry => entry;

/** Gebäude mit bekannter Spielmechanik. */
export const CATALOG_LIST: readonly CatalogEntry[] = [
  E({ guid: 1010345, kind: 'residence', name: 'Handwerkerhaus', size: [3, 3], tier: 'artisan' }),
  E({ guid: 1010346, kind: 'residence', name: 'Ingenieurshaus', size: [3, 3], tier: 'engineer' }),
  E({ guid: 1010347, kind: 'residence', name: 'Investorenhaus', size: [3, 3], tier: 'investor' }),
  E({ guid: 100415, kind: 'townHall', name: 'Rathaus', size: [4, 4], radius: 20 }),
  E({ guid: 1010516, kind: 'tradeUnion', name: 'Handelskammer', size: [4, 4], radius: 15 }),
  E({ guid: 135100, kind: 'departmentStore', name: 'Kaufhaus', size: [7, 6], roadRange: 62, needsWarehouse: true }),
  E({ guid: 135099, kind: 'furnitureStore', name: 'Einrichtungshaus', size: [7, 6], roadRange: 62, needsWarehouse: true }),
  E({ guid: 134629, kind: 'drugStore', name: 'Drogerie', size: [7, 6], roadRange: 62, needsWarehouse: true }),
  E({ guid: 1010362, kind: 'university', name: 'Universität', size: [9, 6], roadRange: 64, welfare: true }),
  E({ guid: 1010365, kind: 'bank', name: 'Bankhaus', size: [12, 10], roadRange: 64, welfare: true }),
  E({ guid: 1010361, kind: 'varietyTheatre', name: 'Varieté', size: [4, 5], roadRange: 56, welfare: true }),
  E({ guid: 1010364, kind: 'membersClub', name: 'Clubhaus', size: [6, 6], roadRange: 49, welfare: true }),
  E({ guid: 117547, kind: 'powerPlant', name: 'Gasbetriebenes Kraftwerk', size: [5, 6], roadRange: 59, welfare: true, needsWarehouse: true }),
  E({ guid: 1010463, kind: 'fireStation', name: 'Feuerwache', size: [5, 3], roadRange: 71 }),
  E({ guid: 1010462, kind: 'policeStation', name: 'Polizeiwache', size: [4, 6], roadRange: 71 }),
  E({ guid: 1010464, kind: 'hospital', name: 'Hospital', size: [6, 6], roadRange: 71 }),
  E({ guid: 3741, kind: 'postOffice', name: 'Postamt', size: [6, 4], radius: 24 }),
  E({ guid: 538, kind: 'postBox', name: 'Briefkasten', size: [1, 1], radius: 12 }),
  E({ guid: 962, kind: 'airport', name: 'Lufthafen', size: [10, 15] }),
  E({ guid: 964, kind: 'airportModule', name: 'Item-Terminal', size: [5, 3] }),
  E({ guid: 966, kind: 'airportModule', name: 'Luftpostlager', size: [5, 3] }),
  E({ guid: 269602, kind: 'localDepartment', name: 'Regionalministerium', size: [8, 5] }),
  E({ guid: 1010371, kind: 'warehouse', name: 'Lagerhaus', size: [5, 5] }),
  E({ guid: 1010323, kind: 'production', name: 'Hochrad-Werkhalle', size: [6, 6] }),
];

/** Kaufhaus, Einrichtungshaus und Drogerie gibt es in Varianten je Patent. */
const VARIANTS: Readonly<Record<number, number>> = {
  135103: 135100, 135187: 135100, 135188: 135100, 135189: 135100, 135190: 135100,
  135105: 135099, 135121: 135099, 135120: 135099, 135122: 135099, 135123: 135099,
  134631: 134629, 135191: 134629, 135192: 134629, 135193: 134629, 135194: 134629,
};

export const STREET_GUIDS = {
  dirt: 1000178,
  paved: 1010035,
} as const;

const BY_GUID = new Map<number, CatalogEntry>(CATALOG_LIST.map((e) => [e.guid, e]));
const PRESETS = presetsJson as unknown as Record<string, [string, number, number]>;

/** Katalogeintrag zu einer GUID; unbekannte Gebäude über die Presets, sonst 1×1. */
export function lookup(guid: number): CatalogEntry {
  const known = BY_GUID.get(guid) ?? BY_GUID.get(VARIANTS[guid] ?? -1);
  if (known) return guid === known.guid ? known : { ...known, guid };
  const preset = PRESETS[String(guid)];
  if (preset) return { guid, kind: 'other', name: preset[0], size: [preset[1], preset[2]] };
  return { guid, kind: 'other', name: `Unbekannt (${guid})`, size: [1, 1] };
}

export function isKnownGuid(guid: number): boolean {
  return BY_GUID.has(guid) || guid in VARIANTS || String(guid) in PRESETS;
}

/** Vierteldrehungen (0–3) aus dem Dir-Winkel im Stempel. */
export function quarterTurns(dir: number): number {
  return ((Math.round(dir / (Math.PI / 2)) % 4) + 4) % 4;
}

/** Belegte Fläche in Kachelachsen (Breite, Höhe) für eine Drehung. */
export function footprint(entry: CatalogEntry, turns: number): { w: number; h: number } {
  const [x, z] = entry.size;
  return turns % 2 === 0 ? { w: z, h: x } : { w: x, h: z };
}
