// Palast-Einstellungen für die ganze Hilfeseite: einmal einstellen, gilt für
// Produktion & Handelskammer und den Stadtplaner. Gespeichert im Browser;
// Änderungen gehen per Ereignis an alle offenen Seiten (auch andere Tabs).
import { getLang, pick, t } from './i18n';
import { DB_BASE, loadPalace, type MinistryKey, type PalaceData } from './db/data';
import { decreeInfo, ministryInfo } from './db/palaceInfo';
import type { PalaceLocation, PalaceState } from './db/palace';
import { POLICIES, type Ministry, type Policy } from './rules';

/** Inseltypen mit eigenem Regionalministerium. */
export type IslandType = 'city' | 'prod' | 'harbor';
export const ISLAND_TYPES: readonly IslandType[] = ['city', 'prod', 'harbor'];

export interface RegionalSetting {
  ministry: MinistryKey;
  decree: number;
}

export interface PalaceSettings {
  /** Version der gespeicherten Einstellungen. */
  v: number;
  /** Attraktivität der Palaststadt (Freischaltung, Prestige). */
  attr: number;
  /** Palastflügel (Reichweite von Palast und Regionalministerium). */
  wings: number;
  /** Weltbevölkerung (0 = unbekannt); bestimmt die Flügel über die Profilstufe. */
  population: number;
  /** Palast: gewählte Richtlinie je Ministerium (GUID, 0 = keine). */
  palace: Partial<Record<MinistryKey, number>>;
  /** Regionalministerium je Inseltyp: ein Ministerium und eine seiner Richtlinien. */
  regional: Record<IslandType, RegionalSetting>;
  /** Produktionsseite/Guide: Wirkung durch Palast, Regionalministerium oder keins. */
  prod: PalaceLocation;
}

const KEY = 'anno-palace-settings';
const EVENT = 'anno-palace-settings';
const VERSION = 3;

/**
 * Standard: Palaststadt mit 33.000 Attraktivität (Crown Falls), Palast mit
 * Rathausreform, Privatsammlungen, Gewerkschaftsförderung und Stadtweitem Netz; Regionalministerien:
 * Wohninsel Verwaltung + Freigeisterreform, Produktion Arbeit + Fabrikinspektionen,
 * Hafen Handel + Hafenbevorratung. Produktion steht meist nicht auf der Palastinsel.
 */
export const DEFAULT_SETTINGS: PalaceSettings = {
  v: VERSION,
  attr: 33000,
  wings: 40,
  population: 0,
  palace: { City: 269176, Culture: 269182, Productivity: 269197, Service: 269143 },
  regional: {
    city: { ministry: 'City', decree: 269175 },
    prod: { ministry: 'Productivity', decree: 269194 },
    harbor: { ministry: 'Harbor', decree: 269208 },
  },
  prod: 'regional',
};

/** Prestige ohne Palast-Daten: ab 9.000 Attraktivität, je 1.000 eine Stufe, höchstens 25. */
export const prestigeOf = (attr: number, data?: PalaceData | null): number => {
  const first = data?.paragon.first ?? 9000;
  const step = data?.paragon.step ?? 1000;
  return attr < first ? 0 : Math.min(25, 1 + Math.floor((attr - first) / step));
};
export const attrForPrestige = (p: number): number => (p > 0 ? 9000 + (p - 1) * 1000 : 0);

// ------------------------------------------------------------ Profilstufe → Flügel
/**
 * Bevölkerung für eine Profilstufe: bis Stufe 41 je Stufe 400 Einwohner, darüber
 * quadratisch (Anno-Wiki-Tabelle: Stufe 50 = 40.780, 70 = 268.520, 90 = 754.980;
 * dazwischen interpoliert – Näherung, die Flügel lassen sich von Hand ändern).
 */
const ANCHORS: ReadonlyArray<[number, number]> = [
  [9, 24780 / 81],
  [29, 252520 / 841],
  [49, 738980 / 2401],
];
export function populationForLevel(level: number): number {
  if (level <= 41) return 400 * Math.max(0, level - 1);
  const d = level - 41;
  let c = ANCHORS[0][1];
  if (d >= ANCHORS[ANCHORS.length - 1][0]) c = ANCHORS[ANCHORS.length - 1][1];
  else
    for (let i = 0; i + 1 < ANCHORS.length; i++) {
      const [d0, c0] = ANCHORS[i];
      const [d1, c1] = ANCHORS[i + 1];
      if (d >= d0 && d <= d1) c = c0 + ((c1 - c0) * (d - d0)) / (d1 - d0);
    }
  return Math.round(16000 + c * d * d);
}
export function levelForPopulation(pop: number): number {
  let l = 1;
  while (l < 300 && populationForLevel(l + 1) <= pop) l++;
  return l;
}
/** Palastflügel je Profilstufe: 6 bis Stufe 34, 10 ab 35, danach +2 je Stufe. */
export const wingsForLevel = (level: number): number => (level < 35 ? 6 : 10 + 2 * (level - 35));
export const wingsForPopulation = (pop: number): number => wingsForLevel(levelForPopulation(pop));

// ------------------------------------------------------------ Laden/Speichern
function oldRegional(r: unknown, s: PalaceSettings): void {
  const o = r as Partial<RegionalSetting> | null;
  if (!o || typeof o.ministry !== 'string') return;
  const x = { ministry: o.ministry, decree: o.decree ?? 0 };
  if (x.ministry === 'Productivity') s.regional.prod = x;
  else if (x.ministry === 'Harbor') s.regional.harbor = x;
  else s.regional.city = x;
}

/** Frühere Einstellungen (Produktionsseite, Stadtplaner) übernehmen. */
function migrate(): PalaceSettings {
  const s: PalaceSettings = structuredClone(DEFAULT_SETTINGS);
  try {
    const prod = JSON.parse(localStorage.getItem('anno-prod-state-palace') ?? 'null') as Partial<PalaceState> | null;
    if (prod) {
      if (typeof prod.attr === 'number' && prod.attr !== 7600) s.attr = prod.attr;
      if (prod.loc && prod.loc !== 'palace') s.prod = prod.loc;
      if (prod.loc === 'regional' && prod.ministry) oldRegional({ ministry: prod.ministry, decree: prod.decrees?.[prod.ministry] ?? 0 }, s);
      else if (prod.decrees) s.palace = { ...s.palace, ...prod.decrees };
    } else if (localStorage.getItem('anno-prod-state-union') === '0') s.palace = { ...s.palace, Productivity: 0 };
    const planner = JSON.parse(localStorage.getItem('anno-planer:settings:v1') ?? '{}') as Record<string, string>;
    if (planner['rule-wings']) s.wings = Math.max(0, Number(planner['rule-wings']) || 0);
    const p = Number(planner['rule-prestige']);
    if (p > 0) s.attr = Math.max(s.attr, attrForPrestige(p));
    const m = planner['rule-ministry'];
    if (m === 'welfare' || m === 'labour') {
      const pol = POLICIES.find((x) => x.id === planner['rule-policy']);
      oldRegional({ ministry: m === 'welfare' ? 'Service' : 'Productivity', decree: pol?.guid ?? 0 }, s);
    }
  } catch {
    /* Standardwerte */
  }
  return s;
}

/** Gespeicherte Einstellungen einer älteren Version: alte Standardwerte durch neue ersetzen. */
function upgrade(raw: Partial<PalaceSettings> & { regional?: unknown }): PalaceSettings {
  const s: PalaceSettings = structuredClone(DEFAULT_SETTINGS);
  const { regional, ...rest } = raw;
  Object.assign(s, rest);
  if ((raw.v ?? 1) < 2) {
    // Version 1: ein Regionalministerium für alles, Standard 7.600 / Palast
    if (raw.attr === 7600) s.attr = DEFAULT_SETTINGS.attr;
    if (raw.prod === 'palace') s.prod = DEFAULT_SETTINGS.prod;
    oldRegional(regional, s);
  } else if (regional && typeof regional === 'object') {
    for (const k of ISLAND_TYPES) {
      const r = (regional as Partial<Record<IslandType, RegionalSetting>>)[k];
      if (r?.ministry) s.regional[k] = { ministry: r.ministry, decree: r.decree ?? 0 };
    }
  }
  // Version 3: Kultur-Richtlinie „Privatsammlungen“ als Standard (Crown Falls), wenn nie gewählt
  if ((raw.v ?? 1) < 3 && raw.palace && raw.palace.Culture === undefined) s.palace = { ...s.palace, Culture: 269182 };
  s.v = VERSION;
  return s;
}

let cache: PalaceSettings | null = null;
export function getPalaceSettings(): PalaceSettings {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? upgrade(JSON.parse(raw) as Partial<PalaceSettings>) : migrate();
  } catch {
    cache = structuredClone(DEFAULT_SETTINGS);
  }
  return cache;
}

export function setPalaceSettings(next: Partial<PalaceSettings>): void {
  cache = { ...getPalaceSettings(), ...next, v: VERSION };
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

/** Zustand für Produktion & Handelskammer und den Baumaterial-Guide (Produktionsinsel). */
export function prodPalaceState(s: PalaceSettings = getPalaceSettings()): PalaceState {
  const r = s.regional.prod;
  if (s.prod === 'regional') return { loc: 'regional', attr: s.attr, ministry: r.ministry, decrees: { [r.ministry]: r.decree } };
  return { loc: s.prod, attr: s.attr, ministry: r.ministry, decrees: { ...s.palace } };
}

/**
 * Hafenmeistereien standardmäßig einplanen? Ja, wenn das Regionalministerium der
 * Hafeninsel das Ministerium für Handel ist (Lager je Hafenmeisterei, Hafenbevorratung).
 */
export function harborOfficesDefault(s: PalaceSettings = getPalaceSettings()): boolean {
  return s.regional.harbor.ministry === 'Harbor';
}

/** Freischaltung der Ministerien (Attraktivität), falls Palast-Daten fehlen. */
const MINISTRY_UNLOCK: Record<MinistryKey, number> = { City: 0, Culture: 450, Productivity: 700, Service: 1000, Harbor: 1350 };

const MINISTRY_OF: Partial<Record<MinistryKey, Ministry>> = { Service: 'welfare', Productivity: 'labour', City: 'city' };

/** Inseltyp im Stadtplaner: Wohninsel mit Regionalministerium oder Palastinsel (Crown Falls). */
export type CityIsland = 'city' | 'palace';

/**
 * Regeln für den Stadtplaner. Wohninsel: das Regionalministerium der Wohninsel.
 * Palastinsel: alle freigeschalteten Ministerien gleichzeitig mit den Palast-Richtlinien
 * (`palace`). Ministerien und Richtlinien zählen nur, wenn sie bei der Attraktivität
 * freigeschaltet sind.
 */
export function cityPalaceRules(
  s: PalaceSettings = getPalaceSettings(),
  data?: PalaceData | null,
  island: CityIsland = 'city',
): { palaceWings: number; prestige: number; ministry: Ministry; policy: Policy; palace?: { ministries: Ministry[]; policies: Policy[] } } {
  const unlockOf = (k: MinistryKey): number => data?.ministries.find((m) => m.k === k)?.at ?? MINISTRY_UNLOCK[k];
  const policyOf = (ministry: Ministry, decree: number): Policy =>
    POLICIES.find((p) => p.guid === decree && p.ministry === ministry && s.attr >= p.unlock)?.id ?? 'none';
  const base = { palaceWings: s.wings, prestige: prestigeOf(s.attr, data) };
  if (island === 'palace') {
    const ministries: Ministry[] = [];
    const policies: Policy[] = [];
    for (const [k, m] of Object.entries(MINISTRY_OF) as Array<[MinistryKey, Ministry]>) {
      if (s.attr < unlockOf(k)) continue;
      ministries.push(m);
      const p = policyOf(m, s.palace[k] ?? 0);
      if (p !== 'none') policies.push(p);
    }
    return { ...base, ministry: 'none', policy: 'none', palace: { ministries, policies } };
  }
  const { ministry: key, decree } = s.regional.city;
  const ministry: Ministry = s.attr >= unlockOf(key) ? (MINISTRY_OF[key] ?? 'none') : 'none';
  return { ...base, ministry, policy: policyOf(ministry, decree), palace: undefined };
}

// ------------------------------------------------------------------ Dialog
const esc = (x: string): string => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const num = (n: number): string => n.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-US');

/** Kurzbeschreibung für Knöpfe/Zusammenfassungen. */
export function palaceSummary(s: PalaceSettings, data?: PalaceData | null, only?: IslandType): string {
  const regs = (only ? [only] : ISLAND_TYPES).map((k) => {
    const dec = only ? data?.ministries.find((m) => m.k === s.regional[k].ministry)?.decrees.find((d) => d.g === s.regional[k].decree) : undefined;
    const reg = data?.ministries.find((m) => m.k === s.regional[k].ministry);
    return reg ? `${t(`pal.island.${k}`)}: ${pick(reg.n)}${dec ? ` / ${pick(dec.n)}` : ''}` : '';
  }).filter(Boolean);
  return `${t('pal.attrShort', { n: num(s.attr) })} · ${t('pal.prestige', { n: prestigeOf(s.attr, data) })} · ${t('pal.wings')} ${s.wings}${
    regs.length ? ` · ${regs.join(' · ')}` : ''
  }`;
}

/** Vorschlag beim Wechsel des Ministeriums (Richtlinie, die meist gewählt wird). */
const SUGGESTED_DECREE: Partial<Record<MinistryKey, number>> = {
  City: 269175, // Freigeisterreform
  Service: 269143, // Stadtweites Netz
  Productivity: 269194, // Fabrikinspektionen
  Harbor: 269208, // Hafenbevorratung
};

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
      const el = e.target as HTMLElement;
      if (e.target === dialog || el.closest('.pal-close')) dialog!.hidden = true;
      else if (el.closest('[data-k="reset"]')) {
        setPalaceSettings(structuredClone(DEFAULT_SETTINGS));
        render();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dialog) dialog.hidden = true;
    });
    dialog.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      const s = getPalaceSettings();
      const k = el.dataset.k;
      const isl = el.dataset.t as IslandType | undefined;
      if (k === 'attr') setPalaceSettings({ attr: Math.max(0, Math.min(99999, Math.round(Number(el.value) || 0))) });
      else if (k === 'wings') setPalaceSettings({ wings: Math.max(0, Math.min(400, Math.round(Number(el.value) || 0))) });
      else if (k === 'population') {
        const population = Math.max(0, Math.min(1e8, Math.round(Number(el.value) || 0)));
        setPalaceSettings(population > 0 ? { population, wings: wingsForPopulation(population) } : { population });
      } else if (k === 'palace') setPalaceSettings({ palace: { ...s.palace, [el.dataset.m as MinistryKey]: Number(el.value) || 0 } });
      else if (k === 'regMinistry' && isl) setPalaceSettings({ regional: { ...s.regional, [isl]: { ministry: el.value as MinistryKey, decree: SUGGESTED_DECREE[el.value as MinistryKey] ?? 0 } } });
      else if (k === 'regDecree' && isl) setPalaceSettings({ regional: { ...s.regional, [isl]: { ...s.regional[isl], decree: Number(el.value) || 0 } } });
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
            `<option value="${d.g}" title="${esc(decreeInfo(d.g))}" ${d.g === cur ? 'selected' : ''} ${s.attr >= d.at ? '' : 'disabled'}>${esc(pick(d.n))} (${esc(t('pal.from', { n: num(d.at) }))})</option>`,
        )
        .join('')}`;
    };
    /** Erklärung unter einer Auswahl: gewählte Richtlinie, sonst der Basiseffekt des Ministeriums. */
    const desc = (k: MinistryKey, g: number): string =>
      `<small class="pal-desc">${g ? `<b>${esc(pick(data.ministries.find((m) => m.k === k)?.decrees.find((d) => d.g === g)?.n ?? { de: '', en: '' }))}:</b> ${esc(decreeInfo(g))}` : esc(ministryInfo(k))}</small>`;
    const overview = data.ministries
      .map(
        (m) => `<h4>${icon(m.i)}${esc(pick(m.n))} <small>${esc(t('pal.from', { n: num(m.at) }))}</small></h4>
          <p class="pal-note">${esc(ministryInfo(m.k))}</p>
          <ul>${m.decrees.map((d) => `<li><b>${esc(pick(d.n))}</b> <small>(${esc(t('pal.from', { n: num(d.at) }))})</small> – ${esc(decreeInfo(d.g))}</li>`).join('')}</ul>`,
      )
      .join('');
    const paved = 71 + 3 * s.wings;
    const level = s.population > 0 ? levelForPopulation(s.population) : 0;
    const auto = s.population > 0 ? wingsForPopulation(s.population) : 0;
    const regRow = (k: IslandType): string => {
      const r = s.regional[k];
      return `<div class="pal-reg"><b>${esc(t(`pal.island.${k}`))}</b> <small>${esc(t(`pal.islandNote.${k}`))}</small>
        <div class="pal-list">
          <label><span>${esc(t('pal.ministry'))}</span><select data-k="regMinistry" data-t="${k}">${data.ministries
            .map(
              (m) =>
                `<option value="${m.k}" ${m.k === r.ministry ? 'selected' : ''} ${s.attr >= m.at ? '' : 'disabled'}>${esc(pick(m.n))} (${esc(
                  t('pal.from', { n: num(m.at) }),
                )})</option>`,
            )
            .join('')}</select></label>
          <label><span>${esc(t('pal.decree'))}</span><select data-k="regDecree" data-t="${k}">${decreeOptions(r.ministry, r.decree)}</select>${desc(r.ministry, r.decree)}</label>
        </div>
        <small class="pal-desc">${esc(ministryInfo(r.ministry))}</small></div>`;
    };
    box.innerHTML = `<h2>🏛 ${esc(t('pal.title'))}</h2>
      <p class="pal-lead">${esc(t('pal.globalLead'))}</p>
      <h3>${esc(t('pal.sec.progress'))}</h3>
      <div class="pal-grid2">
        <label><span>${esc(t('pal.attr'))}</span><input type="number" data-k="attr" min="0" max="99999" step="50" value="${s.attr}" />
          <small>${esc(t('pal.prestige', { n: prestigeOf(s.attr, data) }))}${esc(t('pal.prestigeInfo', { a: num(data.paragon.first), b: num(data.paragon.step) }))}</small></label>
        <label><span>${esc(t('pal.population'))}</span><input type="number" data-k="population" min="0" step="1000" value="${s.population || ''}" placeholder="${esc(t('pal.popPlaceholder'))}" />
          <small>${esc(level ? t('pal.popInfo', { l: level, w: auto }) : t('pal.popHint'))}</small></label>
        <label><span>${esc(t('pal.wings'))}</span><input type="number" data-k="wings" min="0" max="400" step="1" value="${s.wings}" />
          <small>${esc(t('pal.rangeInfo', { p: paved, r: Math.floor(paved / 2), b: data.range.base, w: data.range.perWing }))}${
            level && auto !== s.wings ? ` · ${esc(t('pal.wingsManual', { w: auto }))}` : ''
          }</small></label>
      </div>
      <h3>${esc(t('pal.sec.palace'))}</h3>
      <p class="pal-note">${esc(t('pal.notePalace'))}</p>
      <div class="pal-list">${data.ministries
        .map((m) => {
          const ok = s.attr >= m.at;
          return `<label class="${ok ? '' : 'locked'}"><span title="${esc(ministryInfo(m.k))}">${icon(m.i)}${esc(pick(m.n))} <small>${esc(t(ok ? 'pal.from' : 'pal.lockedFrom', { n: num(m.at) }))}</small></span>
            <select data-k="palace" data-m="${m.k}" ${ok ? '' : 'disabled'}>${decreeOptions(m.k, s.palace[m.k] ?? 0)}</select>${desc(m.k, s.palace[m.k] ?? 0)}</label>`;
        })
        .join('')}</div>
      <h3>${esc(t('pal.sec.regional'))}</h3>
      <p class="pal-note">${esc(t('pal.noteRegional'))}</p>
      ${ISLAND_TYPES.map(regRow).join('')}
      <details class="pal-overview"><summary>${esc(t('pal.overview'))}</summary>${overview}</details>
      <p><button type="button" class="pal-reset" data-k="reset">${esc(t('pal.reset'))}</button></p>`;
  };
  render();
  dialog.hidden = false;
}
