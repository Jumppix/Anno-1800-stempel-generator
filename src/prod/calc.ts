// Produktion mit Handelskammer-Items: Werte je Setup und beste Item-Kombinationen.
//
// Formel wie annolayouts.de: Produktivität = 100 % + Σ Item-Produktivität
// (geclippt ×2) + Palast (über Handelskammern, geclippt ×2) + 100 % Strom
// (Gebäude mit Strombonus, Strom an oder per Item);
// Zykluszeit = ⌊Basis · 100 / Produktivität⌋; Arbeitskraft = Basis · (1 + Σ %/100) ≥ 0.
import type { Building, Item } from '../db/data';
import type { PalaceMods } from '../db/palace';

export const COINS = 1010017;
export const SLOTS = 3;

export interface ProdOptions {
  /** Strom vorhanden (Kraftwerk in Reichweite). */
  power: boolean;
  /** Geclippt: Gebäude von zwei Handelskammern erreicht, Item-Effekte doppelt. */
  clip: boolean;
  /**
   * Palast/Regionalministerium (Ministerium für Arbeit, Richtlinien). Der Anteil,
   * der über die Handelskammern kommt (`palace.union`), zählt beim Clipping doppelt.
   */
  palace?: PalaceMods;
}

export interface ProdResult {
  /** Gebäude arbeitet (Pflicht-Strom vorhanden). */
  works: boolean;
  powered: boolean;
  /** Strom kommt von diesem Item. */
  powerItem?: number;
  prod: number;
  baseCycle: number | null;
  cycle: number | null;
  /** Hauptware je Minute (ein Gebäude), inkl. Zusatzware derselben Art (z. B. Verrückte Viktoria). */
  perMin: number;
  /** Davon aus Zusatzproduktion derselben Ware. */
  perMinBonus: number;
  /** Verbrauch je Minute (nach Ersetzen/Entfallen/Mehrverbrauch durch Items). */
  inputs: Array<{ p: number; perMin: number }>;
  output?: number;
  workforce: Array<{ p: number; a: number }>;
  coins: number;
  extra: Array<{ p: number; perMin: number }>;
  replaced: Array<{ from: number; to: number }>;
  removed: number[];
}

/** Wirksame Effekte eines Items für die Produktion. */
export interface ItemFx {
  prod: number;
  wf: number;
  maint: number;
  power: boolean;
  /** Zusatzwaren; `p` = SAME_AS_OUTPUT: dieselbe Ware wie das Gebäude. */
  extra: Array<{ p: number; every: number; amount: number }>;
  replace: Array<{ from: number; to: number }>;
  remove: number[];
  /** Mehrverbrauch je Zyklus (InputAmountUpgrade mit positiver Menge). */
  addInput: Array<{ p: number; amount: number }>;
  wfType?: number;
}

/** Rohstoffvorkommen (Eingang der Minen). */
export const DEPOSIT_GOOD = 1591;

/** Platzhalter für „Zusatzware = eigene Ware“ (ForceProductSameAsFactoryOutput). */
export const SAME_AS_OUTPUT = -1;

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof (v as { v?: unknown }).v === 'number') return (v as { v: number }).v;
  return 0;
};

const fxCache = new Map<number, ItemFx>();
export function itemFx(item: Item): ItemFx {
  const hit = fxCache.get(item.g);
  if (hit) return hit;
  const fx: ItemFx = { prod: 0, wf: 0, maint: 0, power: false, extra: [], replace: [], remove: [], addInput: [] };
  for (const e of item.fx) {
    const list = Array.isArray(e.v) ? (e.v as Array<Record<string, number>>) : [];
    switch (e.k) {
      case 'ProductivityUpgrade':
        fx.prod += num(e.v);
        break;
      case 'WorkforceAmountUpgrade':
        fx.wf += num(e.v);
        break;
      case 'MaintenanceUpgrade':
        fx.maint += num(e.v);
        break;
      case 'ProvideIndustrialization':
        fx.power = !!e.v;
        break;
      case 'ReplacingWorkforce':
        if (typeof e.v === 'number') fx.wfType = e.v;
        break;
      case 'AdditionalOutput':
        for (const o of list) {
          const p = o.ForceProductSameAsFactoryOutput ? SAME_AS_OUTPUT : o.Product;
          if (typeof p === 'number') fx.extra.push({ p, every: o.AdditionalOutputCycle || 1, amount: o.Amount || 1 });
        }
        break;
      case 'ReplaceInputs':
        for (const o of list) if (o.OldInput && o.NewInput) fx.replace.push({ from: o.OldInput, to: o.NewInput });
        break;
      case 'InputAmountUpgrade':
        for (const o of list) {
          if (o.Product && o.Amount === -1) fx.remove.push(o.Product);
          else if (o.Product && o.Amount > 0) fx.addInput.push({ p: o.Product, amount: o.Amount });
        }
        break;
    }
  }
  fxCache.set(item.g, fx);
  return fx;
}

/** Nur Items, die an diesem Gebäude etwas Messbares ändern. */
export const isUseful = (fx: ItemFx): boolean =>
  fx.prod !== 0 || fx.wf !== 0 || fx.power || fx.extra.length > 0 || fx.replace.length > 0 || fx.remove.length > 0 || fx.addInput.length > 0 || fx.maint !== 0 || !!fx.wfType;

/** Basis-Zykluszeit (Spielwert, sonst aus dem Anno-1800-Rechner). */
export function baseCycle(b: Building): number | null {
  if (b.ct) return b.ct;
  const out = b.out?.[0]?.a ?? 1;
  return b.calcTpm ? (60 * out) / b.calcTpm : null;
}

export function evaluate(b: Building, items: readonly Item[], opts: ProdOptions, workforceSet: ReadonlySet<number>): ProdResult {
  const k = opts.clip ? 2 : 1;
  let prod = 100;
  let wf = 0;
  let maint = 0;
  let powerItem: number | undefined;
  let wfType: number | undefined;
  const extra = new Map<number, number>();
  const replaced: Array<{ from: number; to: number }> = [];
  const removed: number[] = [];
  const base = baseCycle(b);
  const fxs = items.map((it) => [it, itemFx(it)] as const);
  for (const [it, fx] of fxs) {
    prod += k * fx.prod;
    wf += k * fx.wf;
    maint += k * fx.maint;
    if (fx.power && powerItem === undefined) powerItem = it.g;
    if (fx.wfType) wfType = fx.wfType;
    for (const r of fx.replace) if (b.in?.some((i) => i.p === r.from)) replaced.push(r);
    for (const p of fx.remove) if (b.in?.some((i) => i.p === p)) removed.push(p);
  }
  const pal = opts.palace;
  // Geclippt: der über Handelskammern weitergeleitete Anteil kommt von beiden Kammern
  const palClip = pal && opts.clip ? pal.union : undefined;
  if (pal) {
    prod += pal.prod + (palClip?.prod ?? 0);
    wf += pal.wf + (palClip?.wf ?? 0);
  }
  const powered = !!b.pow && (opts.power || powerItem !== undefined);
  const works = b.pow !== 'req' || powered;
  if (b.eb && powered) prod += 100 + (pal?.eb ?? 0) + (palClip?.eb ?? 0);
  prod = Math.max(prod, 1);
  const cycle = base ? Math.floor((base * 100) / prod) : null;
  const outAmount = b.out?.[0]?.a ?? 1;
  const output = b.out?.[0]?.p;
  const cyclesPerMin = works && cycle ? 60 / cycle : 0;
  const addExtra = (p: number, perMin: number): void => {
    const q = p === SAME_AS_OUTPUT ? (output ?? p) : p;
    extra.set(q, (extra.get(q) ?? 0) + perMin);
  };
  for (const [, fx] of fxs) {
    for (const e of fx.extra) addExtra(e.p, (cyclesPerMin / e.every) * e.amount * k);
  }
  for (const e of [...(pal?.extra ?? []), ...(palClip?.extra ?? [])]) addExtra(e.p, (cyclesPerMin / e.every) * e.amount);
  // Zusatzware derselben Art zählt zum Ausstoß
  const perMinBonus = output !== undefined ? (extra.get(output) ?? 0) : 0;
  if (output !== undefined) extra.delete(output);
  // Verbrauch: Eingänge nach Ersetzen, ohne entfallene, plus Mehrverbrauch
  const inputs = new Map<number, number>();
  for (const i of b.in ?? []) {
    if (removed.includes(i.p)) continue;
    const to = replaced.find((r) => r.from === i.p)?.to ?? i.p;
    inputs.set(to, (inputs.get(to) ?? 0) + cyclesPerMin * i.a);
  }
  for (const [, fx] of fxs) {
    for (const a of fx.addInput) if (inputs.has(a.p)) inputs.set(a.p, (inputs.get(a.p) ?? 0) + cyclesPerMin * a.amount * k);
  }
  const workforce = (b.mt ?? [])
    .filter((m) => workforceSet.has(m.p))
    .map((m) => ({ p: wfType ?? m.p, a: Math.max(0, Math.round(m.a * (1 + wf / 100))) }));
  const coinsBase = b.mt?.find((m) => m.p === COINS)?.a ?? 0;
  return {
    works,
    powered,
    powerItem: powered && !opts.power ? powerItem : undefined,
    prod,
    baseCycle: base,
    cycle,
    perMin: cyclesPerMin * outAmount + perMinBonus,
    perMinBonus,
    inputs: [...inputs].map(([p, perMin]) => ({ p, perMin })),
    output,
    workforce,
    coins: Math.round(coinsBase * (1 + maint / 100)),
    extra: [...extra].map(([p, perMin]) => ({ p, perMin })),
    replaced,
    removed,
  };
}

/** Item-Plätze, die auf ein Gebäude wirken: Handelskammer, in der Arktis die Arktis-Hütte. */
export const slotsFor = (b: Building): string[] => (b.reg?.includes('arctic') ? ['Lodge', 'GuildHouse'] : ['GuildHouse']);

/** Hafenmeisterei (Radius 20) bzw. Speicherstadt (Radius 30): 3 Item-Plätze für Küstengebäude. */
export const HARBOR_OFFICE = 100586;
export const HARBOR_SLOTS = 3;

export type SetupKind = 'max' | 'noWorkforce' | 'noLegendary';
export const SETUP_KINDS: SetupKind[] = ['max', 'noWorkforce', 'noLegendary'];

const workforceTotal = (r: ProdResult): number => r.workforce.reduce((s, w) => s + w.a, 0);
const extraTotal = (r: ProdResult): number => r.extra.reduce((s, e) => s + e.perMin, 0);

/** Bewertung: arbeitet > Ausstoß > Zusatzwaren > wenig Arbeitskraft > weniger Items. */
function better(a: ProdResult, an: number, b: ProdResult | null, bn: number): boolean {
  if (!b) return true;
  if (a.works !== b.works) return a.works;
  // Ohne bekannte Zykluszeit zählt die Produktivität.
  const sa = a.cycle ? a.perMin : a.prod / 100;
  const sb = b.cycle ? b.perMin : b.prod / 100;
  if (Math.abs(sa - sb) > 1e-9) return sa > sb;
  if (Math.abs(extraTotal(a) - extraTotal(b)) > 1e-9) return extraTotal(a) > extraTotal(b);
  if (workforceTotal(a) !== workforceTotal(b)) return workforceTotal(a) < workforceTotal(b);
  return an < bn;
}

/**
 * Beste Kombination aus höchstens drei verschiedenen Items für ein Ziel.
 * Vorauswahl: die je 14 stärksten Items nach Produktivität, Arbeitskraft und
 * Zusatzwaren (plus Strom-Items), dann alle Kombinationen.
 */
export function bestSetup(
  b: Building,
  candidates: readonly Item[],
  kind: SetupKind,
  opts: ProdOptions,
  workforceSet: ReadonlySet<number>,
  slots = SLOTS,
  /** Feste Items, die immer mitwirken (z. B. Handelskammer-Items beim Suchen der Hafenmeisterei-Items). */
  base: readonly Item[] = [],
): Item[] | null {
  // Items, die das Erzvorkommen durch eine Ware ersetzen (Verrückte Viktoria: Dynamit),
  // schaffen neuen Bedarf – nicht automatisch vorschlagen, nur von Hand wählbar.
  let pool = candidates.filter((i) => isUseful(itemFx(i)) && !itemFx(i).replace.some((r) => r.from === DEPOSIT_GOOD));
  if (kind === 'noLegendary') pool = pool.filter((i) => i.r !== 'legendary');
  if (!pool.length) return kind === 'max' ? [] : null;
  const per = slots > 3 ? 10 : 14;
  const top = (score: (fx: ItemFx) => number): Item[] =>
    pool
      .filter((i) => score(itemFx(i)) > 0)
      .sort((x, y) => score(itemFx(y)) - score(itemFx(x)))
      .slice(0, per);
  const pre = new Set<Item>([
    ...top((f) => f.prod),
    ...top((f) => -f.wf + (f.wfType ? 50 : 0)),
    ...top((f) => f.extra.reduce((s, e) => s + e.amount / e.every, 0)),
    ...pool.filter((i) => itemFx(i).power),
  ]);
  const list = [...pre];
  let best: Item[] | null = null;
  let bestR: ProdResult | null = null;
  const consider = (combo: Item[]): void => {
    const r = evaluate(b, base.length ? [...base, ...combo] : combo, opts, workforceSet);
    if (kind === 'noWorkforce' && (workforceTotal(r) > 0 || !r.workforce.length)) return;
    if (better(r, combo.length, bestR, best?.length ?? 0)) {
      best = combo;
      bestR = r;
    }
  };
  // Alle Kombinationen ohne Wiederholung bis zur Platzzahl
  const walk = (start: number, combo: Item[]): void => {
    consider(combo);
    if (combo.length >= slots) return;
    for (let i = start; i < list.length; i++) walk(i + 1, [...combo, list[i]]);
  };
  walk(0, []);
  if (kind === 'noWorkforce' && bestR && workforceTotal(bestR) > 0) return null;
  return best;
}
