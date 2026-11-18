// Datenbank-Seite: Gebäude und Items aus public/db (erzeugt von
// scripts/data/build-db.mjs). Liste mit Suche/Filtern links, Details rechts,
// Verweise per #b=<GUID> bzw. #i=<GUID>.
import { applyI18n, getLang, onLangChange, pick, t } from '../i18n';
import { mountSite } from '../site';

type Bi = { de: string; en: string };
type Amount = { p: number; a: number; ia?: number };

interface Building {
  g: number;
  t: string;
  c: string;
  n: Bi;
  d?: Bi;
  i?: string;
  reg?: string[];
  sz?: [number, number];
  rad?: number;
  rng?: number;
  road?: boolean;
  cost?: Amount[];
  costInh?: boolean;
  mt?: Amount[];
  in?: Amount[];
  out?: Amount[];
  ct?: number;
  calcTpm?: number;
  ps?: { full?: number; none?: number; out?: number[] };
  pw?: number;
  pow?: 'req' | 'opt';
  sock?: { r?: number; a?: string };
  res?: { lvl?: number; max?: number };
  up?: number;
  dlc?: number;
}

interface Effect {
  grp: string;
  k: string;
  v: unknown;
}

interface Item {
  g: number;
  t: string;
  n: Bi;
  d?: Bi;
  i?: string;
  r: string;
  s: string;
  it?: string;
  p?: number;
  tg: number[];
  tgx: number[];
  fx: Effect[];
  ex?: Array<{ k: string; v: number }>;
  dlc?: number;
  act?: boolean;
}

interface Meta {
  built: string;
  sources: Array<{ name: string; url: string; commit: string | null; license: string; use: string }>;
  counts: Record<string, number>;
  limits: string[];
  labels: { effects: Record<string, [string, string]>; rarity: Record<string, [string, string]>; expedition?: Record<string, [string, string]> };
}

type Names = Record<string, [string, string, string?]>;

const BASE = `${import.meta.env.BASE_URL}db/`;
const PAGE = 120;
const CATEGORIES = ['residence', 'public', 'production', 'module', 'special', 'harbor', 'infrastructure', 'ornament', 'other'];
const REGIONS = ['ow', 'nw', 'arctic', 'africa'];
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'narrative'];

let meta: Meta;
let buildings: Building[] = [];
let items: Item[] = [];
let names: Names = {};
const buildingBy = new Map<number, Building>();
const itemBy = new Map<number, Item>();
const itemsFor = new Map<number, Item[]>();
const raw: { b?: Promise<Record<string, unknown>>; i?: Promise<Record<string, unknown>> } = {};

let tab: 'b' | 'i' = 'b';
let shown = PAGE;
let selected: number | null = null;
const filter = { q: '', cat: '', reg: '', dlc: '', slot: '', rarity: '', fx: '' };

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const num = (n: number): string => n.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 2 });
const iconUrl = (file?: string): string => (file ? `${BASE}icons/${file}` : '');
const img = (file?: string, cls = ''): string => (file ? `<img class="${cls}" src="${iconUrl(file)}" alt="" loading="lazy" />` : '');
const nameOfGuid = (g: number): string => {
  const n = names[g];
  return n ? (getLang() === 'de' ? n[0] : n[1]) || n[0] : `#${g}`;
};

/**
 * Verweis auf eine GUID: nur das Icon (plus Menge o. Ä.), der Name steht im
 * Tooltip (Maus darüber oder antippen). Ohne Icon wird der Name gezeigt.
 * Link zum Eintrag, falls es ihn in der Datenbank gibt.
 */
function chip(g: number, extra = ''): string {
  const n = names[g];
  const name = nameOfGuid(g);
  const ic = n?.[2];
  const href = buildingBy.has(g) ? `#b=${g}` : itemBy.has(g) ? `#i=${g}` : '';
  const body = ic ? `${img(ic)}${extra ? `<span>${esc(extra)}</span>` : ''}` : `${esc(name)}${extra ? ` ${esc(extra)}` : ''}`;
  const cls = `chip${ic ? (extra ? '' : ' icon-only') : ' plain'}`;
  const tip = `data-tip="${esc(name)}" aria-label="${esc(name)}${extra ? ` ${esc(extra)}` : ''}"`;
  return href ? `<a class="${cls}" href="${href}" ${tip}>${body}</a>` : `<span class="${cls}" tabindex="0" ${tip}>${body}</span>`;
}

/** Tooltip für [data-tip]: beim Überfahren und beim Antippen/Klicken. */
function setupTooltip(): void {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.append(tip);
  let pinned: HTMLElement | null = null;
  const show = (el: HTMLElement): void => {
    tip.textContent = el.dataset.tip ?? '';
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.top - tip.offsetHeight - 6 < 4 ? r.bottom + 6 : r.top - tip.offsetHeight - 6}px`;
  };
  const hide = (): void => {
    tip.hidden = true;
    pinned = null;
  };
  document.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (el) show(el);
    else if (!pinned) tip.hidden = true;
  });
  document.addEventListener('focusin', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (el && el.tagName !== 'A') {
      if (pinned === el) hide();
      else {
        show(el);
        pinned = el;
      }
    } else hide();
  });
  window.addEventListener('scroll', hide, true);
}

const amounts = (list?: Amount[], inactive = false): string =>
  list?.length
    ? `<div class="chips">${list
        .map((a) => chip(a.p, `${num(a.a)}${inactive && a.ia !== undefined && a.ia !== a.a ? ` (${t('d.inactive')} ${num(a.ia)})` : ''}`))
        .join('')}</div>`
    : '–';

// ------------------------------------------------------------------ Laden
async function load(): Promise<void> {
  const get = async <T>(f: string): Promise<T> => {
    const r = await fetch(BASE + f);
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    return (await r.json()) as T;
  };
  [meta, buildings, items, names] = await Promise.all([
    get<Meta>('meta.json'),
    get<Building[]>('buildings.json'),
    get<Item[]>('items.json'),
    get<Names>('names.json'),
  ]);
  for (const b of buildings) buildingBy.set(b.g, b);
  for (const it of items) {
    itemBy.set(it.g, it);
    for (const g of it.tgx) {
      const list = itemsFor.get(g);
      if (list) list.push(it);
      else itemsFor.set(g, [it]);
    }
  }
}

const rawOf = (kind: 'b' | 'i', g: number): Promise<unknown> => {
  const key = kind;
  raw[key] ??= fetch(BASE + (kind === 'b' ? 'buildings-raw.json' : 'items-raw.json')).then((r) => r.json());
  return (raw[key] as Promise<Record<string, unknown>>).then((all) => all[g]);
};

// ------------------------------------------------------------------ Filter
function select(id: string, labelKey: string, options: Array<[string, string]>, value: string): string {
  return `<select id="${id}" aria-label="${esc(t(labelKey))}"><option value="">${esc(t(labelKey))}: ${esc(t('db.all'))}</option>${options
    .map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`)
    .join('')}</select>`;
}

function dlcOptions(list: Array<{ dlc?: number }>): Array<[string, string]> {
  const set = new Set<number>();
  for (const x of list) if (x.dlc) set.add(x.dlc);
  return [['0', t('db.base')], ...[...set].map((g): [string, string] => [String(g), nameOfGuid(g)]).sort((a, b) => a[1].localeCompare(b[1]))];
}

function renderFilters(): void {
  const box = $('#db-filters');
  const search = `<div class="search wide"><input id="f-q" type="search" value="${esc(filter.q)}" placeholder="${esc(
    t('db.search'),
  )}" /><button id="f-q-clear" type="button" aria-label="${esc(t('db.clear'))}" title="${esc(t('db.clear'))}"${filter.q ? '' : ' hidden'}>✕</button></div>`;
  if (tab === 'b') {
    box.innerHTML =
      search +
      select('f-cat', 'db.filter.category', CATEGORIES.map((c) => [c, t(`cat.${c}`)]), filter.cat) +
      select('f-reg', 'db.filter.region', REGIONS.map((r) => [r, t(`reg.${r}`)]), filter.reg) +
      `<div class="wide">${select('f-dlc', 'db.filter.dlc', dlcOptions(buildings), filter.dlc)}</div>`;
  } else {
    const slots = [...new Set(items.map((i) => i.s))].map((s): [string, string] => [s, t(`slot.${s}`)]).sort((a, b) => a[1].localeCompare(b[1]));
    const fxKeys = [...new Set(items.flatMap((i) => i.fx.map((e) => e.k)))]
      .map((k): [string, string] => [k, effectLabel(k)])
      .sort((a, b) => a[1].localeCompare(b[1]));
    box.innerHTML =
      search +
      select('f-slot', 'db.filter.slot', slots, filter.slot) +
      select('f-rarity', 'db.filter.rarity', RARITIES.map((r) => [r, rarityLabel(r)]), filter.rarity) +
      select('f-fx', 'db.filter.effect', fxKeys, filter.fx) +
      select('f-dlc', 'db.filter.dlc', dlcOptions(items), filter.dlc);
  }
  const bind = (id: string, key: keyof typeof filter, ev = 'change'): void => {
    document.getElementById(id)?.addEventListener(ev, (e) => {
      filter[key] = (e.target as HTMLInputElement).value;
      shown = PAGE;
      renderList();
    });
  };
  bind('f-q', 'q', 'input');
  const q = document.getElementById('f-q') as HTMLInputElement | null;
  const clear = document.getElementById('f-q-clear');
  q?.addEventListener('input', () => clear?.toggleAttribute('hidden', !q.value));
  clear?.addEventListener('click', () => {
    if (!q) return;
    q.value = '';
    filter.q = '';
    shown = PAGE;
    clear.hidden = true;
    q.focus();
    renderList();
  });
  bind('f-cat', 'cat');
  bind('f-reg', 'reg');
  bind('f-dlc', 'dlc');
  bind('f-slot', 'slot');
  bind('f-rarity', 'rarity');
  bind('f-fx', 'fx');
}

const matchText = (n: Bi, g: number, extra: string): boolean => {
  const q = filter.q.trim().toLowerCase();
  if (!q) return true;
  return `${n.de}\n${n.en}\n${g}\n${extra}`.toLowerCase().includes(q);
};
const matchDlc = (dlc?: number): boolean => !filter.dlc || (filter.dlc === '0' ? !dlc : String(dlc) === filter.dlc);

function filtered(): Array<Building | Item> {
  const byName = (a: { n: Bi }, b: { n: Bi }): number => pick(a.n).localeCompare(pick(b.n));
  if (tab === 'b') {
    return buildings
      .filter(
        (b) =>
          matchText(b.n, b.g, b.t) &&
          (!filter.cat || b.c === filter.cat) &&
          (!filter.reg || (b.reg ?? []).includes(filter.reg)) &&
          matchDlc(b.dlc),
      )
      .sort(byName);
  }
  return items
    .filter(
      (i) =>
        matchText(i.n, i.g, i.fx.map((e) => effectLabel(e.k)).join(' ')) &&
        (!filter.slot || i.s === filter.slot) &&
        (!filter.rarity || i.r === filter.rarity) &&
        (!filter.fx || i.fx.some((e) => e.k === filter.fx)) &&
        matchDlc(i.dlc),
    )
    .sort(byName);
}

// ------------------------------------------------------------------ Liste
function renderList(): void {
  const list = filtered();
  $('#db-count').textContent = list.length === 1 ? t('db.count1') : t('db.count', { n: num(list.length) });
  const rows = list.slice(0, shown).map((e) => {
    const sub =
      tab === 'b'
        ? [t(`cat.${(e as Building).c}`), ...((e as Building).reg ?? []).map((r) => t(`reg.${r}`)), (e as Building).sz?.join('×')]
        : [t(`slot.${(e as Item).s}`), rarityLabel((e as Item).r), (e as Item).fx[0] ? effectLabel((e as Item).fx[0].k) : '']
      ;
    return `<button class="db-row${e.g === selected ? ' active' : ''}" data-g="${e.g}" type="button">${
      e.i ? img(e.i, 'ico') : '<span class="ico"></span>'
    }<span class="txt"><span class="name${tab === 'i' ? ` rarity-${(e as Item).r}` : ''}">${esc(pick(e.n))}</span><span class="sub">${esc(
      sub.filter(Boolean).join(' · '),
    )}</span></span></button>`;
  });
  const box = $('#db-rows');
  box.innerHTML = rows.join('') + (list.length > shown ? `<button class="db-more" type="button">${esc(t('db.more'))}</button>` : '');
  box.querySelector('.db-more')?.addEventListener('click', () => {
    shown += PAGE * 2;
    renderList();
  });
}

// ------------------------------------------------------------------ Effekte
const effectLabel = (k: string): string => {
  const l = meta?.labels.effects[k];
  return l ? pick(l) : k.replace(/Upgrade$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
};
const rarityLabel = (r: string): string => {
  const l = meta?.labels.rarity[r];
  return l ? pick(l) : r;
};

function signed(v: number, pct: boolean): string {
  const s = `${v > 0 ? '+' : ''}${num(v)}${pct ? ' %' : ''}`;
  return `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${s}</span>`;
}

/** Ein Wert eines Effekts lesbar machen (Zahlen, GUID-Verweise, Listen). */
function fmtValue(v: unknown): string {
  if (typeof v === 'number') return names[v] && v >= 1000 ? chip(v) : signed(v, false);
  if (typeof v === 'string') return esc(v);
  if (Array.isArray(v)) return v.map((x) => fmtValue(x)).join(' ');
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('v' in o && typeof o.v === 'number') return signed(o.v, !!o.pct);
    return Object.entries(o)
      .map(([k, x]) => `<span class="lbl">${esc(k)}:</span> ${fmtValue(x)}`)
      .join(' ');
  }
  return '';
}

function fmtEffect(e: Effect): string {
  const label = `<span class="lbl">${esc(effectLabel(e.k))}</span>`;
  const list = Array.isArray(e.v) ? (e.v as Array<Record<string, number>>) : null;
  if (e.k === 'AdditionalOutput' && list) {
    return `${label} ${list
      .map((o) => chip(o.Product, `${o.Amount && o.Amount !== 1 ? `×${num(o.Amount)} ` : ''}${o.AdditionalOutputCycle && o.AdditionalOutputCycle > 1 ? t('d.every', { n: o.AdditionalOutputCycle }) : t('d.everyOne')}`))
      .join('')}`;
  }
  if (e.k === 'ReplaceInputs' && list) {
    return `${label} ${list.map((o) => `${chip(o.OldInput)} → ${chip(o.NewInput)}`).join(' ')}`;
  }
  if ((e.k === 'GoodConsumptionUpgrade' || e.k === 'InputAmountUpgrade') && list) {
    return `${label} ${list
      .map((o) => {
        const g = o.ProvidedNeed ?? o.Product;
        const pct = o.AmountInPercent;
        return g ? chip(g, typeof pct === 'number' ? `${pct > 0 ? '+' : ''}${pct} %` : '') : fmtValue(o);
      })
      .join('')}`;
  }
  if ((e.k === 'GenPool' || e.k === 'AddAssemblyOptions') && Array.isArray(e.v)) {
    return `${label} <span class="chips">${(e.v as unknown[]).map((x) => (typeof x === 'number' ? chip(x) : fmtValue(x))).join('')}</span>`;
  }
  return `${label} ${fmtValue(e.v)}`;
}

// ------------------------------------------------------------------ Details
const row = (k: string, v: string | undefined): string => (v === undefined || v === '' ? '' : `<dt>${esc(t(k))}</dt><dd>${v}</dd>`);
const sec = (k: string, body: string, note = ''): string =>
  body ? `<section class="d-sec"><h2>${esc(t(k))}</h2>${body}${note ? `<p class="note">${esc(note)}</p>` : ''}</section>` : '';
const grid = (rows: string): string => (rows ? `<dl class="d-grid">${rows}</dl>` : '');

function head(e: { g: number; n: Bi; d?: Bi; i?: string }, sub: string): string {
  return `<div class="d-head">${img(e.i)}<div><h1>${esc(pick(e.n))}</h1><div class="sub">${sub}</div></div></div>${
    e.d ? `<p class="d-desc">${esc(pick(e.d))}</p>` : ''
  }`;
}

function buildingDetail(b: Building): string {
  const sub = esc([t(`cat.${b.c}`), `GUID ${b.g}`].join(' · '));
  const general = grid(
    row('d.size', b.sz ? `${b.sz[0]} × ${b.sz[1]} <span class="lbl">(${esc(t('d.source.preset'))})</span>` : undefined) +
      row('d.region', b.reg?.map((r) => esc(t(`reg.${r}`))).join(', ')) +
      row('d.dlc', b.dlc ? chip(b.dlc) : undefined) +
      row('d.template', esc(b.t)) +
      row('d.electric', b.pow ? `<span class="${b.pow === 'req' ? 'power-req' : ''}">${esc(t(b.pow === 'req' ? 'd.powerReq' : 'd.powerOpt'))}</span>` : undefined) +
      row('d.upgrade', b.up ? chip(b.up) : undefined),
  );
  let prod = '';
  if (b.in || b.out || b.ct || b.calcTpm) {
    const outAmount = b.out?.[0]?.a ?? 1;
    const tpm = b.ct ? (60 / b.ct) * outAmount : undefined;
    const cycle = b.ct
      ? `${num(b.ct)} s → ${num(tpm as number)} ${esc(t('d.perMin'))}`
      : b.calcTpm
        ? `${num(60 / (b.calcTpm / outAmount))} s → ${num(b.calcTpm)} ${esc(t('d.perMin'))} <span class="lbl">(${esc(t('d.calc'))})</span>`
        : `<span class="lbl">${esc(t('d.unknownCycle'))}</span>`;
    prod = grid(row('d.inputs', b.in ? amounts(b.in) : undefined) + row('d.outputs', b.out ? amounts(b.out) : undefined) + row('d.cycle', cycle));
  }
  const ranges = grid(
    row('d.radius', b.rad ? num(b.rad) : undefined) +
      row('d.range', b.rng ? num(b.rng) : undefined) +
      row('d.psFull', b.ps?.full !== undefined ? num(b.ps.full) : undefined) +
      row('d.psNone', b.ps?.none !== undefined ? num(b.ps.none) : undefined) +
      row('d.power', b.pw ? num(b.pw) : undefined) +
      row('d.provides', b.ps?.out ? `<div class="chips">${b.ps.out.map((g) => chip(g)).join('')}</div>` : undefined) +
      row('d.socketRadius', b.sock?.r ? num(b.sock.r) : undefined),
  );
  const resid = b.res ? grid(row('d.tier', b.res.lvl ? chip(b.res.lvl) : undefined) + row('d.residents', b.res.max ? num(b.res.max) : undefined)) : '';
  const affecting = itemsFor.get(b.g) ?? [];
  const itemChips = affecting.length
    ? `<div class="chips">${affecting
        .slice()
        .sort((a, c) => pick(a.n).localeCompare(pick(c.n)))
        .map((i) => chip(i.g))
        .join('')}</div>`
    : '';
  return (
    head(b, sub) +
    sec('d.general', general) +
    sec('d.cost', b.cost || b.costInh ? amounts(b.cost) + (b.costInh ? `<p class="note">${esc(t('d.costInh'))}</p>` : '') : '') +
    sec('d.upkeep', b.mt ? amounts(b.mt, true) : '') +
    sec('d.production', prod) +
    sec('d.ranges', ranges, ranges ? t('d.rangeNote') : '') +
    sec('d.residence', resid) +
    sec('d.items', itemChips)
  );
}

function itemDetail(i: Item): string {
  const sub = `<span class="rarity-${esc(i.r)}">${esc(rarityLabel(i.r))}</span> · ${esc(t(`slot.${i.s}`))} · GUID ${i.g}`;
  const general = grid(
    row('d.slot', esc(t(`slot.${i.s}`))) +
      row('d.rarity', `<span class="rarity-${esc(i.r)}">${esc(rarityLabel(i.r))}</span>`) +
      row('d.type', i.it === 'Specialist' || i.it === 'Normal' ? esc(t(`itype.${i.it}`)) : undefined) +
      row('d.price', i.p ? num(i.p) : undefined) +
      row('d.dlc', i.dlc ? chip(i.dlc) : undefined) +
      row('d.active', i.act ? esc(t('d.yes')) : undefined) +
      row('d.template', esc(i.t)),
  );
  const fx = i.fx.length ? `<ul class="fx">${i.fx.map((e) => `<li>${fmtEffect(e)}</li>`).join('')}</ul>` : '';
  const targets = i.tg.length
    ? `<div class="chips">${i.tg.map((g) => chip(g)).join('')}</div>${
        i.tgx.length > i.tg.length || i.tgx.some((g) => !i.tg.includes(g))
          ? `<details><summary class="note">${esc(t('db.count', { n: i.tgx.length }))}</summary><div class="chips">${i.tgx.map((g) => chip(g)).join('')}</div></details>`
          : ''
      }`
    : '';
  const expLabel = (k: string): string => {
    const l = meta.labels.expedition?.[k];
    return l ? pick(l) : k;
  };
  const exp = i.ex?.length
    ? `<div class="chips">${i.ex.map((a) => `<span class="chip plain">${esc(expLabel(a.k))}${a.k.startsWith('Perk') ? '' : ` ${num(a.v)}`}</span>`).join('')}</div>`
    : '';
  return head(i, sub) + sec('d.general', general) + sec('d.effects', fx) + sec('d.targets', targets) + sec('d.expedition', exp);
}

/** Rohwerte mit Namen hinter GUIDs. */
function rawText(v: unknown): string {
  return JSON.stringify(v, null, 2)
    .split('\n')
    .map((line) => {
      const m = /:\s(\d{3,})(,?)$/.exec(line) ?? /^\s*(\d{3,})(,?)$/.exec(line);
      const g = m ? Number(m[1]) : 0;
      return esc(line) + (g && names[g] ? `  ← ${esc(nameOfGuid(g))}` : '');
    })
    .join('\n');
}

function sourcesHtml(): string {
  return `<section class="d-sources"><strong>${esc(t('db.sources'))}</strong><ul>${meta.sources
    .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> (${esc(s.license)}) – ${esc(s.use)}${s.commit ? ` · ${esc(s.commit.slice(0, 8))}` : ''}</li>`)
    .join('')}</ul><strong>${esc(t('db.limits'))}</strong><ul>${meta.limits.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}

function renderDetail(): void {
  const box = $('#db-detail');
  const e = selected === null ? undefined : tab === 'b' ? buildingBy.get(selected) : itemBy.get(selected);
  if (!e) {
    box.innerHTML = `<p class="db-empty">${esc(t('db.pick'))}</p>${meta ? sourcesHtml() : ''}`;
    return;
  }
  box.innerHTML =
    (tab === 'b' ? buildingDetail(e as Building) : itemDetail(e as Item)) +
    `<details class="d-sec" id="d-raw"><summary>${esc(t('db.raw'))}</summary><pre class="raw"></pre></details>` +
    sourcesHtml();
  const det = box.querySelector<HTMLDetailsElement>('#d-raw');
  det?.addEventListener('toggle', () => {
    const pre = det.querySelector('pre');
    if (!det.open || !pre || pre.textContent) return;
    pre.textContent = '…';
    void rawOf(tab, e.g).then((v) => (pre.innerHTML = rawText(v)));
  });
}

// ------------------------------------------------------------------ Navigation
function setTab(next: 'b' | 'i'): void {
  if (tab !== next) {
    tab = next;
    shown = PAGE;
    filter.q = '';
  }
  $('#tab-buildings').classList.toggle('active', tab === 'b');
  $('#tab-items').classList.toggle('active', tab === 'i');
  renderFilters();
  renderList();
}

function fromHash(): void {
  const m = /^#([bi])=(\d+)$/.exec(location.hash);
  if (!m) {
    renderDetail();
    return;
  }
  const kind = m[1] as 'b' | 'i';
  const g = Number(m[2]);
  if (kind !== tab) setTab(kind);
  selected = g;
  // Eintrag in der Liste sichtbar machen (ggf. Filter lösen).
  if (!filtered().some((e) => e.g === g)) {
    Object.assign(filter, { q: '', cat: '', reg: '', dlc: '', slot: '', rarity: '', fx: '' });
    renderFilters();
  }
  const idx = filtered().findIndex((e) => e.g === g);
  if (idx >= shown) shown = idx + PAGE;
  renderList();
  renderDetail();
  document.querySelector(`.db-row[data-g="${g}"]`)?.scrollIntoView({ block: 'nearest' });
  window.scrollTo({ top: 0 });
}

async function main(): Promise<void> {
  mountSite('db');
  setupTooltip();
  try {
    await load();
  } catch (err) {
    $('#db-count').textContent = t('db.error');
    console.error(err);
    return;
  }
  $('#tab-buildings').addEventListener('click', () => setTab('b'));
  $('#tab-items').addEventListener('click', () => setTab('i'));
  $('#db-rows').addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('.db-row');
    if (btn?.dataset.g) location.hash = `${tab}=${btn.dataset.g}`;
  });
  window.addEventListener('hashchange', fromHash);
  onLangChange(() => {
    applyI18n();
    renderFilters();
    renderList();
    renderDetail();
  });
  setTab(tab);
  fromHash();
}

void main();
