// Oberfläche „Wohnraster planen“ (Stadtplaner Phase 2). Nutzt die geladene
// Inselform (in beiden Modi dieselbe), plant Raster + Rathäuser und zeigt das Ergebnis
// in der Stadt-Ansicht (CityUi) mit allen Analyse-Ebenen.

import { CITY_PAD } from './city';
import type { CityUi } from './cityUi';
import { editCity, editTargetAt, freeTiles, planToStampItems, splitBands, type CityPlan, type Orientation } from './planner';
import type { PassInput, PassResult } from './pipeline';
import type { PipelineJob, PipelineMessage } from './pipeline.worker';
import type { LandMask } from './solver';
import { buildGenericStamp } from './stamp';
import type { PlannerJob, PlannerMessage } from './planner.worker';
import { CLIPPABLE, lookup, type BuildingKind } from './catalog';
import type { ProductionRequest } from './production';
import type { LevelMode } from './levels';
import { cityWideWebBonus, hasMinistry, hasPolicy, localDepartmentRange, ministryReach, welfareBonus, type RuleConfig } from './rules';
import {
  BEST_MUSEUM_SET,
  DELTA_SET,
  MUSEUM_MAX_MODULES,
  PALACE_ATTR,
  PRIVATE_COLLECTION_ATTR,
  PRIVATE_COLLECTIONS_DECREE,
  TOWN_HALL_REFORM_ATTR,
  WING_ATTR,
} from './attractiveness';
import { getPalaceSettings, setPalaceSettings } from './palaceSettings';

/** Palastinsel-Variante eines Durchlaufs. */
interface PalaceVariant {
  wings: number;
  reform?: 'townHallReform' | 'freethinkers';
}
import type { PostReport } from './post';
import type { ServiceOptions } from './services';
import { kontorBack, type KontorFound } from './harbor';

const SERVICE_KINDS_UI: BuildingKind[] = [
  'departmentStore',
  'furnitureStore',
  'drugStore',
  'university',
  'powerPlant',
  'fireStation',
  'policeStation',
  'hospital',
  'bank',
  'varietyTheatre',
  'membersClub',
];

/** Fertiger Plan mit Insel und geplanten Hochhaus-Stufen. */
interface PlanResult {
  city: CityPlan;
  mask: LandMask;
  streetGuid: number;
  planned?: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>;
}

export interface IslandSource {
  mask: LandMask;
  streetGuid: number;
  label: string;
  /** Erkanntes Kontor (Lücke im Hafengebiet des Stempels), Maskenkoordinaten. */
  kontor?: KontorFound | null;
  /** Verschiebbare Vorkommen aus dem Stempel (Blaupausen). */
  deposits?: { clay: number; oil: number };
}

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

const num = (v: number): string => v.toLocaleString('de-DE');

function download(name: string, data: Uint8Array | Blob): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Geplante Stufen aus dem Worker-Format [Index, 0/1, Stufe]. */
function toPlanned(list: ReadonlyArray<[number, number, number]>): Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }> {
  return new Map(list.map(([idx, t, l]) => [idx, { tier: t === 0 ? 'engineer' : 'investor', level: l as 3 | 4 | 5 }]));
}

/** Anzahl Brücken = zusammenhängende Gruppen von Brückenkacheln. */
function countBridges(tiles: readonly number[], w: number): number {
  const set = new Set(tiles);
  const seen = new Set<number>();
  let n = 0;
  for (const t of tiles) {
    if (seen.has(t)) continue;
    n++;
    const stack = [t];
    seen.add(t);
    while (stack.length) {
      const i = stack.pop() as number;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (set.has(j) && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
  }
  return n;
}

/**
 * Ladeanzeige: eine Spur je Durchlauf (Schritt x/y nach geschätzter Dauer),
 * Gesamtbalken, Zeit und Details – in der Leiste und groß über dem Bild.
 */
interface Track {
  label: string;
  steps: Array<{ label: string; est: number }>;
  cur: number;
  stepStart: number;
  detail: string;
  done?: string;
}

class Progress {
  private tracks: Track[] = [];
  private started = 0;
  private timer = 0;
  private readonly boxes = [el<HTMLElement>('#plan-progress'), el<HTMLElement>('#stage-progress')];

  /** Eine Spur (z. B. „Stufen & Post neu berechnen“). */
  start(steps: Array<{ label: string; est: number }>, label = ''): void {
    this.startTracks([{ label, steps }]);
  }

  startTracks(tracks: Array<{ label: string; steps: Array<{ label: string; est: number }> }>): void {
    this.tracks = tracks.map((t) => ({ ...t, cur: -1, stepStart: 0, detail: '' }));
    this.started = performance.now();
    for (const b of this.boxes) b.hidden = false;
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.render(), 300);
    this.render();
  }

  /** Nächsten Schritt mit diesem Namen beginnen (Schritte dürfen fehlen). */
  step(label: string, detail = '', track = 0): void {
    const t = this.tracks[track];
    if (!t) return;
    const i = t.steps.findIndex((st, k) => k > t.cur && st.label === label);
    if (i >= 0) t.cur = i;
    t.stepStart = performance.now();
    t.detail = detail;
    this.render();
  }

  detail(text: string, track = 0): void {
    const t = this.tracks[track];
    if (t) t.detail = text;
  }

  done(track: number, text: string): void {
    const t = this.tracks[track];
    if (t) t.done = text;
    this.render();
  }

  finish(): void {
    clearInterval(this.timer);
    for (const b of this.boxes) b.hidden = true;
  }

  private fraction(t: Track): number {
    if (t.done) return 1;
    if (t.cur < 0) return 0;
    const total = t.steps.reduce((a, st) => a + st.est, 0);
    let done = 0;
    for (let k = 0; k < t.cur; k++) done += t.steps[k].est;
    done += Math.min(performance.now() - t.stepStart, t.steps[t.cur].est * 0.95);
    return Math.min(0.99, done / total);
  }

  private render(): void {
    if (!this.tracks.length) return;
    const frac = Math.min(0.99, this.tracks.reduce((a, t) => a + this.fraction(t), 0) / this.tracks.length);
    const secs = Math.round((performance.now() - this.started) / 1000);
    const stepText = (t: Track): string =>
      t.done ?? (t.cur < 0 ? 'wartet …' : `Schritt ${t.cur + 1}/${t.steps.length}: ${t.steps[t.cur].label}`);
    let title: string;
    let detail: string;
    if (this.tracks.length === 1) {
      const t = this.tracks[0];
      title = `${t.label ? `${t.label} · ` : ''}${stepText(t)} …`;
      detail = esc(t.detail);
    } else {
      const done = this.tracks.filter((t) => t.done).length;
      const running = this.tracks.filter((t) => !t.done && t.cur >= 0).length;
      title = `${this.tracks.length} Durchläufe · ${running} laufen gleichzeitig · ${done} fertig`;
      detail = this.tracks
        .map((t) => `<div class="${t.done ? 'track-done' : t.cur < 0 ? 'track-wait' : ''}">${esc(t.label)}: ${esc(stepText(t))}${t.detail && !t.done ? ` <span class="muted">(${esc(t.detail)})</span>` : ''}</div>`)
        .join('');
    }
    for (const b of this.boxes) {
      const q = <T extends HTMLElement>(sel: string): T => b.querySelector<T>(sel) as T;
      q('.progress-step').textContent = title;
      q('.progress-time').textContent = `${Math.round(frac * 100)} % · ${secs} s`;
      q<HTMLElement>('.progress-bar i').style.width = `${(frac * 100).toFixed(1)}%`;
      q('.progress-detail').innerHTML = detail;
    }
  }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class PlannerUi {
  private readonly progress = new Progress();
  private readonly islandInfo = el<HTMLElement>('#plan-island');
  private readonly orientation = el<HTMLSelectElement>('#plan-orientation');
  private readonly perLine = el<HTMLSelectElement>('#plan-line');
  private readonly townHalls = el<HTMLInputElement>('#plan-townhalls');
  private readonly minCover = el<HTMLInputElement>('#plan-mincover');
  private readonly budget = el<HTMLSelectElement>('#plan-budget');
  private readonly compactBudget = el<HTMLSelectElement>('#plan-compact');
  private readonly svcGoal = el<HTMLSelectElement>('#svc-goal');
  private readonly runButton = el<HTMLButtonElement>('#plan-run');
  private readonly status = el<HTMLElement>('#plan-status');
  private readonly exportBox = el<HTMLElement>('#plan-export');
  private readonly split = el<HTMLInputElement>('#plan-split');
  private readonly stampList = el<HTMLElement>('#plan-stamps');

  private result: PlanResult | null = null;
  private readonly levelMode = el<HTMLSelectElement>('#plan-levels');
  private stamps: Uint8Array[] = [];
  private running = false;
  private workers: Worker[] = [];
  private jobId = 0;

  private readonly harborInfo = el<HTMLElement>('#plan-harbor-info');
  private readonly prodType = el<HTMLSelectElement>('#prod-type');
  private readonly prodCount = el<HTMLInputElement>('#prod-count');
  private readonly prodList = el<HTMLElement>('#prod-list');
  private production: ProductionRequest[] = [];

  constructor(
    private readonly cityUi: CityUi,
    private readonly island: () => IslandSource | null,
    /** Startet das Wählen der Anlegestelle in der Ansicht „Anordnen“. */
    private readonly onPickHarbor: () => void = () => undefined,
  ) {
    el<HTMLButtonElement>('#plan-harbor').addEventListener('click', () => {
      this.harborInfo.textContent = 'Klicke in „Anordnen“ auf die Stelle der Hauptanlegestelle …';
      this.onPickHarbor();
    });
    this.runButton.addEventListener('click', () => void this.run());
    this.split.addEventListener('change', () => this.buildStamps());
    el<HTMLButtonElement>('#plan-image').addEventListener('click', () => this.saveImage());
    el<HTMLButtonElement>('#plan-reopt').addEventListener('click', () => void this.reoptimize());
    el<HTMLButtonElement>('#plan-undo').addEventListener('click', () => this.undo());
    el<HTMLButtonElement>('#plan-report-save').addEventListener('click', () => {
      if (this.reportText) download('Wohnraster_Bauliste.txt', new Blob([this.reportText], { type: 'text/plain;charset=utf-8' }));
    });
    this.stampList.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
      if (!button) return;
      const i = Number(button.dataset.i);
      if (this.stamps[i]) download(this.stampName(i), this.stamps[i]);
    });
    this.setupProduction();
    // Kurzinfo in den Gruppen-Überschriften aktuell halten.
    this.runButton.closest('section')?.addEventListener('change', () => this.updateSummaries());
    this.updateSummaries();
    document.addEventListener('city-rules-changed', () => this.updateSummaries());
    this.status.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('[data-adopt]') || !this.adopt) return;
      const v = this.adopt;
      const wings = el<HTMLInputElement>('#plan-wings');
      wings.value = String(v.wings);
      wings.dispatchEvent(new Event('change'));
      if (v.reform) {
        const ps = getPalaceSettings();
        setPalaceSettings({ palace: { ...ps.palace, City: v.reform === 'townHallReform' ? 269176 : 269175 } });
      }
      (e.target as HTMLElement).replaceWith(document.createTextNode('übernommen ✓'));
      this.adopt = null;
    });
    this.refreshIsland();
  }

  private updateSummaries(): void {
    const on = (id: string): boolean => el<HTMLInputElement>(id).checked;
    const main = ['departmentStore', 'furnitureStore', 'drugStore', 'university', 'powerPlant'].filter((k) => on(`#svc-${k}`)).length;
    const opt = ['fireStation', 'policeStation', 'hospital', 'bank', 'varietyTheatre', 'membersClub'].filter((k) => on(`#svc-${k}`)).length;
    const extra = [on('#plan-post') ? 'Post' : '', on('#plan-airport') ? 'Lufthafen' : '', on('#plan-ministry') ? 'Ministerium' : '']
      .filter(Boolean)
      .join(', ');
    el<HTMLElement>('#sum-svc').textContent = `${main}/5${extra ? ` · ${extra}` : ''}${opt ? ` · +${opt} opt.` : ''}`;
    const prod = this.production.filter((r) => r.count > 0);
    el<HTMLElement>('#sum-prod').textContent = prod.length
      ? prod.map((r) => `${r.count}× ${CLIPPABLE.find((c) => c.guid === r.guid)?.name ?? r.guid}`).join(', ')
      : 'keine';
    const r = this.cityUi.currentRules();
    const ministry = r.palace
      ? 'Palast (Crown Falls)'
      : r.ministry === 'welfare' ? 'Wohlfahrt' : r.ministry === 'labour' ? 'Arbeit' : r.ministry === 'city' ? 'Verwaltung' : 'ohne Ministerium';
    el<HTMLElement>('#sum-rules').textContent = `${ministry} · Zeitung −${
      el<HTMLInputElement>('#rule-reduction').value || 0
    } %`;
  }

  // --- Produktion (Clipping): Auswahl der Gebäude, gespeichert im Browser.
  private static readonly PROD_KEY = 'anno-planner-production';

  private setupProduction(): void {
    const groups = new Map<string, typeof CLIPPABLE[number][]>();
    for (const c of CLIPPABLE) {
      const list = groups.get(c.group);
      if (list) list.push(c);
      else groups.set(c.group, [c]);
    }
    this.prodType.innerHTML = [...groups]
      .map(
        ([g, list]) =>
          `<optgroup label="${g}">${list
            .map((c) => `<option value="${c.guid}">${c.name} (${c.size[1]}×${c.size[0]})</option>`)
            .join('')}</optgroup>`,
      )
      .join('');
    let saved: ProductionRequest[] | null = null;
    try {
      const raw = localStorage.getItem(PlannerUi.PROD_KEY);
      if (raw) saved = JSON.parse(raw) as ProductionRequest[];
    } catch {
      saved = null;
    }
    this.production = Array.isArray(saved)
      ? saved.filter((r) => CLIPPABLE.some((c) => c.guid === r.guid) && r.count > 0)
      : [{ guid: 1010323, count: 4 }];
    el<HTMLButtonElement>('#prod-add').addEventListener('click', () => {
      const guid = Number(this.prodType.value);
      const count = Math.max(1, Math.min(60, Math.round(Number(this.prodCount.value) || 0)));
      const known = this.production.find((r) => r.guid === guid);
      if (known) known.count += count;
      else this.production.push({ guid, count });
      this.saveProduction();
    });
    this.prodList.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-remove]');
      if (!button) return;
      this.production = this.production.filter((r) => r.guid !== Number(button.dataset.remove));
      this.saveProduction();
    });
    this.prodList.addEventListener('change', (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-count]');
      if (!input) return;
      const r = this.production.find((x) => x.guid === Number(input.dataset.count));
      if (r) r.count = Math.max(1, Math.min(60, Math.round(Number(input.value) || 1)));
      this.saveProduction();
    });
    this.renderProduction();
  }

  private saveProduction(): void {
    try {
      localStorage.setItem(PlannerUi.PROD_KEY, JSON.stringify(this.production));
    } catch {
      /* nur für diese Sitzung */
    }
    this.renderProduction();
  }

  private renderProduction(): void {
    this.prodList.innerHTML = this.production.length
      ? this.production
          .map((r) => {
            const c = CLIPPABLE.find((x) => x.guid === r.guid);
            const name = c ? `${c.name} (${c.size[1]}×${c.size[0]})` : lookup(r.guid).name;
            return `<div class="prod-row"><span title="${name}">${name}</span><input type="number" min="1" max="60" step="1" value="${r.count}" data-count="${r.guid}" aria-label="Anzahl ${name}" /><button type="button" class="ghost" data-remove="${r.guid}" title="Entfernen">✕</button></div>`;
          })
          .join('')
      : '<div class="prod-empty">Keine geclippte Produktion gewählt.</div>';
    if (this.prodList.isConnected) this.updateSummaries();
  }

  private harborKey(): string | null {
    const src = this.island();
    return src ? `anno-planner-harbor:${src.mask.w}x${src.mask.h}:${src.mask.landCount}` : null;
  }

  /** Hauptanlegestelle in Maskenkoordinaten (oder null). */
  harborPoint(): { x: number; y: number } | null {
    const key = this.harborKey();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const p = JSON.parse(raw) as { x: number; y: number };
      return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
    } catch {
      return null;
    }
  }

  setHarbor(x: number, y: number): void {
    const key = this.harborKey();
    if (key) {
      try {
        localStorage.setItem(key, JSON.stringify({ x, y }));
      } catch {
        /* ohne Speicher nur für diese Sitzung */
      }
    }
    this.sessionHarbor = { x, y };
    this.cityUi.setHarbor(this.currentHarbor());
    this.refreshIsland();
  }

  private sessionHarbor: { x: number; y: number } | null = null;

  currentHarbor(): { x: number; y: number } | null {
    return this.harborPoint() ?? this.sessionHarbor ?? this.kontorPoint();
  }

  /** Ohne gewählte Anlegestelle: Landseite des erkannten Kontors. */
  private kontorPoint(): { x: number; y: number } | null {
    const k = this.island()?.kontor;
    if (!k) return null;
    const [bx, by] = kontorBack(k)[Math.floor(kontorBack(k).length / 2)];
    return { x: bx, y: by };
  }

  /** Inselinfo aktualisieren (beim Wechsel in den Modus aufrufen). */
  refreshIsland(): void {
    const h = this.currentHarbor();
    this.harborInfo.textContent = h ? `bei ${h.x}, ${h.y}` : 'nicht gesetzt';
    const src = this.island();
    this.runButton.disabled = !src || this.running;
    this.islandInfo.textContent = src
      ? `Insel: ${src.label}`
      : 'Keine Insel geladen – oben unter „Inselform aus Stempeln“ die Feldweg-Stempel laden und im Tab „Anordnen“ ausrichten.';
  }

  /**
   * Durchläufe: die ganze Planung mehrmals mit anderer Linienlänge bzw. anderem
   * Zufall – gleichzeitig in eigenen Workern; der Plan mit den meisten
   * Einwohnern gewinnt.
   */
  /** Palastinsel: Varianten Flügel × Reform (Rathausreform / Freigeisterreform). */
  private palaceVariants(): PalaceVariant[] {
    const rules = this.cityUi.currentRules();
    if (!rules.palace || !el<HTMLInputElement>('#plan-variants').checked) return [];
    const set = Math.max(0, Math.min(rules.palaceWings, Math.round(Number(el<HTMLInputElement>('#plan-wings').value) || 0)));
    const wings = [...new Set([set, rules.palaceWings])];
    const reforms: Array<PalaceVariant['reform']> = rules.palace.ministries.includes('city') ? ['townHallReform', 'freethinkers'] : [undefined];
    return wings.flatMap((w) => reforms.map((reform) => ({ wings: w, reform })));
  }

  private passList(): Array<{ lines: number; seed: number; label: string; variant?: PalaceVariant }> {
    const variants = this.palaceVariants();
    if (variants.length) {
      const lines = Number(this.perLine.value) || 6;
      const n = Math.max(variants.length, Math.min(10, Number(el<HTMLSelectElement>('#plan-passes').value) || 1));
      const out: Array<{ lines: number; seed: number; label: string; variant?: PalaceVariant }> = [];
      for (let k = 0; out.length < n && k < 10 * variants.length; k++) {
        const v = variants[k % variants.length];
        const seed = Math.floor(k / variants.length);
        const reform = v.reform === 'townHallReform' ? 'Rathausreform' : v.reform === 'freethinkers' ? 'Freigeisterreform' : '';
        out.push({ lines, seed, variant: v, label: `${v.wings} Flügel${reform ? `, ${reform}` : ''}${seed ? ` (Variante ${seed + 1})` : ''}` });
      }
      return out;
    }
    return this.basePassList();
  }

  private basePassList(): Array<{ lines: number; seed: number; label: string }> {
    const lines = Number(this.perLine.value) || 6;
    const alt = lines === 12 ? 6 : 12;
    const third = lines === 8 ? 16 : 8;
    const all = [
      { lines, seed: 0 },
      { lines: alt, seed: 0 },
      { lines, seed: 1 },
      { lines: third, seed: 0 },
      { lines: alt, seed: 1 },
      { lines, seed: 2 },
      { lines: alt, seed: 2 },
      { lines: third, seed: 1 },
      { lines, seed: 3 },
      { lines: alt, seed: 3 },
    ];
    const n = Math.max(1, Math.min(all.length, Number(el<HTMLSelectElement>('#plan-passes').value) || 1));
    return all.slice(0, n).map((p) => ({ ...p, label: `${p.lines}er${p.seed ? ` (Variante ${p.seed + 1})` : ''}` }));
  }

  /** Geschätzte Schritte eines Durchlaufs (für die Ladeanzeige). */
  private passSteps(): Array<{ label: string; est: number }> {
    const kinds = SERVICE_KINDS_UI.filter((k) => el<HTMLInputElement>(`#svc-${k}`).checked);
    const withServices = kinds.length > 0 || this.production.some((r) => r.count > 0);
    const lvMs = Number(el<HTMLSelectElement>('#plan-levels-time').value) || 15000;
    const steps: Array<{ label: string; est: number }> = [{ label: 'Bebauung (Raster, Gittersuche)', est: 9000 }];
    if (this.townHalls.checked) steps.push({ label: 'Rathäuser optimieren', est: Number(this.budget.value) || 6000 });
    const cMs = Number(this.compactBudget.value) || 0;
    if (cMs > 0) steps.push({ label: 'Nachverdichtung', est: cMs });
    if (withServices) steps.push({ label: 'Produktion, Lufthafen & Versorgung', est: 9000 });
    steps.push({ label: 'Hochhaus-Stufen', est: lvMs });
    if (kinds.length && this.levelMode.value !== 'l3') {
      steps.push({ label: 'Versorgung an Stufen anpassen', est: 9000 }, { label: 'Hochhaus-Stufen erneut', est: lvMs });
    }
    if (withServices && (el<HTMLInputElement>('#plan-thin').checked || el<HTMLInputElement>('#plan-insert').checked)) {
      steps.push({ label: 'Querstraßen anpassen', est: 20000 }, { label: 'Hochhaus-Stufen nach Straßenanpassung', est: lvMs });
    }
    if (el<HTMLInputElement>('#plan-post').checked) steps.push({ label: 'Briefkästen', est: 3000 });
    steps.push({ label: 'Fertigstellen', est: 1500 });
    return steps;
  }

  /** Alle Einstellungen eines Durchlaufs aus der Oberfläche. */
  private passInput(src: IslandSource, lines: number, seed: number, snapshots: boolean, variant?: PalaceVariant): PassInput {
    let rules = this.cityUi.currentRules();
    if (variant?.reform && rules.palace) {
      const other = variant.reform === 'townHallReform' ? 'freethinkers' : 'townHallReform';
      const policies = rules.palace.policies.filter((p) => p !== other && p !== variant.reform);
      rules = { ...rules, palace: { ...rules.palace, policies: [...policies, variant.reform] } };
    }
    const production = this.production.some((r) => r.count > 0)
      ? { requests: this.production.map((r) => ({ ...r })), power: el<HTMLInputElement>('#prod-power').checked }
      : undefined;
    return {
      mask: src.mask,
      lines,
      seed,
      orientation: this.orientation.value as 'auto' | Orientation,
      bridgeLen: Number(el<HTMLSelectElement>('#plan-bridges').value) || 0,
      townHalls: this.townHalls.checked,
      minCover: Math.max(0, Number(this.minCover.value) || 0),
      rhBudget: Number(this.budget.value) || 6000,
      compactMs: Number(this.compactBudget.value) || 0,
      kinds: SERVICE_KINDS_UI.filter((k) => el<HTMLInputElement>(`#svc-${k}`).checked),
      goal: Number(this.svcGoal.value) || 0,
      deliveryGoods: el<HTMLInputElement>('#rule-delivery').checked,
      townHallItems: rules.townHallItems,
      ministry: this.ministryOption(rules, variant?.wings),
      culture: this.cultureOption(rules, variant?.wings),
      clay: this.clayOption(src),
      airport: el<HTMLInputElement>('#plan-airport').checked ? { harbor: this.currentHarbor() } : undefined,
      production,
      levelMode: this.levelMode.value as LevelMode,
      levelMs: Number(el<HTMLSelectElement>('#plan-levels-time').value) || 15000,
      selfWorkforce: el<HTMLInputElement>('#plan-engineers').checked,
      post: el<HTMLInputElement>('#plan-post').checked,
      insert: el<HTMLInputElement>('#plan-insert').checked,
      thin: el<HTMLInputElement>('#plan-thin').checked,
      exact: el<HTMLInputElement>('#plan-exact').checked,
      rules,
      snapshots,
    };
  }

  private pipelineWorkers: Worker[] = [];
  /** Palastinsel: beste Variante zum Übernehmen. */
  private adopt: PalaceVariant | null = null;

  private async run(): Promise<void> {
    const src = this.island();
    if (!src || this.running) return;
    this.running = true;
    this.runButton.disabled = true;
    this.exportBox.hidden = true;
    this.cityUi.setEditor(null);
    this.history = [];
    this.status.innerHTML = '';
    const started = performance.now();
    const passes = this.passList();
    const steps = this.passSteps();
    this.progress.startTracks(passes.map((p) => ({ label: p.label, steps })));
    // So viele gleichzeitig, wie Kerne frei sind (einer bleibt für die Oberfläche).
    const slots = Math.max(1, Math.min(passes.length, (navigator.hardwareConcurrency || 2) - 1));
    while (this.pipelineWorkers.length < slots) {
      this.pipelineWorkers.push(new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' }));
    }
    const results: Array<PassResult | null> = passes.map(() => null);
    let bestShown = -1;
    let next = 0;
    // Zwischenstände zeigt der erste Durchlauf, bis ein Durchlauf fertig ist.
    let previewPass = 0;
    const runSlot = async (worker: Worker): Promise<void> => {
      while (next < passes.length) {
        const k = next++;
        const id = ++this.jobId;
        const input = this.passInput(src, passes[k].lines, passes[k].seed, this.watch.checked && k === previewPass, passes[k].variant);
        const result = await new Promise<PassResult | null>((resolve) => {
          worker.onmessage = (event: MessageEvent<PipelineMessage>) => {
            const msg = event.data;
            if (msg.id !== id) return;
            if (msg.kind === 'event') {
              const e = msg.event;
              if (e.kind === 'step') this.progress.step(e.label, e.detail ?? '', k);
              else if (e.kind === 'detail') this.progress.detail(e.text, k);
              else if (e.kind === 'snapshot' && k === previewPass && bestShown < 0) {
                this.preview(src.mask, e.city, 'Zwischenstand', e.planned ? toPlanned(e.planned) : undefined);
              }
            } else if (msg.kind === 'done') resolve(msg.result);
            else {
              this.progress.done(k, `Fehler: ${msg.message}`);
              resolve(null);
            }
          };
          worker.postMessage({ id, input } satisfies PipelineJob);
        });
        results[k] = result;
        if (result) {
          this.progress.done(k, `✓ ${num(result.residents)} Einwohner (${Math.round(result.ms / 1000)} s)`);
          // Besten bisher fertigen Plan zeigen.
          const bestK = results.reduce((b, r, i) => (r && (b < 0 || r.residents > (results[b] as PassResult).residents) ? i : b), -1);
          if (bestK !== bestShown && this.watch.checked) {
            bestShown = bestK;
            const r = results[bestK] as PassResult;
            this.preview(src.mask, r.city, `Bester bisher: ${passes[bestK].label}`, toPlanned(r.planned));
          }
        }
      }
    };
    try {
      await Promise.all(this.pipelineWorkers.slice(0, slots).map((w) => runSlot(w)));
    } finally {
      this.progress.finish();
      this.running = false;
    }
    const bestK = results.reduce((b, r, i) => (r && (b < 0 || r.residents > (results[b] as PassResult).residents) ? i : b), -1);
    if (bestK >= 0) {
      const best = results[bestK] as PassResult;
      this.result = { city: best.city, mask: src.mask, streetGuid: src.streetGuid, planned: toPlanned(best.planned) };
      this.buildStamps();
      const items = this.statusItems(src, best, passes[bestK].label);
      if (passes.length > 1) {
        const tried = passes
          .map((p, i) => (results[i] ? `${p.label} ${num((results[i] as PassResult).residents)}` : `${p.label} –`))
          .join(' · ');
        items.push(`Durchläufe (${slots} gleichzeitig): ${tried} – bester: <strong>${passes[bestK].label}</strong>`);
      }
      // Palastinsel: beste Variante weicht von den Einstellungen ab → übernehmen anbieten
      const bv = passes[bestK].variant;
      if (bv) {
        const rules = this.cityUi.currentRules();
        const curReform = hasPolicy(rules, 'townHallReform') ? 'townHallReform' : hasPolicy(rules, 'freethinkers') ? 'freethinkers' : undefined;
        if (bv.wings !== this.wingsBuilt(rules) || (bv.reform && bv.reform !== curReform)) {
          this.adopt = bv;
          items.push(
            `Bester Plan: ${passes[bestK].label} – weicht von deinen Einstellungen ab. <button type="button" class="linkish" data-adopt>Übernehmen</button> (Flügel und Palast-Richtlinie Verwaltung), damit die Auswertung dazu passt.`,
          );
        }
      }
      items.push(`Gesamt ${((performance.now() - started) / 1000).toFixed(0)} s`);
      this.status.innerHTML = `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
    } else {
      this.status.textContent = 'Kein Durchlauf erfolgreich.';
    }
    this.refreshIsland();
  }

  /** Regionalministerium (Reichweite, Wohlfahrt, Stadtweites Netz) aus den Regeln. */
  /** Lehmgruben: Feld oder (leer) Anzahl aus dem Stempel. */
  private clayOption(src: IslandSource): ServiceOptions['clay'] {
    const raw = el<HTMLInputElement>('#plan-clay').value.trim();
    const count = raw === '' ? (src.deposits?.clay ?? 0) : Math.max(0, Math.min(64, Math.round(Number(raw) || 0)));
    return count > 0 ? { count } : undefined;
  }

  /** Gebaute Palastflügel: Feld „Palastflügel auf dieser Insel“, höchstens so viele wie erlaubt. */
  private wingsBuilt(rules: RuleConfig, override?: number): number {
    const v = override ?? Math.round(Number(el<HTMLInputElement>('#plan-wings').value) || 0);
    return Math.max(0, Math.min(rules.palaceWings, v));
  }

  /** Palastinsel: Museen für die Attraktivität, die bis zum Ziel fehlt. */
  private cultureOption(rules: RuleConfig, wingsOverride?: number): ServiceOptions['culture'] {
    if (!rules.palace || !el<HTMLInputElement>('#plan-museums').checked || !el<HTMLInputElement>('#plan-ministry').checked) return undefined;
    const pc = getPalaceSettings().palace.Culture === PRIVATE_COLLECTIONS_DECREE ? PRIVATE_COLLECTION_ATTR : 0;
    const wings = this.wingsBuilt(rules, wingsOverride);
    return {
      target: Math.max(0, Number(el<HTMLInputElement>('#plan-attr-target').value) || 0),
      base: PALACE_ATTR + WING_ATTR * wings + (Number(el<HTMLInputElement>('#plan-attr-extra').value) || 0),
      perTownHallInRange: hasPolicy(rules, 'townHallReform') ? TOWN_HALL_REFORM_ATTR : 0,
      deltaSet: DELTA_SET.items + pc,
      perTownHall: DELTA_SET.perTownHall,
      perTradeUnion: DELTA_SET.perTradeUnion,
      perSet: BEST_MUSEUM_SET.items + pc,
      moduleSet: 3,
      maxModules: MUSEUM_MAX_MODULES,
    };
  }

  private ministryOption(rules: RuleConfig = this.cityUi.currentRules(), wingsOverride?: number): ServiceOptions['ministry'] {
    if (!el<HTMLInputElement>('#plan-ministry').checked) return undefined;
    // Palastinsel: Palast mit den Flügeln aus den Palast-Einstellungen (auch ohne freie Ministerien)
    if (rules.palace) {
      const wings = this.wingsBuilt(rules, wingsOverride);
      return { range: ministryReach(rules, wings), welfare: welfareBonus(rules), web: cityWideWebBonus(rules), townHalls: hasMinistry(rules, 'city'), palace: { wings } };
    }
    return rules.ministry !== 'none'
      ? { range: localDepartmentRange(rules), welfare: welfareBonus(rules), web: cityWideWebBonus(rules), townHalls: rules.ministry === 'city' }
      : undefined;
  }

  /** Statuszeilen zum gewählten Plan. */
  private statusItems(src: IslandSource, r: PassResult, label: string): string[] {
    const city = r.city;
    const items: string[] = [];
    const totals = this.cityUi.totals();
    if (totals) {
      items.push(`<strong>${num(totals.residents)} Einwohner</strong> (Schätzung) · Rathausradius ${Math.round(totals.townHallShare * 100)} %`);
    }
    const names: Record<string, string> = { l3: 'nur Stufe 3', '335': '3-3-5', '45': '4-5', free: 'frei gemischt' };
    const c = r.levels.counts;
    const mix = [c.V5 ? `${num(c.V5)}× V5` : '', c.V4 ? `${num(c.V4)}× V4` : '', c.V3 ? `${num(c.V3)}× V3` : '', c.I3 ? `${num(c.I3)}× I3` : '']
      .filter(Boolean)
      .join(', ');
    items.push(`Bauweise <strong>${names[r.levels.mode] ?? r.levels.mode}</strong>: ${mix}`);
    if (r.levels.minEngineers > 0) {
      items.push(
        `Ingenieure ${num(r.levels.engineers)} / benötigt ${num(r.levels.minEngineers)} (Kraftwerke)${
          r.levels.engineers < r.levels.minEngineers ? ' – <strong>zu wenig</strong>' : ' ✓'
        }`,
      );
    }
    items.push(
      `${num(city.houses.length)} Häuser · ${city.townHalls.length} Rathäuser · Restfläche ${((100 * freeTiles(src.mask, city)) / src.mask.landCount).toFixed(1)} %`,
      ...(src.kontor
        ? [
            kontorBack(src.kontor).some(([x, y]) => city.plan.roads[y * city.plan.w + x])
              ? 'Kontor: Straße an der Landseite vorhanden ✓'
              : `<strong>Kontor ohne Straße an der Landseite</strong> – im Spiel eine Straße an ${kontorBack(src.kontor)[0].join('/')} anlegen (dort ein Haus weniger).`,
          ]
        : []),
    );
    if (r.services) {
      const s = r.services;
      const short: Record<string, string> = {
        departmentStore: 'Kaufhaus',
        furnitureStore: 'Einrichtungsh.',
        drugStore: 'Drogerie',
        university: 'Universität',
        powerPlant: 'Kraftwerk',
        fireStation: 'Feuerwache',
        policeStation: 'Polizei',
        hospital: 'Hospital',
        bank: 'Bank',
        varietyTheatre: 'Varieté',
        membersClub: 'Clubhaus',
      };
      const p = s.production;
      if (p) {
        const parts = Object.entries(p.byGuid).map(([g, n]) => `${n}× ${lookup(Number(g)).name}`);
        items.push(
          p.placed
            ? `Produktion (${p.lattice}): ${parts.join(', ')} · ${p.tradeUnions} Handelskammern · ${p.houses} Häuser verdrängt${
                p.powerPlants ? ` · ${p.powerPlants} Kraftwerk${p.powerPlants === 1 ? '' : 'e'} extra` : ''
              }${p.placed < p.requested ? ` – <strong>nur ${p.placed} von ${p.requested}</strong> (kein Platz)` : ''}`
            : `Produktion: <strong>keine Formation gefunden</strong> (${p.requested} gewünscht)`,
        );
      }
      items.push(
        `Versorgung: ${SERVICE_KINDS_UI.filter((k) => s.placed[k])
          .map((k) => `${s.placed[k]}× ${short[k]}`)
          .join(', ')}, ${s.warehouses}× Lagerhaus${s.ministry.placed ? ` · ${this.cityUi.currentRules().palace ? 'Palast' : 'Regionalministerium'} (${num(s.ministry.houses)} Häuser in Reichweite)` : ''}${
          s.clay ? ` · Lehmgruben: ${s.clay.pits} in ${s.clay.clusters} Cluster${s.clay.clusters === 1 ? '' : 'n'} mit Handelskammer + Lagerhaus (${s.clay.houses} Häuser verdrängt)` : ''
        }${
          s.culture && (s.culture.museums || s.culture.missing)
            ? ` · Museen: ${s.culture.museums} mit ${s.culture.modules} Modulen (+${num(s.culture.attr)} Attraktivität, ${s.culture.houses} Häuser verdrängt)${
                s.culture.missing ? ` – <strong>noch ${num(s.culture.missing)} zu wenig</strong>` : ''
              }`
            : ''
        }${
          s.airport.placed
            ? ` · Lufthafen${this.currentHarbor() ? ` ${s.airport.distance} Kacheln von der Anlegestelle` : ''}, ${s.airport.houses} Häuser verdrängt`
            : el<HTMLInputElement>('#plan-airport').checked
              ? ' · Lufthafen: kein Platz gefunden'
              : ''
        }`,
      );
      if (s.mip?.tried) {
        items.push(
          `Exakter Löser: ${s.mip.tried} Modelle, ${s.mip.same}× gleiche Auswahl wie gierig, ${s.mip.improved}× verbessert${
            s.mip.failed ? `, ${s.mip.failed}× ohne Ergebnis` : ''
          }`,
        );
      }
    }
    if (r.post) {
      const post = r.post;
      items.push(
        `Post: ${post.boxes} Briefkästen${post.removedHouses ? ` (${post.removedHouses} davon statt eines Hauses)` : ' in Restkacheln'} · ${post.production.toFixed(0)} von ${post.need.toFixed(0)} t/min Bedarf${
          post.production < post.need ? ' (zu wenig Platz – Rest per Postamt/Luftschiff)' : ''
        }`,
      );
    }
    const bridges = countBridges(city.plan.bridges ?? [], src.mask.w);
    if (bridges || city.plan.networks > 1) {
      items.push(
        `${bridges ? `${bridges} Brücke${bridges === 1 ? '' : 'n'}` : 'keine Brücken'} · ${
          city.plan.networks > 1 ? `${city.plan.networks} getrennte Straßennetze` : 'ein zusammenhängendes Straßennetz'
        }`,
      );
    }
    items.push(
      `Gewählter Durchlauf ${label} (${Math.round(r.ms / 1000)} s)${r.compactGained ? ` · Nachverdichtung +${r.compactGained} Häuser` : ''}${
        r.insert ? ` · Querstraßen nach Bedarf: ${r.insert.inserted} eingefügt (−${r.insert.housesLost} Häuser)` : ''
      }${r.thin ? ` · ausgedünnt: ${r.thin.segments} Stücke, +${r.thin.gained} Häuser` : ''}${
        r.valueCompact?.accepted
          ? ` · Nachverdichtung nach Einwohnern: +${num(Math.round(r.valueCompact.residents))} Einwohner (${r.valueCompact.gained >= 0 ? '+' : ''}${r.valueCompact.gained} Häuser)`
          : ''
      }`,
    );
    return items;
  }

  private readonly watch = el<HTMLInputElement>('#plan-watch');

  /** Zwischenstand in der Plan-Ansicht zeigen (ohne Export-Stempel). */
  private preview(
    mask: LandMask,
    city: CityPlan,
    title: string,
    planned?: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>,
  ): void {
    if (!this.watch.checked) return;
    try {
      const items = planToStampItems(mask, city, { coast: false, coastGuid: 1000178, bridges: true });
      const bytes = buildGenericStamp(items.buildings, 'ow', items.streets);
      const xs = [...items.buildings.map((b) => b.x), ...items.streets.map((st) => st.x)];
      const ys = [...items.buildings.map((b) => b.y), ...items.streets.map((st) => st.y)];
      const minX = xs.reduce((m, v) => Math.min(m, v), Infinity);
      const minY = ys.reduce((m, v) => Math.min(m, v), Infinity);
      this.cityUi.show(
        bytes,
        title,
        { w: mask.w, h: mask.h, data: mask.data, dx: CITY_PAD - minX, dy: CITY_PAD - minY },
        planned ? new Map(planned) : undefined,
      );
    } catch {
      /* Vorschau ist nur Anzeige */
    }
  }

  private worker(i: number): Worker {
    while (this.workers.length <= i) {
      this.workers.push(new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' }));
    }
    return this.workers[i];
  }

  /** Briefkästen im Hintergrund planen (post.ts). */
  private post(
    mask: LandMask,
    city: CityPlan,
    rules: RuleConfig,
    planned: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>,
  ): Promise<{ city: CityPlan; report: PostReport & { removedHouses: number } }> {
    const id = ++this.jobId;
    const worker = this.worker(0);
    return new Promise((resolve) => {
      worker.onmessage = (event: MessageEvent<PlannerMessage>) => {
        const msg = event.data;
        if (msg.id === id && msg.kind === 'post') resolve({ city: msg.city, report: msg.report });
      };
      const job: PlannerJob = { kind: 'post', id, mask, city, rules, planned };
      worker.postMessage(job);
    });
  }

  /** Hochhaus-Stufen im Hintergrund optimieren (levels.ts). */
  private levels(
    mask: LandMask,
    city: CityPlan,
    mode: LevelMode,
    budgetMs: number,
    seed = 0,
  ): Promise<{
    planned: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>;
    residents: number;
    startResidents: number;
    mode: string;
    counts: Record<string, number>;
    tried: Array<{ mode: string; residents: number }>;
    engineers: number;
    minEngineers: number;
  }> {
    const id = ++this.jobId;
    const worker = this.worker(0);
    return new Promise((resolve) => {
      worker.onmessage = (event: MessageEvent<PlannerMessage>) => {
        const msg = event.data;
        if (msg.id !== id || msg.kind !== 'levels') return;
        const planned = new Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>();
        for (const [idx, t, l] of msg.planned) {
          planned.set(idx, { tier: t === 0 ? 'engineer' : 'investor', level: l as 3 | 4 | 5 });
        }
        resolve({ ...msg, planned });
      };
      const selfWorkforce = el<HTMLInputElement>('#plan-engineers').checked;
      const rules = this.cityUi.currentRules();
      const withMail = el<HTMLInputElement>('#plan-post').checked && rules.mail !== 'none';
      const job: PlannerJob = { kind: 'levels', id, mask, city, rules, mode, budgetMs, seed: 11 + seed * 977, selfWorkforce, withMail };
      worker.postMessage(job);
    });
  }

  private buildStamps(): void {
    if (!this.result) return;
    const { city, mask, streetGuid } = this.result;
    const items = planToStampItems(mask, city, { coast: false, coastGuid: streetGuid, bridges: true });
    // Export ohne Brücken (die baust du im Spiel über den Fluss).
    const exportItems = planToStampItems(mask, city, { coast: false, coastGuid: streetGuid });
    const full = buildGenericStamp(items.buildings, 'ow', items.streets);
    const bands = splitBands(exportItems, this.split.checked ? 13500 : Infinity);
    this.stamps = bands.map((b) => buildGenericStamp(b.buildings, 'ow', b.streets));
    // Maske → Stadtkachel: das Stadtmodell beginnt CITY_PAD Kacheln vor dem kleinsten Element.
    const xs = [...items.buildings.map((b) => b.x), ...items.streets.map((st) => st.x)];
    const ys = [...items.buildings.map((b) => b.y), ...items.streets.map((st) => st.y)];
    const minX = xs.reduce((m, v) => Math.min(m, v), Infinity);
    const minY = ys.reduce((m, v) => Math.min(m, v), Infinity);
    this.offset = { dx: CITY_PAD - minX, dy: CITY_PAD - minY };
    this.cityUi.show(
      full,
      'Wohnraster-Plan',
      {
        w: mask.w,
        h: mask.h,
        data: mask.data,
        dx: CITY_PAD - minX,
        dy: CITY_PAD - minY,
      },
      this.result.planned ? new Map(this.result.planned) : undefined,
    );
    this.cityUi.setEditor({ edit: (op) => this.edit(op), undo: () => this.undo() });
    this.stampList.innerHTML = this.stamps
      .map((_, i) => {
        const b = bands[i];
        const houses = b.buildings.filter((x) => x.guid === 1010343).length;
        const halls = b.buildings.filter((x) => x.guid === 100415).length;
        const other = b.buildings.length - houses - halls;
        return `<div class="stamp-row"><div><strong>T${i + 1}</strong><span>${num(houses)} Häuser · ${halls} RH${
          other ? ` · ${other} weitere` : ''
        }</span></div>
          <button type="button" data-i="${i}">↓ Stempel</button></div>`;
      })
      .join('');
    this.exportBox.hidden = false;
    this.buildReport(items.buildings, items.streets.length, countBridges(city.plan.bridges ?? [], mask.w));
  }

  private reportText = '';

  // --- Bearbeiten (Phase 6, Teil 2) -------------------------------------------
  /** Maske → Stadtkachel der aktuellen Anzeige. */
  private offset = { dx: 0, dy: 0 };
  private history: Array<{
    city: CityPlan;
    planned?: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>;
    /** Lage (Maske) des bearbeiteten Gebäudes vorher – wird nach Rückgängig wieder angewählt. */
    select?: { x: number; y: number };
  }> = [];
  private toastTimer = 0;

  private toast(message: string, error = false): void {
    const box = el<HTMLElement>('#plan-toast');
    box.textContent = message;
    box.classList.toggle('error', error);
    box.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (box.hidden = true), error ? 4500 : 3000);
  }

  /** Geplante Stufen über die Lage auf neue Hausindizes übertragen. */
  private static remapPlanned(
    before: CityPlan,
    after: CityPlan,
    planned?: Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>,
  ): Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }> | undefined {
    if (!planned) return undefined;
    const byPos = new Map<string, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>();
    before.houses.forEach((hs, k) => {
      const st = planned.get(k);
      if (st) byPos.set(`${hs.x},${hs.y}`, st);
    });
    const out = new Map<number, { tier: 'engineer' | 'investor'; level: 3 | 4 | 5 }>();
    after.houses.forEach((hs, k) => {
      const st = byPos.get(`${hs.x},${hs.y}`);
      if (st) out.set(k, st);
    });
    return out;
  }

  private edit(op: { type: 'move' | 'rotate' | 'remove'; x: number; y: number; dx: number; dy: number }): void {
    if (!this.result || this.running) return;
    const { mask, city } = this.result;
    const mx = op.x - this.offset.dx;
    const my = op.y - this.offset.dy;
    const target = editTargetAt(city, mx, my);
    if (!target) {
      this.toast('Dieses Gebäude lässt sich nicht bearbeiten.', true);
      return;
    }
    const r = editCity(mask, city, target, op.type === 'move' ? { type: 'move', dx: op.dx, dy: op.dy } : { type: op.type });
    if (!r.ok) {
      this.toast(r.message, true);
      this.cityUi.draw();
      return;
    }
    this.history.push({ city, planned: this.result.planned, select: { x: mx, y: my } });
    if (this.history.length > 50) this.history.shift();
    this.result = { ...this.result, city: r.city, planned: PlannerUi.remapPlanned(city, r.city, this.result.planned) };
    this.buildStamps();
    // Bearbeitetes Gebäude wieder anwählen.
    if (op.type !== 'remove') {
      const pos = target.kind === 'townHall' ? r.city.townHalls[target.index] : r.city.services?.[target.index];
      if (pos) this.cityUi.selectTile(pos.x + this.offset.dx, pos.y + this.offset.dy);
    }
    this.toast(`${r.message}${this.result.planned ? ' · neue Häuser ohne Stufe – „Stufen & Post neu berechnen“' : ''}`);
  }

  private undo(): void {
    if (this.running) return;
    const last = this.history.pop();
    if (!last || !this.result) {
      this.toast('Nichts rückgängig zu machen.');
      return;
    }
    this.result = { ...this.result, city: last.city, planned: last.planned };
    this.buildStamps();
    if (last.select) this.cityUi.selectTile(last.select.x + this.offset.dx, last.select.y + this.offset.dy);
    this.toast('Rückgängig gemacht.');
  }

  /** Nach Änderungen: Hochhaus-Stufen und Briefkästen neu (Gebäude bleiben, wo sie sind). */
  private async reoptimize(): Promise<void> {
    if (!this.result || this.running) return;
    this.running = true;
    this.runButton.disabled = true;
    const button = el<HTMLButtonElement>('#plan-reopt');
    button.disabled = true;
    try {
      const { mask } = this.result;
      // Briefkästen neu planen (sie hängen von den Einwohnern ab).
      let city: CityPlan = { ...this.result.city, services: (this.result.city.services ?? []).filter((sv) => sv.kind !== 'postBox') };
      const postOn = el<HTMLInputElement>('#plan-post').checked;
      const lvMsNow = Number(el<HTMLSelectElement>('#plan-levels-time').value) || 15000;
      this.progress.start([
        { label: 'Hochhaus-Stufen', est: lvMsNow },
        ...(postOn ? [{ label: 'Briefkästen', est: 3000 }] : []),
      ]);
      this.progress.step('Hochhaus-Stufen', 'Nach deinen Änderungen');
      const levelMs = Number(el<HTMLSelectElement>('#plan-levels-time').value) || 15000;
      const levels = await this.levels(mask, city, this.levelMode.value as LevelMode, levelMs);
      let planned = levels.planned;
      const rules = this.cityUi.currentRules();
      if (el<HTMLInputElement>('#plan-post').checked && rules.mail !== 'none') {
        this.progress.step('Briefkästen', 'Post in Restkacheln');
        const r = await this.post(mask, city, rules, planned);
        const remapped = PlannerUi.remapPlanned(city, r.city, planned);
        city = { ...r.city, removedHouses: city.removedHouses };
        planned = remapped ?? planned;
      }
      this.history.push({ city: this.result.city, planned: this.result.planned });
      this.result = { ...this.result, city, planned };
      this.buildStamps();
      const t = this.cityUi.totals();
      this.toast(`Neu berechnet: ${t ? `${num(t.residents)} Einwohner` : 'fertig'}`);
    } finally {
      this.progress.finish();
      this.running = false;
      button.disabled = false;
      this.refreshIsland();
    }
  }

  /** Bauliste (Anzahl je Gebäude) und Einwohner-Bericht des fertigen Plans. */
  private buildReport(
    buildings: ReadonlyArray<{ guid: number }>,
    streets: number,
    bridges: number,
  ): void {
    const counts = new Map<number, number>();
    for (const b of buildings) counts.set(b.guid, (counts.get(b.guid) ?? 0) + 1);
    const list = [...counts]
      .map(([guid, n]) => ({ name: guid === 1010343 ? 'Wohnhaus (als Bauernhaus, im Spiel hochziehen)' : lookup(guid).name, n }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'de'));
    const t = this.cityUi.totals();
    const planned = this.result?.planned;
    const levelCounts = { V5: 0, V4: 0, V3: 0, I3: 0 };
    if (planned) {
      for (const st of planned.values()) {
        if (st.tier === 'engineer') levelCounts.I3++;
        else levelCounts[`V${st.level}` as 'V3' | 'V4' | 'V5']++;
      }
    }
    const pct = (v: number): string => `${Math.round(v * 100)} %`;
    const kindNames: Partial<Record<BuildingKind, string>> = {
      departmentStore: 'Kaufhaus',
      furnitureStore: 'Einrichtungshaus',
      drugStore: 'Drogerie',
      university: 'Universität',
      powerPlant: 'Strom',
      fireStation: 'Feuerwache',
      policeStation: 'Polizei',
      hospital: 'Hospital',
      bank: 'Bank',
      varietyTheatre: 'Varieté',
      membersClub: 'Clubhaus',
    };
    const resRows: Array<[string, string]> = t
      ? [
          ['Einwohner (Schätzung)', num(t.residents)],
          ['davon Investoren', num(t.byTier.investor)],
          ['davon Ingenieure', num(t.byTier.engineer)],
          ['davon durch Rathaus-Items', num(t.itemResidents)],
          ['davon durch Post', num(t.mail.residents)],
          ['Häuser im Rathausradius', pct(t.townHallShare)],
          ['Post Produktion / Bedarf', t.mail.need ? `${t.mail.production.toFixed(0)} / ${t.mail.need.toFixed(0)} t/min` : '–'],
          ...Object.entries(t.coverage)
            .filter(([k, v]) => (v ?? 0) > 0 && kindNames[k as BuildingKind])
            .map(([k, v]) => [`Abdeckung ${kindNames[k as BuildingKind]}`, pct(v ?? 0)] as [string, string]),
        ]
      : [];
    const levelRows: Array<[string, string]> = planned
      ? [
          ['Investoren Stufe 5', num(levelCounts.V5)],
          ['Investoren Stufe 4', num(levelCounts.V4)],
          ['Investoren Stufe 3', num(levelCounts.V3)],
          ['Ingenieure Stufe 3', num(levelCounts.I3)],
        ].filter(([, v]) => v !== '0') as Array<[string, string]>
      : [];
    const buildRows: Array<[string, string]> = [
      ...list.map((x) => [x.name, num(x.n)] as [string, string]),
      ['Pflasterstraße (Kacheln)', num(streets)],
      ...(bridges ? [['Brücken (selbst bauen)', num(bridges)] as [string, string]] : []),
    ];
    const table = (title: string, rows: Array<[string, string]>): string =>
      rows.length
        ? `<div class="report-title">${title}</div><table>${rows
            .map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`)
            .join('')}</table>`
        : '';
    el<HTMLElement>('#plan-report-body').innerHTML =
      table('Bauliste', buildRows) + table('Hochhaus-Stufen', levelRows) + table('Einwohner', resRows);
    const text = (title: string, rows: Array<[string, string]>): string =>
      rows.length ? `${title}\n${rows.map(([a, b]) => `  ${a.padEnd(48, ' ')} ${b}`).join('\n')}\n\n` : '';
    const m = this.result?.mask;
    this.reportText =
      `Anno 1800 Wohnraster – Bauliste (${m ? `${m.w} × ${m.h}` : ''})\n\n` +
      text('Bauliste', buildRows) +
      text('Hochhaus-Stufen', levelRows) +
      text('Einwohner', resRows);
  }

  private stampName(i: number): string {
    const m = this.result?.mask;
    return `Wohnraster_${m?.w ?? 0}x${m?.h ?? 0}_AW_T${String(i + 1).padStart(2, '0')}`;
  }

  private saveImage(): void {
    this.cityUi.setLayer('overview');
    this.cityUi.canvasElement().toBlob((blob) => {
      if (blob) download('Wohnraster_Bauplan.png', blob);
    }, 'image/png');
  }
}
