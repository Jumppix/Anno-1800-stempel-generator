import { BUILDINGS, type BuildingId, type BuildingSpec } from './buildings';

// ---------------------------------------------------------------------------
// Problem
//
// Jede Position (x, y), an der die 4×4-Fläche vollständig auf Land liegt, ist
// ein Kandidat. Zwei Gebäude gleichen Typs stehen im Konflikt, wenn sich ihre
// Einflusskreise schneiden, d. h. wenn der Mittelpunktabstand < 2·Radius ist
// (Abstand genau 2·Radius = Berührung, erlaubt). Gesucht ist also eine
// maximale unabhängige Menge im Konfliktgraphen (Unit-Disk-Graph) – NP-schwer.
//
// Ziel lexikographisch: 1. möglichst viele Gebäude, 2. möglichst viele
// Landkacheln im Radius. Da sich die Kreise nicht überschneiden, ist die
// Abdeckung einfach die Summe der Einzelabdeckungen.
//
// Verfahren:
//  1. Startlösungen aus hexagonalen Gittern in vielen Drehwinkeln und
//     Verschiebungen (das alte Verfahren war genau ein Gitter + Lückenfüllung).
//  2. Iterated Local Search nach Andrade/Resende/Werneck (2012) für Maximum
//     Independent Set: (1,2)-Tausch (ein Gebäude raus, zwei rein) als lokale
//     Suche, Störung durch erzwungenes Einsetzen + gieriges Auffüllen.
//  3. Abdeckungs-Politur: Gebäude einzeln an die beste konfliktfreie Position
//     verschieben, mit zufälligen Stößen gegen lokale Optima.
// ---------------------------------------------------------------------------

export interface LandMask {
  w: number;
  h: number;
  data: Uint8Array;
  landCount: number;
}

export interface Chamber {
  x: number;
  y: number;
  type: BuildingId;
}

export interface Group {
  type: BuildingId;
  chambers: Chamber[];
  covered: Uint8Array;
  coveredCount: number;
}

export interface Layout {
  w: number;
  h: number;
  landCount: number;
  groups: Group[];
  chambers: Chamber[];
}

export interface SolveOptions {
  /** Rechenzeit in Millisekunden für alle Gebäudetypen zusammen. */
  budgetMs?: number;
  seed?: number;
  /** Wird bei jeder Verbesserung (gedrosselt) mit dem Zwischenstand aufgerufen. */
  onProgress?: (layout: Layout) => void;
  /** Startlösungen je Typ (z. B. aus einem vorherigen Lauf), werden mitbewertet. */
  warmStart?: Partial<Record<BuildingId, ReadonlyArray<{ x: number; y: number }>>>;
  /** Bereits gesetzte Gebäude anderer Typen: ihre Flächen sind belegt. */
  blocked?: ReadonlyArray<Chamber>;
}

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** Kacheln im Einflusskreis relativ zur linken oberen Ecke des Gebäudes. */
export function diskOffsets(spec: BuildingSpec): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const r = spec.radius;
  const c = spec.size / 2 - 0.5;
  for (let dy = -r - spec.size; dy <= r + spec.size; dy++) {
    for (let dx = -r - spec.size; dx <= r + spec.size; dx++) {
      const px = dx - c;
      const py = dy - c;
      if (px * px + py * py <= r * r + 1e-9) out.push([dx, dy]);
    }
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Snapshot {
  sol: Int32Array;
  count: number;
  cov: number;
}

const better = (a: { count: number; cov: number }, b: { count: number; cov: number }): boolean =>
  a.count > b.count || (a.count === b.count && a.cov > b.cov);

/**
 * Inkrementeller Zustand für einen Gebäudetyp. `tight[k]` zählt, wie viele
 * Gebäude der aktuellen Lösung mit Kandidat k im Konflikt stehen (ein
 * Gebäude zählt für sich selbst mit). Kandidat k ist frei ⇔ tight[k] = 0.
 */
class Packer {
  readonly n: number;
  readonly w: number;
  readonly h: number;
  readonly D: number;
  readonly D2: number;
  readonly cx: Int32Array;
  readonly cy: Int32Array;
  readonly cov: Int32Array;
  readonly deg: Int32Array;
  private readonly cand: Int32Array;
  private readonly rows: number;
  private readonly cols: number;
  private readonly span: Int32Array;

  readonly tight: Int32Array;
  readonly inS: Uint8Array;
  sol: number[] = [];
  private readonly pos: Int32Array;
  covSum = 0;

  /** Protokoll für Rücknahme: +k+1 = eingefügt, −(k+1) = entfernt. */
  private journal: number[] | null = null;
  /** Änderungsprotokoll für die lokale Suche (gleiches Format, immer aktiv). */
  log: number[] = [];

  constructor(
    mask: LandMask,
    allowed: Uint8Array,
    readonly spec: BuildingSpec,
  ) {
    const { w, h, data } = mask;
    const S = spec.size;
    this.w = w;
    this.h = h;
    this.D = spec.radius * 2;
    this.D2 = this.D * this.D;
    this.cols = Math.max(0, w - S + 1);
    this.rows = Math.max(0, h - S + 1);

    // 4×4-Flächen über eine 2D-Präfixsumme der erlaubten Kacheln prüfen.
    const P = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let run = 0;
      for (let x = 0; x < w; x++) {
        run += allowed[y * w + x] ? 1 : 0;
        P[(y + 1) * (w + 1) + x + 1] = P[y * (w + 1) + x + 1] + run;
      }
    }
    const full = S * S;
    this.cand = new Int32Array(w * h).fill(-1);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const s =
          P[(y + S) * (w + 1) + x + S] -
          P[y * (w + 1) + x + S] -
          P[(y + S) * (w + 1) + x] +
          P[y * (w + 1) + x];
        if (s === full) {
          this.cand[y * w + x] = xs.length;
          xs.push(x);
          ys.push(y);
        }
      }
    }
    this.n = xs.length;
    this.cx = Int32Array.from(xs);
    this.cy = Int32Array.from(ys);

    // Konfliktbereich als Zeilenspannen: |dx| ≤ span[dy] ⇔ dx² + dy² < D².
    this.span = new Int32Array(2 * this.D - 1);
    for (let dy = -(this.D - 1); dy <= this.D - 1; dy++) {
      this.span[dy + this.D - 1] = Math.ceil(Math.sqrt(this.D2 - dy * dy)) - 1;
    }

    // Abdeckung je Kandidat (nur Landkacheln zählen).
    const disk = diskOffsets(spec);
    this.cov = new Int32Array(this.n);
    for (let k = 0; k < this.n; k++) {
      let c = 0;
      for (let i = 0; i < disk.length; i++) {
        const x = this.cx[k] + disk[i][0];
        const y = this.cy[k] + disk[i][1];
        if (x >= 0 && y >= 0 && x < w && y < h && data[y * w + x]) c++;
      }
      this.cov[k] = c;
    }

    // Statischer Grad (Kandidaten im Konfliktbereich) über Zeilen-Präfixsummen.
    const rowP = new Int32Array(this.rows * (this.cols + 1));
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        rowP[y * (this.cols + 1) + x + 1] =
          rowP[y * (this.cols + 1) + x] + (this.cand[y * w + x] >= 0 ? 1 : 0);
      }
    }
    this.deg = new Int32Array(this.n);
    for (let k = 0; k < this.n; k++) {
      let d = 0;
      for (let dy = -(this.D - 1); dy <= this.D - 1; dy++) {
        const yy = this.cy[k] + dy;
        if (yy < 0 || yy >= this.rows) continue;
        const hw = this.span[dy + this.D - 1];
        const x0 = Math.max(0, this.cx[k] - hw);
        const x1 = Math.min(this.cols - 1, this.cx[k] + hw);
        if (x1 >= x0) d += rowP[yy * (this.cols + 1) + x1 + 1] - rowP[yy * (this.cols + 1) + x0];
      }
      this.deg[k] = d;
    }

    this.tight = new Int32Array(this.n);
    this.inS = new Uint8Array(this.n);
    this.pos = new Int32Array(this.n).fill(-1);
  }

  indexAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return -1;
    return this.cand[y * this.w + x];
  }

  conflict(a: number, b: number): boolean {
    const dx = this.cx[a] - this.cx[b];
    const dy = this.cy[a] - this.cy[b];
    return dx * dx + dy * dy < this.D2;
  }

  private bump(k: number, delta: number): void {
    const { cand, tight, span, w } = this;
    const x = this.cx[k];
    const y = this.cy[k];
    const D1 = this.D - 1;
    const y0 = Math.max(0, y - D1);
    const y1 = Math.min(this.rows - 1, y + D1);
    for (let yy = y0; yy <= y1; yy++) {
      const hw = span[yy - y + D1];
      const x0 = Math.max(0, x - hw);
      const x1 = Math.min(this.cols - 1, x + hw);
      const base = yy * w;
      for (let xx = x0; xx <= x1; xx++) {
        const j = cand[base + xx];
        if (j >= 0) tight[j] += delta;
      }
    }
  }

  /** Kandidaten im Konfliktbereich von k, deren tight-Wert genau `t` ist. */
  neighboursWithTight(k: number, t: number, out: number[]): number[] {
    out.length = 0;
    const { cand, tight, span, w } = this;
    const x = this.cx[k];
    const y = this.cy[k];
    const D1 = this.D - 1;
    const y0 = Math.max(0, y - D1);
    const y1 = Math.min(this.rows - 1, y + D1);
    for (let yy = y0; yy <= y1; yy++) {
      const hw = span[yy - y + D1];
      const x0 = Math.max(0, x - hw);
      const x1 = Math.min(this.cols - 1, x + hw);
      const base = yy * w;
      for (let xx = x0; xx <= x1; xx++) {
        const j = cand[base + xx];
        if (j >= 0 && tight[j] === t && !this.inS[j]) out.push(j);
      }
    }
    return out;
  }

  add(k: number): void {
    this.inS[k] = 1;
    this.pos[k] = this.sol.length;
    this.sol.push(k);
    this.covSum += this.cov[k];
    this.bump(k, 1);
    this.journal?.push(k + 1);
    this.log.push(k + 1);
  }

  remove(k: number): void {
    this.inS[k] = 0;
    const i = this.pos[k];
    const last = this.sol.pop() as number;
    if (last !== k) {
      this.sol[i] = last;
      this.pos[last] = i;
    }
    this.pos[k] = -1;
    this.covSum -= this.cov[k];
    this.bump(k, -1);
    this.journal?.push(-(k + 1));
    this.log.push(-(k + 1));
  }

  beginJournal(): void {
    this.journal = [];
  }

  rollback(): void {
    const j = this.journal;
    this.journal = null;
    if (!j) return;
    for (let i = j.length - 1; i >= 0; i--) {
      const e = j[i];
      if (e > 0) this.remove(e - 1);
      else this.add(-e - 1);
    }
  }

  commit(): void {
    this.journal = null;
  }

  clear(): void {
    this.journal = null;
    for (const k of this.sol) {
      this.inS[k] = 0;
      this.pos[k] = -1;
    }
    this.sol = [];
    this.covSum = 0;
    this.tight.fill(0);
  }

  snapshot(): Snapshot {
    return { sol: Int32Array.from(this.sol), count: this.sol.length, cov: this.covSum };
  }

  restore(s: Snapshot): void {
    this.clear();
    for (const k of s.sol) this.add(k);
  }

  freeList(out: number[]): number[] {
    out.length = 0;
    const { tight } = this;
    for (let k = 0; k < this.n; k++) if (tight[k] === 0) out.push(k);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Bausteine der Suche
// ---------------------------------------------------------------------------

/** Größter Abstand (Quadrat) in einer Punktmenge über die konvexe Hülle. */
function farthestPair(p: Packer, idx: readonly number[]): [number, number, number] {
  if (idx.length < 2) return [-1, -1, -1];
  const pts = [...idx].sort((a, b) => p.cx[a] - p.cx[b] || p.cy[a] - p.cy[b]);
  const cross = (o: number, a: number, b: number): number =>
    (p.cx[a] - p.cx[o]) * (p.cy[b] - p.cy[o]) - (p.cy[a] - p.cy[o]) * (p.cx[b] - p.cx[o]);
  const lower: number[] = [];
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) {
      lower.pop();
    }
    lower.push(q);
  }
  const upper: number[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) {
      upper.pop();
    }
    upper.push(q);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 2) return [pts[0], pts[pts.length - 1], 0];
  let best = -1;
  let ba = -1;
  let bb = -1;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const dx = p.cx[hull[i]] - p.cx[hull[j]];
      const dy = p.cy[hull[i]] - p.cy[hull[j]];
      const d = dx * dx + dy * dy;
      if (d > best) {
        best = d;
        ba = hull[i];
        bb = hull[j];
      }
    }
  }
  return [ba, bb, best];
}

class Search {
  private readonly rnd: () => number;
  private readonly tmpA: number[] = [];
  private readonly tmpB: number[] = [];
  private readonly mark: Int32Array;
  private markGen = 1;
  private readonly queued: Uint8Array;
  /** Position im Änderungsprotokoll, bis zu der aufgefüllt bzw. geprüft wurde. */
  private fillPtr = 0;
  private queuePtr = 0;

  constructor(
    readonly p: Packer,
    seed: number,
  ) {
    this.rnd = mulberry32(seed);
    this.mark = new Int32Array(p.n);
    this.queued = new Uint8Array(p.n);
  }

  private randInt(n: number): number {
    return Math.floor(this.rnd() * n);
  }

  /** Neues lokales Arbeitsfenster: Änderungen ab hier werden verfolgt. */
  resetLog(): void {
    this.p.log.length = 0;
    this.fillPtr = 0;
    this.queuePtr = 0;
  }

  /**
   * Freie Kandidaten gierig einsetzen. Bei wenigen freien Kandidaten wird
   * jeweils der mit den wenigsten freien Nachbarn gewählt (dynamischer
   * Min-Grad), sonst nach statischem Grad (Ränder/Ecken zuerst).
   * `full = false`: nur rund um seit dem letzten Aufruf entfernte Gebäude
   * suchen – nur dort kann etwas frei geworden sein.
   */
  fill(full = false): void {
    const p = this.p;
    let free: number[];
    if (full) {
      free = p.freeList(this.tmpA);
    } else {
      free = this.tmpA;
      free.length = 0;
      const gen = ++this.markGen;
      const log = p.log;
      for (let i = this.fillPtr; i < log.length; i++) {
        const e = log[i];
        if (e > 0) continue;
        const removed = -e - 1;
        if (p.inS[removed]) continue;
        for (const k of p.neighboursWithTight(removed, 0, this.tmpB)) {
          if (this.mark[k] !== gen) {
            this.mark[k] = gen;
            free.push(k);
          }
        }
      }
    }
    if (free.length > 0) {
      if (free.length > 400) {
        const order = free.map((k) => ({ k, key: p.deg[k] + this.rnd() * 0.5 }));
        order.sort((a, b) => a.key - b.key);
        for (const { k } of order) {
          if (p.tight[k] === 0) p.add(k);
        }
      } else {
        while (free.length > 0) {
          let bestK = -1;
          let bestKey = Infinity;
          for (let i = 0; i < free.length; i++) {
            let d = 0;
            const a = free[i];
            for (let j = 0; j < free.length; j++) if (p.conflict(a, free[j])) d++;
            const key = d * 1e6 + p.deg[a] + this.rnd();
            if (key < bestKey) {
              bestKey = key;
              bestK = a;
            }
          }
          p.add(bestK);
          free = free.filter((k) => p.tight[k] === 0);
        }
      }
    }
    this.fillPtr = p.log.length;
  }

  /**
   * Lokale Suche: (1,2)-Tausch, solange er Gebäude gewinnt. Geprüft werden
   * nur Gebäude in der Nähe von Änderungen (`all` = alle).
   */
  twoImprove(all = false): void {
    const p = this.p;
    const queue: number[] = [];
    const R2 = 4 * p.D2; // Änderungen wirken bis 2·D auf die 1-Nachbarschaft
    const enqueueNear = (): void => {
      const log = p.log;
      for (let i = this.queuePtr; i < log.length; i++) {
        const e = log[i];
        const c = e > 0 ? e - 1 : -e - 1;
        for (const v of p.sol) {
          if (this.queued[v]) continue;
          const dx = p.cx[v] - p.cx[c];
          const dy = p.cy[v] - p.cy[c];
          if (dx * dx + dy * dy < R2) {
            this.queued[v] = 1;
            queue.push(v);
          }
        }
      }
      this.queuePtr = log.length;
    };
    if (all) {
      for (const v of p.sol) {
        this.queued[v] = 1;
        queue.push(v);
      }
      this.queuePtr = p.log.length;
    } else {
      enqueueNear();
    }
    for (let i = queue.length - 1; i > 0; i--) {
      const j = this.randInt(i + 1);
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    while (queue.length > 0) {
      const v = queue.pop() as number;
      this.queued[v] = 0;
      if (!p.inS[v]) continue;
      const L = p.neighboursWithTight(v, 1, this.tmpB);
      if (L.length < 2) continue;
      const [a, b, d] = farthestPair(p, L);
      if (d < p.D2) continue;
      p.remove(v);
      p.add(a);
      p.add(b);
      this.fill();
      enqueueNear();
    }
    for (const v of queue) this.queued[v] = 0;
  }

  /** Kandidat erzwingen: Konflikte entfernen, einsetzen. */
  private forceInsert(u: number): void {
    const p = this.p;
    const victims: number[] = [];
    for (const v of p.sol) if (p.conflict(u, v)) victims.push(v);
    for (const v of victims) p.remove(v);
    p.add(u);
  }

  private pickPerturbation(): number {
    const p = this.p;
    const r = this.rnd();
    if (r < 0.55 && p.sol.length > 0) {
      // Plateau-Zug: ein Gebäude an eine Stelle schieben, die nur mit ihm kollidiert.
      for (let t = 0; t < 8; t++) {
        const v = p.sol[this.randInt(p.sol.length)];
        const L = p.neighboursWithTight(v, 1, this.tmpB);
        if (L.length > 0) return L[this.randInt(L.length)];
      }
    }
    if (r < 0.85 && p.sol.length > 0) {
      // Stelle in der Nähe eines Gebäudes, auch wenn sie mit zweien kollidiert.
      const v = p.sol[this.randInt(p.sol.length)];
      const reach = p.D + 4;
      for (let t = 0; t < 30; t++) {
        const k = p.indexAt(
          p.cx[v] + this.randInt(2 * reach + 1) - reach,
          p.cy[v] + this.randInt(2 * reach + 1) - reach,
        );
        if (k >= 0 && !p.inS[k] && p.tight[k] <= 2) return k;
      }
    }
    for (let t = 0; t < 50; t++) {
      const k = this.randInt(p.n);
      if (!p.inS[k]) return k;
    }
    return this.randInt(p.n);
  }

  /** Iterated Local Search auf die Anzahl; liefert die beste Lösung (Anzahl, dann Abdeckung). */
  ils(deadline: number, onBest?: (s: Snapshot) => void): Snapshot {
    const p = this.p;
    this.resetLog();
    this.fill(true);
    this.twoImprove(true);
    let best = p.snapshot();
    let curCount = p.sol.length;
    let iter = 0;
    while (now() < deadline) {
      iter++;
      this.resetLog();
      p.beginJournal();
      const k = this.rnd() < 1 / (2 * Math.max(1, p.sol.length)) ? 2 : 1;
      for (let i = 0; i < k; i++) this.forceInsert(this.pickPerturbation());
      this.fill();
      this.twoImprove();
      const c = p.sol.length;
      if (c > curCount || (c === curCount) || (c === curCount - 1 && this.rnd() < 0.02)) {
        p.commit();
        curCount = c;
        const s = { count: c, cov: p.covSum };
        if (better(s, best)) {
          best = p.snapshot();
          onBest?.(best);
        }
      } else {
        p.rollback();
      }
      // Gelegentlich zur besten Lösung zurück, damit die Suche nicht wegdriftet.
      if (curCount < best.count - 1 || (iter % 20000 === 0 && curCount < best.count)) {
        p.restore(best);
        curCount = best.count;
      }
    }
    return best;
  }

  /** Bestes konfliktfreies Ziel für jedes Gebäude, bis nichts mehr besser wird. */
  private climb(deadline: number): void {
    const p = this.p;
    let improved = true;
    while (improved && now() < deadline) {
      improved = false;
      for (const v of [...p.sol]) {
        if (!p.inS[v]) continue;
        const L = p.neighboursWithTight(v, 1, this.tmpB);
        if (L.length === 0) continue;
        if (L.length > 1) {
          const [a, b, d] = farthestPair(p, L);
          if (d >= p.D2) {
            p.remove(v);
            p.add(a);
            p.add(b);
            this.fill();
            improved = true;
            continue;
          }
        }
        let bestQ = -1;
        let bestCov = p.cov[v];
        for (const q of L) {
          if (p.cov[q] > bestCov) {
            bestCov = p.cov[q];
            bestQ = q;
          }
        }
        if (bestQ >= 0) {
          p.remove(v);
          p.add(bestQ);
          this.fill();
          improved = true;
        }
      }
    }
  }

  /**
   * Abdeckung per Simulated Annealing maximieren. Züge verschieben ein
   * Gebäude an eine Stelle, die nur mit ihm selbst kollidiert (kleine Schritte
   * oder Sprünge im Konfliktbereich). Wird dabei Platz frei, wird sofort ein
   * weiteres Gebäude eingesetzt – die Anzahl kann also nur steigen.
   */
  polish(deadline: number, onBest?: (s: Snapshot) => void): Snapshot {
    const p = this.p;
    this.resetLog();
    this.climb(deadline);
    let best = p.snapshot();
    if (p.sol.length === 0) return best;
    const T0 = 30;
    const T1 = 0.25;
    while (now() < deadline - 5) {
      // Abkühlzyklen von höchstens 2,5 s, jeweils von der besten Lösung aus.
      const c0 = now();
      const cycleEnd = Math.min(deadline, c0 + 2500);
      const len = Math.max(1, cycleEnd - c0);
      let T = T0;
      let moves = 0;
      while (true) {
        if ((moves & 127) === 0) {
          const t = now();
          if (t >= cycleEnd) break;
          T = T0 * Math.pow(T1 / T0, (t - c0) / len);
        }
        moves++;
        const v = p.sol[this.randInt(p.sol.length)];
        let q = -1;
        if (this.rnd() < 0.7) {
          const k = p.indexAt(p.cx[v] + this.randInt(7) - 3, p.cy[v] + this.randInt(7) - 3);
          if (k >= 0 && !p.inS[k] && p.tight[k] === 1) q = k;
        } else {
          const L = p.neighboursWithTight(v, 1, this.tmpB);
          if (L.length > 0) q = L[this.randInt(L.length)];
        }
        if (q < 0) continue;
        const delta = p.cov[q] - p.cov[v];
        if (delta < 0 && this.rnd() >= Math.exp(delta / T)) continue;
        this.resetLog();
        p.remove(v);
        p.add(q);
        this.fill();
        if (p.sol.length > best.count || (p.sol.length === best.count && p.covSum > best.cov)) {
          best = p.snapshot();
          onBest?.(best);
        }
      }
      p.restore(best);
      this.resetLog();
      this.climb(deadline);
      if (better({ count: p.sol.length, cov: p.covSum }, best)) {
        best = p.snapshot();
        onBest?.(best);
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// Startlösungen aus hexagonalen Gittern
// ---------------------------------------------------------------------------

function latticeSeed(
  p: Packer,
  angle: number,
  spacing: number,
  ox: number,
  oy: number,
  rowStep?: number,
): Snapshot {
  p.clear();
  const ax = Math.cos(angle) * spacing;
  const ay = Math.sin(angle) * spacing;
  const ry = rowStep ?? (spacing * Math.sqrt(3)) / 2;
  const bx = Math.cos(angle) * spacing * 0.5 - Math.sin(angle) * ry;
  const by = Math.sin(angle) * spacing * 0.5 + Math.cos(angle) * ry;
  const reach = Math.ceil((1.5 * Math.max(p.w, p.h)) / Math.min(spacing, ry)) + 2;
  // Konflikte durch Rundung auf ganze Kacheln werden einfach übersprungen.
  for (let j = -reach; j <= reach; j++) {
    for (let i = -reach; i <= reach; i++) {
      const x = Math.round(ox + i * ax + j * bx);
      const y = Math.round(oy + i * ay + j * by);
      const k = p.indexAt(x, y);
      if (k >= 0 && p.tight[k] === 0) p.add(k);
    }
  }
  return p.snapshot();
}

function seeds(p: Packer, rnd: () => number, deadline: number, warm?: Snapshot): Snapshot[] {
  const D = p.D;
  const out: Snapshot[] = [];
  if (warm) out.push(warm);
  // Exaktes Ganzzahlgitter (wie bisher): Zeilenabstand = kleinste ganze Zahl,
  // bei der die Diagonale den Mindestabstand einhält; beide Ausrichtungen.
  const row = Math.ceil(Math.sqrt(D * D - (D / 2) * (D / 2)) - 1e-9);
  const rowOk = (D / 2) * (D / 2) + row * row >= D * D ? row : row + 1;
  const configs: Array<{ angle: number; spacing: number; row?: number }> = [
    { angle: 0, spacing: D, row: rowOk },
    { angle: Math.PI / 2, spacing: D, row: rowOk },
  ];
  for (let deg = 5; deg < 60; deg += 5) {
    if (deg === 30) continue;
    configs.push({ angle: (deg * Math.PI) / 180, spacing: D + 0.6 });
  }
  const trials = 18;
  let cfgIndex = 0;
  for (const cfg of configs) {
    const local: Snapshot[] = [];
    for (let t = 0; t < trials; t++) {
      local.push(latticeSeed(p, cfg.angle, cfg.spacing, rnd() * D, rnd() * D, cfg.row));
    }
    local.sort((a, b) => b.count - a.count || b.cov - a.cov);
    out.push(local[0], local[1]);
    cfgIndex++;
    if (now() > deadline && cfgIndex >= 2) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

function buildGroup(
  mask: LandMask,
  spec: BuildingSpec,
  positions: ReadonlyArray<{ x: number; y: number }>,
): Group {
  const { w, h, data } = mask;
  const covered = new Uint8Array(w * h);
  let coveredCount = 0;
  const disk = diskOffsets(spec);
  for (const c of positions) {
    for (const [dx, dy] of disk) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const idx = y * w + x;
      if (!data[idx] || covered[idx]) continue;
      covered[idx] = 1;
      coveredCount++;
    }
  }
  const chambers = [...positions]
    .map((c) => ({ x: c.x, y: c.y, type: spec.id }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return { type: spec.id, chambers, covered, coveredCount };
}

function makeLayout(mask: LandMask, groups: Group[]): Layout {
  return {
    w: mask.w,
    h: mask.h,
    landCount: mask.landCount,
    groups,
    chambers: groups.flatMap((g) => g.chambers),
  };
}

export function emptyLayout(mask: LandMask, types: readonly BuildingId[]): Layout {
  return makeLayout(
    mask,
    types.map((t) => buildGroup(mask, BUILDINGS[t], [])),
  );
}

/** Prüft die Invarianten: Fläche auf Land, keine Flächen-/Radiusüberlappung. */
export function validateLayout(mask: LandMask, layout: Layout): string[] {
  const errors: string[] = [];
  const used = new Uint8Array(mask.w * mask.h);
  for (const g of layout.groups) {
    const spec = BUILDINGS[g.type];
    const D2 = (2 * spec.radius) ** 2;
    for (let i = 0; i < g.chambers.length; i++) {
      const a = g.chambers[i];
      for (let dy = 0; dy < spec.size; dy++) {
        for (let dx = 0; dx < spec.size; dx++) {
          const x = a.x + dx;
          const y = a.y + dy;
          if (x < 0 || y < 0 || x >= mask.w || y >= mask.h || !mask.data[y * mask.w + x]) {
            errors.push(`${spec.short} ${a.x},${a.y}: Fläche nicht auf Land`);
          } else if (used[y * mask.w + x]++) {
            errors.push(`${spec.short} ${a.x},${a.y}: Fläche überlappt`);
          }
        }
      }
      for (let j = i + 1; j < g.chambers.length; j++) {
        const b = g.chambers[j];
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < D2) {
          errors.push(`${spec.short} ${a.x},${a.y} ↔ ${b.x},${b.y}: Radien überlappen`);
        }
      }
    }
  }
  return errors;
}

/**
 * Löst nacheinander alle Typen. Spätere Typen (Rathäuser) weichen den
 * 4×4-Flächen früherer Typen (Handelskammern) aus; ihre Radien dürfen sich
 * überlappen, weil verschiedene Gebäudetypen sich nicht stören.
 */
export function solve(mask: LandMask, types: readonly BuildingId[], options: SolveOptions = {}): Layout {
  const budget = Math.max(50, options.budgetMs ?? 3000);
  const start = now();
  const seed = options.seed ?? 12345;
  const allowed = Uint8Array.from(mask.data);
  const block = (c: Chamber): void => {
    const size = BUILDINGS[c.type].size;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x >= 0 && y >= 0 && x < mask.w && y < mask.h) allowed[y * mask.w + x] = 0;
      }
    }
  };
  for (const c of options.blocked ?? []) block(c);
  const done: Group[] = [];
  let lastEmit = 0;

  // Rathäuser haben weniger Kandidaten-Konflikte pro Fläche; Anteil grob nach Typ.
  const weights = types.map((t) => (t === 'hk' ? 0.6 : 0.4));
  const wsum = weights.reduce((a, b) => a + b, 0);

  types.forEach((type, ti) => {
    const spec = BUILDINGS[type];
    const share = (budget * weights[ti]) / wsum;
    const typeStart = now();
    const typeEnd = Math.min(start + budget, typeStart + share);
    const p = new Packer(mask, allowed, spec);
    const rnd = mulberry32(seed + ti * 7919);

    const emit = (s: Snapshot, force = false): void => {
      if (!options.onProgress) return;
      const t = now();
      if (!force && t - lastEmit < 200) return;
      lastEmit = t;
      const g = buildGroup(
        mask,
        spec,
        Array.from(s.sol, (k) => ({ x: p.cx[k], y: p.cy[k] })),
      );
      const pending = types.slice(ti + 1).map((t2) => buildGroup(mask, BUILDINGS[t2], []));
      options.onProgress(makeLayout(mask, [...done, g, ...pending]));
    };

    let best: Snapshot = { sol: new Int32Array(0), count: 0, cov: 0 };
    if (p.n > 0) {
      const warmPos = options.warmStart?.[type];
      let warm: Snapshot | undefined;
      if (warmPos && warmPos.length) {
        p.clear();
        for (const c of warmPos) {
          const k = p.indexAt(c.x, c.y);
          if (k >= 0 && p.tight[k] === 0) p.add(k);
        }
        warm = p.snapshot();
      }

      const span = typeEnd - typeStart;
      const seedList = seeds(p, rnd, typeStart + span * 0.08, warm);
      // Jede Startlösung kurz verbessern.
      const improved: Snapshot[] = [];
      for (const s of seedList) {
        p.restore(s);
        const search = new Search(p, Math.floor(rnd() * 1e9));
        search.resetLog();
        search.fill(true);
        search.twoImprove(true);
        improved.push(p.snapshot());
      }
      improved.sort((a, b) => b.count - a.count || b.cov - a.cov);
      best = improved[0];
      emit(best, true);

      // Elite: verschiedene Lösungen mit der besten Anzahl, für die Politur.
      let elite: Snapshot[] = [];
      const signature = (s: Snapshot): string => Array.from(s.sol).sort((a, b) => a - b).join(',');
      const seen = new Set<string>();
      const pushElite = (s: Snapshot): void => {
        if (elite.length && s.count < elite[0].count) return;
        if (elite.length && s.count > elite[0].count) {
          elite = [];
          seen.clear();
        }
        const sig = signature(s);
        if (seen.has(sig)) return;
        seen.add(sig);
        elite.push(s);
        elite.sort((a, b) => b.cov - a.cov);
        if (elite.length > 4) elite.length = 4;
      };
      pushElite(best);
      const onBest = (b: Snapshot): void => {
        if (better(b, best)) {
          best = b;
          emit(best);
        }
      };

      // Mehrfachstart-ILS: kurze Läufe abwechselnd von der besten Lösung, von
      // verschiedenen Startgittern und von frischen Zufallsgittern.
      const ilsEnd = typeStart + span * 0.62;
      const slice = Math.min(2500, Math.max(200, span * 0.08));
      for (let round = 0; now() < ilsEnd - 20; round++) {
        const kind = round % 3;
        let startSol: Snapshot;
        if (kind === 0) startSol = best;
        else if (kind === 1) startSol = improved[Math.floor(round / 3) % Math.min(8, improved.length)];
        else {
          startSol = latticeSeed(
            p,
            rnd() * (Math.PI / 3),
            p.D + 0.3 + rnd() * 0.8,
            rnd() * p.D,
            rnd() * p.D,
          );
        }
        p.restore(startSol);
        const search = new Search(p, Math.floor(rnd() * 1e9));
        const r = search.ils(Math.min(ilsEnd, now() + slice), onBest);
        pushElite(r);
        if (better(r, best)) onBest(r);
      }

      // Politur der Abdeckung auf den besten verschiedenen Lösungen.
      const targets = elite.slice(0, 3);
      for (let i = 0; i < targets.length; i++) {
        const left = typeEnd - now();
        if (left <= 5) break;
        p.restore(targets[i]);
        const search = new Search(p, Math.floor(rnd() * 1e9));
        const r = search.polish(now() + left / (targets.length - i), onBest);
        if (better(r, best)) onBest(r);
      }
    }

    const positions = Array.from(best.sol, (k) => ({ x: p.cx[k], y: p.cy[k] }));
    const group = buildGroup(mask, spec, positions);
    done.push(group);
    // Spätere Typen dürfen nicht auf diese Flächen bauen.
    for (const c of group.chambers) block(c);
  });

  const layout = makeLayout(mask, done);
  options.onProgress?.(layout);
  return layout;
}

// ---------------------------------------------------------------------------
// Aufteilung in Stempel (nur wenn der Ein-Stempel-Testmodus aus ist)
// ---------------------------------------------------------------------------

export interface Chunk {
  chambers: Chamber[];
  index: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
}

const BUILDING_SIZE = 4;

/**
 * Teilt die Gebäude in waagerechte Bänder, deren Begrenzungsrechteck höchstens
 * `maxArea` Kacheln groß ist. Mit `Infinity` entsteht genau ein Stempel.
 */
export function splitChunks(layout: Layout, maxArea = 13500): Chunk[] {
  const sorted = [...layout.chambers].sort((a, b) => a.y - b.y || a.x - b.x);
  if (sorted.length === 0) return [];
  const out: Chunk[] = [];
  let group: Chamber[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const flush = (): void => {
    if (group.length === 0) return;
    out.push({
      chambers: group,
      index: out.length,
      minX,
      minY,
      maxX,
      maxY,
      area: (maxX - minX) * (maxY - minY),
    });
    group = [];
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
  };

  for (const c of sorted) {
    const nMinX = Math.min(minX, c.x);
    const nMaxX = Math.max(maxX, c.x + BUILDING_SIZE);
    const nMinY = Math.min(minY, c.y);
    const nMaxY = Math.max(maxY, c.y + BUILDING_SIZE);
    if (group.length > 0 && (nMaxX - nMinX) * (nMaxY - nMinY) > maxArea) {
      flush();
      minX = c.x;
      maxX = c.x + BUILDING_SIZE;
      minY = c.y;
      maxY = c.y + BUILDING_SIZE;
    } else {
      minX = nMinX;
      maxX = nMaxX;
      minY = nMinY;
      maxY = nMaxY;
    }
    group.push(c);
  }
  flush();
  return out;
}
