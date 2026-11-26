// Umbau um Gleise (Ölmodus, nach dem Gleisbau): Ein gerades Gleisstück zwischen zwei
// Querstraßen schneidet eine Hausspalte an – übrig bleiben 1–2 Kacheln breite Streifen, in die
// kein Haus passt. Hier wird der Streifen zwischen den beiden Querstraßen über mehrere
// Längsstraßen hinweg geräumt und exakt neu aufgeteilt (dynamische Programmierung quer zum Gleis):
// Längsstraßen, Hausspalten (3 breit) und Leerspalten so, dass möglichst viele Häuser
// hineinpassen; jede Hausspalte liegt an einer Längsstraße (die äußersten Häuser hängen ohnehin
// an den Querstraßen). Übernommen nur bei mehr Häusern und ohne zusätzliche Straßennetze.
import { BLOCKED, BRIDGE, FREE, HOUSE, labelComponents, placeHouse, ROAD, SERVICE, WATER, type FillState } from './fill';

export interface RelaneResult {
  windows: number;
  gained: number;
  /** Diagnose: Gleisstücke, Fenster ohne Grenzen, abgelehnte Fenster nach Grund, ohne Gewinn. */
  stats: Record<string, number>;
}

/**
 * `rail`: Gleiskacheln (Maske, 1 = Gleis). Gleiskacheln sind im Zustand SERVICE (bzw. ROAD
 * an Bahnübergängen); sie bleiben, wo sie sind.
 */
export function relaneAroundRails(
  s: FillState,
  rail: Uint8Array,
  services?: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
): RelaneResult {
  const res: RelaneResult = { windows: 0, gained: 0, stats: {} };
  for (const vertical of [true, false]) relaneAxis(s, rail, vertical, services, res);
  return res;
}

function relaneAxis(
  s: FillState,
  rail: Uint8Array,
  vertical: boolean,
  services: ReadonlyArray<{ x: number; y: number; w: number; h: number }> | undefined,
  res: RelaneResult,
): void {
  const { w, h, cell } = s;
  // u = quer zum Gleis, v = längs des Gleises
  const U = vertical ? w : h;
  const Vn = vertical ? h : w;
  const at = (u: number, v: number): number => (vertical ? v * w + u : u * w + v);
  const inside = (u: number, v: number): boolean => u >= 0 && v >= 0 && u < U && v < Vn;
  const isRail = (u: number, v: number): boolean => inside(u, v) && rail[at(u, v)] === 1;

  // Haus je Kachel (für „ganz im Fenster“)
  const houseAt = new Int32Array(w * h).fill(-1);
  const rebuildHouseAt = (): void => {
    houseAt.fill(-1);
    s.houses.forEach((hs, k) => {
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) houseAt[(hs.y + dy) * w + hs.x + dx] = k;
    });
  };
  rebuildHouseAt();

  // Gerade Gleisstücke längs v (ohne Bahnübergänge), mindestens 4 lang
  const runs: Array<{ u: number; v0: number; v1: number }> = [];
  for (let u = 0; u < U; u++) {
    let v = 0;
    while (v < Vn) {
      if (isRail(u, v) && cell[at(u, v)] !== ROAD && (isRail(u, v - 1) || isRail(u, v + 1))) {
        let e = v;
        while (e + 1 < Vn && isRail(u, e + 1) && cell[at(u, e + 1)] !== ROAD) e++;
        if (e - v + 1 >= 4) runs.push({ u, v0: v, v1: e });
        v = e + 1;
      } else v++;
    }
  }

  const roadRow = (v: number, u0: number, u1: number): boolean => {
    if (v < 0 || v >= Vn) return false;
    for (let u = u0; u <= u1; u++) {
      const c = cell[at(u, v)];
      if (c !== ROAD && c !== WATER && c !== BRIDGE) return false;
    }
    return true;
  };

  const stat = (k: string): void => {
    res.stats[k] = (res.stats[k] ?? 0) + 1;
  };
  for (const run of runs) {
    stat('runs');
    // Fenster längs: zunächst das Gleisstück; je Spaltenpaar dann bis zur nächsten durchgehenden
    // Querstraße darüber und darunter erweitert (das Gleis darf seitlich hinauslaufen).
    let v0 = run.v0;
    let v1 = run.v1;
    // Spalten links/rechts: Kandidaten für die Fenstergrenzen (Längsstraßen über die ganze Höhe
    // oder harte Grenzen wie Wasser)
    const colKind = (u: number): 'road' | 'hard' | 'open' | 'bad' => {
      if (u < 0 || u >= U) return 'hard';
      let road = 0;
      let water = 0;
      for (let v = v0; v <= v1; v++) {
        const c = cell[at(u, v)];
        if (c === ROAD) road++;
        else if (c === WATER) water++;
        else if (c === SERVICE && !isRail(u, v)) return 'bad';
        else if (c === BLOCKED || c === BRIDGE) return 'bad';
      }
      const n = v1 - v0 + 1;
      if (road === n) return 'road';
      if (water === n) return 'hard';
      return 'open';
    };
    // Grenzspalten: jede Spalte bis 24 Kacheln neben dem Gleis (an Gebäuden/Brücken endet die Suche)
    const hardIn = (u: number): boolean => {
      for (let v = run.v0; v <= run.v1; v++) {
        const c = cell[at(u, v)];
        if ((c === SERVICE && !isRail(u, v)) || c === BLOCKED || c === BRIDGE) return true;
      }
      return false;
    };
    const lefts: number[] = [];
    const rights: number[] = [];
    for (let u = run.u - 1; u >= Math.max(-1, run.u - 24); u--) {
      lefts.push(u);
      if (u < 0 || hardIn(u)) break;
    }
    for (let u = run.u + 1; u <= Math.min(U, run.u + 24); u++) {
      rights.push(u);
      if (u >= U || hardIn(u)) break;
    }
    let best: { ua: number; ub: number; vt: number; vb: number; gain: number; plan: Array<{ kind: 'R' | 'H'; u: number }> } | null = null;
    for (const ua of lefts) {
      for (const ub of rights) {
        if (ub - ua - 1 < 3) continue;
        v0 = run.v0;
        v1 = run.v1;
        let vt = v0;
        while (vt - 1 >= 0 && run.v0 - vt < 40 && !roadRow(vt - 1, ua + 1, ub - 1)) vt--;
        let vb = v1;
        while (vb + 1 < Vn && vb - run.v1 < 40 && !roadRow(vb + 1, ua + 1, ub - 1)) vb++;
        if (!roadRow(vt - 1, ua + 1, ub - 1) || !roadRow(vb + 1, ua + 1, ub - 1)) {
          stat('rows');
          continue;
        }
        v0 = vt;
        v1 = vb;
        const r = evaluate(ua, ub);
        if (r && (!best || r.gain > best.gain)) best = { ua, ub, vt, vb, ...r };
      }
    }
    v0 = best?.vt ?? run.v0;
    v1 = best?.vb ?? run.v1;
    if (!lefts.length || !rights.length) stat('noBounds');
    if (!best || best.gain <= 0) {
      stat(best ? 'noGain' : 'noWindow');
      continue;
    }
    if (apply(best.ua, best.ub, best.plan)) {
      res.windows++;
      res.gained += best.gain;
    }

    /** Fenster (ua, ub) exklusiv × [v0, v1]: alte Häuser zählen, Neubelegung per DP. */
    function evaluate(ua: number, ub: number): { gain: number; plan: Array<{ kind: 'R' | 'H'; u: number }> } | null {
      if (ub - ua - 1 < 3) return null;
      const old = new Set<number>();
      for (let u = ua + 1; u < ub; u++) {
        for (let v = v0; v <= v1; v++) {
          const i = at(u, v);
          const c = cell[i];
          if (c === SERVICE && !rail[i]) {
            stat('service');
            return null;
          }
          if (c === BLOCKED || c === BRIDGE) {
            stat('blocked');
            return null;
          }
          if (c === HOUSE) {
            const k = houseAt[i];
            const hs = s.houses[k];
            // Haus ganz im Fenster?
            const hu = vertical ? hs.x : hs.y;
            const hv = vertical ? hs.y : hs.x;
            if (hu < ua + 1 || hu + 2 > ub - 1 || hv < v0 || hv + 2 > v1) {
              stat('straddle');
              return null;
            }
            old.add(k);
          }
        }
      }
      // Freie Höhe je Spalte: Segmente ohne Gleis/Wasser
      const width = ub - ua - 1;
      const blockedCol = (u: number, v: number): boolean => {
        const i = at(u, v);
        return rail[i] === 1 || cell[i] === WATER;
      };
      const roadOk = new Uint8Array(width);
      for (let k = 0; k < width; k++) {
        let ok = 1;
        for (let v = v0; v <= v1; v++) if (blockedCol(ua + 1 + k, v)) ok = 0;
        roadOk[k] = ok;
      }
      const housesAt = new Int32Array(width);
      for (let k = 0; k + 3 <= width; k++) {
        let n = 0;
        let run = 0;
        for (let v = v0; v <= v1 + 1; v++) {
          const free = v <= v1 && !blockedCol(ua + 1 + k, v) && !blockedCol(ua + 2 + k, v) && !blockedCol(ua + 3 + k, v);
          if (free) run++;
          else {
            n += Math.floor(run / 3);
            run = 0;
          }
        }
        housesAt[k] = n;
      }
      const leftRoad = colKind(ua) === 'road';
      const rightRoad = colKind(ub) === 'road';
      // DP: Zustand 0 = Straße davor, 1 = Haus mit Anschluss, 2 = Haus wartet auf Straße, 3 = leer
      const NEG = -1e9;
      const dp: number[][] = Array.from({ length: width + 1 }, () => [NEG, NEG, NEG, NEG]);
      const from: Array<Array<[number, number, 'R' | 'H' | 'E'] | null>> = Array.from({ length: width + 1 }, () => [null, null, null, null]);
      dp[0][leftRoad ? 0 : 3] = 0;
      for (let k = 0; k < width; k++) {
        for (let st = 0; st < 4; st++) {
          const val = dp[k][st];
          if (val <= NEG / 2) continue;
          // Straße (kleiner Abzug: lieber weniger Straßen bei Gleichstand)
          if (roadOk[k]) {
            const nv = val - 0.01;
            if (nv > dp[k + 1][0]) {
              dp[k + 1][0] = nv;
              from[k + 1][0] = [k, st, 'R'];
            }
          }
          // Haus (3 breit)
          if (k + 3 <= width && st !== 2 && housesAt[k] > 0) {
            const ns = st === 0 ? 1 : 2;
            const nv = val + housesAt[k];
            if (nv > dp[k + 3][ns]) {
              dp[k + 3][ns] = nv;
              from[k + 3][ns] = [k, st, 'H'];
            }
          }
          // leer
          if (st !== 2) {
            if (val > dp[k + 1][3]) {
              dp[k + 1][3] = val;
              from[k + 1][3] = [k, st, 'E'];
            }
          }
        }
      }
      let endSt = -1;
      let endVal = NEG;
      for (let st = 0; st < 4; st++) {
        if (st === 2 && !rightRoad) continue;
        if (dp[width][st] > endVal) {
          endVal = dp[width][st];
          endSt = st;
        }
      }
      if (endSt < 0) return null;
      const plan: Array<{ kind: 'R' | 'H'; u: number }> = [];
      for (let k = width, st = endSt; k > 0; ) {
        const f = from[k][st];
        if (!f) return null;
        if (f[2] !== 'E') plan.push({ kind: f[2], u: ua + 1 + f[0] });
        k = f[0];
        st = f[1];
      }
      const newHouses = plan.filter((p) => p.kind === 'H').reduce((a, p) => a + housesAt[p.u - ua - 1], 0);
      return { gain: newHouses - old.size, plan };
    }

    function apply(ua: number, ub: number, plan: Array<{ kind: 'R' | 'H'; u: number }>): boolean {
      const before = networks();
      // Wer vorher an der Straße lag, muss es danach auch (Häuser außerhalb, Gebäude am Fenster)
      const near = (x: number, y: number, ww: number, hh: number): boolean => {
        const [x0, x1, y0, y1] = vertical ? [ua - 1, ub + 1, v0 - 2, v1 + 2] : [v0 - 2, v1 + 2, ua - 1, ub + 1];
        return x + ww >= x0 && x <= x1 && y + hh >= y0 && y <= y1;
      };
      const hasRoad = (x: number, y: number, ww: number, hh: number): boolean => {
        const ok = (px: number, py: number): boolean => px >= 0 && py >= 0 && px < w && py < h && cell[py * w + px] === ROAD;
        for (let d = 0; d < ww; d++) if (ok(x + d, y - 1) || ok(x + d, y + hh)) return true;
        for (let d = 0; d < hh; d++) if (ok(x - 1, y + d) || ok(x + ww, y + d)) return true;
        return false;
      };
      const watchServices = (services ?? []).filter((sv) => near(sv.x, sv.y, sv.w, sv.h) && hasRoad(sv.x, sv.y, sv.w, sv.h));
      const accessKept = (): boolean =>
        watchServices.every((sv) => hasRoad(sv.x, sv.y, sv.w, sv.h)) &&
        s.houses.every((hs) => !near(hs.x, hs.y, 3, 3) || hasRoad(hs.x, hs.y, 3, 3));
      const saveCell = cell.slice();
      const saveHouses = s.houses.slice();
      // räumen
      const remove = new Set<number>();
      for (let u = ua + 1; u < ub; u++) {
        for (let v = v0; v <= v1; v++) {
          const i = at(u, v);
          if (cell[i] === HOUSE) remove.add(houseAt[i]);
          if (cell[i] === HOUSE || cell[i] === ROAD) cell[i] = rail[i] ? SERVICE : FREE;
        }
      }
      s.houses = s.houses.filter((_, k) => !remove.has(k));
      // neu belegen
      for (const p of plan) {
        if (p.kind === 'R') for (let v = v0; v <= v1; v++) cell[at(p.u, v)] = ROAD;
      }
      for (const p of plan) {
        if (p.kind !== 'H') continue;
        let run = 0;
        for (let v = v0; v <= v1 + 1; v++) {
          const free = v <= v1 && [0, 1, 2].every((d) => cell[at(p.u + d, v)] === FREE);
          if (free) {
            run++;
            if (run === 3) {
              const hv = v - 2;
              placeHouse(s, vertical ? p.u : hv, vertical ? hv : p.u, 0);
              run = 0;
            }
          } else run = 0;
        }
      }
      if (networks() > before || !accessKept()) {
        stat('network');
        cell.set(saveCell);
        s.houses = saveHouses;
        rebuildHouseAt();
        return false;
      }
      rebuildHouseAt();
      return true;
    }
  }

  function networks(): number {
    const lab = labelComponents(w, h, (i) => cell[i] === ROAD || cell[i] === BRIDGE);
    let n = 0;
    for (let i = 0; i < lab.length; i++) if (lab[i] + 1 > n) n = lab[i] + 1;
    return n;
  }
}
