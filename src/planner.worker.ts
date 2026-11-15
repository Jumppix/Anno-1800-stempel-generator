// Rechnet die Bebauung (Gittersuche mit Bandverschiebung) und die
// Nachverdichtung im Hintergrund, damit die Oberfläche bedienbar bleibt.
import { addBridges, searchFill, type FillResult, type Orientation } from './fill';
import { compactCity, planPost, planServices, planToStampItems, type CityPlan } from './planner';
import type { PostReport } from './post';
import { analyzeCity } from './analysis';
import { cityFromStamp } from './city';
import { optimizeLevels, type LevelMode } from './levels';
import { MAIL_NEEDS, mailTypes, type RuleConfig } from './rules';
import { buildGenericStamp } from './stamp';
import { decodeStampFull } from './stampReader';
import type { BuildingKind } from './catalog';
import type { ServiceReport } from './services';
import type { ProductionOptions } from './production';
import type { LandMask } from './solver';

export type PlannerJob =
  | { kind: 'fill'; id: number; mask: LandMask; orientation: 'auto' | Orientation; housesPerLine: number; bridgeLen: number }
  | { kind: 'compact'; id: number; mask: LandMask; city: CityPlan; budgetMs: number; seed: number; snapshots?: boolean }
  | { kind: 'services'; id: number; mask: LandMask; city: CityPlan; kinds: BuildingKind[]; fullCoverageValue: number; deliveryGoods: boolean; houseStates?: Map<string, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>; townHallItems?: boolean; ministry?: { range: number; welfare: number; web: number }; airport?: { harbor: { x: number; y: number } | null }; production?: ProductionOptions }
  | {
      kind: 'levels';
      id: number;
      mask: LandMask;
      city: CityPlan;
      rules: RuleConfig;
      mode: LevelMode;
      budgetMs: number;
      seed: number;
      /** Ingenieure für die eigene Arbeitskraft einplanen (Kraftwerke). */
      selfWorkforce: boolean;
    }
  | {
      kind: 'post';
      id: number;
      mask: LandMask;
      city: CityPlan;
      rules: RuleConfig;
      planned: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>;
    };

export type PlannerMessage =
  | { kind: 'fill'; id: number; result: FillResult }
  | { kind: 'progress'; id: number; gained: number; city?: CityPlan }
  | { kind: 'compact'; id: number; city: CityPlan; gained: number; moved: number }
  | { kind: 'services'; id: number; city: CityPlan; report: ServiceReport; refilled: number }
  | { kind: 'post'; id: number; city: CityPlan; report: PostReport & { removedHouses: number } }
  | {
      kind: 'levels';
      id: number;
      /** [Gebäudeindex, 0 = Ingenieur/1 = Investor, Stufe] */
      planned: Array<[number, number, number]>;
      residents: number;
      startResidents: number;
      mode: string;
      counts: Record<string, number>;
      tried: Array<{ mode: string; residents: number }>;
      engineers: number;
      minEngineers: number;
    };

const scope = self as unknown as {
  postMessage(message: PlannerMessage): void;
  onmessage: ((event: MessageEvent<PlannerJob>) => void) | null;
};

scope.onmessage = (event) => {
  const job = event.data;
  if (job.kind === 'fill') {
    const result = searchFill(job.mask, { orientation: job.orientation, housesPerLine: job.housesPerLine });
    addBridges(result, job.bridgeLen);
    scope.postMessage({ kind: 'fill', id: job.id, result });
    return;
  }
  if (job.kind === 'post') {
    // Einwohner je Haus mit den geplanten Stufen (ohne Post), daraus Bedarf und Briefkästen.
    const items = planToStampItems(job.mask, job.city, { coast: false, coastGuid: 1000178 });
    const city = cityFromStamp(decodeStampFull(buildGenericStamp(items.buildings, 'ow', items.streets)));
    const analysis = analyzeCity(city, job.rules, { houses: new Map(), groups: new Map(), planned: job.planned });
    const residentsAt = new Map<string, number>();
    for (const r of analysis.residences) {
      const hs = job.city.houses[r.building.index];
      if (hs) residentsAt.set(`${hs.x},${hs.y}`, r.residents - r.mailBonus);
    }
    // Wert einer t/min Post: Post-Einwohner bei Vollversorgung je t/min Bedarf.
    const types = mailTypes(job.rules.mail);
    let full = 0;
    for (const r of analysis.residences) {
      if (r.tier === 'artisan' || !r.hasRoad) continue;
      for (const m of MAIL_NEEDS[r.tier]) if (types.includes(m.type)) full += m.residents;
    }
    const need = analysis.totals.mail.need;
    const r = planPost(job.mask, job.city, residentsAt, need, need > 0 ? full / need : 0);
    scope.postMessage({ kind: 'post', id: job.id, city: r.city, report: r.report });
    return;
  }
  if (job.kind === 'levels') {
    // Gleicher Stempel wie in der Ansicht → gleiche Gebäudeindizes.
    const items = planToStampItems(job.mask, job.city, { coast: false, coastGuid: 1000178, bridges: true });
    const city = cityFromStamp(decodeStampFull(buildGenericStamp(items.buildings, 'ow', items.streets)));
    const analysis = analyzeCity(city, job.rules);
    // Gaskraftwerk: 250 Ingenieure Arbeitskraft (Wiki); Einwohner = Arbeitskraft.
    const plants = (job.city.services ?? []).filter((sv) => sv.kind === 'powerPlant').length;
    const minEngineers = job.selfWorkforce ? plants * 250 : 0;
    const r = optimizeLevels(analysis.residences, job.rules, job.mode, job.budgetMs, job.seed, { minEngineers });
    scope.postMessage({
      kind: 'levels',
      id: job.id,
      planned: [...r.planned].map(([idx, st]) => [idx, st.tier === 'engineer' ? 0 : 1, st.level]),
      residents: r.residents,
      startResidents: r.startResidents,
      mode: r.mode,
      counts: r.counts,
      tried: r.tried,
      engineers: r.engineers,
      minEngineers: r.minEngineers,
    });
    return;
  }
  if (job.kind === 'services') {
    const r = planServices(job.mask, job.city, {
      kinds: new Set(job.kinds),
      fullCoverageValue: job.fullCoverageValue,
      deliveryGoods: job.deliveryGoods,
      houseStates: job.houseStates,
      townHallItems: job.townHallItems,
      ministry: job.ministry,
      airport: job.airport,
      production: job.production,
    });
    scope.postMessage({ kind: 'services', id: job.id, city: r.city, report: r.report, refilled: r.refilled });
    return;
  }
  const { city, result } = compactCity(
    job.mask,
    job.city,
    {
      deadline: performance.now() + job.budgetMs,
      seed: job.seed,
      onProgress: (gained) => scope.postMessage({ kind: 'progress', id: job.id, gained }),
    },
    job.snapshots ? (snap, gained) => scope.postMessage({ kind: 'progress', id: job.id, gained, city: snap }) : undefined,
  );
  scope.postMessage({ kind: 'compact', id: job.id, city, gained: result.gained, moved: result.townHallsMoved });
};
