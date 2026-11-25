// Stempelteile einer Insel gemeinsam zusammensetzen.
//
// Ein Stempel kennt nur Lagen relativ zu seiner eigenen Mitte; die Anordnung
// muss also aus der Form kommen. Information steckt fast nur an der Küste:
// Im Inselinneren ist überall Land, dort passt jede Verschiebung. Deshalb:
//
// 1. Für jedes Paar von Teilen wird jede Verschiebung bewertet, bei der sich
//    die Rechtecke überlappen oder berühren:
//    - Überlappung (per FFT für alle Verschiebungen): gemeinsames Wasser +
//      übereinstimmende Küstenkacheln + 0,02 × gemeinsames Land
//      − 32 × Widersprüche (Land gegen Wasser).
//    - Naht (Kante an Kante, ohne Überlappung): die Randzeilen/-spalten beider
//      Teile müssen zueinander passen (Land, Wasser, gleiche Küstenübergänge).
// 2. Die Gesamtanordnung wird per Strahlsuche (beam search) gesucht: Teile
//    werden nacheinander über ihre besten Paar-Verschiebungen angelegt, und
//    jede Teil-Anordnung wird nach der Summe ALLER Paar-Bewertungen beurteilt.
//    So entscheidet ein Teil mit eindeutiger Küste auch über die Lage zweier
//    anderer Teile, die selbst nur schwach zusammenpassen.

import { fft2d, nextPow2 } from './fft';
import type { IslandPart } from './island';

const MISMATCH = 32;
const LAND = 0.02;
const SEAM_LAND = 0.2;
const SEAM_WATER = 1;
const SEAM_EDGE = 2;
const SEAM_MISMATCH = 3;
/** Strafe je offener Schnittkante (Land am Stempelrand ohne Nachbarteil dahinter). */
const OPEN_CUT = 2;
/** Bonus je Schnittkante, die ein Paar gegenseitig schließt (lenkt die Suche). */
const CLOSED_CUT = 2;

function isTouching(A: IslandPart, B: IslandPart, dx: number, dy: number): boolean {
  const xs = dx < A.w && dx + B.w > 0;
  const ys = dy < A.h && dy + B.h > 0;
  return (xs && (dy === A.h || dy === -B.h)) || (ys && (dx === A.w || dx === -B.w));
}

/**
 * Offene Schnittkanten einer vollständigen Anordnung: Landkacheln am Rand
 * eines Teils, hinter denen kein anderes Teil liegt oder dort Wasser hat. Ein
 * quer durchs Land geschnittener Stempel braucht dort einen Nachbarn.
 */
export function openCuts(parts: readonly IslandPart[], pos: ReadonlyArray<readonly [number, number] | null>): number {
  return openCutsPerPart(parts, pos).reduce((a, c) => a + c.open, 0);
}

/** Offene Schnittkanten je Teil (`open`) und Landkacheln am Rand des Teils (`border`). */
export function openCutsPerPart(
  parts: readonly IslandPart[],
  pos: ReadonlyArray<readonly [number, number] | null>,
): Array<{ open: number; border: number }> {
  const placed = parts.map((p, i) => ({ p, at: pos[i] })).filter((e) => e.at) as Array<{
    p: IslandPart;
    at: readonly [number, number];
  }>;
  const landAt = (gx: number, gy: number, skip: IslandPart): number => {
    // 1 = Land in einem anderen Teil, 0 = Wasser dort, -1 = von keinem Teil erfasst
    let seen = -1;
    for (const { p, at } of placed) {
      if (p === skip) continue;
      const x = gx - at[0];
      const y = gy - at[1];
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
      if (p.mask[y * p.w + x]) return 1;
      seen = 0;
    }
    return seen;
  };
  const out = parts.map(() => ({ open: 0, border: 0 }));
  for (const { p, at } of placed) {
    const c = out[parts.indexOf(p)];
    const edge = (x: number, y: number, ox: number, oy: number): void => {
      if (!p.mask[y * p.w + x]) return;
      c.border++;
      if (landAt(at[0] + x + ox, at[1] + y + oy, p) !== 1) c.open++;
    };
    for (let x = 0; x < p.w; x++) {
      edge(x, 0, 0, -1);
      edge(x, p.h - 1, 0, 1);
    }
    for (let y = 0; y < p.h; y++) {
      edge(0, y, -1, 0);
      edge(p.w - 1, y, 1, 0);
    }
  }
  return out;
}

interface PairMap {
  /** Verschiebung von B relativ zu A: dx ∈ [x0, x0 + w), dy ∈ [y0, y0 + h). */
  x0: number;
  y0: number;
  w: number;
  h: number;
  score: Float32Array;
}

function coastMask(p: IslandPart): Uint8Array {
  const { w, h, mask } = p;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (
        (x > 0 && !mask[i - 1]) ||
        (x < w - 1 && !mask[i + 1]) ||
        (y > 0 && !mask[i - w]) ||
        (y < h - 1 && !mask[i + w])
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}

/** Wasser im Rechteck direkt an der Küste (4er-Nachbar ist Land). */
function shoreWater(p: IslandPart): Uint8Array {
  const { w, h, mask } = p;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) continue;
      if (
        (x > 0 && mask[i - 1]) ||
        (x < w - 1 && mask[i + 1]) ||
        (y > 0 && mask[i - w]) ||
        (y < h - 1 && mask[i + w])
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}

/**
 * Schnittkanten als Maske im um 1 erweiterten Rechteck (Ursprung +1,+1): Für
 * jede Landkachel am Rand die Kachel direkt außerhalb. Landet dort Land eines
 * anderen Teils, ist der Schnitt „geschlossen“.
 */
function cutOutside(p: IslandPart): Uint8Array {
  const W = p.w + 2;
  const out = new Uint8Array(W * (p.h + 2));
  const set = (x: number, y: number): void => {
    out[(y + 1) * W + x + 1] = 1;
  };
  for (let x = 0; x < p.w; x++) {
    if (p.mask[x]) set(x, -1);
    if (p.mask[(p.h - 1) * p.w + x]) set(x, p.h);
  }
  for (let y = 0; y < p.h; y++) {
    if (p.mask[y * p.w]) set(-1, y);
    if (p.mask[y * p.w + p.w - 1]) set(p.w, y);
  }
  return out;
}

function prefix(mask: Uint8Array, w: number, h: number): Int32Array {
  const sw = w + 1;
  const s = new Int32Array(sw * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y + 1) * sw + x + 1;
      s[i] = mask[y * w + x] + s[i - 1] + s[i - sw] - s[i - sw - 1];
    }
  }
  return s;
}

function box(s: Int32Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  const sw = w + 1;
  return s[y1 * sw + x1] - s[y0 * sw + x1] - s[y1 * sw + x0] + s[y0 * sw + x0];
}

/** Korrelation Σ A(x+d)·B(x) für alle d (zyklisch in W×H). Liefert Real-/Imaginärteil. */
function correlate(
  aRe: Uint8Array,
  aIm: Uint8Array | null,
  aw: number,
  ah: number,
  b: Uint8Array,
  bw: number,
  bh: number,
  W: number,
  H: number,
): { re: Float64Array; im: Float64Array } {
  const xr = new Float64Array(W * H);
  const xi = new Float64Array(W * H);
  const yr = new Float64Array(W * H);
  const yi = new Float64Array(W * H);
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      xr[y * W + x] = aRe[y * aw + x];
      if (aIm) xi[y * W + x] = aIm[y * aw + x];
    }
  }
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) yr[y * W + x] = b[y * bw + x];
  fft2d(xr, xi, W, H, false);
  fft2d(yr, yi, W, H, false);
  for (let i = 0; i < W * H; i++) {
    // X · conj(Y)
    const re = xr[i] * yr[i] + xi[i] * yi[i];
    const im = xi[i] * yr[i] - xr[i] * yi[i];
    xr[i] = re;
    xi[i] = im;
  }
  fft2d(xr, xi, W, H, true);
  return { re: xr, im: xi };
}

/** Bewertung aller Verschiebungen von B relativ zu A (Überlappung + Naht). */
export function pairMap(A: IslandPart, B: IslandPart): PairMap {
  const x0 = -B.w;
  const y0 = -B.h;
  const w = A.w + B.w + 1;
  const h = A.h + B.h + 1;
  const score = new Float32Array(w * h);
  const W = nextPow2(A.w + B.w + 4);
  const H = nextPow2(A.h + B.h + 4);
  const coastA = coastMask(A);
  const coastB = coastMask(B);
  const shoreA = shoreWater(A);
  const shoreB = shoreWater(B);
  // re = Σ landA·landB, im = Σ coastA·landB
  const c1 = correlate(A.mask, coastA, A.w, A.h, B.mask, B.w, B.h, W, H);
  // re = Σ landA·coastB, im = Σ shoreA·landB
  const c3 = correlate(A.mask, null, A.w, A.h, coastB, B.w, B.h, W, H);
  const c4 = correlate(shoreA, null, A.w, A.h, B.mask, B.w, B.h, W, H);
  // Σ landA·shoreB
  const c5 = correlate(A.mask, null, A.w, A.h, shoreB, B.w, B.h, W, H);
  // Geschlossene Schnitte: Schnitt von A trifft Land von B und umgekehrt.
  const cutA = correlate(cutOutside(A), null, A.w + 2, A.h + 2, B.mask, B.w, B.h, W, H);
  const cutB = correlate(A.mask, null, A.w, A.h, cutOutside(B), B.w + 2, B.h + 2, W, H);
  const sumA = prefix(A.mask, A.w, A.h);
  const sumB = prefix(B.mask, B.w, B.h);
  const sumShoreA = prefix(shoreA, A.w, A.h);
  const sumShoreB = prefix(shoreB, B.w, B.h);

  for (let dy = y0; dy < y0 + h; dy++) {
    for (let dx = x0; dx < x0 + w; dx++) {
      const ox0 = Math.max(0, dx);
      const ox1 = Math.min(A.w, dx + B.w);
      const oy0 = Math.max(0, dy);
      const oy1 = Math.min(A.h, dy + B.h);
      const k = (dy - y0) * w + (dx - x0);
      const closed =
        Math.round(cutA.re[((dy + 1 + H) % H) * W + ((dx + 1 + W) % W)]) +
        Math.round(cutB.re[((dy - 1 + H) % H) * W + ((dx - 1 + W) % W)]);
      score[k] = CLOSED_CUT * closed;
      if (ox1 > ox0 && oy1 > oy0) {
        const idx = ((dy + H) % H) * W + ((dx + W) % W);
        const match = Math.round(c1.re[idx]);
        const coast = Math.round(c1.im[idx]) + Math.round(c3.re[idx]);
        const aIn = box(sumA, A.w, ox0, oy0, ox1, oy1);
        const bIn = box(sumB, B.w, ox0 - dx, oy0 - dy, ox1 - dx, oy1 - dy);
        // Uferwasser, das im anderen Teil ebenfalls Wasser ist (offenes Meer zählt nicht).
        const shoreAin = box(sumShoreA, A.w, ox0, oy0, ox1, oy1);
        const shoreBin = box(sumShoreB, B.w, ox0 - dx, oy0 - dy, ox1 - dx, oy1 - dy);
        const water = shoreAin - Math.round(c4.re[idx]) + (shoreBin - Math.round(c5.re[idx]));
        const mismatch = aIn + bIn - 2 * match;
        score[k] += water + coast + LAND * match - MISMATCH * mismatch;
      } else {
        const seam = seamScore(A, B, dx, dy);
        // Ohne Kontakt (weder Überlappung noch Naht) gibt es keine Bewertung.
        score[k] = seam === 0 && !isTouching(A, B, dx, dy) ? 0 : score[k] + seam;
      }
    }
  }
  return { x0, y0, w, h, score };
}

/** Naht: Teile berühren sich Kante an Kante. Randzeilen/-spalten vergleichen. */
function seamScore(A: IslandPart, B: IslandPart, dx: number, dy: number): number {
  let a: (t: number) => number;
  let b: (t: number) => number;
  let t0: number;
  let t1: number;
  if ((dy === A.h || dy === -B.h) && dx < A.w && dx + B.w > 0) {
    const ay = dy === A.h ? A.h - 1 : 0;
    const by = dy === A.h ? 0 : B.h - 1;
    t0 = Math.max(0, dx);
    t1 = Math.min(A.w, dx + B.w);
    a = (t) => A.mask[ay * A.w + t];
    b = (t) => B.mask[by * B.w + t - dx];
  } else if ((dx === A.w || dx === -B.w) && dy < A.h && dy + B.h > 0) {
    const ax = dx === A.w ? A.w - 1 : 0;
    const bx = dx === A.w ? 0 : B.w - 1;
    t0 = Math.max(0, dy);
    t1 = Math.min(A.h, dy + B.h);
    a = (t) => A.mask[t * A.w + ax];
    b = (t) => B.mask[(t - dy) * B.w + bx];
  } else {
    return 0;
  }
  let s = 0;
  let land = 0;
  for (let t = t0; t < t1; t++) {
    const va = a(t);
    const vb = b(t);
    if (va === vb) {
      s += va ? SEAM_LAND : SEAM_WATER;
      if (va) land++;
      if (t > t0 && a(t - 1) !== va && b(t - 1) !== vb) s += SEAM_EDGE;
    } else {
      s -= SEAM_MISMATCH;
    }
  }
  // Eine Naht ohne Land auf beiden Seiten ist keine Verbindung.
  return land >= 3 ? s : 0;
}

function lookup(map: PairMap, dx: number, dy: number): number {
  const x = dx - map.x0;
  const y = dy - map.y0;
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return 0;
  return map.score[y * map.w + x];
}

/** Beste Verschiebungen einer Paarbewertung (lokale Maxima, absteigend). */
function topCandidates(map: PairMap, k: number, min: number): Array<{ dx: number; dy: number; s: number }> {
  const out: Array<{ dx: number; dy: number; s: number }> = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const s = map.score[y * map.w + x];
      if (s < min) continue;
      out.push({ dx: x + map.x0, dy: y + map.y0, s });
    }
  }
  out.sort((p, q) => q.s - p.s);
  const top = out.slice(0, k);
  // Schmale Kontakte (Naht oder Überlappung von 1–20 Reihen/Spalten) bekommen
  // je Tiefe und Seite ihren besten Kandidaten – sie haben wenig Küste und
  // gingen unter den tiefen Inland-Überlappungen sonst unter.
  const seen = new Set(top.map((c) => `${c.dx},${c.dy}`));
  const add = (dx: number, dy: number): void => {
    const x = dx - map.x0;
    const y = dy - map.y0;
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return;
    const s = map.score[y * map.w + x];
    if (s < min || seen.has(`${dx},${dy}`)) return;
    seen.add(`${dx},${dy}`);
    top.push({ dx, dy, s });
  };
  const bestOnRow = (dy: number): void => {
    let bx = 0;
    let bs = -Infinity;
    for (let x = 0; x < map.w; x++) {
      const v = map.score[(dy - map.y0) * map.w + x];
      if (v > bs) {
        bs = v;
        bx = x + map.x0;
      }
    }
    if (bs >= min) add(bx, dy);
  };
  const bestOnCol = (dx: number): void => {
    let by = 0;
    let bs = -Infinity;
    for (let y = 0; y < map.h; y++) {
      const v = map.score[y * map.w + (dx - map.x0)];
      if (v > bs) {
        bs = v;
        by = y + map.y0;
      }
    }
    if (bs >= min) add(dx, by);
  };
  // A.w = x0 + w − 1 + ... : rechte Kante von A liegt bei dx = map.x0 + map.w − 1.
  const aw = map.x0 + map.w - 1;
  const ah = map.y0 + map.h - 1;
  for (let d = 0; d <= 20; d++) {
    if (ah - d >= map.y0) bestOnRow(ah - d); // B unter A
    if (map.y0 + d <= ah) bestOnRow(map.y0 + d); // B über A
    if (aw - d >= map.x0) bestOnCol(aw - d); // B rechts von A
    if (map.x0 + d <= aw) bestOnCol(map.x0 + d); // B links von A
  }
  return top;
}

export interface AssembleResult {
  /** Teile ohne passenden Nachbarn (rechts abgelegt). */
  missed: Set<string>;
  /** Teile, deren Lage die Stempel nicht eindeutig hergeben. */
  uncertain: Set<string>;
  /** Je unsicherem Teil: um wie viele Kacheln die Lage gleich gut passt. */
  spread: Map<string, number>;
  /**
   * Platzierte Teile, die an ihrer Stelle kaum zu ihren Nachbarn passen (Summe ihrer
   * Paarbewertungen weit unter ihrem besten Paar) – Hinweis auf eine falsche Anordnung.
   */
  weak: Set<string>;
  score: number;
}

/**
 * Setzt alle Teile zusammen. `fixed`: Teile, die liegen bleiben (z. B. von
 * Hand ausgerichtet); sonst bleibt das größte Teil liegen. Ohne feste Teile ist das Ergebnis
 * unabhängig davon, von welchem Teil die Suche ausgeht. `opts.anchor`/`opts.beam` nur für Tests.
 */
export function assembleParts(parts: IslandPart[], fixed?: ReadonlySet<string>, opts: { anchor?: number; beam?: number } = {}): AssembleResult {
  const n = parts.length;
  const result: AssembleResult = { missed: new Set(), uncertain: new Set(), spread: new Map(), weak: new Set(), score: 0 };
  if (n <= 1) return result;

  // Paarbewertungen (B = j relativ zu A = i, nur i < j; Gegenrichtung gespiegelt).
  const pm: Array<PairMap | null> = new Array(n * n).fill(null);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pm[i * n + j] = pairMap(parts[i], parts[j]);
  const S = (i: number, j: number, dx: number, dy: number): number =>
    i < j ? lookup(pm[i * n + j] as PairMap, dx, dy) : lookup(pm[j * n + i] as PairMap, -dx, -dy);
  const cand: Array<Array<{ dx: number; dy: number; s: number }>> = new Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const m = pm[Math.min(i, j) * n + Math.max(i, j)] as PairMap;
      cand[i * n + j] = topCandidates(m, 24, 4).map((c) => (i < j ? c : { dx: -c.dx, dy: -c.dy, s: c.s }));
    }
  }

  // Strahlsuche über Anordnungen. Doppelte Anordnungen erkennt eine reihenfolgeunabhängige
  // Prüfsumme (Summe je platziertem Teil), neue Zustände entstehen nur für die besten.
  type State = { pos: Array<[number, number] | null>; score: number; hash: number };
  const mix = (i: number, x: number, y: number): number => {
    let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(x | 0, 0x85ebca6b) ^ Math.imul(y | 0, 0xc2b2ae35);
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    return h >>> 0;
  };
  const runBeam = (start: State, BEAM = opts.beam ?? 400): State[] => {
    let beam: State[] = [start];
    for (;;) {
      const index = new Map<number, number>();
      const cs: number[] = [];
      const cj: number[] = [];
      const cx: number[] = [];
      const cy: number[] = [];
      const ct: number[] = [];
      for (let si = 0; si < beam.length; si++) {
        const st = beam[si];
        const placed: number[] = [];
        for (let i = 0; i < n; i++) if (st.pos[i]) placed.push(i);
        for (let j = 0; j < n; j++) {
          if (st.pos[j]) continue;
          for (const i of placed) {
            const [px, py] = st.pos[i] as [number, number];
            for (const c of cand[i * n + j]) {
              const x = px + c.dx;
              const y = py + c.dy;
              let add = 0;
              for (const k of placed) {
                const pk = st.pos[k] as [number, number];
                add += S(k, j, x - pk[0], y - pk[1]);
              }
              const total = st.score + add;
              const h = (st.hash + mix(j, x, y)) >>> 0;
              const prev = index.get(h);
              if (prev === undefined) {
                index.set(h, cs.length);
                cs.push(si);
                cj.push(j);
                cx.push(x);
                cy.push(y);
                ct.push(total);
              } else if (ct[prev] < total) {
                cs[prev] = si;
                cj[prev] = j;
                cx[prev] = x;
                cy[prev] = y;
                ct[prev] = total;
              }
            }
          }
        }
      }
      if (!cs.length) break;
      // Die besten BEAM Kandidaten (Schwelle per Auswahl statt vollständiger Sortierung)
      let keep: number[];
      if (cs.length <= BEAM) keep = cs.map((_, k) => k);
      else {
        const t = kthLargest(Float64Array.from(ct), BEAM);
        keep = [];
        for (let k = 0; k < ct.length && keep.length < BEAM; k++) if (ct[k] > t) keep.push(k);
        for (let k = 0; k < ct.length && keep.length < BEAM; k++) if (ct[k] === t) keep.push(k);
      }
      keep.sort((a, b) => ct[b] - ct[a]);
      beam = keep.map((k) => {
        const st = beam[cs[k]];
        const pos = st.pos.slice();
        pos[cj[k]] = [cx[k], cy[k]];
        return { pos, score: ct[k], hash: (st.hash + mix(cj[k], cx[k], cy[k])) >>> 0 };
      });
    }
    return beam;
  };

  const kept = fixed && fixed.size ? parts.map((p, i) => (fixed.has(p.id) ? i : -1)).filter((i) => i >= 0) : [];
  const startFrom = (anchors: number[]): State => {
    const st: State = { pos: parts.map(() => null), score: 0, hash: 0 };
    for (const i of anchors) {
      st.pos[i] = [parts[i].offsetX, parts[i].offsetY];
      st.hash = (st.hash + mix(i, parts[i].offsetX, parts[i].offsetY)) >>> 0;
    }
    for (const i of anchors) for (const j of anchors) if (i < j) st.score += S(i, j, parts[j].offsetX - parts[i].offsetX, parts[j].offsetY - parts[i].offsetY);
    return st;
  };
  // Endauswahl: Paarbewertung minus offene Schnittkanten (hängt nicht vom Anker ab).
  const finalScore = (st: State): number => st.score - OPEN_CUT * openCuts(parts, st.pos);
  const rank = (states: State[]): Array<{ st: State; placed: number; value: number }> =>
    states
      .map((st) => ({ st, placed: st.pos.filter(Boolean).length, value: finalScore(st) }))
      .sort((a, b) => b.placed - a.placed || b.value - a.value);
  // Größtes Teil: bleibt ohne feste Teile an seiner Stelle (Ursprung stabil).
  let largest = 0;
  for (let i = 1; i < n; i++) if (parts[i].landCount > parts[largest].landCount) largest = i;
  let beam: State[];
  if (kept.length) beam = runBeam(startFrom(kept));
  else if (opts.anchor !== undefined) beam = runBeam(startFrom([opts.anchor]));
  else {
    // Unabhängig vom Ankerteil: schmale Suche von jedem Teil aus (bei sehr vielen Teilen von den
    // 16 mit den stärksten Paarbewertungen), dann volle Suche von den zwei besten Ankern; es gewinnt
    // die Anordnung mit der höchsten Gesamtbewertung. Mit nur einem Anker konnte die Suche an einer
    // Insel mit vielen Streifen-Teilen falsch abbiegen, ohne dass ein Teil als unsicher galt.
    const support = parts.map((_, i) => {
      let t = 0;
      for (let j = 0; j < n; j++) if (j !== i) t += Math.max(0, ...cand[i * n + j].map((c) => c.s));
      return t;
    });
    const anchors = [...parts.keys()].sort((a, b) => support[b] - support[a] || a - b).slice(0, 16);
    const quick = anchors.map((a) => ({ a, best: rank(runBeam(startFrom([a]), 40))[0] }));
    quick.sort((p, q) => q.best.placed - p.best.placed || q.best.value - p.best.value || p.a - q.a);
    const all = quick.map((q) => q.best.st);
    for (const q of quick.slice(0, 2)) all.push(rank(runBeam(startFrom([q.a])))[0].st);
    // Ursprung: größtes Teil auf seine bisherige Lage schieben
    beam = all.map((st) => {
      const at = st.pos[largest];
      if (!at) return st;
      const dx = parts[largest].offsetX - at[0];
      const dy = parts[largest].offsetY - at[1];
      return { ...st, pos: st.pos.map((p) => (p ? ([p[0] + dx, p[1] + dy] as [number, number]) : null)) };
    });
  }
  const ranked = rank(beam);
  const best = ranked[0].st;
  result.score = ranked[0].value;

  // Übernehmen; nicht platzierbare Teile rechts ablegen.
  let maxX = -Infinity;
  let minY = Infinity;
  parts.forEach((p, i) => {
    const pos = best.pos[i];
    if (!pos) return;
    p.offsetX = pos[0];
    p.offsetY = pos[1];
    maxX = Math.max(maxX, pos[0] + p.w);
    minY = Math.min(minY, pos[1]);
  });
  parts.forEach((p, i) => {
    if (best.pos[i]) return;
    p.offsetX = maxX + 2;
    p.offsetY = minY;
    maxX += p.w + 2;
    result.missed.add(p.id);
  });

  // Unsicher: Lässt sich ein Teil um 1–3 Kacheln verschieben, ohne dass die
  // Gesamtbewertung schlechter wird, geben die Stempel die Lage nicht her
  // (z. B. Überlappung nur im Inland, Naht entlang einer schrägen Küste).
  const evaluate = (pos: ReadonlyArray<readonly [number, number] | null>): number => {
    let t = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos[i];
        const b = pos[j];
        if (a && b) t += S(i, j, b[0] - a[0], b[1] - a[1]);
      }
    }
    return t - OPEN_CUT * openCuts(parts, pos);
  };
  const finalPos = parts.map((p, i) => (best.pos[i] ? ([p.offsetX, p.offsetY] as [number, number]) : null));
  const base = evaluate(finalPos);
  // Schwach gestützt: (a) viel Land am Stempelrand ohne Nachbarn dahinter (≥ 30 Kacheln und
  // ≥ 25 % des Land-Rands; richtige Anordnungen liegen bei ≤ 16 %, falsche bei 27–95 %, gemessen
  // an Crown Falls), oder (b) Summe der Paarbewertungen unter 25 % des besten Paars dieses Teils.
  const cuts = openCutsPerPart(parts, finalPos);
  cuts.forEach((c, i) => {
    if (finalPos[i] && c.open >= 30 && c.open >= 0.25 * c.border) result.weak.add(parts[i].id);
  });
  parts.forEach((p, i) => {
    const a = finalPos[i];
    if (!a) return;
    let have = 0;
    let bestPair = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      bestPair = Math.max(bestPair, ...cand[i * n + j].map((c) => c.s));
      const b = finalPos[j];
      if (b) have += S(i, j, b[0] - a[0], b[1] - a[1]);
    }
    if (bestPair >= 20 && have < 0.25 * bestPair) result.weak.add(p.id);
  });
  parts.forEach((p, i) => {
    if (!finalPos[i] || (fixed && fixed.has(p.id))) return;
    let spread = 0;
    for (let d = 1; d <= 3; d++) {
      for (const [ox, oy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
        const trial = finalPos.slice();
        trial[i] = [p.offsetX + ox, p.offsetY + oy];
        if (evaluate(trial) >= base - 1) spread = Math.max(spread, d);
      }
    }
    if (spread > 0) {
      result.uncertain.add(p.id);
      result.spread.set(p.id, spread);
      // In die Mitte des gleich guten Bereichs legen (unabhängig von der Reihenfolge).
      const centre = (axis: 0 | 1): number => {
        const ok: number[] = [];
        for (let d = -3; d <= 3; d++) {
          const trial = finalPos.slice();
          const cur = finalPos[i] as [number, number];
          trial[i] = axis === 0 ? [cur[0] + d, cur[1]] : [cur[0], cur[1] + d];
          if (evaluate(trial) >= base - 1) ok.push(d);
        }
        return ok.length ? ok[Math.floor((ok.length - 1) / 2)] : 0;
      };
      const mx = centre(0);
      const my = centre(1);
      p.offsetX += mx;
      p.offsetY += my;
      finalPos[i] = [p.offsetX, p.offsetY];
    }
  });

  // Ursprung stabil halten: wenn nichts fest war, Anker bleibt (0,0)-nah.
  return result;
}

/** k-größter Wert (1 = Maximum) per Quickselect; verändert das Feld. */
function kthLargest(a: Float64Array, k: number): number {
  let lo = 0;
  let hi = a.length - 1;
  const target = k - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] > pivot) i++;
      while (a[j] < pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (target <= j) hi = j;
    else if (target >= i) lo = i;
    else break;
  }
  return a[target];
}

