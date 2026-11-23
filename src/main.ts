import './style.css';
import { mountSite } from './site';
import { zipSync, strToU8 } from 'fflate';
import { emptyLayout, splitChunks, type Chunk, type LandMask, type Layout } from './solver';
import { BUILDINGS, modeTypes, type BuildingMode } from './buildings';
import { SolveRunner } from './solveRunner';
import { CityUi, drawAnchor } from './cityUi';
import { PlannerUi } from './plannerUi';
import { outerBoundary } from './coast';
import { buildStamp, REGIONS, type RegionKey, type StampStreet } from './stamp';
import { decodeStamp } from './stampReader';
import {
  alignPart,
  combineParts,
  overlapCount,
  PART_COLORS,
  type CombinedMask,
  type IslandPart,
} from './island';
import { render } from './render';
import { Camera } from './camera';
import { assembleParts, type AssembleResult } from './assemble';
import { loadIsland, persistSettings, saveIsland } from './persist';
import { detectKontor, FACING_NAMES, type KontorFound } from './harbor';
import { initPlannerDefaults } from './plannerDefaults';
import { clearPlacementCache, renderPlacement, type PlacementView } from './placement';

// Kopfleiste der Hilfeseite (Navigation) über dem Werkzeug.
mountSite('planner');

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

const regionEl = el<HTMLSelectElement>('#region');
const canvas = el<HTMLCanvasElement>('#canvas');
const stage = el<HTMLElement>('.stage');
const stampList = el<HTMLElement>('#stamp-list');
const zipButton = el<HTMLButtonElement>('#zip');
const includeStreets = el<HTMLInputElement>('#include-streets');
const singleStamp = el<HTMLInputElement>('#single-stamp');
const stampFile = el<HTMLInputElement>('#stamp-file');
const stampInfo = el<HTMLElement>('#stamp-info');
const clearStamp = el<HTMLButtonElement>('#clear-stamp');
const stageHint = el<HTMLElement>('#stage-hint');
const legendCity = el<HTMLElement>('#legend-city');
const partList = el<HTMLElement>('#part-list');
const alignAll = el<HTMLButtonElement>('#align-all');
const tabArrange = el<HTMLButtonElement>('#tab-arrange');
const tabResult = el<HTMLButtonElement>('#tab-result');

const buildingEl = el<HTMLSelectElement>('#building');
const budgetEl = el<HTMLSelectElement>('#budget');
const optimizeMore = el<HTMLButtonElement>('#optimize-more');
const solveStatus = el<HTMLElement>('#solve-status');
const statGrid = el<HTMLElement>('#stat-grid');
const statMicro = el<HTMLElement>('#stat-micro');
const brandTitle = el<HTMLElement>('#brand-title');
const legendBuilding = el<HTMLElement>('#legend-building');
const legendRadius = el<HTMLElement>('#legend-radius');
const legendCovered = el<HTMLElement>('#legend-covered');

const num = (v: number): string => v.toLocaleString('de-DE');
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });

const EMPTY_MASK: LandMask = {
  w: 20,
  h: 20,
  data: new Uint8Array(400),
  landCount: 0,
};

let parts: IslandPart[] = [];
let combined: CombinedMask | null = null;
let selectedId: string | null = null;
let nextPartId = 1;
let layout: Layout = emptyLayout(EMPTY_MASK, ['hk']);
let chunks: Chunk[] = [];
let stamps: Uint8Array[] = [];
let view: 'arrange' | 'result' = 'arrange';
let mode: 'admin' | 'city' = 'admin';
const currentAppMode = (): 'admin' | 'city' => mode;
// Wird weiter unten erzeugt; update() kann vorher schon laufen.
let plannerUi: PlannerUi | null = null;
let placementView: PlacementView | null = null;
// Zoom/Verschiebung je Ansicht (Plan/Analyse hat eine eigene in CityUi).
const arrangeCamera = new Camera();
// Nächster Klick in „Anordnen“ setzt die Hauptanlegestelle (Stadtplaner).
let harborPick = false;
// CityUi wird weiter unten erzeugt; drawStage() kann vorher schon laufen.
let cityUiReady = false;
const resultCamera = new Camera();

// Hintergrund-Optimierung
let solving = false;
let workersUsed = 1;
let solveKey = '';
let solveStarted = 0;
let statusTimer: number | undefined;

interface DragState {
  part: IslandPart;
  view: PlacementView;
  startGX: number;
  startGY: number;
  startOffsetX: number;
  startOffsetY: number;
}

let drag: DragState | null = null;

function currentSize(): { w: number; h: number } {
  return combined ? { w: combined.w, h: combined.h } : { w: EMPTY_MASK.w, h: EMPTY_MASK.h };
}

function regionKey(): RegionKey {
  return regionEl.value === 'nw' ? 'nw' : 'ow';
}

function buildingMode(): BuildingMode {
  const v = buildingEl.value;
  return v === 'rh' || v === 'both' ? v : 'hk';
}

function filePrefix(): string {
  const mode = buildingMode();
  return mode === 'both' ? 'HK_RH' : BUILDINGS[mode].short;
}

function stampName(index: number): string {
  const { w, h } = currentSize();
  const tag = regionKey() === 'ow' ? 'AW' : 'NW';
  return `${filePrefix()}_${w}x${h}_${tag}_T${String(index + 1).padStart(2, '0')}`;
}

const pct = (part: number, whole: number): string =>
  whole ? `${((part / whole) * 100).toFixed(1)} %` : '0.0 %';

/** Kontor im Hafengebiet (Lücke im Stempel), je zusammengesetzter Insel einmal gesucht. */
let kontorMemo: { of: CombinedMask; k: KontorFound | null } | null = null;
function currentKontor(): KontorFound | null {
  if (!combined?.harbor) return null;
  // Beim Ziehen eines Teils nicht neu suchen (≈ 0,25 s auf großen Inseln)
  if (drag) return null;
  if (kontorMemo?.of !== combined) kontorMemo = { of: combined, k: detectKontor(combined) };
  return kontorMemo.k;
}

function placementText(): string {
  const region = REGIONS[regionKey()];
  const { w, h } = currentSize();
  const source = combined
    ? `Inselform: ${parts.length} Teile (${combined.w} × ${combined.h}, ${num(combined.landCount)} Landkacheln)`
    : 'Inselform: keine';
  const total = layout.chambers.length;
  const lines = [
    'Anno 1800 – Handelskammer- & Rathaus-Planer',
    `Insel: ${w} × ${h} Kacheln`,
    source,
    `Region: ${region.label} (Ordner: ${region.folder})`,
    ...layout.groups.map((g) => {
      const spec = BUILDINGS[g.type];
      return `${spec.plural} (Radius ${spec.radius}): ${g.chambers.length} · Abdeckung ${pct(
        g.coveredCount,
        layout.landCount,
      )}`;
    }),
    '',
    singleStamp.checked
      ? `Teststempel: alle ${total} Gebäude in einem Stempel (ohne 13.500-Kachel-Grenze).`
      : `Aufteilung: ${chunks.length} Stempel (max. 13.500 Kacheln).`,
    '',
    includeStreets.checked
      ? 'Jeder Stempel enthält den äußeren Inselrand als Feldwege (unter den Gebäudeflächen ausgespart).'
      : 'Die Stempel enthalten nur die Gebäude.',
    includeStreets.checked
      ? 'Den Inselrand im Spiel an der Küste ausrichten; die Gebäude sitzen dann richtig.'
      : 'Die Stempel an der Insel ausrichten.',
    '',
    `Ablage: Documents\\Anno 1800\\stamps\\${region.folder}\\<Projektname>\\`,
    'Anno 1800 nach dem Kopieren neu starten.',
  ];
  return lines.join('\n');
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

function updateStats(): void {
  const html: string[] = [];
  const multi = layout.groups.length > 1;
  for (const g of layout.groups) {
    const spec = BUILDINGS[g.type];
    const count = g.chambers.length;
    if (multi) html.push(`<p class="stat-head">${spec.plural}</p>`);
    html.push(
      `<div><span>${multi ? 'Anzahl' : spec.plural}</span><strong>${num(count)}</strong></div>`,
      `<div><span>Abdeckung</span><strong>${pct(g.coveredCount, layout.landCount)}</strong></div>`,
      `<div><span>Lücken</span><strong>${num(layout.landCount - g.coveredCount)} Kacheln</strong></div>`,
      `<div><span>Einfluss</span><strong>${num(Math.max(0, (count - 1) * 20))}</strong></div>`,
    );
    if (g.type === 'hk') {
      html.push(
        `<div><span>Baukosten</span><strong>${num(count * 2500)} $</strong></div>`,
        `<div><span>Unterhalt</span><strong>${num(count * 50)} $/min</strong></div>`,
      );
    }
  }
  statGrid.innerHTML = html.join('');
  statMicro.textContent = `${layout.groups
    .map((g) => `${BUILDINGS[g.type].short}: Radius ${BUILDINGS[g.type].radius}`)
    .join(' · ')} · 4×4 · kein Straßenanschluss`;
}

function updateModeTexts(): void {
  const mode = buildingMode();
  const types = modeTypes(mode);
  brandTitle.textContent =
    currentAppMode() === 'city'
      ? 'Stadtplaner'
      : mode === 'both' ? 'Verwaltungs-Planer' : mode === 'rh' ? 'Rathaus-Planer' : 'Handelskammer-Planer';
  legendBuilding.textContent = types.map((t) => BUILDINGS[t].label).join(' / ');
  legendRadius.textContent = `Radius ${types.map((t) => BUILDINGS[t].radius).join(' / ')}`;
  const colors = types.map((t) => `rgb(${BUILDINGS[t].rgb.join(', ')})`);
  legendCovered.style.background =
    colors.length > 1 ? `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)` : colors[0];
}

function updateStampList(): void {
  if (!combined) {
    stampList.innerHTML = '<p class="empty">Bitte zuerst eine Inselform aus Stempeln laden.</p>';
    zipButton.disabled = true;
    return;
  }
  if (chunks.length === 0) {
    stampList.innerHTML = solving
      ? '<p class="empty">Optimierung läuft …</p>'
      : '<p class="empty">Kein Gebäude passt – Fläche zu schmal.</p>';
    zipButton.disabled = true;
    return;
  }
  stampList.innerHTML = chunks
    .map((c, i) => {
      const bw = c.maxX - c.minX;
      const bh = c.maxY - c.minY;
      const counts = layout.groups
        .map((g) => {
          const n = c.chambers.filter((ch) => ch.type === g.type).length;
          return `${n} ${BUILDINGS[g.type].short}`;
        })
        .join(' + ');
      return `<div class="stamp-row">
        <div><strong>T${i + 1}</strong><span>${counts} · ${bw}×${bh}</span></div>
        <button type="button" data-i="${i}">↓ Stempel</button>
      </div>`;
    })
    .join('');
  zipButton.disabled = false;
}

function updateImportInfo(): void {
  if (!combined || parts.length === 0) {
    stampInfo.textContent = 'Keine Inselform geladen.';
    return;
  }
  const regions = new Set(parts.map((p) => p.region).filter((r): r is number => r !== null));
  let text = `${parts.length} Teil${parts.length === 1 ? '' : 'e'} · ${combined.w} × ${
    combined.h
  } · ${num(combined.landCount)} Landkacheln`;
  if (combined.harborCount) {
    const k = currentKontor();
    text += ` · ${num(combined.harborCount)} Kacheln Hafengebiet (Kaistraße) · ${
      k
        ? `Kontor erkannt (${k.w} × ${k.h} bei ${k.x}/${k.y}, Zufahrt ${k.fairway.w} × ${k.fairway.h} nach ${FACING_NAMES[k.facing]})`
        : 'kein Kontor erkannt (Lücke in Kontorgröße mit Zufahrt fehlt)'
    }`;
  }
  if (regions.size > 1) text += ' · Region gemischt!';
  stampInfo.textContent = text;
}

function renderParts(): void {
  const partsCount = document.querySelector('#parts-count');
  if (partsCount) partsCount.textContent = parts.length ? `(${parts.length})` : '';
  if (parts.length === 0) {
    partList.innerHTML = '<p class="empty">Noch keine Teile. Lade einen oder mehrere Stempel.</p>';
    return;
  }

  partList.innerHTML = parts
    .map((part, index) => {
      const overlap = parts.length > 1 ? overlapCount(parts, part) : null;
      const overlapText = overlap === null ? '–' : num(overlap);
      const warn = overlap === 0 ? ' warn' : '';
      return `<div class="part-row${part.id === selectedId ? ' selected' : ''}" data-id="${part.id}">
        <div class="part-head">
          <i class="part-swatch" style="background:${part.color}"></i>
          <span class="part-name" title="${escapeHtml(part.name)}">T${index + 1} · ${escapeHtml(
            part.name,
          )}</span>
          <span class="part-meta">${part.w}×${part.h}</span>
          <button type="button" data-align title="An den anderen Teilen ausrichten">⇄</button>
          <button type="button" data-remove title="Teil entfernen">×</button>
        </div>
        <div class="part-offsets">
          <label>X<input type="number" data-axis="x" value="${part.offsetX}" /></label>
          <label>Y<input type="number" data-axis="y" value="${part.offsetY}" /></label>
          <span class="part-overlap${warn}">Überlappung: ${overlapText}</span>
        </div>
      </div>`;
    })
    .join('');
}

function setView(next: 'arrange' | 'result'): void {
  view = next;
  document.body.dataset.view = next;
  tabArrange.classList.toggle('active', next === 'arrange');
  tabResult.classList.toggle('active', next === 'result');
  drawStage();
}

function drawStage(): void {
  legendCity.hidden = !(mode === 'city' && view === 'result');
  if (cityUiReady) cityUi.setShown(mode === 'city' && view === 'result');
  if (mode === 'city' && view === 'result') {
    stageHint.hidden = true;
    placementView = null;
    canvas.style.cursor = 'default';
    cityUi.draw();
    return;
  }
  if (!combined || parts.length === 0) {
    stageHint.hidden = false;
    placementView = null;
    canvas.style.cursor = 'default';
    render(canvas, layout, chunks, EMPTY_MASK);
    return;
  }

  stageHint.hidden = true;
  if (view === 'arrange') {
    placementView = renderPlacement(canvas, parts, combined, selectedId, arrangeCamera, currentKontor());
    const harbor = mode === 'city' ? plannerUi?.currentHarbor() : null;
    const ctx = canvas.getContext('2d');
    if (harbor && ctx) {
      const v = placementView;
      drawAnchor(ctx, v.originX + (harbor.x + 0.5) * v.scale, v.originY + (harbor.y + 0.5) * v.scale);
    }
    if (harborPick) canvas.style.cursor = 'crosshair';
    canvas.style.cursor = 'grab';
  } else {
    placementView = null;
    canvas.style.cursor = 'default';
    render(canvas, layout, chunks, combined, resultCamera);
  }
}

/** Kamera der gerade sichtbaren Ansicht (null = nichts zum Zoomen). */
function activeCamera(): Camera | null {
  if (mode === 'city' && view === 'result') return cityUi.camera;
  if (!combined || parts.length === 0) return null;
  return view === 'arrange' ? arrangeCamera : resultCamera;
}

function fieldPathGuid(): number {
  return parts.find((part) => part.streetGuid !== null)?.streetGuid ?? 101308;
}

function collectOuterStreets(
  mask: CombinedMask,
  chambers: readonly { x: number; y: number }[],
  guid: number,
): StampStreet[] {
  const boundary = outerBoundary(mask);
  const blocked = new Uint8Array(mask.w * mask.h);
  for (const chamber of chambers) {
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const x = chamber.x + dx;
        const y = chamber.y + dy;
        if (x >= 0 && y >= 0 && x < mask.w && y < mask.h) blocked[y * mask.w + x] = 1;
      }
    }
  }

  const streets: StampStreet[] = [];
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      const index = y * mask.w + x;
      if (!boundary[index] || blocked[index]) continue;
      streets.push({ x, y, guid });
    }
  }
  return streets;
}

function maskKey(mask: LandMask, mode: BuildingMode): string {
  // FNV-1a über die Maske: gleiche Insel + gleicher Modus = keine Neuberechnung.
  let hash = 0x811c9dc5;
  for (let i = 0; i < mask.data.length; i++) {
    hash ^= mask.data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return `${mode}:${mask.w}x${mask.h}:${(hash >>> 0).toString(16)}`;
}

function setStatus(): void {
  window.clearInterval(statusTimer);
  solveStatus.classList.toggle('running', solving);
  optimizeMore.disabled = solving || !combined;
  if (!combined) {
    solveStatus.textContent = '–';
    return;
  }
  const summary = layout.groups
    .map((g) => `${g.chambers.length} ${BUILDINGS[g.type].short}`)
    .join(' + ');
  if (solving) {
    const tick = (): void => {
      const s = ((performance.now() - solveStarted) / 1000).toFixed(1);
      solveStatus.textContent = `Optimiere auf ${workersUsed} Kern${
        workersUsed === 1 ? '' : 'en'
      } … ${s} s · bisher ${summary}`;
    };
    tick();
    statusTimer = window.setInterval(tick, 200);
  } else {
    const s = ((performance.now() - solveStarted) / 1000).toFixed(1);
    solveStatus.textContent = `Fertig nach ${s} s · ${summary}. Mehr Rechenzeit kann noch etwas herausholen.`;
  }
}

const runner = new SolveRunner(({ layout: next, running, workers }) => {
  layout = next;
  solving = running;
  workersUsed = workers;
  rebuildOutputs();
});

function startSolve(continueFromCurrent: boolean): void {
  const types = modeTypes(buildingMode());
  if (!combined) {
    runner.cancel();
    solving = false;
    layout = emptyLayout(EMPTY_MASK, types);
    rebuildOutputs();
    return;
  }
  const mask: LandMask = {
    w: combined.w,
    h: combined.h,
    data: combined.data,
    landCount: combined.landCount,
  };
  solving = true;
  solveStarted = performance.now();
  void runner.start(mask, types, Number(budgetEl.value) || 6000, continueFromCurrent ? layout : null);
}

function rebuildOutputs(): void {
  chunks = singleStamp.checked ? splitChunks(layout, Infinity) : splitChunks(layout);
  const guid = fieldPathGuid();
  const outerStreets =
    includeStreets.checked && combined
      ? collectOuterStreets(combined, layout.chambers, guid)
      : [];
  stamps = chunks.map((chunk) => buildStamp(chunk.chambers, regionKey(), outerStreets));
  drawStage();
  updateStats();
  updateStampList();
  setStatus();
}

function update(): void {
  combined = combineParts(parts);
  updateModeTexts();
  const key = combined ? maskKey(combined, buildingMode()) : `empty:${buildingMode()}`;
  // Der HK/RH-Solver läuft nur im Modus „Verwaltung“; der Stadtplaner nutzt nur die Inselform.
  if (mode === 'admin' && key !== solveKey) {
    solveKey = key;
    startSolve(false);
  } else {
    rebuildOutputs();
  }
  renderParts();
  updateImportInfo();
  clearStamp.hidden = parts.length === 0;
  alignAll.disabled = parts.length < 2;
  plannerUi?.refreshIsland();
  saveIsland(parts, regionEl.value, mode);
}

function updateOffsetInputs(part: IslandPart): void {
  const row = partList.querySelector<HTMLElement>(`.part-row[data-id="${part.id}"]`);
  const x = row?.querySelector<HTMLInputElement>('input[data-axis="x"]');
  const y = row?.querySelector<HTMLInputElement>('input[data-axis="y"]');
  if (x) x.value = String(part.offsetX);
  if (y) y.value = String(part.offsetY);
}

function removePart(id: string): void {
  parts = parts.filter((part) => part.id !== id);
  if (selectedId === id) selectedId = parts[0]?.id ?? null;
  if (parts.length === 0) clearPlacementCache();
  update();
}

function clearAll(): void {
  parts = [];
  combined = null;
  selectedId = null;
  clearPlacementCache();
  update();
}

/** Hinweis zur automatischen Ausrichtung (fehlende/unsichere Teile). */
function alignmentNote(r: AssembleResult): string {
  const name = (id: string): string => {
    const i = parts.findIndex((p) => p.id === id);
    return i >= 0 ? `T${i + 1}` : id;
  };
  const notes: string[] = [];
  if (r.missed.size) {
    notes.push(`${[...r.missed].map(name).join(', ')} ohne passenden Nachbarn – rechts abgelegt, bitte von Hand ziehen.`);
  }
  if (r.spread.size) {
    notes.push(
      `Nicht eindeutig: ${[...r.spread].map(([id, d]) => `${name(id)} (±${d} Kachel${d === 1 ? '' : 'n'})`).join(', ')} – ` +
        'die Überlappung enthält dort keine Küste. Bitte im Spiel prüfen oder Stempel mit mehr Überlappung an der Küste speichern.',
    );
  }
  return notes.join(' ');
}

async function loadStamps(files: FileList): Promise<void> {
  const errors: string[] = [];
  let added = 0;

  // Bereits vorhandene (evtl. von Hand ausgerichtete) Teile bleiben liegen.
  const previousIds = parts.map((p) => p.id);
  for (const file of Array.from(files)) {
    try {
      const parsed = decodeStamp(new Uint8Array(await file.arrayBuffer()));
      const draft: IslandPart = {
        id: `p${nextPartId++}`,
        name: file.name || `Teil ${parts.length + 1}`,
        w: parsed.width,
        h: parsed.height,
        mask: parsed.mask,
        harbor: parsed.harbor,
        landCount: parsed.landCount,
        offsetX: 0,
        offsetY: 0,
        color: PART_COLORS[parts.length % PART_COLORS.length],
        region: parsed.region,
        streetGuid: parsed.streetGuid,
      };
      parts.push(draft);
      added++;
      if (parsed.region === 5000001) regionEl.value = 'nw';
      else if (parsed.region === 5000000) regionEl.value = 'ow';
    } catch (error) {
      errors.push(
        `${file.name || 'Datei'}: ${error instanceof Error ? error.message : 'unbekannter Fehler'}`,
      );
    }
  }

  // Alle Teile gemeinsam ausrichten (unabhängig von der Ladereihenfolge).
  let note = '';
  if (added > 0) {
    stampInfo.textContent = 'Teile werden ausgerichtet …';
    await new Promise((resolve) => setTimeout(resolve, 20));
    note = alignmentNote(assembleParts(parts, new Set(previousIds)));
    selectedId = parts[parts.length - 1].id;
  }
  update();
  if (errors.length) stampInfo.textContent = errors.join(' ');
  else if (note) stampInfo.textContent += ` · ${note}`;
  stampFile.value = '';
}

function hitPart(px: number, py: number): IslandPart | null {
  if (!placementView) return null;
  const v = placementView;
  const gx = Math.floor((px - v.originX) / v.scale + v.minX);
  const gy = Math.floor((py - v.originY) / v.scale + v.minY);

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (
      gx < part.offsetX ||
      gy < part.offsetY ||
      gx >= part.offsetX + part.w ||
      gy >= part.offsetY + part.h
    ) {
      continue;
    }
    if (part.mask[(gy - part.offsetY) * part.w + gx - part.offsetX]) return part;
  }

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (
      gx >= part.offsetX &&
      gy >= part.offsetY &&
      gx < part.offsetX + part.w &&
      gy < part.offsetY + part.h
    ) {
      return part;
    }
  }
  return null;
}

stampFile.addEventListener('change', () => {
  if (stampFile.files?.length) void loadStamps(stampFile.files);
});

clearStamp.addEventListener('click', clearAll);

alignAll.addEventListener('click', () => {
  if (parts.length < 2) return;
  const note = alignmentNote(assembleParts(parts));
  update();
  if (note) stampInfo.textContent += ` · ${note}`;
});

partList.addEventListener('input', (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-axis]');
  if (!input) return;
  const row = input.closest<HTMLElement>('.part-row');
  const part = parts.find((candidate) => candidate.id === row?.dataset.id);
  if (!part) return;

  const value = Math.round(Number(input.value) || 0);
  if (input.dataset.axis === 'x') part.offsetX = value;
  else part.offsetY = value;

  combined = combineParts(parts);
  drawStage();
  updateImportInfo();
});

partList.addEventListener('change', (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-axis]');
  if (input) update();
});

partList.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const row = target.closest<HTMLElement>('.part-row');
  if (!row) return;
  const part = parts.find((candidate) => candidate.id === row.dataset.id);
  if (!part) return;

  if (target.closest('[data-remove]')) {
    removePart(part.id);
    return;
  }
  if (target.closest('[data-align]')) {
    const result = alignPart(parts, part);
    selectedId = part.id;
    update();
    if (result.overlap === 0) {
      stampInfo.textContent = 'Keine Überlappung gefunden – Teil näher an die anderen ziehen.';
    }
    return;
  }
  if (target instanceof HTMLInputElement || target.closest('button, label')) return;

  selectedId = part.id;
  drawStage();
  renderParts();
});

stampList.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
  if (!button) return;
  const index = Number(button.dataset.i);
  const stamp = stamps[index];
  if (!stamp) return;
  download(stampName(index), stamp);
});

zipButton.addEventListener('click', () => {
  if (chunks.length === 0) return;
  const files: Record<string, Uint8Array> = {};
  chunks.forEach((_, i) => {
    files[stampName(i)] = stamps[i];
  });
  files['platzierung.txt'] = strToU8(placementText());
  const archive = zipSync(files, { level: 0 });
  const { w, h } = currentSize();
  download(`${filePrefix()}_${w}x${h}_${regionKey() === 'ow' ? 'AW' : 'NW'}_stamps.zip`, archive);
});

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || pan) return;
  if (view !== 'arrange' || !placementView || !combined) return;
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  if (harborPick) {
    // Hauptanlegestelle: Kachel in Maskenkoordinaten der Gesamtinsel.
    const v = placementView;
    harborPick = false;
    plannerUi?.setHarbor(Math.floor((px - v.originX) / v.scale), Math.floor((py - v.originY) / v.scale));
    drawStage();
    event.preventDefault();
    return;
  }
  const part = hitPart(px, py);

  if (!part) {
    selectedId = null;
    drawStage();
    renderParts();
    return;
  }

  const pv = placementView;
  selectedId = part.id;
  drag = {
    part,
    view: pv,
    startGX: (px - pv.originX) / pv.scale + pv.minX,
    startGY: (py - pv.originY) / pv.scale + pv.minY,
    startOffsetX: part.offsetX,
    startOffsetY: part.offsetY,
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = 'grabbing';
  drawStage();
  renderParts();
  event.preventDefault();
});

canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const pv = drag.view;
  const gx = (px - pv.originX) / pv.scale + pv.minX;
  const gy = (py - pv.originY) / pv.scale + pv.minY;

  drag.part.offsetX = drag.startOffsetX + Math.round(gx - drag.startGX);
  drag.part.offsetY = drag.startOffsetY + Math.round(gy - drag.startGY);
  combined = combineParts(parts);
  drawStage();
  updateImportInfo();
  updateOffsetInputs(drag.part);
});

function endDrag(): void {
  if (!drag) return;
  drag = null;
  canvas.style.cursor = 'grab';
  update();
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// Ansicht verschieben: rechte (oder mittlere) Maustaste gedrückt halten – wie
// auf einem Whiteboard. Zoomen mit dem Mausrad um den Mauszeiger.
let pan: { camera: Camera; x: number; y: number; panX: number; panY: number; id: number } | null = null;
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 2 && event.button !== 1) return;
  const camera = activeCamera();
  if (!camera) return;
  pan = { camera, x: event.clientX, y: event.clientY, panX: camera.panX, panY: camera.panY, id: event.pointerId };
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = 'grabbing';
  cityUi.hideTip();
  event.preventDefault();
});
canvas.addEventListener('pointermove', (event) => {
  if (!pan || event.pointerId !== pan.id) return;
  pan.camera.panX = pan.panX + event.clientX - pan.x;
  pan.camera.panY = pan.panY + event.clientY - pan.y;
  cityUi.hideTip();
  drawStage();
});
const endPan = (event: PointerEvent): void => {
  if (!pan || event.pointerId !== pan.id) return;
  pan = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  drawStage();
};
canvas.addEventListener('pointerup', endPan);
canvas.addEventListener('pointercancel', endPan);
canvas.addEventListener(
  'wheel',
  (event) => {
    const camera = activeCamera();
    if (!camera) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
    camera.zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-delta * 0.0015));
    cityUi.hideTip();
    drawStage();
  },
  { passive: false },
);
const zoomCenter = (factor: number): void => {
  const camera = activeCamera();
  if (!camera) return;
  camera.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, factor);
  drawStage();
};
el<HTMLButtonElement>('#zoom-in').addEventListener('click', () => zoomCenter(1.4));
el<HTMLButtonElement>('#zoom-out').addEventListener('click', () => zoomCenter(1 / 1.4));
el<HTMLButtonElement>('#zoom-fit').addEventListener('click', () => {
  activeCamera()?.reset();
  drawStage();
});

tabArrange.addEventListener('click', () => setView('arrange'));
tabResult.addEventListener('click', () => setView('result'));
regionEl.addEventListener('change', rebuildOutputs);
includeStreets.addEventListener('change', rebuildOutputs);
singleStamp.addEventListener('change', rebuildOutputs);
buildingEl.addEventListener('change', update);
optimizeMore.addEventListener('click', () => startSolve(true));

const cityUi = new CityUi(
  canvas,
  () => mode === 'city' && view === 'result',
  () => {
    if (mode === 'city') setView('result');
  },
);
cityUiReady = true;
plannerUi = new PlannerUi(
  cityUi,
  () =>
    combined
      ? {
          mask: { w: combined.w, h: combined.h, data: combined.data, landCount: combined.landCount },
          streetGuid: fieldPathGuid(),
          kontor: currentKontor(),
          label: `${combined.w} × ${combined.h} · ${num(combined.landCount)} Landkacheln (${parts.length} Teil${
            parts.length === 1 ? '' : 'e'
          })`,
        }
      : null,
  () => {
    harborPick = true;
    setView('arrange');
    canvas.style.cursor = 'crosshair';
  },
);
cityUi.setHarbor(plannerUi.currentHarbor());
const modeAdmin = el<HTMLButtonElement>('#mode-admin');
const modeCity = el<HTMLButtonElement>('#mode-city');

function setMode(next: 'admin' | 'city'): void {
  mode = next;
  document.body.dataset.mode = next;
  // Im Stadtplaner die Teile-Liste einklappen (Anzahl steht in der Überschrift).
  const partsDetails = document.querySelector<HTMLDetailsElement>('#parts-details');
  if (partsDetails) partsDetails.open = next === 'admin';
  modeAdmin.classList.toggle('active', next === 'admin');
  modeCity.classList.toggle('active', next === 'city');
  for (const node of document.querySelectorAll<HTMLElement>('[data-mode]')) {
    node.hidden = !(node.dataset.mode ?? '').split(' ').includes(next);
  }
  tabResult.textContent = next === 'city' ? 'Plan / Analyse' : 'Ergebnis';
  if (next === 'city') {
    brandTitle.textContent = 'Stadtplaner';
    plannerUi?.refreshIsland();
    drawStage();
  } else {
    // Zurück in „Verwaltung“: HK/RH für die aktuelle Insel (neu) berechnen.
    update();
  }
}

// Stadtplaner: Reiter „Planen“ / „Weitere Funktionen“ in der Leiste.
const sidePanel = document.querySelector<HTMLElement>('.panel');
const setSideTab = (tab: 'plan' | 'more'): void => {
  if (sidePanel) sidePanel.dataset.ctabActive = tab;
  el<HTMLButtonElement>('#ctab-plan').classList.toggle('active', tab === 'plan');
  el<HTMLButtonElement>('#ctab-more').classList.toggle('active', tab === 'more');
};
el<HTMLButtonElement>('#ctab-plan').addEventListener('click', () => setSideTab('plan'));
el<HTMLButtonElement>('#ctab-more').addEventListener('click', () => setSideTab('more'));
setSideTab('plan');
modeAdmin.addEventListener('click', () => setMode('admin'));
modeCity.addEventListener('click', () => setMode('city'));

new ResizeObserver(() => drawStage()).observe(stage);

// Einstellungen des Stadtplaners und der Regeln merken.
persistSettings(
  document,
  'input[id^="plan-"], select[id^="plan-"], input[id^="svc-"], select[id^="svc-"], input[id^="rule-"], select[id^="rule-"]',
);
initPlannerDefaults();

// Letzte Insel (Teile + Anordnung) und Modus wiederherstellen.
const savedIsland = loadIsland(() => `p${nextPartId++}`);
if (savedIsland && savedIsland.parts.length) {
  parts = savedIsland.parts;
  selectedId = parts[parts.length - 1].id;
  if (savedIsland.region === 'ow' || savedIsland.region === 'nw') regionEl.value = savedIsland.region;
}
if (savedIsland?.mode === 'city') setMode('city');
update();
