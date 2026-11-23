// Hafengebiet der Insel: Kontor im Stempel erkennen.
//
// Das Kontor lässt sich nicht stempeln. Wo es steht, bleibt im Stempel eine Lücke: weder
// Feldweg (Land) noch Kaistraße (Hafengebiet). Vor dem Kontor muss außerdem eine Zufahrt
// für Schiffe frei bleiben – ebenfalls eine Lücke, gerade und 5 Kacheln breit bis zum Rand
// des Hafengebiets. Gemessen am Crown-Falls-Stempel (23.11.2026): Lücke 7 × 9 direkt an der
// Landkante (Kontor, Anno Designer 9×7) und davor ein Streifen 5 breit bis ins offene Wasser.
// Unter Kontor und Zufahrt ist Hafengebiet (links und rechts davon liegt überall Kaistraße).
import type { CombinedMask } from './island';

/** Grundfläche des Kontors (Kachelachsen bei Zufahrt nach Süden: 7 breit, 9 tief). */
export const KONTOR_SIZE = { across: 7, along: 9 };
/** Breite der freizuhaltenden Zufahrt vor dem Kontor. */
export const FAIRWAY_WIDTH = 5;

export type Facing = 'N' | 'E' | 'S' | 'W';

export interface KontorFound {
  /** Kontor-Rechteck (Maskenkoordinaten). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Richtung der Zufahrt (zum offenen Wasser). */
  facing: Facing;
  /** Zufahrt vor dem Kontor. */
  fairway: { x: number; y: number; w: number; h: number };
  /** Anteil Kaistraße links/rechts von Kontor und Zufahrt (Sicherheit der Erkennung). */
  confidence: number;
}

const DIRS: Record<Facing, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/**
 * Sucht das Kontor: ein leeres Rechteck in Kontorgröße, dessen Rückseite an Land grenzt,
 * mit Hafengebiet an den Seiten und einer geraden, 5 Kacheln breiten leeren Zufahrt davor.
 */
export function detectKontor(mask: CombinedMask): KontorFound | null {
  const { w, h, data, harbor } = mask;
  if (!harbor) return null;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? -1 : data[y * w + x] ? 1 : harbor[y * w + x] ? 2 : 0);
  let best: KontorFound | null = null;
  let bestScore = 0;
  for (const facing of ['N', 'E', 'S', 'W'] as Facing[]) {
    const [dx, dy] = DIRS[facing];
    const vertical = dx === 0;
    const kw = vertical ? KONTOR_SIZE.across : KONTOR_SIZE.along;
    const kh = vertical ? KONTOR_SIZE.along : KONTOR_SIZE.across;
    for (let y = 0; y + kh <= h; y++) {
      for (let x = 0; x + kw <= w; x++) {
        // Kontor-Fläche leer?
        let ok = true;
        for (let yy = y; yy < y + kh && ok; yy++) for (let xx = x; xx < x + kw; xx++) if (at(xx, yy) !== 0) { ok = false; break; }
        if (!ok) continue;
        // Rückseite (gegen die Zufahrt) an Land, Seiten im Hafengebiet
        let back = 0;
        let sides = 0;
        let sideN = 0;
        if (vertical) {
          const by = dy > 0 ? y - 1 : y + kh;
          for (let xx = x; xx < x + kw; xx++) if (at(xx, by) === 1) back++;
          for (let yy = y; yy < y + kh; yy++) {
            sides += (at(x - 1, yy) === 2 ? 1 : 0) + (at(x + kw, yy) === 2 ? 1 : 0);
            sideN += 2;
          }
          if (back < kw / 2) continue;
        } else {
          const bx = dx > 0 ? x - 1 : x + kw;
          for (let yy = y; yy < y + kh; yy++) if (at(bx, yy) === 1) back++;
          for (let xx = x; xx < x + kw; xx++) {
            sides += (at(xx, y - 1) === 2 ? 1 : 0) + (at(xx, y + kh) === 2 ? 1 : 0);
            sideN += 2;
          }
          if (back < kh / 2) continue;
        }
        // Zufahrt: 5 breit, mittig vor dem Kontor, leer, so weit wie möglich
        const off = Math.floor(((vertical ? kw : kh) - FAIRWAY_WIDTH) / 2);
        let len = 0;
        let fairSides = 0;
        for (let step = 1; step < 400; step++) {
          let empty = true;
          for (let k = 0; k < FAIRWAY_WIDTH; k++) {
            const fx = vertical ? x + off + k : dx > 0 ? x + kw - 1 + step : x - step;
            const fy = vertical ? (dy > 0 ? y + kh - 1 + step : y - step) : y + off + k;
            if (at(fx, fy) !== 0) empty = false;
          }
          if (!empty) break;
          // Seiten der Zufahrt
          const s1 = vertical ? at(x + off - 1, dy > 0 ? y + kh - 1 + step : y - step) : at(dx > 0 ? x + kw - 1 + step : x - step, y + off - 1);
          const s2 = vertical
            ? at(x + off + FAIRWAY_WIDTH, dy > 0 ? y + kh - 1 + step : y - step)
            : at(dx > 0 ? x + kw - 1 + step : x - step, y + off + FAIRWAY_WIDTH);
          if (s1 !== 2 && s2 !== 2) break; // offenes Wasser erreicht
          fairSides += (s1 === 2 ? 1 : 0) + (s2 === 2 ? 1 : 0);
          len = step;
        }
        if (len < 3) continue;
        const confidence = (sides + fairSides) / (sideN + 2 * len);
        const score = confidence * Math.min(1, len / 10) + back / (vertical ? kw : kh) * 0.2;
        if (score <= bestScore) continue;
        bestScore = score;
        const fairway = vertical
          ? { x: x + off, y: dy > 0 ? y + kh : y - len, w: FAIRWAY_WIDTH, h: len }
          : { x: dx > 0 ? x + kw : x - len, y: y + off, w: len, h: FAIRWAY_WIDTH };
        best = { x, y, w: kw, h: kh, facing, fairway, confidence };
      }
    }
  }
  return best && best.confidence >= 0.5 ? best : null;
}

/** Hafengebiet inklusive der Flächen unter Kontor und Zufahrt (dort ist Wasser im Hafengebiet). */
export function harborWithKontor(mask: CombinedMask, k: KontorFound | null): Uint8Array | undefined {
  if (!mask.harbor) return undefined;
  const out = mask.harbor.slice();
  if (!k) return out;
  for (const r of [k, k.fairway]) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (x >= 0 && y >= 0 && x < mask.w && y < mask.h) out[y * mask.w + x] = 1;
  }
  return out;
}

export const FACING_NAMES: Record<Facing, string> = { N: 'Norden', E: 'Osten', S: 'Süden', W: 'Westen' };

/** Landkacheln direkt hinter dem Kontor (dort braucht es eine Straße). */
export function kontorBack(k: KontorFound): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (k.facing === 'S') for (let x = k.x; x < k.x + k.w; x++) out.push([x, k.y - 1]);
  else if (k.facing === 'N') for (let x = k.x; x < k.x + k.w; x++) out.push([x, k.y + k.h]);
  else if (k.facing === 'E') for (let y = k.y; y < k.y + k.h; y++) out.push([k.x - 1, y]);
  else for (let y = k.y; y < k.y + k.h; y++) out.push([k.x + k.w, y]);
  return out;
}
