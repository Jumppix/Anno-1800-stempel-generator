// Bereich „Produktion & Handelskammer“ (Vorbild: Optimierungs-Übersicht von
// annolayouts.de): alle Produktionsgebäude nach Region und Arbeitskraft-Stufe,
// je Gebäude Handelskammer-Items (drei berechnete Vorschläge, änderbar), Strom,
// Produktivität, Ausstoß, Arbeitskraft und Gebäude je Handelskammer mit Layout
// und Stempel-Download.
import '../site.css';
import { applyI18n, getLang, onLangChange, pick, t } from '../i18n';
import { mountSite } from '../site';
import { DB_BASE, loadDb, rarityRank, type Building, type Db, type Item } from '../db/data';
import { setupHoverCards } from '../db/hovercard';
import { evaluate, itemFx, isUseful, slotsFor, SETUP_KINDS, SLOTS, type ProdResult, type SetupKind } from './calc';
import { buildGenericStamp, type StampBuilding, type StampStreet } from '../stamp';
import { STREET_GUIDS } from '../catalog';

interface ProdData {
  radius: number;
  hk: [number, number];
  layouts: Record<string, { n: number; b: Array<[number, number, number]>; r: Array<[number, number]> }>;
  setups: Record<string, Partial<Record<SetupKind, number[]>>>;
  /** Vorschläge mit 4 Plätzen (Palast-Erlass „Gewerkschaftsförderung“). */
  setups4?: Record<string, Partial<Record<SetupKind, number[]>>>;
}

/** Zustand je Gebäude (im Browser gespeichert, wenn geändert). */
interface RowState {
  kind: SetupKind | 'custom';
  items: number[];
  power: boolean;
  count: number;
}

const REGIONS = ['ow', 'nw', 'arctic', 'africa'] as const;
type Region = (typeof REGIONS)[number];
const TRADE_UNION = 1010516;
/** Handelskammer und Straße je Region für den Stempel (Neue Welt: Feldweg). */
const STAMP_REGION: Partial<Record<string, { hk: number; street: number; key: 'ow' | 'nw' }>> = {
  ow: { hk: 1010516, street: STREET_GUIDS.paved, key: 'ow' },
  nw: { hk: 101284, street: STREET_GUIDS.dirt, key: 'nw' },
};
const STORE = 'anno-prod-state';

let db: Db;
let prod: ProdData;
let workforceSet: Set<number>;
let region: Region = 'ow';
let query = '';
let clip = false;
/** Palast-Erlass „Gewerkschaftsförderung“: 4. Item-Platz in der Handelskammer. */
let union = true;
const slotCount = (): number => SLOTS + (union ? 1 : 0);
const setupTable = (): ProdData['setups'] => (union && prod.setups4 ? prod.setups4 : prod.setups);
const state = new Map<number, RowState>();

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const num = (n: number, d = 2): string => n.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: d });
const nameOf = (g: number): string => {
  const n = db.names[g];
  return n ? (getLang() === 'de' ? n[0] : n[1]) || n[0] : `#${g}`;
};
const icon = (g: number, cls = 'ic', extra = ''): string => {
  const f = db.names[g]?.[2];
  const name = esc(nameOf(g));
  return f
    ? `<img class="${cls}" src="${DB_BASE}icons/${f}" alt="${name}" data-card="${g}" data-tip="${name}${extra ? ` ${esc(extra)}` : ''}" loading="lazy" />`
    : `<span class="${cls} txt" data-card="${g}" data-tip="${name}">${name}</span>`;
};

// ------------------------------------------------------------------ Zustand
function loadState(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, RowState>;
    for (const [g, s] of Object.entries(raw)) state.set(Number(g), s);
  } catch {
    /* ohne gespeicherten Zustand */
  }
  try {
    const r = localStorage.getItem(`${STORE}-region`);
    if (r && (REGIONS as readonly string[]).includes(r)) region = r as Region;
    clip = localStorage.getItem(`${STORE}-clip`) === '1';
    union = localStorage.getItem(`${STORE}-union`) !== '0';
  } catch {
    /* ignorieren */
  }
}
function saveState(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(state)));
    localStorage.setItem(`${STORE}-region`, region);
    localStorage.setItem(`${STORE}-clip`, clip ? '1' : '0');
    localStorage.setItem(`${STORE}-union`, union ? '1' : '0');
  } catch {
    /* ignorieren */
  }
}

const layoutOf = (b: Building): ProdData['layouts'][string] | undefined => (b.sz && !b.kind ? prod.layouts[b.sz.join('x')] : undefined);

function rowState(b: Building): RowState {
  const s = state.get(b.g) ?? { kind: 'max', items: [], power: true, count: layoutOf(b)?.n ?? 1 };
  // Vorschläge folgen der aktuellen Platzzahl; eigene Auswahl bleibt.
  if (s.kind !== 'custom') return { ...s, items: [...(setupTable()[b.g]?.[s.kind] ?? setupTable()[b.g]?.max ?? [])] };
  return s;
}

const candidates = (b: Building): Item[] => {
  const slots = slotsFor(b);
  return (db.itemsFor.get(b.g) ?? []).filter((i) => slots.includes(i.s) && isUseful(itemFx(i)));
};

// ------------------------------------------------------------------ Liste
function productionBuildings(): Building[] {
  const list = db.buildings.filter((b) => b.c === 'production' && b.out?.length && (b.reg?.[0] ?? 'ow') === region);
  // Gleichnamige Varianten (z. B. Bauerlaubnis-Optik): nur die mit den meisten passenden Items zeigen.
  const byName = new Map<string, Building>();
  for (const b of list) {
    const key = `${b.n.de}|${(b.out ?? []).map((o) => o.p).join(',')}`;
    const prev = byName.get(key);
    if (!prev || candidates(b).length > candidates(prev).length) byName.set(key, b);
  }
  return [...byName.values()];
}

/** Gruppe: erste Arbeitskraft im Unterhalt (wie annolayouts.de nach Bevölkerungsstufe). */
const groupOf = (b: Building): number => b.mt?.find((m) => workforceSet.has(m.p))?.p ?? 0;

function renderRegions(): void {
  $('#prod-regions').innerHTML = REGIONS.map(
    (r) => `<button type="button" data-r="${r}" class="${r === region ? 'active' : ''}">${esc(t(`reg.${r}`))}</button>`,
  ).join('');
}

function renderGroups(): void {
  const q = query.trim().toLowerCase();
  const list = productionBuildings().filter((b) => {
    if (!q) return true;
    const outs = (b.out ?? []).map((o) => nameOf(o.p)).join(' ');
    return `${b.n.de} ${b.n.en} ${outs}`.toLowerCase().includes(q);
  });
  const order = db.meta.workforce ?? [];
  const groups = new Map<number, Building[]>();
  for (const b of list) {
    const g = groupOf(b);
    const arr = groups.get(g);
    if (arr) arr.push(b);
    else groups.set(g, [b]);
  }
  const keys = [...groups.keys()].sort((a, b) => (order.indexOf(a) + 100 * +(a === 0)) - (order.indexOf(b) + 100 * +(b === 0)));
  if (!keys.length) {
    $('#prod-groups').innerHTML = `<p class="db-empty">${esc(t('db.count', { n: 0 }))}</p>`;
    return;
  }
  $('#prod-groups').innerHTML = keys
    .map((k) => {
      const rows = (groups.get(k) as Building[]).sort((a, b) => pick(a.n).localeCompare(pick(b.n)));
      return `<section class="prod-group"><h2>${k ? `${icon(k, 'gic')} ${esc(nameOf(k).replace(/[-\u2011]?\s*Arbeitsk\S*/i, '').replace(/\s*Workforce/i, ''))}` : esc(t('prod.noWorkforce'))}<span class="sum">${rows.length}</span></h2>
        <div class="prod-table">
          <div class="prod-row prod-th">
            <span>${esc(t('prod.col.building'))}</span><span>${esc(t('prod.col.count'))}</span><span>${esc(t('prod.col.items'))}</span>
            <span>${esc(t('prod.col.power'))}</span><span>${esc(t('prod.col.prod'))}</span><span>${esc(t('prod.col.output'))}</span>
            <span>${esc(t('prod.col.workforce'))}</span><span>${esc(t('prod.col.goods'))}</span>
          </div>
          ${rows.map((b) => `<div class="prod-row" data-g="${b.g}">${rowHtml(b)}</div>`).join('')}
        </div></section>`;
    })
    .join('');
}

function rowHtml(b: Building): string {
  const s = rowState(b);
  const items = s.items
    .slice(0, slotCount())
    .map((g) => db.itemBy.get(g))
    .filter((i): i is Item => !!i);
  const r: ProdResult = evaluate(b, items, { power: s.power, clip }, workforceSet);
  const L = layoutOf(b);
  const n = Math.max(0, s.count);
  const chain = `<span class="chain">${(b.in ?? [])
    .map((i) => {
      const repl = r.replaced.find((x) => x.from === i.p);
      const gone = r.removed.includes(i.p);
      return `<span class="${gone ? 'gone' : repl ? 'repl' : ''}">${icon(i.p)}${repl ? `→${icon(repl.to)}` : ''}</span>`;
    })
    .join('')}${b.in?.length ? '<span class="arrow">→</span>' : ''}${(b.out ?? []).map((o) => icon(o.p)).join('')}</span>`;
  const setups = setupTable()[b.g] ?? {};
  const kinds = SETUP_KINDS.filter((k) => setups[k]);
  const slots = Array.from({ length: slotCount() }, (_, i) => {
    const it = items[i];
    return it
      ? `<button type="button" class="slot r-${it.r}" data-slot="${i}">${icon(it.g, 'sic')}</button>`
      : `<button type="button" class="slot empty" data-slot="${i}" data-tip="${esc(t('prod.slotEmpty'))}">+</button>`;
  }).join('');
  const power = !b.pow
    ? '<span class="muted">–</span>'
    : b.pow === 'req' && !s.power && !r.powerItem
      ? `<button type="button" class="pw off req" data-act="power" data-tip="${esc(t('prod.powerReqOff'))}">⚡</button>`
      : `<button type="button" class="pw ${r.powered ? 'on' : 'off'}" data-act="power" data-tip="${esc(
          r.powerItem ? t('prod.powerItem', { item: nameOf(r.powerItem) }) : b.pow === 'req' ? t('prod.powerReq') : r.powered ? t('prod.powerOn') : t('prod.powerOff'),
        )}">⚡</button>`;
  const wfOne = r.workforce.map((w) => `${icon(w.p)}<b>${num(w.a, 0)}</b>`).join(' ');
  const wfAll = r.workforce.map((w) => num(w.a * n, 0)).join(' / ');
  const extra = r.extra.map((e) => `<span class="good">${icon(e.p)}<b>${num(e.perMin * n)}</b></span>`).join('');
  const countCell = L
    ? `<input type="number" min="0" max="999" value="${n}" data-act="count" aria-label="${esc(t('prod.col.count'))}" /><button type="button" class="lay" data-act="layout" data-tip="${esc(
        t('prod.layoutTip', { n: L.n }),
      )}">▦ ${L.n}</button>`
    : `<input type="number" min="0" max="999" value="${n}" data-act="count" aria-label="${esc(t('prod.col.count'))}" data-tip="${esc(t(`prod.kind.${b.kind ?? 'none'}`))}" />`;
  return `
    <span class="cell-b"><a href="./datenbank.html#b=${b.g}" class="bname">${b.i ? `<img class="bic" src="${DB_BASE}icons/${b.i}" alt="" data-card="${b.g}" loading="lazy" />` : ''}<span><b>${esc(pick(b.n))}</b><small>${
      b.sz ? `${b.sz[0]}×${b.sz[1]}` : ''
    }${b.dlc ? ` · ${esc(nameOf(b.dlc))}` : ''}</small></span></a>${chain}</span>
    <span class="cell-n" data-label="${esc(t('prod.col.count'))}">${countCell}</span>
    <span class="cell-i" data-label="${esc(t('prod.col.items'))}"><span class="slots">${slots}</span><span class="kinds">${kinds
      .map((k) => `<button type="button" data-kind="${k}" class="${s.kind === k ? 'active' : ''}">${esc(t(`prod.setup.${k}`))}</button>`)
      .join('')}${s.kind === 'custom' ? `<span class="custom">${esc(t('prod.setup.custom'))}</span>` : ''}</span></span>
    <span class="cell-p" data-label="${esc(t('prod.col.power'))}">${power}</span>
    <span class="cell-pr" data-label="${esc(t('prod.col.prod'))}"><b class="${r.works ? '' : 'bad'}">${r.works ? `${num(r.prod, 0)} %` : t('prod.stopped')}</b>${
      r.cycle ? `<small>${num(r.cycle, 0)} s</small>` : ''
    }</span>
    <span class="cell-o" data-label="${esc(t('prod.col.output'))}">${r.output ? `${icon(r.output)}<b>${num(r.perMin)}</b><small>× ${n} = ${num(r.perMin * n)} ${esc(t('d.perMin'))}</small>` : '–'}</span>
    <span class="cell-w" data-label="${esc(t('prod.col.workforce'))}">${wfOne || '–'}${r.workforce.length ? `<small>× ${n} = ${wfAll}</small>` : ''}</span>
    <span class="cell-g" data-label="${esc(t('prod.col.goods'))}">${extra || '<span class="muted">–</span>'}</span>`;
}

function refreshRow(g: number): void {
  const el = document.querySelector(`.prod-row[data-g="${g}"]`);
  const b = db.buildingBy.get(g);
  if (el && b) el.innerHTML = rowHtml(b);
}

// ------------------------------------------------------------------ Dialoge
function openModal(html: string, wide = false): HTMLElement {
  const m = $('#prod-modal');
  m.querySelector('.modal-box')?.classList.toggle('wide', wide);
  const body = m.querySelector('.modal-body') as HTMLElement;
  body.innerHTML = html;
  m.hidden = false;
  return body;
}
const closeModal = (): void => {
  $('#prod-modal').hidden = true;
};

function fxSummary(it: Item, b: Building): string {
  const fx = itemFx(it);
  const parts: string[] = [];
  const sign = (v: number): string => `${v > 0 ? '+' : ''}${num(v, 0)} %`;
  if (fx.prod) parts.push(`<span class="${fx.prod > 0 ? 'pos' : 'neg'}">${esc(t('prod.fx.prod'))} ${sign(fx.prod)}</span>`);
  if (fx.wf) parts.push(`<span class="${fx.wf < 0 ? 'pos' : 'neg'}">${esc(t('prod.fx.wf'))} ${sign(fx.wf)}</span>`);
  if (fx.power) parts.push(`<span class="pos">⚡ ${esc(t('prod.fx.power'))}</span>`);
  if (fx.wfType) parts.push(`${esc(t('prod.fx.wfType'))} ${icon(fx.wfType)}`);
  for (const e of fx.extra) parts.push(`${icon(e.p)} ${esc(e.every > 1 ? t('d.every', { n: e.every }) : t('d.everyOne'))}`);
  for (const r of fx.replace) if (b.in?.some((i) => i.p === r.from)) parts.push(`${icon(r.from)}→${icon(r.to)}`);
  for (const p of fx.remove) if (b.in?.some((i) => i.p === p)) parts.push(`<span class="gone">${icon(p)}</span> ${esc(t('prod.fx.noInput'))}`);
  if (fx.maint) parts.push(`${esc(t('prod.fx.maint'))} ${sign(fx.maint)}`);
  return parts.join(' · ');
}

function openPicker(b: Building, slot: number): void {
  const s = rowState(b);
  const used = new Set(s.items.filter((_, i) => i !== slot));
  const list = candidates(b)
    .filter((i) => !used.has(i.g))
    .sort((a, c) => rarityRank(a.r) - rarityRank(c.r) || itemFx(c).prod - itemFx(a).prod || pick(a.n).localeCompare(pick(c.n)));
  const body = openModal(
    `<h2>${esc(t('prod.pick', { b: pick(b.n) }))}</h2>
     <div class="search"><input type="search" class="pick-q" placeholder="${esc(t('db.search'))}" /></div>
     <div class="pick-list">
       <button type="button" class="pick-row" data-g="0"><span class="pick-none">✕</span><span>${esc(t('prod.slotClear'))}</span></button>
       ${list
         .map(
           (i) => `<button type="button" class="pick-row" data-g="${i.g}" data-name="${esc(`${i.n.de} ${i.n.en}`.toLowerCase())}">${icon(i.g, 'pic')}<span><b class="rarity-${i.r}">${esc(
             pick(i.n),
           )}</b><small>${fxSummary(i, b)}</small></span></button>`,
         )
         .join('')}
     </div>`,
  );
  body.querySelector<HTMLInputElement>('.pick-q')?.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();
    body.querySelectorAll<HTMLElement>('.pick-row[data-name]').forEach((el) => (el.hidden = !!q && !(el.dataset.name ?? '').includes(q)));
  });
  body.querySelector<HTMLInputElement>('.pick-q')?.focus();
  body.querySelectorAll<HTMLElement>('.pick-row').forEach((el) =>
    el.addEventListener('click', () => {
      const g = Number(el.dataset.g);
      const items = [...s.items];
      if (g) items[slot] = g;
      else items.splice(slot, 1);
      state.set(b.g, { ...s, kind: 'custom', items: items.filter(Boolean).slice(0, slotCount()) });
      saveState();
      closeModal();
      refreshRow(b.g);
    }),
  );
}

function openLayout(b: Building): void {
  const L = layoutOf(b);
  if (!L || !b.sz) return;
  const [px, pz] = b.sz;
  const R = prod.radius;
  let minX = -2;
  let minY = -2;
  let maxX = 2;
  let maxY = 2;
  const rects = L.b.map(([x, y, turns]) => {
    const w = turns % 2 ? px : pz;
    const h = turns % 2 ? pz : px;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
    return { x, y, w, h, turns };
  });
  for (const [x, y] of L.r) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1);
    maxY = Math.max(maxY, y + 1);
  }
  minX = Math.min(minX, -R);
  minY = Math.min(minY, -R);
  maxX = Math.max(maxX, R);
  maxY = Math.max(maxY, R);
  const pad = 1;
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  const ic = b.i ? `${DB_BASE}icons/${b.i}` : '';
  const svg = `<svg class="layout-svg" viewBox="${vb}" role="img" aria-label="${esc(t('prod.layoutTitle', { b: pick(b.n) }))}">
    <defs><pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="rgba(143,163,179,.12)" stroke-width=".04"/></pattern></defs>
    <rect x="${minX - pad}" y="${minY - pad}" width="${maxX - minX + 2 * pad}" height="${maxY - minY + 2 * pad}" fill="url(#grid)"/>
    <circle cx="0" cy="0" r="${R}" fill="rgba(217,179,108,.06)" stroke="#d9b36c" stroke-width=".12" stroke-dasharray=".5 .3"/>
    ${L.r.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="#4a5560"/>`).join('')}
    ${rects
      .map(
        (r) => `<g><rect x="${r.x + 0.08}" y="${r.y + 0.08}" width="${r.w - 0.16}" height="${r.h - 0.16}" rx=".3" fill="#1d4a5c" stroke="#5fa8c4" stroke-width=".08"/>${
          ic ? `<image href="${ic}" x="${r.x + r.w / 2 - 1.1}" y="${r.y + r.h / 2 - 1.1}" width="2.2" height="2.2"/>` : ''
        }</g>`,
      )
      .join('')}
    <rect x="-2" y="-2" width="4" height="4" rx=".3" fill="#5c4a1d" stroke="#d9b36c" stroke-width=".12"/>
    <image href="${DB_BASE}icons/${db.names[TRADE_UNION]?.[2] ?? ''}" x="-1.4" y="-1.4" width="2.8" height="2.8"/>
  </svg>`;
  const canStamp = !!STAMP_REGION[b.reg?.[0] ?? ''];
  const body = openModal(
    `<h2>${esc(t('prod.layoutTitle', { b: pick(b.n) }))}</h2>
     <p>${esc(t('prod.layoutInfo', { n: L.n, r: R, roads: L.r.length }))}</p>
     ${svg}
     <div class="layout-actions">
       ${canStamp ? `<button type="button" class="primary" data-act="stamp">${esc(t('prod.stamp'))}</button>` : `<span class="note">${esc(t('prod.stampOnlyOw'))}</span>`}
       <button type="button" data-act="apply">${esc(t('prod.applyCount', { n: L.n }))}</button>
     </div>
     <p class="note">${esc(t('prod.layoutNote'))}</p>`,
    true,
  );
  body.querySelector('[data-act="stamp"]')?.addEventListener('click', () => downloadStamp(b, rects, L.r));
  body.querySelector('[data-act="apply"]')?.addEventListener('click', () => {
    state.set(b.g, { ...rowState(b), count: L.n });
    saveState();
    closeModal();
    refreshRow(b.g);
  });
}

function downloadStamp(
  b: Building,
  rects: Array<{ x: number; y: number; w: number; h: number; turns: number }>,
  roads: Array<[number, number]>,
): void {
  const sr = STAMP_REGION[b.reg?.[0] ?? ''] ?? (STAMP_REGION.ow as { hk: number; street: number; key: 'ow' | 'nw' });
  const items: StampBuilding[] = [
    { guid: sr.hk, x: -2, y: -2, w: 4, h: 4, turns: 0 },
    ...rects.map((r) => ({ guid: b.g, x: r.x, y: r.y, w: r.w, h: r.h, turns: r.turns })),
  ];
  const streets: StampStreet[] = roads.map(([x, y]) => ({ x, y, guid: sr.street }));
  const bytes = buildGenericStamp(items, sr.key, streets);
  const name = `HK_${(b.n.en || b.n.de).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}_${rects.length}`;
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name; // Stempel ohne Dateiendung
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ------------------------------------------------------------------ Start
async function main(): Promise<void> {
  mountSite('prod');
  loadState();
  try {
    const [d, p] = await Promise.all([loadDb(), fetch(`${DB_BASE}prod.json`).then((r) => r.json() as Promise<ProdData>)]);
    db = d;
    prod = p;
    setupHoverCards(db);
  } catch (err) {
    $('#prod-groups').innerHTML = `<p class="db-empty">${esc(t('db.error'))}</p>`;
    console.error(err);
    return;
  }
  workforceSet = new Set(db.meta.workforce ?? []);
  const clipBox = $<HTMLInputElement>('#prod-clip');
  clipBox.checked = clip;
  const unionBox = $<HTMLInputElement>('#prod-union');
  unionBox.checked = union;
  unionBox.addEventListener('change', () => {
    union = unionBox.checked;
    saveState();
    renderGroups();
  });
  renderRegions();
  renderGroups();

  $('#prod-regions').addEventListener('click', (e) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('[data-r]')?.dataset.r as Region | undefined;
    if (!r) return;
    region = r;
    saveState();
    renderRegions();
    renderGroups();
  });
  const q = $<HTMLInputElement>('#prod-q');
  const qClear = $('#prod-q-clear');
  q.addEventListener('input', () => {
    query = q.value;
    qClear.hidden = !q.value;
    renderGroups();
  });
  qClear.addEventListener('click', () => {
    q.value = '';
    query = '';
    qClear.hidden = true;
    q.focus();
    renderGroups();
  });
  clipBox.addEventListener('change', () => {
    clip = clipBox.checked;
    saveState();
    renderGroups();
  });

  const groupsEl = $('#prod-groups');
  groupsEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('.prod-row[data-g]');
    const b = row ? db.buildingBy.get(Number(row.dataset.g)) : undefined;
    if (!b) return;
    const slot = target.closest<HTMLElement>('[data-slot]');
    if (slot) return openPicker(b, Number(slot.dataset.slot));
    const kind = target.closest<HTMLElement>('[data-kind]')?.dataset.kind as SetupKind | undefined;
    if (kind) {
      state.set(b.g, { ...rowState(b), kind, items: [...(setupTable()[b.g]?.[kind] ?? [])] });
      saveState();
      return refreshRow(b.g);
    }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'power') {
      const s = rowState(b);
      state.set(b.g, { ...s, power: !s.power });
      saveState();
      refreshRow(b.g);
    }
    if (act === 'layout') openLayout(b);
  });
  groupsEl.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.act !== 'count') return;
    const row = input.closest<HTMLElement>('.prod-row[data-g]');
    const b = row ? db.buildingBy.get(Number(row.dataset.g)) : undefined;
    if (!b) return;
    state.set(b.g, { ...rowState(b), count: Math.max(0, Math.min(999, Math.round(Number(input.value) || 0))) });
    saveState();
    refreshRow(b.g);
  });

  const modal = $('#prod-modal');
  modal.addEventListener('click', (e) => {
    if (e.target === modal || (e.target as HTMLElement).closest('.modal-close')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
  onLangChange(() => {
    applyI18n();
    renderRegions();
    renderGroups();
  });
}

void main();
