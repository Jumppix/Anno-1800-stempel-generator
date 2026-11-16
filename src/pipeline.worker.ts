// Ein Planungsdurchlauf je Worker (pipeline.ts). Mehrere dieser Worker laufen
// gleichzeitig; die Oberfläche wählt den Plan mit den meisten Einwohnern.
import { runPass, type PassEvent, type PassInput, type PassResult } from './pipeline';
import type { MipSolver } from './services';

export type PipelineJob = { id: number; input: PassInput };
export type PipelineMessage =
  | { id: number; kind: 'event'; event: PassEvent }
  | { id: number; kind: 'done'; result: PassResult }
  | { id: number; kind: 'error'; message: string };

const scope = self as unknown as {
  postMessage(message: PipelineMessage): void;
  onmessage: ((event: MessageEvent<PipelineJob>) => void) | null;
};

/** HiGHS (WebAssembly) einmal je Worker laden; schlägt das fehl, ohne exakten Löser. */
let highs: Promise<MipSolver | undefined> | null = null;
const loadHighs = (): Promise<MipSolver | undefined> => {
  highs ??= Promise.all([import('highs'), import('highs/runtime?url')])
    .then(([lib, wasm]) => lib.default({ locateFile: () => wasm.default }))
    .then((h) => h as unknown as MipSolver)
    .catch(() => undefined);
  return highs;
};

scope.onmessage = async (event) => {
  const { id, input } = event.data;
  try {
    const mip = input.exact ? await loadHighs() : undefined;
    const result = runPass(input, (e) => scope.postMessage({ id, kind: 'event', event: e }), mip);
    scope.postMessage({ id, kind: 'done', result });
  } catch (error) {
    scope.postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
