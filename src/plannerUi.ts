// Oberfläche „Wohnraster planen“ (Stadtplaner Phase 2). Nutzt die geladene
// Inselform (in beiden Modi dieselbe), plant Raster + Rathäuser und zeigt das Ergebnis
// in der Stadt-Ansicht (CityUi) mit allen Analyse-Ebenen.

import { CITY_PAD } from './city';
import type { CityUi } from './cityUi';
import type { FillResult } from './fill';
import {
  editCity,
  editTargetAt,
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
import { CLIPPABLE, lookup, type BuildingKind } from './catalog';
import type { ProductionRequest } from './production';
import type { LevelMode } from './levels';
import { cityWideWebBonus, localDepartmentRange, welfareBonus, type RuleConfig } from './rules';
import type { PostReport } from './post';
import type { ServiceReport } from './services';

const SERVICE_KINDS_UI: BuildingKind[] = [
  'departmentStore',
  'furnitureStore',
  'drugStore',
  'university',
  'powerPlant',
  'fireStation',
  'policeStation',
  'hospital',
  'bank',
  'varietyTheatre',
  'membersClub',
];

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

  private readonly harborInfo = el<HTMLElement>('#plan-harbor-info');
  private readonly prodType = el<HTMLSelectElement>('#prod-type');
  private readonly prodCount = el<HTMLInputElement>('#prod-count');
  private readonly prodList = el<HTMLElement>('#prod-list');
  private production: ProductionRequest[] = [];

  constructor(
    private readonly cityUi: CityUi,
    private readonly island: () => IslandSource | null,
    /** Startet das Wählen der Anlegestelle in der Ansicht „Anordnen“. */
    private readonly onPickHarbor: () => void = () => undefined,
  ) {
    this.runner = new SolveRunner(() => undefined);
    el<HTMLButtonElement>('#plan-harbor').addEventListener('click', () => {
      this.harborInfo.textContent = 'Klicke in „Anordnen“ auf die Stelle der Hauptanlegestelle …';
      this.onPickHarbor();
    });
    this.runButton.addEventListener('click', () => void this.run());
    this.split.addEventListener('change', () => this.buildStamps());
    el<HTMLButtonElement>('#plan-image').addEventListener('click', () => this.saveImage());
    el<HTMLButtonElement>('#plan-reopt').addEventListener('click', () => void this.reoptimize());
    el<HTMLButtonElement>('#plan-undo').addEventListener('click', () => this.undo());
    el<HTMLButtonElement>('#plan-report-save').addEventListener('click', () => {
      if (this.reportText) download('Wohnraster_Bauliste.txt', new Blob([this.reportText], { type: 'text/plain;charset=utf-8' }));
    });
    this.stampList.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
      if (!button) return;
      const i = Number(button.dataset.i);
      if (this.stamps[i]) download(this.stampName(i), this.stamps[i]);
    });
    this.setupProduction();
    this.refreshIsland();
  }

  // --- Produktion (Clipping): Auswahl der Gebäude, gespeichert im Browser.
  private static readonly PROD_KEY = 'anno-planner-production';

  private setupProduction(): void {
    const groups = new Map<string, typeof CLIPPABLE[number][]>();
    for (const c of CLIPPABLE) {
      const list = groups.get(c.group);
      if (list) list.push(c);
      else groups.set(c.group, [c]);
    }
    this.prodType.innerHTML = [...groups]
      .map(
        ([g, list]) =>
          `<optgroup label="${g}">${list
            .map((c) => `<option value="${c.guid}">${c.name} (${c.size[1]}×${c.size[0]})</option>`)
            .join('')}</optgroup>`,
      )
      .join('');
    let saved: ProductionRequest[] | null = null;
    try {
      const raw = localStorage.getItem(PlannerUi.PROD_KEY);
      if (raw) saved = JSON.parse(raw) as ProductionRequest[];
    } catch {
      saved = null;
    }
    this.production = Array.isArray(saved)
      ? saved.filter((r) => CLIPPABLE.some((c) => c.guid === r.guid) && r.count > 0)
      : [{ guid: 1010323, count: 4 }];
    el<HTMLButtonElement>('#prod-add').addEventListener('click', () => {
      const guid = Number(this.prodType.value);
      const count = Math.max(1, Math.min(60, Math.round(Number(this.prodCount.value) || 0)));
      const known = this.production.find((r) => r.guid === guid);
      if (known) known.count += count;
      else this.production.push({ guid, count });
      this.saveProduction();
    });
    this.prodList.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-remove]');
      if (!button) return;
      this.production = this.production.filter((r) => r.guid !== Number(button.dataset.remove));
      this.saveProduction();
    });
    this.prodList.addEventListener('change', (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-count]');
      if (!input) return;
      const r = this.production.find((x) => x.guid === Number(input.dataset.count));
      if (r) r.count = Math.max(1, Math.min(60, Math.round(Number(input.value) || 1)));
      this.saveProduction();
    });
    this.renderProduction();
  }

  private saveProduction(): void {
    try {
      localStorage.setItem(PlannerUi.PROD_KEY, JSON.stringify(this.production));
    } catch {
      /* nur für diese Sitzung */
    }
    this.renderProduction();
  }

  private renderProduction(): void {
    this.prodList.innerHTML = this.production.length
      ? this.production
          .map((r) => {
            const c = CLIPPABLE.find((x) => x.guid === r.guid);
            const name = c ? `${c.name} (${c.size[1]}×${c.size[0]})` : lookup(r.guid).name;
            return `<div class="prod-row"><span title="${name}">${name}</span><input type="number" min="1" max="60" step="1" value="${r.count}" data-count="${r.guid}" aria-label="Anzahl ${name}" /><button type="button" class="ghost" data-remove="${r.guid}" title="Entfernen">✕</button></div>`;
          })
          .join('')
      : '<div class="prod-empty">Keine geclippte Produktion gewählt.</div>';
  }

  private harborKey(): string | null {
    const src = this.island();
    return src ? `anno-planner-harbor:${src.mask.w}x${src.mask.h}:${src.mask.landCount}` : null;
  }

  /** Hauptanlegestelle in Maskenkoordinaten (oder null). */
  harborPoint(): { x: number; y: number } | null {
    const key = this.harborKey();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const p = JSON.parse(raw) as { x: number; y: number };
      return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
    } catch {
      return null;
    }
  }

  setHarbor(x: number, y: number): void {
    const key = this.harborKey();
    if (key) {
      try {
        localStorage.setItem(key, JSON.stringify({ x, y }));
      } catch {
        /* ohne Speicher nur für diese Sitzung */
      }
    }
    this.sessionHarbor = { x, y };
    this.cityUi.setHarbor(this.currentHarbor());
    this.refreshIsland();
  }

  private sessionHarbor: { x: number; y: number } | null = null;

  currentHarbor(): { x: number; y: number } | null {
    return this.harborPoint() ?? this.sessionHarbor;
  }

  /** Inselinfo aktualisieren (beim Wechsel in den Modus aufrufen). */
  refreshIsland(): void {
    const h = this.currentHarbor();
    this.harborInfo.textContent = h ? `bei ${h.x}, ${h.y}` : 'nicht gesetzt';
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
    this.cityUi.setEditor(null);
    this.history = [];
    const started = performance.now();
    const orientation = this.orientation.value as 'auto' | Orientation;
    this.status.textContent = 'Bebauung wird berechnet …';
    await new Promise((r) => setTimeout(r, 30));
    const fill = await this.fill(src.mask, orientation, Number(this.perLine.value) || 4);
    const plan = planFromFill(fill);
    this.status.textContent = `Bebauung: ${num(plan.houses.length)} Häuser. Rathäuser werden optimiert …`;
    this.preview(src.mask, finishPlan(plan, [], 0), 'Zwischenstand: Bebauung');
    let lastPreview = performance.now();

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
          // Zwischenstand höchstens alle 2 s zeigen (Analyse läuft im Hauptthread).
          if (running && group && this.watch.checked && performance.now() - lastPreview > 2000) {
            this.preview(src.mask, finishPlan(plan, group.chambers.map((c) => ({ x: c.x, y: c.y })), 0), 'Zwischenstand: Rathäuser');
            lastPreview = performance.now();
          }
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
    this.preview(src.mask, refilled, 'Zwischenstand: Rathäuser');
    // Erst nachverdichten (Häuser/Rathäuser schieben), dann Versorgung setzen:
    // so verlängert kein späteres Verschieben die Wege zu Lagerhäusern.
    const compactMs = Number(this.compactBudget.value) || 0;
    const compacted = compactMs > 0 ? await this.compact(src.mask, refilled, compactMs, started) : null;
    const dense = compacted ? { ...compacted.city, removedHouses: refilled.removedHouses } : refilled;
    if (compacted) this.preview(src.mask, dense, 'Zwischenstand: Nachverdichtung');
    const kinds = SERVICE_KINDS_UI.filter((k) => el<HTMLInputElement>(`#svc-${k}`).checked);
    const goal = Number(this.svcGoal.value) || 0;
    const levelMode = this.levelMode.value as LevelMode;
    const levelMs = Number(el<HTMLSelectElement>('#plan-levels-time').value) || 15000;
    let serviced: { city: CityPlan; report: ServiceReport; refilled: number } | null = null;
    const withProduction = this.production.some((r) => r.count > 0);
    if (kinds.length || withProduction) {
      this.status.textContent = `${withProduction ? 'Geclippte Produktion und ' : ''}Versorgung wird geplant (Kaufhaus, Einrichtungshaus, Drogerie, Universität, Kraftwerk, Lagerhäuser) …`;
      serviced = await this.services(src.mask, dense, kinds, goal);
    }
    let city = serviced ? { ...serviced.city, removedHouses: refilled.removedHouses } : dense;
    if (serviced) this.preview(src.mask, city, 'Zwischenstand: Versorgung');
    // Hochhaus-Stufen (3-3-5 / 4-5) auf dem fertigen Plan optimieren.
    this.status.textContent = 'Hochhaus-Stufen werden optimiert (3-3-5 / 4-5) …';
    let levels = await this.levels(src.mask, city, levelMode, levelMs);
    this.preview(src.mask, city, 'Zwischenstand: Hochhaus-Stufen', levels.planned);
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
      this.preview(src.mask, city2, 'Zwischenstand: Versorgung angepasst');
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
        fireStation: 'Feuerwache',
        policeStation: 'Polizei',
        hospital: 'Hospital',
        bank: 'Bank',
        varietyTheatre: 'Varieté',
        membersClub: 'Clubhaus',
      };
      const p = r.production;
      if (p) {
        const parts = Object.entries(p.byGuid).map(([g, n]) => `${n}× ${lookup(Number(g)).name}`);
        items.push(
          p.placed
            ? `Produktion (${p.lattice}): ${parts.join(', ')} · ${p.tradeUnions} Handelskammern · ${p.houses} Häuser verdrängt${
                p.powerPlants ? ` · ${p.powerPlants} Kraftwerk${p.powerPlants === 1 ? '' : 'e'} extra` : ''
              }${p.placed < p.requested ? ` – <strong>nur ${p.placed} von ${p.requested}</strong> (kein Platz)` : ''}`
            : `Produktion: <strong>keine Formation gefunden</strong> (${p.requested} gewünscht)`,
        );
      }
      items.push(
        `Versorgung: ${kinds
          .filter((k) => r.placed[k])
          .map((k) => `${r.placed[k]}× ${short[k]}`)
          .join(', ')}, ${r.warehouses}× Lagerhaus${
          r.ministry.placed ? ` · Regionalministerium (${num(r.ministry.houses)} Häuser in Reichweite)` : ''
        }${
          r.airport.placed
            ? ` · Lufthafen${this.currentHarbor() ? ` ${r.airport.distance} Kacheln von der Anlegestelle` : ' (Anlegestelle nicht gesetzt)'}, ${r.airport.houses} Häuser verdrängt`
            : el<HTMLInputElement>('#plan-airport').checked
              ? ' · Lufthafen: kein Platz gefunden'
              : ''
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

  private readonly watch = el<HTMLInputElement>('#plan-watch');

  /** Zwischenstand in der Plan-Ansicht zeigen (ohne Export-Stempel). */
  private preview(
    mask: LandMask,
    city: CityPlan,
    title: string,
    planned?: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>,
  ): void {
    if (!this.watch.checked) return;
    try {
      const items = planToStampItems(mask, city, { coast: false, coastGuid: 1000178, bridges: true });
      const bytes = buildGenericStamp(items.buildings, 'ow', items.streets);
      const xs = [...items.buildings.map((b) => b.x), ...items.streets.map((st) => st.x)];
      const ys = [...items.buildings.map((b) => b.y), ...items.streets.map((st) => st.y)];
      const minX = xs.reduce((m, v) => Math.min(m, v), Infinity);
      const minY = ys.reduce((m, v) => Math.min(m, v), Infinity);
      this.cityUi.show(
        bytes,
        title,
        { w: mask.w, h: mask.h, data: mask.data, dx: CITY_PAD - minX, dy: CITY_PAD - minY },
        planned ? new Map(planned) : undefined,
      );
    } catch {
      /* Vorschau ist nur Anzeige */
    }
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
      const airport = el<HTMLInputElement>('#plan-airport').checked ? { harbor: this.currentHarbor() } : undefined;
      const production = this.production.some((r) => r.count > 0)
        ? { requests: this.production.map((r) => ({ ...r })), power: el<HTMLInputElement>('#prod-power').checked }
        : undefined;
      const job: PlannerJob = { kind: 'services', id, mask, city, kinds, fullCoverageValue, deliveryGoods, houseStates, townHallItems, ministry, airport, production };
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
              if (msg.city) this.preview(mask, msg.city, `Zwischenstand: Nachverdichtung (+${msg.gained} Häuser)`);
              const secs = ((performance.now() - started) / 1000).toFixed(0);
              this.status.textContent = `Nachverdichtung auf ${cores} Kern${cores === 1 ? '' : 'en'} … ${secs} s · bisher +${Math.max(
                ...progress,
              )} Häuser`;
            } else if (msg.kind === 'compact') {
              resolve({ city: msg.city, gained: msg.gained, moved: msg.moved });
            }
          };
          // Zwischenstände nur vom ersten Kern (die Analyse läuft im Hauptthread).
          const job: PlannerJob = { kind: 'compact', id, mask, city, budgetMs, seed: 17 + i * 7919, snapshots: i === 0 && this.watch.checked };
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
    this.offset = { dx: CITY_PAD - minX, dy: CITY_PAD - minY };
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
    this.cityUi.setEditor({ edit: (op) => this.edit(op), undo: () => this.undo() });
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
    this.buildReport(items.buildings, items.streets.length, countBridges(city.plan.bridges ?? [], mask.w));
  }

  private reportText = '';

  // --- Bearbeiten (Phase 6, Teil 2) -------------------------------------------
  /** Maske → Stadtkachel der aktuellen Anzeige. */
  private offset = { dx: 0, dy: 0 };
  private history: Array<{
    city: CityPlan;
    planned?: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>;
    /** Lage (Maske) des bearbeiteten Gebäudes vorher – wird nach Rückgängig wieder angewählt. */
    select?: { x: number; y: number };
  }> = [];
  private toastTimer = 0;

  private toast(message: string, error = false): void {
    const box = el<HTMLElement>('#plan-toast');
    box.textContent = message;
    box.classList.toggle('error', error);
    box.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (box.hidden = true), error ? 4500 : 3000);
  }

  /** Geplante Stufen über die Lage auf neue Hausindizes übertragen. */
  private static remapPlanned(
    before: CityPlan,
    after: CityPlan,
    planned?: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>,
  ): Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }> | undefined {
    if (!planned) return undefined;
    const byPos = new Map<string, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>();
    before.houses.forEach((hs, k) => {
      const st = planned.get(k);
      if (st) byPos.set(`${hs.x},${hs.y}`, st);
    });
    const out = new Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>();
    after.houses.forEach((hs, k) => {
      const st = byPos.get(`${hs.x},${hs.y}`);
      if (st) out.set(k, st);
    });
    return out;
  }

  private edit(op: { type: 'move' | 'rotate' | 'remove'; x: number; y: number; dx: number; dy: number }): void {
    if (!this.result || this.running) return;
    const { mask, city } = this.result;
    const mx = op.x - this.offset.dx;
    const my = op.y - this.offset.dy;
    const target = editTargetAt(city, mx, my);
    if (!target) {
      this.toast('Dieses Gebäude lässt sich nicht bearbeiten.', true);
      return;
    }
    const r = editCity(mask, city, target, op.type === 'move' ? { type: 'move', dx: op.dx, dy: op.dy } : { type: op.type });
    if (!r.ok) {
      this.toast(r.message, true);
      this.cityUi.draw();
      return;
    }
    this.history.push({ city, planned: this.result.planned, select: { x: mx, y: my } });
    if (this.history.length > 50) this.history.shift();
    this.result = { ...this.result, city: r.city, planned: PlannerUi.remapPlanned(city, r.city, this.result.planned) };
    this.buildStamps();
    // Bearbeitetes Gebäude wieder anwählen.
    if (op.type !== 'remove') {
      const pos = target.kind === 'townHall' ? r.city.townHalls[target.index] : r.city.services?.[target.index];
      if (pos) this.cityUi.selectTile(pos.x + this.offset.dx, pos.y + this.offset.dy);
    }
    this.toast(`${r.message}${this.result.planned ? ' · neue Häuser ohne Stufe – „Stufen & Post neu berechnen“' : ''}`);
  }

  private undo(): void {
    if (this.running) return;
    const last = this.history.pop();
    if (!last || !this.result) {
      this.toast('Nichts rückgängig zu machen.');
      return;
    }
    this.result = { ...this.result, city: last.city, planned: last.planned };
    this.buildStamps();
    if (last.select) this.cityUi.selectTile(last.select.x + this.offset.dx, last.select.y + this.offset.dy);
    this.toast('Rückgängig gemacht.');
  }

  /** Nach Änderungen: Hochhaus-Stufen und Briefkästen neu (Gebäude bleiben, wo sie sind). */
  private async reoptimize(): Promise<void> {
    if (!this.result || this.running) return;
    this.running = true;
    this.runButton.disabled = true;
    const button = el<HTMLButtonElement>('#plan-reopt');
    button.disabled = true;
    try {
      const { mask } = this.result;
      // Briefkästen neu planen (sie hängen von den Einwohnern ab).
      let city: CityPlan = { ...this.result.city, services: (this.result.city.services ?? []).filter((sv) => sv.kind !== 'postBox') };
      this.toast('Hochhaus-Stufen werden neu berechnet …');
      const levelMs = Number(el<HTMLSelectElement>('#plan-levels-time').value) || 15000;
      const levels = await this.levels(mask, city, this.levelMode.value as LevelMode, levelMs);
      let planned = levels.planned;
      const rules = this.cityUi.currentRules();
      if (el<HTMLInputElement>('#plan-post').checked && rules.mail !== 'none') {
        this.toast('Briefkästen werden neu geplant …');
        const r = await this.post(mask, city, rules, planned);
        const remapped = PlannerUi.remapPlanned(city, r.city, planned);
        city = { ...r.city, removedHouses: city.removedHouses };
        planned = remapped ?? planned;
      }
      this.history.push({ city: this.result.city, planned: this.result.planned });
      this.result = { ...this.result, city, planned };
      this.buildStamps();
      const t = this.cityUi.totals();
      this.toast(`Neu berechnet: ${t ? `${num(t.residents)} Einwohner` : 'fertig'}`);
    } finally {
      this.running = false;
      button.disabled = false;
      this.refreshIsland();
    }
  }

  /** Bauliste (Anzahl je Gebäude) und Einwohner-Bericht des fertigen Plans. */
  private buildReport(
    buildings: ReadonlyArray<{ guid: number }>,
    streets: number,
    bridges: number,
  ): void {
    const counts = new Map<number, number>();
    for (const b of buildings) counts.set(b.guid, (counts.get(b.guid) ?? 0) + 1);
    const list = [...counts]
      .map(([guid, n]) => ({ name: guid === 1010343 ? 'Wohnhaus (als Bauernhaus, im Spiel hochziehen)' : lookup(guid).name, n }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'de'));
    const t = this.cityUi.totals();
    const planned = this.result?.planned;
    const levelCounts = { V5: 0, V4: 0, V3: 0, I3: 0 };
    if (planned) {
      for (const st of planned.values()) {
        if (st.tier === 'engineer') levelCounts.I3++;
        else levelCounts[`V${st.level}` as 'V3' | 'V4' | 'V5']++;
      }
    }
    const pct = (v: number): string => `${Math.round(v * 100)} %`;
    const kindNames: Partial<Record<BuildingKind, string>> = {
      departmentStore: 'Kaufhaus',
      furnitureStore: 'Einrichtungshaus',
      drugStore: 'Drogerie',
      university: 'Universität',
      powerPlant: 'Strom',
      fireStation: 'Feuerwache',
      policeStation: 'Polizei',
      hospital: 'Hospital',
      bank: 'Bank',
      varietyTheatre: 'Varieté',
      membersClub: 'Clubhaus',
    };
    const resRows: Array<[string, string]> = t
      ? [
          ['Einwohner (Schätzung)', num(t.residents)],
          ['davon Investoren', num(t.byTier.investor)],
          ['davon Ingenieure', num(t.byTier.engineer)],
          ['davon durch Rathaus-Items', num(t.itemResidents)],
          ['davon durch Post', num(t.mail.residents)],
          ['Häuser im Rathausradius', pct(t.townHallShare)],
          ['Post Produktion / Bedarf', t.mail.need ? `${t.mail.production.toFixed(0)} / ${t.mail.need.toFixed(0)} t/min` : '–'],
          ...Object.entries(t.coverage)
            .filter(([k, v]) => (v ?? 0) > 0 && kindNames[k as BuildingKind])
            .map(([k, v]) => [`Abdeckung ${kindNames[k as BuildingKind]}`, pct(v ?? 0)] as [string, string]),
        ]
      : [];
    const levelRows: Array<[string, string]> = planned
      ? [
          ['Investoren Stufe 5', num(levelCounts.V5)],
          ['Investoren Stufe 4', num(levelCounts.V4)],
          ['Investoren Stufe 3', num(levelCounts.V3)],
          ['Ingenieure Stufe 3', num(levelCounts.I3)],
        ].filter(([, v]) => v !== '0') as Array<[string, string]>
      : [];
    const buildRows: Array<[string, string]> = [
      ...list.map((x) => [x.name, num(x.n)] as [string, string]),
      ['Pflasterstraße (Kacheln)', num(streets)],
      ...(bridges ? [['Brücken (selbst bauen)', num(bridges)] as [string, string]] : []),
    ];
    const table = (title: string, rows: Array<[string, string]>): string =>
      rows.length
        ? `<div class="report-title">${title}</div><table>${rows
            .map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`)
            .join('')}</table>`
        : '';
    el<HTMLElement>('#plan-report-body').innerHTML =
      table('Bauliste', buildRows) + table('Hochhaus-Stufen', levelRows) + table('Einwohner', resRows);
    const text = (title: string, rows: Array<[string, string]>): string =>
      rows.length ? `${title}\n${rows.map(([a, b]) => `  ${a.padEnd(48, ' ')} ${b}`).join('\n')}\n\n` : '';
    const m = this.result?.mask;
    this.reportText =
      `Anno 1800 Wohnraster – Bauliste (${m ? `${m.w} × ${m.h}` : ''})\n\n` +
      text('Bauliste', buildRows) +
      text('Hochhaus-Stufen', levelRows) +
      text('Einwohner', resRows);
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
