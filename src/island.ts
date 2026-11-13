import type { LandMask } from './solver';

export interface IslandPart {
  id: string;
  name: string;
  w: number;
  h: number;
  mask: Uint8Array;
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

export function combineParts(parts: readonly IslandPart[]): CombinedMask | null {
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
  let landCount = 0;

  for (const part of parts) {
    const ox = part.offsetX - minX;
    const oy = part.offsetY - minY;
    for (let y = 0; y < part.h; y++) {
      const srcRow = y * part.w;
      const dstRow = (oy + y) * w + ox;
      for (let x = 0; x < part.w; x++) {
        if (!part.mask[srcRow + x]) continue;
        const idx = dstRow + x;
        if (!data[idx]) {
          data[idx] = 1;
          landCount++;
        }
      }
    }
  }

  return { w, h, data, landCount, minX, minY };
}

export function overlapCount(parts: readonly IslandPart[], part: IslandPart): number {
  const union = combineParts(parts.filter((candidate) => candidate.id !== part.id));
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

// Aligns one part to the already placed parts by maximising the agreement of
// the road masks. Coastline/water mismatches are penalised more than matching
// road tiles are rewarded, so dense road grids do not dominate the score.
export function alignPartTo(
  part: IslandPart,
  others: readonly IslandPart[],
  radius = 40,
): AlignResult {
  const union = combineParts(others);
  if (!union) return { score: 0, overlap: 0 };

  let best = {
    score: -Infinity,
    x: part.offsetX,
    y: part.offsetY,
    overlap: 0,
  };

  const evaluate = (ox: number, oy: number): void => {
    let score = 0;
    let overlap = 0;

    const x0 = Math.max(ox, union.minX);
    const y0 = Math.max(oy, union.minY);
    const x1 = Math.min(ox + part.w, union.minX + union.w);
    const y1 = Math.min(oy + part.h, union.minY + union.h);

    for (let gy = y0; gy < y1; gy++) {
      const uy = gy - union.minY;
      const py = gy - oy;
      for (let gx = x0; gx < x1; gx++) {
        const p = part.mask[py * part.w + gx - ox];
        const u = union.data[uy * union.w + gx - union.minX];
        if (p && u) {
          score += 2;
          overlap++;
        } else if (p !== u) {
          // A wrong coastline is far more informative than dense interior
          // road/road matches, so a single mismatch outweighs many matches.
          score -= 100;
        }
      }
    }

    if (score > best.score) best = { score, x: ox, y: oy, overlap };
  };

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      evaluate(part.offsetX + dx, part.offsetY + dy);
    }
  }

  part.offsetX = best.x;
  part.offsetY = best.y;
  return { score: best.score, overlap: best.overlap };
}

export function alignPart(parts: readonly IslandPart[], part: IslandPart): AlignResult {
  const others = parts.filter((candidate) => candidate.id !== part.id);
  const result = alignPartTo(part, others);
  if (result.score >= 0 || others.length === 0) return result;

  // A very negative score means the current position has no usable overlap.
  // Try the usual right/below placements before keeping the local result.
  const localX = part.offsetX;
  const localY = part.offsetY;
  const placed = autoPlace(others, part);
  if (placed.score > result.score) return placed;
  part.offsetX = localX;
  part.offsetY = localY;
  return result;
}

// Places a freshly imported part near the existing island and aligns it from
// there. Trying a position to the right and one below covers the usual way a
// large island is cut into overlapping pieces.
export function autoPlace(
  parts: readonly IslandPart[],
  part: IslandPart,
  radius = 40,
): AlignResult {
  if (parts.length === 0) {
    part.offsetX = 0;
    part.offsetY = 0;
    return { score: 0, overlap: 0 };
  }

  const union = combineParts(parts);
  if (!union) {
    part.offsetX = 0;
    part.offsetY = 0;
    return { score: 0, overlap: 0 };
  }

  const overlapX = Math.min(15, Math.max(1, part.w - 1));
  const overlapY = Math.min(15, Math.max(1, part.h - 1));
  const candidates = [
    { x: union.minX + union.w - overlapX, y: union.minY },
    { x: union.minX, y: union.minY + union.h - overlapY },
    { x: union.minX - part.w + overlapX, y: union.minY },
    { x: union.minX, y: union.minY - part.h + overlapY },
  ];

  let best: { score: number; overlap: number; x: number; y: number } = {
    score: -Infinity,
    overlap: 0,
    x: candidates[0].x,
    y: candidates[0].y,
  };

  for (const candidate of candidates) {
    part.offsetX = candidate.x;
    part.offsetY = candidate.y;
    const result = alignPartTo(part, parts, radius);
    if (result.score > best.score) {
      best = { ...result, x: part.offsetX, y: part.offsetY };
    }
  }

  part.offsetX = best.x;
  part.offsetY = best.y;
  return { score: best.score, overlap: best.overlap };
}
