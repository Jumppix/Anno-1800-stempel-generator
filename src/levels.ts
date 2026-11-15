// Hochhaus-Stufen optimieren (Bauweisen 3-3-5 und 4-5).
//
// Jedes Wohnhaus bekommt Schicht und Stufe: Ingenieur 3, Investor 3, 4 oder 5.
// Höhere Stufen haben mehr Einwohner und einen größeren Panorama-Radius; das
// Panorama eines Hauses steigt durch niedrigere Nachbarn (+1) und sinkt durch
// gleich hohe derselben Schicht oder höhere (−1). Gesucht ist die Verteilung
// mit den meisten Einwohnern – inklusive Versorgung (z. B. braucht Investor 5
// eine Drogerie) und Rathaus-Items. Verfahren: Simulated Annealing mit
// Einzelhaus-Änderungen; Einwohner je Haus/Zustand/Panorama vorab tabelliert.

import type { ResidenceInfo } from './analysis';
import {
  PANORAMA_RADIUS,
  panoramaDelta,
  skyscraperResidents,
  type RuleConfig,
  type SkyLevel,
  type SkyTier,
} from './rules';

export type LevelMode = 'l3' | '335' | '45' | 'free' | 'auto';

export interface HouseState {
  tier: SkyTier;
  level: SkyLevel;
}

const STATES: readonly HouseState[] = [
  { tier: 'engineer', level: 3 },
  { tier: 'investor', level: 3 },
  { tier: 'investor', level: 4 },
  { tier: 'investor', level: 5 },
];

const ALLOWED: Record<Exclude<LevelMode, 'auto'>, number[]> = {
  l3: [0, 1],
  '335': [0, 1, 3],
  '45': [2, 3],
  free: [0, 1, 2, 3],
};

export interface LevelResult {
  /** Gebäudeindex (Stadtmodell) → Schicht/Stufe. */
  planned: Map<number, HouseState>;
  residents: number;
  startResidents: number;
  mode: Exclude<LevelMode, 'auto'>;
  counts: Record<string, number>;
  /** Ergebnisse je geprüfter Bauweise (bei „auto“). */
  tried: Array<{ mode: Exclude<LevelMode, 'auto'>; residents: number }>;
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

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Optimiert die Stufen der Hochhäuser. `residences` aus der Analyse (Versorgung,
 * Rathausradius, Ausgangsschicht); Artisans/ohne Schicht bleiben unverändert.
 */
export function optimizeLevels(
  residences: readonly ResidenceInfo[],
  rules: RuleConfig,
  mode: LevelMode,
  budgetMs: number,
  seed = 1,
): LevelResult {
  const sky = residences.filter((r) => r.tier === 'engineer' || r.tier === 'investor');
  const n = sky.length;
  const cx = sky.map((r) => r.building.cx);
  const cy = sky.map((r) => r.building.cy);
  const maxR = PANORAMA_RADIUS[5];

  // Nachbarn im größten Radius (Raster-Buckets).
  const cell = 8;
  const buckets = new Map<string, number[]>();
  sky.forEach((_, i) => {
    const key = `${Math.floor(cx[i] / cell)},${Math.floor(cy[i] / cell)}`;
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  });
  const nbr: Int32Array[] = [];
  const nbrD: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const bx = Math.floor(cx[i] / cell);
    const by = Math.floor(cy[i] / cell);
    const ids: number[] = [];
    const ds: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
          if (j === i) continue;
          const d = Math.hypot(cx[i] - cx[j], cy[i] - cy[j]);
          if (d <= maxR + 1e-9) {
            ids.push(j);
            ds.push(d);
          }
        }
      }
    }
    nbr.push(Int32Array.from(ids));
    nbrD.push(Float32Array.from(ds));
  }

  // Einwohner je Haus × Zustand × Panorama-Stärke.
  const table = new Int32Array(n * 4 * 6);
  sky.forEach((r, i) => {
    const supply = {
      services: r.services,
      universityFactor: r.universityFactor,
      townHall: r.townHall !== null,
      hasRoad: r.hasRoad,
    };
    STATES.forEach((st, s) => {
      for (let p = 0; p <= 5; p++) {
        table[(i * 4 + s) * 6 + p] = skyscraperResidents(st.tier, st.level, p, supply, rules).residents;
      }
    });
  });
  // Paarweise Panorama-Beiträge je Zustand (s sieht Nachbarzustand t).
  const delta = new Int8Array(16);
  for (let s = 0; s < 4; s++) {
    for (let t = 0; t < 4; t++) {
      delta[s * 4 + t] = panoramaDelta(STATES[s].tier, STATES[s].level, STATES[t].tier, STATES[t].level);
    }
  }
  const radius = STATES.map((st) => PANORAMA_RADIUS[st.level] + 1e-9);

  const valueOf = (i: number, state: Int8Array): number => {
    const s = state[i];
    const r = radius[s];
    let v = STATES[s].level;
    const ids = nbr[i];
    const ds = nbrD[i];
    for (let k = 0; k < ids.length; k++) if (ds[k] <= r) v += delta[s * 4 + state[ids[k]]];
    const p = v < 0 ? 0 : v > 5 ? 5 : v;
    return table[(i * 4 + s) * 6 + p];
  };
  const totalOf = (state: Int8Array): number => {
    let t = 0;
    for (let i = 0; i < n; i++) t += valueOf(i, state);
    return t;
  };

  const stateIndex = (r: ResidenceInfo): number => (r.tier === 'engineer' ? 0 : r.level === 5 ? 3 : r.level === 4 ? 2 : 1);
  const initial = Int8Array.from(sky.map(stateIndex));
  const startResidents = totalOf(initial);

  const anneal = (m: Exclude<LevelMode, 'auto'>, ms: number, s0: number): { state: Int8Array; value: number } => {
    const allowed = ALLOWED[m];
    const rnd = mulberry32(s0);
    const state = Int8Array.from(initial);
    // Start: Ausgangsschichten auf erlaubte Zustände abbilden.
    for (let i = 0; i < n; i++) {
      if (allowed.includes(state[i])) continue;
      state[i] = m === '45' ? (state[i] === 0 ? 2 : 3) : allowed[0];
    }
    let cur = totalOf(state);
    let best = { state: Int8Array.from(state), value: cur };
    const deadline = now() + ms;
    const T0 = 40;
    const T1 = 0.3;
    let it = 0;
    let t = T0;
    while (n) {
      if ((it & 1023) === 0) {
        const frac = 1 - (deadline - now()) / ms;
        if (frac >= 1) break;
        t = T0 * Math.pow(T1 / T0, frac);
      }
      it++;
      const i = Math.floor(rnd() * n);
      const old = state[i];
      const next = allowed[Math.floor(rnd() * allowed.length)];
      if (next === old) continue;
      const ids = nbr[i];
      let before = valueOf(i, state);
      for (let k = 0; k < ids.length; k++) before += valueOf(ids[k], state);
      state[i] = next;
      let after = valueOf(i, state);
      for (let k = 0; k < ids.length; k++) after += valueOf(ids[k], state);
      const d = after - before;
      if (d >= 0 || rnd() < Math.exp(d / t)) {
        cur += d;
        if (cur > best.value) best = { state: Int8Array.from(state), value: cur };
      } else {
        state[i] = old;
      }
    }
    // Abschluss: gierig, bis keine Einzeländerung mehr hilft.
    const st = best.state;
    let value = totalOf(st);
    for (let round = 0; round < 10; round++) {
      let improved = false;
      for (let i = 0; i < n; i++) {
        const ids = nbr[i];
        const old = st[i];
        let before = valueOf(i, st);
        for (let k = 0; k < ids.length; k++) before += valueOf(ids[k], st);
        let bestS = old;
        let bestD = 0;
        for (const s of allowed) {
          if (s === old) continue;
          st[i] = s;
          let after = valueOf(i, st);
          for (let k = 0; k < ids.length; k++) after += valueOf(ids[k], st);
          if (after - before > bestD) {
            bestD = after - before;
            bestS = s;
          }
        }
        st[i] = bestS;
        if (bestS !== old) {
          value += bestD;
          improved = true;
        }
      }
      if (!improved) break;
    }
    return { state: st, value };
  };

  const modes: Array<Exclude<LevelMode, 'auto'>> = mode === 'auto' ? ['335', '45', 'free'] : [mode];
  const tried: LevelResult['tried'] = [];
  let bestRun: { state: Int8Array; value: number; mode: Exclude<LevelMode, 'auto'> } | null = null;
  modes.forEach((m, k) => {
    const run = anneal(m, budgetMs / modes.length, seed + k * 7919);
    tried.push({ mode: m, residents: run.value });
    if (!bestRun || run.value > bestRun.value) bestRun = { ...run, mode: m };
  });
  const result = bestRun as unknown as { state: Int8Array; value: number; mode: Exclude<LevelMode, 'auto'> };
  const planned = new Map<number, HouseState>();
  const counts: Record<string, number> = { I3: 0, V3: 0, V4: 0, V5: 0 };
  sky.forEach((r, i) => {
    const st = STATES[result.state[i]];
    planned.set(r.building.index, st);
    counts[st.tier === 'engineer' ? 'I3' : `V${st.level}`]++;
  });
  return { planned, residents: result.value, startResidents, mode: result.mode, counts, tried };
}
