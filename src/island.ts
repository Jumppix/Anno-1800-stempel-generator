import { fft2d, nextPow2 } from './fft';
import type { LandMask } from './solver';
import { partBuilding, type IslandBuilding } from './deposits';

export interface IslandPart {
  id: string;
  name: string;
  w: number;
  h: number;
  /** Alle Straßenkacheln (Land + Hafengebiet), zum Ausrichten. */
  mask: Uint8Array;
  /** Hafengebiet (Kaistraße/Kaimauer/Kai), kein Bauland für die Stadt. */
  harbor?: Uint8Array;
  /** Gebäude im Stempel (Minen, Lehmgruben, Bohrtürme …), Mittelpunkt relativ zur Teilmaske. */
  buildings?: Array<{ guid: number; cx: number; cy: number; dir: number }>;
  /** Straßenkacheln des Teils (Land + Hafengebiet; Anker beim Ausrichten). */
  landCount: number;
  offsetX: number;
  offsetY: number;
  color: string;
  region: number | null;
  streetGuid: number | null;
}

export interface CombinedMask extends LandMask {
  minX: number;
  minY: number;
  /** Hafengebiet (1 = Kaistraße/Kaimauer/Kai, kein Land), falls vorhanden. */
  harbor?: Uint8Array;
  harborCount?: number;
  /** Gebäude aus den Stempeln (doppelte aus überlappenden Teilen entfernt), Maskenkoordinaten. */
  buildings?: IslandBuilding[];
}

export interface AlignResult {
  score: number;
  overlap: number;
}

export const PART_COLORS = [
  '#e2b25f',
  '#6fb3d6',
  '#cf7d8e',
  '#8cc07a',
  '#b394d6',
  '#dd925f',
  '#5fc3b2',
  '#d8d06a',
];

/**
 * Teile zu einer Insel zusammenfügen. `data` = Land (ohne Hafengebiet, wo es kein anderes Teil
 * als Land führt); mit `all` alle Straßenkacheln (zum Ausrichten).
 */
export function combineParts(parts: readonly IslandPart[], all = false): CombinedMask | null {
  if (parts.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    minX = Math.min(minX, part.offsetX);
    minY = Math.min(minY, part.offsetY);
    maxX = Math.max(maxX, part.offsetX + part.w);
    maxY = Math.max(maxY, part.offsetY + part.h);
  }

  const w = maxX - minX;
  const h = maxY - minY;
  const data = new Uint8Array(w * h);
  const port = new Uint8Array(w * h);
  let landCount = 0;
  let any = false;

  for (const part of parts) {
    const ox = part.offsetX - minX;
    const oy = part.offsetY - minY;
    for (let y = 0; y < part.h; y++) {
      const srcRow = y * part.w;
      const dstRow = (oy + y) * w + ox;
      for (let x = 0; x < part.w; x++) {
        if (!part.mask[srcRow + x]) continue;
        const idx = dstRow + x;
        if (!all && part.harbor?.[srcRow + x]) {
          port[idx] = 1;
          any = true;
          continue;
        }
        if (!data[idx]) {
          data[idx] = 1;
          landCount++;
        }
      }
    }
  }
  // Gebäude aus den Stempeln: doppelte (überlappende Teile) entfernen. Unter verschiebbaren
  // Vorkommen (Lehmgrube, Bohrturm) und der Raffinerie ist Bauland; Minen bleiben gesperrt.
  const seen = new Set<string>();
  const buildings: IslandBuilding[] = [];
  for (const part of parts) {
    for (const raw of part.buildings ?? []) {
      const b = partBuilding(raw);
      b.x += part.offsetX - minX;
      b.y += part.offsetY - minY;
      const key = `${b.guid},${b.x},${b.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      buildings.push(b);
    }
  }
  if (!all) {
    for (const b of buildings) {
      if (b.kind !== 'clay' && b.kind !== 'oil' && b.kind !== 'refinery') continue;
      for (let y = b.y; y < b.y + b.h; y++) {
        for (let x = b.x; x < b.x + b.w; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = y * w + x;
          if (!data[i] && !port[i]) {
            data[i] = 1;
            landCount++;
          }
        }
      }
    }
  }
  const extra = buildings.length ? { buildings } : {};
  if (!any) return { w, h, data, landCount, minX, minY, ...extra };
  // Was ein anderes Teil als Land führt, ist Land.
  let harborCount = 0;
  for (let i = 0; i < port.length; i++) {
    if (data[i]) port[i] = 0;
    else if (port[i]) harborCount++;
  }
  return { w, h, data, landCount, minX, minY, harbor: port, harborCount, ...extra };
}

export function overlapCount(parts: readonly IslandPart[], part: IslandPart): number {
  const union = combineParts(parts.filter((candidate) => candidate.id !== part.id), true);
  if (!union) return 0;

  let n = 0;
  for (let y = 0; y < part.h; y++) {
    const gy = part.offsetY + y;
    if (gy < union.minY || gy >= union.minY + union.h) continue;
    const uy = gy - union.minY;
    for (let x = 0; x < part.w; x++) {
      if (!part.mask[y * part.w + x]) continue;
      const gx = part.offsetX + x;
      if (gx < union.minX || gx >= union.minX + union.w) continue;
      if (union.data[uy * union.w + gx - union.minX]) n++;
    }
  }
  return n;
}

// Statistik einer Verschiebung des neuen Teils gegenüber den platzierten:
// Kacheln mit Straße in beiden (`match`), Kacheln, die in beiden Stempeln
// erfasst, aber in keinem Straße sind (`water`), und Widersprüche (`mismatch`).
export interface OffsetStats {
  x: number;
  y: number;
  match: number;
  water: number;
  mismatch: number;
}

export interface AlignOptions {
  // Nur Verschiebungen höchstens so weit von der aktuellen Lage prüfen.
  radius?: number;
  // Mindestanzahl gemeinsamer Straßenkacheln für eine gültige Überlappung.
  minOverlap?: number;
}

// Ein Stempel enthält nur Straßen innerhalb seines Auswahlrechtecks. Außerhalb
// davon weiß er nichts über das Land, also zählen Widersprüche nur dort, wo
// beide Teile Daten haben: im Rechteck des neuen Teils und in der Vereinigung
// der Rechtecke der platzierten Teile. Ein Widerspruch wiegt so schwer, dass
// eine falsche Küstenlinie nicht durch viel gemeinsames Inland aufgewogen wird.
const MISMATCH_WEIGHT = 32;

function scoreOf(s: OffsetStats): number {
  return s.match + s.water - MISMATCH_WEIGHT * s.mismatch;
}

// Prüft per FFT-Kreuzkorrelation alle Verschiebungen, bei denen sich das neue
// Teil mit den platzierten überlappt, und ruft `visit` für jede auf.
export function scanOffsets(
  part: IslandPart,
  others: readonly IslandPart[],
  visit: (stats: OffsetStats) => void,
): void {
  const union = combineParts(others);
  if (!union) return;

  const uw = union.w;
  const uh = union.h;
  const pw = part.w;
  const ph = part.h;

  // Abdeckung: Kacheln innerhalb des Rechtecks mindestens eines Teils.
  const cover = new Uint8Array(uw * uh);
  for (const other of others) {
    const ox = other.offsetX - union.minX;
    const oy = other.offsetY - union.minY;
    for (let y = 0; y < other.h; y++) cover.fill(1, (oy + y) * uw + ox, (oy + y) * uw + ox + other.w);
  }

  // Korrelation von (Straße + i·Abdeckung) der Vereinigung mit der Straße des
  // neuen Teils liefert in einem Durchgang Real- und Imaginärteil.
  const W = nextPow2(uw + pw - 1);
  const H = nextPow2(uh + ph - 1);
  const aRe = new Float64Array(W * H);
  const aIm = new Float64Array(W * H);
  const bRe = new Float64Array(W * H);
  const bIm = new Float64Array(W * H);
  for (let y = 0; y < uh; y++) {
    for (let x = 0; x < uw; x++) {
      aRe[y * W + x] = union.data[y * uw + x];
      aIm[y * W + x] = cover[y * uw + x];
    }
  }
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) bRe[y * W + x] = part.mask[y * pw + x];
  }
  fft2d(aRe, aIm, W, H, false);
  fft2d(bRe, bIm, W, H, false);
  for (let i = 0; i < W * H; i++) {
    const re = aRe[i] * bRe[i] + aIm[i] * bIm[i];
    const im = aIm[i] * bRe[i] - aRe[i] * bIm[i];
    aRe[i] = re;
    aIm[i] = im;
  }
  fft2d(aRe, aIm, W, H, true);

  // Präfixsummen für Straße und Abdeckung der Vereinigung (Rechteckssummen).
  const sw = uw + 1;
  const roadSum = new Int32Array(sw * (uh + 1));
  const coverSum = new Int32Array(sw * (uh + 1));
  for (let y = 0; y < uh; y++) {
    for (let x = 0; x < uw; x++) {
      const i = (y + 1) * sw + x + 1;
      roadSum[i] = union.data[y * uw + x] + roadSum[i - 1] + roadSum[i - sw] - roadSum[i - sw - 1];
      coverSum[i] = cover[y * uw + x] + coverSum[i - 1] + coverSum[i - sw] - coverSum[i - sw - 1];
    }
  }

  for (let dy = 1 - ph; dy < uh; dy++) {
    const y0 = Math.max(dy, 0);
    const y1 = Math.min(dy + ph, uh);
    const row = ((dy + H) % H) * W;
    for (let dx = 1 - pw; dx < uw; dx++) {
      const x0 = Math.max(dx, 0);
      const x1 = Math.min(dx + pw, uw);
      const box = (sum: Int32Array): number =>
        sum[y1 * sw + x1] - sum[y0 * sw + x1] - sum[y1 * sw + x0] + sum[y0 * sw + x0];

      const idx = row + ((dx + W) % W);
      const match = Math.round(aRe[idx]);
      // Straßen des neuen Teils in erfassten Kacheln / Straßen der Vereinigung
      // im Rechteck des neuen Teils / erfasste Kacheln im Rechteck.
      const partInCover = Math.round(aIm[idx]);
      const unionInPart = box(roadSum);
      const covered = box(coverSum);

      visit({
        x: union.minX + dx,
        y: union.minY + dy,
        match,
        water: covered - unionInPart - partInCover + match,
        mismatch: unionInPart - match + (partInCover - match),
      });
    }
  }
}

// Richtet ein Teil an den bereits platzierten Teilen aus, indem alle
// überlappenden Verschiebungen bewertet werden. Gleich gute Lagen werden
// zugunsten der aktuellen Position entschieden.
export function alignPartTo(
  part: IslandPart,
  others: readonly IslandPart[],
  options: AlignOptions = {},
): AlignResult {
  const radius = options.radius ?? Infinity;
  const minOverlap = options.minOverlap ?? Math.min(20, Math.ceil(part.landCount / 4));
  const startX = part.offsetX;
  const startY = part.offsetY;

  let best: { score: number; dist: number; x: number; y: number; overlap: number } | null = null;
  scanOffsets(part, others, (s) => {
    if (s.match < minOverlap) return;
    if (Math.abs(s.x - startX) > radius || Math.abs(s.y - startY) > radius) return;
    const score = scoreOf(s);
    const dist = Math.abs(s.x - startX) + Math.abs(s.y - startY);
    if (!best || score > best.score || (score === best.score && dist < best.dist)) {
      best = { score, dist, x: s.x, y: s.y, overlap: s.match };
    }
  });

  if (!best) return { score: 0, overlap: 0 };
  const found: { score: number; x: number; y: number; overlap: number } = best;
  part.offsetX = found.x;
  part.offsetY = found.y;
  return { score: found.score, overlap: found.overlap };
}

export function alignPart(parts: readonly IslandPart[], part: IslandPart): AlignResult {
  const others = parts.filter((candidate) => candidate.id !== part.id);
  return alignPartTo(part, others);
}

// Setzt ein frisch importiertes Teil an die beste Stelle der bisherigen Insel.
// Ohne passende Überlappung landet es rechts neben der Insel.
export function autoPlace(parts: readonly IslandPart[], part: IslandPart): AlignResult {
  const union = combineParts(parts);
  if (!union) {
    part.offsetX = 0;
    part.offsetY = 0;
    return { score: 0, overlap: 0 };
  }

  part.offsetX = union.minX + union.w + 2;
  part.offsetY = union.minY;
  return alignPartTo(part, parts);
}

/**
 * Richtet alle Teile unabhängig von der Ladereihenfolge aus: Das größte Teil
 * bleibt liegen; danach kommt jeweils das Teil, das am besten (höchste
 * Bewertung) zur bisherigen Insel passt, an seine beste Stelle. So findet auch
 * ein Teil, das vor seinen echten Nachbarn geladen wurde, seine Lage. Teile
 * ohne Überlappung landen rechts neben der Insel. Liefert die IDs der Teile
 * ohne Überlappung.
 */
export function alignAllParts(parts: IslandPart[], fixed?: ReadonlySet<string>): Set<string> {
  const missed = new Set<string>();
  if (parts.length === 0) return missed;
  const kept = fixed && fixed.size ? parts.filter((p) => fixed.has(p.id)) : [];
  const anchor = kept[0] ?? parts.reduce((a, b) => (b.landCount > a.landCount ? b : a));
  const placed: IslandPart[] = kept.length ? [...kept] : [anchor];
  const rest = parts.filter((p) => !placed.includes(p));
  while (rest.length) {
    let best: { part: IslandPart; x: number; y: number; score: number; overlap: number } | null = null;
    for (const part of rest) {
      const keepX = part.offsetX;
      const keepY = part.offsetY;
      const result = alignPartTo(part, placed);
      if (result.overlap > 0 && (!best || result.score > best.score)) {
        best = { part, x: part.offsetX, y: part.offsetY, score: result.score, overlap: result.overlap };
      }
      part.offsetX = keepX;
      part.offsetY = keepY;
    }
    if (!best) {
      // Kein Teil passt mehr: übrige nebeneinander rechts ablegen.
      let union = combineParts(placed);
      for (const part of rest) {
        part.offsetX = union ? union.minX + union.w + 2 : 0;
        part.offsetY = union ? union.minY : 0;
        missed.add(part.id);
        placed.push(part);
        union = combineParts(placed);
      }
      break;
    }
    best.part.offsetX = best.x;
    best.part.offsetY = best.y;
    placed.push(best.part);
    rest.splice(rest.indexOf(best.part), 1);
  }
  if (kept.length) return missed;
  // Ursprung auf das Ankerteil legen (stabile Anzeige).
  const dx = anchor.offsetX;
  const dy = anchor.offsetY;
  for (const p of parts) {
    p.offsetX -= dx;
    p.offsetY -= dy;
  }
  return missed;
}
