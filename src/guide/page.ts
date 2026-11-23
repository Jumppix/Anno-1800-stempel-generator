// Guide „Baumaterialinsel“: Kapitel, Handelskammer-Gruppen mit Items aus dem
// Video (Werte live aus der Spieldatenbank) und ein Rechner, der aus Zielmengen
// Gebäude, Handelskammern, Arbeitskraft, Strom, Öl, Import und Nebenprodukte
// bestimmt. Palast-Einstellungen gelten seitenweit (src/palaceSettings.ts).
import '../site.css';
import { getLang, onLangChange, pick, t } from '../i18n';
import { mountSite } from '../site';
import { DB_BASE, loadDb, loadPalace, type Building, type Db, type Item, type PalaceData } from '../db/data';
import { setupHoverCards } from '../db/hovercard';
import { activeEffects, modsFor, NO_MODS, type ActiveEffect, type PalaceMods } from '../db/palace';
import { evaluate, itemFx, isUseful, SLOTS, type ProdResult } from '../prod/calc';
import { getPalaceSettings, onPalaceSettings, openPalaceDialog, palaceSummary, prodPalaceState } from '../palaceSettings';
import { packMixed } from '../prod/layout';
import { buildGenericStamp, type StampBuilding, type StampStreet } from '../stamp';
import { STREET_GUIDS } from '../catalog';
import { CHAPTERS, CLUSTERS, DEFAULT_IMPORT, DEPOSIT, MATERIALS, OIL, POWER_PLANT, PRODUCER_CHOICES, VIDEO_URL, type Cluster } from './material';

interface ProdData {
  radius: number;
  layouts: Record<string, { n: number; b: Array<[number, number, number]>; r: Array<[number, number]> }>;
  setups: Record<string, { max?: number[] }>;
  setups4?: Record<string, { max?: number[] }>;
  setupsFI?: Record<string, { max?: number[] }>;
}

interface GuideState {
  targets: Record<string, number>;
  /** Kraftwerk in Reichweite auch für Gebäude mit optionalem Strom. */
  power: boolean;
  clip: boolean;
  /** Gewählter Erzeuger je Ware (z. B. Kohle). */
  producer: Record<string, number>;
  /** Importierte Waren. */
  imports: number[];
  /** Items der Zulieferer (nicht im Video): Rechner-Vorschlag oder keine. */
  supplier: 'suggest' | 'none';
  /** Gruppen, deren Gebäude geclippt stehen (Item- und Ministeriumseffekte doppelt). */
  clipGroups: string[];
  /** Speicherstadt-Kreislauf: Exportstufen und Endware. */
  trade: { lvlA: string; lvlB: string; mid: number; final: number };
}

const STORE = 'anno-guide-bm';

let db: Db;
let prod: ProdData;
let palace: PalaceData | null = null;
let effects: ActiveEffect[] = [];
let wfSet: Set<number>;
let st: GuideState = defaults();

function defaults(): GuideState {
  return {
    targets: Object.fromEntries(MATERIALS.map((m) => [String(m.p), m.target])),
    power: false,
    clip: false,
    producer: {},
    imports: [...DEFAULT_IMPORT],
    supplier: 'suggest',
    clipGroups: ['bike'],
    trade: { lvlA: 'Common', lvlB: 'Common', mid: 1010225, final: 1010227 },
  };
}
function load(): void {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) st = { ...defaults(), ...(JSON.parse(raw) as Partial<GuideState>) };
  } catch {
    /* Standardwerte */
  }
}
function save(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(st));
  } catch {
    /* nur für diese Sitzung */
  }
}

// ------------------------------------------------------------------ Hilfen
const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const num = (n: number, d = 1): string => n.toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: d });
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
const named = (g: number): string => `<span class="gd-named">${icon(g)}<span>${esc(nameOf(g))}</span></span>`;
const goodAmount = (p: number, v: number, d = 1): string => `<span class="gd-good">${icon(p)}<b>${num(v, d)}</b></span>`;

const clusterOf = (g: number): Cluster | undefined => CLUSTERS.find((c) => c.buildings.includes(g));
const modsCache = new Map<number, PalaceMods>();
const modsOf = (b: Building): PalaceMods => {
  if (!palace) return NO_MODS;
  let m = modsCache.get(b.g);
  if (!m) {
    m = modsFor(db, palace, effects, b);
    modsCache.set(b.g, m);
  }
  return m;
};
const slotsOf = (b: Building): number => SLOTS + Math.max(0, modsOf(b).sockets);

/** 4. Item einer Gruppe (nur mit Gewerkschaftsförderung): bester Rechner-Vorschlag, der noch fehlt. */
function extraItem(c: Cluster): number | undefined {
  const b = db.buildingBy.get(c.buildings[0]);
  if (!b || slotsOf(b) < 4) return undefined;
  return (prod.setups4?.[b.g]?.max ?? []).find((g) => !c.items.includes(g) && c.buildings.some((x) => db.itemBy.get(g)?.tgx.includes(x)));
}

/** Items, die auf ein Gebäude wirken (Gruppe aus dem Video, sonst Rechner-Vorschlag). */
function itemsFor(b: Building): Item[] {
  const c = clusterOf(b.g);
  let list: number[];
  if (c) {
    const x = extraItem(c);
    list = x ? [...c.items, x] : c.items;
  } else if (st.supplier === 'none') {
    list = [];
  } else {
    const table = slotsOf(b) > 3 && prod.setups4 ? prod.setups4 : prod.setups;
    list = table[b.g]?.max ?? [];
  }
  return list
    .map((g) => db.itemBy.get(g))
    .filter((i): i is Item => !!i && i.tgx.includes(b.g) && isUseful(itemFx(i)))
    .slice(0, slotsOf(b));
}

const resCache = new Map<number, ProdResult>();
function result(b: Building): ProdResult {
  let r = resCache.get(b.g);
  if (!r) {
    const clip = st.clip || st.clipGroups.includes(clusterOf(b.g)?.id ?? '');
    r = evaluate(b, itemsFor(b), { power: b.pow === 'req' || st.power, clip, palace: modsOf(b) }, wfSet);
    resCache.set(b.g, r);
  }
  return r;
}

/** Erzeuger einer Ware in der Alten Welt (Auswahl, sonst bevorzugt mit Grundfläche und Zykluszeit). */
function producerOf(p: number): Building | undefined {
  const choice = st.producer[String(p)] ?? PRODUCER_CHOICES[p]?.[0];
  if (choice) return db.buildingBy.get(choice);
  const list = db.buildings.filter((b) => b.c === 'production' && b.out?.[0]?.p === p && (b.reg?.[0] ?? 'ow') === 'ow');
  return list.sort((a, b) => Number(!!b.sz) - Number(!!a.sz) || Number(!!b.ct) - Number(!!a.ct) || Number(!!a.dlc) - Number(!!b.dlc))[0];
}
const layoutOf = (b: Building): number | undefined => (b.sz && !b.kind ? prod.layouts[b.sz.join('x')]?.n : undefined);

// ------------------------------------------------------------------ Rechner
interface Plan {
  counts: Map<number, number>;
  demand: Map<number, number>;
  imports: Map<number, number>;
  surplus: Map<number, number>;
}

function solve(): Plan {
  let counts = new Map<number, number>();
  let demand = new Map<number, number>();
  let imports = new Map<number, number>();
  let extraSupply = new Map<number, number>();
  const add = (m: Map<number, number>, p: number, v: number): void => {
    m.set(p, (m.get(p) ?? 0) + v);
  };
  // Fixpunkt: Bedarf → Gebäude → Eingänge/Nebenprodukte (Ketten sind kreisfrei)
  for (let iter = 0; iter < 40; iter++) {
    demand = new Map();
    extraSupply = new Map();
    for (const m of MATERIALS) add(demand, m.p, Math.max(0, st.targets[String(m.p)] ?? 0));
    for (const [g, c] of counts) {
      const r = result(db.buildingBy.get(g) as Building);
      for (const i of r.inputs) if (i.p !== DEPOSIT) add(demand, i.p, c * i.perMin);
      for (const e of r.extra) add(extraSupply, e.p, c * e.perMin);
    }
    const next = new Map<number, number>();
    imports = new Map();
    for (const [p, d] of demand) {
      const net = d - (extraSupply.get(p) ?? 0);
      if (net <= 1e-9) continue;
      const b = producerOf(p);
      const per = b ? result(b).perMin : 0;
      if (!b || st.imports.includes(p) || per <= 0) add(imports, p, net);
      else add(next, b.g, net / per);
    }
    counts = next;
  }
  const surplus = new Map<number, number>();
  for (const [p, s] of extraSupply) {
    const left = s - (demand.get(p) ?? 0);
    if (left > 1e-6) surplus.set(p, left);
  }
  return { counts, demand, imports, surplus };
}

/** Letztes Rechner-Ergebnis (Mischverhältnis der Layouts). */
let lastPlan: Plan | null = null;

function calcHtml(): string {
  const plan = solve();
  lastPlan = plan;
  const rows = [...plan.counts]
    .map(([g, c]) => ({ b: db.buildingBy.get(g) as Building, c }))
    .sort((a, b) => {
      const ia = CLUSTERS.findIndex((x) => x.buildings.includes(a.b.g));
      const ib = CLUSTERS.findIndex((x) => x.buildings.includes(b.b.g));
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || pick(a.b.n).localeCompare(pick(b.b.n));
    });
  const wf = new Map<number, number>();
  let coins = 0;
  let reqPower = 0;
  let hks = 0;
  const body = rows
    .map(({ b, c }) => {
      const r = result(b);
      const n = Math.ceil(c - 1e-6);
      for (const w of r.workforce) wf.set(w.p, (wf.get(w.p) ?? 0) + w.a * n);
      coins += r.coins * n;
      if (b.pow === 'req') reqPower += n;
      const L = layoutOf(b);
      if (L) hks += c / L;
      const items = itemsFor(b);
      const cl = clusterOf(b.g);
      return `<tr>
        <td>${named(b.g)}${cl ? `<small class="gd-tag">${esc(cl.title)}</small>` : ''}</td>
        <td class="num"><b>${n}</b><small>${num(c, 2)}</small></td>
        <td class="num">${L ? `${num(c / L, 2)}<small>${esc(t('guide.perHk', { n: L }))}</small>` : `<small>${esc(t(`prod.kind.${b.kind ?? 'none'}`))}</small>`}</td>
        <td>${items.map((i) => icon(i.g, 'sic')).join('') || '<span class="muted">–</span>'}</td>
        <td class="num">${r.output ? goodAmount(r.output, r.perMin, 2) : '–'}<small>${num(r.prod, 0)} %</small></td>
        <td>${r.inputs.filter((i) => i.p !== DEPOSIT).map((i) => goodAmount(i.p, i.perMin * c)).join('') || '<span class="muted">–</span>'}</td>
        <td>${r.workforce.map((w) => goodAmount(w.p, w.a * n, 0)).join('') || '–'}</td>
      </tr>`;
    })
    .join('');
  const list = (m: Map<number, number>): string =>
    [...m]
      .filter(([, v]) => v > 1e-6)
      .sort((a, b) => b[1] - a[1])
      .map(([p, v]) => goodAmount(p, v))
      .join('') || `<span class="muted">${esc(t('guide.none'))}</span>`;
  // Öl-Bilanz: Malching gegen Kraftwerke
  const plant = db.buildingBy.get(POWER_PLANT);
  const oilPerPlant = plant?.ct ? (60 / plant.ct) * (plant.in?.find((i) => i.p === OIL)?.a ?? 1) : 0;
  const oil = plan.surplus.get(OIL) ?? 0;
  return `<div class="gd-sum">
      <div><span>${esc(t('guide.sum.buildings'))}</span><b>${num(rows.reduce((s, r) => s + Math.ceil(r.c - 1e-6), 0), 0)}</b></div>
      <div><span>${esc(t('guide.sum.hk'))}</span><b>≈ ${num(Math.ceil(hks), 0)}</b></div>
      <div><span>${esc(t('guide.sum.coins'))}</span><b>${icon(1010017)} ${num(coins, 0)}</b></div>
      <div><span>${esc(t('guide.sum.power'))}</span><b>${num(reqPower, 0)}</b></div>
      <div><span>${esc(t('guide.sum.oil'))}</span><b>${icon(OIL)} ${num(oil)} → ${num(oilPerPlant ? oil / oilPerPlant : 0)} ${esc(t('guide.plants'))}</b></div>
    </div>
    <div class="gd-wf"><span>${esc(t('prod.col.workforce'))}:</span> ${[...wf].filter(([, v]) => v > 0).map(([p, v]) => goodAmount(p, v, 0)).join('') || `<b>0</b>`}</div>
    <div class="gd-table-wrap"><table class="gd-table">
      <thead><tr><th>${esc(t('prod.col.building'))}</th><th>${esc(t('guide.col.count'))}</th><th>${esc(t('guide.col.hk'))}</th><th>${esc(t('prod.col.items'))}</th><th>${esc(
        t('guide.col.each'),
      )}</th><th>${esc(t('guide.col.inputs'))}</th><th>${esc(t('prod.col.workforce'))}</th></tr></thead>
      <tbody>${body || `<tr><td colspan="7" class="muted">${esc(t('guide.none'))}</td></tr>`}</tbody>
    </table></div>
    <div class="gd-flows">
      <div><h4>${esc(t('guide.imports'))}</h4><div class="gd-goods">${list(plan.imports)}</div></div>
      <div><h4>${esc(t('guide.surplus'))}</h4><div class="gd-goods">${list(plan.surplus)}</div></div>
    </div>`;
}

function calcControls(): string {
  const targets = MATERIALS.map(
    (m) => `<label class="gd-target">${icon(m.p)}<span>${esc(nameOf(m.p))}</span><input type="number" min="0" max="5000" step="5" data-target="${m.p}" value="${st.targets[String(m.p)] ?? 0}" /><small>t/min</small></label>`,
  ).join('');
  const choices = Object.entries(PRODUCER_CHOICES)
    .map(
      ([p, gs]) => `<label class="gd-opt">${icon(Number(p))}<span>${esc(nameOf(Number(p)))}</span><select data-producer="${p}">${gs
        .map((g) => `<option value="${g}" ${(st.producer[p] ?? gs[0]) === g ? 'selected' : ''}>${esc(nameOf(g))}</option>`)
        .join('')}</select></label>`,
    )
    .join('');
  // Importierbare Zwischenprodukte: alles, was selbst hergestellt werden kann
  const importable = [1010222, 1010224, 1010231, 1010228, 1010241, 1010226, 1010219, 1010227, 1010242, 1010204, 1010201];
  const imports = importable
    .map((p) => `<label class="gd-chk">${icon(p)}<input type="checkbox" data-import="${p}" ${st.imports.includes(p) ? 'checked' : ''} /><span>${esc(nameOf(p))}</span></label>`)
    .join('');
  return `<div class="gd-targets">${targets}</div>
    <div class="gd-options">
      ${choices}
      <label class="gd-opt"><span>${esc(t('guide.supplier'))}</span><select data-opt="supplier">
        <option value="suggest" ${st.supplier === 'suggest' ? 'selected' : ''}>${esc(t('guide.supplier.suggest'))}</option>
        <option value="none" ${st.supplier === 'none' ? 'selected' : ''}>${esc(t('guide.supplier.none'))}</option>
      </select></label>
      <label class="gd-chk"><input type="checkbox" data-opt="power" ${st.power ? 'checked' : ''} /><span>${esc(t('guide.power'))}</span></label>
      <label class="gd-chk"><input type="checkbox" data-opt="clip" ${st.clip ? 'checked' : ''} /><span>${esc(t('prod.clip'))}</span></label>
      <button type="button" class="pal-edit" data-act="palace">🏛 ${esc(t('pal.edit'))}</button>
    </div>
    <p class="note">${esc(t('guide.palaceNow'))}: ${esc(palaceSummary(getPalaceSettings(), palace, 'prod'))} · ${esc(t(`pal.loc.${getPalaceSettings().prod}`))}</p>
    <details class="gd-imports"><summary>${esc(t('guide.importChoose'))}</summary><div class="gd-chks">${imports}</div></details>`;
}

// ------------------------------------------------------------------ Gruppen
function clusterCard(c: Cluster): string {
  const x = extraItem(c);
  const items = [...c.items, ...(x ? [x] : [])];
  const lines = c.buildings
    .map((g) => {
      const b = db.buildingBy.get(g);
      if (!b) return '';
      const r = result(b);
      const L = layoutOf(b);
      const used = itemsFor(b).map((i) => i.g);
      return `<div class="gd-bline">
        <div class="gd-bname">${b.i ? `<img class="bic" src="${DB_BASE}icons/${b.i}" alt="" data-card="${b.g}" />` : ''}<div><b>${esc(pick(b.n))}</b><small>${
          b.sz ? `${b.sz[0]}×${b.sz[1]} · ` : ''
        }${esc(t('guide.itemsUsed', { n: used.length, m: items.length }))}${b.pow === 'req' ? ` · ⚡ ${esc(t('hc.powerReq'))}` : ''}</small></div></div>
        <div class="gd-vals">
          <span><small>${esc(t('prod.col.prod'))}</small><b class="${r.works ? '' : 'bad'}">${r.works ? `${num(r.prod, 0)} %` : esc(t('prod.stopped'))}</b>${r.cycle ? `<small>${num(r.cycle, 0)} s</small>` : ''}</span>
          <span><small>${esc(t('guide.col.each'))}</small>${r.output ? goodAmount(r.output, r.perMin, 2) : '–'}</span>
          <span><small>${esc(t('guide.col.inputs'))}</small>${r.inputs.filter((i) => i.p !== DEPOSIT).map((i) => goodAmount(i.p, i.perMin, 2)).join('') || '–'}</span>
          <span><small>${esc(t('prod.col.workforce'))}</small>${r.workforce.map((w) => goodAmount(w.p, w.a, 0)).join('') || '–'}</span>
          <span><small>${esc(t('guide.byproducts'))}</small>${r.extra.map((e) => goodAmount(e.p, e.perMin, 2)).join('') || '–'}</span>
          <span><small>${esc(t('guide.perHkShort'))}</small>${L && r.output ? `<b>${L}</b> → ${goodAmount(r.output, r.perMin * L, 0)}` : `<small>${esc(t(`prod.kind.${b.kind ?? 'none'}`))}</small>`}</span>
        </div>
      </div>`;
    })
    .join('');
  const clipped = st.clip || st.clipGroups.includes(c.id);
  return `<article class="gd-card" id="hk-${c.id}">
    <h3>${esc(c.title)}<label class="gd-chk gd-clip"><input type="checkbox" data-clipgroup="${c.id}" ${clipped ? 'checked' : ''} ${st.clip ? 'disabled' : ''} /><span>${esc(t('guide.clipped'))}</span></label></h3>
    <div class="gd-items">${items
      .map((g, i) => {
        const it = db.itemBy.get(g);
        return it ? `<span class="gd-item r-${it.r}${i >= c.items.length ? ' extra' : ''}">${icon(g, 'sic')}<span>${esc(pick(it.n))}</span>${i >= c.items.length ? `<small>${esc(t('guide.fourth'))}</small>` : ''}</span>` : '';
      })
      .join('')}</div>
    <p>${esc(c.text)}</p>
    ${lines}
    ${c.tips?.length ? `<ul class="gd-tips">${c.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${canLayout(c) ? `<div class="gd-actions"><button type="button" class="pal-edit" data-layout="${c.id}">▦ ${esc(t(c.buildings.length > 1 ? 'guide.layoutMixed' : 'guide.layout'))}</button></div>` : ''}
  </article>`;
}

// ------------------------------------------------------------------ Speicherstadt
const LEVELS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

/** Tonnen Export je Tonne Import: R = V(I)/V(E) · M_I(I)/M_E(Stufe des Exports). */
function ratio(exp: number, imp: number, expLevel: string): number | null {
  const e = db.info.goods[exp];
  const i = db.info.goods[imp];
  if (!e?.ev || !i?.ev) return null;
  const me = db.info.docklands?.factors[expLevel]?.f ?? 1;
  return (i.ev / e.ev) * ((i.im ?? 1) / me);
}

/** Alle importierbaren Waren mit Händler und Stufe. */
function importables(): Array<{ p: number; trader: string; lvl: string }> {
  const out: Array<{ p: number; trader: string; lvl: string }> = [];
  for (const tr of db.info.docklands?.traders ?? []) for (const g of tr.goods) out.push({ p: g.p, trader: pick(tr.n ?? { de: '', en: '' }), lvl: g.lvl });
  return out;
}

/** Verhältnis wie im Spiel: > 1 als „R : 1“, sonst „1 : 1/R“ (Export : Import). */
const ratioText = (r: number): string => (r >= 1 ? `${num(r, 2)} : 1` : `1 : ${num(1 / r, 1)}`);

function tradeHtml(): string {
  const d = db.info.docklands;
  if (!d) return `<p class="muted">${esc(t('guide.none'))}</p>`;
  const lvlName = (k: string): string => pick(db.meta.labels.rarity[k.toLowerCase()] ?? [k, k]);
  const lvlSelect = (key: 'lvlA' | 'lvlB'): string =>
    `<select data-trade="${key}">${LEVELS.map((l) => `<option value="${l}" ${st.trade[key] === l ? 'selected' : ''}>${esc(lvlName(l))} (×${d.factors[l]?.f ?? 1})</option>`).join('')}</select>`;
  const imps = importables().filter((x) => db.info.goods[x.p]?.ev);
  const goodSelect = (key: 'mid' | 'final'): string =>
    `<select data-trade="${key}">${imps
      .map((x) => `<option value="${x.p}" ${st.trade[key] === x.p ? 'selected' : ''}>${esc(nameOf(x.p))} – ${esc(x.trader)} (${esc(lvlName(x.lvl))})</option>`)
      .join('')}</select>`;
  // Nebenprodukte der Hochrad-Werkhallen aus dem Rechner
  const bike = db.buildingBy.get(1010323);
  const bikes = lastPlan?.counts.get(1010323) ?? 0;
  const by = bike ? result(bike).extra.filter((e) => db.info.goods[e.p]?.ev) : [];
  const mid = st.trade.mid;
  const fin = st.trade.final;
  let midTotal = 0;
  const rowsA = by
    .map((e) => {
      const perMin = e.perMin * Math.ceil(bikes - 1e-6);
      const r = ratio(e.p, mid, st.trade.lvlA);
      const got = r ? perMin / r : 0;
      midTotal += got;
      return `<tr><td>${named(e.p)}</td><td class="num">${num(perMin, 2)}</td><td class="num">${r ? ratioText(r) : '–'}</td><td class="num">${goodAmount(mid, got, 2)}</td></tr>`;
    })
    .join('');
  const rB = ratio(mid, fin, st.trade.lvlB);
  const finTotal = rB ? midTotal / rB : 0;
  const perTrade = (perMin: number): number => perMin * (d.minutes ?? 20);
  return `<div class="gd-options">
      <label class="gd-opt"><span>${esc(t('guide.tradeMid'))}</span>${goodSelect('mid')}</label>
      <label class="gd-opt"><span>${esc(t('guide.tradeLvlA'))}</span>${lvlSelect('lvlA')}</label>
      <label class="gd-opt"><span>${esc(t('guide.tradeFinal'))}</span>${goodSelect('final')}</label>
      <label class="gd-opt"><span>${esc(t('guide.tradeLvlB'))}</span>${lvlSelect('lvlB')}</label>
    </div>
    <h4>${esc(t('guide.tradeStepA', { n: Math.ceil(bikes - 1e-6) }))}</h4>
    ${
      rowsA
        ? `<div class="gd-table-wrap"><table class="gd-table"><thead><tr><th>${esc(t('guide.byproducts'))}</th><th>t/min</th><th>${esc(t('guide.ratio'))}</th><th>${esc(
            nameOf(mid),
          )} t/min</th></tr></thead><tbody>${rowsA}</tbody></table></div>`
        : `<p class="muted">${esc(t('guide.tradeNoBikes'))}</p>`
    }
    <h4>${esc(t('guide.tradeStepB'))}</h4>
    <p class="gd-flowline">${goodAmount(mid, midTotal, 2)} t/min → ${rB ? `${esc(t('guide.ratio'))} ${ratioText(rB)} → ` : ''}${goodAmount(fin, finTotal, 2)} t/min
      <small class="muted">${esc(t('guide.tradePerTrade', { a: num(perTrade(midTotal), 0), b: num(perTrade(finTotal), 0), m: d.minutes ?? 20 }))}</small></p>
    <p class="note">${esc(t('guide.tradeRules'))} <a href="${esc(d.valuesSource ?? '#')}" target="_blank" rel="noopener">Anno 1800 Wiki – Exchange Ratios</a></p>`;
}

// ------------------------------------------------------------------ Layouts & Stempel
interface PlacedLayout {
  buildings: Array<{ g: number; x: number; y: number; w: number; h: number; turns: number }>;
  roads: Array<[number, number]>;
  counts: number[];
}

/** Layout nur für Gebäude mit fester Grundfläche (keine Farmen, Minen, Waldflächen, Küste). */
const canLayout = (c: Cluster): boolean =>
  c.buildings.every((g) => {
    const b = db.buildingBy.get(g);
    return !!b?.sz && !b.kind;
  });

/** Verhältnis der Gebäude einer Gruppe aus dem Rechner (sonst 1 : 1). */
function planWeights(c: Cluster): number[] {
  const w = c.buildings.map((g) => lastPlan?.counts.get(g) ?? 0);
  return w.every((x) => x > 0) ? w : c.buildings.map(() => 1);
}

function layoutFor(c: Cluster, weights: number[]): PlacedLayout | null {
  const bs = c.buildings.map((g) => db.buildingBy.get(g) as Building);
  if (bs.length === 1) {
    const b = bs[0];
    const L = prod.layouts[(b.sz as [number, number]).join('x')];
    if (!L) return null;
    const [px, pz] = b.sz as [number, number];
    return {
      buildings: L.b.map(([x, y, turns]) => ({ g: b.g, x, y, turns, w: turns % 2 ? px : pz, h: turns % 2 ? pz : px })),
      roads: L.r,
      counts: [L.b.length],
    };
  }
  const L = packMixed(bs.map((b, i) => ({ size: b.sz as [number, number], weight: weights[i] })), prod.radius ?? 15);
  return {
    buildings: L.buildings.map((x, i) => ({ g: bs[L.kinds[i]].g, x: x.x, y: x.y, w: x.w, h: x.h, turns: x.turns })),
    roads: L.roads.map((r) => [r.x, r.y] as [number, number]),
    counts: L.counts,
  };
}

const KIND_COLORS = [
  ['#1d4a5c', '#5fa8c4'],
  ['#4a3a1d', '#c4a05f'],
  ['#2a4a2a', '#6fb46f'],
];

function layoutSvg(c: Cluster, L: PlacedLayout): string {
  const R = prod.radius ?? 15;
  let minX = -R;
  let minY = -R;
  let maxX = R;
  let maxY = R;
  for (const b of L.buildings) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  for (const [x, y] of L.roads) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1);
    maxY = Math.max(maxY, y + 1);
  }
  const pad = 1;
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  const hkIcon = db.names[1010516]?.[2];
  return `<svg class="layout-svg" viewBox="${vb}" role="img" aria-label="${esc(c.title)}">
    <circle cx="0" cy="0" r="${R}" fill="rgba(217,179,108,.06)" stroke="#d9b36c" stroke-width=".12" stroke-dasharray=".5 .3"/>
    ${L.roads.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="#4a5560"/>`).join('')}
    ${L.buildings
      .map((b) => {
        const k = c.buildings.indexOf(b.g);
        const [fill, stroke] = KIND_COLORS[k % KIND_COLORS.length];
        const ic = db.buildingBy.get(b.g)?.i;
        return `<g><rect x="${b.x + 0.08}" y="${b.y + 0.08}" width="${b.w - 0.16}" height="${b.h - 0.16}" rx=".3" fill="${fill}" stroke="${stroke}" stroke-width=".08"/>${
          ic ? `<image href="${DB_BASE}icons/${ic}" x="${b.x + b.w / 2 - 1.1}" y="${b.y + b.h / 2 - 1.1}" width="2.2" height="2.2"/>` : ''
        }</g>`;
      })
      .join('')}
    <rect x="-2" y="-2" width="4" height="4" rx=".3" fill="#5c4a1d" stroke="#d9b36c" stroke-width=".12"/>
    ${hkIcon ? `<image href="${DB_BASE}icons/${hkIcon}" x="-1.4" y="-1.4" width="2.8" height="2.8"/>` : ''}
  </svg>`;
}

function downloadStamp(c: Cluster, L: PlacedLayout): void {
  const items: StampBuilding[] = [
    { guid: 1010516, x: -2, y: -2, w: 4, h: 4, turns: 0 },
    ...L.buildings.map((b) => ({ guid: b.g, x: b.x, y: b.y, w: b.w, h: b.h, turns: b.turns })),
  ];
  const streets: StampStreet[] = L.roads.map(([x, y]) => ({ x, y, guid: STREET_GUIDS.paved }));
  const bytes = buildGenericStamp(items, 'ow', streets);
  const parts = c.buildings.map((g, i) => `${(db.buildingBy.get(g)?.n.en ?? String(g)).replace(/[^A-Za-z0-9]+/g, '')}${L.counts[i]}`);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `HK_${parts.join('_')}`; // Stempel ohne Dateiendung
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let modal: HTMLElement | null = null;
function openLayout(c: Cluster, weights = planWeights(c)): void {
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal';
    modal.hidden = true;
    modal.innerHTML = '<div class="modal-box wide" role="dialog" aria-modal="true"><button class="modal-close" type="button" aria-label="✕">✕</button><div class="modal-body"></div></div>';
    document.body.append(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal || (e.target as HTMLElement).closest('.modal-close')) (modal as HTMLElement).hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal) modal.hidden = true;
    });
  }
  const L = layoutFor(c, weights);
  const body = modal.querySelector('.modal-body') as HTMLElement;
  if (!L) {
    body.innerHTML = `<p>${esc(t('guide.none'))}</p>`;
    modal.hidden = false;
    return;
  }
  const mixed = c.buildings.length > 1;
  const yields = c.buildings
    .map((g, i) => {
      const b = db.buildingBy.get(g) as Building;
      const r = result(b);
      const [fill, stroke] = KIND_COLORS[i % KIND_COLORS.length];
      return `<li><span class="gd-swatch" style="background:${fill};border-color:${stroke}"></span>${named(g)} <b>× ${L.counts[i]}</b>${
        r.output ? ` → ${goodAmount(r.output, r.perMin * L.counts[i], 1)} t/min` : ''
      }${mixed ? ` <label class="gd-ratio">${esc(t('guide.weight'))} <input type="number" min="0" step="1" data-w="${i}" value="${Math.round(weights[i] * 100) / 100}" /></label>` : ''}</li>`;
    })
    .join('');
  body.innerHTML = `<h2>${esc(c.title)}: ${esc(t('guide.layoutTitle'))}</h2>
    <p>${esc(t(mixed ? 'guide.layoutMixedInfo' : 'guide.layoutInfo', { r: prod.radius ?? 15, roads: L.roads.length }))}</p>
    <ul class="gd-yield">${yields}</ul>
    ${mixed ? `<p class="note">${esc(t('guide.weightNote'))}</p>` : ''}
    ${layoutSvg(c, L)}
    <div class="layout-actions">
      <button type="button" class="primary" data-act="stamp">${esc(t('prod.stamp'))}</button>
      ${mixed ? `<button type="button" data-act="relayout">${esc(t('guide.relayout'))}</button>` : ''}
    </div>
    <p class="note">${esc(t('prod.layoutNote'))}</p>`;
  body.querySelector('[data-act="stamp"]')?.addEventListener('click', () => downloadStamp(c, L));
  body.querySelector('[data-act="relayout"]')?.addEventListener('click', () => {
    const w = c.buildings.map((_, i) => Math.max(0, Number(body.querySelector<HTMLInputElement>(`[data-w="${i}"]`)?.value) || 0));
    openLayout(c, w.some((x) => x > 0) ? w : c.buildings.map(() => 1));
  });
  modal.hidden = false;
}

// ------------------------------------------------------------------ Seite
function render(): void {
  resCache.clear();
  modsCache.clear();
  effects = palace ? activeEffects(db, palace, prodPalaceState(getPalaceSettings())) : [];
  const plant = db.buildingBy.get(POWER_PLANT);
  const oilPerPlant = plant?.ct ? (60 / plant.ct) * (plant.in?.find((i) => i.p === OIL)?.a ?? 1) : 0;
  const toc = [
    ['overview', t('guide.toc.overview')],
    ['calc', t('guide.toc.calc')],
    ['trade', t('guide.toc.trade')],
    ['hk', t('guide.toc.hk')],
    ...CHAPTERS.map((c) => [c.id, c.title]),
  ];
  $('#guide').innerHTML = `
    <header class="gd-head">
      <h1>${esc(t('guide.title'))}</h1>
      <p class="lead">${esc(t('guide.lead'))}</p>
      ${getLang() === 'en' ? `<p class="note">${esc(t('guide.deOnly'))}</p>` : ''}
      <p class="note">${esc(t('guide.source'))} <a href="${VIDEO_URL}" target="_blank" rel="noopener">„Baumaterialinsel 3.0“ (YouTube)</a>. ${esc(t('guide.sourceNote'))}</p>
      <nav class="gd-toc">${toc.map(([id, title]) => `<a href="#${id}">${esc(title)}</a>`).join('')}</nav>
    </header>
    <section class="gd-sec" id="overview">
      <h2>${esc(t('guide.toc.overview'))}</h2>
      <div class="gd-goods gd-final">${MATERIALS.map((m) => named(m.p)).join('')}</div>
      <ol class="gd-steps">
        <li>Große Insel in der Alten Welt wählen; Hafen mit Speicherstadt planen.</li>
        <li>Holzfäller → Sägewerke/Fensterfabriken, Lehm → Ziegeleien, Eisen + Kohle → Hochöfen → Stahlwerke/Betonwerke aufbauen (erst ohne Items, Pendlerkai für Arbeitskraft).</li>
        <li>Je Gruppe eine Handelskammer mit den Items unten bestücken; Strom kommt dabei meist aus den Items.</li>
        <li>Regionalministerium mit Ministerium für Arbeit und „Fabrikinspektionen“ – oder Palastinsel mit „Gewerkschaftsförderung“.</li>
        <li>Eisenminen mit Verrückter Viktoria und Jörg von Malching: viel Eisen plus Öl für das Kraftwerk der Hochrad-Werkhallen und Fahrstühle.</li>
        <li>Verteilung über Rundrouten je Baumaterial, für Aufstiege eine Extra-Route.</li>
      </ol>
    </section>
    <section class="gd-sec" id="calc">
      <h2>${esc(t('guide.toc.calc'))}</h2>
      <p class="note">${esc(t('guide.calcNote'))}</p>
      <div id="gd-controls">${calcControls()}</div>
      <div id="gd-result">${calcHtml()}</div>
    </section>
    <section class="gd-sec" id="trade">
      <h2>${esc(t('guide.toc.trade'))}</h2>
      <p class="note">${esc(t('guide.tradeNote'))}</p>
      <div id="gd-trade">${tradeHtml()}</div>
    </section>
    <section class="gd-sec" id="hk">
      <h2>${esc(t('guide.toc.hk'))}</h2>
      <p class="note">${esc(t('guide.hkNote'))}</p>
      <div class="gd-cards">${CLUSTERS.map(clusterCard).join('')}</div>
    </section>
    ${CHAPTERS.map((c) => `<section class="gd-sec gd-text" id="${c.id}"><h2>${esc(c.title)}</h2>${c.html}</section>`).join('')}
    <p class="note gd-foot">${esc(t('guide.foot'))}</p>`;
  document.querySelectorAll<HTMLElement>('[data-calc="oilPerPlant"]').forEach((el) => (el.textContent = num(oilPerPlant)));
}

/** Nur Ergebnis und Karten neu (Eingabefelder behalten den Fokus). */
function refresh(): void {
  resCache.clear();
  $('#gd-result').innerHTML = calcHtml();
  const tr = document.querySelector('#gd-trade');
  if (tr) tr.innerHTML = tradeHtml();
  const cards = document.querySelector('.gd-cards');
  if (cards) cards.innerHTML = CLUSTERS.map(clusterCard).join('');
}

async function main(): Promise<void> {
  mountSite('guide');
  load();
  try {
    const [d, p, pd] = await Promise.all([loadDb(), fetch(`${DB_BASE}prod.json`).then((r) => r.json() as Promise<ProdData>), loadPalace()]);
    db = d;
    prod = p;
    palace = pd;
    setupHoverCards(db);
  } catch (err) {
    $('#guide').innerHTML = `<p class="db-empty">${esc(t('db.error'))}</p>`;
    console.error(err);
    return;
  }
  wfSet = new Set(db.meta.workforce ?? []);
  render();
  const root = $('#guide');
  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset.target) return;
    st.targets[el.dataset.target] = Math.max(0, Math.min(5000, Number(el.value) || 0));
    save();
    refresh();
  });
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.producer) st.producer[el.dataset.producer] = Number(el.value);
    else if (el.dataset.import) {
      const p = Number(el.dataset.import);
      st.imports = (el as HTMLInputElement).checked ? [...new Set([...st.imports, p])] : st.imports.filter((x) => x !== p);
    } else if (el.dataset.opt === 'supplier') st.supplier = el.value as GuideState['supplier'];
    else if (el.dataset.opt === 'power') st.power = (el as HTMLInputElement).checked;
    else if (el.dataset.opt === 'clip') st.clip = (el as HTMLInputElement).checked;
    else if (el.dataset.clipgroup) {
      const id = el.dataset.clipgroup;
      st.clipGroups = (el as HTMLInputElement).checked ? [...new Set([...st.clipGroups, id])] : st.clipGroups.filter((x) => x !== id);
    } else if (el.dataset.trade) st.trade = { ...st.trade, [el.dataset.trade]: el.dataset.trade.startsWith('lvl') ? el.value : Number(el.value) };
    else return;
    save();
    refresh();
  });
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-act="palace"]')) void openPalaceDialog();
    const lay = target.closest<HTMLElement>('[data-layout]')?.dataset.layout;
    const c = lay ? CLUSTERS.find((x) => x.id === lay) : undefined;
    if (c) openLayout(c);
  });
  onPalaceSettings(() => render());
  onLangChange(() => render());
}

void main();
