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
  /**
   * Kaugummi und Violinen werden nicht produziert, sondern nur über den
   * Lieferdienst „Blauer Himmel“ verteilt: Häuser im Rathausradius bekommen
   * Kaugummi, wenn ein Kaufhaus sie versorgt, und Violinen, wenn eine Drogerie
   * sie versorgt. Ohne das fehlen diese Waren.
   */
  deliveryGoods: boolean;
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
};

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
  rules: Pick<RuleConfig, 'townHallItems' | 'deliveryGoods'>,
): { residents: number; itemBonus: number; missing: BuildingKind[]; missingGoods: string[] } {
  const table = SKYSCRAPER_RESIDENTS[tier][level] ?? SKYSCRAPER_RESIDENTS[tier][3] ?? [0, 0, 0, 0, 0, 0];
  let n = table[Math.max(0, Math.min(5, panorama))];
  const missing: BuildingKind[] = [];
  const missingGoods: string[] = [];
  for (const need of serviceNeeds(tier, level)) {
    const share = need.kind === 'university' ? supply.universityFactor : supply.services[need.kind] ? 1 : 0;
    if (share < 1) {
      n -= need.residents * (1 - share);
      missing.push(need.kind);
    }
  }
  const items = rules.townHallItems && supply.townHall;
  const delivered = (via: BuildingKind): boolean => !rules.deliveryGoods || (items && !!supply.services[via]);
  if (rules.deliveryGoods) {
    for (const g of deliveryGoods(tier, level)) {
      if (!delivered(g.via)) {
        n -= g.residents;
        missingGoods.push(g.label);
      }
    }
  }
  let bonus = 0;
  if (items) {
    for (const b of itemBonuses(tier, level)) {
      if (b.kind === 'university') bonus += b.residents * supply.universityFactor;
      else if (b.kind) bonus += supply.services[b.kind] ? b.residents : 0;
      else if (b.via) bonus += delivered(b.via) ? b.residents : 0;
      else bonus += b.residents;
    }
  }
  n = Math.round(n);
  bonus = Math.round(bonus);
  if (!supply.hasRoad) return { residents: 0, itemBonus: 0, missing, missingGoods };
  return { residents: Math.max(0, n) + bonus, itemBonus: bonus, missing, missingGoods };
}
