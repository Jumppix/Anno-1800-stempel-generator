// Stadtplaner Phase 3: Versorgungsgebäude in den fertigen Wohnplan setzen.
//
// Kaufhaus, Einrichtungshaus, Drogerie, Universität und Gaskraftwerk wirken
// über die Straße (Breitensuche, wie in der Analyse). Jedes Gebäude ersetzt
// Häuser; gesucht sind Plätze, die viele noch unversorgte Häuser erreichen und
// wenige verdrängen (Überdeckungsproblem, gewichtet gierig):
//   Gewinn = Σ Wert der neu versorgten Häuser − Wert der verdrängten Häuser.
// Werte je Haus (Ø Ingenieur/Investor, Stufe 3): Kaufhaus 22,5 (+5 Item im
// Rathausradius), Einrichtungshaus 10 (+5), Drogerie 2,5 (+2,5), Universität
// 3 (+1), Strom 5; ein verdrängtes Haus kostet ≈ 225 (+31 im Rathausradius).
// Gebäude dürfen wie Rathäuser auf Querstraßen stehen, wenn das Netz
// zusammenhängt und kein Haus seinen Anschluss verliert.
// Danach Lagerhäuser (5×5), sodass jedes Kaufhaus/Einrichtungshaus/Drogerie/
// Kraftwerk eines in seiner Straßenreichweite hat.

import { footprint, lookup, type BuildingKind } from './catalog';
import { skyscraperResidents, UNIVERSITY_MAX_RANGE, universityFactor, type SkyLevel, type SkyTier } from './rules';
import { BLOCKED, BRIDGE, FREE, HOUSE, isWay, ROAD, SERVICE, WATER, touchesBridge, touchesRoad, type FillState } from './fill';

export interface PlacedService {
  guid: number;
  kind: BuildingKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  turns: number;
}

export interface ServiceSpec {
  kind: BuildingKind;
  guid: number;
  /**
   * Einwohner je versorgtem Haus (Mittel Ingenieur/Investor, Stufe 3, Wiki
   * „Needs“), zusätzlich im Rathausradius (Zofe/Saint), zusätzlich im
   * Rathausradius, wenn Waren nur über den Lieferdienst kommen.
   */
  value: number;
  itemValue: number;
  deliveryValue: number;
  /**
   * Betriebsaufwand je Gebäude in Einwohner-Gegenwert: Läden brauchen 240
   * Handwerker, drei Waren und Strom; das Kraftwerk Gas und Arbeitskraft.
   */
  fixedCost: number;
}

/**
 * Reihenfolge = Priorität. Strom: Ingenieure 2 / Investoren 8 plus +5 je
 * Panorama-Stufe (Strom ist eines der Panorama-Bedürfnisse) ≈ 30 bei intensiv.
 * Drogerie wirkt nur bei Ingenieuren (Investoren erst
 * ab Stufe 5): 5 + Zofe 5; mit Lieferdienst-Violinen zusätzlich 5 + Zofe 5.
 * Kaufhaus: 20/25 + Zofe 5; mit Lieferdienst-Kaugummi zusätzlich 10.
 * Universität: Ingenieure 6 (+ Saint 2), abgeschwächt bis 131 Kacheln.
 */
export const SERVICE_SPECS: readonly ServiceSpec[] = [
  { kind: 'departmentStore', guid: 135100, value: 22.5, itemValue: 5, deliveryValue: 10, fixedCost: 450 },
  { kind: 'furnitureStore', guid: 135099, value: 10, itemValue: 5, deliveryValue: 0, fixedCost: 450 },
  { kind: 'powerPlant', guid: 117547, value: 30, itemValue: 0, deliveryValue: 0, fixedCost: 225 },
  { kind: 'university', guid: 1010362, value: 3, itemValue: 1, deliveryValue: 0, fixedCost: 0 },
  { kind: 'drugStore', guid: 134629, value: 2.5, itemValue: 2.5, deliveryValue: 5, fixedCost: 450 },
];

export const WAREHOUSE_GUID = 1010371;
export const MINISTRY_GUID = 269602;

export interface ServiceOptions {
  kinds: ReadonlySet<BuildingKind>;
  /** Wert eines Hauses (Einwohner) und Zuschlag im Rathausradius. */
  houseValue?: number;
  townHallValue?: number;
  /**
   * Vollversorgung: Mindestwert je versorgtem Haus (z. B. 50). Dann wird so
   * lange gebaut, bis ein weiteres Gebäude weniger als etwa
   * (verdrängte Häuser × 225 / 50) Häuser neu erreicht.
   */
  fullCoverageValue?: number;
  /** Reichweiten-Zuschlag je Art (z. B. Wohlfahrt), Standard 0. */
  rangeBonus?: Partial<Record<BuildingKind, number>>;
  /** Kaugummi/Violinen nur über den Lieferdienst (siehe RuleConfig.deliveryGoods). */
  deliveryGoods?: boolean;
  /**
   * Geplante Schicht/Stufe je Haus (Schlüssel „x,y“ der linken oberen Kachel),
   * z. B. aus der Stufen-Optimierung. Dann wird je Haus genau gerechnet, was
   * ein Gebäude bringt (z. B. Universität nur für Ingenieure, Drogerie für
   * Ingenieure und Investoren 5); sonst Mittelwerte.
   */
  houseStates?: Map<string, { tier: SkyTier; level: SkyLevel }>;
  townHallItems?: boolean;
  /**
   * Regionalministerium vor der Versorgung setzen: Gebäude in seiner
   * Straßenreichweite bekommen Wohlfahrt (öffentliche Gebäude: Universität,
   * Kraftwerk …) und ggf. Stadtweites Netz (Kraftwerke). Läden sind nicht
   * betroffen.
   */
  ministry?: { range: number; welfare: number; web: number };
  /** Keine Straßen überbauen (Wege der übrigen Gebäude bleiben exakt wie geplant). */
  keepRoads?: boolean;
}

export interface ServiceReport {
  placed: Partial<Record<BuildingKind, number>>;
  /** Regionalministerium gesetzt (und wie viele Häuser in seiner Reichweite liegen). */
  ministry: { placed: boolean; houses: number };
  warehouses: number;
  removedHouses: number;
  /** Anteil der verbleibenden Häuser, die je Art versorgt sind. */
  coverage: Partial<Record<BuildingKind, number>>;
}

interface Candidate {
  x: number;
  y: number;
  w: number;
  h: number;
  turns: number;
  /** Häuser (Index in s.houses), die weichen müssen. */
  houses: number[];
  /** Straßenkacheln unter der Fläche. */
  roads: number[];
  cost: number;
  /** Straßenkacheln, die das Gebäude seitlich berühren (Start der Suche). */
  starts: number[];
}

/**
 * Setzt Versorgungsgebäude in `s` (Häuser werden entfernt, Flächen als
 * SERVICE markiert). `townHalls` nur für die Abdeckungswerte.
 */
export function placeServices(
  s: FillState,
  townHalls: ReadonlyArray<{ x: number; y: number }>,
  options: ServiceOptions,
): { services: PlacedService[]; report: ServiceReport } {
  const { w, h, cell } = s;
  const HV = options.houseValue ?? 225;
  const RV = options.townHallValue ?? 31;
  const report: ServiceReport = { placed: {}, ministry: { placed: false, houses: 0 }, warehouses: 0, removedHouses: 0, coverage: {} };
  const services: PlacedService[] = [];

  // Hauszuordnung je Kachel, Rathausradius je Haus, Anschluss-Straßen je Haus.
  const houseAt = new Int32Array(w * h).fill(-1);
  s.houses.forEach((hs, k) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) houseAt[(hs.y + dy) * w + hs.x + dx] = k;
  });
  const inTownHall = s.houses.map((hs) =>
    townHalls.some((t) => Math.hypot(hs.x + 1 - (t.x + 1.5), hs.y + 1 - (t.y + 1.5)) <= 20 + 1e-9),
  );
  const ring = (x: number, y: number, bw: number, bh: number): number[] => {
    const out: number[] = [];
    const add = (xx: number, yy: number): void => {
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) out.push(yy * w + xx);
    };
    for (let d = 0; d < bw; d++) {
      add(x + d, y - 1);
      add(x + d, y + bh);
    }
    for (let d = 0; d < bh; d++) {
      add(x - 1, y + d);
      add(x + bw, y + d);
    }
    return out;
  };
  const houseRing = s.houses.map((hs) => ring(hs.x, hs.y, 3, 3));

  // Breitensuche über Straßen (Start: Entfernung 1, weiter solange < Reichweite).
  const dist = new Int32Array(w * h);
  const gen = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let g = 0;
  const bfs = (starts: readonly number[], range: number): void => {
    g++;
    let head = 0;
    let tail = 0;
    for (const i of starts) {
      if (!isWay(cell[i]) || gen[i] === g) continue;
      gen[i] = g;
      dist[i] = 1;
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i];
      if (d >= range) continue;
      const x = i % w;
      const visit = (j: number): void => {
        if (!isWay(cell[j]) || gen[j] === g) return;
        gen[j] = g;
        dist[j] = d + 1;
        queue[tail++] = j;
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i + w < w * h) visit(i + w);
    }
  };
  const reached = (tiles: readonly number[]): boolean => tiles.some((i) => gen[i] === g);

  /** Trennt das Wegnehmen der Straßenkacheln das Netz? (wie compact.ts) */
  const separates = (tiles: readonly number[]): boolean => {
    if (!tiles.length) return false;
    const removed = new Set(tiles);
    const nb = (i: number): number[] => {
      const x = i % w;
      const out: number[] = [];
      if (x > 0) out.push(i - 1);
      if (x < w - 1) out.push(i + 1);
      if (i >= w) out.push(i - w);
      if (i + w < w * h) out.push(i + w);
      return out;
    };
    const ends = new Set<number>();
    // Nur Landstraßen: jedes Ufer bleibt für sich zusammenhängend (Brücken keine Sackgassen).
    for (const t of tiles) for (const n of nb(t)) if (cell[n] === ROAD && !removed.has(n)) ends.add(n);
    if (ends.size <= 1) return false;
    const list = [...ends];
    const seen = new Set<number>([list[0]]);
    const q = [list[0]];
    let found = 1;
    for (let k = 0; k < q.length; k++) {
      for (const n of nb(q[k])) {
        if (cell[n] !== ROAD || removed.has(n) || seen.has(n)) continue;
        seen.add(n);
        if (ends.has(n) && ++found === ends.size) return false;
        q.push(n);
      }
    }
    return true;
  };

  /** Alle zulässigen Plätze für eine Fläche bw×bh (Häuser/Straßen dürfen weichen). */
  const candidatesFor = (guid: number): Candidate[] => {
    const entry = lookup(guid);
    const out: Candidate[] = [];
    const seenShape = new Set<string>();
    for (const turns of [0, 1]) {
      const { w: bw, h: bh } = footprint(entry, turns);
      const shape = `${bw}x${bh}`;
      if (seenShape.has(shape)) continue;
      seenShape.add(shape);
      for (let y = 0; y + bh <= h; y++) {
        for (let x = 0; x + bw <= w; x++) {
          let ok = true;
          const hs = new Set<number>();
          const roads: number[] = [];
          for (let dy = 0; dy < bh && ok; dy++) {
            for (let dx = 0; dx < bw; dx++) {
              const i = (y + dy) * w + x + dx;
              const c = cell[i];
              if (c === WATER || c === BLOCKED || c === SERVICE || c === BRIDGE) {
                ok = false;
                break;
              }
              if (c === HOUSE) hs.add(houseAt[i]);
              else if (c === ROAD) roads.push(i);
            }
          }
          if (!ok) continue;
          // Straßen unter der Fläche nur als Querstraßen-Stück (höchstens eine Zeile/Spalte),
          // nie ein Brückenkopf.
          if (roads.length > (options.keepRoads ? 0 : Math.max(bw, bh)) || roads.some((i) => touchesBridge(cell, w, i))) continue;
          const starts = ring(x, y, bw, bh).filter((i) => cell[i] === ROAD);
          if (!starts.length) continue;
          let cost = 0;
          for (const k of hs) cost += HV + (inTownHall[k] ? RV : 0);
          out.push({ x, y, w: bw, h: bh, turns, houses: [...hs], roads, cost, starts });
        }
      }
    }
    // Ausdünnen: je 4×4-Feld nur die günstigsten Plätze (Suche bleibt schnell).
    out.sort((a, b) => a.cost - b.cost || a.roads.length - b.roads.length);
    const bucket = new Map<string, number>();
    const thin: Candidate[] = [];
    for (const c of out) {
      const key = `${Math.floor(c.x / 4)},${Math.floor(c.y / 4)},${c.w}`;
      const n = bucket.get(key) ?? 0;
      if (n >= 2) continue;
      bucket.set(key, n + 1);
      thin.push(c);
    }
    return thin;
  };

  /** Prüft, ob ein Platz im aktuellen Zustand noch frei ist und das Netz hält. */
  const stillValid = (c: Candidate): boolean => {
    for (let dy = 0; dy < c.h; dy++) {
      for (let dx = 0; dx < c.w; dx++) {
        const v = cell[(c.y + dy) * w + c.x + dx];
        if (v === WATER || v === BLOCKED || v === SERVICE || v === BRIDGE) return false;
      }
    }
    if (!c.starts.some((i) => cell[i] === ROAD)) return false;
    if (!c.roads.length) return true;
    if (c.roads.some((i) => cell[i] !== ROAD)) return false;
    // Straßen probeweise wegnehmen: Netz zusammenhängend, alle Häuser/Gebäude angeschlossen?
    for (const i of c.roads) cell[i] = SERVICE;
    let ok = !separates(c.roads);
    if (ok) {
      const touched = new Set<number>();
      for (const i of c.roads) {
        for (const n of [i - 1, i + 1, i - w, i + w]) {
          if (n >= 0 && n < cell.length && cell[n] === HOUSE && !c.houses.includes(houseAt[n])) touched.add(houseAt[n]);
        }
      }
      for (const k of touched) if (!touchesRoad(s, s.houses[k].x, s.houses[k].y)) ok = false;
      for (const sv of services) {
        if (ring(sv.x, sv.y, sv.w, sv.h).every((i) => cell[i] !== ROAD)) ok = false;
      }
    }
    for (const i of c.roads) cell[i] = ROAD;
    return ok;
  };

  // Belegung: Wie viele Gebäude verdrängen ein Haus? (0 = Haus steht noch)
  const removedBy = new Int32Array(s.houses.length);
  const isAlive = (k: number): boolean => removedBy[k] === 0;
  const origRoad = new Uint8Array(w * h);
  for (let i = 0; i < cell.length; i++) if (cell[i] === ROAD) origRoad[i] = 1;
  const placedOf = new Map<Candidate, PlacedService>();

  const place = (c: Candidate, guid: number): void => {
    const entry = lookup(guid);
    for (const k of c.houses) removedBy[k]++;
    for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) cell[(c.y + dy) * w + c.x + dx] = SERVICE;
    const sv: PlacedService = { guid, kind: entry.kind, name: entry.name, x: c.x, y: c.y, w: c.w, h: c.h, turns: c.turns };
    services.push(sv);
    placedOf.set(c, sv);
  };

  const unplace = (c: Candidate): void => {
    for (const k of c.houses) removedBy[k]--;
    for (let dy = 0; dy < c.h; dy++) {
      for (let dx = 0; dx < c.w; dx++) {
        const i = (c.y + dy) * w + c.x + dx;
        cell[i] = houseAt[i] >= 0 ? HOUSE : origRoad[i] ? ROAD : FREE;
      }
    }
    const sv = placedOf.get(c);
    if (sv) services.splice(services.indexOf(sv), 1);
    placedOf.delete(c);
  };

  const houseCost = (k: number): number => HV + (inTownHall[k] ? RV : 0);

  // --- Regionalministerium: zentral, möglichst viele Häuser in Straßenreichweite.
  const inMinistry = new Uint8Array(w * h);
  let ministryStarts: number[] = [];
  /** Ministeriumsbereich mit den aktuellen Straßen neu bestimmen. */
  const refreshMinistry = (): void => {
    if (!options.ministry || !ministryStarts.length) return;
    bfs(ministryStarts.filter((i) => cell[i] === ROAD), options.ministry.range);
    for (let i = 0; i < inMinistry.length; i++) inMinistry[i] = gen[i] === g ? 1 : 0;
  };
  if (options.ministry && options.ministry.range > 0) {
    const mr = options.ministry.range;
    let best: { c: Candidate; value: number } | null = null;
    for (const c of candidatesFor(MINISTRY_GUID)) {
      bfs(c.starts, mr);
      let n = 0;
      s.houses.forEach((_, k) => {
        if (isAlive(k) && !c.houses.includes(k) && reached(houseRing[k])) n++;
      });
      const value = n * 3 - c.cost;
      if ((!best || value > best.value) && stillValid(c)) best = { c, value };
    }
    if (best) {
      place(best.c, MINISTRY_GUID);
      ministryStarts = best.c.starts;
      bfs(best.c.starts, mr);
      for (let i = 0; i < inMinistry.length; i++) if (gen[i] === g) inMinistry[i] = 1;
      report.ministry.placed = true;
      report.ministry.houses = s.houses.filter((_, k) => isAlive(k) && reached(houseRing[k])).length;
    }
  }
  /** Reichweiten-Zuschlag eines Gebäudes, dessen Anschluss im Ministeriumsbereich liegt. */
  const bonusFor = (kind: BuildingKind, starts: readonly number[]): number => {
    let b = options.rangeBonus?.[kind] ?? 0;
    if (options.ministry && starts.some((i) => inMinistry[i])) {
      if (lookup(SERVICE_SPECS.find((sp) => sp.kind === kind)?.guid ?? 0).welfare) b += options.ministry.welfare;
      if (kind === 'powerPlant') b += options.ministry.web;
    }
    return b;
  };

  // --- Versorgungsgebäude je Art: gierig, dann lokale Suche (entfernen, verlegen)
  const specs = SERVICE_SPECS.filter((sp) => options.kinds.has(sp.kind));
  /** Wirkungsanteil je Haus über die schon stehenden Gebäude einer Art (mit den aktuellen Straßen). */
  const baselineOf = (spec: ServiceSpec): Float32Array => {
    const base = new Float32Array(s.houses.length);
    const isUni = spec.kind === 'university';
    for (const sv of services) {
      if (sv.kind !== spec.kind) continue;
      const starts = ring(sv.x, sv.y, sv.w, sv.h).filter((i) => cell[i] === ROAD);
      const bonus = bonusFor(spec.kind, starts);
      bfs(starts, isUni ? UNIVERSITY_MAX_RANGE + bonus : (lookup(spec.guid).roadRange ?? 0) + bonus);
      s.houses.forEach((_, k) => {
        let d = 0;
        for (const i of houseRing[k]) if (gen[i] === g && (!d || dist[i] < d)) d = dist[i];
        if (!d) return;
        const f = isUni ? universityFactor(d, bonus) : 1;
        if (f > base[k]) base[k] = f;
      });
    }
    return base;
  };
  const runSpec = (spec: ServiceSpec): void => {
    refreshMinistry();
    const entry = lookup(spec.guid);
    const isUniversity = spec.kind === 'university';
    const baseline = baselineOf(spec);
    const cands = candidatesFor(spec.guid);
    // Abdeckung je Kandidat: Hausindizes (aufsteigend) und Wirkungsanteil 0…1.
    const coverK: Int32Array[] = [];
    const coverF: Float32Array[] = [];
    for (const c of cands) {
      const bonusRange = bonusFor(spec.kind, c.starts);
      const range = isUniversity ? UNIVERSITY_MAX_RANGE + bonusRange : (entry.roadRange ?? 0) + bonusRange;
      bfs(c.starts, range);
      const ks: number[] = [];
      const fs: number[] = [];
      s.houses.forEach((_, k) => {
        if (!isAlive(k)) return;
        let d = 0;
        for (const i of houseRing[k]) if (gen[i] === g && (!d || dist[i] < d)) d = dist[i];
        if (!d) return;
        const f = isUniversity ? universityFactor(d, bonusRange) : 1;
        if (f <= 0) return;
        ks.push(k);
        fs.push(f);
      });
      coverK.push(Int32Array.from(ks));
      coverF.push(Float32Array.from(fs));
    }
    const factorIn = (ci: number, k: number): number => {
      const arr = coverK[ci];
      let lo = 0;
      let hi = arr.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] === k) return coverF[ci][mid];
        if (arr[mid] < k) lo = mid + 1;
        else hi = mid - 1;
      }
      return 0;
    };
    // Genauer Wert je Haus, wenn Schicht/Stufe bekannt: Einwohner mit minus ohne dieses Gebäude.
    const exact = new Float32Array(s.houses.length).fill(-1);
    if (options.houseStates) {
      const all: Partial<Record<BuildingKind, boolean>> = {
        departmentStore: true,
        furnitureStore: true,
        drugStore: true,
        university: true,
        powerPlant: true,
      };
      const rules = { townHallItems: options.townHallItems ?? true, deliveryGoods: !!options.deliveryGoods };
      s.houses.forEach((hs, k) => {
        const st = options.houseStates?.get(`${hs.x},${hs.y}`);
        if (!st) return;
        const supply = { services: all, universityFactor: 1, townHall: inTownHall[k], hasRoad: true };
        const withIt = skyscraperResidents(st.tier, st.level, 5, supply, rules).residents;
        const without = skyscraperResidents(
          st.tier,
          st.level,
          5,
          { ...supply, services: { ...all, [spec.kind]: false }, universityFactor: isUniversity ? 0 : 1 },
          rules,
        ).residents;
        exact[k] = withIt - without;
      });
    }
    const valueOf = (k: number): number =>
      Math.max(
        exact[k] >= 0
          ? exact[k]
          : spec.value + (inTownHall[k] ? spec.itemValue + (options.deliveryGoods ? spec.deliveryValue : 0) : 0),
        options.fullCoverageValue ?? 0,
      );
    /** Bester Wirkungsanteil je Haus über die gewählten Gebäude dieser Art. */
    const best = Float32Array.from(baseline);
    const chosen: number[] = [];
    const bestWithout = (ci: number, k: number): number => {
      let b = baseline[k];
      for (const cj of chosen) if (cj !== ci) b = Math.max(b, factorIn(cj, k));
      return b;
    };

    /** Gewinn, wenn Kandidat ci dazukommt (im aktuellen Zustand). */
    const addGain = (ci: number): number => {
      const c = cands[ci];
      let gain = -spec.fixedCost;
      for (const k of c.houses) {
        if (!isAlive(k)) continue;
        gain -= houseCost(k) + valueOf(k) * best[k];
      }
      const ks = coverK[ci];
      const fs = coverF[ci];
      for (let n = 0; n < ks.length; n++) {
        const k = ks[n];
        if (fs[n] > best[k] && isAlive(k) && !c.houses.includes(k)) gain += valueOf(k) * (fs[n] - best[k]);
      }
      return gain;
    };
    /** Gewinn, wenn das gewählte Gebäude ci wegfällt. */
    const removeGain = (ci: number): number => {
      const c = cands[ci];
      let gain = spec.fixedCost;
      const ks = coverK[ci];
      const fs = coverF[ci];
      for (let n = 0; n < ks.length; n++) {
        const k = ks[n];
        if (!isAlive(k) || fs[n] < best[k] - 1e-6) continue;
        gain -= valueOf(k) * (best[k] - bestWithout(ci, k));
      }
      for (const k of c.houses) {
        if (removedBy[k] !== 1) continue;
        gain += houseCost(k) + valueOf(k) * bestWithout(ci, k);
      }
      return gain;
    };
    const take = (ci: number): void => {
      place(cands[ci], spec.guid);
      chosen.push(ci);
      const ks = coverK[ci];
      for (let n = 0; n < ks.length; n++) best[ks[n]] = Math.max(best[ks[n]], coverF[ci][n]);
    };
    const drop = (ci: number): void => {
      unplace(cands[ci]);
      chosen.splice(chosen.indexOf(ci), 1);
      for (const k of coverK[ci]) best[k] = bestWithout(-1, k);
    };
    const isChosen = new Uint8Array(cands.length);
    const bestAddition = (): { ci: number; gain: number } => {
      const order = cands.map((_, ci) => ci).filter((ci) => !isChosen[ci]);
      const gains = order.map((ci) => addGain(ci));
      const idx = order.map((_, k) => k).sort((p, q) => gains[q] - gains[p]);
      for (const k of idx) {
        if (gains[k] <= 0) break;
        if (stillValid(cands[order[k]])) return { ci: order[k], gain: gains[k] };
      }
      return { ci: -1, gain: 0 };
    };

    // 1. Gierig
    for (;;) {
      const { ci } = bestAddition();
      if (ci < 0) break;
      take(ci);
      isChosen[ci] = 1;
    }
    // 2. Lokale Suche: überflüssige entfernen, Gebäude verlegen, wieder ergänzen.
    for (let round = 0; round < 6; round++) {
      let improved = false;
      for (const ci of [...chosen]) {
        if (removeGain(ci) > 1e-6) {
          drop(ci);
          isChosen[ci] = 0;
          improved = true;
        }
      }
      for (const ci of [...chosen]) {
        const lose = removeGain(ci);
        drop(ci);
        isChosen[ci] = 0;
        const { ci: cj, gain } = bestAddition();
        if (cj >= 0 && cj !== ci && lose + gain > 1e-6) {
          take(cj);
          isChosen[cj] = 1;
          improved = true;
        } else {
          take(ci);
          isChosen[ci] = 1;
        }
      }
      for (;;) {
        const { ci } = bestAddition();
        if (ci < 0) break;
        take(ci);
        isChosen[ci] = 1;
        improved = true;
      }
      if (!improved) break;
    }
  };
  for (const spec of specs) runSpec(spec);
  // Reparatur: Spätere Gebäude auf Querstraßen können Wege früherer verlängern.
  // Mit den endgültigen Straßen neu rechnen und Lücken gezielt schließen.
  for (const spec of specs) runSpec(spec);
  for (const spec of specs) report.placed[spec.kind] = services.filter((sv) => sv.kind === spec.kind).length;
  refreshMinistry();

  // --- Lagerhäuser: jedes Gebäude mit Lagerbedarf braucht eines in Reichweite.
  const needy = services.filter((sv) => lookup(sv.guid).needsWarehouse);
  if (needy.length) {
    const reachMaps = needy.map((sv) => {
      bfs(ring(sv.x, sv.y, sv.w, sv.h), lookup(sv.guid).roadRange ?? 0);
      const m = new Uint8Array(w * h);
      for (let i = 0; i < m.length; i++) if (gen[i] === g) m[i] = 1;
      return m;
    });
    const served = new Uint8Array(needy.length);
    const whCands = candidatesFor(WAREHOUSE_GUID);
    for (;;) {
      if (served.every(Boolean)) break;
      let best = -1;
      let bestScore = -Infinity;
      let bestServes: number[] = [];
      for (let ci = 0; ci < whCands.length; ci++) {
        const c = whCands[ci];
        const serves: number[] = [];
        needy.forEach((_, k) => {
          if (!served[k] && c.starts.some((i) => reachMaps[k][i])) serves.push(k);
        });
        if (!serves.length) continue;
        let cost = 0;
        for (const k of c.houses) if (isAlive(k)) cost += houseCost(k);
        const score = serves.length * 10_000 - cost;
        if (score > bestScore && stillValid(c)) {
          bestScore = score;
          best = ci;
          bestServes = serves;
        }
      }
      if (best < 0) break;
      place(whCands[best], WAREHOUSE_GUID);
      for (const k of bestServes) served[k] = 1;
      report.warehouses++;
    }
  }

  // Häuser entfernen und Zellen der weggefallenen Häuser freigeben (außer unter Gebäuden).
  report.removedHouses = s.houses.filter((_, k) => !isAlive(k)).length;
  const keep = s.houses.filter((_, k) => isAlive(k));
  s.houses.forEach((hs, k) => {
    if (isAlive(k)) return;
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const i = (hs.y + dy) * w + hs.x + dx;
        if (cell[i] === HOUSE) cell[i] = FREE;
      }
    }
  });
  s.houses = keep;

  // Abdeckung je Art auf den verbleibenden Häusern (Endzustand der Straßen).
  for (const spec of specs) {
    const reachedHouse = new Uint8Array(s.houses.length);
    for (const sv of services) {
      if (sv.kind !== spec.kind) continue;
      const starts = ring(sv.x, sv.y, sv.w, sv.h);
      bfs(starts, (lookup(spec.guid).roadRange ?? 0) + bonusFor(spec.kind, starts));
      s.houses.forEach((hs, k) => {
        if (!reachedHouse[k] && reached(ring(hs.x, hs.y, 3, 3))) reachedHouse[k] = 1;
      });
    }
    report.coverage[spec.kind] = s.houses.length ? reachedHouse.reduce((a, b) => a + b, 0) / s.houses.length : 0;
  }
  return { services, report };
}
