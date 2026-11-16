// Ein Planungsdurchlauf je Worker (pipeline.ts). Mehrere dieser Worker laufen
// gleichzeitig; die Oberfläche wählt den Plan mit den meisten Einwohnern.
import { runPass, type PassEvent, type PassInput, type PassResult } from './pipeline';

export type PipelineJob = { id: number; input: PassInput };
export type PipelineMessage =
  | { id: number; kind: 'event'; event: PassEvent }
  | { id: number; kind: 'done'; result: PassResult }
  | { id: number; kind: 'error'; message: string };

const scope = self as unknown as {
  postMessage(message: PipelineMessage): void;
  onmessage: ((event: MessageEvent<PipelineJob>) => void) | null;
};

scope.onmessage = (event) => {
  const { id, input } = event.data;
  try {
    const result = runPass(input, (e) => scope.postMessage({ id, kind: 'event', event: e }));
    scope.postMessage({ id, kind: 'done', result });
  } catch (error) {
    scope.postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
