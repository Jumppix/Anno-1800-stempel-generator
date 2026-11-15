// Oberfläche „Stadt-Analyse“: Stadt-Stempel laden, Palast/Ministerium
// einstellen, Versorgung, Panorama und Einwohner prüfen.

import { analyzeCity, SERVICE_KINDS, type Analysis, type ResidenceInfo } from './analysis';
import { CATALOG_LIST, type BuildingKind } from './catalog';
import { adjacentRoads, cityFromStamp, RoadSearch, type City, type CityBuilding } from './city';
import {
  cityWideWebBonus,
  DEFAULT_RULES,
  localDepartmentRange,
  palaceRange,
  PANORAMA_NAMES,
  POLICIES,
  welfareBonus,
  type Ministry,
  type Policy,
  type RuleConfig,
  type TierEdits,
} from './rules';
import { Camera } from './camera';
import { buildGenericStamp } from './stamp';
import { decodeStampFull } from './stampReader';
import { catalogTestLayout, demoCityLayout } from './testStamps';

type Layer = 'overview' | 'panorama' | 'residents' | 'townHall' | 'post' | 'ministry' | 'clipping' | BuildingKind;

const KIND_NAMES: Partial<Record<BuildingKind, string>> = {};
for (const e of CATALOG_LIST) KIND_NAMES[e.kind] ??= e.name;
KIND_NAMES.powerPlant = 'Strom (Kraftwerk)';

const KIND_COLORS: Partial<Record<BuildingKind, string>> = {
  townHall: '#6f9fe0',
  tradeUnion: '#7cc48a',
  departmentStore: '#d9784f',
  furnitureStore: '#c9944a',
  drugStore: '#d0b14a',
  university: '#9d7fd6',
  bank: '#c9c9c9',
  varietyTheatre: '#d67fb0',
  membersClub: '#b58ad6',
  powerPlant: '#e0d45a',
  fireStation: '#e05a5a',
  policeStation: '#5a7ae0',
  hospital: '#f0f0f0',
  postOffice: '#e0a050',
  postBox: '#e0a050',
  airport: '#8aa0b0',
  airportModule: '#8aa0b0',
  localDepartment: '#e2b25f',
  warehouse: '#a08060',
  production: '#7a9a6a',
  other: '#5a6670',
};

const TIER_COLORS = { engineer: '#4fa3a5', investor: '#d9a441', artisan: '#8a8f96' };

/** Investoren Stufe 4/5 dunkler/kräftiger, damit die Bauweise 3-3-5/4-5 lesbar ist. */
function tierColor(r: ResidenceInfo): string {
  if (r.tier === 'investor' && r.level === 5) return '#c2602d';
  if (r.tier === 'investor' && r.level === 4) return '#c98a2e';
  return TIER_COLORS[r.tier];
}

const num = (v: number): string => v.toLocaleString('de-DE');
const pct = (v: number): string => `${(v * 100).toFixed(0)} %`;

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

interface View {
  scale: number;
  ox: number;
  oy: number;
}

export class CityUi {
  private city: City | null = null;
  private analysis: Analysis | null = null;
  private rules: RuleConfig = { ...DEFAULT_RULES };
  private layer: Layer = 'overview';
  private view: View | null = null;
  private resByIndex = new Map<number, ResidenceInfo>();
  private sourceName = '';
  private harbor: { x: number; y: number } | null = null;
  /** Geplante Stufen für den nächsten `load` (nur über `show`). */
  private pendingPlanned: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }> | null = null;
  /** Landfläche der geplanten Insel (Kachelachsen der Stadt), nur beim Plan. */
  private land: { w: number; h: number; data: Uint8Array; dx: number; dy: number } | null = null;

  private readonly fileInput = el<HTMLInputElement>('#city-file');
  private readonly info = el<HTMLElement>('#city-info');
  private readonly wings = el<HTMLInputElement>('#rule-wings');
  private readonly prestige = el<HTMLInputElement>('#rule-prestige');
  private readonly ministry = el<HTMLSelectElement>('#rule-ministry');
  private readonly policy = el<HTMLSelectElement>('#rule-policy');
  private readonly institutions = el<HTMLInputElement>('#rule-institutions');
  private readonly items = el<HTMLInputElement>('#rule-items');
  private readonly delivery = el<HTMLInputElement>('#rule-delivery');
  private readonly mail = el<HTMLSelectElement>('#rule-mail');
  private readonly reduction = el<HTMLInputElement>('#rule-reduction');
  private readonly ruleInfo = el<HTMLElement>('#rule-info');
  private readonly layerSelect = el<HTMLSelectElement>('#city-layer');
  private readonly tierMode = el<HTMLSelectElement>('#rule-tiers');
  private edits: TierEdits = { houses: new Map(), groups: new Map() };
  private nonSky = new Set<number>();
  private readonly stats = el<HTMLElement>('#city-stats');
  private readonly warnings = el<HTMLElement>('#city-warnings');
  private readonly tip = el<HTMLElement>('#city-tip');
  private readonly selectBox = el<HTMLElement>('#city-select');
  /** Zoom/Verschiebung der Plan-/Analyse-Ansicht. */
  readonly camera = new Camera();
  /** Angewähltes Gebäude (Index), −1 = keins. */
  private selected = -1;
  /** Straßenreichweite des angewählten öffentlichen Gebäudes (zwischengespeichert). */
  private selCover: { idx: number; analysis: Analysis; roads: Uint8Array; houses: Set<number> } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly isActive: () => boolean,
    /** Wird aufgerufen, wenn ein Stempel/Plan geladen wurde (Ansicht wechseln). */
    private readonly onShow: () => void = () => undefined,
  ) {
    this.wings.value = String(this.rules.palaceWings);
    this.prestige.value = String(this.rules.prestige);
    this.ministry.value = this.rules.ministry;
    this.fillPolicies();
    this.fillLayers();

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) void this.loadFile(file);
    });
    el<HTMLButtonElement>('#city-demo').addEventListener('click', () => {
      const demo = demoCityLayout();
      this.load(buildGenericStamp(demo.buildings, 'ow', demo.streets), 'Beispielstadt');
    });
    el<HTMLButtonElement>('#catalog-stamp').addEventListener('click', () => {
      const layout = catalogTestLayout();
      const bytes = buildGenericStamp(layout.buildings, 'ow', layout.streets);
      download('Katalog_Teststempel_AW', bytes);
      this.load(bytes, 'Katalog-Teststempel');
    });
    for (const input of [this.wings, this.prestige, this.institutions, this.tierMode, this.items, this.delivery, this.mail, this.reduction]) {
      input.addEventListener('change', () => this.readRules());
    }
    this.ministry.addEventListener('change', () => {
      this.fillPolicies();
      this.readRules();
    });
    this.policy.addEventListener('change', () => this.readRules());
    this.layerSelect.addEventListener('change', () => {
      this.layer = this.layerSelect.value as Layer;
      this.draw();
    });
    canvas.addEventListener('pointermove', (event) => this.hover(event));
    canvas.addEventListener('pointerdown', (event) => this.click(event));
    this.selectBox.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!button) return;
      const act = button.dataset.act;
      if (act === 'close') this.select(-1);
      else if (act === 'group') this.flipGroup(this.selected);
      else if (act === 'house') this.cycleHouse(this.selected);
    });
    canvas.addEventListener('pointerleave', () => {
      this.tip.hidden = true;
    });
    this.updateRuleInfo();
    this.updatePanel();
  }

  private fillPolicies(): void {
    const ministry = this.ministry.value as Ministry;
    const options = POLICIES.filter((p) => p.ministry === ministry);
    this.policy.innerHTML = ['<option value="none">keine</option>']
      .concat(options.map((p) => `<option value="${p.id}" title="${p.effect}">${p.name} (ab ${num(p.unlock)})</option>`))
      .join('');
    this.policy.disabled = ministry === 'none';
    if (options.some((p) => p.id === this.rules.policy)) this.policy.value = this.rules.policy;
  }

  private fillLayers(): void {
    const base: Array<[Layer, string]> = [
      ['overview', 'Übersicht'],
      ['panorama', 'Panorama'],
      ['residents', 'Einwohner (Schätzung)'],
      ['townHall', 'Rathaus-Radius'],
      ['post', 'Post-Radius'],
      ['ministry', 'Regionalministerium'],
      ['clipping', 'Handelskammer / Clipping'],
    ];
    const services = SERVICE_KINDS.map((k) => [k, `Versorgung: ${KIND_NAMES[k] ?? k}`] as [Layer, string]);
    this.layerSelect.innerHTML = [...base, ...services]
      .map(([v, label]) => `<option value="${v}">${label}</option>`)
      .join('');
  }

  private readRules(): void {
    this.rules = {
      ...this.rules,
      palaceWings: Math.max(0, Math.round(Number(this.wings.value) || 0)),
      prestige: Math.min(25, Math.max(0, Math.round(Number(this.prestige.value) || 0))),
      ministry: this.ministry.value as Ministry,
      policy: (this.policy.value || 'none') as Policy,
      welfareForInstitutions: this.institutions.checked,
      tierMode: this.tierMode.value === 'stamp' ? 'stamp' : 'groups',
      townHallItems: this.items.checked,
      deliveryGoods: this.delivery.checked,
      mail: (this.mail.value || 'all') as RuleConfig['mail'],
      consumptionReduction: Math.min(90, Math.max(0, Number(this.reduction.value) || 0)),
    };
    this.updateRuleInfo();
    this.reanalyze();
  }

  private updateRuleInfo(): void {
    const r = this.rules;
    const parts = [
      `Palast ${palaceRange(r)}`,
      `Regionalministerium ${localDepartmentRange(r)} Straßenkacheln`,
    ];
    if (r.ministry === 'welfare') parts.push(`öffentliche Gebäude +${welfareBonus(r)}`);
    const web = cityWideWebBonus(r);
    if (web) parts.push(`Kraftwerke zusätzlich +${web}`);
    this.ruleInfo.textContent = parts.join(' · ');
  }

  /**
   * Einen erzeugten Stempel (z. B. Plan) anzeigen und analysieren. `land` ist
   * die Inselmaske mit Verschiebung Maske → Stadtkachel; dann werden Landfläche
   * und Inselrand mitgezeichnet.
   */
  show(
    bytes: Uint8Array,
    name: string,
    land?: { w: number; h: number; data: Uint8Array; dx: number; dy: number },
    planned?: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>,
  ): void {
    this.pendingPlanned = planned ?? null;
    this.load(bytes, name);
    this.pendingPlanned = null;
    this.land = land ?? null;
    this.draw();
  }

  /** Summen der aktuellen Analyse (für die Statuszeile des Planers). */
  totals(): Analysis['totals'] | null {
    return this.analysis?.totals ?? null;
  }

  /** Hauptanlegestelle (Maskenkoordinaten) für die Anzeige im Plan. */
  setHarbor(point: { x: number; y: number } | null): void {
    this.harbor = point;
    this.draw();
  }

  /** Aktuelle Regeln (Palast, Items, Lieferdienst …) für den Planer. */
  currentRules(): RuleConfig {
    return { ...this.rules };
  }

  setLayer(layer: Layer): void {
    this.layer = layer;
    this.layerSelect.value = layer;
    this.draw();
  }

  canvasElement(): HTMLCanvasElement {
    return this.canvas;
  }

  private async loadFile(file: File): Promise<void> {
    this.load(new Uint8Array(await file.arrayBuffer()), file.name);
    this.fileInput.value = '';
  }

  private load(bytes: Uint8Array, name: string): void {
    this.land = null;
    this.selected = -1;
    this.selectBox.hidden = true;
    try {
      this.city = cityFromStamp(decodeStampFull(bytes));
      this.sourceName = name;
      this.edits = { houses: new Map(), groups: new Map(), planned: this.pendingPlanned ?? undefined };
      this.reanalyze();
      this.onShow();
    } catch (error) {
      this.info.textContent = `${name}: ${error instanceof Error ? error.message : 'Fehler beim Lesen'}`;
    }
  }

  private reanalyze(): void {
    if (!this.city) return;
    this.analysis = analyzeCity(this.city, this.rules, this.edits);
    this.resByIndex = new Map(this.analysis.residences.map((r) => [r.building.index, r]));
    this.nonSky = new Set(this.analysis.nonSkyscrapers);
    this.updatePanel();
    this.updateSelection();
    this.draw();
  }

  /** Auswahlfeld/Tooltip nur zeigen, solange die Plan-/Analyse-Ansicht sichtbar ist. */
  setShown(shown: boolean): void {
    if (!shown) {
      this.selectBox.hidden = true;
      this.tip.hidden = true;
    } else if (this.selected >= 0) {
      this.selectBox.hidden = false;
    }
  }

  /** Versteckt den Tooltip (z. B. beim Verschieben der Ansicht). */
  hideTip(): void {
    this.tip.hidden = true;
  }

  private select(idx: number): void {
    this.selected = idx;
    this.updateSelection();
    this.draw();
  }

  private updateSelection(): void {
    const c = this.city;
    if (!c || !this.analysis || this.selected < 0 || this.selected >= c.buildings.length) {
      this.selected = -1;
      this.selectBox.hidden = true;
      return;
    }
    const idx = this.selected;
    const r = this.resByIndex.get(idx);
    const actions: string[] = [];
    if (r && c.buildings[idx].entry.kind === 'residence') {
      if (this.analysis.groupOf.has(idx)) actions.push('<button type="button" data-act="group">Gruppe: I ↔ V tauschen</button>');
      const cur = this.edits.houses.get(idx);
      const next = cur === undefined ? 'Ingenieur' : cur === 'engineer' ? 'Investor' : 'automatisch';
      actions.push(`<button type="button" data-act="house">Nur dieses Haus: ${next}</button>`);
    }
    this.selectBox.innerHTML = `<button type="button" class="close" data-act="close" title="Auswahl aufheben">×</button>
      <div class="lines">${this.describe(idx).join('<br>')}</div>
      ${actions.length ? `<div class="actions">${actions.join('')}</div>` : ''}`;
    this.selectBox.hidden = false;
  }

  private flipGroup(idx: number): void {
    if (!this.analysis || idx < 0) return;
    const group = this.analysis.groupOf.get(idx);
    if (group === undefined) return;
    const state = this.analysis.groupState.get(group) ?? 0;
    this.edits.groups.set(group, state === 1 ? 0 : 1);
    // Geplante Stufen der Gruppe aufheben, damit der Tausch sichtbar wird.
    if (this.edits.planned) {
      for (const [house, g] of this.analysis.groupOf) if (g === group) this.edits.planned.delete(house);
    }
    this.reanalyze();
  }

  private cycleHouse(idx: number): void {
    if (idx < 0) return;
    const current = this.edits.houses.get(idx);
    if (current === undefined) this.edits.houses.set(idx, 'engineer');
    else if (current === 'engineer') this.edits.houses.set(idx, 'investor');
    else this.edits.houses.delete(idx);
    this.reanalyze();
  }

  private updatePanel(): void {
    const c = this.city;
    const a = this.analysis;
    if (!c || !a) {
      this.info.textContent = 'Kein Stadt-Stempel geladen.';
      this.stats.innerHTML = '<p class="empty">Stempel laden oder Beispielstadt öffnen.</p>';
      this.warnings.innerHTML = '';
      return;
    }
    const paved = c.roadCount ? Math.round((c.pavedCount / c.roadCount) * 100) : 0;
    this.info.textContent = `${this.sourceName}: ${num(c.buildings.length)} Gebäude · ${num(c.roadCount)} Straßenkacheln (${paved} % Pflaster) · ${c.w - 4} × ${c.h - 4}`;
    const t = a.totals;
    const rows: string[] = [
      `<div><span>Einwohner (Schätzung)</span><strong>${num(t.residents)}</strong></div>`,
      `<div><span>davon Rathaus-Items</span><strong>${num(t.itemResidents)}</strong></div>`,
      `<div><span>Hochhäuser</span><strong>${num(t.skyscrapers)}</strong></div>`,
      `<div><span>Ingenieure</span><strong>${num(t.byTier.engineer)}</strong></div>`,
      `<div><span>Investoren</span><strong>${num(t.byTier.investor)}</strong></div>`,
      `<div><span>Im Rathaus-Radius</span><strong>${pct(t.townHallShare)}</strong></div>`,
      `<div><span>Post (Produktion/Bedarf)</span><strong>${
        t.mail.need ? `${t.mail.production.toFixed(0)}/${t.mail.need.toFixed(0)} t/min` : '–'
      }</strong></div>`,
      `<div><span>davon durch Post</span><strong>${num(t.mail.residents)}</strong></div>`,
    ];
    if (t.skyscrapers) {
      rows.push(
        `<div class="wide"><span>Panorama (Anzahl je Stärke)</span><strong class="small">${t.panorama
          .map((n, i) => (n ? `${PANORAMA_NAMES[i]} ${n}` : ''))
          .filter(Boolean)
          .join(' · ')}</strong></div>`,
      );
      for (const kind of SERVICE_KINDS) {
        const share = t.coverage[kind] ?? 0;
        const present = a.services.some((s) => s.building.entry.kind === kind);
        if (!present && share === 0) continue;
        rows.push(`<div><span>${KIND_NAMES[kind]}</span><strong>${pct(share)}</strong></div>`);
      }
    }
    this.stats.innerHTML = rows.join('');
    this.warnings.innerHTML = a.warnings.length
      ? a.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')
      : '<li class="ok">Keine Regelverstöße gefunden.</li>';
  }

  /** Zeichnet die Stadt; nur aktiv, wenn der Modus sichtbar ist. */
  draw(): void {
    if (!this.isActive()) return;
    const canvas = this.canvas;
    const parent = canvas.parentElement;
    if (!parent) return;
    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
    if (cw < 20 || ch < 20) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#071018';
    ctx.fillRect(0, 0, cw, ch);

    const c = this.city;
    const a = this.analysis;
    if (!c || !a) {
      this.view = null;
      ctx.fillStyle = 'rgba(230,237,243,0.6)';
      ctx.font = '600 14px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Stadt-Stempel laden oder Beispielstadt öffnen', cw / 2, ch / 2);
      ctx.textAlign = 'left';
      return;
    }

    const pad = 30;
    const baseScale = Math.min((cw - pad * 2) / c.w, (ch - pad * 2) / c.h);
    const { scale, ox, oy } = this.camera.apply(
      { scale: baseScale, ox: (cw - c.w * baseScale) / 2, oy: (ch - c.h * baseScale) / 2 },
      cw,
      ch,
    );
    this.view = { scale, ox, oy };
    // Sichtbarer Kachelbereich (nur das zeichnen, was im Bild liegt).
    const vis = {
      x0: Math.floor(-ox / scale) - 1,
      y0: Math.floor(-oy / scale) - 1,
      x1: Math.ceil((cw - ox) / scale) + 1,
      y1: Math.ceil((ch - oy) / scale) + 1,
    };

    if (this.land) this.drawLand(ctx, this.land, scale, ox, oy, vis);

    // Straßen; bei Versorgungs-/Ministeriumsebene erreichte Straßen hervorheben.
    const reached = this.reachedRoads(c, a);
    const cover = this.selectionCover(c, a);
    for (let y = Math.max(0, vis.y0); y < Math.min(c.h, vis.y1); y++) {
      for (let x = Math.max(0, vis.x0); x < Math.min(c.w, vis.x1); x++) {
        const i = y * c.w + x;
        if (!c.road[i]) continue;
        ctx.fillStyle = cover?.roads[i]
          ? 'rgba(143, 211, 255, 0.9)'
          : reached?.[i]
            ? 'rgba(90, 190, 110, 0.85)'
            : c.road[i] === 1010035
              ? '#4a5560'
              : '#5a4f3f';
        ctx.fillRect(ox + x * scale, oy + y * scale, scale + 0.3, scale + 0.3);
      }
    }

    // Radius des angewählten Gebäudes: Fläche leicht aufhellen, Linie folgt nach den Gebäuden.
    const sel = this.selected >= 0 ? c.buildings[this.selected] : null;
    const selRadius = sel?.entry.radius ?? 0;
    // Bei Radius-Gebäuden: Mittelpunkt im Kreis; bei öffentlichen Gebäuden mit
    // Straßenreichweite: Wohnhäuser, die über die Straße erreicht werden.
    const inSelRadius = (b: CityBuilding): boolean => {
      if (!sel || b === sel) return true;
      if (cover) return b.entry.kind !== 'residence' || cover.houses.has(b.index);
      return !selRadius || Math.hypot(b.cx - sel.cx, b.cy - sel.cy) <= selRadius + 1e-9;
    };
    if (sel && selRadius) {
      ctx.beginPath();
      ctx.arc(ox + (sel.cx + 0.5) * scale, oy + (sel.cy + 0.5) * scale, selRadius * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fill();
    }

    // Kreisradien für Rathaus/Post
    if (this.layer === 'townHall' || this.layer === 'post' || this.layer === 'clipping') {
      const kinds =
        this.layer === 'townHall' ? ['townHall'] : this.layer === 'clipping' ? ['tradeUnion'] : ['postOffice', 'postBox'];
      for (const b of c.buildings) {
        if (!kinds.includes(b.entry.kind) || !b.entry.radius) continue;
        ctx.beginPath();
        ctx.arc(ox + (b.cx + 0.5) * scale, oy + (b.cy + 0.5) * scale, b.entry.radius * scale, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(111, 159, 224, 0.16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(111, 159, 224, 0.8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // Gebäude
    for (const b of c.buildings) {
      if (b.x + b.w < vis.x0 || b.y + b.h < vis.y0 || b.x > vis.x1 || b.y > vis.y1) continue;
      const x = ox + b.x * scale;
      const y = oy + b.y * scale;
      const w = b.w * scale;
      const h = b.h * scale;
      // Gebäude außerhalb des Radius der Auswahl abdunkeln.
      ctx.globalAlpha = inSelRadius(b) ? 1 : 0.28;
      ctx.fillStyle = this.fillFor(b);
      ctx.fillRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (this.isHighlighted(b, a)) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
      const detail = scale * Math.min(b.w, b.h) >= 42 ? this.detailFor(b) : null;
      const label = this.labelFor(b);
      if (detail) {
        this.drawDetail(ctx, detail, x, y, w, h, scale);
      } else if (label && scale * Math.min(b.w, b.h) >= 14) {
        ctx.fillStyle = 'rgba(8, 15, 22, 0.9)';
        ctx.font = `700 ${Math.max(8, Math.min(13, scale * 1.2))}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + w / 2, y + h / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    }

    ctx.globalAlpha = 1;
    if (sel && selRadius) {
      const cx = ox + (sel.cx + 0.5) * scale;
      const cy = oy + (sel.cy + 0.5) * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, selRadius * scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Beschriftung am oberen Kreisrand
      const label = `Radius ${selRadius}`;
      ctx.font = '700 12px ui-sans-serif, system-ui';
      const tw = ctx.measureText(label).width;
      const ly = cy - selRadius * scale;
      ctx.fillStyle = 'rgba(6, 15, 22, 0.92)';
      ctx.fillRect(cx - tw / 2 - 6, ly - 10, tw + 12, 20);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - tw / 2 - 6 + 0.5, ly - 10 + 0.5, tw + 11, 19);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, ly);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    if (this.harbor && this.land) {
      drawAnchor(ctx, ox + (this.harbor.x + this.land.dx + 0.5) * scale, oy + (this.harbor.y + this.land.dy + 0.5) * scale);
    }
    if (sel) {
      ctx.strokeStyle = '#f0d79a';
      ctx.lineWidth = Math.max(2, Math.min(4, scale * 0.25));
      ctx.strokeRect(ox + sel.x * scale - 1, oy + sel.y * scale - 1, sel.w * scale + 2, sel.h * scale + 2);
    }

    ctx.font = '600 13px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(230, 237, 243, 0.72)';
    ctx.fillText(`${this.sourceName} · ${num(a.totals.residents)} Einwohner (Schätzung)`, 16, 24);
    if (!this.camera.isDefault) {
      ctx.font = '500 11px ui-sans-serif, system-ui';
      ctx.fillStyle = 'rgba(230, 237, 243, 0.5)';
      ctx.fillText(`Zoom ${Math.round(this.camera.zoom * 100)} %`, 16, 42);
    }
  }

  /** Mehrzeilige Beschriftung bei starkem Zoom: Titel + Kennzahlen. */
  private detailFor(b: CityBuilding): { title: string; lines: string[] } | null {
    const r = this.resByIndex.get(b.index);
    if (r) {
      const tier =
        r.tier === 'engineer' ? 'Ingenieur' : r.tier === 'investor' ? `Investor ${r.level}` : 'Handwerker';
      const lines = [`≈ ${r.residents} EW`];
      if (r.tier !== 'artisan') lines.push(`Panorama ${r.panorama}`);
      lines.push(r.townHall !== null ? 'im RH-Radius' : 'ohne Rathaus');
      return { title: tier, lines };
    }
    const label = this.labelFor(b);
    const s = this.analysis?.services.find((x) => x.building === b);
    const lines: string[] = [];
    if (s) lines.push(`Reichw. ${s.range}`, `${s.covers} Häuser`);
    else if (b.entry.radius) lines.push(`Radius ${b.entry.radius}`);
    return { title: label || b.entry.name, lines };
  }

  private drawDetail(
    ctx: CanvasRenderingContext2D,
    d: { title: string; lines: string[] },
    x: number,
    y: number,
    w: number,
    h: number,
    scale: number,
  ): void {
    const size = Math.max(9, Math.min(14, scale * 0.75));
    const small = Math.max(8, size - 2);
    const rows = 1 + d.lines.length;
    const lineH = small * 1.25;
    const total = size * 1.25 + (rows - 1) * lineH;
    const maxRows = Math.max(1, Math.floor((h - 4 - size * 1.25) / lineH) + 1);
    let cy = y + h / 2 - Math.min(total, h - 4) / 2 + size * 0.65;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(8, 15, 22, 0.92)';
    ctx.font = `700 ${size}px ui-sans-serif, system-ui`;
    ctx.fillText(d.title, x + w / 2, cy, w - 4);
    ctx.font = `600 ${small}px ui-sans-serif, system-ui`;
    cy += size * 0.65 + lineH * 0.55;
    for (const line of d.lines.slice(0, maxRows - 1)) {
      ctx.fillText(line, x + w / 2, cy, w - 4);
      cy += lineH;
    }
    ctx.restore();
  }

  /** Landfläche leicht hinterlegen und den Inselrand (Land/Wasser-Kante) als Linie ziehen. */
  private drawLand(
    ctx: CanvasRenderingContext2D,
    land: { w: number; h: number; data: Uint8Array; dx: number; dy: number },
    scale: number,
    ox: number,
    oy: number,
    vis: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const { w, h, data, dx, dy } = land;
    const xa = Math.max(0, vis.x0 - dx);
    const xb = Math.min(w, vis.x1 - dx);
    const ya = Math.max(0, vis.y0 - dy);
    const yb = Math.min(h, vis.y1 - dy);
    const isLand = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
    ctx.fillStyle = '#132230';
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        if (data[y * w + x]) ctx.fillRect(ox + (x + dx) * scale, oy + (y + dy) * scale, scale + 0.3, scale + 0.3);
      }
    }
    ctx.beginPath();
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        if (!data[y * w + x]) continue;
        const px = ox + (x + dx) * scale;
        const py = oy + (y + dy) * scale;
        if (!isLand(x, y - 1)) {
          ctx.moveTo(px, py);
          ctx.lineTo(px + scale, py);
        }
        if (!isLand(x, y + 1)) {
          ctx.moveTo(px, py + scale);
          ctx.lineTo(px + scale, py + scale);
        }
        if (!isLand(x - 1, y)) {
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + scale);
        }
        if (!isLand(x + 1, y)) {
          ctx.moveTo(px + scale, py);
          ctx.lineTo(px + scale, py + scale);
        }
      }
    }
    ctx.strokeStyle = 'rgba(214, 186, 120, 0.95)';
    ctx.lineWidth = Math.max(1.2, Math.min(2.5, scale * 0.35));
    ctx.stroke();
  }

  /** Straßen und Wohnhäuser in Reichweite des angewählten öffentlichen Gebäudes. */
  private selectionCover(c: City, a: Analysis): { roads: Uint8Array; houses: Set<number> } | null {
    if (this.selected < 0) return null;
    if (this.selCover && this.selCover.idx === this.selected && this.selCover.analysis === a) return this.selCover;
    const b = c.buildings[this.selected];
    const info = a.services.find((x) => x.building === b);
    if (!info || !info.hasRoad) return null;
    const search = new RoadSearch(c);
    search.run(adjacentRoads(c, b), info.range);
    const roads = new Uint8Array(c.w * c.h);
    for (let i = 0; i < roads.length; i++) if (search.distance(i)) roads[i] = 1;
    const houses = new Set<number>();
    for (const r of a.residences) if (search.reaches(adjacentRoads(c, r.building))) houses.add(r.building.index);
    this.selCover = { idx: this.selected, analysis: a, roads, houses };
    return this.selCover;
  }

  private reachedRoads(c: City, a: Analysis): Uint8Array | null {
    if (this.layer === 'ministry') return a.ministryRoads;
    if (!SERVICE_KINDS.includes(this.layer as BuildingKind)) return null;
    const out = new Uint8Array(c.w * c.h);
    const search = new RoadSearch(c);
    for (const s of a.services) {
      if (s.building.entry.kind !== this.layer) continue;
      search.run(adjacentRoads(c, s.building), s.range);
      for (let i = 0; i < out.length; i++) if (search.distance(i)) out[i] = 1;
    }
    return out;
  }

  private fillFor(b: CityBuilding): string {
    const r = this.resByIndex.get(b.index);
    if (!r) {
      if (this.layer === 'clipping' && this.analysis) {
        const hits = this.analysis.tradeUnionHits.get(b.index) ?? 0;
        if (hits >= 2) return 'rgba(80, 200, 110, 0.95)';
        if (hits === 1) return 'rgba(200, 180, 80, 0.9)';
        if (b.entry.kind === 'tradeUnion') return KIND_COLORS.tradeUnion ?? '#7cc48a';
        return 'rgba(90, 102, 112, 0.55)';
      }
      if (this.layer !== 'overview' && this.layer !== b.entry.kind) return 'rgba(90, 102, 112, 0.55)';
      return KIND_COLORS[b.entry.kind] ?? '#5a6670';
    }
    const good = 'rgba(80, 180, 100, 0.95)';
    const bad = 'rgba(210, 80, 70, 0.95)';
    switch (this.layer) {
      case 'overview':
        return tierColor(r);
      case 'panorama': {
        if (r.tier === 'artisan') return TIER_COLORS.artisan;
        const t = r.panorama / 5;
        return `hsl(${Math.round(t * 120)}, 55%, ${40 + t * 8}%)`;
      }
      case 'residents': {
        const max = r.tier === 'investor' ? 250 : r.tier === 'engineer' ? 200 : 30;
        const t = Math.min(1, r.residents / max);
        return `hsl(${Math.round(t * 120)}, 55%, 45%)`;
      }
      case 'townHall':
        return r.townHall !== null ? good : bad;
      case 'post':
        return r.post !== null ? good : bad;
      case 'ministry':
        return tierColor(r);
      default:
        return r.services[this.layer as BuildingKind] ? good : bad;
    }
  }

  private isHighlighted(b: CityBuilding, a: Analysis): boolean {
    if (this.layer === 'ministry') {
      return b.entry.kind === 'localDepartment' || a.services.some((s) => s.building === b && s.inMinistry);
    }
    return this.layer === b.entry.kind;
  }

  private labelFor(b: CityBuilding): string {
    const r = this.resByIndex.get(b.index);
    if (!r && b.entry.kind === 'residence') return '–';
    if (r) {
      if (this.layer === 'panorama' && r.tier !== 'artisan') return String(r.panorama);
      if (this.layer === 'residents') return String(r.residents);
      return r.tier === 'engineer' ? 'I' : r.tier === 'investor' ? (r.level > 3 ? `V${r.level}` : 'V') : 'H';
    }
    const short: Partial<Record<BuildingKind, string>> = {
      townHall: 'RH',
      tradeUnion: 'HK',
      departmentStore: 'KH',
      furnitureStore: 'EH',
      drugStore: 'DR',
      university: 'UNI',
      bank: 'BK',
      varietyTheatre: 'VT',
      membersClub: 'CL',
      powerPlant: 'KW',
      fireStation: 'FW',
      policeStation: 'PO',
      hospital: 'HO',
      postOffice: 'PA',
      postBox: 'B',
      airport: 'LH',
      airportModule: 'M',
      localDepartment: 'RM',
      warehouse: 'LG',
      production: 'P',
    };
    return short[b.entry.kind] ?? '';
  }

  /** Gebäudeindex unter dem Mauszeiger, −1 = keiner. */
  private buildingAt(event: PointerEvent): { idx: number; px: number; py: number } {
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const c = this.city;
    if (!c || !this.view) return { idx: -1, px, py };
    const tx = Math.floor((px - this.view.ox) / this.view.scale);
    const ty = Math.floor((py - this.view.oy) / this.view.scale);
    if (tx < 0 || ty < 0 || tx >= c.w || ty >= c.h) return { idx: -1, px, py };
    return { idx: c.occ[ty * c.w + tx] - 1, px, py };
  }

  /**
   * Klick wählt ein Gebäude an (Infofeld). Umschalt+Klick: einzelnes Haus
   * Ingenieur → Investor → automatisch; Strg/⌘+Klick: ganze Gruppe tauschen.
   */
  private click(event: PointerEvent): void {
    if (event.button !== 0 || !this.isActive() || !this.city || !this.analysis) return;
    const { idx } = this.buildingAt(event);
    const residence = idx >= 0 && this.city.buildings[idx].entry.kind === 'residence';
    if (residence && event.shiftKey) {
      this.cycleHouse(idx);
      this.select(idx);
    } else if (residence && (event.ctrlKey || event.metaKey)) {
      this.flipGroup(idx);
      this.select(idx);
    } else {
      this.select(idx === this.selected ? -1 : idx);
    }
    this.hover(event);
  }

  /** Infozeilen (HTML) zu einem Gebäude – für Tooltip und Auswahlfeld. */
  private describe(idx: number): string[] {
    const c = this.city;
    const a = this.analysis;
    if (!c || !a) return [];
    const b = c.buildings[idx];
    const lines = [`<strong>${escapeHtml(b.entry.name)}</strong> · ${b.w}×${b.h}`];
    const r = this.resByIndex.get(idx);
    if (r) {
      if (r.building.entry.tier !== r.tier) {
        const label = r.tier === 'engineer' ? 'Ingenieur' : r.tier === 'investor' ? 'Investor' : 'Handwerker';
        lines.push(`gerechnet als ${label}-Hochhaus Stufe ${r.level}`);
      } else if (r.tier !== 'artisan') {
        lines.push(`Hochhaus Stufe ${r.level}`);
      }
      if (r.tier !== 'artisan') {
        const p = r.panoramaParts;
        lines.push(`Panorama: ${PANORAMA_NAMES[r.panorama]} (Wert ${r.panoramaValue})`);
        lines.push(
          `<span class="muted">Stufe ${r.level} · niedrigere +${p.lower} · gleich hohe/höhere ${p.sameOrHigher} · Variety +${p.variety}</span>`,
        );
      }
      const group = a.groupOf.get(idx);
      if (this.edits.houses.has(idx)) lines.push('<span class="muted">Haus manuell festgelegt</span>');
      else if (group !== undefined && this.edits.groups.has(group)) {
        lines.push('<span class="muted">Gruppe manuell ausgerichtet</span>');
      }
      lines.push(
        `Einwohner ≈ ${r.residents}${r.itemBonus ? ` (davon Rathaus-Items +${r.itemBonus})` : ''}${
          r.hasRoad ? '' : ' – kein Straßenanschluss!'
        }`,
      );
      if (r.missing.length) {
        const names = r.missing.map((k) =>
          k === 'university' && r.universityFactor > 0
            ? `Universität (nur ${Math.round(r.universityFactor * 100)} %)`
            : (KIND_NAMES[k] ?? k),
        );
        lines.push(`Fehlt: ${names.join(', ')}`);
      }
      if (r.missingGoods.length) lines.push(`Ohne Lieferdienst-Ware: ${r.missingGoods.join(', ')}`);
      if (r.mailBonus) lines.push(`Post: +${r.mailBonus} Einwohner (inselweit)`);
      lines.push(`Rathaus: ${r.townHall !== null ? 'ja' : 'nein'} · Post: ${r.post !== null ? 'ja' : 'nein'}`);
    }
    if (!r && this.nonSky.has(idx)) lines.push('ohne Schicht im Stempel');
    const s = a.services.find((x) => x.building === b);
    if (s) {
      const bonus = s.range - s.baseRange;
      lines.push(`Reichweite ${s.range}${bonus ? ` (${s.baseRange} + ${bonus})` : ''} · versorgt ${s.covers} Häuser`);
      if (idx === this.selected) {
        lines.push('<span class="muted">Hellblau: erreichte Straßen · abgedunkelt: Häuser außerhalb der Reichweite</span>');
      }
      lines.push(`Im Ministeriumsbereich: ${s.inMinistry ? 'ja' : 'nein'}`);
      if (s.warehouseInRange !== null) lines.push(`Lager in Reichweite: ${s.warehouseInRange ? 'ja' : 'nein'}`);
    }
    if (b.entry.radius) {
      const radius = b.entry.radius;
      const inside = a.residences.filter(
        (r) => Math.hypot(r.building.cx - b.cx, r.building.cy - b.cy) <= radius + 1e-9,
      ).length;
      lines.push(`Radius ${radius} · ${inside} Wohnhäuser darin`);
    }
    const hits = a.tradeUnionHits.get(idx);
    if (hits) lines.push(hits >= 2 ? `Geclippt: ${hits} Handelskammern` : '1 Handelskammer wirkt');
    lines.push(`<span class="muted">GUID ${b.guid}</span>`);
    return lines;
  }

  private hover(event: PointerEvent): void {
    if (!this.isActive() || !this.city || !this.analysis || !this.view) {
      this.tip.hidden = true;
      return;
    }
    const { idx, px, py } = this.buildingAt(event);
    if (idx < 0 || idx === this.selected) {
      this.tip.hidden = true;
      return;
    }
    const lines = this.describe(idx);
    this.tip.innerHTML = lines.join('<br>');
    this.tip.hidden = false;
    const stageRect = this.canvas.parentElement?.getBoundingClientRect();
    const left = px + 16 + 260 > (stageRect?.width ?? 0) ? px - 270 : px + 16;
    this.tip.style.left = `${Math.max(8, left)}px`;
    this.tip.style.top = `${Math.max(8, py + 12)}px`;
  }
}

/** Markierung der Hauptanlegestelle (Kreis mit Anker). */
export function drawAnchor(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(6, 15, 22, 0.9)';
  ctx.fill();
  ctx.strokeStyle = '#7fd0ff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#7fd0ff';
  ctx.font = '700 13px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚓', x, y + 0.5);
  ctx.restore();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function download(name: string, data: Uint8Array): void {
  const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
