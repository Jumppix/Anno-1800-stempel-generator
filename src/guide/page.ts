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
import { CHAPTERS, CLUSTERS, DEFAULT_IMPORT, DEPOSIT, MATERIALS, OIL, POWER_PLANT, PRODUCER_CHOICES, VIDEO_URL, type Cluster } from './material';

interface ProdData {
  layouts: Record<string, { n: number }>;
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
    r = evaluate(b, itemsFor(b), { power: b.pow === 'req' || st.power, clip: st.clip, palace: modsOf(b) }, wfSet);
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

function calcHtml(): string {
  const plan = solve();
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
    <p class="note">${esc(t('guide.palaceNow'))}: ${esc(palaceSummary(getPalaceSettings(), palace))} · ${esc(t(`pal.loc.${getPalaceSettings().prod}`))}</p>
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
  return `<article class="gd-card" id="hk-${c.id}">
    <h3>${esc(c.title)}</h3>
    <div class="gd-items">${items
      .map((g, i) => {
        const it = db.itemBy.get(g);
        return it ? `<span class="gd-item r-${it.r}${i >= c.items.length ? ' extra' : ''}">${icon(g, 'sic')}<span>${esc(pick(it.n))}</span>${i >= c.items.length ? `<small>${esc(t('guide.fourth'))}</small>` : ''}</span>` : '';
      })
      .join('')}</div>
    <p>${esc(c.text)}</p>
    ${lines}
    ${c.tips?.length ? `<ul class="gd-tips">${c.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </article>`;
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
    else return;
    save();
    refresh();
  });
  root.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act="palace"]')) void openPalaceDialog();
  });
  onPalaceSettings(() => render());
  onLangChange(() => render());
}

void main();
