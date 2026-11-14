// Oberfläche „Wohnraster planen“ (Stadtplaner Phase 2). Nutzt die geladene
// Inselform (in beiden Modi dieselbe), plant Raster + Rathäuser und zeigt das Ergebnis
// in der Stadt-Ansicht (CityUi) mit allen Analyse-Ebenen.

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

export class PlannerUi {
  private readonly islandInfo = el<HTMLElement>('#plan-island');
  private readonly orientation = el<HTMLSelectElement>('#plan-orientation');
  private readonly perLine = el<HTMLSelectElement>('#plan-line');
  private readonly townHalls = el<HTMLInputElement>('#plan-townhalls');
  private readonly minCover = el<HTMLInputElement>('#plan-mincover');
  private readonly budget = el<HTMLSelectElement>('#plan-budget');
  private readonly compactBudget = el<HTMLSelectElement>('#plan-compact');
  private readonly coast = el<HTMLInputElement>('#plan-coast');
  private readonly runButton = el<HTMLButtonElement>('#plan-run');
  private readonly status = el<HTMLElement>('#plan-status');
  private readonly exportBox = el<HTMLElement>('#plan-export');
  private readonly split = el<HTMLInputElement>('#plan-split');
  private readonly stampList = el<HTMLElement>('#plan-stamps');

  private runner: SolveRunner;
  private result: { city: CityPlan; mask: LandMask; streetGuid: number } | null = null;
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
    this.coast.addEventListener('change', () => this.buildStamps());
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
    const compactMs = Number(this.compactBudget.value) || 0;
    const compacted = compactMs > 0 ? await this.compact(src.mask, refilled, compactMs, started) : null;
    const city = compacted ? { ...compacted.city, removedHouses: refilled.removedHouses } : refilled;
    this.result = { city, mask: src.mask, streetGuid: src.streetGuid };
    this.buildStamps();
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const free = freeTiles(src.mask, city);
    const parts = [
      `${num(city.houses.length)} Häuser (${plan.orientation === 'vertical' ? 'senkrechte' : 'waagerechte'} Gruppen, ${num(
        fill.extraHouses,
      )} frei gesetzt)`,
      `${city.townHalls.length} Rathäuser`,
    ];
    if (refilled.removedHouses) {
      parts.push(`${refilled.removedHouses} Häuser unter Rathäusern entfernt, ${refilled.refilled} drumherum neu gesetzt`);
    }
    if (compacted) {
      parts.push(
        `Nachverdichtung ${compacted.gained >= 0 ? '+' : ''}${compacted.gained} Häuser${
          compacted.moved ? `, ${compacted.moved} Rathaus-Verschiebungen` : ''
        }`,
      );
    }
    if (city.droppedTownHalls) parts.push(`${city.droppedTownHalls} Rathaus/-häuser mit zu wenig Häusern verworfen`);
    parts.push(`${num(free)} freie Restkacheln (${((100 * free) / src.mask.landCount).toFixed(1)} %, meist schmale Ränder)`);
    if (city.plan.networks > 1) parts.push(`${city.plan.networks} getrennte Straßennetze (Inselteile)`);
    this.status.textContent = `Fertig nach ${secs} s · ${parts.join(' · ')}.`;
    this.running = false;
    this.refreshIsland();
  }

  private worker(i: number): Worker {
    while (this.workers.length <= i) {
      this.workers.push(new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' }));
    }
    return this.workers[i];
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
      const job: PlannerJob = { kind: 'fill', id, mask, orientation, housesPerLine };
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
    const items = planToStampItems(mask, city, { coast: this.coast.checked, coastGuid: streetGuid });
    const full = buildGenericStamp(items.buildings, 'ow', items.streets);
    const bands = splitBands(items, this.split.checked ? 13500 : Infinity);
    this.stamps = bands.map((b) => buildGenericStamp(b.buildings, 'ow', b.streets));
    this.cityUi.show(full, 'Wohnraster-Plan');
    this.stampList.innerHTML = this.stamps
      .map((_, i) => {
        const b = bands[i];
        const houses = b.buildings.filter((x) => x.w === 3).length;
        const halls = b.buildings.filter((x) => x.w === 4).length;
        return `<div class="stamp-row"><div><strong>T${i + 1}</strong><span>${num(houses)} Häuser · ${halls} RH</span></div>
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
