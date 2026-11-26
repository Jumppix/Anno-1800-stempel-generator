// Ein kompletter Planungsdurchlauf in einem Stück (für den Pipeline-Worker).
//
// Gleicher Ablauf wie früher in der Oberfläche, aber ohne Umwege über einzelne
// Worker-Aufträge – so können mehrere Durchläufe gleichzeitig in eigenen
// Workern laufen (PlannerUi startet einen Pool, der beste Plan gewinnt):
// Bebauung → Rathäuser → Nachverdichtung → Produktion/Lufthafen/Versorgung →
// Stufen → Versorgung an Stufen anpassen → Stufen → Querstraßen anpassen →
// Stufen → Briefkästen → Bewertung.

import { analyzeCity } from './analysis';
import type { BuildingKind } from './catalog';
import { cityFromStamp } from './city';
import type { InsertReport } from './codesign';
import { addBridges, FREE, searchFill, WATER, type Orientation } from './fill';
import { optimizeLevels, type LevelMode, type LevelResult } from './levels';
import {
  compactCity,
  compactValued,
  finishPlan,
  improveRoads,
  planFromFill,
  planPost,
  planServices,
  planToStampItems,
  planOil,
  railSegments,
  refillAroundTownHalls,
  townHallProblem,
  type CityPlan,
} from './planner';
import type { PostReport } from './post';
import type { ProductionOptions } from './production';
import type { ServiceOptions } from './services';
import { estimateOilHarbor, type OilOptions, type OilReport } from './oil';
import { mailResidentsFor, mailTypes, type RuleConfig } from './rules';
import type { MipSolver, ServiceReport } from './services';
import { solve, type LandMask } from './solver';
import { buildGenericStamp } from './stamp';
import { decodeStampFull } from './stampReader';
import type { ThinReport } from './thin';

type Planned = Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>;

export interface PassInput {
  mask: LandMask;
  lines: number;
  seed: number;
  orientation: 'auto' | Orientation;
  bridgeLen: number;
  townHalls: boolean;
  minCover: number;
  rhBudget: number;
  compactMs: number;
  kinds: BuildingKind[];
  goal: number;
  deliveryGoods: boolean;
  townHallItems: boolean;
  ministry?: ServiceOptions['ministry'];
  /** Palastinsel: Museen für die fehlende Attraktivität. */
  culture?: ServiceOptions['culture'];
  /** Lehmgruben-Cluster (verschiebbare Vorkommen aus dem Stempel). */
  clay?: ServiceOptions['clay'];
  /** Ölmodus: Ölkraftwerke statt Gaskraftwerke, Ölhafen und Gleise (`oil.ts`). */
  oil?: OilOptions;
  /** Minen aus dem Stempel (Straßenanschluss + Lagerhaus). */
  mines?: ServiceOptions['mines'];
  airport?: { harbor: { x: number; y: number } | null };
  production?: ProductionOptions;
  levelMode: LevelMode;
  levelMs: number;
  selfWorkforce: boolean;
  post: boolean;
  insert: boolean;
  thin: boolean;
  rules: RuleConfig;
  /** Zwischenstände senden (nur für den Durchlauf, dessen Bild gezeigt wird). */
  snapshots: boolean;
  /** Höchstzahl der Runden Versorgung ↔ Stufen (Standard 4). */
  serviceRounds?: number;
  /** Exakten Löser (HiGHS) für die Ladenplatzierung nutzen (Standard aus). */
  exact?: boolean;
  /** M5: Nachverdichtung nach Einwohnern am Ende (ms, 0 = aus; Standard aus – kein messbarer Gewinn). */
  valueCompactMs?: number;
  /** Ölmodus: Rechenzeit der Gleisoptimierung (ms; Standard nach Inselgröße 3–20 s). */
  oilMs?: number;
  /**
   * Ölmodus: Ölkraftwerke zum Gleisnetz ziehen (geschätzte Einwohner je Gleiskachel; 0 = aus).
   * Standard je nach Durchlauf (`seed`), damit der Pool verschiedene Stärken vergleicht.
   */
  oilPull?: number;
  /** Ölmodus: Nachverdichtung um die Gleise (ms; Standard max(4000, valueCompactMs)). */
  oilCompactMs?: number;
}

export interface PassResult {
  city: CityPlan;
  /** [Gebäudeindex, 0 = Ingenieur/1 = Investor, Stufe] */
  planned: Array<[number, number, number]>;
  residents: number;
  levels: { mode: string; counts: Record<string, number>; engineers: number; minEngineers: number };
  services: ServiceReport | null;
  post: (PostReport & { removedHouses: number }) | null;
  compactGained: number;
  thin: ThinReport | null;
  insert: InsertReport | null;
  /** M5: Nachverdichtung nach Einwohnern (Häuser-Bilanz, Einwohner-Gewinn, übernommen?). */
  valueCompact: { gained: number; residents: number; accepted: boolean } | null;
  /** Ölmodus: Ölhafen, Raffinerien, Gleise. */
  oil?: OilReport | null;
  /** Nachverdichtung um die Gleise (Häuser-Bilanz, Einwohner-Gewinn, übernommen?). */
  oilCompact?: { gained: number; residents: number; accepted: boolean } | null;
  ms: number;
}

export type PassEvent =
  | { kind: 'step'; label: string; detail?: string }
  | { kind: 'detail'; text: string }
  | { kind: 'snapshot'; city: CityPlan; planned?: Array<[number, number, number]> };

const stampCity = (mask: LandMask, city: CityPlan, bridges: boolean): ReturnType<typeof cityFromStamp> => {
  const items = planToStampItems(mask, city, { coast: false, coastGuid: 1000178, bridges });
  return cityFromStamp(decodeStampFull(buildGenericStamp(items.buildings, 'ow', items.streets, undefined, railSegments(items.rails))));
};

const toArray = (planned: Planned): Array<[number, number, number]> =>
  [...planned].map(([idx, st]) => [idx, st.tier === 'engineer' ? 0 : 1, st.level]);

/** Geplante Stufen über die Lage der Häuser auf einen neuen Plan übertragen. */
function remap(before: CityPlan, after: CityPlan, planned: Planned): Planned {
  const byPos = new Map<string, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>();
  before.houses.forEach((hs, k) => {
    const st = planned.get(k);
    if (st) byPos.set(`${hs.x},${hs.y}`, st);
  });
  const out: Planned = new Map();
  after.houses.forEach((hs, k) => {
    const st = byPos.get(`${hs.x},${hs.y}`);
    if (st) out.set(k, st);
  });
  return out;
}

/** Geplante Einwohner je Haus (Lage „x,y“) – Wert, den ein Gleis durch dieses Haus kostet. */
export function residentsByHouse(mask: LandMask, city: CityPlan, rules: RuleConfig, planned: Planned, mail = false): Map<string, number> {
  const analysis = analyzeCity(stampCity(mask, city, true), rules, { houses: new Map(), groups: new Map(), planned });
  // Briefkästen kommen erst später: den Post-Bonus der Stufe schon mitzählen
  const types = mail ? mailTypes(rules.mail) : [];
  const out = new Map<string, number>();
  for (const r of analysis.residences) {
    const hs = city.houses[r.building.index];
    const bonus = types.length && r.tier !== 'artisan' && !r.mailBonus ? mailResidentsFor(r.tier, r.level, types) : 0;
    if (hs) out.set(`${hs.x},${hs.y}`, r.residents + bonus);
  }
  return out;
}

/** Stärken des Zugs zum Gleisnetz (Einwohner je Gleiskachel) je Durchlauf (`seed`). */
export const OIL_PULLS = [20, 0, 40, 10];

function oilRailFor(input: PassInput, city: CityPlan): ServiceOptions['oilRail'] {
  if (!input.oil) return undefined;
  const perTile = input.oilPull ?? OIL_PULLS[input.seed % OIL_PULLS.length];
  if (!perTile) return undefined;
  const { mask } = input;
  const cell = new Uint8Array(mask.w * mask.h);
  for (let i = 0; i < cell.length; i++) cell[i] = mask.data[i] ? FREE : WATER;
  const p = estimateOilHarbor(mask, cell, city.houses, input.oil);
  return p ? { ...p, perTile } : undefined;
}

/** Hochhaus-Stufen für einen Plan (Ingenieure je Kraftwerk aus den Spieldaten: Gas 250, Öl 150). */
export function levelsFor(input: PassInput, c: CityPlan, seedOffset: number): LevelResult {
  const { mask, rules } = input;
  const withMail = input.post && rules.mail !== 'none';
  const analysis = analyzeCity(stampCity(mask, c, true), rules);
  const engineers = (c.services ?? []).filter((sv) => sv.kind === 'powerPlant').reduce((a, sv) => a + (sv.guid === 100780 ? 150 : 250), 0);
  return optimizeLevels(analysis.residences, rules, input.levelMode, input.levelMs, 11 + input.seed * 977 + seedOffset, {
    minEngineers: input.selfWorkforce ? engineers : 0,
    mailTypes: withMail ? mailTypes(rules.mail) : undefined,
  });
}

/**
 * 7c. Ölversorgung: Ölhafen, Raffinerien mit Bohrtürmen, Gleise zu allen Ölkraftwerken –
 * Gleise so, dass möglichst wenige Einwohner weichen (Wert je Haus = geplante Einwohner),
 * danach um die Gleise nachverdichten (übernommen, wenn es Einwohner bringt).
 */
export function oilStage(
  input: PassInput,
  start: CityPlan,
  lvStart: LevelResult,
  emit: (e: PassEvent) => void,
): { city: CityPlan; lv: LevelResult; oil: OilReport; oilCompact: PassResult['oilCompact'] } {
  const { mask, rules } = input;
  emit({ kind: 'step', label: 'Ölversorgung (Ölhafen, Gleise)' });
  const values = residentsByHouse(mask, start, rules, lvStart.planned, input.post && rules.mail !== 'none');
  const budgetMs = input.oilMs ?? Math.min(20000, Math.max(3000, start.houses.length * 1.5));
  const r = planOil(mask, start, { ...(input.oil as OilOptions), values, budgetMs, seed: 1 + input.seed * 31 + input.lines });
  let city: CityPlan = { ...r.city, removedHouses: start.removedHouses };
  let lv = lvStart;
  let oilCompact: PassResult['oilCompact'] = null;
  if (r.city.houses.length !== start.houses.length) {
    const lvOil = levelsFor(input, city, 7);
    lv = lvOil;
    const ms = input.oilCompactMs ?? Math.max(4000, input.valueCompactMs ?? 0);
    if (ms > 0) {
      emit({ kind: 'step', label: 'Nachverdichtung um die Gleise' });
      const c = compactValued(mask, city, { deadline: performance.now() + ms, seed: 53 + input.seed * 7349 + input.lines });
      if (c.result.improvements > 0) {
        const cand: CityPlan = { ...c.city, removedHouses: city.removedHouses };
        const lvc = levelsFor(input, cand, 8);
        const accepted = lvc.residents > lvOil.residents;
        oilCompact = { gained: c.result.gained, residents: lvc.residents - lvOil.residents, accepted };
        if (accepted) {
          city = cand;
          lv = lvc;
        }
      } else oilCompact = { gained: 0, residents: 0, accepted: false };
    }
  }
  return { city, lv, oil: r.report, oilCompact };
}

/**
 * `mip`: exakter Löser für die Ladenplatzierung (HiGHS im Worker geladen);
 * ohne ihn Gierig + lokale Suche.
 */
export function runPass(input: PassInput, emit: (e: PassEvent) => void, mip?: MipSolver): PassResult {
  const t0 = performance.now();
  const { mask, rules } = input;
  const snap = (city: CityPlan, planned?: Planned): void => {
    if (input.snapshots) emit({ kind: 'snapshot', city, planned: planned ? toArray(planned) : undefined });
  };

  // 1. Bebauung
  emit({ kind: 'step', label: 'Bebauung (Raster, Gittersuche)' });
  const fill = searchFill(mask, { orientation: input.orientation, housesPerLine: input.lines });
  addBridges(fill, input.bridgeLen);
  const plan = planFromFill(fill);
  snap(finishPlan(plan, [], 0));

  // 2. Rathäuser
  let townHalls: Array<{ x: number; y: number }> = [];
  if (input.townHalls && plan.houses.length) {
    emit({ kind: 'step', label: 'Rathäuser optimieren', detail: `${plan.houses.length} Häuser` });
    const problem = townHallProblem(mask, plan);
    const layout = solve(problem.target, ['rh'], {
      budgetMs: input.rhBudget,
      seed: 4242 + input.seed * 7919 + input.lines,
      allowed: problem.allowed,
      overlapPenalty: problem.penalty,
    });
    townHalls = (layout.groups[0]?.chambers ?? []).map((c) => ({ x: c.x, y: c.y }));
  }
  const refilled = refillAroundTownHalls(mask, finishPlan(plan, townHalls, input.minCover));
  snap(refilled);

  // 3. Nachverdichtung
  let dense: CityPlan = refilled;
  let compactGained = 0;
  if (input.compactMs > 0) {
    emit({ kind: 'step', label: 'Nachverdichtung' });
    const r = compactCity(
      mask,
      refilled,
      {
        deadline: performance.now() + input.compactMs,
        seed: 17 + input.seed * 104729 + input.lines * 31,
        onProgress: (gained) => emit({ kind: 'detail', text: `bisher +${gained} Häuser` }),
      },
      input.snapshots ? (c) => snap(c) : undefined,
    );
    dense = { ...r.city, removedHouses: refilled.removedHouses };
    compactGained = r.result.gained;
    snap(dense);
  }

  // 4. Produktion, Lufthafen & Versorgung
  const withProduction = !!input.production?.requests.some((r) => r.count > 0);
  const serviceOptions = {
    kinds: new Set(input.kinds),
    fullCoverageValue: input.goal,
    deliveryGoods: input.deliveryGoods,
    townHallItems: input.townHallItems,
    ministry: input.ministry,
    culture: input.culture,
    clay: input.clay,
    oilPower: !!input.oil,
    oilRail: oilRailFor(input, dense),
    mines: input.mines,
    airport: input.airport,
    production: input.production,
    mip,
  };
  let services: ServiceReport | null = null;
  let city: CityPlan = dense;
  if (input.kinds.length || withProduction) {
    emit({ kind: 'step', label: 'Produktion, Lufthafen & Versorgung' });
    const r = planServices(mask, dense, serviceOptions);
    city = { ...r.city, removedHouses: refilled.removedHouses };
    services = r.report;
    snap(city);
  }

  // 5. Stufen
  const withMail = input.post && rules.mail !== 'none';
  const levels = (c: CityPlan, seedOffset: number): LevelResult => levelsFor(input, c, seedOffset);
  emit({ kind: 'step', label: 'Hochhaus-Stufen' });
  let lv = levels(city, 0);
  snap(city, lv.planned);

  // 6. Versorgung an die Stufen anpassen (exakte Werte je Haus), Stufen erneut –
  //    abwechselnd, bis es weniger als 0,1 % bringt (höchstens `serviceRounds`).
  if (input.kinds.length && input.levelMode !== 'l3') {
    const rounds = Math.max(1, input.serviceRounds ?? 4);
    for (let round = 1; round <= rounds; round++) {
      emit({ kind: 'step', label: 'Versorgung an Stufen anpassen', detail: rounds > 1 ? `Runde ${round}` : undefined });
      const states = new Map<string, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>();
      city.houses.forEach((hs, k) => {
        const st = lv.planned.get(k);
        if (st) states.set(`${hs.x},${hs.y}`, st);
      });
      const next = planServices(mask, dense, { ...serviceOptions, houseStates: states });
      const city2 = { ...next.city, removedHouses: refilled.removedHouses };
      emit({ kind: 'step', label: 'Hochhaus-Stufen erneut', detail: rounds > 1 ? `Runde ${round}` : undefined });
      const lv2 = levels(city2, round);
      const better = lv2.residents > lv.residents;
      const gain = (lv2.residents - lv.residents) / Math.max(1, lv.residents);
      if (better) {
        city = city2;
        services = next.report;
        lv = lv2;
      }
      if (!better || gain < 0.001) break;
    }
  }

  // 7. Querstraßen anpassen (nach Bedarf einfügen, entbehrliche ausdünnen)
  let thin: ThinReport | null = null;
  let insert: InsertReport | null = null;
  if (services && (input.insert || input.thin)) {
    emit({ kind: 'step', label: 'Querstraßen anpassen' });
    const r = improveRoads(mask, city, {
      deadline: performance.now() + 60000,
      ministry: input.ministry,
      insert: input.insert,
      thin: input.thin,
      onProgress: (_phase, _n, houses) => emit({ kind: 'detail', text: `Häuser bisher ${houses >= 0 ? '+' : ''}${houses}` }),
    });
    thin = r.thin;
    insert = r.insert;
    if ((r.insert?.inserted ?? 0) + (r.thin?.segments ?? 0) > 0) {
      city = { ...r.city, removedHouses: city.removedHouses };
      emit({ kind: 'step', label: 'Hochhaus-Stufen nach Straßenanpassung' });
      lv = levels(city, 2);
    }
  }
  // 7b. M5: Nachverdichtung mit Einwohnerziel (Läden, Straßen und Rathäuser fest);
  //     übernommen nur, wenn die Stufen-Rechnung danach mehr Einwohner ergibt.
  let valueCompact: PassResult['valueCompact'] = null;
  const vcMs = input.valueCompactMs ?? 0;
  if (services && vcMs > 0) {
    emit({ kind: 'step', label: 'Nachverdichtung nach Einwohnern' });
    const r = compactValued(mask, city, { deadline: performance.now() + vcMs, seed: 31 + input.seed * 7349 + input.lines });
    if (r.result.improvements > 0) {
      const cand: CityPlan = { ...r.city, removedHouses: city.removedHouses };
      const lvc = levels(cand, 5);
      const accepted = lvc.residents > lv.residents;
      valueCompact = { gained: r.result.gained, residents: lvc.residents - lv.residents, accepted };
      if (accepted) {
        city = cand;
        lv = lvc;
      }
    } else valueCompact = { gained: 0, residents: 0, accepted: false };
  }
  // 7c. Ölversorgung (oilStage)
  let oil: OilReport | null = null;
  let oilCompact: PassResult['oilCompact'] = null;
  if (input.oil && services) {
    snap(city, lv.planned);
    const r = oilStage(input, city, lv, emit);
    city = r.city;
    lv = r.lv;
    oil = r.oil;
    oilCompact = r.oilCompact;
  }
  snap(city, lv.planned);

  // 8. Briefkästen
  let planned: Planned = lv.planned;
  let post: (PostReport & { removedHouses: number }) | null = null;
  if (withMail) {
    emit({ kind: 'step', label: 'Briefkästen' });
    const analysis = analyzeCity(stampCity(mask, city, false), rules, { houses: new Map(), groups: new Map(), planned });
    const residentsAt = new Map<string, number>();
    for (const r of analysis.residences) {
      const hs = city.houses[r.building.index];
      if (hs) residentsAt.set(`${hs.x},${hs.y}`, r.residents - r.mailBonus);
    }
    const types = mailTypes(rules.mail);
    let full = 0;
    for (const r of analysis.residences) {
      if (r.tier === 'artisan' || !r.hasRoad) continue;
      full += mailResidentsFor(r.tier, r.level, types);
    }
    const need = analysis.totals.mail.need;
    const before = city;
    const r = planPost(mask, city, residentsAt, need, need > 0 ? full / need : 0);
    city = { ...r.city, removedHouses: city.removedHouses };
    post = r.report;
    if (r.report.removedHouses) planned = remap(before, city, planned);
  }

  // 9. Bewertung wie in der Ansicht (mit Brücken, geplante Stufen)
  emit({ kind: 'step', label: 'Fertigstellen' });
  const final = analyzeCity(stampCity(mask, city, true), rules, { houses: new Map(), groups: new Map(), planned });
  return {
    city,
    planned: toArray(planned),
    residents: final.totals.residents,
    levels: { mode: lv.mode, counts: lv.counts, engineers: lv.engineers, minEngineers: lv.minEngineers },
    services,
    post,
    compactGained,
    thin,
    insert,
    valueCompact,
    oil,
    oilCompact,
    ms: performance.now() - t0,
  };
}
