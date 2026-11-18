// Infofenster beim Überfahren (wie annolayouts.de): Items, Waren und Gebäude
// mit den wichtigsten Angaben. Elemente mit data-card="<GUID>" bekommen das
// Infofenster, Elemente mit nur data-tip einen einfachen Text-Tooltip.
// Touch: Antippen eines Elements (kein Link) zeigt das Fenster.
import { getLang, pick, t } from '../i18n';
import { DB_BASE, type Building, type Db, type Item } from './data';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const num = (n: number, d = 2): string => n.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: d });

interface Index {
  producers: Map<number, Building[]>;
  consumers: Map<number, Building[]>;
  extraBy: Map<number, Item[]>;
}

let db: Db;
let index: Index;

function buildIndex(): Index {
  const producers = new Map<number, Building[]>();
  const consumers = new Map<number, Building[]>();
  const extraBy = new Map<number, Item[]>();
  const add = <T>(m: Map<number, T[]>, k: number, v: T): void => {
    const l = m.get(k);
    if (l) {
      if (!l.includes(v)) l.push(v);
    } else m.set(k, [v]);
  };
  for (const b of db.buildings) {
    if (b.c !== 'production' && b.c !== 'public' && b.c !== 'special') continue;
    for (const o of b.out ?? []) add(producers, o.p, b);
    for (const i of b.in ?? []) add(consumers, i.p, b);
  }
  for (const it of db.items) {
    for (const e of it.fx) {
      if (e.k !== 'AdditionalOutput' || !Array.isArray(e.v)) continue;
      for (const o of e.v as Array<{ Product?: number }>) if (typeof o.Product === 'number') add(extraBy, o.Product, it);
    }
  }
  return { producers, consumers, extraBy };
}

const nameOf = (g: number): string => {
  const n = db.names[g];
  return n ? (getLang() === 'de' ? n[0] : n[1]) || n[0] : `#${g}`;
};
const ic = (g: number, cls = 'hc-ic'): string => {
  const f = db.names[g]?.[2];
  return f ? `<img class="${cls}" src="${DB_BASE}icons/${f}" alt="" />` : '';
};
const named = (g: number, extra = ''): string => `<span class="hc-named">${ic(g)}${esc(nameOf(g))}${extra ? ` <b>${esc(extra)}</b>` : ''}</span>`;
const amountRow = (list: Array<{ p: number; a: number }> | undefined): string =>
  list?.length ? `<div class="hc-amounts">${list.map((a) => `<span>${ic(a.p)}${num(a.a, 0)}</span>`).join('')}</div>` : '';

function listNames(gs: number[], max = 4): string {
  const shown = gs.slice(0, max).map((g) => `<b>${esc(nameOf(g))}</b>`);
  const rest = gs.length - max;
  const and = getLang() === 'de' ? ' und ' : ' and ';
  if (rest > 0) return `${shown.join(', ')} ${esc(t('hc.more', { n: rest }))}`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')}${and}${shown[shown.length - 1]}` : (shown[0] ?? '');
}

function head(g: number, title: string, sub: string, subCls = ''): string {
  const f = db.names[g]?.[2];
  return `<div class="hc-head">${f ? `<img class="hc-big" src="${DB_BASE}icons/${f}" alt="" />` : ''}<div><div class="hc-title">${esc(title)}</div><div class="hc-sub ${subCls}">${sub}</div></div></div>`;
}

// ------------------------------------------------------------------ Item
const pctVal = (v: unknown): { v: number; pct: boolean } | null => {
  if (typeof v === 'number') return { v, pct: false };
  if (v && typeof v === 'object' && typeof (v as { v?: unknown }).v === 'number') return { v: (v as { v: number }).v, pct: !!(v as { pct?: boolean }).pct };
  return null;
};

function effectLines(it: Item): string {
  const lines: string[] = [];
  const label = (k: string): string => {
    const l = db.meta.labels.effects[k];
    return l ? pick(l) : k.replace(/Upgrade$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  };
  for (const e of it.fx) {
    const list = Array.isArray(e.v) ? (e.v as Array<Record<string, number>>) : null;
    if (e.k === 'ReplaceInputs' && list) {
      lines.push(`<div class="hc-fx"><span class="hc-sym">⇄</span>${esc(label(e.k))}</div>${list
        .map((o) => `<div class="hc-sub-line"><s>${ic(o.OldInput)}${esc(nameOf(o.OldInput))}</s> ⇄ ${named(o.NewInput)}</div>`)
        .join('')}`);
    } else if (e.k === 'AdditionalOutput' && list) {
      lines.push(`<div class="hc-fx"><span class="hc-sym">+</span>${esc(label(e.k))}</div>${list
        .map((o) => `<div class="hc-sub-line hc-split">${named(o.Product)}<b>${o.Amount && o.Amount !== 1 ? `${num(o.Amount)}×` : ''}1/${o.AdditionalOutputCycle || 1}</b></div>`)
        .join('')}`);
    } else if ((e.k === 'GoodConsumptionUpgrade' || e.k === 'InputAmountUpgrade') && list) {
      lines.push(`<div class="hc-fx"><span class="hc-sym">•</span>${esc(label(e.k))}</div>${list
        .map((o) => {
          const g = o.ProvidedNeed ?? o.Product;
          const amount = o.AmountInPercent !== undefined ? `${o.AmountInPercent > 0 ? '+' : ''}${o.AmountInPercent} %` : o.Amount === -1 ? t('prod.fx.noInput') : '';
          return g ? `<div class="hc-sub-line hc-split">${named(g)}<b>${esc(amount)}</b></div>` : '';
        })
        .join('')}`);
    } else if ((e.k === 'GenPool' || e.k === 'AddAssemblyOptions') && Array.isArray(e.v)) {
      lines.push(`<div class="hc-fx"><span class="hc-sym">•</span>${esc(label(e.k))}</div><div class="hc-sub-line">${(e.v as number[])
        .filter((g) => typeof g === 'number')
        .slice(0, 6)
        .map((g) => named(g))
        .join(' ')}</div>`);
    } else if (e.k === 'ReplacingWorkforce' && typeof e.v === 'number') {
      lines.push(`<div class="hc-fx hc-split"><span><span class="hc-sym">•</span>${esc(label(e.k))}</span>${named(e.v)}</div>`);
    } else {
      const pv = pctVal(e.v);
      if (pv) {
        const good = (pv.v > 0) !== /Workforce|Maintenance|Maintainance|Incident|Fire|Riot|Illness|Explosion|Cost/.test(e.k);
        lines.push(`<div class="hc-fx hc-split"><span><span class="hc-sym">•</span>${esc(label(e.k))}</span><b class="${good ? 'pos' : 'neg'}">${pv.v > 0 ? '+' : ''}${num(pv.v)}${pv.pct ? ' %' : ''}</b></div>`);
      } else if (e.v === 1 || e.v === true) {
        lines.push(`<div class="hc-fx"><span class="hc-sym">•</span>${esc(label(e.k))}</div>`);
      }
    }
  }
  return lines.join('');
}

function itemCard(it: Item): string {
  const rarity = db.meta.labels.rarity[it.r];
  const slot = t(`slot.${it.s}`);
  const exp = (it.ex ?? [])
    .map((a) => {
      const l = db.meta.labels.expedition?.[a.k];
      return `<div class="hc-split"><span>${esc(l ? pick(l) : a.k)}</span>${a.k.startsWith('Perk') ? '' : `<b>${num(a.v, 0)}</b>`}</div>`;
    })
    .join('');
  return `${head(it.g, pick(it.n), esc(rarity ? pick(rarity) : it.r), `rarity-${it.r}`)}
    <div class="hc-sec"><div class="hc-split"><span>${esc(t('hc.slot'))}</span><b>${esc(slot)}</b></div>${
      it.p ? `<div class="hc-split"><span>${esc(t('d.price'))}</span><b>${num(it.p, 0)}</b></div>` : ''
    }${it.dlc ? `<div class="hc-split"><span>DLC</span><b>${esc(nameOf(it.dlc))}</b></div>` : ''}</div>
    ${it.tg.length ? `<div class="hc-sec">${esc(t('hc.affects'))} ${listNames(it.tg)}</div>` : ''}
    ${it.fx.length ? `<div class="hc-sec">${effectLines(it)}</div>` : ''}
    ${exp ? `<div class="hc-sec"><div class="hc-cap">${esc(t('d.expedition'))}</div>${exp}</div>` : ''}`;
}

// ------------------------------------------------------------------ Gebäude
function buildingCard(b: Building): string {
  const sub = [t(`cat.${b.c}`), ...(b.reg ?? []).map((r) => t(`reg.${r}`)), b.sz ? `${b.sz[0]}×${b.sz[1]}` : ''].filter(Boolean).join(' · ');
  const out = b.out?.[0];
  const cycle = b.ct ?? (b.calcTpm && out ? (60 * out.a) / b.calcTpm : undefined);
  const chain =
    b.in?.length || b.out?.length
      ? `<div class="hc-sec"><div class="hc-cap">${esc(t('d.production'))}</div><div class="hc-chain">${(b.in ?? []).map((i) => ic(i.p)).join('')}${
          b.in?.length ? '<span>→</span>' : ''
        }${(b.out ?? []).map((o) => ic(o.p)).join('')}${cycle && out ? `<b>${num(cycle, 1)} s · ${num((60 / cycle) * out.a)} t/min</b>` : ''}</div></div>`
      : '';
  const items = db.itemsFor.get(b.g)?.length ?? 0;
  return `${head(b.g, pick(b.n), esc(sub))}
    ${b.d ? `<div class="hc-sec hc-desc">${esc(pick(b.d))}</div>` : ''}
    ${b.cost?.length ? `<div class="hc-sec"><div class="hc-cap">${esc(t('d.cost'))}</div>${amountRow(b.cost)}</div>` : ''}
    ${b.mt?.length ? `<div class="hc-sec"><div class="hc-cap">${esc(t('d.upkeep'))}</div>${amountRow(b.mt)}</div>` : ''}
    ${chain}
    ${
      b.pow || b.rad || b.rng || b.res?.max
        ? `<div class="hc-sec">${b.pow ? `<div class="hc-split"><span>⚡ ${esc(t('d.electric'))}</span><b>${esc(t(b.pow === 'req' ? 'hc.powerReq' : 'hc.powerOpt'))}</b></div>` : ''}${
            b.rad ? `<div class="hc-split"><span>${esc(t('d.radius'))}</span><b>${num(b.rad)}</b></div>` : ''
          }${b.rng ? `<div class="hc-split"><span>${esc(t('d.range'))}</span><b>${num(b.rng)}</b></div>` : ''}${
            b.res?.max ? `<div class="hc-split"><span>${esc(t('d.residents'))}</span><b>${num(b.res.max, 0)}</b></div>` : ''
          }</div>`
        : ''
    }
    ${items ? `<div class="hc-sec hc-note">${esc(t('hc.items', { n: items }))}</div>` : ''}`;
}

// ------------------------------------------------------------------ Ware
function productCard(g: number): string {
  const prod = index.producers.get(g) ?? [];
  const cons = index.consumers.get(g) ?? [];
  const extra = index.extraBy.get(g) ?? [];
  const sec = (cap: string, list: number[]): string =>
    list.length ? `<div class="hc-sec"><div class="hc-cap">${esc(cap)}</div><div class="hc-list">${list.slice(0, 8).map((x) => named(x)).join('')}${list.length > 8 ? `<span class="hc-note">${esc(t('hc.more', { n: list.length - 8 }))}</span>` : ''}</div></div>` : '';
  const uniq = (bs: Building[]): number[] => {
    const seen = new Set<string>();
    return bs.filter((b) => (seen.has(b.n.de) ? false : (seen.add(b.n.de), true))).map((b) => b.g);
  };
  const body = sec(t('hc.producedIn'), uniq(prod)) + sec(t('hc.usedIn'), uniq(cons)) + sec(t('hc.extraBy'), extra.map((i) => i.g));
  return `${head(g, nameOf(g), esc(t('hc.good')))}${body || `<div class="hc-sec hc-note">${esc(t('hc.noInfo'))}</div>`}`;
}

export function cardHtml(g: number): string | null {
  if (!db) return null;
  const it = db.itemBy.get(g);
  if (it) return itemCard(it);
  const b = db.buildingBy.get(g);
  if (b) return buildingCard(b);
  if (db.names[g]) return productCard(g);
  return null;
}

/** Infofenster und einfache Tooltips auf der Seite einrichten. */
export function setupHoverCards(data: Db): void {
  db = data;
  index = buildIndex();
  const card = document.createElement('div');
  card.className = 'hovercard';
  card.hidden = true;
  document.body.append(card);
  let current: HTMLElement | null = null;
  let timer = 0;

  const place = (el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let left = r.right + 10;
    if (left + w > window.innerWidth - 8) left = r.left - w - 10;
    if (left < 8) left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    let top = r.top;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };
  const show = (el: HTMLElement): void => {
    const g = Number(el.dataset.card);
    const html = g ? cardHtml(g) : null;
    if (html) {
      card.className = 'hovercard';
      card.innerHTML = html;
    } else if (el.dataset.tip) {
      card.className = 'hovercard simple';
      card.textContent = el.dataset.tip;
    } else return;
    current = el;
    card.hidden = false;
    place(el);
  };
  const hide = (): void => {
    clearTimeout(timer);
    card.hidden = true;
    current = null;
  };
  const target = (e: Event): HTMLElement | null => (e.target as HTMLElement).closest<HTMLElement>('[data-card],[data-tip]');

  document.addEventListener('mouseover', (e) => {
    const el = target(e);
    if (el === current) return;
    clearTimeout(timer);
    if (!el) return hide();
    timer = window.setTimeout(() => show(el), 120);
  });
  document.addEventListener('focusin', (e) => {
    const el = target(e);
    if (el) show(el);
  });
  document.addEventListener(
    'touchstart',
    (e) => {
      const el = target(e);
      if (!el) return hide();
      if (el.closest('a,button')) return; // Links/Knöpfe behalten ihre Aktion
      show(el);
    },
    { passive: true },
  );
  window.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
}
