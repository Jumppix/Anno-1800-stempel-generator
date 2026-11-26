// Stadtplaner: Schalter, die logisch von anderen Einstellungen abhängen, folgen
// automatisch (Palast-Einstellungen, Bauweise, Post, Rathaus-Items, Stempel).
// Ändert der Nutzer einen davon von Hand, bleibt seine Wahl bestehen, bis er
// „Automatik wiederherstellen“ klickt.
import { loadPalace, type PalaceData } from './db/data';
import { cityPalaceRules, getPalaceSettings, onPalaceSettings } from './palaceSettings';
import { hasMinistry, hasPolicy } from './rules';

const KEY = 'anno-planer:overrides:v1';

interface AutoRule {
  id: string;
  /** Gewünschter Wert (Häkchen oder Auswahl); undefined = keine Vorgabe. */
  value?: () => boolean | string | undefined;
  /** Feld gesperrt (dann gilt `value` auch gegen eine Handänderung). */
  locked?: () => boolean;
  /** Feld (mit Beschriftung) ausblenden. */
  hidden?: () => boolean;
  /** Kurzer Grund für den Tooltip. */
  why: string;
}

const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const checked = (id: string): boolean => !!$<HTMLInputElement>(id)?.checked;
const value = (id: string): string => $<HTMLSelectElement>(id)?.value ?? '';

let palaceData: PalaceData | null = null;
/** Enthält der zuletzt geladene Stempel Ingenieur-/Investorenhäuser? */
let stampTiers: boolean | null = null;

const cityMinistry = (): ReturnType<typeof cityPalaceRules> =>
  cityPalaceRules(getPalaceSettings(), palaceData, value('rule-island') === 'palace' ? 'palace' : 'city');

const RULES: readonly AutoRule[] = [
  {
    id: 'plan-ministry',
    value: () => {
      const r = cityMinistry();
      return !!r.palace || hasMinistry(r, 'welfare') || hasMinistry(r, 'city');
    },
    why: 'an auf der Palastinsel (Palast) oder wenn das Regionalministerium der Wohninsel hier wirkt: Wohlfahrt oder Verwaltung',
  },
  {
    id: 'plan-engineers',
    value: () => !hasMinistry(cityMinistry(), 'city'),
    why: 'aus bei Verwaltung – die Arbeitskraft je Rathaus deckt die Ingenieure der Kraftwerke',
  },
  {
    id: 'svc-university',
    value: () => value('plan-levels') !== '45',
    why: 'aus bei Bauweise 4-5 (keine Ingenieurshäuser)',
  },
  {
    id: 'svc-drugStore',
    value: () => true,
    why: 'an – jede Bauweise hat Ingenieure Stufe 3 oder Investoren Stufe 5',
  },
  {
    id: 'plan-post',
    value: () => value('rule-mail') !== 'none',
    why: 'aus bei „Keine Post“',
  },
  {
    id: 'plan-airport',
    value: () => value('rule-mail') === 'regional' || value('rule-mail') === 'all',
    why: 'nur mit regionaler bzw. Übersee-Post',
  },
  {
    id: 'rule-delivery',
    value: () => (checked('rule-items') ? undefined : false),
    locked: () => !checked('rule-items'),
    why: 'braucht die Rathaus-Items (Lieferdienst)',
  },
  {
    id: 'rule-fourth',
    hidden: () => {
      return !hasPolicy(cityMinistry(), 'freethinkers');
    },
    why: 'nur mit Verwaltung + Freigeisterreform',
  },
  {
    id: 'plan-oil-source',
    hidden: () => value('plan-power-fuel') !== 'oil',
    why: 'nur bei Ölkraftwerken',
  },
  {
    id: 'palace-attr',
    hidden: () => value('rule-island') !== 'palace',
    why: 'nur auf der Palastinsel',
  },
  {
    id: 'rule-tiers',
    value: () => (stampTiers === null ? undefined : stampTiers ? 'stamp' : 'groups'),
    why: '„wie im Stempel“, wenn der Stempel Ingenieur-/Investorenhäuser enthält',
  },
];

function loadOverrides(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
const overrides = loadOverrides();
function saveOverrides(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...overrides]));
  } catch {
    /* nur für diese Sitzung */
  }
}

/** Handwerte, die beim Sperren überschrieben wurden (beim Entsperren zurück). */
const beforeLock = new Map<string, boolean | string>();
let applying = false;

function current(f: HTMLInputElement | HTMLSelectElement): boolean | string {
  return f instanceof HTMLInputElement && f.type === 'checkbox' ? f.checked : f.value;
}
function set(f: HTMLInputElement | HTMLSelectElement, v: boolean | string): void {
  if (current(f) === v) return;
  if (f instanceof HTMLInputElement && f.type === 'checkbox') f.checked = Boolean(v);
  else f.value = String(v);
  f.dispatchEvent(new Event('change', { bubbles: true }));
}

function apply(): void {
  if (applying) return;
  applying = true;
  try {
    for (const r of RULES) {
      const f = $<HTMLInputElement | HTMLSelectElement>(r.id);
      if (!f) continue;
      const locked = r.locked?.() ?? false;
      if (locked && !f.disabled && overrides.has(r.id)) beforeLock.set(r.id, current(f));
      if (!locked && f.disabled && beforeLock.has(r.id)) {
        f.disabled = false;
        set(f, beforeLock.get(r.id) as boolean | string);
        beforeLock.delete(r.id);
      }
      f.disabled = locked;
      const want = r.value?.();
      if (want !== undefined && (locked || !overrides.has(r.id))) set(f, want);
      const row = f.closest<HTMLElement>('label') ?? f;
      if (r.hidden) row.style.display = r.hidden() ? 'none' : '';
      row.classList.toggle('auto-manual', overrides.has(r.id) && !locked && r.value !== undefined);
      row.title = `${overrides.has(r.id) && !locked ? 'Von Hand geändert. Automatik: ' : 'Automatisch: '}${r.why}`;
    }
    const n = RULES.filter((r) => overrides.has(r.id) && r.value).length;
    const info = $('auto-info');
    if (info) {
      info.hidden = n === 0;
      const txt = info.querySelector('span');
      if (txt) txt.textContent = `${n} automatische${n === 1 ? 'r Schalter' : ' Schalter'} von Hand geändert (gelb markiert).`;
    }
  } finally {
    applying = false;
  }
}

/** Nach dem Wiederherstellen der gespeicherten Einstellungen aufrufen. */
export function initPlannerDefaults(): void {
  for (const r of RULES) {
    const f = $<HTMLInputElement | HTMLSelectElement>(r.id);
    if (!f || !r.value) continue;
    f.addEventListener('change', (e) => {
      if (!e.isTrusted || applying) return;
      overrides.add(r.id);
      saveOverrides();
      apply();
    });
  }
  // Abhängigkeiten
  for (const id of ['plan-levels', 'rule-mail', 'rule-items', 'rule-island', 'plan-power-fuel']) $(id)?.addEventListener('change', () => apply());
  onPalaceSettings(() => apply());
  document.addEventListener('city-stamp-loaded', (e) => {
    stampTiers = !!(e as CustomEvent<{ tiers: boolean }>).detail?.tiers;
    apply();
  });
  $('auto-reset')?.addEventListener('click', () => {
    overrides.clear();
    beforeLock.clear();
    saveOverrides();
    apply();
  });
  apply();
  void loadPalace().then((d) => {
    palaceData = d;
    apply();
  });
}
