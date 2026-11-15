// Post (Empire of the Skies): Briefkästen planen.
//
// Post ist ein Lebensstil-Bedürfnis und im Lager inselweit verfügbar; der
// Radius bestimmt nur die PRODUKTION (1,33 t/min je 500 Einwohner im Radius,
// höchstens 3100 %). Ein Briefkasten ist 1×1 – er passt in Restkacheln, die
// sonst leer bleiben. Radien von Briefkästen/Postämtern dürfen sich nicht
// überlappen (Mittelpunktabstand ≥ Summe der Radien).
//
// Vorgehen: Kandidaten = freie Restkacheln mit Straßenanschluss (Ränder,
// Rathaus-Reste, Lücken neben Gebäuden). Gierig den Briefkasten mit der
// höchsten Produktion setzen (Abstand ≥ 24 zu anderen Briefkästen), bis die
// Produktion den Bedarf × Reserve deckt. Häuser weichen nie: ein 1×1-
// Briefkasten würde sonst ein 3×3-Haus kosten und 8 Kacheln ungenutzt lassen
// (Wunsch des Nutzers). Fehlende Post kommt per Postamt/Luftpost.

import { FREE, ROAD, SERVICE, type FillState } from './fill';
import { mailProduction } from './rules';
import type { PlacedService } from './services';

export const POST_BOX_GUID = 538;
const BOX_RADIUS = 12;

export interface PostReport {
  boxes: number;
  production: number;
  need: number;
}

/**
 * `residentsAt`: Einwohner je Haus (Schlüssel „x,y“ der linken oberen Kachel).
 * `need`: Bedarf in t/min. Liefert die gesetzten Briefkästen (auch in `s`
 * als SERVICE markiert).
 */
export function placePostBoxes(
  s: FillState,
  residentsAt: Map<string, number>,
  need: number,
  /** Einwohner je t/min Post (Post-Einwohner bei Vollversorgung / Bedarf). */
  valuePerTon = 0,
  reserve = 1.1,
): { boxes: PlacedService[]; report: PostReport; removedHouses: number } {
  const { w, h, cell } = s;
  const houses = s.houses.map((hs) => ({ cx: hs.x + 1, cy: hs.y + 1, res: residentsAt.get(`${hs.x},${hs.y}`) ?? 0 }));
  // Häuser in Buckets für schnelle Radius-Summen.
  const B = 16;
  const buckets = new Map<string, number[]>();
  houses.forEach((hs, k) => {
    const key = `${Math.floor(hs.cx / B)},${Math.floor(hs.cy / B)}`;
    const list = buckets.get(key);
    if (list) list.push(k);
    else buckets.set(key, [k]);
  });
  const inRadius = (x: number, y: number): number => {
    let sum = 0;
    const bx = Math.floor(x / B);
    const by = Math.floor(y / B);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const k of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
          const hs = houses[k];
          if (Math.hypot(hs.cx - x, hs.cy - y) <= BOX_RADIUS + 1e-9) sum += hs.res;
        }
      }
    }
    return sum;
  };
  // Kandidaten: nur freie Kacheln mit Straßenanschluss.
  const cands: Array<{ x: number; y: number; prod: number }> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cell[i] !== FREE) continue;
      const road =
        (x > 0 && cell[i - 1] === ROAD) ||
        (x < w - 1 && cell[i + 1] === ROAD) ||
        (y > 0 && cell[i - w] === ROAD) ||
        (y < h - 1 && cell[i + w] === ROAD);
      if (!road) continue;
      const prod = mailProduction(inRadius(x, y));
      if (prod > 0) cands.push({ x, y, prod });
    }
  }
  const boxes: PlacedService[] = [];
  const removed = new Set<number>();
  let production = 0;
  const target = need * reserve;
  // Wert: gedeckter Bedarf (bei bekanntem Wert je t/min in Einwohnern), sonst Produktion.
  const gainOf = (c: { prod: number }): number =>
    valuePerTon > 0 ? Math.min(c.prod, Math.max(0, target - production)) * valuePerTon : c.prod;
  for (;;) {
    if (production >= target) break;
    let best = -1;
    let bestGain = 0;
    for (let k = 0; k < cands.length; k++) {
      const c = cands[k];
      if (cell[c.y * w + c.x] !== FREE) continue;
      const g = gainOf(c);
      if (g <= bestGain) continue;
      if (boxes.some((b) => Math.hypot(b.x - c.x, b.y - c.y) < 2 * BOX_RADIUS - 1e-9)) continue;
      best = k;
      bestGain = g;
    }
    if (best < 0) break;
    const c = cands[best];
    boxes.push({ guid: POST_BOX_GUID, kind: 'postBox', name: 'Briefkasten', x: c.x, y: c.y, w: 1, h: 1, turns: 0 });
    cell[c.y * w + c.x] = SERVICE;
    production += c.prod;
  }
  if (removed.size) s.houses = s.houses.filter((_, k) => !removed.has(k));
  return { boxes, report: { boxes: boxes.length, production, need }, removedHouses: removed.size };
}
