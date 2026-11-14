// Stadt-Analyse: Wer ist von welchem Gebäude versorgt, welches Panorama hat
// jedes Hochhaus, wie viele Einwohner sind zu erwarten, was ist verletzt?

import type { BuildingKind, Tier } from './catalog';
import { adjacentRoads, RoadSearch, type City, type CityBuilding } from './city';
import {
  type TierEdits,
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
  /** Aufschlüsselung wie im Spiel: kleinere, gleich hohe (gleiche Schicht), Variety Bonus. */
  panoramaParts: { lower: number; sameOrHigher: number; variety: number };
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
  /** Wohnhäuser ohne Schicht (nur im Modus „wie im Stempel“). */
  nonSkyscrapers: number[];
  /** Gruppen-Zuordnung der Wohnhäuser (für Klick-Umschalten). */
  groupOf: Map<number, number>;
  groupState: Map<number, 0 | 1>;
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

export function analyzeCity(
  city: City,
  rules: RuleConfig,
  edits: TierEdits = { houses: new Map(), groups: new Map() },
): Analysis {
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

  // --- Wohnhäuser vorbereiten und Schichten zuordnen
  const houses = city.buildings.filter((b) => b.entry.kind === 'residence');
  const tiers = assignTiers(houses, rules, edits);
  const nonSkyscrapers = houses.filter((h) => !tiers.tier.has(h.index)).map((h) => h.index);
  const residences: ResidenceInfo[] = houses
    .filter((b) => tiers.tier.has(b.index))
    .map((b) => ({
      building: b,
      tier: tiers.tier.get(b.index) as Tier,
      hasRoad: roadsOf[b.index].length > 0,
      services: {},
      townHall: null,
      post: null,
      panoramaValue: 0,
      panoramaParts: { lower: 0, sameOrHigher: 0, variety: 0 },
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
    const parts = { lower: 0, sameOrHigher: 0, variety: 0 };
    for (const o of sky) {
      if (o === r) continue;
      if (dist(r.building, o.building) > radius + 1e-9) continue;
      // Alle gleiche Stufe: andere Schicht = Variety Bonus, gleiche Schicht = −1.
      if (o.tier === r.tier) parts.sameOrHigher--;
      else parts.variety++;
    }
    v += parts.lower + parts.sameOrHigher + parts.variety;
    r.panoramaParts = parts;
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
  const unknownList = city.buildings.filter((b) => b.entry.name.startsWith('Unbekannt'));
  const unknown = unknownList.length;
  if (unknown) {
    const guids = [...new Set(unknownList.map((b) => b.guid))];
    warnings.push(
      `${unknown} unbekannte Gebäude (Mods?) – Größe als 1×1 angenommen. GUIDs: ${guids.slice(0, 8).join(', ')}${
        guids.length > 8 ? ' …' : ''
      }`,
    );
  }

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
    nonSkyscrapers,
    groupOf: tiers.groupOf,
    groupState: tiers.groupState,
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

export interface TierAssignment {
  tier: Map<number, Tier>;
  /** Gebäudeindex → Gruppen-ID (kleinster Gebäudeindex der Gruppe). */
  groupOf: Map<number, number>;
  /** Gruppen-ID → aktuelle Ausrichtung (0: erste Linie Ingenieure). */
  groupState: Map<number, 0 | 1>;
}

/**
 * Schichten der Wohnhäuser. Direkt aneinanderstoßende 3×3-Häuser bilden eine
 * Gruppe (deine 8er-Gruppe: eine Linie aus 4 Ingenieuren, eine aus 4
 * Investoren). Ist die Gruppe höher als breit, sind die Linien Spalten, sonst
 * Reihen; benachbarte Linien wechseln die Schicht. Welche Linie Ingenieure
 * sind, steht nicht im Stempel – je Gruppe wird die Ausrichtung mit dem
 * meisten Panorama-Einwohnern gewählt (lokale Suche), außer der Nutzer hat sie
 * per Klick festgelegt. Alle Häuser zählen als Hochhaus der gewählten Stufe.
 */
export function assignTiers(
  houses: readonly CityBuilding[],
  rules: RuleConfig,
  edits: TierEdits = { houses: new Map(), groups: new Map() },
): TierAssignment {
  const tier = new Map<number, Tier>();
  const groupOf = new Map<number, number>();
  const groupState = new Map<number, 0 | 1>();
  if (rules.tierMode === 'stamp') {
    for (const h of houses) if (h.entry.tier) tier.set(h.index, h.entry.tier);
    return { tier, groupOf, groupState };
  }
  const grid = houses.filter((h) => h.w === 3 && h.h === 3);
  const at = new Map<string, CityBuilding>();
  for (const h of grid) at.set(`${h.x},${h.y}`, h);

  // Gruppen: direkt anstoßende Häuser (gleiche Reihe ±3 oder gleiche Spalte ±3).
  const groups: CityBuilding[][] = [];
  const seen = new Set<number>();
  for (const start of [...grid].sort((a, b) => a.index - b.index)) {
    if (seen.has(start.index)) continue;
    const members: CityBuilding[] = [];
    const queue = [start];
    seen.add(start.index);
    while (queue.length) {
      const h = queue.pop() as CityBuilding;
      members.push(h);
      for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
        const o = at.get(`${h.x + dx},${h.y + dy}`);
        if (o && !seen.has(o.index)) {
          seen.add(o.index);
          queue.push(o);
        }
      }
    }
    groups.push(members);
  }

  // Linien-Parität je Haus (0/1) aus der Gruppenausrichtung.
  const parity = new Map<number, number>();
  for (const members of groups) {
    const xs = [...new Set(members.map((m) => m.x))].sort((a, b) => a - b);
    const ys = [...new Set(members.map((m) => m.y))].sort((a, b) => a - b);
    // Genau 2 Spalten → senkrecht (auch Reste neben Rathäusern), genau 2 Reihen → waagerecht.
    const vertical = xs.length === 2 || (ys.length !== 2 && ys.length >= xs.length);
    const id = Math.min(...members.map((m) => m.index));
    for (const m of members) {
      parity.set(m.index, vertical ? xs.indexOf(m.x) % 2 : ys.indexOf(m.y) % 2);
      groupOf.set(m.index, id);
    }
  }

  // Panorama-Nachbarn (Mittelpunktabstand ≤ Radius).
  const level = rules.skyscraperLevel;
  const radius = PANORAMA_RADIUS[level];
  const near = new Map<number, number[]>();
  const cell = (v: number): number => Math.floor(v / 6);
  const buckets = new Map<string, CityBuilding[]>();
  for (const h of grid) {
    const k = `${cell(h.cx)},${cell(h.cy)}`;
    const list = buckets.get(k);
    if (list) list.push(h);
    else buckets.set(k, [h]);
  }
  for (const h of grid) {
    const list: number[] = [];
    for (let bx = cell(h.cx) - 1; bx <= cell(h.cx) + 1; bx++) {
      for (let by = cell(h.cy) - 1; by <= cell(h.cy) + 1; by++) {
        for (const o of buckets.get(`${bx},${by}`) ?? []) {
          if (o !== h && dist(h, o) <= radius + 1e-9) list.push(o.index);
        }
      }
    }
    near.set(h.index, list);
  }

  const state = new Map<number, 0 | 1>();
  for (const members of groups) {
    const id = groupOf.get(members[0].index) as number;
    state.set(id, edits.groups.get(id) ?? 0);
  }
  const tierOf = (index: number): Tier => {
    const fixed = edits.houses.get(index);
    if (fixed) return fixed;
    const s = state.get(groupOf.get(index) as number) ?? 0;
    return ((parity.get(index) as number) ^ s) === 0 ? 'engineer' : 'investor';
  };
  const residentsOf = (index: number): number => {
    const t = tierOf(index) as 'engineer' | 'investor';
    let v = level;
    for (const o of near.get(index) ?? []) v += tierOf(o) === t ? -1 : 1;
    return SKYSCRAPER_L3_RESIDENTS[t][Math.max(0, Math.min(5, v))];
  };

  // Lokale Suche: Gruppe umdrehen, wenn die betroffenen Häuser dadurch mehr Einwohner haben.
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (const members of groups) {
      const id = groupOf.get(members[0].index) as number;
      if (edits.groups.has(id)) continue;
      const affected = new Set<number>();
      for (const m of members) {
        affected.add(m.index);
        for (const o of near.get(m.index) ?? []) affected.add(o);
      }
      let before = 0;
      for (const i of affected) before += residentsOf(i);
      state.set(id, state.get(id) === 1 ? 0 : 1);
      let after = 0;
      for (const i of affected) after += residentsOf(i);
      if (after > before) changed = true;
      else state.set(id, state.get(id) === 1 ? 0 : 1);
    }
    if (!changed) break;
  }

  for (const h of grid) tier.set(h.index, tierOf(h.index));
  // Wohnhäuser, die nicht 3×3 sind (selten): wie im Stempel, sonst Investor.
  for (const h of houses) if (!tier.has(h.index)) tier.set(h.index, h.entry.tier ?? 'investor');
  for (const [id, s] of state) groupState.set(id, s);
  return { tier, groupOf, groupState };
}
