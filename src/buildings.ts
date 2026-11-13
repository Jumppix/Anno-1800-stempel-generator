// Verwaltungsgebäude, deren Einflussradien sich mit gleichartigen Gebäuden
// nicht überschneiden dürfen. Werte aus Anno Designer (presets.json) und den
// Spielmechanik-Notizen: beide 4×4, Handelskammer Radius 15, Rathaus Radius 20.

export type BuildingId = 'hk' | 'rh';
export type BuildingMode = BuildingId | 'both';

export interface BuildingSpec {
  id: BuildingId;
  label: string;
  plural: string;
  short: string;
  size: number;
  radius: number;
  guid: number;
  /** Farbe für Radius/Fläche in der Ergebnisansicht (r, g, b). */
  rgb: readonly [number, number, number];
}

export const BUILDINGS: Readonly<Record<BuildingId, BuildingSpec>> = {
  hk: {
    id: 'hk',
    label: 'Handelskammer',
    plural: 'Handelskammern',
    short: 'HK',
    size: 4,
    radius: 15,
    guid: 1010516,
    rgb: [78, 150, 88],
  },
  rh: {
    id: 'rh',
    label: 'Rathaus',
    plural: 'Rathäuser',
    short: 'RH',
    size: 4,
    radius: 20,
    guid: 100415,
    rgb: [86, 132, 196],
  },
};

/** Reihenfolge der Lösung: Handelskammern zuerst, Rathäuser weichen deren Fläche aus. */
export function modeTypes(mode: BuildingMode): BuildingId[] {
  return mode === 'both' ? ['hk', 'rh'] : [mode];
}
