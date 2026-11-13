import { unzlibSync } from 'fflate';

export interface ImportedIsland {
  width: number;
  height: number;
  mask: Uint8Array;
  landCount: number;
  region: number | null;
  streetGuid: number | null;
}

interface Node {
  id: number;
  raw?: Uint8Array;
  kids?: Node[];
}

const isZero8 = (data: Uint8Array, offset: number): boolean => {
  for (let i = 0; i < 8; i++) if (data[offset + i] !== 0) return false;
  return true;
};

const f32 = (raw: Uint8Array): number =>
  new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getFloat32(0, true);

const i32 = (raw: Uint8Array): number =>
  new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt32(0, true);

function parseNode(data: Uint8Array, view: DataView, offset: number): [number, Node] {
  if (offset + 8 > data.length) throw new Error('Stempel ist beschädigt (Node fehlt).');
  const size = view.getInt32(offset, true);
  const id = view.getInt32(offset + 4, true);
  offset += 8;

  if (id & 0x8000) {
    if (size < 0 || offset + size > data.length) {
      throw new Error('Stempel ist beschädigt (Attribut zu lang).');
    }
    const raw = data.subarray(offset, offset + size);
    return [offset + Math.ceil(size / 8) * 8, { id, raw }];
  }

  const kids: Node[] = [];
  for (;;) {
    if (offset + 8 > data.length) throw new Error('Stempel ist beschädigt (Tag ohne Ende).');
    if (isZero8(data, offset)) {
      offset += 8;
      break;
    }
    const [next, kid] = parseNode(data, view, offset);
    if (next <= offset) throw new Error('Stempel ist beschädigt (Länge 0).');
    offset = next;
    kids.push(kid);
  }
  return [offset, { id, kids }];
}

function parseFileDB(data: Uint8Array): Node[] {
  if (data.length < 40) throw new Error('Die Datei ist zu klein für einen Anno-Stempel.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = data.length;
  const tagOff = view.getInt32(n - 16, true);
  const attrOff = view.getInt32(n - 12, true);
  if (tagOff < 8 || tagOff > n || attrOff < tagOff || attrOff > n) {
    throw new Error('Das ist kein gültiger Anno-1800-Stempel.');
  }

  const roots: Node[] = [];
  let offset = 0;
  while (offset < tagOff) {
    if (offset + 8 <= data.length && isZero8(data, offset)) {
      offset += 8;
      continue;
    }
    const [next, node] = parseNode(data, view, offset);
    offset = next;
    roots.push(node);
  }
  return roots;
}

function collectPairs(node: Node, out: Array<[number, number]>): void {
  const kids = node.kids;
  if (!kids) return;
  if (kids.length === 2 && kids[0].raw?.length === 4 && kids[1].raw?.length === 4) {
    out.push([f32(kids[0].raw), f32(kids[1].raw)]);
    return;
  }
  for (const kid of kids) collectPairs(kid, out);
}

function decompress(file: Uint8Array): Uint8Array {
  if (file.length > 2 && file[0] === 0x78) {
    try {
      return unzlibSync(file);
    } catch {
      // Der Stempel hat einen 12-Byte-Footer hinter dem zlib-Stream.
    }
    if (file.length > 12) {
      try {
        return unzlibSync(file.subarray(0, file.length - 12));
      } catch {
        // Kein gültiger zlib-Stream.
      }
    }
    throw new Error('Der Stempel konnte nicht entpackt werden.');
  }
  return file;
}

export function decodeStamp(file: Uint8Array): ImportedIsland {
  const raw = decompress(file);
  const roots = parseFileDB(raw);

  const street = roots.find((root) => root.id === 3);
  if (!street?.kids) {
    throw new Error(
      'Keine Straßen im Stempel gefunden. Fülle die Insel mit Feldwegen und speichere die Auswahl als Stempel.',
    );
  }

  const points: Array<[number, number]> = [];
  for (const kid of street.kids) collectPairs(kid, points);
  if (points.length === 0) {
    throw new Error('Der Stempel enthält keine Straßenkacheln.');
  }

  const seen = new Set<string>();
  const tiles: Array<[number, number]> = [];
  for (const [fx, fy] of points) {
    // Stempel speichern Straßen in den internen Spielachsen. Die
    // Anno-Designer-Konvention dreht sie mit (x, y) = (-rawY, -rawX) in die
    // Draufsicht; ohne diese Transformation erscheint die Insel gespiegelt.
    const x = -Math.round(fy);
    const y = -Math.round(fx);
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tiles.push([x, y]);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of tiles) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width > 600 || height > 600) {
    throw new Error(`Die Inselform ist zu groß (${width} × ${height}); maximal 600 × 600.`);
  }

  const mask = new Uint8Array(width * height);
  for (const [x, y] of tiles) mask[(y - minY) * width + (x - minX)] = 1;

  const regionNode = roots.find((root) => root.id === 32769);
  const region = regionNode?.raw?.length === 4 ? i32(regionNode.raw) : null;
  const streetGuidNode = street.kids.find((kid) => kid.id === 0x8000 && kid.raw?.length === 4);
  const streetGuid = streetGuidNode?.raw ? i32(streetGuidNode.raw) : null;

  return { width, height, mask, landCount: tiles.length, region, streetGuid };
}
