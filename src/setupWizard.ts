// Einrichtungs-Assistent des Stadtplaners: erscheint, wenn eine Insel geladen wird, und stellt
// mit ein paar Fragen (Inselart, Strom, Spielstand) alle Einstellungen für diese Insel ein.
// Gefragt wird nur, was der Planer nicht selbst ausprobieren kann – Häuser je Reihe,
// Bauweise, Flügel, Reformen, Gleisführung usw. entscheidet der Optimierer.
import { loadPalace } from './db/data';
import { cityPalaceRules, getPalaceSettings, openPalaceDialog, palaceSummary } from './palaceSettings';

/** Was der Assistent über die geladene Insel weiß (aus den Stempeln). */
export interface WizardIsland {
  label: string;
  /** Verschiebbare Ölquellen (Bohrtürme) und Lehmgruben, Minen im Stempel. */
  oil: number;
  clay: number;
  mines: number;
  /** Sonstige Gebäude im Stempel. */
  other: number;
  /** Hafengebiet (Kaistraße) bzw. Kontor erkannt. */
  harbor: boolean;
  kontor: boolean;
}

interface Choice {
  value: string;
  label: string;
  note?: string;
}

interface Step {
  key: string;
  title: string;
  lead?: string;
  /** Schritt nur zeigen, wenn … */
  when?: () => boolean;
  choices: () => Choice[];
  /** Vorauswahl aus den aktuellen Einstellungen. */
  current: () => string;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const esc = (x: string): string => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const num = (n: number): string => n.toLocaleString('de-DE');

/** Feld setzen und „change“ auslösen (abhängige Schalter, Speichern, Zusammenfassungen). */
function setField(id: string, v: string | boolean): void {
  const f = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (!f) return;
  if (f instanceof HTMLInputElement && f.type === 'checkbox') {
    if (f.checked === v) return;
    f.checked = Boolean(v);
  } else {
    if (f.value === String(v)) return;
    f.value = String(v);
  }
  f.dispatchEvent(new Event('change', { bubbles: true }));
}
const value = (id: string): string => ($<HTMLInputElement>(id)?.value ?? '');
const checked = (id: string): boolean => !!$<HTMLInputElement>(id)?.checked;

let modal: HTMLElement | null = null;

/**
 * Assistent öffnen. `onRun`: nach „Übernehmen & planen“ (startet die Planung).
 */
export async function openSetupWizard(island: WizardIsland | null, onRun?: () => void): Promise<void> {
  const palace = await loadPalace();
  const answers = new Map<string, string>();
  const isPalace = (): boolean => (answers.get('island') ?? value('rule-island')) === 'palace';
  const steps: Step[] = [
    {
      key: 'island',
      title: 'Welche Insel planst du?',
      lead: island ? `Geladen: ${island.label}` : undefined,
      choices: () => {
        const s = getPalaceSettings();
        const reg = cityPalaceRules(s, palace, 'city');
        const regName = reg.ministry === 'city' ? 'Verwaltung' : reg.ministry === 'welfare' ? 'Wohlfahrt' : reg.ministry === 'labour' ? 'Arbeit' : 'keins';
        return [
          { value: 'city', label: 'Wohninsel', note: `Hochhäuser mit Läden, Rathäusern und Post. Regionalministerium laut Spielstand: ${regName}.` },
          { value: 'palace', label: 'Crown Falls / Palastinsel', note: 'Palast mit Flügeln und allen Ministerien, Museen für die Attraktivität (Prestige).' },
        ];
      },
      current: () => value('rule-island') || 'city',
    },
    {
      key: 'power',
      title: 'Womit sollen die Kraftwerke laufen?',
      choices: () => [
        {
          value: 'gas',
          label: 'Gas',
          note: `Gaskraftwerke, Gas kommt über die Lagerhäuser.${island?.oil ? ' Die Ölquellen aus dem Stempel kommen trotzdem als Ölfeld an die Küste.' : ''}`,
        },
        {
          value: 'oil-own',
          label: 'Öl von der eigenen Insel',
          note: island?.oil
            ? `${island.oil} Ölquelle${island.oil === 1 ? '' : 'n'} im Stempel – Raffinerien mit Bohrtürmen, Ölhafen und Gleise plant der Planer.`
            : 'Im Stempel sind keine Ölquellen (Bohrtürme als Blaupause) – dann wie „per Schiff“.',
        },
        { value: 'oil-ship', label: 'Öl per Schiff', note: 'Nur Ölhafen, Gleise und Ölkraftwerke; das Öl kommt von anderen Inseln.' },
      ],
      current: () => (value('plan-power-fuel') === 'oil' ? (value('plan-oil-source') === 'ship' || !island?.oil ? 'oil-ship' : 'oil-own') : 'gas'),
    },
    {
      key: 'levels',
      title: 'Hast du Hochhäuser der Stufe 4 und 5 freigeschaltet?',
      lead: 'Die beste Bauweise (4-5, 3-3-5 oder gemischt) sucht der Planer selbst.',
      choices: () => [
        { value: 'auto', label: 'Ja', note: 'Investoren bis Stufe 5 (Aufzüge, Drogerie …).' },
        { value: 'l3', label: 'Nein, nur Stufe 3' },
      ],
      current: () => (value('plan-levels') === 'l3' ? 'l3' : 'auto'),
    },
    {
      key: 'mail',
      title: 'Welche Post hast du?',
      choices: () => [
        { value: 'all', label: 'Lokal + Regional + Übersee', note: 'Briefkästen und Lufthafen mit Luftpostlager.' },
        { value: 'regional', label: 'Lokal + Regional', note: 'Briefkästen und Lufthafen.' },
        { value: 'local', label: 'Nur Lokal', note: 'Briefkästen.' },
        { value: 'none', label: 'Keine Post' },
      ],
      current: () => value('rule-mail') || 'all',
    },
    {
      key: 'items',
      title: 'Hast du die Rathaus-Items?',
      lead: 'Zofe, Lieferdienst und Saint D’Artois in jedem Rathaus. Ohne Items plant der Planer keine Rathäuser (außer auf Crown Falls mit Rathausreform).',
      choices: () => [
        { value: 'yes', label: 'Ja' },
        { value: 'no', label: 'Nein' },
      ],
      current: () => (checked('rule-items') ? 'yes' : 'no'),
    },
    {
      key: 'attr',
      title: 'Crown Falls: Welche Attraktivität willst du erreichen?',
      lead: 'Palast, Flügel und Rathausreform zählen mit; Museen decken den Rest. Flügel und Reformen vergleicht der Planer selbst.',
      when: isPalace,
      choices: () => [
        { value: '33000', label: 'Prestige 25 (33.000)', note: 'Höchste Prestige-Stufe – verstärkt alle Ministerien.' },
        { value: 'keep', label: `Wie eingestellt (${num(Number(value('plan-attr-target')) || 0)})` },
        { value: 'none', label: 'Keine Museen einplanen', note: 'Nur Wohnraum; Attraktivität kommt von woanders.' },
      ],
      current: () => (!checked('plan-museums') ? 'none' : value('plan-attr-target') === '33000' ? '33000' : 'keep'),
    },
    {
      key: 'stamp',
      title: 'Gebäude aus dem Stempel: verschieben oder fest?',
      lead: island
        ? `Im Stempel: ${[
            island.clay ? `${island.clay} Lehmgrube${island.clay === 1 ? '' : 'n'}` : '',
            island.oil ? `${island.oil} Ölquelle${island.oil === 1 ? '' : 'n'}` : '',
            island.other ? `${island.other} sonstige Gebäude` : '',
          ]
            .filter(Boolean)
            .join(', ')}. Eingeplant werden sie immer; Minen bleiben ohnehin fest.`
        : undefined,
      when: () => !!island && island.clay + island.oil + island.other > 0,
      choices: () => [
        {
          value: 'recommended',
          label: 'Lehmgruben und Ölquellen neu platzieren, Sonstiges bleibt (empfohlen)',
          note: 'Lehmgruben alle unter einer Handelskammer mit Lagerhaus, Ölquellen zusammen an der Küste.',
        },
        { value: 'fixed', label: 'Alles bleibt, wo es steht', note: 'Bekommt Straße und Lagerhaus, wo nötig.' },
        { value: 'move', label: 'Alles neu planen', note: 'Auch sonstige Gebäude – ihre Fläche wird bebaut.' },
      ],
      current: () => {
        const c = value('plan-fix-clay');
        const o = value('plan-fix-oil');
        const x = value('plan-fix-other');
        if (c === 'fixed' && o === 'fixed' && x === 'fixed') return 'fixed';
        if (c === 'move' && o === 'move' && x === 'move') return 'move';
        return 'recommended';
      },
    },
    {
      key: 'clay',
      title: 'Bekommen die Lehmgruben Strom?',
      lead: island?.clay
        ? `${island.clay} Lehmgrube${island.clay === 1 ? '' : 'n'} – Lagerhäuser direkt im Block.`
        : undefined,
      when: () => (island?.clay ?? 0) > 0,
      choices: () => [
        { value: 'power', label: 'Ja, mit Strom', note: 'Kraftwerk in Reichweite, ein Lagerhaus je 6 Lehmgruben.' },
        { value: 'nopower', label: 'Nein', note: 'Ein Lagerhaus je 4 Lehmgruben.' },
      ],
      current: () => (checked('plan-clay-power') ? 'power' : 'nopower'),
    },
    {
      key: 'effort',
      title: 'Wie lange darf der Planer rechnen?',
      lead: 'Mehr Zeit = mehr Varianten gleichzeitig; der Plan mit den meisten Einwohnern gewinnt.',
      choices: () => [
        { value: 'fast', label: 'Schnell', note: '1 Durchlauf – zum Ausprobieren.' },
        { value: 'normal', label: 'Normal', note: '3 Durchläufe.' },
        {
          value: 'thorough',
          label: 'Gründlich (empfohlen)',
          note: (answers.get('power') ?? '').startsWith('oil') ? '10 Durchläufe, mit Gleiskorridor (2. Durchgang, doppelte Zeit).' : '10 Durchläufe.',
        },
        { value: 'max', label: 'Maximal', note: 'Längere Suche, exakter Löser – deutlich langsamer.' },
      ],
      current: () => value('plan-effort') || 'thorough',
    },
  ];

  const visible = (): Step[] => steps.filter((s) => !s.when || s.when());
  let index = 0;

  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'pal-modal wz-modal';
    modal.hidden = true;
    modal.innerHTML = '<div class="pal-box wz-box" role="dialog" aria-modal="true" aria-label="Einrichtung"><button class="pal-close" type="button" aria-label="Schließen">✕</button><div class="wz-content"></div></div>';
    document.body.append(modal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.hidden) modal.hidden = true;
    });
  }
  const box = modal.querySelector('.wz-content') as HTMLElement;
  const close = (): void => {
    if (modal) modal.hidden = true;
  };

  const apply = (): void => {
    const a = (k: string): string | undefined => answers.get(k);
    // Automatische Schalter wieder der Automatik überlassen (neue Insel)
    document.getElementById('auto-reset')?.click();
    setField('rule-island', a('island') ?? 'city');
    const power = a('power') ?? 'gas';
    setField('plan-power-fuel', power === 'gas' ? 'gas' : 'oil');
    if (power !== 'gas') setField('plan-oil-source', power === 'oil-own' && island?.oil ? 'own' : 'ship');
    setField('plan-levels', a('levels') ?? 'auto');
    setField('rule-mail', a('mail') ?? 'all');
    setField('rule-items', (a('items') ?? 'yes') === 'yes');
    if (a('island') === 'palace') {
      const attr = a('attr') ?? '33000';
      setField('plan-museums', attr !== 'none');
      if (attr === '33000') setField('plan-attr-target', '33000');
    }
    if (island && island.clay + island.oil + island.other > 0) {
      const st = a('stamp') ?? 'recommended';
      setField('plan-fix-clay', st === 'fixed' ? 'fixed' : 'move');
      setField('plan-fix-oil', st === 'fixed' ? 'fixed' : 'move');
      setField('plan-fix-other', st === 'move' ? 'move' : 'fixed');
    }
    if (island?.clay) setField('plan-clay-power', (a('clay') ?? 'power') === 'power');
    setField('plan-effort', a('effort') ?? 'thorough');
  };

  const summary = (): string => {
    const rows: Array<[string, string]> = [];
    for (const st of visible()) {
      const v = answers.get(st.key) ?? st.current();
      const c = st.choices().find((x) => x.value === v);
      rows.push([st.title.replace(/\?$/, ''), c?.label ?? v]);
    }
    return rows.map(([q, v]) => `<tr><td>${esc(q)}</td><td><b>${esc(v)}</b></td></tr>`).join('');
  };

  const render = (): void => {
    const list = visible();
    const done = index >= list.length;
    const dots = list
      .map((_, k) => `<i class="${k < index ? 'done' : k === index ? 'cur' : ''}"></i>`)
      .join('');
    if (done) {
      const s = getPalaceSettings();
      box.innerHTML = `<h2>🧭 Einrichtung – fertig</h2>
        <div class="wz-dots">${dots}</div>
        <table class="wz-sum">${summary()}</table>
        <p class="pal-note">Für deinen ganzen Spielstand (alle Inseln) gilt außerdem: ${esc(palaceSummary(s, palace))}
          <button type="button" class="linkish" data-wz="palace">prüfen …</button></p>
        <p class="pal-note">Alles Weitere (Gebäude, Produktion, Rechenzeit) kannst du links unter „Stadt planen“ noch ändern; den Assistenten öffnest du dort erneut mit „🧭 Einrichtung“.</p>
        <div class="wz-actions">
          <button type="button" class="ghost" data-wz="back">← Zurück</button>
          <button type="button" class="ghost" data-wz="apply">Übernehmen</button>
          ${onRun ? '<button type="button" class="primary" data-wz="run">Übernehmen &amp; planen</button>' : ''}
        </div>`;
      return;
    }
    const st = list[index];
    const cur = answers.get(st.key) ?? st.current();
    box.innerHTML = `<h2>🧭 ${esc(st.title)}</h2>
      <div class="wz-dots">${dots}<span>${index + 1} / ${list.length}</span></div>
      ${st.lead ? `<p class="pal-lead">${esc(st.lead)}</p>` : ''}
      <div class="wz-choices">${st
        .choices()
        .map(
          (c) => `<button type="button" class="wz-choice ${c.value === cur ? 'on' : ''}" data-v="${esc(c.value)}">
            <b>${esc(c.label)}</b>${c.note ? `<small>${esc(c.note)}</small>` : ''}</button>`,
        )
        .join('')}</div>
      <div class="wz-actions">
        ${index > 0 ? '<button type="button" class="ghost" data-wz="back">← Zurück</button>' : '<span></span>'}
        <button type="button" class="ghost" data-wz="skip">Überspringen (so lassen)</button>
      </div>`;
  };

  box.onclick = (e) => {
    const el = e.target as HTMLElement;
    const choice = el.closest<HTMLElement>('.wz-choice');
    const act = el.closest<HTMLElement>('[data-wz]')?.dataset.wz;
    if (choice) {
      const st = visible()[index];
      answers.set(st.key, choice.dataset.v ?? '');
      index++;
    } else if (act === 'back') index = Math.max(0, index - 1);
    else if (act === 'skip') {
      const st = visible()[index];
      answers.set(st.key, st.current());
      index++;
    } else if (act === 'palace') {
      void openPalaceDialog();
      return;
    } else if (act === 'apply' || act === 'run') {
      apply();
      close();
      if (act === 'run') onRun?.();
      return;
    } else return;
    render();
  };
  (modal.querySelector('.pal-close') as HTMLElement).onclick = close;
  modal.onclick = (e) => {
    if (e.target === modal) close();
  };
  render();
  modal.hidden = false;
}
