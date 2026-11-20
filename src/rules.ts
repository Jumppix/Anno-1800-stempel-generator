// Spielregeln und einstellbare Parameter. Zahlen aus dem Anno-1800-Wiki
// (Skyscrapers, Public buildings), Palast/Ministerien aus den Spieldateien;
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

// Namen, Werte und Freischaltung aus den Spieldateien (Palast-Asset 249947,
// public/db/palace.json; Prüfung: npm run check-db). Reichweiten sind Spielwerte
// (Feldweg) × 1,5 für Pflaster (SpeedFactor der Pflasterstraße).
export interface PolicyInfo {
  id: Policy;
  ministry: Ministry;
  name: string;
  effect: string;
  /** Attraktivität der Palastinsel, ab der die Richtlinie freigeschaltet ist. */
  unlock: number;
}

export const POLICIES: readonly PolicyInfo[] = [
  { id: 'aspirationalFinance', ministry: 'welfare', name: 'Verbesserung der Finanzen', effect: '+50 Münzen je versorgtem Haus (Universität, Varieté, Kraftwerk, Bankhaus; Handwerker/Ingenieure)', unlock: 1750 },
  { id: 'artsPatronage', ministry: 'welfare', name: 'Förderung der Künste', effect: '+3 Attraktivität je Handwerker-/Ingenieurshaus in Varieté-Reichweite', unlock: 1750 },
  { id: 'cityWideWeb', ministry: 'welfare', name: 'Stadtweites Netz', effect: 'Kraftwerke +15 Reichweite (Pflaster +22)', unlock: 2700 },
  { id: 'socialWelfare', ministry: 'welfare', name: 'Wohlfahrt der Arbeiter', effect: '+5 Zufriedenheit aus öffentlichen Diensten', unlock: 4500 },
  { id: 'lateLicence', ministry: 'welfare', name: 'Verlängerte Ausschankzeiten', effect: '−20 % Getränkebedarf in Reichweite von Wirtshaus/Varieté/Clubhaus/Funkturm', unlock: 5950 },
  { id: 'landReform', ministry: 'labour', name: 'Landbesitzreform', effect: 'Zusatzware jede 2. Produktion (Farmen)', unlock: 1350 },
  { id: 'skilledLabour', ministry: 'labour', name: 'Qualifizierte Arbeitskräfte', effect: 'Zusatzware jede 3. Produktion (Schwerindustrie)', unlock: 1350 },
  { id: 'galvanicGrants', ministry: 'labour', name: 'Förderung des Galvanismus', effect: '+50 % Strombonus', unlock: 3850 },
  { id: 'factoryInspections', ministry: 'labour', name: 'Fabrikinspektionen', effect: '−50 % Arbeitskraft', unlock: 5200 },
  { id: 'unionSubsidies', ministry: 'labour', name: 'Gewerkschaftsförderung', effect: '+1 Item-Platz in Handelskammern', unlock: 6750 },
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
  /**
   * Welfare-Bonus auch für Feuerwache, Polizei, Hospital. Laut Spieldaten nein
   * (Ziel „Alle öffentlichen Gebäude“ ohne diese) – bleibt aus, nur für Tests.
   */
  welfareForInstitutions: boolean;
  /**
   * Schichten der Wohnhäuser: 'groups' = 8er-Gruppen aus je einer Linie
   * Ingenieure und einer Linie Investoren (Ausrichtung je Gruppe mit bestem
   * Panorama), 'stamp' = wie im Stempel.
   */
  tierMode: 'groups' | 'stamp';
  /** Rathaus-Items (Zofe, Lieferdienst, Saint D'Artois) in allen Rathäusern. */
  townHallItems: boolean;
  /**
   * Kaugummi und Violinen werden nicht produziert, sondern nur über den
   * Lieferdienst „Blauer Himmel“ verteilt: Häuser im Rathausradius bekommen
   * Kaugummi, wenn ein Kaufhaus sie versorgt, und Violinen, wenn eine Drogerie
   * sie versorgt. Ohne das fehlen diese Waren.
   */
  deliveryGoods: boolean;
  /**
   * Post (Empire of the Skies): welche Post-Arten die Häuser bekommen. Lokale
   * Post kommt von Postämtern/Briefkästen der Insel; Regional-/Überseepost
   * kommt per Luftschiff von anderen Inseln (die dafür ebenso viel Lokalpost
   * liefern, wie diese Insel exportiert).
   */
  mail: 'none' | 'local' | 'regional' | 'all';
  /**
   * Verbrauchssenkung durch Zeitungs-Propaganda („Sparmaßnahmen“) in Prozent,
   * z. B. 68. Senkt den Verbrauch aller Bedürfnisse, auch der Post
   * (Wiki „Needs“: Verbrauch = Basis · (1 + Zeitung) · (1 + Items)).
   */
  consumptionReduction: number;
  /**
   * Waren-Grundbedürfnisse, die auf der Insel NICHT verfügbar sind (IDs aus
   * `GOOD_NEEDS`). Standard leer = alle Waren vorhanden.
   */
  missingGoods?: string[];
  /** Eingeschaltete Lebensstil-Waren (IDs aus `GOOD_NEEDS`, ohne Post). Standard leer. */
  lifestyleGoods?: string[];
}

/**
 * Waren-Bedürfnisse der Hochhäuser (Wiki „Needs“, Abruf Nov. 2026). Gebäude-
 * Bedürfnisse (Kaufhaus, Einrichtungshaus, Drogerie, Universität, Strom)
 * stehen in `serviceNeeds`. Grundbedürfnisse stecken im Grundwert der
 * Hochhaus-Tabelle; fehlt eine Ware, fallen ihre Einwohner weg, bei
 * Panorama-Waren zusätzlich 5 × Panorama-Stärke. Lebensstil-Waren bringen
 * zusätzliche Einwohner, bei Hochhäusern + 5 je Stufe (Wiki: „number of
 * residents gained from lifestyle needs increases with every skyscraper level“).
 */
export interface GoodNeed {
  id: string;
  label: string;
  tier: SkyTier;
  type: 'basic' | 'lifestyle';
  residents: number;
  /** Panorama-Ware (+5 je Panorama-Stärke). */
  panorama?: boolean;
  /** Erst ab dieser Hochhaus-Stufe gebraucht. */
  minLevel?: number;
  /** Erweiterung (nur zur Anzeige). */
  dlc?: string;
}

const G = (g: GoodNeed): GoodNeed => g;
export const GOOD_NEEDS: readonly GoodNeed[] = [
  // Ingenieure – Grundbedürfnisse
  G({ id: 'e-canned', label: 'Fleischkonserven', tier: 'engineer', type: 'basic', residents: 12 }),
  G({ id: 'e-sewing', label: 'Nähmaschinen', tier: 'engineer', type: 'basic', residents: 6 }),
  G({ id: 'e-furcoats', label: 'Pelzmäntel', tier: 'engineer', type: 'basic', residents: 6 }),
  G({ id: 'e-glasses', label: 'Brillen', tier: 'engineer', type: 'basic', residents: 4, panorama: true }),
  G({ id: 'e-coffee', label: 'Kaffee', tier: 'engineer', type: 'basic', residents: 2, panorama: true }),
  G({ id: 'e-bulbs', label: 'Glühbirnen', tier: 'engineer', type: 'basic', residents: 2, panorama: true }),
  G({ id: 'e-gum', label: 'Kaugummi', tier: 'engineer', type: 'basic', residents: 10, minLevel: 2 }),
  G({ id: 'e-typewriters', label: 'Schreibmaschinen', tier: 'engineer', type: 'basic', residents: 10, minLevel: 3 }),
  G({ id: 'e-violins', label: 'Violinen', tier: 'engineer', type: 'basic', residents: 5, minLevel: 3 }),
  // Ingenieure – Lebensstil (Post separat)
  G({ id: 'e-soap', label: 'Seife', tier: 'engineer', type: 'lifestyle', residents: 2 }),
  G({ id: 'e-chocolate', label: 'Schokolade', tier: 'engineer', type: 'lifestyle', residents: 2 }),
  G({ id: 'e-shampoo', label: 'Shampoo', tier: 'engineer', type: 'lifestyle', residents: 5, dlc: 'Tourist Season' }),
  G({ id: 'e-mezcal', label: 'Mezcal', tier: 'engineer', type: 'lifestyle', residents: 3, dlc: 'New World Rising' }),
  G({ id: 'e-icecream', label: 'Eiscreme', tier: 'engineer', type: 'lifestyle', residents: 6, dlc: 'New World Rising' }),
  G({ id: 'e-medicine', label: 'Medizin', tier: 'engineer', type: 'lifestyle', residents: 7, dlc: 'New World Rising' }),
  // Investoren – Grundbedürfnisse
  G({ id: 'i-glasses', label: 'Brillen', tier: 'investor', type: 'basic', residents: 16 }),
  G({ id: 'i-coffee', label: 'Kaffee', tier: 'investor', type: 'basic', residents: 8 }),
  G({ id: 'i-bulbs', label: 'Glühbirnen', tier: 'investor', type: 'basic', residents: 8 }),
  G({ id: 'i-champagne', label: 'Sekt', tier: 'investor', type: 'basic', residents: 2, panorama: true }),
  G({ id: 'i-cigars', label: 'Zigarren', tier: 'investor', type: 'basic', residents: 2, panorama: true }),
  G({ id: 'i-chocolate', label: 'Schokolade', tier: 'investor', type: 'basic', residents: 2, panorama: true }),
  G({ id: 'i-steam', label: 'Dampfwagen', tier: 'investor', type: 'basic', residents: 4, panorama: true }),
  G({ id: 'i-gum', label: 'Kaugummi', tier: 'investor', type: 'basic', residents: 10, minLevel: 2 }),
  G({ id: 'i-biscuits', label: 'Kekse', tier: 'investor', type: 'basic', residents: 15, minLevel: 2 }),
  G({ id: 'i-cognac', label: 'Cognac', tier: 'investor', type: 'basic', residents: 15, minLevel: 3 }),
  G({ id: 'i-typewriters', label: 'Schreibmaschinen', tier: 'investor', type: 'basic', residents: 10, minLevel: 4 }),
  G({ id: 'i-billiard', label: 'Billardtische', tier: 'investor', type: 'basic', residents: 15, minLevel: 4 }),
  G({ id: 'i-violins', label: 'Violinen', tier: 'investor', type: 'basic', residents: 5, minLevel: 5 }),
  G({ id: 'i-toys', label: 'Spielzeug', tier: 'investor', type: 'basic', residents: 15, minLevel: 5 }),
  // Investoren – Lebensstil (Post separat)
  G({ id: 'i-furs', label: 'Pelze', tier: 'investor', type: 'lifestyle', residents: 3 }),
  G({ id: 'i-bearfur', label: 'Bärenfell', tier: 'investor', type: 'lifestyle', residents: 6, dlc: 'The Passage' }),
  G({ id: 'i-tapestries', label: 'Wandteppiche', tier: 'investor', type: 'lifestyle', residents: 4, dlc: 'Land of Lions' }),
  G({ id: 'i-perfumes', label: 'Parfüm', tier: 'investor', type: 'lifestyle', residents: 7, dlc: 'New World Rising' }),
  G({ id: 'i-fans', label: 'Fächer', tier: 'investor', type: 'lifestyle', residents: 10, dlc: 'New World Rising' }),
  G({ id: 'i-film', label: 'Filmrollen', tier: 'investor', type: 'lifestyle', residents: 5, dlc: 'New World Rising' }),
];

/** Zuschlag je Hochhaus-Stufe auf jedes Lebensstil-Bedürfnis (auch Post). */
export const LIFESTYLE_PER_LEVEL = 5;

/** Ware dieser Schicht mit diesem Namen (für Item-Boni). */
const goodByLabel = (tier: SkyTier, label: string): GoodNeed | undefined =>
  GOOD_NEEDS.find((g) => g.tier === tier && g.label === label);

/** Post-Einwohner eines Hochhauses bei voller Versorgung (je Art + 5 je Stufe). */
export function mailResidentsFor(tier: SkyTier, level: number, types: ReadonlyArray<'local' | 'regional' | 'overseas'>): number {
  let n = 0;
  for (const m of MAIL_NEEDS[tier]) if (types.includes(m.type)) n += m.residents + LIFESTYLE_PER_LEVEL * level;
  return n;
}

/** Manuelle Festlegung (per Klick in der Analyse). */
export interface TierEdits {
  /** Einzelne Häuser: Gebäudeindex → Schicht. */
  houses: Map<number, 'engineer' | 'investor'>;
  /** Gruppen: kleinster Gebäudeindex der Gruppe → Ausrichtung 0/1. */
  groups: Map<number, 0 | 1>;
  /**
   * Geplante Schicht und Hochhaus-Stufe je Haus (Stufen-Optimierung des
   * Planers). Hat Vorrang vor Gruppen; manuelle Einzelhaus-Edits gehen vor.
   */
  planned?: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>;
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
  deliveryGoods: false,
  mail: 'all',
  consumptionReduction: 68,
};

/**
 * Post als Lebensstil-Bedürfnis (Wiki „Needs“): zusätzliche Einwohner je Haus
 * und Verbrauch in t/min je Einwohner. Post im Lager ist inselweit verfügbar;
 * der Radius der Briefkästen bestimmt nur die Produktion.
 */
export const MAIL_NEEDS: Readonly<
  Record<'engineer' | 'investor', ReadonlyArray<{ type: 'local' | 'regional' | 'overseas'; residents: number; rate: number }>>
> = {
  engineer: [
    { type: 'local', residents: 3, rate: 0.001041667 },
    { type: 'regional', residents: 7, rate: 0.00025 },
    { type: 'overseas', residents: 15, rate: 0.0002 },
  ],
  investor: [
    { type: 'local', residents: 8, rate: 0.001291667 },
    { type: 'regional', residents: 12, rate: 0.000316667 },
    { type: 'overseas', residents: 25, rate: 0.00025 },
  ],
};

/** Post-Arten, die bei einer Einstellung zählen. */
export function mailTypes(mode: RuleConfig['mail']): Array<'local' | 'regional' | 'overseas'> {
  if (mode === 'local') return ['local'];
  if (mode === 'regional') return ['local', 'regional'];
  if (mode === 'all') return ['local', 'regional', 'overseas'];
  return [];
}

/** Produktion eines Postamts/Briefkastens: 1,33 t/min je 500 Einwohner im Radius, höchstens 3100 %. */
export function mailProduction(residentsInRadius: number): number {
  return (Math.min(residentsInRadius, 15500) / 500) * 1.33;
}

/**
 * Universität: volle Wirkung bis 64 Straßenkacheln (Pflaster), abgeschwächt
 * bis 131 (Wiki: „weniger Einwohner je nach Straßenentfernung“ – hier linear).
 */
export const UNIVERSITY_FULL_RANGE = 64;
export const UNIVERSITY_MAX_RANGE = 131;

/** Anteil der Universitätswirkung bei Straßenentfernung d (Zuschlag z. B. Wohlfahrt). */
export function universityFactor(d: number, bonus = 0): number {
  if (d <= 0) return 0;
  const full = UNIVERSITY_FULL_RANGE + bonus;
  const max = UNIVERSITY_MAX_RANGE + bonus;
  if (d <= full) return 1;
  if (d >= max) return 0;
  return (max - d) / (max - full);
}

/**
 * Waren, die der Lieferdienst „Blauer Himmel“ über einen Laden liefert, mit
 * den Einwohnern, die bei Stufe-3-Hochhäusern daran hängen (Wiki „Needs“).
 * Investoren brauchen Violinen erst ab Stufe 5.
 */
export const DELIVERY_GOODS: Readonly<
  Record<'engineer' | 'investor', ReadonlyArray<{ label: string; residents: number; via: BuildingKind }>>
> = {
  engineer: [
    { label: 'Kaugummi', residents: 10, via: 'departmentStore' },
    { label: 'Violinen', residents: 5, via: 'drugStore' },
  ],
  investor: [{ label: 'Kaugummi', residents: 10, via: 'departmentStore' }],
};

/** Palast: Pflaster-Basisreichweite 71, je Flügel +3. */
export function palaceRange(rules: RuleConfig): number {
  return 71 + 3 * Math.max(0, Math.round(rules.palaceWings));
}

/** Regionalministerium: halbe Palastreichweite (Rundung im Spiel unbestätigt). */
export function localDepartmentRange(rules: RuleConfig): number {
  return Math.floor(palaceRange(rules) / 2);
}

/**
 * Wohlfahrt (Spieldaten): öffentliche Gebäude +10 Reichweite, je Prestige-Stufe +2
 * (Stufe 25: +60); auf Pflaster ×1,5 → +15 … +90.
 */
export function welfareBonus(rules: RuleConfig): number {
  if (rules.ministry !== 'welfare') return 0;
  const p = Math.min(25, Math.max(0, Math.round(rules.prestige)));
  return Math.round(1.5 * (10 + 2 * p));
}

/** Stadtweites Netz (Spieldaten): Kraftwerke +15 Reichweite, auf Pflaster +22. */
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

// ---------------------------------------------------------------------------
// Hochhaus-Stufen 3–5 (Bauweisen 3-3-5 und 4-5)
// ---------------------------------------------------------------------------

export type SkyTier = 'engineer' | 'investor';
export type SkyLevel = 3 | 4 | 5;

/** Max. Einwohner je Panorama-Stärke 0–5 (Wiki „Skyscrapers“), alle Bedürfnisse erfüllt. */
export const SKYSCRAPER_RESIDENTS: Readonly<Record<SkyTier, Partial<Record<SkyLevel, readonly number[]>>>> = {
  engineer: { 3: [100, 120, 140, 160, 180, 200] },
  investor: {
    3: [125, 150, 175, 200, 225, 250],
    4: [150, 175, 200, 225, 250, 275],
    5: [175, 200, 225, 250, 275, 300],
  },
};

/** Ingenieure höchstens Stufe 3, Investoren bis Stufe 5. */
export const MAX_LEVEL: Readonly<Record<SkyTier, SkyLevel>> = { engineer: 3, investor: 5 };

/**
 * Panorama: Ausgangswert = eigene Stufe; jedes Hochhaus im Radius der eigenen
 * Stufe: niedriger +1, höher −1, gleiche Stufe: andere Schicht +1 (Variety),
 * gleiche Schicht −1.
 */
export function panoramaDelta(tier: SkyTier, level: SkyLevel, otherTier: SkyTier, otherLevel: SkyLevel): number {
  if (otherLevel < level) return 1;
  if (otherLevel > level) return -1;
  return otherTier === tier ? -1 : 1;
}

/** Versorgung eines Hauses (Straßenreichweite, Rathausradius). */
export interface HouseSupply {
  services: Partial<Record<BuildingKind, boolean>>;
  universityFactor: number;
  townHall: boolean;
  hasRoad: boolean;
}

interface NeedEntry {
  kind: BuildingKind;
  residents: number;
}

/** Bedürfnisse mit Gebäude (Straßenreichweite) und ihre Einwohner (Wiki „Needs“). */
export function serviceNeeds(tier: SkyTier, level: SkyLevel): NeedEntry[] {
  if (tier === 'engineer') {
    return [
      { kind: 'departmentStore', residents: 20 },
      { kind: 'furnitureStore', residents: 10 },
      { kind: 'drugStore', residents: 5 },
      { kind: 'university', residents: 6 },
      { kind: 'powerPlant', residents: 2 },
    ];
  }
  const list: NeedEntry[] = [
    { kind: 'departmentStore', residents: 25 },
    { kind: 'furnitureStore', residents: 10 },
    { kind: 'powerPlant', residents: 8 },
  ];
  if (level >= 5) list.push({ kind: 'drugStore', residents: 5 });
  return list;
}

/** Waren, die der Lieferdienst über einen Laden bringt (nur bei `deliveryGoods`). */
export function deliveryGoods(tier: SkyTier, level: SkyLevel): Array<{ label: string; residents: number; via: BuildingKind }> {
  const list = [{ label: 'Kaugummi', residents: 10, via: 'departmentStore' as BuildingKind }];
  if (tier === 'engineer') list.push({ label: 'Violinen', residents: 5, via: 'drugStore' });
  else {
    if (level >= 4) list.push({ label: 'Billardtische', residents: 15, via: 'furnitureStore' });
    if (level >= 5) list.push({ label: 'Violinen', residents: 5, via: 'drugStore' });
  }
  return list;
}

/**
 * Rathaus-Items je Haus im Radius: Zofe „Blauer Himmel“ +5 je erfülltem
 * Bedürfnis (Kekse, Schreibmaschinen, Cognac, Violinen, Billardtische,
 * Spielzeug, Kaufhaus, Einrichtungshaus, Drogerie), Saint D'Artois +2
 * (Fleischkonserven, Universität, Kaffee, Glühbirnen, Sekt, Dampfwagen,
 * Schokolade). `kind` = über Gebäude, `via` = Lieferdienst-Ware.
 */
export function itemBonuses(
  tier: SkyTier,
  level: SkyLevel,
): Array<{ label: string; residents: number; kind?: BuildingKind; via?: BuildingKind }> {
  if (tier === 'engineer') {
    return [
      { label: 'Kaufhaus', residents: 5, kind: 'departmentStore' },
      { label: 'Einrichtungshaus', residents: 5, kind: 'furnitureStore' },
      { label: 'Drogerie', residents: 5, kind: 'drugStore' },
      { label: 'Schreibmaschinen', residents: 5 },
      { label: 'Violinen', residents: 5, via: 'drugStore' },
      { label: 'Universität', residents: 2, kind: 'university' },
      { label: 'Fleischkonserven', residents: 2 },
      { label: 'Kaffee', residents: 2 },
      { label: 'Glühbirnen', residents: 2 },
    ];
  }
  const list: Array<{ label: string; residents: number; kind?: BuildingKind; via?: BuildingKind }> = [
    { label: 'Kaufhaus', residents: 5, kind: 'departmentStore' },
    { label: 'Einrichtungshaus', residents: 5, kind: 'furnitureStore' },
    { label: 'Kekse', residents: 5 },
    { label: 'Cognac', residents: 5 },
    { label: 'Kaffee', residents: 2 },
    { label: 'Glühbirnen', residents: 2 },
    { label: 'Sekt', residents: 2 },
    { label: 'Schokolade', residents: 2 },
    { label: 'Dampfwagen', residents: 2 },
  ];
  if (level >= 4) {
    list.push({ label: 'Schreibmaschinen', residents: 5 }, { label: 'Billardtische', residents: 5, via: 'furnitureStore' });
  }
  if (level >= 5) {
    list.push(
      { label: 'Violinen', residents: 5, via: 'drugStore' },
      { label: 'Drogerie', residents: 5, kind: 'drugStore' },
      { label: 'Spielzeug', residents: 5 },
    );
  }
  return list;
}

/** Einwohner eines Hochhauses aus Schicht, Stufe, Panorama-Stärke und Versorgung. */
export function skyscraperResidents(
  tier: SkyTier,
  level: SkyLevel,
  panorama: number,
  supply: HouseSupply,
  rules: Pick<RuleConfig, 'townHallItems' | 'deliveryGoods' | 'missingGoods' | 'lifestyleGoods'>,
): { residents: number; itemBonus: number; lifestyle: number; missing: BuildingKind[]; missingGoods: string[] } {
  const table = SKYSCRAPER_RESIDENTS[tier][level] ?? SKYSCRAPER_RESIDENTS[tier][3] ?? [0, 0, 0, 0, 0, 0];
  let n = table[Math.max(0, Math.min(5, panorama))];
  const missing: BuildingKind[] = [];
  const missingGoods: string[] = [];
  const p = Math.max(0, Math.min(5, panorama));
  for (const need of serviceNeeds(tier, level)) {
    const share = need.kind === 'university' ? supply.universityFactor : supply.services[need.kind] ? 1 : 0;
    if (share < 1) {
      // Strom zählt zu den Panorama-Bedürfnissen (Wiki „Skyscrapers“: der
      // Panorama-Bonus verteilt sich mit +5 je Stärke auf Sekt, Zigarren,
      // Schokolade, Dampfwagen, Strom bzw. Brillen, Kaffee, Strom, Glühbirnen).
      const extra = need.kind === 'powerPlant' ? 5 * p : 0;
      n -= (need.residents + extra) * (1 - share);
      missing.push(need.kind);
    }
  }
  const items = rules.townHallItems && supply.townHall;
  const delivered = (via: BuildingKind): boolean => !rules.deliveryGoods || (items && !!supply.services[via]);
  const deliveryLabels = new Set<string>();
  if (rules.deliveryGoods) {
    for (const g of deliveryGoods(tier, level)) {
      deliveryLabels.add(g.label);
      if (!delivered(g.via)) {
        n -= g.residents;
        missingGoods.push(g.label);
      }
    }
  }
  // Fehlende Waren-Grundbedürfnisse (Einstellung „Waren“): ihre Einwohner und
  // bei Panorama-Waren 5 je Panorama-Stärke fallen weg.
  const absent = new Set(rules.missingGoods ?? []);
  const hasGood = (label: string): boolean => {
    const g = goodByLabel(tier, label);
    return !g || !absent.has(g.id);
  };
  if (absent.size) {
    for (const g of GOOD_NEEDS) {
      if (g.tier !== tier || g.type !== 'basic' || (g.minLevel ?? 0) > level || !absent.has(g.id)) continue;
      if (deliveryLabels.has(g.label)) continue;
      n -= g.residents + (g.panorama ? 5 * p : 0);
      missingGoods.push(g.label);
    }
  }
  let bonus = 0;
  if (items) {
    for (const b of itemBonuses(tier, level)) {
      if (b.kind === 'university') bonus += b.residents * supply.universityFactor;
      else if (b.kind) bonus += supply.services[b.kind] ? b.residents : 0;
      else if (b.via) bonus += delivered(b.via) && hasGood(b.label) ? b.residents : 0;
      else bonus += hasGood(b.label) ? b.residents : 0;
    }
  }
  // Lebensstil-Waren: zusätzliche Einwohner, + 5 je Hochhaus-Stufe.
  let lifestyle = 0;
  const enabled = new Set(rules.lifestyleGoods ?? []);
  if (enabled.size) {
    for (const g of GOOD_NEEDS) {
      if (g.tier === tier && g.type === 'lifestyle' && enabled.has(g.id)) lifestyle += g.residents + LIFESTYLE_PER_LEVEL * level;
    }
  }
  n = Math.round(n);
  bonus = Math.round(bonus);
  if (!supply.hasRoad) return { residents: 0, itemBonus: 0, lifestyle: 0, missing, missingGoods };
  return { residents: Math.max(0, n) + bonus + lifestyle, itemBonus: bonus, lifestyle, missing, missingGoods };
}
