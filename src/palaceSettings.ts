// Palast-Einstellungen für die ganze Hilfeseite: einmal einstellen, gilt für
// Produktion & Handelskammer und den Stadtplaner. Gespeichert im Browser;
// Änderungen gehen per Ereignis an alle offenen Seiten (auch andere Tabs).
import { getLang, pick, t } from './i18n';
import { DB_BASE, loadPalace, type MinistryKey, type PalaceData } from './db/data';
import type { PalaceLocation, PalaceState } from './db/palace';
import { POLICIES, type Ministry, type Policy } from './rules';

export interface PalaceSettings {
  /** Attraktivität der Palaststadt (Freischaltung, Prestige). */
  attr: number;
  /** Palastflügel (Reichweite von Palast und Regionalministerium). */
  wings: number;
  /** Palast: gewählte Richtlinie je Ministerium (GUID, 0 = keine). */
  palace: Partial<Record<MinistryKey, number>>;
  /** Regionalministerium: ein Ministerium und eine seiner Richtlinien. */
  regional: { ministry: MinistryKey; decree: number };
  /** Produktionsseite: Wirkung durch Palast, Regionalministerium oder keins. */
  prod: PalaceLocation;
}

const KEY = 'anno-palace-settings';
const EVENT = 'anno-palace-settings';

/** Gewerkschaftsförderung, Stadtweites Netz. */
export const DEFAULT_SETTINGS: PalaceSettings = {
  attr: 7600,
  wings: 40,
  palace: { Productivity: 269197, Service: 269143 },
  regional: { ministry: 'Service', decree: 269143 },
  prod: 'palace',
};

/** Prestige ohne Palast-Daten: ab 9.000 Attraktivität, je 1.000 eine Stufe, höchstens 25. */
export const prestigeOf = (attr: number, data?: PalaceData | null): number => {
  const first = data?.paragon.first ?? 9000;
  const step = data?.paragon.step ?? 1000;
  return attr < first ? 0 : Math.min(25, 1 + Math.floor((attr - first) / step));
};
export const attrForPrestige = (p: number): number => (p > 0 ? 9000 + (p - 1) * 1000 : 0);

/** Frühere Einstellungen (Produktionsseite, Stadtplaner) übernehmen. */
function migrate(): PalaceSettings {
  const s: PalaceSettings = structuredClone(DEFAULT_SETTINGS);
  try {
    const prod = JSON.parse(localStorage.getItem('anno-prod-state-palace') ?? 'null') as Partial<PalaceState> | null;
    if (prod) {
      if (typeof prod.attr === 'number') s.attr = prod.attr;
      if (prod.loc) s.prod = prod.loc;
      if (prod.loc === 'regional' && prod.ministry) s.regional = { ministry: prod.ministry, decree: prod.decrees?.[prod.ministry] ?? 0 };
      else if (prod.decrees) s.palace = { ...s.palace, ...prod.decrees };
    } else if (localStorage.getItem('anno-prod-state-union') === '0') s.palace = { ...s.palace, Productivity: 0 };
    const planner = JSON.parse(localStorage.getItem('anno-planer:settings:v1') ?? '{}') as Record<string, string>;
    if (planner['rule-wings']) s.wings = Math.max(0, Number(planner['rule-wings']) || 0);
    const p = Number(planner['rule-prestige']);
    if (p > 0) s.attr = Math.max(s.attr, attrForPrestige(p));
    const m = planner['rule-ministry'];
    if (m === 'welfare' || m === 'labour') {
      const pol = POLICIES.find((x) => x.id === planner['rule-policy']);
      s.regional = { ministry: m === 'welfare' ? 'Service' : 'Productivity', decree: pol?.guid ?? 0 };
    }
  } catch {
    /* Standardwerte */
  }
  return s;
}

let cache: PalaceSettings | null = null;
export function getPalaceSettings(): PalaceSettings {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...structuredClone(DEFAULT_SETTINGS), ...(JSON.parse(raw) as Partial<PalaceSettings>) } : migrate();
  } catch {
    cache = structuredClone(DEFAULT_SETTINGS);
  }
  return cache;
}

export function setPalaceSettings(next: Partial<PalaceSettings>): void {
  cache = { ...getPalaceSettings(), ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* nur für diese Sitzung */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onPalaceSettings(cb: (s: PalaceSettings) => void): void {
  window.addEventListener(EVENT, () => cb(getPalaceSettings()));
  // Andere Tabs
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    cache = null;
    cb(getPalaceSettings());
  });
}

/** Zustand für die Produktionsseite (Palast oder Regionalministerium). */
export function prodPalaceState(s: PalaceSettings = getPalaceSettings()): PalaceState {
  if (s.prod === 'regional') {
    return { loc: 'regional', attr: s.attr, ministry: s.regional.ministry, decrees: { [s.regional.ministry]: s.regional.decree } };
  }
  return { loc: s.prod, attr: s.attr, ministry: s.regional.ministry, decrees: { ...s.palace } };
}

/** Freischaltung der Ministerien (Attraktivität), falls Palast-Daten fehlen. */
const MINISTRY_UNLOCK: Record<MinistryKey, number> = { City: 0, Culture: 450, Productivity: 700, Service: 1000, Harbor: 1350 };

/**
 * Regeln für den Stadtplaner: Er plant ein Regionalministerium. Wohlfahrt und
 * Stadtweites Netz zählen nur, wenn sie bei der Attraktivität freigeschaltet sind.
 */
export function cityPalaceRules(
  s: PalaceSettings = getPalaceSettings(),
  data?: PalaceData | null,
): { palaceWings: number; prestige: number; ministry: Ministry; policy: Policy } {
  const key = s.regional.ministry;
  const unlock = data?.ministries.find((m) => m.k === key)?.at ?? MINISTRY_UNLOCK[key];
  const unlocked = s.attr >= unlock;
  const ministry: Ministry = !unlocked ? 'none' : key === 'Service' ? 'welfare' : key === 'Productivity' ? 'labour' : 'none';
  const pol = POLICIES.find((p) => p.guid === s.regional.decree && p.ministry === ministry && s.attr >= p.unlock);
  return { palaceWings: s.wings, prestige: prestigeOf(s.attr, data), ministry, policy: pol?.id ?? 'none' };
}

// ------------------------------------------------------------------ Dialog
const esc = (x: string): string => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const num = (n: number): string => n.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-US');

/** Kurzbeschreibung für Knöpfe/Zusammenfassungen. */
export function palaceSummary(s: PalaceSettings, data?: PalaceData | null): string {
  const reg = data?.ministries.find((m) => m.k === s.regional.ministry);
  const dec = reg?.decrees.find((d) => d.g === s.regional.decree);
  return `${t('pal.attrShort', { n: num(s.attr) })} · ${t('pal.prestige', { n: prestigeOf(s.attr, data) })}${
    reg ? ` · ${t('pal.loc.regional')}: ${pick(reg.n)}${dec ? ` / ${pick(dec.n)}` : ''}` : ''
  }`;
}

let dialog: HTMLElement | null = null;

/** Dialog „Palast & Regionalministerium“ (auf jeder Seite über den Seitenkopf). */
export async function openPalaceDialog(): Promise<void> {
  const data = await loadPalace();
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.className = 'pal-modal';
    dialog.hidden = true;
    dialog.innerHTML = '<div class="pal-box" role="dialog" aria-modal="true"><button class="pal-close" type="button" aria-label="✕">✕</button><div class="pal-content"></div></div>';
    document.body.append(dialog);
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog || (e.target as HTMLElement).closest('.pal-close')) dialog!.hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dialog) dialog.hidden = true;
    });
    dialog.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      const s = getPalaceSettings();
      const k = el.dataset.k;
      if (k === 'attr') setPalaceSettings({ attr: Math.max(0, Math.min(99999, Math.round(Number(el.value) || 0))) });
      else if (k === 'wings') setPalaceSettings({ wings: Math.max(0, Math.min(200, Math.round(Number(el.value) || 0))) });
      else if (k === 'palace') setPalaceSettings({ palace: { ...s.palace, [el.dataset.m as MinistryKey]: Number(el.value) || 0 } });
      else if (k === 'regMinistry') setPalaceSettings({ regional: { ministry: el.value as MinistryKey, decree: 0 } });
      else if (k === 'regDecree') setPalaceSettings({ regional: { ...s.regional, decree: Number(el.value) || 0 } });
      else return;
      render();
    });
  }
  const box = dialog.querySelector('.pal-content') as HTMLElement;
  const render = (): void => {
    const s = getPalaceSettings();
    if (!data) {
      box.innerHTML = `<p>${esc(t('db.error'))}</p>`;
      return;
    }
    const icon = (f?: string): string => (f ? `<img class="ic" src="${DB_BASE}icons/${f}" alt="" />` : '');
    const decreeOptions = (k: MinistryKey, cur: number): string => {
      const m = data.ministries.find((x) => x.k === k);
      return `<option value="0">${esc(t('pal.none'))}</option>${(m?.decrees ?? [])
        .map(
          (d) =>
            `<option value="${d.g}" ${d.g === cur ? 'selected' : ''} ${s.attr >= d.at ? '' : 'disabled'}>${esc(pick(d.n))} (${esc(t('pal.from', { n: num(d.at) }))})</option>`,
        )
        .join('')}`;
    };
    const paved = 71 + 3 * s.wings;
    box.innerHTML = `<h2>🏛 ${esc(t('pal.title'))}</h2>
      <p class="pal-lead">${esc(t('pal.globalLead'))}</p>
      <div class="pal-grid2">
        <label><span>${esc(t('pal.attr'))}</span><input type="number" data-k="attr" min="0" max="99999" step="50" value="${s.attr}" />
          <small>${esc(t('pal.prestige', { n: prestigeOf(s.attr, data) }))}${esc(t('pal.prestigeInfo', { a: num(data.paragon.first), b: num(data.paragon.step) }))}</small></label>
        <label><span>${esc(t('pal.wings'))}</span><input type="number" data-k="wings" min="0" max="200" step="1" value="${s.wings}" />
          <small>${esc(t('pal.rangeInfo', { p: paved, r: Math.floor(paved / 2), b: data.range.base, w: data.range.perWing }))}</small></label>
      </div>
      <h3>${esc(t('pal.loc.palace'))}</h3>
      <p class="pal-note">${esc(t('pal.notePalace'))}</p>
      <div class="pal-list">${data.ministries
        .map((m) => {
          const ok = s.attr >= m.at;
          return `<label class="${ok ? '' : 'locked'}"><span>${icon(m.i)}${esc(pick(m.n))} <small>${esc(t(ok ? 'pal.from' : 'pal.lockedFrom', { n: num(m.at) }))}</small></span>
            <select data-k="palace" data-m="${m.k}" ${ok ? '' : 'disabled'}>${decreeOptions(m.k, s.palace[m.k] ?? 0)}</select></label>`;
        })
        .join('')}</div>
      <h3>${esc(t('pal.loc.regional'))}</h3>
      <p class="pal-note">${esc(t('pal.noteRegional'))}</p>
      <div class="pal-list">
        <label><span>${esc(t('pal.ministry'))}</span><select data-k="regMinistry">${data.ministries
          .map(
            (m) =>
              `<option value="${m.k}" ${m.k === s.regional.ministry ? 'selected' : ''} ${s.attr >= m.at ? '' : 'disabled'}>${esc(pick(m.n))} (${esc(
                t('pal.from', { n: num(m.at) }),
              )})</option>`,
          )
          .join('')}</select></label>
        <label><span>${esc(t('pal.decree'))}</span><select data-k="regDecree">${decreeOptions(s.regional.ministry, s.regional.decree)}</select></label>
      </div>
      <p class="pal-note">${esc(t('pal.usedBy'))}</p>`;
  };
  render();
  dialog.hidden = false;
}
