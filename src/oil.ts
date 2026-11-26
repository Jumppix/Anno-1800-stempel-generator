// Ölversorgung im Stadtplaner (Ölkraftwerke statt Gaskraftwerke): Ölhafen an der Küste,
// optional Raffinerien mit Bohrtürmen (eigene Ölquellen, mit „Bahnbrechende Entdeckungen“
// verschiebbar) und ein Gleisnetz zu allen Ölkraftwerken. Läuft als letzter Planungsschritt,
// nach allen Straßenänderungen, damit nichts mehr die Gleise unterbricht.
//
// Regeln aus den Teststempeln des Nutzers (docs/PLAN_Kueste.md, Abschnitt 9):
// - Gleise liegen im Stempel als gerade Stücke (Abschnitt RailwayInfos), Bahnhofsgebäude haben
//   ein Gleis durch ihre Mittellinie: Kraftwerk/Raffinerie (5×5) ganz, Kleiner Ölhafen (10×7)
//   7 Kacheln von der Landseite; Ausfahrt bei Drehung 0: Kraftwerk/Raffinerie rechts, Ölhafen
//   unten; jede Vierteldrehung dreht gegen den Uhrzeigersinn (rechts → oben → links → unten).
// - Bohrtürme hängen im Radius 12 an ihrer Raffinerie (gemeinsame ComplexOwnerID), bis zu 3.
// - Kreuzt ein Gleis eine Straße, entsteht ein Bahnübergang (Straße + Gleis auf einer Kachel);
//   höchstens 2 Übergänge direkt nebeneinander, Gleise nie längs auf Straßen.
import { lookup } from './catalog';
import { BRIDGE, FREE, HOUSE, ROAD, SERVICE, WATER, type FillState } from './fill';
import type { PlacedService } from './services';
import type { LandMask } from './solver';

export const OIL_POWER_GUID = 100780;
export const OIL_HARBOR_GUID = 100783;
export const OIL_REFINERY_GUID = 101331;
export const OIL_WELL_GUID = 101332;
export const OIL_OWNER_BASE = 9300;
/** Bohrtürme je Raffinerie (Angabe des Nutzers). */
export const WELLS_PER_REFINERY = 3;

export interface OilOptions {
  /** Anzahl eigener Ölquellen (Bohrtürme, verschiebbar); 0 = Öl kommt per Schiff. */
  wells: number;
  /** Hafengebiet (Maskenkoordinaten, 1 = Kaistraße o. Ä.); ohne: Wasser am Ufer. */
  harbor?: Uint8Array;
  /** Nicht bebaubar (Kontor und seine Zufahrt). */
  blocked?: Uint8Array;
}

export interface OilReport {
  harbor: boolean;
  refineries: number;
  wells: number;
  plants: number;
  connected: number;
  railTiles: number;
  crossings: number;
  bridges: number;
  houses: number;
  notes: string[];
}

type Side = 0 | 1 | 2 | 3; // 0 rechts, 1 oben, 2 links, 3 unten
const DX = [1, 0, -1, 0];
const DY = [0, -1, 0, 1];

/** Gleiskacheln im Gebäude und Ausfahrtskachel für ein 5×5-Bahnhofsgebäude (Kraftwerk/Raffinerie). */
function stationRail(x: number, y: number, side: Side): { inner: Array<[number, number]>; exit: [number, number] } {
  const inner: Array<[number, number]> = [];
  if (side === 0 || side === 2) for (let k = 0; k < 5; k++) inner.push([x + k, y + 2]);
  else for (let k = 0; k < 5; k++) inner.push([x + 2, y + k]);
  const exit: [number, number] = side === 0 ? [x + 5, y + 2] : side === 2 ? [x - 1, y + 2] : side === 1 ? [x + 2, y - 1] : [x + 2, y + 5];
  return { inner, exit };
}

/** Kleiner Ölhafen (Drehung = Ausfahrt): Fläche, Gleis (7 Kacheln von der Landseite) und Ausfahrt. */
function harborShape(x: number, y: number, turns: number): { w: number; h: number; inner: Array<[number, number]>; exit: [number, number]; side: Side } {
  // Drehung 0: 7 breit, 10 hoch, Ausfahrt unten; 1: 10 × 7 rechts; 2: oben; 3: links
  const t = ((turns % 4) + 4) % 4;
  const inner: Array<[number, number]> = [];
  if (t === 0) {
    for (let k = 3; k < 10; k++) inner.push([x + 3, y + k]);
    return { w: 7, h: 10, inner, exit: [x + 3, y + 10], side: 3 };
  }
  if (t === 1) {
    for (let k = 3; k < 10; k++) inner.push([x + k, y + 3]);
    return { w: 10, h: 7, inner, exit: [x + 10, y + 3], side: 0 };
  }
  if (t === 2) {
    for (let k = 0; k < 7; k++) inner.push([x + 3, y + k]);
    return { w: 7, h: 10, inner, exit: [x + 3, y - 1], side: 1 };
  }
  for (let k = 0; k < 7; k++) inner.push([x + k, y + 3]);
  return { w: 10, h: 7, inner, exit: [x - 1, y + 3], side: 2 };
}

/** Drehung eines 5×5-Bahnhofsgebäudes für eine Ausfahrtsseite. */
const turnsForSide = (side: Side): number => side;

/** Kleiner binärer Heap für Dijkstra. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.k;
    const v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop() as number;
    const lv = v.pop() as number;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Plant die Ölversorgung in einem Zustand (Zellen, Häuser) mit gesetzten Ölkraftwerken.
 * Ergebnis: neue Gebäude (Ölhafen, Raffinerien, Bohrtürme), geänderte Kraftwerke (Drehung),
 * Gleiskacheln; entfernte Häuser sind aus `s.houses` genommen.
 */
export function planOilSupply(
  mask: LandMask,
  s: FillState,
  services: PlacedService[],
  opts: OilOptions,
): { services: PlacedService[]; rails: number[]; report: OilReport } {
  const { w, h, cell } = s;
  const report: OilReport = { harbor: false, refineries: 0, wells: 0, plants: 0, connected: 0, railTiles: 0, crossings: 0, bridges: 0, houses: 0, notes: [] };
  const idx = (x: number, y: number): number => y * w + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  const out: PlacedService[] = services.map((sv) => ({ ...sv }));
  const plants = out.filter((sv) => sv.guid === OIL_POWER_GUID);
  report.plants = plants.length;
  if (!plants.length) {
    report.notes.push('keine Ölkraftwerke im Plan');
    return { services: out, rails: [], report };
  }

  // Haus je Kachel (zum Entfernen)
  const houseAt = new Int32Array(w * h).fill(-1);
  s.houses.forEach((hs, k) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) houseAt[idx(hs.x + dx, hs.y + dy)] = k;
  });
  const removed = new Set<number>();
  const removeHouseAt = (i: number): void => {
    const k = houseAt[i];
    if (k < 0 || removed.has(k)) return;
    removed.add(k);
    const hs = s.houses[k];
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const j = idx(hs.x + dx, hs.y + dy);
      if (cell[j] === HOUSE) cell[j] = FREE;
      houseAt[j] = -1;
    }
  };
  const isLand = (i: number): boolean => cell[i] === FREE || cell[i] === HOUSE || cell[i] === ROAD;
  const blocked = (i: number): boolean => !!opts.blocked?.[i];

  // --- 1. Ölhafen: ganz im Hafengebiet (ohne Hafengebiet: auf Wasser), Ausfahrt auf Land,
  //        möglichst nah an den Kraftwerken.
  const cx = plants.reduce((a, p) => a + p.x + 2, 0) / plants.length;
  const cy = plants.reduce((a, p) => a + p.y + 2, 0) / plants.length;
  // Ohne markiertes Hafengebiet: nur Wasser, das mit dem offenen Meer am Kartenrand verbunden ist
  // (keine Flüsse oder Binnenseen).
  let ocean: Uint8Array | null = null;
  if (!opts.harbor) {
    ocean = new Uint8Array(w * h);
    const stack: number[] = [];
    const seed = (i: number): void => {
      if (!mask.data[i] && !ocean![i]) {
        ocean![i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < w; x++) {
      seed(x);
      seed((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      seed(y * w);
      seed(y * w + w - 1);
    }
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i + w < w * h) seed(i + w);
    }
  }
  const harborOk = (i: number): boolean =>
    (opts.harbor ? !!opts.harbor[i] : cell[i] === WATER && !!ocean?.[i]) && !blocked(i) && cell[i] !== SERVICE;
  let best: { x: number; y: number; t: number; cost: number } | null = null;
  for (let t = 0; t < 4; t++) {
    const probe = harborShape(0, 0, t);
    for (let y = 0; y + probe.h <= h; y++) {
      for (let x = 0; x + probe.w <= w; x++) {
        const sh = harborShape(x, y, t);
        const [ex, ey] = sh.exit;
        if (!inside(ex, ey)) continue;
        const ei = idx(ex, ey);
        if (!isLand(ei) || blocked(ei) || cell[ei] === ROAD) continue;
        let ok = true;
        for (let dy = 0; dy < sh.h && ok; dy++) for (let dx = 0; dx < sh.w; dx++) if (!harborOk(idx(x + dx, y + dy))) {
          ok = false;
          break;
        }
        if (!ok) continue;
        // Ohne Hafengebiet: vor der Wasserseite offenes Meer (12 tief, 4 breiter) – kein Fluss
        if (!opts.harbor) {
          const back = (sh.side + 2) % 4;
          const across = back % 2 === 0 ? sh.h : sh.w;
          let open = true;
          for (let d = 1; d <= 12 && open; d++) {
            for (let a = -4; a < across + 4; a++) {
              const px = back === 0 ? x + sh.w - 1 + d : back === 2 ? x - d : x + a;
              const py = back === 3 ? y + sh.h - 1 + d : back === 1 ? y - d : y + a;
              if (!inside(px, py) || !ocean?.[idx(px, py)]) {
                open = false;
                break;
              }
            }
          }
          if (!open) continue;
        }
        const cost = Math.hypot(ex - cx, ey - cy) + (cell[ei] === HOUSE ? 20 : 0);
        if (!best || cost < best.cost) best = { x, y, t, cost };
      }
    }
  }
  if (!best) {
    report.notes.push(opts.harbor ? 'kein Platz für den Ölhafen im Hafengebiet' : 'kein Platz für den Ölhafen am Ufer (Hafengebiet im Stempel mit Kaistraße markieren)');
    return { services: out, rails: [], report };
  }
  report.harbor = true;
  const hsh = harborShape(best.x, best.y, best.t);
  out.push({ guid: OIL_HARBOR_GUID, kind: lookup(OIL_HARBOR_GUID).kind, name: lookup(OIL_HARBOR_GUID).name, x: best.x, y: best.y, w: hsh.w, h: hsh.h, turns: best.t });
  for (let dy = 0; dy < hsh.h; dy++) for (let dx = 0; dx < hsh.w; dx++) cell[idx(best.x + dx, best.y + dy)] = SERVICE;
  const rail = new Uint8Array(w * h);
  for (const [x, y] of hsh.inner) rail[idx(x, y)] = 1;

  // --- 2. Raffinerien mit Bohrtürmen (eigene Ölquellen): Block 14 × 5 (Drehung 0: Bohrtürme
  //        links in einer Reihe, Raffinerie rechts, Ausfahrt rechts), nah am Ölhafen.
  /**
   * Anlaufpunkt einer Ausfahrt: liegt die Ausfahrtskachel auf einer Straße, geht das Gleis gerade
   * über höchstens 2 Straßenkacheln (Bahnübergang) zur ersten freien Kachel dahinter.
   */
  const approach = (x: number, y: number, side: Side): { goal: number; between: number[] } | null => {
    const between: number[] = [];
    let cx2 = x;
    let cy2 = y;
    while (inside(cx2, cy2) && cell[idx(cx2, cy2)] === ROAD && between.length < 3) {
      between.push(idx(cx2, cy2));
      cx2 += DX[side];
      cy2 += DY[side];
    }
    if (between.length > 2 || !inside(cx2, cy2)) return null;
    const g = idx(cx2, cy2);
    if (blocked(g) || (cell[g] !== FREE && cell[g] !== HOUSE)) return null;
    return { goal: g, between };
  };
  const targets: Array<{ exits: Array<[number, number, Side]>; apply: (side: Side) => void; label: string }> = [];
  if (opts.wells > 0) {
    const refineries = Math.ceil(opts.wells / WELLS_PER_REFINERY);
    let left = opts.wells;
    const [hx, hy] = hsh.exit;
    for (let r = 0; r < refineries; r++) {
      const n = Math.min(WELLS_PER_REFINERY, Math.ceil(left / (refineries - r)));
      left -= n;
      // Teile im ungedrehten Block (Breite 9 + 5, Höhe 5)
      const parts0: Array<{ guid: number; x: number; y: number; w: number; h: number }> = [];
      for (let k = 0; k < n; k++) parts0.push({ guid: OIL_WELL_GUID, x: 9 - 3 * (k + 1), y: 0, w: 3, h: 3 });
      parts0.push({ guid: OIL_REFINERY_GUID, x: 9, y: 0, w: 5, h: 5 });
      const BW = 14;
      const BH = 5;
      let bestB: { x: number; y: number; side: Side; cost: number } | null = null;
      for (const side of [0, 1, 2, 3] as Side[]) {
        const bw = side % 2 ? BH : BW;
        const bh = side % 2 ? BW : BH;
        const y0 = Math.max(0, hy - 120);
        const x0 = Math.max(0, hx - 120);
        for (let y = y0; y + bh <= Math.min(h, hy + 120); y++) {
          for (let x = x0; x + bw <= Math.min(w, hx + 120); x++) {
            let cost = 0;
            let ok = true;
            const seen = new Set<number>();
            for (const p of parts0) {
              const q = rotRect(p, side, BW, BH);
              for (let dy = 0; dy < q.h && ok; dy++) {
                for (let dx = 0; dx < q.w; dx++) {
                  const i = idx(x + q.x + dx, y + q.y + dy);
                  const c = cell[i];
                  if (blocked(i) || (c !== FREE && c !== HOUSE)) {
                    ok = false;
                    break;
                  }
                  if (c === HOUSE && !seen.has(houseAt[i])) {
                    seen.add(houseAt[i]);
                    cost += 25;
                  }
                }
              }
              if (!ok) break;
            }
            if (!ok) continue;
            // Vor der Ausfahrt der Raffinerie muss das Gleis weiterkommen
            const rq = rotRect(parts0[parts0.length - 1], side, BW, BH);
            const [ex, ey] = stationRail(x + rq.x, y + rq.y, side).exit;
            if (!inside(ex, ey) || !approach(ex, ey, side)) continue;
            cost += 0.6 * Math.hypot(x + bw / 2 - hx, y + bh / 2 - hy);
            if (!bestB || cost < bestB.cost) bestB = { x, y, side, cost };
          }
        }
      }
      if (!bestB) {
        report.notes.push(`kein Platz für Raffinerie ${r + 1}`);
        continue;
      }
      const owner = OIL_OWNER_BASE + r;
      let refinery: PlacedService | null = null;
      for (const p of parts0) {
        const q = rotRect(p, bestB.side, BW, BH);
        const x = bestB.x + q.x;
        const y = bestB.y + q.y;
        for (let dy = 0; dy < q.h; dy++) for (let dx = 0; dx < q.w; dx++) {
          const i = idx(x + dx, y + dy);
          if (cell[i] === HOUSE) removeHouseAt(i);
        }
        for (let dy = 0; dy < q.h; dy++) for (let dx = 0; dx < q.w; dx++) cell[idx(x + dx, y + dy)] = SERVICE;
        const sv: PlacedService = { guid: p.guid, kind: lookup(p.guid).kind, name: lookup(p.guid).name, x, y, w: q.w, h: q.h, turns: 0, owner };
        out.push(sv);
        if (p.guid === OIL_REFINERY_GUID) refinery = sv;
        else report.wells++;
      }
      report.refineries++;
      const ref = refinery as PlacedService;
      // Ausfahrt der Raffinerie zeigt im Block nach außen (Drehung 0: rechts)
      const side = bestB.side;
      targets.push({
        label: 'Raffinerie',
        exits: [[...stationRail(ref.x, ref.y, side).exit, side]],
        apply: (sd) => {
          ref.turns = turnsForSide(sd);
          for (const [x, y] of stationRail(ref.x, ref.y, sd).inner) rail[idx(x, y)] = 1;
        },
      });
    }
  }
  for (const p of plants) {
    targets.push({
      label: 'Kraftwerk',
      exits: ([0, 1, 2, 3] as Side[]).map((sd) => [...stationRail(p.x, p.y, sd).exit, sd] as [number, number, Side]),
      apply: (sd) => {
        p.turns = turnsForSide(sd);
        for (const [x, y] of stationRail(p.x, p.y, sd).inner) rail[idx(x, y)] = 1;
      },
    });
  }

  // --- 3. Gleise: schrittweise den nächsten noch nicht angeschlossenen Bahnhof an das Netz
  //        hängen (Dijkstra von allen Netzkacheln). Kosten: freies Land 1, Haus 6 je Kachel,
  //        Straße nur quer (1–2 Kacheln am Stück, kein Abbiegen darauf), Wasser als Brücke
  //        (gerade, höchstens 12 Kacheln).
  const net: number[] = [];
  const [hx, hy] = hsh.exit;
  const pass = (i: number): boolean => !blocked(i) && (cell[i] === FREE || cell[i] === HOUSE);
  if (!pass(idx(hx, hy))) report.notes.push('Ausfahrt des Ölhafens verbaut');
  rail[idx(hx, hy)] = 1;
  net.push(idx(hx, hy));
  const stepCost = (i: number): number => (cell[i] === HOUSE ? 6 : 1);
  /** Aufschlag je Abbiegen: gerade Strecken statt Treppen. */
  const TURN = 0.6;
  const pending = targets.slice();
  // Knoten = Kachel × Fahrtrichtung (zuletzt gefahrene Richtung)
  const dist = new Float64Array(w * h * 4);
  const prev = new Int32Array(w * h * 4);
  const via = new Int32Array(w * h * 4); // Länge eines Sprungs (Straße/Wasser) vor dieser Kachel
  while (pending.length) {
    dist.fill(Infinity);
    prev.fill(-1);
    via.fill(0);
    const heap = new Heap();
    for (const i of net) {
      for (let dir = 0; dir < 4; dir++) {
        dist[i * 4 + dir] = 0;
        heap.push(0, i * 4 + dir);
      }
    }
    // Zielkacheln (Anlaufpunkte) → Ziel, Seite und Übergänge davor
    const goal = new Map<number, Array<{ t: number; side: Side; between: number[] }>>();
    pending.forEach((tg, t) => {
      for (const [x, y, sd] of tg.exits) {
        if (!inside(x, y)) continue;
        const a = approach(x, y, sd);
        if (!a) continue;
        const list = goal.get(a.goal) ?? [];
        list.push({ t, side: sd, between: a.between });
        goal.set(a.goal, list);
      }
    });
    let found = -1;
    while (heap.size) {
      const [d, node] = heap.pop();
      if (d > dist[node]) continue;
      const i = node >> 2;
      const from = node & 3;
      if (goal.has(i)) {
        found = node;
        break;
      }
      const x = i % w;
      const y = (i - x) / w;
      for (let dir = 0; dir < 4; dir++) {
        let nx = x + DX[dir];
        let ny = y + DY[dir];
        if (!inside(nx, ny)) continue;
        let n = idx(nx, ny);
        let extra = 0;
        let jump = 0;
        if (cell[n] === ROAD || cell[n] === WATER || cell[n] === BRIDGE) {
          // Sprung über 1–2 Straßenkacheln (Bahnübergang) oder bis 12 Kacheln Wasser (Brücke)
          const road = cell[n] === ROAD;
          const max = road ? 2 : 12;
          let k = 0;
          while (k < max && inside(nx, ny) && (road ? cell[n] === ROAD : cell[n] === WATER) && !blocked(n)) {
            k++;
            nx += DX[dir];
            ny += DY[dir];
            if (!inside(nx, ny)) break;
            n = idx(nx, ny);
          }
          if (!inside(nx, ny) || !(pass(n) || rail[n])) continue;
          jump = k;
          extra = road ? 3 * k : 4 * k;
        } else if (!pass(n) && !rail[n]) continue;
        const nd = d + stepCost(n) + extra + (dir !== from && dist[node] > 0 ? TURN : 0);
        const nn = n * 4 + dir;
        if (nd < dist[nn]) {
          dist[nn] = nd;
          prev[nn] = node;
          via[nn] = jump;
          heap.push(nd, nn);
        }
      }
    }
    if (found < 0) {
      for (const tg of pending) report.notes.push(`${tg.label} ohne Gleisweg`);
      break;
    }
    // Weg übernehmen
    for (let node = found; node >= 0 && dist[node] > 0; node = prev[node]) {
      const i = node >> 2;
      const dir = node & 3;
      if (cell[i] === HOUSE) removeHouseAt(i);
      rail[i] = 1;
      net.push(i);
      for (let k = 1; k <= via[node]; k++) {
        const j = i - k * (DX[dir] + DY[dir] * w);
        rail[j] = 1;
        if (cell[j] === ROAD) report.crossings++;
        else report.bridges++;
      }
    }
    found >>= 2;
    // Ziele an dieser Kachel anschließen (je Ziel die erreichte Seite)
    const hits = goal.get(found) ?? [];
    const done = new Set<number>();
    for (const { t, side, between } of hits) {
      if (done.has(t)) continue;
      done.add(t);
      for (const j of between) {
        rail[j] = 1;
        report.crossings++;
      }
      pending[t].apply(side);
      report.connected++;
    }
    for (const t of [...done].sort((a, b) => b - a)) pending.splice(t, 1);
  }

  // Gleiskacheln: reine Gleiskacheln blockieren (keine Häuser/Briefkästen darauf)
  const rails: number[] = [];
  for (let i = 0; i < rail.length; i++) {
    if (!rail[i]) continue;
    rails.push(i);
    if (cell[i] === FREE) cell[i] = SERVICE;
  }
  report.railTiles = rails.length;
  report.houses = removed.size;
  s.houses = s.houses.filter((_, k) => !removed.has(k));
  return { services: out, rails, report };
}

/** Rechteck im Block (Breite bw, Höhe bh) für eine Ausfahrtsseite drehen (gegen den Uhrzeigersinn). */
function rotRect(r: { x: number; y: number; w: number; h: number }, side: Side, bw: number, bh: number): { x: number; y: number; w: number; h: number } {
  let q = { ...r };
  let W = bw;
  let H = bh;
  for (let k = 0; k < side; k++) {
    q = { x: q.y, y: W - q.x - q.w, w: q.h, h: q.w };
    [W, H] = [H, W];
  }
  return q;
}
