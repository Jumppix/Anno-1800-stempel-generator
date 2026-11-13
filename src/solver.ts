export const SIZE = 4;
export const RADIUS = 15;
export const DX = 30;
export const DY = 26;

export interface Chamber {
  x: number;
  y: number;
  row: number;
  col: number;
}

export interface Layout {
  w: number;
  h: number;
  chambers: Chamber[];
  covered: Uint8Array;
  coveredCount: number;
  landCount: number;
  offsetX: number;
  offsetY: number;
}

export interface LandMask {
  w: number;
  h: number;
  data: Uint8Array;
  landCount: number;
}

const DISK: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let dx = -17; dx <= 19; dx++) {
    for (let dy = -17; dy <= 19; dy++) {
      const px = dx - 1.5;
      const py = dy - 1.5;
      if (px * px + py * py <= RADIUS * RADIUS + 1e-9) out.push([dx, dy]);
    }
  }
  return out;
})();

function footprintLand(mask: LandMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x + SIZE > mask.w || y + SIZE > mask.h) return false;
  for (let dy = 0; dy < SIZE; dy++) {
    const row = (y + dy) * mask.w + x;
    for (let dx = 0; dx < SIZE; dx++) {
      if (!mask.data[row + dx]) return false;
    }
  }
  return true;
}

function generate(w: number, h: number, ox: number, oy: number, mask?: LandMask): Chamber[] {
  const out: Chamber[] = [];
  for (let row = 0; ; row++) {
    const y = oy + row * DY;
    if (y + SIZE > h) break;
    const shift = (row & 1) * 15;
    for (let col = 0; ; col++) {
      const x = ox + shift + col * DX;
      if (x + SIZE > w) break;
      if (x >= 0 && y >= 0 && (!mask || footprintLand(mask, x, y))) {
        out.push({ x, y, row, col });
      }
    }
  }
  return out;
}

function coverageOf(ch: Chamber, w: number, h: number, mask?: LandMask): number {
  let n = 0;
  for (let i = 0; i < DISK.length; i++) {
    const x = ch.x + DISK[i][0];
    const y = ch.y + DISK[i][1];
    if (x >= 0 && y >= 0 && x < w && y < h) {
      if (!mask || mask.data[y * w + x]) n++;
    }
  }
  return n;
}

const MIN_DISTANCE_SQ = (RADIUS * 2) ** 2;

function overlapsAny(
  candidate: { x: number; y: number },
  chambers: readonly { x: number; y: number }[],
): boolean {
  for (const chamber of chambers) {
    const dx = candidate.x - chamber.x;
    const dy = candidate.y - chamber.y;
    // The chamber centres are always offset by the same 1.5 tiles, so the
    // top-left distance is also the centre distance. A distance below 30
    // would make the two 15-tile radii overlap.
    if (dx * dx + dy * dy < MIN_DISTANCE_SQ) return true;
  }
  return false;
}

interface GapCandidate {
  x: number;
  y: number;
  coverage: number;
}

// The hex lattice is excellent for the interior, but its fixed origin leaves
// usable pockets near irregular coastlines empty. This is a general set-packing
// pass on top of the lattice: every legal 4x4 footprint is a candidate, and a
// candidate is only accepted if its 15-tile radius touches no existing one.
function fillGaps(
  w: number,
  h: number,
  mask: LandMask,
  base: readonly Chamber[],
): Chamber[] {
  const candidates: GapCandidate[] = [];
  for (let y = 0; y + SIZE <= h; y++) {
    for (let x = 0; x + SIZE <= w; x++) {
      if (!footprintLand(mask, x, y)) continue;
      const candidate = { x, y, row: 0, col: 0 };
      if (overlapsAny(candidate, base)) continue;
      candidates.push({ x, y, coverage: coverageOf(candidate, w, h, mask) });
    }
  }
  if (candidates.length === 0) return [...base];

  const score = (picked: readonly GapCandidate[]): number =>
    picked.reduce((sum, candidate) => sum + candidate.coverage, 0);

  const greedy = (order: readonly GapCandidate[]): GapCandidate[] => {
    const picked: GapCandidate[] = [];
    for (const candidate of order) {
      if (!overlapsAny(candidate, picked)) picked.push(candidate);
    }
    return picked;
  };

  // Different sweeps can end in different local optima around a jagged coast.
  // Keep the one that covers the most additional land.
  const orders: Array<readonly GapCandidate[]> = [
    [...candidates].sort((a, b) => b.coverage - a.coverage || a.y - b.y || a.x - b.x),
    [...candidates].sort((a, b) => a.y - b.y || a.x - b.x),
    [...candidates].sort((a, b) => b.y - a.y || b.x - a.x),
    [...candidates].sort((a, b) => a.x - b.x || a.y - b.y),
    [...candidates].sort((a, b) => b.x - a.x || b.y - a.y),
  ];

  let best: GapCandidate[] = [];
  let bestScore = -1;
  for (const order of orders) {
    const picked = greedy(order);
    const pickedScore = score(picked);
    if (pickedScore > bestScore || (pickedScore === bestScore && picked.length > best.length)) {
      best = picked;
      bestScore = pickedScore;
    }
  }

  // Small local improvement: replace one picked candidate by a conflicting
  // candidate when that increases the covered land. This catches pockets that
  // a particular greedy order happened to block.
  let changed = true;
  let rounds = 0;
  while (changed && rounds < 6) {
    changed = false;
    rounds++;
    for (const candidate of candidates) {
      if (best.includes(candidate)) continue;
      const conflicts = best.filter((picked) => overlapsAny(candidate, [picked]));
      if (conflicts.length === 0) {
        best.push(candidate);
        bestScore += candidate.coverage;
        changed = true;
        continue;
      }
      if (conflicts.length === 1) {
        const replaced = conflicts[0];
        const nextScore = bestScore - replaced.coverage + candidate.coverage;
        if (nextScore > bestScore) {
          best = best.filter((picked) => picked !== replaced);
          best.push(candidate);
          bestScore = nextScore;
          changed = true;
        }
      }
    }
  }

  return [
    ...base,
    ...best.map((candidate) => ({
      x: candidate.x,
      y: candidate.y,
      row: Math.floor(candidate.y / DY),
      col: Math.floor(candidate.x / DX),
    })),
  ];
}

export function solve(w: number, h: number, mask?: LandMask): Layout {
  let bestOx = 0;
  let bestOy = 0;
  let bestChambers: Chamber[] = [];
  let bestCov = -1;
  let bestCount = -1;

  const consider = (ox: number, oy: number): void => {
    const chambers = generate(w, h, ox, oy, mask);
    let cov = 0;
    for (const c of chambers) cov += coverageOf(c, w, h, mask);
    const count = chambers.length;
    if (count > bestCount || (count === bestCount && cov > bestCov)) {
      bestOx = ox;
      bestOy = oy;
      bestChambers = chambers;
      bestCov = cov;
      bestCount = count;
    }
  };

  for (let ox = 0; ox < 30; ox += 5) {
    for (let oy = 0; oy < 26; oy += 5) consider(ox, oy);
  }

  const cx = bestOx;
  const cy = bestOy;
  for (let ox = Math.max(0, cx - 5); ox <= Math.min(29, cx + 5); ox++) {
    for (let oy = Math.max(0, cy - 5); oy <= Math.min(25, cy + 5); oy++) {
      consider(ox, oy);
    }
  }

  if (mask) {
    bestChambers = fillGaps(w, h, mask, bestChambers);
  }

  const covered = new Uint8Array(w * h);
  let coveredCount = 0;
  for (const c of bestChambers) {
    for (const [dx, dy] of DISK) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (x >= 0 && y >= 0 && x < w && y < h) {
        const idx = y * w + x;
        if (mask && !mask.data[idx]) continue;
        if (!covered[idx]) {
          covered[idx] = 1;
          coveredCount++;
        }
      }
    }
  }

  return {
    w,
    h,
    chambers: bestChambers,
    covered,
    coveredCount,
    landCount: mask ? mask.landCount : w * h,
    offsetX: bestOx,
    offsetY: bestOy,
  };
}

export interface Chunk {
  chambers: Chamber[];
  index: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  offsetX: number;
  offsetY: number;
}

export function splitChunks(layout: Layout, maxArea = 13500): Chunk[] {
  const chambers = layout.chambers;
  if (chambers.length === 0) return [];

  const globalMinX = Math.min(...chambers.map((c) => c.x));
  const globalMaxX = Math.max(...chambers.map((c) => c.x + SIZE));
  const globalMinY = Math.min(...chambers.map((c) => c.y));
  const fullWidth = globalMaxX - globalMinX;

  const minRow = Math.min(...chambers.map((c) => c.row));
  const maxRow = Math.max(...chambers.map((c) => c.row));

  let rowsPerStamp = 1;
  for (let r = 1; r <= maxRow - minRow + 1; r++) {
    const height = (r - 1) * DY + SIZE;
    if (fullWidth * height <= maxArea) rowsPerStamp = r;
    else break;
  }

  const out: Chunk[] = [];
  for (let start = minRow; start <= maxRow; start += rowsPerStamp) {
    const group = chambers.filter((c) => c.row >= start && c.row < start + rowsPerStamp);
    if (group.length === 0) continue;
    const minX = Math.min(...group.map((c) => c.x));
    const maxX = Math.max(...group.map((c) => c.x + SIZE));
    const minY = Math.min(...group.map((c) => c.y));
    const maxY = Math.max(...group.map((c) => c.y + SIZE));
    out.push({
      chambers: group,
      index: out.length,
      minX,
      minY,
      maxX,
      maxY,
      area: (maxX - minX) * (maxY - minY),
      offsetX: minX - globalMinX,
      offsetY: minY - globalMinY,
    });
  }
  return out;
}
