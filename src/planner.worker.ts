// Rechnet die Bebauung (Gittersuche mit Bandverschiebung) und die
// Nachverdichtung im Hintergrund, damit die Oberfläche bedienbar bleibt.
import { searchFill, type FillResult, type Orientation } from './fill';
import { compactCity, type CityPlan } from './planner';
import type { LandMask } from './solver';

export type PlannerJob =
  | { kind: 'fill'; id: number; mask: LandMask; orientation: 'auto' | Orientation; housesPerLine: number }
  | { kind: 'compact'; id: number; mask: LandMask; city: CityPlan; budgetMs: number; seed: number };

export type PlannerMessage =
  | { kind: 'fill'; id: number; result: FillResult }
  | { kind: 'progress'; id: number; gained: number }
  | { kind: 'compact'; id: number; city: CityPlan; gained: number; moved: number };

const scope = self as unknown as {
  postMessage(message: PlannerMessage): void;
  onmessage: ((event: MessageEvent<PlannerJob>) => void) | null;
};

scope.onmessage = (event) => {
  const job = event.data;
  if (job.kind === 'fill') {
    const result = searchFill(job.mask, { orientation: job.orientation, housesPerLine: job.housesPerLine });
    scope.postMessage({ kind: 'fill', id: job.id, result });
    return;
  }
  const { city, result } = compactCity(job.mask, job.city, {
    deadline: performance.now() + job.budgetMs,
    seed: job.seed,
    onProgress: (gained) => scope.postMessage({ kind: 'progress', id: job.id, gained }),
  });
  scope.postMessage({ kind: 'compact', id: job.id, city, gained: result.gained, moved: result.townHallsMoved });
};
