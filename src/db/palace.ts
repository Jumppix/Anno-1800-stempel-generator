// Palast und Regionalministerium (Paläste der Macht): welche Effekte bei einer
// Einstellung aktiv sind und was sie an einem Produktionsgebäude bewirken.
//
// Regeln (Spieltexte/Spieldaten):
// - Palast: Jedes freigeschaltete Ministerium wirkt mit seinem Basiseffekt
//   („Der Ministeriumseffekt ist immer aktiv“), je Ministerium eine Richtlinie.
// - Regionalministerium: ein Ministerium wählen, eine seiner Richtlinien erlassen;
//   freigeschaltet ist, was im Palast freigeschaltet ist.
// - Freischaltung über die Attraktivität der Palaststadt; ab 9.000 Prestige-Stufen
//   (+1 je 1.000, höchstens 25), die die Basiseffekte verstärken.
// - Palast und Regionalministerium gibt es nur in der Alten Welt; die Arbeits-Effekte
//   laufen über die Handelskammern der Alten Welt (Radius 15).
import type { Building, Db, Item, MinistryKey, PalaceData, PalaceDecree, PalaceMinistry } from './data';

export type PalaceLocation = 'none' | 'palace' | 'regional';

export interface PalaceState {
  loc: PalaceLocation;
  /** Attraktivität der Palaststadt. */
  attr: number;
  /** Ministerium des Regionalministeriums. */
  ministry: MinistryKey;
  /** Gewählte Richtlinie je Ministerium (GUID, 0 = keine). */
  decrees: Partial<Record<MinistryKey, number>>;
}

/** Palast-Erlass „Gewerkschaftsförderung“ (+1 Sockel in jeder Handelskammer). */
export const UNION_SUBSIDIES_DECREE = 269197;
/** Palast-Erlass „Fabrikinspektionen“ (−50 % Arbeitskraft). */
export const FACTORY_INSPECTIONS_DECREE = 269194;

export const DEFAULT_PALACE: PalaceState = {
  loc: 'palace',
  attr: 7600,
  ministry: 'Productivity',
  decrees: { Productivity: UNION_SUBSIDIES_DECREE },
};

/** Prestige-Stufe (0 = keine) bei einer Attraktivität. */
export function paragonLevel(data: PalaceData, attr: number, max = 25): number {
  if (!data.paragon.first || attr < data.paragon.first) return 0;
  return Math.min(max, 1 + Math.floor((attr - data.paragon.first) / Math.max(1, data.paragon.step)));
}

export const ministryUnlocked = (m: PalaceMinistry, st: PalaceState): boolean => st.attr >= m.at;
export const decreeUnlocked = (d: PalaceDecree, st: PalaceState): boolean => st.attr >= d.at;

/** Aktive Ministerien und Richtlinien einer Einstellung. */
export function activeParts(data: PalaceData, st: PalaceState): Array<{ m: PalaceMinistry; decree?: PalaceDecree }> {
  if (st.loc === 'none') return [];
  const list = st.loc === 'palace' ? data.ministries : data.ministries.filter((m) => m.k === st.ministry);
  return list
    .filter((m) => ministryUnlocked(m, st))
    .map((m) => {
      const d = m.decrees.find((x) => x.g === st.decrees[m.k]);
      return { m, decree: d && decreeUnlocked(d, st) ? d : undefined };
    });
}

export interface ActiveEffect {
  item: Item;
  /** Effekte (beim Basiseffekt mit Prestige-Stufe). */
  fx: Array<{ k: string; v: unknown }>;
  ministry: PalaceMinistry;
  decree?: PalaceDecree;
}

/** Alle aktiven Palast-Effekte (als Items aus items.json). */
export function activeEffects(db: Db, data: PalaceData, st: PalaceState): ActiveEffect[] {
  const out: ActiveEffect[] = [];
  for (const { m, decree } of activeParts(data, st)) {
    const lvl = paragonLevel(data, st.attr, m.para.length);
    m.base.forEach((g, idx) => {
      const item = db.itemBy.get(g);
      if (!item) return;
      const para = lvl > 0 ? m.para[lvl - 1]?.[idx] : undefined;
      out.push({ item, fx: para ?? item.fx, ministry: m });
    });
    for (const g of decree?.b ?? []) {
      const item = db.itemBy.get(g);
      if (item) out.push({ item, fx: item.fx, ministry: m, decree });
    }
  }
  return out;
}

/** Wirkung der Palast-Effekte auf ein Produktionsgebäude. */
export interface PalaceMods {
  /** Produktivität in % (nicht vom Clipping verdoppelt). */
  prod: number;
  /** Arbeitskraft in %. */
  wf: number;
  /** Zusätzlicher Strombonus in % (nur mit Strom). */
  eb: number;
  /** Zusatzwaren: jede n-te Produktion. */
  extra: Array<{ p: number; every: number; amount: number }>;
  /** Zusätzliche Sockel in der Handelskammer. */
  sockets: number;
  /** Beteiligte Effekte (für Hinweise). */
  sources: ActiveEffect[];
}

export const NO_MODS: PalaceMods = { prod: 0, wf: 0, eb: 0, extra: [], sockets: 0, sources: [] };

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof (v as { v?: unknown }).v === 'number') return (v as { v: number }).v;
  return 0;
};

/** Gebäude in einer Region, in der Palast/Regionalministerium wirken. */
export function inPalaceRegion(db: Db, data: PalaceData, b: Building): boolean {
  const regs = new Set(data.buildings.flatMap((g) => db.buildingBy.get(g)?.reg ?? ['ow']));
  return (b.reg ?? ['ow']).some((r) => regs.has(r));
}

/**
 * Wirkung auf ein Produktionsgebäude: Produktivität, Arbeitskraft, Strombonus,
 * Zusatzwaren (Effekte, deren Ziele das Gebäude enthalten) und Sockel der
 * Handelskammer (Gewerkschaftsförderung).
 */
export function modsFor(db: Db, data: PalaceData, effects: readonly ActiveEffect[], b: Building, tradeUnion = 1010516): PalaceMods {
  if (!inPalaceRegion(db, data, b)) return NO_MODS;
  const m: PalaceMods = { prod: 0, wf: 0, eb: 0, extra: [], sockets: 0, sources: [] };
  for (const e of effects) {
    const onBuilding = e.item.tgx.includes(b.g);
    const onUnion = e.item.tgx.includes(tradeUnion);
    if (!onBuilding && !onUnion) continue;
    let used = false;
    for (const f of e.fx) {
      if (onBuilding) {
        switch (f.k) {
          case 'ProductivityUpgrade':
            m.prod += num(f.v);
            used = true;
            break;
          case 'WorkforceAmountUpgrade':
            m.wf += num(f.v);
            used = true;
            break;
          case 'ElectricityBoostUpgrade':
            if (b.eb) {
              m.eb += num(f.v);
              used = true;
            }
            break;
          case 'AdditionalOutput':
            for (const o of Array.isArray(f.v) ? (f.v as Array<Record<string, number>>) : []) {
              if (typeof o.Product === 'number') m.extra.push({ p: o.Product, every: o.AdditionalOutputCycle || 1, amount: o.Amount || 1 });
              used = true;
            }
            break;
        }
      }
      if (onUnion && f.k === 'SocketCountUpgrade') {
        m.sockets += num(f.v);
        used = true;
      }
    }
    if (used) m.sources.push(e);
  }
  return m;
}
