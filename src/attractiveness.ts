// Attraktivität der Palastinsel (Crown Falls): Bilanz eines Plans gegen das Ziel
// (Standard 33.000 = Prestige 25) in der Reihenfolge aus docs/PLAN_CrownFalls.md,
// Abschnitt 10: erst Palast/Flügel und was mit der Stadt wächst, Kulturfläche zuletzt.
//
// Werte aus den Spieldaten (Culture.Attractiveness, ItemSet/SetBuff):
// Palast +150, je Flügel +15; Rathausreform +200 je Rathaus im Palastbereich;
// Set „Götter des Deltas“ (Museum, 3 Module, Items zusammen 130) +30 je Rathaus und
// je Handelskammer; Privatsammlungen +250 je vollständigem Set; bestes 3er-Set im
// Museum „Ursprung der Menschheit“ (Items 140). Gleiche Sets zählen erneut (Angabe des
// Nutzers); ob der Set-Bonus eines zweiten gleichen Sets erneut wirkt, ist offen –
// gerechnet wird er einmal.
import type { Analysis } from './analysis';
import type { City } from './city';
import { hasPolicy, type RuleConfig } from './rules';

export const ATTRACTIVENESS_TARGET = 33000;
export const PALACE_ATTR = 150;
export const WING_ATTR = 15;
export const TOWN_HALL_REFORM_ATTR = 200;
export const PRIVATE_COLLECTION_ATTR = 250;
/** Palast-Richtlinie „Privatsammlungen“ (Kultur). */
export const PRIVATE_COLLECTIONS_DECREE = 269182;
export const DELTA_SET = { name: 'Götter des Deltas', items: 130, modules: 3, perTownHall: 30, perTradeUnion: 30 };
export const BEST_MUSEUM_SET = { name: 'Ursprung der Menschheit', items: 140, modules: 3 };
/** Museum 5×8, Modul 5×4; Modulgrenze laut Spieldaten 100 (im Spiel unbestätigt). */
export const MUSEUM_TILES = 40;
export const MUSEUM_MODULE_TILES = 20;
export const MUSEUM_MAX_MODULES = 100;

export interface AttrLine {
  label: string;
  value: number;
  note?: string;
}

export interface AttrBalance {
  lines: AttrLine[];
  total: number;
  target: number;
  /** Rest, der aus Kulturfläche kommen muss (0 = Ziel erreicht). */
  missing: number;
  /** Kulturfläche für den Rest: Museen mit dem besten 3er-Set. */
  culture: { sets: number; modules: number; museums: number; tiles: number; perSet: number };
}

export function attractivenessBalance(
  city: City,
  analysis: Analysis,
  rules: RuleConfig,
  opts: { privateCollections: boolean; deltaSet: boolean; target?: number; extra?: number },
): AttrBalance {
  const target = opts.target ?? ATTRACTIVENESS_TARGET;
  const museums = city.buildings.filter((b) => b.entry.kind === 'museum').length;
  const modules = city.buildings.filter((b) => b.entry.kind === 'museumModule').length;
  const lines: AttrLine[] = [];
  const palaces = city.buildings.filter((b) => b.entry.kind === 'palace').length;
  const wings = city.buildings.filter((b) => b.entry.kind === 'palaceWing').length;
  const townHalls = city.buildings.filter((b) => b.entry.kind === 'townHall').length;
  const tradeUnions = city.buildings.filter((b) => b.entry.kind === 'tradeUnion').length;
  const pc = opts.privateCollections ? PRIVATE_COLLECTION_ATTR : 0;
  if (palaces) lines.push({ label: 'Palast', value: PALACE_ATTR * Math.min(1, palaces) });
  if (wings) lines.push({ label: `Palastflügel (${wings} × ${WING_ATTR})`, value: wings * WING_ATTR });
  if (hasPolicy(rules, 'townHallReform')) {
    const n = analysis.totals.workforce.townHalls || 0;
    lines.push({ label: `Rathausreform (${n} Rathäuser im Palastbereich × ${TOWN_HALL_REFORM_ATTR})`, value: n * TOWN_HALL_REFORM_ATTR });
  }
  if (opts.extra) lines.push({ label: 'Weitere (Zierde, Zufriedenheit … – eigene Angabe)', value: opts.extra });
  const bonus = DELTA_SET.perTownHall * townHalls + DELTA_SET.perTradeUnion * tradeUnions;
  if (museums && modules >= DELTA_SET.modules) {
    // Gesetzte Museen: erstes Set „Götter des Deltas“, alle weiteren das beste 3er-Set
    const sets = Math.floor(modules / BEST_MUSEUM_SET.modules);
    lines.push({
      label: `${museums} ${museums === 1 ? 'Museum' : 'Museen'} mit ${modules} Modulen (${opts.deltaSet ? `„${DELTA_SET.name}“ + ` : ''}${opts.deltaSet ? sets - 1 : sets}× „${BEST_MUSEUM_SET.name}“)`,
      value: opts.deltaSet ? DELTA_SET.items + pc + bonus + (sets - 1) * (BEST_MUSEUM_SET.items + pc) : sets * (BEST_MUSEUM_SET.items + pc),
      note: `je Set Items + Privatsammlungen ${pc}; Götter des Deltas +30 × (${townHalls} Rathäuser + ${tradeUnions} Handelskammern)`,
    });
  } else if (opts.deltaSet) {
    lines.push({
      label: `Museum mit „${DELTA_SET.name}“ (${DELTA_SET.modules} Module)`,
      value: DELTA_SET.items + pc + bonus,
      note: `Items ${DELTA_SET.items}${pc ? ` + Privatsammlungen ${pc}` : ''} + 30 × (${townHalls} Rathäuser + ${tradeUnions} Handelskammern)`,
    });
  }
  const total = lines.reduce((a, l) => a + l.value, 0);
  const missing = Math.max(0, target - total);
  const perSet = BEST_MUSEUM_SET.items + pc;
  const sets = missing > 0 ? Math.ceil(missing / perSet) : 0;
  const more = sets * BEST_MUSEUM_SET.modules;
  // Ein vorhandenes (oder geplantes Delta-)Museum nimmt weitere Module auf, bevor ein neues nötig ist.
  const hasMuseum = museums > 0 || opts.deltaSet;
  const room = hasMuseum ? Math.max(0, MUSEUM_MAX_MODULES * Math.max(1, museums) - Math.max(modules, opts.deltaSet ? DELTA_SET.modules : 0)) : 0;
  const extraMuseums = more > room ? Math.ceil((more - room) / MUSEUM_MAX_MODULES) : 0;
  const tiles = extraMuseums * MUSEUM_TILES + more * MUSEUM_MODULE_TILES + (!museums && opts.deltaSet ? MUSEUM_TILES + DELTA_SET.modules * MUSEUM_MODULE_TILES : 0);
  return { lines, total, target, missing, culture: { sets, modules: more, museums: extraMuseums, tiles, perSet } };
}
