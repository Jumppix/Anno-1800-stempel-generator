// Oberfläche „Wohnraster planen“ (Stadtplaner Phase 2). Nutzt die geladene
// Inselform (in beiden Modi dieselbe), plant Raster + Rathäuser und zeigt das Ergebnis
// in der Stadt-Ansicht (CityUi) mit allen Analyse-Ebenen.

import { CITY_PAD } from './city';
import type { CityUi } from './cityUi';
import type { FillResult } from './fill';
import {
  finishPlan,
  freeTiles,
  planFromFill,
  planToStampItems,
  refillAroundTownHalls,
  splitBands,
  townHallProblem,
  type CityPlan,
  type Orientation,
} from './planner';
import type { LandMask } from './solver';
import { SolveRunner } from './solveRunner';
import { buildGenericStamp } from './stamp';
import type { PlannerJob, PlannerMessage } from './planner.worker';
import type { BuildingKind } from './catalog';
import type { LevelMode } from './levels';
import { cityWideWebBonus, localDepartmentRange, welfareBonus, type RuleConfig } from './rules';
import type { PostReport } from './post';
import type { ServiceReport } from './services';

const SERVICE_KINDS_UI: BuildingKind[] = ['departmentStore', 'furnitureStore', 'drugStore', 'university', 'powerPlant'];

export interface IslandSource {
  mask: LandMask;
  streetGuid: number;
  label: string;
}

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

const num = (v: number): string => v.toLocaleString('de-DE');

function download(name: string, data: Uint8Array | Blob): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Anzahl Brücken = zusammenhängende Gruppen von Brückenkacheln. */
function countBridges(tiles: readonly number[], w: number): number {
  const set = new Set(tiles);
  const seen = new Set<number>();
  let n = 0;
  for (const t of tiles) {
    if (seen.has(t)) continue;
    n++;
    const stack = [t];
    seen.add(t);
    while (stack.length) {
      const i = stack.pop() as number;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (set.has(j) && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
  }
  return n;
}

export class PlannerUi {
  private readonly islandInfo = el<HTMLElement>('#plan-island');
  private readonly orientation = el<HTMLSelectElement>('#plan-orientation');
  private readonly perLine = el<HTMLSelectElement>('#plan-line');
  private readonly townHalls = el<HTMLInputElement>('#plan-townhalls');
  private readonly minCover = el<HTMLInputElement>('#plan-mincover');
  private readonly budget = el<HTMLSelectElement>('#plan-budget');
  private readonly compactBudget = el<HTMLSelectElement>('#plan-compact');
  private readonly svcGoal = el<HTMLSelectElement>('#svc-goal');
  private readonly runButton = el<HTMLButtonElement>('#plan-run');
  private readonly status = el<HTMLElement>('#plan-status');
  private readonly exportBox = el<HTMLElement>('#plan-export');
  private readonly split = el<HTMLInputElement>('#plan-split');
  private readonly stampList = el<HTMLElement>('#plan-stamps');

  private runner: SolveRunner;
  private result: {
    city: CityPlan;
    mask: LandMask;
    streetGuid: number;
    planned?: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>;
  } | null = null;
  private readonly levelMode = el<HTMLSelectElement>('#plan-levels');
  private stamps: Uint8Array[] = [];
  private running = false;
  private workers: Worker[] = [];
  private jobId = 0;

  constructor(
    private readonly cityUi: CityUi,
    private readonly island: () => IslandSource | null,
  ) {
    this.runner = new SolveRunner(() => undefined);
    this.runButton.addEventListener('click', () => void this.run());
    this.split.addEventListener('change', () => this.buildStamps());
    el<HTMLButtonElement>('#plan-image').addEventListener('click', () => this.saveImage());
    this.stampList.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
      if (!button) return;
      const i = Number(button.dataset.i);
      if (this.stamps[i]) download(this.stampName(i), this.stamps[i]);
    });
    this.refreshIsland();
  }

  /** Inselinfo aktualisieren (beim Wechsel in den Modus aufrufen). */
  refreshIsland(): void {
    const src = this.island();
    this.runButton.disabled = !src || this.running;
    this.islandInfo.textContent = src
      ? `Insel: ${src.label}`
      : 'Keine Insel geladen – oben unter „Inselform aus Stempeln“ die Feldweg-Stempel laden und im Tab „Anordnen“ ausrichten.';
  }

  private async run(): Promise<void> {
    const src = this.island();
    if (!src || this.running) return;
    this.runner.cancel();
    this.running = true;
    this.runButton.disabled = true;
    this.exportBox.hidden = true;
    const started = performance.now();
    const orientation = this.orientation.value as 'auto' | Orientation;
    this.status.textContent = 'Bebauung wird berechnet …';
    await new Promise((r) => setTimeout(r, 30));
    const fill = await this.fill(src.mask, orientation, Number(this.perLine.value) || 4);
    const plan = planFromFill(fill);
    this.status.textContent = `Bebauung: ${num(plan.houses.length)} Häuser. Rathäuser werden optimiert …`;

    let townHalls: Array<{ x: number; y: number }> = [];
    if (this.townHalls.checked && plan.houses.length) {
      const problem = townHallProblem(src.mask, plan);
      townHalls = await new Promise((resolve) => {
        this.runner = new SolveRunner(({ layout, running, workers }) => {
          const group = layout.groups[0];
          const secs = ((performance.now() - started) / 1000).toFixed(1);
          this.status.textContent = `Rathäuser auf ${workers} Kern${workers === 1 ? '' : 'en'} … ${secs} s · bisher ${
            group?.chambers.length ?? 0
          } Rathäuser`;
          if (!running) resolve(group ? group.chambers.map((c) => ({ x: c.x, y: c.y })) : []);
        });
        void this.runner.start(problem.target, ['rh'], Number(this.budget.value) || 6000, null, {
          allowed: problem.allowed,
          overlapPenalty: problem.penalty,
        });
      });
    }

    const finished = finishPlan(plan, townHalls, Math.max(0, Number(this.minCover.value) || 0));
    const refilled = refillAroundTownHalls(src.mask, finished);
    // Erst nachverdichten (Häuser/Rathäuser schieben), dann Versorgung setzen:
    // so verlängert kein späteres Verschieben die Wege zu Lagerhäusern.
    const compactMs = Number(this.compactBudget.value) || 0;
    const compacted = compactMs > 0 ? await this.compact(src.mask, refilled, compactMs, started) : null;
    const dense = compacted ? { ...compacted.city, removedHouses: refilled.removedHouses } : refilled;
    const kinds = SERVICE_KINDS_UI.filter((k) => el<HTMLInputElement>(`#svc-${k}`).checked);
    const goal = Number(this.svcGoal.value) || 0;
    const levelMode = this.levelMode.value as LevelMode;
    const levelMs = Number(el<HTMLSelectElement>('#plan-levels-time').value) || 15000;
    let serviced: { city: CityPlan; report: ServiceReport; refilled: number } | null = null;
    if (kinds.length) {
      this.status.textContent = 'Versorgung wird geplant (Kaufhaus, Einrichtungshaus, Drogerie, Universität, Kraftwerk, Lagerhäuser) …';
      serviced = await this.services(src.mask, dense, kinds, goal);
    }
    let city = serviced ? { ...serviced.city, removedHouses: refilled.removedHouses } : dense;
    // Hochhaus-Stufen (3-3-5 / 4-5) auf dem fertigen Plan optimieren.
    this.status.textContent = 'Hochhaus-Stufen werden optimiert (3-3-5 / 4-5) …';
    let levels = await this.levels(src.mask, city, levelMode, levelMs);
    // Zweiter Durchgang: Versorgung passend zu den Stufen neu setzen (z. B. keine
    // Universität ohne Ingenieure, Drogerie für Investoren 5), dann Stufen erneut.
    if (kinds.length && levelMode !== 'l3') {
      const states = new Map<string, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>();
      city.houses.forEach((hs, k) => {
        const st = levels.planned.get(k);
        if (st) states.set(`${hs.x},${hs.y}`, st);
      });
      this.status.textContent = 'Versorgung wird an die Hochhaus-Stufen angepasst …';
      const second = await this.services(src.mask, dense, kinds, goal, states);
      const city2 = { ...second.city, removedHouses: refilled.removedHouses };
      this.status.textContent = 'Hochhaus-Stufen werden erneut optimiert …';
      const levels2 = await this.levels(src.mask, city2, levelMode, levelMs);
      const total = (l: typeof levels): number => l.residents;
      if (total(levels2) > total(levels)) {
        serviced = second;
        city = city2;
        levels = levels2;
      }
    }
    // Post: Briefkästen in Restkacheln, bis die Produktion den Bedarf deckt.
    let post: (PostReport & { removedHouses: number }) | null = null;
    const rulesNow = this.cityUi.currentRules();
    if (el<HTMLInputElement>('#plan-post').checked && rulesNow.mail !== 'none') {
      this.status.textContent = 'Briefkästen werden geplant …';
      const before = city;
      const r = await this.post(src.mask, city, rulesNow, levels.planned);
      city = { ...r.city, removedHouses: city.removedHouses };
      post = r.report;
      if (r.report.removedHouses) {
        // Häuser sind weggefallen → geplante Stufen über die Lage neu zuordnen.
        const byPos = new Map<string, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>();
        before.houses.forEach((hs, k) => {
          const st = levels.planned.get(k);
          if (st) byPos.set(`${hs.x},${hs.y}`, st);
        });
        const planned = new Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>();
        city.houses.forEach((hs, k) => {
          const st = byPos.get(`${hs.x},${hs.y}`);
          if (st) planned.set(k, st);
        });
        levels = { ...levels, planned };
      }
    }
    this.result = { city, mask: src.mask, streetGuid: src.streetGuid, planned: levels.planned };
    this.buildStamps();
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const totals = this.cityUi.totals();
    const items: string[] = [];
    if (totals) {
      items.push(
        `<strong>${num(totals.residents)} Einwohner</strong> (Schätzung) · Rathausradius ${Math.round(totals.townHallShare * 100)} %`,
      );
    }
    {
      const names: Record<string, string> = { l3: 'nur Stufe 3', '335': '3-3-5', '45': '4-5', free: 'frei gemischt' };
      const c = levels.counts;
      const mix = [c.V5 ? `${num(c.V5)}× V5` : '', c.V4 ? `${num(c.V4)}× V4` : '', c.V3 ? `${num(c.V3)}× V3` : '', c.I3 ? `${num(c.I3)}× I3` : '']
        .filter(Boolean)
        .join(', ');
      items.push(`Bauweise <strong>${names[levels.mode] ?? levels.mode}</strong>: ${mix}`);
      if (levels.minEngineers > 0) {
        items.push(
          `Ingenieure ${num(levels.engineers)} / benötigt ${num(levels.minEngineers)} (Kraftwerke)${
            levels.engineers < levels.minEngineers ? ' – <strong>zu wenig</strong>' : ' ✓'
          }`,
        );
      }
    }
    items.push(
      `${num(city.houses.length)} Häuser · ${city.townHalls.length} Rathäuser · Restfläche ${(
        (100 * freeTiles(src.mask, city)) /
        src.mask.landCount
      ).toFixed(1)} %`,
    );
    if (serviced) {
      const r = serviced.report;
      const short: Record<string, string> = {
        departmentStore: 'Kaufhaus',
        furnitureStore: 'Einrichtungsh.',
        drugStore: 'Drogerie',
        university: 'Universität',
        powerPlant: 'Kraftwerk',
      };
      items.push(
        `Versorgung: ${kinds
          .filter((k) => r.placed[k])
          .map((k) => `${r.placed[k]}× ${short[k]}`)
          .join(', ')}, ${r.warehouses}× Lagerhaus${
          r.ministry.placed ? ` · Regionalministerium (${num(r.ministry.houses)} Häuser in Reichweite)` : ''
        }`,
      );
    }
    if (post) {
      items.push(
        `Post: ${post.boxes} Briefkästen${post.removedHouses ? ` (${post.removedHouses} davon statt eines Hauses)` : ' in Restkacheln'} · ${post.production.toFixed(0)} von ${post.need.toFixed(0)} t/min Bedarf${
          post.production < post.need ? ' (zu wenig Platz – Rest per Postamt/Luftschiff)' : ''
        }`,
      );
    }
    const bridges = countBridges(city.plan.bridges ?? [], src.mask.w);
    if (bridges || city.plan.networks > 1) {
      items.push(
        `${bridges ? `${bridges} Brücke${bridges === 1 ? '' : 'n'}` : 'keine Brücken'} · ${
          city.plan.networks > 1 ? `${city.plan.networks} getrennte Straßennetze` : 'ein zusammenhängendes Straßennetz'
        }`,
      );
    }
    items.push(`Fertig nach ${secs} s${compacted ? ` · Nachverdichtung +${compacted.gained} Häuser` : ''}`);
    this.status.innerHTML = `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
    this.running = false;
    this.refreshIsland();
  }

  private worker(i: number): Worker {
    while (this.workers.length <= i) {
      this.workers.push(new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' }));
    }
    return this.workers[i];
  }

  /** Briefkästen im Hintergrund planen (post.ts). */
  private post(
    mask: LandMask,
    city: CityPlan,
    rules: RuleConfig,
    planned: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>,
  ): Promise<{ city: CityPlan; report: PostReport & { removedHouses: number } }> {
    const id = ++this.jobId;
    const worker = this.worker(0);
    return new Promise((resolve) => {
      worker.onmessage = (event: MessageEvent<PlannerMessage>) => {
        const msg = event.data;
        if (msg.id === id && msg.kind === 'post') resolve({ city: msg.city, report: msg.report });
      };
      const job: PlannerJob = { kind: 'post', id, mask, city, rules, planned };
      worker.postMessage(job);
    });
  }

  /** Hochhaus-Stufen im Hintergrund optimieren (levels.ts). */
  private levels(
    mask: LandMask,
    city: CityPlan,
    mode: LevelMode,
    budgetMs: number,
  ): Promise<{
    planned: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>;
    residents: number;
    startResidents: number;
    mode: string;
    counts: Record<string, number>;
    tried: Array<{ mode: string; residents: number }>;
    engineers: number;
    minEngineers: number;
  }> {
    const id = ++this.jobId;
    const worker = this.worker(0);
    return new Promise((resolve) => {
      worker.onmessage = (event: MessageEvent<PlannerMessage>) => {
        const msg = event.data;
        if (msg.id !== id || msg.kind !== 'levels') return;
        const planned = new Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>();
        for (const [idx, t, l] of msg.planned) {
          planned.set(idx, { tier: t === 0 ? 'engineer' : 'investor', level: l as 3 | 4 | 5 });
        }
        resolve({ ...msg, planned });
      };
      const selfWorkforce = el<HTMLInputElement>('#plan-engineers').checked;
      const job: PlannerJob = { kind: 'levels', id, mask, city, rules: this.cityUi.currentRules(), mode, budgetMs, seed: 11, selfWorkforce };
      worker.postMessage(job);
    });
  }

  /** Versorgungsgebäude + Lagerhäuser im Hintergrund (services.ts). */
  private services(
    mask: LandMask,
    city: CityPlan,
    kinds: BuildingKind[],
    fullCoverageValue: number,
    houseStates?: Map<string, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>,
  ): Promise<{ city: CityPlan; report: ServiceReport; refilled: number }> {
    const id = ++this.jobId;
    const worker = this.worker(0);
    return new Promise((resolve) => {
      worker.onmessage = (event: MessageEvent<PlannerMessage>) => {
        const msg = event.data;
        if (msg.id === id && msg.kind === 'services') resolve({ city: msg.city, report: msg.report, refilled: msg.refilled });
      };
      const deliveryGoods = el<HTMLInputElement>('#rule-delivery').checked;
      const rules = this.cityUi.currentRules();
      const townHallItems = rules.townHallItems;
      const ministry =
        el<HTMLInputElement>('#plan-ministry').checked && rules.ministry !== 'none'
          ? { range: localDepartmentRange(rules), welfare: welfareBonus(rules), web: cityWideWebBonus(rules) }
          : undefined;
      const job: PlannerJob = { kind: 'services', id, mask, city, kinds, fullCoverageValue, deliveryGoods, houseStates, townHallItems, ministry };
      worker.postMessage(job);
    });
  }

  /** Gittersuche (mit Bandverschiebung) im Hintergrund. */
  private fill(mask: LandMask, orientation: 'auto' | Orientation, housesPerLine: number): Promise<FillResult> {
    const id = ++this.jobId;
    const worker = this.worker(0);
    return new Promise((resolve) => {
      worker.onmessage = (event: MessageEvent<PlannerMessage>) => {
        const msg = event.data;
        if (msg.id === id && msg.kind === 'fill') resolve(msg.result);
      };
      const bridgeLen = Number(el<HTMLSelectElement>('#plan-bridges').value) || 0;
      const job: PlannerJob = { kind: 'fill', id, mask, orientation, housesPerLine, bridgeLen };
      worker.postMessage(job);
    });
  }

  /**
   * Nachverdichtung auf mehreren Kernen mit verschiedenen Seeds; das Ergebnis
   * mit dem höchsten Wert (Häuser × 225 + Häuser im Rathausradius × 31) gewinnt.
   */
  private async compact(
    mask: LandMask,
    city: CityPlan,
    budgetMs: number,
    started: number,
  ): Promise<{ city: CityPlan; gained: number; moved: number }> {
    const cores = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    const id = ++this.jobId;
    const progress = new Array<number>(cores).fill(0);
    const value = (c: CityPlan): number => {
      const covered = c.houses.filter((hs) =>
        c.townHalls.some((t) => Math.hypot(hs.x + 1 - (t.x + 1.5), hs.y + 1 - (t.y + 1.5)) <= 20 + 1e-9),
      ).length;
      return c.houses.length * 225 + covered * 31;
    };
    const results = await Promise.all(
      Array.from({ length: cores }, (_, i) => {
        const worker = this.worker(i);
        return new Promise<{ city: CityPlan; gained: number; moved: number }>((resolve) => {
          worker.onmessage = (event: MessageEvent<PlannerMessage>) => {
            const msg = event.data;
            if (msg.id !== id) return;
            if (msg.kind === 'progress') {
              progress[i] = msg.gained;
              const secs = ((performance.now() - started) / 1000).toFixed(0);
              this.status.textContent = `Nachverdichtung auf ${cores} Kern${cores === 1 ? '' : 'en'} … ${secs} s · bisher +${Math.max(
                ...progress,
              )} Häuser`;
            } else if (msg.kind === 'compact') {
              resolve({ city: msg.city, gained: msg.gained, moved: msg.moved });
            }
          };
          const job: PlannerJob = { kind: 'compact', id, mask, city, budgetMs, seed: 17 + i * 7919 };
          worker.postMessage(job);
        });
      }),
    );
    results.sort((a, b) => value(b.city) - value(a.city));
    return results[0];
  }

  private buildStamps(): void {
    if (!this.result) return;
    const { city, mask, streetGuid } = this.result;
    const items = planToStampItems(mask, city, { coast: false, coastGuid: streetGuid, bridges: true });
    // Export ohne Brücken (die baust du im Spiel über den Fluss).
    const exportItems = planToStampItems(mask, city, { coast: false, coastGuid: streetGuid });
    const full = buildGenericStamp(items.buildings, 'ow', items.streets);
    const bands = splitBands(exportItems, this.split.checked ? 13500 : Infinity);
    this.stamps = bands.map((b) => buildGenericStamp(b.buildings, 'ow', b.streets));
    // Maske → Stadtkachel: das Stadtmodell beginnt CITY_PAD Kacheln vor dem kleinsten Element.
    const xs = [...items.buildings.map((b) => b.x), ...items.streets.map((st) => st.x)];
    const ys = [...items.buildings.map((b) => b.y), ...items.streets.map((st) => st.y)];
    const minX = xs.reduce((m, v) => Math.min(m, v), Infinity);
    const minY = ys.reduce((m, v) => Math.min(m, v), Infinity);
    this.cityUi.show(
      full,
      'Wohnraster-Plan',
      {
        w: mask.w,
        h: mask.h,
        data: mask.data,
        dx: CITY_PAD - minX,
        dy: CITY_PAD - minY,
      },
      this.result.planned ? new Map(this.result.planned) : undefined,
    );
    this.stampList.innerHTML = this.stamps
      .map((_, i) => {
        const b = bands[i];
        const houses = b.buildings.filter((x) => x.guid === 1010343).length;
        const halls = b.buildings.filter((x) => x.guid === 100415).length;
        const other = b.buildings.length - houses - halls;
        return `<div class="stamp-row"><div><strong>T${i + 1}</strong><span>${num(houses)} Häuser · ${halls} RH${
          other ? ` · ${other} weitere` : ''
        }</span></div>
          <button type="button" data-i="${i}">↓ Stempel</button></div>`;
      })
      .join('');
    this.exportBox.hidden = false;
  }

  private stampName(i: number): string {
    const m = this.result?.mask;
    return `Wohnraster_${m?.w ?? 0}x${m?.h ?? 0}_AW_T${String(i + 1).padStart(2, '0')}`;
  }

  private saveImage(): void {
    this.cityUi.setLayer('overview');
    this.cityUi.canvasElement().toBlob((blob) => {
      if (blob) download('Wohnraster_Bauplan.png', blob);
    }, 'image/png');
  }
}
