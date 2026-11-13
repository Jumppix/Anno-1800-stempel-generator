// Rechnet die Platzierung im Hintergrund, damit die Oberfläche während der
// (absichtlich längeren) Optimierung bedienbar bleibt. Zwischenstände werden
// laufend zurückgeschickt.
import { solve, type Chamber, type LandMask, type Layout } from './solver';
import type { BuildingId } from './buildings';

export interface SolveJob {
  id: number;
  mask: LandMask;
  types: BuildingId[];
  budgetMs: number;
  seed: number;
  warmStart?: Partial<Record<BuildingId, Array<{ x: number; y: number }>>>;
  blocked?: Chamber[];
}

export interface SolveMessage {
  id: number;
  layout: Layout;
  done: boolean;
  elapsedMs: number;
}

const scope = self as unknown as {
  postMessage(message: SolveMessage): void;
  onmessage: ((event: MessageEvent<SolveJob>) => void) | null;
};

scope.onmessage = (event) => {
  const job = event.data;
  const start = performance.now();
  const layout = solve(job.mask, job.types, {
    budgetMs: job.budgetMs,
    seed: job.seed,
    warmStart: job.warmStart,
    blocked: job.blocked,
    onProgress: (partial) =>
      scope.postMessage({
        id: job.id,
        layout: partial,
        done: false,
        elapsedMs: performance.now() - start,
      }),
  });
  scope.postMessage({ id: job.id, layout, done: true, elapsedMs: performance.now() - start });
};
