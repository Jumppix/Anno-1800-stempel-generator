// Stadtmodell: Gebäude und Straßen eines Stempels in Kachelachsen, dazu die
// Reichweitensuche über Straßen.

import { footprint, lookup, quarterTurns, STREET_GUIDS, type CatalogEntry } from './catalog';
import { railTiles, type DecodedStamp } from './stampReader';

export interface CityBuilding {
  index: number;
  guid: number;
  entry: CatalogEntry;
  /** Linke obere Kachel und Größe in Kachelachsen. */
  x: number;
  y: number;
  w: number;
  h: number;
  turns: number;
  /** Mittelpunkt in Kachelachsen (Kachel i hat ihre Mitte bei i). */
  cx: number;
  cy: number;
}

export interface City {
  w: number;
  h: number;
  buildings: CityBuilding[];
  /** Straßen-GUID je Kachel, 0 = keine Straße. */
  road: Int32Array;
  /** Gebäudeindex + 1 je Kachel, 0 = frei. */
  occ: Int32Array;
  roadCount: number;
  pavedCount: number;
  region: number | null;
  /** Stempelkacheln, die sowohl Straße als auch Gebäude sind. */
  conflicts: number;
  /** Gleiskacheln (1 = Schiene), falls der Stempel Gleise enthält. */
  rail?: Uint8Array;
}

/** Leerer Rand um das Stadtmodell (Kacheln). */
export const CITY_PAD = 2;
const PAD = CITY_PAD;

/** Baut das Stadtmodell aus einem vollständig gelesenen Stempel. */
export function cityFromStamp(stamp: DecodedStamp): City {
  type Placed = { guid: number; entry: CatalogEntry; x: number; y: number; w: number; h: number; turns: number };
  const placed: Placed[] = stamp.buildings.map((b) => {
    const entry = lookup(b.guid);
    const turns = quarterTurns(b.dir);
    const { w, h } = footprint(entry, turns);
    // Rohachsen → Kachelachsen wie bei Straßen: (x, y) = (−rawY, −rawX).
    const cx = -b.rawY;
    const cy = -b.rawX;
    return {
      guid: b.guid,
      entry,
      x: Math.round(cx - (w - 1) / 2),
      y: Math.round(cy - (h - 1) / 2),
      w,
      h,
      turns,
    };
  });
  const roads = stamp.streets.map((s) => ({ guid: s.guid, x: -Math.round(s.rawY), y: -Math.round(s.rawX) }));
  const rails = railTiles(stamp.rails ?? []);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  for (const r of roads) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + 1);
    maxY = Math.max(maxY, r.y + 1);
  }
  for (const [x, y] of rails) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1);
    maxY = Math.max(maxY, y + 1);
  }
  if (!Number.isFinite(minX)) throw new Error('Der Stempel enthält weder Gebäude noch Straßen.');

  const ox = minX - PAD;
  const oy = minY - PAD;
  const w = maxX - minX + 2 * PAD;
  const h = maxY - minY + 2 * PAD;
  if (w > 1200 || h > 1200) throw new Error(`Der Stempel ist zu groß (${w} × ${h}).`);

  const road = new Int32Array(w * h);
  const occ = new Int32Array(w * h);
  let roadCount = 0;
  let pavedCount = 0;
  for (const r of roads) {
    const i = (r.y - oy) * w + (r.x - ox);
    if (!road[i]) {
      roadCount++;
      if (r.guid === STREET_GUIDS.paved) pavedCount++;
    }
    road[i] = r.guid || STREET_GUIDS.dirt;
  }

  // Gleise (eigene Ebene; zählen nicht als Straße, laufen auch durch Bahnhofsgebäude)
  const rail = new Uint8Array(w * h);
  for (const [x, y] of rails) rail[(y - oy) * w + (x - ox)] = 1;

  let conflicts = 0;
  const buildings: CityBuilding[] = placed.map((p, index) => {
    const x = p.x - ox;
    const y = p.y - oy;
    for (let dy = 0; dy < p.h; dy++) {
      for (let dx = 0; dx < p.w; dx++) {
        const i = (y + dy) * w + x + dx;
        if (road[i]) conflicts++;
        occ[i] = index + 1;
      }
    }
    return {
      index,
      guid: p.guid,
      entry: p.entry,
      x,
      y,
      w: p.w,
      h: p.h,
      turns: p.turns,
      cx: x + (p.w - 1) / 2,
      cy: y + (p.h - 1) / 2,
    };
  });

  return { w, h, buildings, road, occ, roadCount, pavedCount, region: stamp.region, conflicts, rail: rails.length ? rail : undefined };
}

/** Straßenkacheln, die die Grundfläche seitlich (nicht diagonal) berühren. */
export function adjacentRoads(city: City, b: CityBuilding): number[] {
  const out: number[] = [];
  const { w, h, road } = city;
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (road[i]) out.push(i);
  };
  for (let dx = 0; dx < b.w; dx++) {
    push(b.x + dx, b.y - 1);
    push(b.x + dx, b.y + b.h);
  }
  for (let dy = 0; dy < b.h; dy++) {
    push(b.x - 1, b.y + dy);
    push(b.x + b.w, b.y + dy);
  }
  return out;
}

/**
 * Straßenentfernung ab einem Gebäude (Breitensuche wie Anno Designer): Die
 * berührenden Straßenkacheln haben Entfernung 1, jede weitere Kachel +1.
 * Ein Ziel ist versorgt, wenn eine seiner Straßenkacheln Entfernung ≤ Reichweite
 * hat. Ergebnis: Entfernung je Kachel (0 = nicht erreicht).
 */
export class RoadSearch {
  private readonly dist: Int32Array;
  private readonly stamp: Int32Array;
  private gen = 0;
  private readonly queue: Int32Array;

  constructor(private readonly city: City) {
    this.dist = new Int32Array(city.w * city.h);
    this.stamp = new Int32Array(city.w * city.h);
    this.queue = new Int32Array(city.w * city.h);
  }

  run(starts: readonly number[], range: number): void {
    this.gen++;
    const { w, h, road } = this.city;
    let head = 0;
    let tail = 0;
    for (const i of starts) {
      if (this.stamp[i] === this.gen) continue;
      this.stamp[i] = this.gen;
      this.dist[i] = 1;
      this.queue[tail++] = i;
    }
    while (head < tail) {
      const i = this.queue[head++];
      const d = this.dist[i];
      if (d >= range) continue;
      const x = i % w;
      const y = (i - x) / w;
      const visit = (j: number): void => {
        if (!road[j] || this.stamp[j] === this.gen) return;
        this.stamp[j] = this.gen;
        this.dist[j] = d + 1;
        this.queue[tail++] = j;
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
  }

  /** Entfernung der Kachel aus dem letzten Lauf, 0 = nicht erreicht. */
  distance(i: number): number {
    return this.stamp[i] === this.gen ? this.dist[i] : 0;
  }

  /** Kürzeste Entfernung zu einer der Kacheln, 0 = nicht erreicht. */
  reaches(tiles: readonly number[]): number {
    let best = 0;
    for (const i of tiles) {
      const d = this.distance(i);
      if (d && (!best || d < best)) best = d;
    }
    return best;
  }
}
