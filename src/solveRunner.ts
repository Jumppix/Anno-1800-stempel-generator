// Verteilt die Optimierung auf mehrere Web Worker. Die Suche ist ein
// randomisiertes Verfahren; unabhängige Läufe mit verschiedenen Seeds finden
// häufiger das Optimum als ein einzelner langer Lauf. Bei mehreren
// Gebäudetypen wird erst Typ 1 auf allen Kernen gelöst, dann Typ 2 um dessen
// Flächen herum.
import { BUILDINGS, type BuildingId } from './buildings';
import { emptyLayout, type Chamber, type Group, type LandMask, type Layout } from './solver';
import type { SolveJob, SolveMessage } from './solver.worker';

export interface RunUpdate {
  layout: Layout;
  running: boolean;
  workers: number;
}

const better = (a: Group, b: Group | null): boolean =>
  !b ||
  a.chambers.length > b.chambers.length ||
  (a.chambers.length === b.chambers.length && a.coveredCount > b.coveredCount);

export function workerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(6, cores - 1));
}

export class SolveRunner {
  private generation = 0;
  private workers: Worker[] = [];

  constructor(private readonly onUpdate: (update: RunUpdate) => void) {}

  cancel(): void {
    this.generation++;
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }

  async start(
    mask: LandMask,
    types: readonly BuildingId[],
    budgetMs: number,
    warm: Layout | null,
  ): Promise<void> {
    this.cancel();
    const gen = this.generation;
    const count = workerCount();
    const finished: Group[] = [];
    const blocked: Chamber[] = [];
    const warmGroup = (t: BuildingId): Group | undefined => warm?.groups.find((g) => g.type === t);
    const weights = types.map((t) => (t === 'hk' ? 0.6 : 0.4));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const pending = (from: number): Group[] =>
      types.slice(from).map((t) => warmGroup(t) ?? emptyLayout(mask, [t]).groups[0]);
    const emit = (groups: Group[], running: boolean): void => {
      if (gen !== this.generation) return;
      this.onUpdate({
        layout: {
          w: mask.w,
          h: mask.h,
          landCount: mask.landCount,
          groups,
          chambers: groups.flatMap((g) => g.chambers),
        },
        running,
        workers: count,
      });
    };

    emit([...finished, ...pending(0)], true);
    for (let ti = 0; ti < types.length; ti++) {
      const type = types[ti];
      const share = (budgetMs * weights[ti]) / wsum;
      const best = await this.runType(gen, count, mask, type, share, blocked, warmGroup(type), (g) =>
        emit([...finished, g, ...pending(ti + 1)], true),
      );
      if (gen !== this.generation) return;
      finished.push(best);
      blocked.push(...best.chambers);
    }
    emit(finished, false);
    this.workers = [];
  }

  private runType(
    gen: number,
    count: number,
    mask: LandMask,
    type: BuildingId,
    budgetMs: number,
    blocked: readonly Chamber[],
    warm: Group | undefined,
    onBest: (g: Group) => void,
  ): Promise<Group> {
    return new Promise((resolve) => {
      let best: Group | null = null;
      let open = count;
      const fallback = emptyLayout(mask, [type]).groups[0];
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
        this.workers.push(worker);
        const finish = (): void => {
          worker.terminate();
          open--;
          if (open === 0 && gen === this.generation) resolve(best ?? fallback);
        };
        worker.onmessage = (event: MessageEvent<SolveMessage>) => {
          if (gen !== this.generation) return;
          const group = event.data.layout.groups[0];
          if (group && better(group, best)) {
            best = group;
            onBest(group);
          }
          if (event.data.done) finish();
        };
        worker.onerror = () => {
          if (gen === this.generation) finish();
        };
        const job: SolveJob = {
          id: i,
          mask,
          types: [type],
          budgetMs,
          // Unterschiedliche Seeds je Worker und Lauf.
          seed: (Date.now() % 1_000_000) * 31 + i * 7919 + BUILDINGS[type].radius,
          warmStart: warm ? { [type]: warm.chambers.map((c) => ({ x: c.x, y: c.y })) } : undefined,
          blocked: [...blocked],
        };
        worker.postMessage(job);
      }
    });
  }
}
