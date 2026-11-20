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
  mailResidentsFor,
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
  /** Ingenieure (Einwohner) im Ergebnis und geforderte Mindestzahl. */
  engineers: number;
  minEngineers: number;
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
  options: {
    minEngineers?: number;
    /** Post-Arten, die versorgt werden (Post-Einwohner wachsen je Stufe, volle Versorgung angenommen). */
    mailTypes?: ReadonlyArray<'local' | 'regional' | 'overseas'>;
  } = {},
): LevelResult {
  // Mindestzahl Ingenieure (Arbeitskraft z. B. für Kraftwerke): Strafe je
  // fehlendem Ingenieur, Ingenieure sind dann in jeder Bauweise erlaubt.
  const minEng = Math.max(0, options.minEngineers ?? 0);
  const PENALTY = 60;
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
      townHall4: r.townHall4,
      hasRoad: r.hasRoad,
    };
    STATES.forEach((st, s) => {
      for (let p = 0; p <= 5; p++) {
        table[(i * 4 + s) * 6 + p] =
          skyscraperResidents(st.tier, st.level, p, supply, rules).residents +
          (options.mailTypes?.length && r.hasRoad ? mailResidentsFor(st.tier, st.level, options.mailTypes) : 0);
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
  const engineersOf = (state: Int8Array): number => {
    let t = 0;
    for (let i = 0; i < n; i++) if (state[i] === 0) t += valueOf(i, state);
    return t;
  };
  /** Einwohner und Ingenieure der Häuser i und Nachbarn. */
  const localOf = (i: number, state: Int8Array): [number, number] => {
    let v = valueOf(i, state);
    let e = state[i] === 0 ? v : 0;
    const ids = nbr[i];
    for (let k = 0; k < ids.length; k++) {
      const x = valueOf(ids[k], state);
      v += x;
      if (state[ids[k]] === 0) e += x;
    }
    return [v, e];
  };
  const objective = (total: number, eng: number): number => total - PENALTY * Math.max(0, minEng - eng);

  const stateIndex = (r: ResidenceInfo): number => (r.tier === 'engineer' ? 0 : r.level === 5 ? 3 : r.level === 4 ? 2 : 1);
  const initial = Int8Array.from(sky.map(stateIndex));
  const startResidents = totalOf(initial);

  const anneal = (
    m: Exclude<LevelMode, 'auto'>,
    ms: number,
    s0: number,
  ): { state: Int8Array; value: number; engineers: number; score: number } => {
    const allowed = minEng > 0 && !ALLOWED[m].includes(0) ? [0, ...ALLOWED[m]] : ALLOWED[m];
    const rnd = mulberry32(s0);
    const state = Int8Array.from(initial);
    // Start: Ausgangsschichten auf erlaubte Zustände abbilden.
    for (let i = 0; i < n; i++) {
      if (allowed.includes(state[i])) continue;
      state[i] = m === '45' ? (state[i] === 0 ? 2 : 3) : allowed[0];
    }
    let total = totalOf(state);
    let eng = engineersOf(state);
    let cur = objective(total, eng);
    let best = { state: Int8Array.from(state), score: cur };
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
      const [vb, eb] = localOf(i, state);
      state[i] = next;
      const [va, ea] = localOf(i, state);
      const nt = total + va - vb;
      const ne = eng + ea - eb;
      const score = objective(nt, ne);
      const d = score - cur;
      if (d >= 0 || rnd() < Math.exp(d / t)) {
        total = nt;
        eng = ne;
        cur = score;
        if (cur > best.score) best = { state: Int8Array.from(state), score: cur };
      } else {
        state[i] = old;
      }
    }
    // Abschluss: gierig, bis keine Einzeländerung mehr hilft.
    const st = best.state;
    total = totalOf(st);
    eng = engineersOf(st);
    for (let round = 0; round < 10; round++) {
      let improved = false;
      for (let i = 0; i < n; i++) {
        const old = st[i];
        const [vb, eb] = localOf(i, st);
        const base = objective(total, eng);
        let bestS = old;
        let bestScore = base;
        let bestT = total;
        let bestE = eng;
        for (const s2 of allowed) {
          if (s2 === old) continue;
          st[i] = s2;
          const [va, ea] = localOf(i, st);
          const nt = total + va - vb;
          const ne = eng + ea - eb;
          const sc = objective(nt, ne);
          if (sc > bestScore + 1e-9) {
            bestScore = sc;
            bestS = s2;
            bestT = nt;
            bestE = ne;
          }
        }
        st[i] = bestS;
        if (bestS !== old) {
          total = bestT;
          eng = bestE;
          improved = true;
        }
      }
      if (!improved) break;
    }
    const value = total;
    return { state: st, value, engineers: eng, score: objective(total, eng) };
  };

  const modes: Array<Exclude<LevelMode, 'auto'>> = mode === 'auto' ? ['335', '45', 'free'] : [mode];
  const tried: LevelResult['tried'] = [];
  let bestRun: { state: Int8Array; value: number; engineers: number; score: number; mode: Exclude<LevelMode, 'auto'> } | null =
    null;
  modes.forEach((m, k) => {
    const run = anneal(m, budgetMs / modes.length, seed + k * 7919);
    tried.push({ mode: m, residents: run.value });
    if (!bestRun || run.score > bestRun.score) bestRun = { ...run, mode: m };
  });
  const result = bestRun as unknown as {
    state: Int8Array;
    value: number;
    engineers: number;
    mode: Exclude<LevelMode, 'auto'>;
  };
  const planned = new Map<number, HouseState>();
  const counts: Record<string, number> = { I3: 0, V3: 0, V4: 0, V5: 0 };
  sky.forEach((r, i) => {
    const st = STATES[result.state[i]];
    planned.set(r.building.index, st);
    counts[st.tier === 'engineer' ? 'I3' : `V${st.level}`]++;
  });
  return {
    planned,
    residents: result.value,
    startResidents,
    mode: result.mode,
    counts,
    tried,
    engineers: result.engineers,
    minEngineers: minEng,
  };
}
