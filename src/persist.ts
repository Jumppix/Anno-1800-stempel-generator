// Letzte Insel (Teile + Anordnung) und Einstellungen im Browser speichern
// (localStorage). Alles ist optional: Fehlt der Speicher (privates Fenster,
// gesperrt), läuft die App wie bisher.

import type { IslandPart } from './island';

const ISLAND_KEY = 'anno-planer:island:v1';
const SETTINGS_KEY = 'anno-planer:settings:v1';

interface StoredPart {
  name: string;
  w: number;
  h: number;
  /** Maske als Bits, Base64. */
  mask: string;
  /** Hafengebiet als Bits, Base64 (fehlt bei Inseln ohne Kaistraße). */
  harbor?: string;
  /** Gebäude aus dem Stempel (Minen, Lehmgruben, Bohrtürme …). */
  buildings?: Array<{ guid: number; cx: number; cy: number; dir: number }>;
  landCount: number;
  offsetX: number;
  offsetY: number;
  color: string;
  region: number | null;
  streetGuid: number | null;
}

interface StoredIsland {
  parts: StoredPart[];
  region: string;
  mode: 'admin' | 'city';
}

function packBits(mask: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(mask.length / 8));
  for (let i = 0; i < mask.length; i++) if (mask[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unpackBits(text: string, length: number): Uint8Array {
  const raw = atob(text);
  const mask = new Uint8Array(length);
  for (let i = 0; i < length; i++) mask[i] = (raw.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return mask;
}

export function saveIsland(parts: readonly IslandPart[], region: string, mode: 'admin' | 'city'): void {
  try {
    const data: StoredIsland = {
      region,
      mode,
      parts: parts.map((p) => ({
        name: p.name,
        w: p.w,
        h: p.h,
        mask: packBits(p.mask),
        harbor: p.harbor ? packBits(p.harbor) : undefined,
        buildings: p.buildings,
        landCount: p.landCount,
        offsetX: p.offsetX,
        offsetY: p.offsetY,
        color: p.color,
        region: p.region,
        streetGuid: p.streetGuid,
      })),
    };
    localStorage.setItem(ISLAND_KEY, JSON.stringify(data));
  } catch {
    // Speicher nicht verfügbar oder voll – ohne Speichern weiter.
  }
}

export function loadIsland(nextId: () => string): { parts: IslandPart[]; region: string; mode: 'admin' | 'city' } | null {
  try {
    const text = localStorage.getItem(ISLAND_KEY);
    if (!text) return null;
    const data = JSON.parse(text) as StoredIsland;
    if (!Array.isArray(data.parts)) return null;
    const parts = data.parts.map((p) => ({
      id: nextId(),
      name: p.name,
      w: p.w,
      h: p.h,
      mask: unpackBits(p.mask, p.w * p.h),
      harbor: p.harbor ? unpackBits(p.harbor, p.w * p.h) : undefined,
      buildings: Array.isArray(p.buildings) ? p.buildings : undefined,
      landCount: p.landCount,
      offsetX: p.offsetX,
      offsetY: p.offsetY,
      color: p.color,
      region: p.region,
      streetGuid: p.streetGuid,
    }));
    return { parts, region: data.region, mode: data.mode === 'city' ? 'city' : 'admin' };
  } catch {
    return null;
  }
}

/**
 * Einstellungen (Auswahlfelder, Häkchen, Zahlen) mit `id` in den angegebenen
 * Bereichen speichern und beim Start wiederherstellen.
 */
export function persistSettings(root: ParentNode, selector: string): void {
  let stored: Record<string, string | boolean> = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Record<string, string | boolean>;
  } catch {
    stored = {};
  }
  const fields = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(selector)].filter((f) => f.id);
  // In Dokument-Reihenfolge wiederherstellen und „change“ auslösen, damit
  // abhängige Felder (z. B. Richtlinien je Ministerium) mitziehen.
  for (const f of fields) {
    const v = stored[f.id];
    if (v === undefined) continue;
    let changed = false;
    if (f instanceof HTMLInputElement && f.type === 'checkbox') {
      changed = f.checked !== Boolean(v);
      f.checked = Boolean(v);
    } else if (typeof v === 'string') {
      if (f instanceof HTMLSelectElement && ![...f.options].some((o) => o.value === v)) continue;
      changed = f.value !== v;
      f.value = v;
    }
    if (changed) f.dispatchEvent(new Event('change'));
  }
  const save = (): void => {
    const next: Record<string, string | boolean> = {};
    for (const f of fields) next[f.id] = f instanceof HTMLInputElement && f.type === 'checkbox' ? f.checked : f.value;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // ignorieren
    }
  };
  for (const f of fields) f.addEventListener('change', save);
}
