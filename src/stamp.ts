import { zlibSync } from 'fflate';

export const HANDELSKAMMER_GUID = 1010516;

export const REGIONS = {
  ow: { path: 5000000, folder: 'The Old World', label: 'Alte Welt' },
  nw: { path: 5000001, folder: 'The New World', label: 'Neue Welt' },
} as const;

export type RegionKey = keyof typeof REGIONS;

const TAG_IDS = [4, 2, 3];
const TAG_NAMES = ['RailwayInfos', 'BuildingInfo', 'StreetInfo'];
const ATTR_IDS = [0x8001, 0x8008, 0x8002, 0x8003, 0x8005, 0x8004, 0x8006, 0x8007];
const ATTR_NAMES = [
  'StampPath',
  'StreetCount',
  'IconGUID',
  'Pos',
  'GUID',
  'Dir',
  'ComplexOwnerID',
  'Variation',
];

const A_STAMP = 0x8001;
const A_ICON = 0x8002;
const A_STREET = 0x8000;
const A_POS = 0x8003;
const A_DIR = 0x8004;
const A_GUID = 0x8005;
const A_OWNER = 0x8006;
const A_STREET_COUNT = 0x8008;
const T_ITEM = 1;
const T_BUILDING = 2;
const T_STREETS = 3;
const T_RAIL = 4;

type Node =
  | { kind: 'attr'; id: number; raw: Uint8Array }
  | { kind: 'tag'; id: number; kids: Node[] };

const attr = (id: number, raw: Uint8Array): Node => ({ kind: 'attr', id, raw });
const tag = (id: number, kids: Node[]): Node => ({ kind: 'tag', id, kids });

class Buf {
  private a = new Uint8Array(512);
  private n = 0;

  private need(k: number): void {
    if (this.n + k <= this.a.length) return;
    let cap = this.a.length;
    while (cap < this.n + k) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.a.subarray(0, this.n));
    this.a = next;
  }

  u8(v: number): void {
    this.need(1);
    this.a[this.n++] = v & 0xff;
  }

  u16(v: number): void {
    this.need(2);
    new DataView(this.a.buffer).setUint16(this.n, v, true);
    this.n += 2;
  }

  i32(v: number): void {
    this.need(4);
    new DataView(this.a.buffer).setInt32(this.n, v, true);
    this.n += 4;
  }

  f32(v: number): void {
    this.need(4);
    new DataView(this.a.buffer).setFloat32(this.n, v, true);
    this.n += 4;
  }

  bytes(b: Uint8Array): void {
    this.need(b.length);
    this.a.set(b, this.n);
    this.n += b.length;
  }

  zeros(k: number): void {
    this.need(k);
    this.n += k;
  }

  get length(): number {
    return this.n;
  }

  finish(): Uint8Array {
    return this.a.slice(0, this.n);
  }
}

const f32 = (v: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return b;
};

const i32 = (v: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return b;
};

const i64 = (v: number): Uint8Array => {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setInt32(0, v, true);
  dv.setInt32(4, Math.floor(v / 4294967296), true);
  return b;
};

const f32pair = (x: number, y: number): Uint8Array => {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setFloat32(0, x, true);
  dv.setFloat32(4, y, true);
  return b;
};

function writeNode(b: Buf, node: Node): void {
  if (node.kind === 'attr') {
    b.i32(node.raw.length);
    b.i32(node.id);
    b.bytes(node.raw);
    b.zeros((8 - (node.raw.length % 8)) % 8);
    return;
  }
  b.i32(0);
  b.i32(node.id);
  for (const kid of node.kids) writeNode(b, kid);
  b.zeros(8);
}

function countNodes(node: Node): number {
  if (node.kind === 'attr') return 1;
  let n = 1;
  for (const kid of node.kids) n += countNodes(kid);
  return n;
}

function serialize(roots: Node[]): Uint8Array {
  const b = new Buf();
  for (const root of roots) writeNode(b, root);
  b.zeros(8);

  const tagOff = b.length;
  b.i32(TAG_IDS.length);
  for (const id of TAG_IDS) b.u16(id);
  for (const name of TAG_NAMES) {
    for (let i = 0; i < name.length; i++) b.u8(name.charCodeAt(i));
    b.u8(0);
  }
  while (b.length % 8 !== 0) b.u8(0);

  const attrOff = b.length;
  b.i32(ATTR_IDS.length);
  for (const id of ATTR_IDS) b.u16(id);
  for (const name of ATTR_NAMES) {
    for (let i = 0; i < name.length; i++) b.u8(name.charCodeAt(i));
    b.u8(0);
  }
  while (b.length % 8 !== 0) b.u8(0);

  let total = 1;
  for (const root of roots) total += countNodes(root);

  b.i32(0);
  b.i32(total);
  b.i32(tagOff);
  b.i32(attrOff);
  b.i32(8);
  b.i32(-3);

  return b.finish();
}

export interface StampChamber {
  x: number;
  y: number;
}

export interface StampStreet {
  x: number;
  y: number;
  guid: number;
}

export function buildStamp(
  chambers: ReadonlyArray<StampChamber>,
  region: RegionKey,
  streets: readonly StampStreet[] = [],
): Uint8Array {
  if (chambers.length === 0) throw new Error('empty stamp');

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of chambers) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + 4);
    maxY = Math.max(maxY, c.y + 4);
  }
  // 4×4 buildings must sit on half-tile coordinates. Rounding the bbox
  // center to an integer guarantees a .5 offset on both axes; using the
  // exact center produces integer offsets whenever the bbox has an odd
  // width/height, and the game then snaps the footprints so that the
  // influence circles of neighbouring chambers overlap.
  const cx = Math.round((minX + maxX) / 2);
  const cy = Math.round((minY + maxY) / 2);

  const buildings: Node[] = chambers.map((c, i) =>
    tag(T_ITEM, [
      attr(A_POS, f32pair(-(c.y - cy) - 1.5, -(c.x - cx) - 1.5)),
      attr(A_DIR, f32(0)),
      attr(A_GUID, i32(HANDELSKAMMER_GUID)),
      attr(A_OWNER, i64(i + 1)),
    ]),
  );

  // Die Feldwege werden wie in einem echten Inselstempel gruppiert:
  // [GUID-Attribut, Tag mit den Kacheln]; jede Kachel hat zwei Rohachsen.
  const streetGroups = new Map<number, StampStreet[]>();
  for (const street of streets) {
    const group = streetGroups.get(street.guid);
    if (group) group.push(street);
    else streetGroups.set(street.guid, [street]);
  }
  const streetNodes: Node[] = [];
  for (const [guid, tiles] of streetGroups) {
    streetNodes.push(attr(A_STREET, i32(guid)));
    streetNodes.push(
      tag(
        T_ITEM,
        tiles.map((street) =>
          tag(T_ITEM, [
            attr(A_STREET, f32(-(street.y - cy))),
            attr(A_STREET, f32(-(street.x - cx))),
          ]),
        ),
      ),
    );
  }

  const roots: Node[] = [
    attr(A_STAMP, i32(REGIONS[region].path)),
    attr(A_ICON, i32(HANDELSKAMMER_GUID)),
    tag(T_BUILDING, buildings),
    tag(T_STREETS, streetNodes),
    attr(A_STREET_COUNT, i32(streets.length)),
    tag(T_RAIL, []),
  ];

  return compress(serialize(roots));
}

function compress(raw: Uint8Array): Uint8Array {
  const body = zlibSync(raw, { level: 9 });
  const tail = zlibSync(new Uint8Array(0), { level: 9 });
  const out = new Uint8Array(body.length + tail.length + 4);
  out.set(body, 0);
  out.set(tail, body.length);
  new DataView(out.buffer).setUint32(body.length + tail.length, raw.length, true);
  return out;
}
