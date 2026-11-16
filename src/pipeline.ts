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
import { addBridges, searchFill, type Orientation } from './fill';
import { optimizeLevels, type LevelMode, type LevelResult } from './levels';
import {
  compactCity,
  finishPlan,
  improveRoads,
  planFromFill,
  planPost,
  planServices,
  planToStampItems,
  refillAroundTownHalls,
  townHallProblem,
  type CityPlan,
} from './planner';
import type { PostReport } from './post';
import type { ProductionOptions } from './production';
import { mailResidentsFor, mailTypes, type RuleConfig } from './rules';
import type { ServiceReport } from './services';
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
  ministry?: { range: number; welfare: number; web: number };
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
  ms: number;
}

export type PassEvent =
  | { kind: 'step'; label: string; detail?: string }
  | { kind: 'detail'; text: string }
  | { kind: 'snapshot'; city: CityPlan; planned?: Array<[number, number, number]> };

const stampCity = (mask: LandMask, city: CityPlan, bridges: boolean): ReturnType<typeof cityFromStamp> => {
  const items = planToStampItems(mask, city, { coast: false, coastGuid: 1000178, bridges });
  return cityFromStamp(decodeStampFull(buildGenericStamp(items.buildings, 'ow', items.streets)));
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

export function runPass(input: PassInput, emit: (e: PassEvent) => void): PassResult {
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
    airport: input.airport,
    production: input.production,
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
  const levels = (c: CityPlan, seedOffset: number): LevelResult => {
    const analysis = analyzeCity(stampCity(mask, c, true), rules);
    const plants = (c.services ?? []).filter((sv) => sv.kind === 'powerPlant').length;
    return optimizeLevels(analysis.residences, rules, input.levelMode, input.levelMs, 11 + input.seed * 977 + seedOffset, {
      minEngineers: input.selfWorkforce ? plants * 250 : 0,
      mailTypes: withMail ? mailTypes(rules.mail) : undefined,
    });
  };
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
    ms: performance.now() - t0,
  };
}
