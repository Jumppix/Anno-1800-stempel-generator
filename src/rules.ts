// Spielregeln und einstellbare Parameter. Alle Zahlen stammen aus dem
// Anno-1800-Wiki (Palace, Local Department, Skyscrapers, Public buildings);
// Details und Quellen: docs/PLAN_Stadtplaner.md, Abschnitt 10.

import type { BuildingKind, Tier } from './catalog';

export type Ministry = 'none' | 'welfare' | 'labour';

export type Policy =
  | 'none'
  // Wohlfahrt
  | 'aspirationalFinance'
  | 'artsPatronage'
  | 'cityWideWeb'
  | 'socialWelfare'
  | 'lateLicence'
  // Arbeit
  | 'landReform'
  | 'skilledLabour'
  | 'galvanicGrants'
  | 'factoryInspections'
  | 'unionSubsidies';

// Deutsche Namen nur, wo sie bestätigt sind (Spiel/Rechner-Daten); sonst Englisch.
export interface PolicyInfo {
  id: Policy;
  ministry: Ministry;
  name: string;
  effect: string;
  /** Attraktivität der Palastinsel, ab der die Richtlinie freigeschaltet ist. */
  unlock: number;
}

export const POLICIES: readonly PolicyInfo[] = [
  { id: 'aspirationalFinance', ministry: 'welfare', name: 'Aspirational Finance Act', effect: '+50 Bonuseinkommen (Handwerker/Ingenieure)', unlock: 1750 },
  { id: 'artsPatronage', ministry: 'welfare', name: 'Arts Patronage Act', effect: '+3 Attraktivität je Handwerker-/Ingenieurshaus', unlock: 1750 },
  { id: 'cityWideWeb', ministry: 'welfare', name: 'Stadtweites Netz', effect: 'Kraftwerke +22 Reichweite (Pflaster)', unlock: 2700 },
  { id: 'socialWelfare', ministry: 'welfare', name: 'Social Welfare Act', effect: '+5 Zufriedenheit aus öffentlichen Diensten', unlock: 4500 },
  { id: 'lateLicence', ministry: 'welfare', name: 'Verlängerte Ausschankzeiten', effect: '−20 % Getränkebedarf in Reichweite von Varieté/Clubhaus', unlock: 5950 },
  { id: 'landReform', ministry: 'labour', name: 'Landbesitzreform', effect: 'Zusatzware von Farmen', unlock: 1350 },
  { id: 'skilledLabour', ministry: 'labour', name: 'Qualifizierte Arbeitskräfte', effect: 'Zusatzware von Schwerindustrie', unlock: 1350 },
  { id: 'galvanicGrants', ministry: 'labour', name: 'Förderung des Galvanismus', effect: '+50 % Produktivität durch Strom', unlock: 3850 },
  { id: 'factoryInspections', ministry: 'labour', name: 'Factory Inspections Act', effect: '−50 % Arbeitskraft', unlock: 5200 },
  { id: 'unionSubsidies', ministry: 'labour', name: 'Gewerkschaftsförderung', effect: '+1 Item-Slot in Handelskammern', unlock: 6750 },
];

export interface RuleConfig {
  /** Anzahl Palastflügel (Reichweite +3 je Flügel auf Pflaster). */
  palaceWings: number;
  /** Prestige des Palasts 0–25 (+20 % des Basiseffekts je Stufe). */
  prestige: number;
  /** Ministerium im Regionalministerium dieser Insel. */
  ministry: Ministry;
  policy: Policy;
  /** Stufe, mit der Ingenieur-/Investorenhäuser als Hochhaus gerechnet werden. */
  skyscraperLevel: 3;
  /** Welfare-Bonus auch für Feuerwache, Polizei, Hospital (Wiki unklar). */
  welfareForInstitutions: boolean;
  /**
   * Schichten der Wohnhäuser: 'groups' = 8er-Gruppen aus je einer Linie
   * Ingenieure und einer Linie Investoren (Ausrichtung je Gruppe mit bestem
   * Panorama), 'stamp' = wie im Stempel.
   */
  tierMode: 'groups' | 'stamp';
  /** Rathaus-Items (Zofe, Lieferdienst, Saint D'Artois) in allen Rathäusern. */
  townHallItems: boolean;
}

/** Manuelle Festlegung (per Klick in der Analyse). */
export interface TierEdits {
  /** Einzelne Häuser: Gebäudeindex → Schicht. */
  houses: Map<number, 'engineer' | 'investor'>;
  /** Gruppen: kleinster Gebäudeindex der Gruppe → Ausrichtung 0/1. */
  groups: Map<number, 0 | 1>;
}

export const DEFAULT_RULES: RuleConfig = {
  palaceWings: 40,
  prestige: 0,
  ministry: 'welfare',
  policy: 'cityWideWeb',
  skyscraperLevel: 3,
  welfareForInstitutions: false,
  tierMode: 'groups',
  townHallItems: true,
};

/** Palast: Pflaster-Basisreichweite 71, je Flügel +3. */
export function palaceRange(rules: RuleConfig): number {
  return 71 + 3 * Math.max(0, Math.round(rules.palaceWings));
}

/** Regionalministerium: halbe Palastreichweite (Rundung im Spiel unbestätigt). */
export function localDepartmentRange(rules: RuleConfig): number {
  return Math.floor(palaceRange(rules) / 2);
}

/** Wohlfahrt: +10 (Feldweg) bzw. +15 (Pflaster), je Prestige +20 %, max. +90. */
export function welfareBonus(rules: RuleConfig): number {
  if (rules.ministry !== 'welfare') return 0;
  const p = Math.min(25, Math.max(0, Math.round(rules.prestige)));
  return Math.min(90, Math.round(15 * (1 + 0.2 * p)));
}

/** Stadtweites Netz: Kraftwerke +22 auf Pflaster. */
export function cityWideWebBonus(rules: RuleConfig): number {
  return rules.ministry === 'welfare' && rules.policy === 'cityWideWeb' ? 22 : 0;
}

export function welfareApplies(kind: BuildingKind, welfareFlag: boolean | undefined, rules: RuleConfig): boolean {
  if (welfareFlag) return true;
  return (
    rules.welfareForInstitutions &&
    (kind === 'fireStation' || kind === 'policeStation' || kind === 'hospital')
  );
}

// ---------------------------------------------------------------------------
// Hochhäuser
// ---------------------------------------------------------------------------

/** Panorama-Radius je Hochhausstufe 1–5. */
export const PANORAMA_RADIUS: readonly number[] = [0, 4, 4.25, 5, 6, 6.75];

/**
 * Maximale Einwohner je Panorama-Stärke 0–5 (keine … intensiv) bei Stufe 3,
 * alle Bedürfnisse erfüllt, ohne Rathaus-Items.
 */
export const SKYSCRAPER_L3_RESIDENTS: Readonly<Record<'engineer' | 'investor', readonly number[]>> = {
  engineer: [100, 120, 140, 160, 180, 200],
  investor: [125, 150, 175, 200, 225, 250],
};

/** Stärke 4 heißt im Spiel „Beeindruckend“ (Spieltest); die übrigen Namen sind übersetzt. */
export const PANORAMA_NAMES = ['keins', 'schwach', 'mäßig', 'ordentlich', 'beeindruckend', 'intensiv'];

/**
 * Öffentliche Gebäude, die ein Stufe-3-Hochhaus braucht, mit den Einwohnern,
 * die beim Fehlen ungefähr wegfallen. Kaufhaus/Einrichtungshaus/Drogerie laut
 * Wiki; Universität und Strom sind die Werte normaler Häuser (Näherung).
 */
export const SKYSCRAPER_SERVICE_NEEDS: Readonly<
  Record<'engineer' | 'investor', ReadonlyArray<{ kind: BuildingKind; residents: number }>>
> = {
  engineer: [
    { kind: 'departmentStore', residents: 20 },
    { kind: 'furnitureStore', residents: 10 },
    { kind: 'drugStore', residents: 5 },
    { kind: 'university', residents: 6 },
    { kind: 'powerPlant', residents: 2 },
  ],
  investor: [
    { kind: 'departmentStore', residents: 25 },
    { kind: 'furnitureStore', residents: 10 },
    { kind: 'powerPlant', residents: 8 },
  ],
};

/** Luxus-Bedürfnisse (nur Zufriedenheit/Einkommen, keine Einwohner). */
/**
 * Rathaus-Items des Nutzers (laut annolayouts.de auch die empfohlene
 * Kombination für Wolkenkratzer): Zofe „Blauer Himmel“ (137798), Lieferdienst
 * „Blauer Himmel“ (137797), Saint D'Artois (190193). Bonus-Einwohner je
 * Stufe-3-Hochhaus im Rathausradius; Einträge mit `kind` zählen nur, wenn das
 * Haus von diesem Gebäude versorgt wird, die übrigen sind Waren.
 * Lieferdienst: Kaufhaus/Einrichtungshaus/Drogerie liefern zusätzlich
 * Kaugummi/Billardtische/Violinen (keine eigenen Einwohner).
 */
export const TOWN_HALL_ITEM_BONUS: Readonly<
  Record<'engineer' | 'investor', ReadonlyArray<{ label: string; residents: number; kind?: BuildingKind }>>
> = {
  engineer: [
    // Zofe: +5 je Bedürfnis
    { label: 'Kaufhaus', residents: 5, kind: 'departmentStore' },
    { label: 'Einrichtungshaus', residents: 5, kind: 'furnitureStore' },
    { label: 'Drogerie', residents: 5, kind: 'drugStore' },
    { label: 'Schreibmaschinen', residents: 5 },
    { label: 'Violinen', residents: 5 },
    // Saint D'Artois: +2 je Bedürfnis
    { label: 'Universität', residents: 2, kind: 'university' },
    { label: 'Fleischkonserven', residents: 2 },
    { label: 'Kaffee', residents: 2 },
    { label: 'Glühbirnen', residents: 2 },
  ],
  investor: [
    { label: 'Kaufhaus', residents: 5, kind: 'departmentStore' },
    { label: 'Einrichtungshaus', residents: 5, kind: 'furnitureStore' },
    { label: 'Kekse', residents: 5 },
    { label: 'Cognac', residents: 5 },
    { label: 'Kaffee', residents: 2 },
    { label: 'Glühbirnen', residents: 2 },
    { label: 'Sekt', residents: 2 },
    { label: 'Schokolade', residents: 2 },
    { label: 'Dampfwagen', residents: 2 },
  ],
};

export const LUXURY_SERVICES: Readonly<Record<Tier, readonly BuildingKind[]>> = {
  artisan: ['varietyTheatre', 'university'],
  engineer: ['bank', 'varietyTheatre'],
  investor: ['bank', 'membersClub'],
};
