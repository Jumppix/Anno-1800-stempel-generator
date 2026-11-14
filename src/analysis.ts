// Stadt-Analyse: Wer ist von welchem Gebäude versorgt, welches Panorama hat
// jedes Hochhaus, wie viele Einwohner sind zu erwarten, was ist verletzt?

import type { BuildingKind, Tier } from './catalog';
import { adjacentRoads, RoadSearch, type City, type CityBuilding } from './city';
import {
  cityWideWebBonus,
  localDepartmentRange,
  PANORAMA_RADIUS,
  SKYSCRAPER_L3_RESIDENTS,
  SKYSCRAPER_SERVICE_NEEDS,
  welfareApplies,
  welfareBonus,
  type RuleConfig,
} from './rules';

/** Bedürfnisse, die über Straßenreichweite erfüllt werden und angezeigt werden. */
export const SERVICE_KINDS: readonly BuildingKind[] = [
  'departmentStore',
  'furnitureStore',
  'drugStore',
  'university',
  'powerPlant',
  'bank',
  'varietyTheatre',
  'membersClub',
  'fireStation',
  'policeStation',
  'hospital',
];

export interface ResidenceInfo {
  building: CityBuilding;
  tier: Tier;
  hasRoad: boolean;
  /** Versorgt je Bedürfnisart (Straßenreichweite). */
  services: Partial<Record<BuildingKind, boolean>>;
  townHall: number | null;
  post: number | null;
  /** Panorama-Wert vor Begrenzung und Stärke 0–5 (nur Hochhäuser). */
  panoramaValue: number;
  panorama: number;
  residents: number;
  /** Fehlende Einwohner-Bedürfnisse (Namen der Gebäudearten). */
  missing: BuildingKind[];
}

export interface ServiceInfo {
  building: CityBuilding;
  baseRange: number;
  range: number;
  inMinistry: boolean;
  hasRoad: boolean;
  warehouseInRange: boolean | null;
  covers: number;
}

export interface Analysis {
  residences: ResidenceInfo[];
  /** Anzahl Handelskammern, deren Radius den Mittelpunkt erreicht (≥ 2 = geclippt). */
  tradeUnionHits: Map<number, number>;
  services: ServiceInfo[];
  /** Straßenentfernung vom Regionalministerium je Kachel (für die Anzeige). */
  ministryRoads: Uint8Array;
  ministryRange: number;
  hasMinistry: boolean;
  warnings: string[];
  totals: {
    residents: number;
    skyscrapers: number;
    byTier: Record<Tier, number>;
    coverage: Partial<Record<BuildingKind, number>>;
    townHallShare: number;
    postShare: number;
    panorama: number[];
    unknown: number;
  };
}

const dist = (a: CityBuilding, b: CityBuilding): number => Math.hypot(a.cx - b.cx, a.cy - b.cy);

export function analyzeCity(city: City, rules: RuleConfig): Analysis {
  const warnings: string[] = [];
  const search = new RoadSearch(city);
  const roadsOf = city.buildings.map((b) => adjacentRoads(city, b));

  // --- Regionalministerium: welche Gebäude liegen in seiner Straßenreichweite?
  const ministries = city.buildings.filter((b) => b.entry.kind === 'localDepartment');
  const ministryRange = localDepartmentRange(rules);
  const ministryRoads = new Uint8Array(city.w * city.h);
  const inMinistry = new Uint8Array(city.buildings.length);
  if (ministries.length > 1) warnings.push('Mehr als ein Regionalministerium – im Spiel ist nur eines je Insel erlaubt.');
  for (const m of ministries) {
    const starts = roadsOf[m.index];
    if (starts.length === 0) {
      warnings.push('Regionalministerium ohne Straßenanschluss.');
      continue;
    }
    search.run(starts, ministryRange);
    for (let i = 0; i < ministryRoads.length; i++) if (search.distance(i)) ministryRoads[i] = 1;
    for (const b of city.buildings) if (search.reaches(roadsOf[b.index])) inMinistry[b.index] = 1;
  }
  const welfare = welfareBonus(rules);
  const wideWeb = cityWideWebBonus(rules);

  // --- Wohnhäuser vorbereiten
  const residences: ResidenceInfo[] = city.buildings
    .filter((b) => b.entry.kind === 'residence' && b.entry.tier)
    .map((b) => ({
      building: b,
      tier: b.entry.tier as Tier,
      hasRoad: roadsOf[b.index].length > 0,
      services: {},
      townHall: null,
      post: null,
      panoramaValue: 0,
      panorama: 0,
      residents: 0,
      missing: [],
    }));

  // --- Versorgung über Straßen
  const warehouses = city.buildings.filter(
    (b) => b.entry.kind === 'warehouse' || b.entry.kind === 'airport',
  );
  const services: ServiceInfo[] = [];
  for (const b of city.buildings) {
    const base = b.entry.roadRange;
    if (!base || !SERVICE_KINDS.includes(b.entry.kind)) continue;
    const bonusWelfare = inMinistry[b.index] && welfareApplies(b.entry.kind, b.entry.welfare, rules) ? welfare : 0;
    const bonusWeb = inMinistry[b.index] && b.entry.kind === 'powerPlant' ? wideWeb : 0;
    const range = base + bonusWelfare + bonusWeb;
    const starts = roadsOf[b.index];
    const info: ServiceInfo = {
      building: b,
      baseRange: base,
      range,
      inMinistry: inMinistry[b.index] === 1,
      hasRoad: starts.length > 0,
      warehouseInRange: null,
      covers: 0,
    };
    if (starts.length) {
      search.run(starts, range);
      for (const r of residences) {
        if (search.reaches(roadsOf[r.building.index])) {
          r.services[b.entry.kind] = true;
          info.covers++;
        }
      }
      if (b.entry.needsWarehouse) {
        info.warehouseInRange = warehouses.some((wh) => search.reaches(roadsOf[wh.index]) > 0);
      }
    }
    services.push(info);
  }

  // --- Kreisradien: Rathaus und Post (Mittelpunkt im Radius, ≤)
  const townHalls = city.buildings.filter((b) => b.entry.kind === 'townHall');
  const posts = city.buildings.filter((b) => b.entry.kind === 'postOffice' || b.entry.kind === 'postBox');
  for (const r of residences) {
    for (const t of townHalls) {
      if (dist(r.building, t) <= (t.entry.radius ?? 0) + 1e-9) {
        r.townHall = t.index;
        break;
      }
    }
    for (const p of posts) {
      if (dist(r.building, p) <= (p.entry.radius ?? 0) + 1e-9) {
        r.post = p.index;
        break;
      }
    }
  }

  // --- Handelskammern: wie viele wirken auf jedes Nicht-Wohngebäude?
  const unions = city.buildings.filter((b) => b.entry.kind === 'tradeUnion');
  const tradeUnionHits = new Map<number, number>();
  if (unions.length) {
    for (const b of city.buildings) {
      const k = b.entry.kind;
      if (k === 'residence' || k === 'tradeUnion' || k === 'townHall') continue;
      let n = 0;
      for (const u of unions) if (dist(b, u) <= (u.entry.radius ?? 0) + 1e-9) n++;
      if (n) tradeUnionHits.set(b.index, n);
    }
  }

  // --- Überlappungsregeln für Kreisradien
  const checkOverlap = (list: CityBuilding[], label: string): void => {
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const need = (list[i].entry.radius ?? 0) + (list[j].entry.radius ?? 0);
        if (dist(list[i], list[j]) < need - 1e-9) n++;
      }
    }
    if (n) warnings.push(`${label}: ${n} überlappende Radien.`);
  };
  checkOverlap(townHalls, 'Rathäuser');
  checkOverlap(city.buildings.filter((b) => b.entry.kind === 'tradeUnion'), 'Handelskammern');
  checkOverlap(posts, 'Postämter/Briefkästen');

  // --- Panorama (alle Ingenieur-/Investorenhäuser als Hochhaus der gewählten Stufe)
  const level = rules.skyscraperLevel;
  const radius = PANORAMA_RADIUS[level];
  const sky = residences.filter((r) => r.tier === 'engineer' || r.tier === 'investor');
  for (const r of sky) {
    let v = level;
    for (const o of sky) {
      if (o === r) continue;
      if (dist(r.building, o.building) <= radius + 1e-9) v += o.tier === r.tier ? -1 : 1;
    }
    r.panoramaValue = v;
    r.panorama = Math.max(0, Math.min(5, v));
  }

  // --- Einwohner-Schätzung
  for (const r of residences) {
    if (r.tier === 'artisan') {
      r.residents = 30;
      continue;
    }
    const tier = r.tier;
    let n = SKYSCRAPER_L3_RESIDENTS[tier][r.panorama];
    for (const need of SKYSCRAPER_SERVICE_NEEDS[tier]) {
      if (!r.services[need.kind]) {
        n -= need.residents;
        r.missing.push(need.kind);
      }
    }
    if (!r.hasRoad) n = 0;
    r.residents = Math.max(0, n);
  }

  // --- Weitere Prüfungen
  const noRoad = residences.filter((r) => !r.hasRoad).length;
  if (noRoad) warnings.push(`${noRoad} Wohnhäuser ohne Straßenanschluss.`);
  for (const s of services) {
    if (!s.hasRoad) warnings.push(`${s.building.entry.name} ohne Straßenanschluss.`);
    if (s.warehouseInRange === false) {
      warnings.push(
        `${s.building.entry.name}: kein Lagerhaus/Lufthafen in Reichweite (Kontor ist im Stempel nicht sichtbar).`,
      );
    }
  }
  if (city.conflicts) warnings.push(`${city.conflicts} Kacheln sind zugleich Straße und Gebäude.`);
  const unknown = city.buildings.filter((b) => b.entry.name.startsWith('Unbekannt')).length;
  if (unknown) warnings.push(`${unknown} unbekannte Gebäude (Mods?) – Größe als 1×1 angenommen.`);

  // --- Summen
  const byTier: Record<Tier, number> = { artisan: 0, engineer: 0, investor: 0 };
  let residents = 0;
  for (const r of residences) {
    byTier[r.tier] += r.residents;
    residents += r.residents;
  }
  const coverage: Partial<Record<BuildingKind, number>> = {};
  for (const kind of SERVICE_KINDS) {
    if (!sky.length) break;
    coverage[kind] = sky.filter((r) => r.services[kind]).length / sky.length;
  }
  const panorama = [0, 0, 0, 0, 0, 0];
  for (const r of sky) panorama[r.panorama]++;

  return {
    residences,
    tradeUnionHits,
    services,
    ministryRoads,
    ministryRange,
    hasMinistry: ministries.length > 0,
    warnings,
    totals: {
      residents,
      skyscrapers: sky.length,
      byTier,
      coverage,
      townHallShare: residences.length ? residences.filter((r) => r.townHall !== null).length / residences.length : 0,
      postShare: residences.length ? residences.filter((r) => r.post !== null).length / residences.length : 0,
      panorama,
      unknown,
    },
  };
}
