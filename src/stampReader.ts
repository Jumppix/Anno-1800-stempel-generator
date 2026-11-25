import { unzlibSync } from 'fflate';

export interface ImportedIsland {
  width: number;
  height: number;
  /** Alle Straßenkacheln (Land und Hafengebiet) – zum Ausrichten der Teile. */
  mask: Uint8Array;
  /** Kacheln, die nur mit Hafen-Straßen belegt sind (Kaistraße, Kaimauer, Kai) = Hafengebiet. */
  harbor?: Uint8Array;
  /** Alle Straßenkacheln des Teils (zum Ausrichten; Land der Insel zählt `combineParts`). */
  landCount: number;
  region: number | null;
  /** Straßen-GUID für Land (Feldweg …), nicht die Kaistraße. */
  streetGuid: number | null;
  /**
   * Gebäude im Stempel (z. B. Minen, Lehmgruben, Bohrtürme als Blaupause): Mittelpunkt in
   * Kachelachsen relativ zur Maske, Drehung in Radiant.
   */
  buildings?: Array<{ guid: number; cx: number; cy: number; dir: number }>;
}

/**
 * Straßen, die nur im Hafengebiet („Wasser inkl. Küste“) gebaut werden können: Kaistraße,
 * Kaimauer, Kai (Spieldaten, BuildingType Street, Water_Including_Coast).
 */
export const HARBOR_STREETS: ReadonlySet<number> = new Set([601443, 100691, 1010567, 117729, 101339, 131865]);

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

/** Namensverzeichnis (ID → Name) an einer Offset-Position des FileDB-Blocks. */
function parseDictionary(data: Uint8Array, view: DataView, offset: number): Map<number, string> {
  const out = new Map<number, string>();
  if (offset < 0 || offset + 4 > data.length) return out;
  const count = view.getInt32(offset, true);
  if (count < 0 || count > 4096 || offset + 4 + count * 2 > data.length) return out;
  const ids: number[] = [];
  for (let i = 0; i < count; i++) ids.push(view.getUint16(offset + 4 + i * 2, true));
  let p = offset + 4 + count * 2;
  for (const id of ids) {
    let name = '';
    while (p < data.length && data[p] !== 0) name += String.fromCharCode(data[p++]);
    p++;
    out.set(id, name);
  }
  return out;
}

interface FileDB {
  roots: Node[];
  tags: Map<number, string>;
  attrs: Map<number, string>;
}

function parseFileDBWithNames(data: Uint8Array): FileDB {
  const roots = parseFileDB(data);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = data.length;
  return {
    roots,
    tags: parseDictionary(data, view, view.getInt32(n - 16, true)),
    attrs: parseDictionary(data, view, view.getInt32(n - 12, true)),
  };
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
  let streetGuid = streetGuidNode?.raw ? i32(streetGuidNode.raw) : null;

  // Hafengebiet: Kacheln nur mit Hafen-Straßen (über die GUIDs aus dem vollständigen Lesen).
  let harbor: Uint8Array | undefined;
  let buildings: ImportedIsland['buildings'];
  try {
    const full = decodeStampFull(file);
    if (full.buildings.length) {
      buildings = full.buildings.map((b) => ({ guid: b.guid, cx: -b.rawY - minX, cy: -b.rawX - minY, dir: b.dir }));
    }
    const land = new Set<string>();
    const port = new Set<string>();
    const guidCount = new Map<number, number>();
    for (const st of full.streets) {
      const key = `${-Math.round(st.rawY)},${-Math.round(st.rawX)}`;
      if (HARBOR_STREETS.has(st.guid)) port.add(key);
      else {
        land.add(key);
        guidCount.set(st.guid, (guidCount.get(st.guid) ?? 0) + 1);
      }
    }
    if (port.size) {
      harbor = new Uint8Array(width * height);
      for (const key of port) {
        if (land.has(key)) continue;
        const [x, y] = key.split(',').map(Number);
        if (x < minX || y < minY || x > maxX || y > maxY) continue;
        harbor[(y - minY) * width + (x - minX)] = 1;
      }
    }
    if (streetGuid !== null && HARBOR_STREETS.has(streetGuid)) {
      streetGuid = [...guidCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
  } catch {
    /* ohne Hafengebiet */
  }

  return { width, height, mask, harbor, landCount: tiles.length, region, streetGuid, buildings };
}

// ---------------------------------------------------------------------------
// Vollständiges Lesen: Gebäude und Straßen mit GUID (für die Stadt-Analyse)
// ---------------------------------------------------------------------------

export interface RawBuilding {
  guid: number;
  /** Mittelpunkt der Grundfläche in Stempel-Rohachsen. */
  rawX: number;
  rawY: number;
  /** Drehung in Radiant (0, π/2, π, 3π/2). */
  dir: number;
}

export interface RawStreet {
  guid: number;
  rawX: number;
  rawY: number;
}

/** Gleisstück (gerade, Endpunkte in Stempel-Rohachsen, ganzzahlig). */
export interface RawRail {
  a: [number, number];
  b: [number, number];
}

export interface DecodedStamp {
  region: number | null;
  icon: number | null;
  buildings: RawBuilding[];
  streets: RawStreet[];
  /** Gleisstücke (Abschnitt RailwayInfos) – Schienen sind keine Straßen. */
  rails: RawRail[];
}

/** Alle Gleiskacheln eines Stempels in Kachelachsen (x, y) = (−rawY, −rawX). */
export function railTiles(rails: readonly RawRail[]): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const { a, b } of rails) {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    for (let k = 0; k <= n; k++) {
      const rx = a[0] + Math.sign(b[0] - a[0]) * k;
      const ry = a[1] + Math.sign(b[1] - a[1]) * k;
      const key = `${rx},${ry}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([-ry, -rx]);
    }
  }
  return out;
}

/**
 * Liest Gebäude und Straßen. Die Attribut-IDs unterscheiden sich zwischen
 * Stempeln aus dem Spiel und aus dieser App, deshalb werden sie über das
 * Namensverzeichnis am Dateiende aufgelöst.
 */
export function decodeStampFull(file: Uint8Array): DecodedStamp {
  const { roots, tags, attrs } = parseFileDBWithNames(decompress(file));
  const attrId = (name: string, fallback: number): number => {
    for (const [id, n] of attrs) if (n === name) return id;
    return fallback;
  };
  const tagId = (name: string, fallback: number): number => {
    for (const [id, n] of tags) if (n === name) return id;
    return fallback;
  };
  const A_POS = attrId('Pos', 0x8003);
  const A_DIR = attrId('Dir', 0x8007);
  const A_GUID = attrId('GUID', 0x8004);
  const A_STAMP = attrId('StampPath', 0x8001);
  const A_ICON = attrId('IconGUID', 0x8002);
  const T_BUILDING = tagId('BuildingInfo', 2);
  const T_STREETS = tagId('StreetInfo', 3);

  const intOf = (node: Node | undefined): number | null =>
    node?.raw && node.raw.length === 4 ? i32(node.raw) : null;

  const buildings: RawBuilding[] = [];
  const buildingRoot = roots.find((r) => r.id === T_BUILDING && r.kids);
  for (const entry of buildingRoot?.kids ?? []) {
    if (!entry.kids) continue;
    let guid = 0;
    let rawX = 0;
    let rawY = 0;
    let dir = 0;
    for (const a of entry.kids) {
      if (!a.raw) continue;
      const dv = new DataView(a.raw.buffer, a.raw.byteOffset, a.raw.byteLength);
      if (a.id === A_POS && a.raw.length >= 8) {
        rawX = dv.getFloat32(0, true);
        rawY = dv.getFloat32(4, true);
      } else if (a.id === A_DIR && a.raw.length === 4) {
        dir = dv.getFloat32(0, true);
      } else if (a.id === A_GUID && a.raw.length === 4) {
        guid = dv.getInt32(0, true);
      }
    }
    if (guid) buildings.push({ guid, rawX, rawY, dir });
  }

  const streets: RawStreet[] = [];
  const streetRoot = roots.find((r) => r.id === T_STREETS && r.kids);
  let currentGuid = 0;
  for (const kid of streetRoot?.kids ?? []) {
    if (kid.raw && kid.raw.length === 4) {
      currentGuid = i32(kid.raw);
      continue;
    }
    const pairs: Array<[number, number]> = [];
    collectPairs(kid, pairs);
    for (const [fx, fy] of pairs) streets.push({ guid: currentGuid, rawX: fx, rawY: fy });
  }

  // Gleise: je Eintrag zwei Endpunkte (je 2 × int32, Rohachsen)
  const rails: RawRail[] = [];
  const railRoot = roots.find((r) => r.id === tagId('RailwayInfos', 4) && r.kids);
  for (const seg of railRoot?.kids ?? []) {
    const pts = (seg.kids ?? []).filter((k) => k.raw && k.raw.length === 8).map((k) => {
      const dv = new DataView((k.raw as Uint8Array).buffer, (k.raw as Uint8Array).byteOffset, 8);
      return [dv.getInt32(0, true), dv.getInt32(4, true)] as [number, number];
    });
    if (pts.length === 2) rails.push({ a: pts[0], b: pts[1] });
  }

  return {
    region: intOf(roots.find((r) => r.id === A_STAMP)),
    icon: intOf(roots.find((r) => r.id === A_ICON)),
    buildings,
    streets,
    rails,
  };
}

