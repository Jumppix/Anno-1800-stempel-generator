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

  private readonly fileInput = el<HTMLInputElement>('#city-file');
  private readonly info = el<HTMLElement>('#city-info');
  private readonly wings = el<HTMLInputElement>('#rule-wings');
  private readonly prestige = el<HTMLInputElement>('#rule-prestige');
  private readonly ministry = el<HTMLSelectElement>('#rule-ministry');
  private readonly policy = el<HTMLSelectElement>('#rule-policy');
  private readonly institutions = el<HTMLInputElement>('#rule-institutions');
  private readonly ruleInfo = el<HTMLElement>('#rule-info');
  private readonly layerSelect = el<HTMLSelectElement>('#city-layer');
  private readonly tierMode = el<HTMLSelectElement>('#rule-tiers');
  private edits: TierEdits = { houses: new Map(), groups: new Map() };
  private nonSky = new Set<number>();
  private readonly stats = el<HTMLElement>('#city-stats');
  private readonly warnings = el<HTMLElement>('#city-warnings');
  private readonly tip = el<HTMLElement>('#city-tip');

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly isActive: () => boolean,
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
    for (const input of [this.wings, this.prestige, this.institutions, this.tierMode]) {
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

  private async loadFile(file: File): Promise<void> {
    this.load(new Uint8Array(await file.arrayBuffer()), file.name);
    this.fileInput.value = '';
  }

  private load(bytes: Uint8Array, name: string): void {
    try {
      this.city = cityFromStamp(decodeStampFull(bytes));
      this.sourceName = name;
      this.edits = { houses: new Map(), groups: new Map() };
      this.reanalyze();
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
    this.draw();
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
      `<div><span>Hochhäuser</span><strong>${num(t.skyscrapers)}</strong></div>`,
      `<div><span>Ingenieure</span><strong>${num(t.byTier.engineer)}</strong></div>`,
      `<div><span>Investoren</span><strong>${num(t.byTier.investor)}</strong></div>`,
      `<div><span>Im Rathaus-Radius</span><strong>${pct(t.townHallShare)}</strong></div>`,
      `<div><span>Im Post-Radius</span><strong>${pct(t.postShare)}</strong></div>`,
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
    const scale = Math.min((cw - pad * 2) / c.w, (ch - pad * 2) / c.h);
    const ox = (cw - c.w * scale) / 2;
    const oy = (ch - c.h * scale) / 2;
    this.view = { scale, ox, oy };

    // Straßen; bei Versorgungs-/Ministeriumsebene erreichte Straßen hervorheben.
    const reached = this.reachedRoads(c, a);
    for (let i = 0; i < c.road.length; i++) {
      if (!c.road[i]) continue;
      const x = i % c.w;
      const y = (i - x) / c.w;
      ctx.fillStyle = reached?.[i] ? 'rgba(90, 190, 110, 0.85)' : c.road[i] === 1010035 ? '#4a5560' : '#5a4f3f';
      ctx.fillRect(ox + x * scale, oy + y * scale, scale + 0.3, scale + 0.3);
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
      const x = ox + b.x * scale;
      const y = oy + b.y * scale;
      const w = b.w * scale;
      const h = b.h * scale;
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
      const label = this.labelFor(b);
      if (label && scale * Math.min(b.w, b.h) >= 14) {
        ctx.fillStyle = 'rgba(8, 15, 22, 0.9)';
        ctx.font = `700 ${Math.max(8, Math.min(13, scale * 1.2))}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + w / 2, y + h / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    }

    ctx.font = '600 13px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(230, 237, 243, 0.72)';
    ctx.fillText(`${this.sourceName} · ${num(a.totals.residents)} Einwohner (Schätzung)`, 16, 24);
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
        return TIER_COLORS[r.tier];
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
        return TIER_COLORS[r.tier];
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
      return r.tier === 'engineer' ? 'I' : r.tier === 'investor' ? 'V' : 'H';
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
   * Klick auf ein Wohnhaus: Ingenieure/Investoren der ganzen Gruppe tauschen.
   * Umschalt+Klick: einzelnes Haus Ingenieur → Investor → automatisch.
   */
  private click(event: PointerEvent): void {
    if (!this.isActive() || !this.city || !this.analysis) return;
    const { idx } = this.buildingAt(event);
    if (idx < 0 || this.city.buildings[idx].entry.kind !== 'residence') return;
    if (event.shiftKey) {
      const current = this.edits.houses.get(idx);
      if (current === undefined) this.edits.houses.set(idx, 'engineer');
      else if (current === 'engineer') this.edits.houses.set(idx, 'investor');
      else this.edits.houses.delete(idx);
    } else {
      const group = this.analysis.groupOf.get(idx);
      if (group === undefined) return;
      const state = this.analysis.groupState.get(group) ?? 0;
      this.edits.groups.set(group, state === 1 ? 0 : 1);
    }
    this.reanalyze();
    this.hover(event);
  }

  private hover(event: PointerEvent): void {
    if (!this.isActive() || !this.city || !this.analysis || !this.view) {
      this.tip.hidden = true;
      return;
    }
    const c = this.city;
    const { idx, px, py } = this.buildingAt(event);
    if (idx < 0) {
      this.tip.hidden = true;
      return;
    }
    const b = c.buildings[idx];
    const lines = [`<strong>${escapeHtml(b.entry.name)}</strong> · ${b.w}×${b.h}`];
    const r = this.resByIndex.get(idx);
    if (r) {
      if (r.building.entry.tier !== r.tier) {
        const label = r.tier === 'engineer' ? 'Ingenieur' : r.tier === 'investor' ? 'Investor' : 'Handwerker';
        lines.push(`gerechnet als ${label}-Hochhaus Stufe 3`);
      }
      if (r.tier !== 'artisan') {
        const p = r.panoramaParts;
        lines.push(`Panorama: ${PANORAMA_NAMES[r.panorama]} (Wert ${r.panoramaValue})`);
        lines.push(
          `<span class="muted">Stufe ${this.rules.skyscraperLevel} · kleinere +${p.lower} · gleich hohe ${p.sameOrHigher} · Variety +${p.variety}</span>`,
        );
      }
      const group = this.analysis.groupOf.get(idx);
      if (this.edits.houses.has(idx)) lines.push('<span class="muted">Haus manuell festgelegt</span>');
      else if (group !== undefined && this.edits.groups.has(group)) {
        lines.push('<span class="muted">Gruppe manuell ausgerichtet</span>');
      }
      lines.push(`Einwohner ≈ ${r.residents}${r.hasRoad ? '' : ' – kein Straßenanschluss!'}`);
      if (r.missing.length) {
        lines.push(`Fehlt: ${r.missing.map((k) => KIND_NAMES[k] ?? k).join(', ')}`);
      }
      lines.push(`Rathaus: ${r.townHall !== null ? 'ja' : 'nein'} · Post: ${r.post !== null ? 'ja' : 'nein'}`);
    }
    if (!r && this.nonSky.has(idx)) lines.push('ohne Schicht im Stempel');
    const s = this.analysis.services.find((x) => x.building === b);
    if (s) {
      const bonus = s.range - s.baseRange;
      lines.push(`Reichweite ${s.range}${bonus ? ` (${s.baseRange} + ${bonus})` : ''} · versorgt ${s.covers} Häuser`);
      lines.push(`Im Ministeriumsbereich: ${s.inMinistry ? 'ja' : 'nein'}`);
      if (s.warehouseInRange !== null) lines.push(`Lager in Reichweite: ${s.warehouseInRange ? 'ja' : 'nein'}`);
    }
    if (b.entry.radius) lines.push(`Radius ${b.entry.radius}`);
    const hits = this.analysis.tradeUnionHits.get(idx);
    if (hits) lines.push(hits >= 2 ? `Geclippt: ${hits} Handelskammern` : '1 Handelskammer wirkt');
    lines.push(`<span class="muted">GUID ${b.guid}</span>`);
    this.tip.innerHTML = lines.join('<br>');
    this.tip.hidden = false;
    const stageRect = this.canvas.parentElement?.getBoundingClientRect();
    const left = px + 16 + 260 > (stageRect?.width ?? 0) ? px - 270 : px + 16;
    this.tip.style.left = `${Math.max(8, left)}px`;
    this.tip.style.top = `${Math.max(8, py + 12)}px`;
  }
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
