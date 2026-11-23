// Rohstoffe der Insel aus den Gebäuden im Stempel (Blaupausen): Minen sind an ihr Vorkommen
// gebunden und bleiben stehen; Lehmgruben und Ölquellen (Bohrtürme) lassen sich mit
// „Bahnbrechende Entdeckungen“ (Enbesa) verschieben – ihre Fläche ist dann Bauland, der
// Planer setzt sie selbst. Die Ölraffinerie war nur nötig, um die Bohrtürme stempeln zu
// können; ihre Fläche ist ebenfalls Bauland.
import { footprint, lookup, quarterTurns } from './catalog';

export type DepositKind = 'mine' | 'clay' | 'oil' | 'refinery' | 'other';

/** An das Vorkommen gebundene Minen (Alte Welt). */
export const MINE_GUIDS: Readonly<Record<number, string>> = {
  1010304: 'Kohlemine',
  1010305: 'Eisenmine',
  1010307: 'Zinkmine',
  1010308: 'Kupfermine',
  1010309: 'Zementmine',
  1010311: 'Goldmine',
};
export const CLAY_PIT_GUID = 100416;
export const OIL_WELL_GUID = 101332;
export const OIL_REFINERY_GUID = 101331;
/** Bohrtürme müssen im Radius der Raffinerie stehen (Spieldaten ModuleBuildRadius). */
export const OIL_WELL_RADIUS = 12;

export interface IslandBuilding {
  guid: number;
  name: string;
  kind: DepositKind;
  /** Grundfläche in Inselkoordinaten (wie die zusammengesetzte Maske). */
  x: number;
  y: number;
  w: number;
  h: number;
  turns: number;
}

export function depositKind(guid: number): DepositKind {
  if (guid in MINE_GUIDS) return 'mine';
  if (guid === CLAY_PIT_GUID) return 'clay';
  if (guid === OIL_WELL_GUID) return 'oil';
  if (guid === OIL_REFINERY_GUID) return 'refinery';
  return 'other';
}

/** Gebäude eines Teils (Mittelpunkt relativ zur Teilmaske) → Rechteck in Teilkoordinaten. */
export function partBuilding(b: { guid: number; cx: number; cy: number; dir: number }): IslandBuilding {
  const entry = lookup(b.guid);
  const turns = quarterTurns(b.dir);
  const { w, h } = footprint(entry, turns);
  return {
    guid: b.guid,
    name: MINE_GUIDS[b.guid] ?? entry.name,
    kind: depositKind(b.guid),
    x: Math.round(b.cx - (w - 1) / 2),
    y: Math.round(b.cy - (h - 1) / 2),
    w,
    h,
    turns,
  };
}

/** Zusammenfassung für die Anzeige, z. B. „7× Eisenmine, 4× Lehmgrube …“. */
export function depositSummary(list: readonly IslandBuilding[]): { mines: string; clay: number; oil: number; refineries: number } {
  const count = new Map<string, number>();
  for (const b of list) if (b.kind === 'mine') count.set(b.name, (count.get(b.name) ?? 0) + 1);
  return {
    mines: [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${c}× ${n}`)
      .join(', '),
    clay: list.filter((b) => b.kind === 'clay').length,
    oil: list.filter((b) => b.kind === 'oil').length,
    refineries: list.filter((b) => b.kind === 'refinery').length,
  };
}
