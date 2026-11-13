import './style.css';
import { zipSync, strToU8 } from 'fflate';
import { emptyLayout, splitChunks, type Chunk, type LandMask, type Layout } from './solver';
import { BUILDINGS, modeTypes, type BuildingMode } from './buildings';
import { SolveRunner } from './solveRunner';
import { buildStamp, REGIONS, type RegionKey, type StampStreet } from './stamp';
import { decodeStamp } from './stampReader';
import {
  alignPart,
  autoPlace,
  combineParts,
  overlapCount,
  PART_COLORS,
  type CombinedMask,
  type IslandPart,
} from './island';
import { render } from './render';
import { clearPlacementCache, renderPlacement, type PlacementView } from './placement';

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
let placementView: PlacementView | null = null;

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
    mode === 'both' ? 'Verwaltungs-Planer' : mode === 'rh' ? 'Rathaus-Planer' : 'Handelskammer-Planer';
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
  if (regions.size > 1) text += ' · Region gemischt!';
  stampInfo.textContent = text;
}

function renderParts(): void {
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
  tabArrange.classList.toggle('active', next === 'arrange');
  tabResult.classList.toggle('active', next === 'result');
  drawStage();
}

function drawStage(): void {
  if (!combined || parts.length === 0) {
    stageHint.hidden = false;
    placementView = null;
    canvas.style.cursor = 'default';
    render(canvas, layout, chunks, EMPTY_MASK);
    return;
  }

  stageHint.hidden = true;
  if (view === 'arrange') {
    placementView = renderPlacement(canvas, parts, combined, selectedId);
    canvas.style.cursor = 'grab';
  } else {
    placementView = null;
    canvas.style.cursor = 'default';
    render(canvas, layout, chunks, combined);
  }
}

function fieldPathGuid(): number {
  return parts.find((part) => part.streetGuid !== null)?.streetGuid ?? 101308;
}

function outerBoundary(mask: CombinedMask): Uint8Array {
  const { w, h, data } = mask;
  const outside = new Uint8Array(w * h);
  const queue: number[] = [];
  const add = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const index = y * w + x;
    if (outside[index] || data[index]) return;
    outside[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    add(0, y);
    add(w - 1, y);
  }
  for (let i = 0; i < queue.length; i++) {
    const index = queue[i];
    const x = index % w;
    const y = Math.floor(index / w);
    add(x - 1, y);
    add(x + 1, y);
    add(x, y - 1);
    add(x, y + 1);
  }

  const boundary = new Uint8Array(w * h);
  const exterior = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= w || y >= h || outside[y * w + x] === 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = y * w + x;
      if (!data[index]) continue;
      if (exterior(x - 1, y) || exterior(x + 1, y) || exterior(x, y - 1) || exterior(x, y + 1)) {
        boundary[index] = 1;
      }
    }
  }
  return boundary;
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
  if (key !== solveKey) {
    solveKey = key;
    startSolve(false);
  } else {
    rebuildOutputs();
  }
  renderParts();
  updateImportInfo();
  clearStamp.hidden = parts.length === 0;
  alignAll.disabled = parts.length < 2;
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

async function loadStamps(files: FileList): Promise<void> {
  const errors: string[] = [];
  let added = 0;

  for (const file of Array.from(files)) {
    try {
      const parsed = decodeStamp(new Uint8Array(await file.arrayBuffer()));
      const draft: IslandPart = {
        id: `p${nextPartId++}`,
        name: file.name || `Teil ${parts.length + 1}`,
        w: parsed.width,
        h: parsed.height,
        mask: parsed.mask,
        landCount: parsed.landCount,
        offsetX: 0,
        offsetY: 0,
        color: PART_COLORS[parts.length % PART_COLORS.length],
        region: parsed.region,
        streetGuid: parsed.streetGuid,
      };
      autoPlace(parts, draft);
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

  if (added > 0) selectedId = parts[parts.length - 1].id;
  update();
  if (errors.length) stampInfo.textContent = errors.join(' ');
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
  const missed = new Set<string>();
  for (let i = 1; i < parts.length; i++) {
    const result = alignPart(parts.slice(0, i + 1), parts[i]);
    if (result.overlap === 0) missed.add(parts[i].id);
  }
  update();
  if (missed.size) {
    stampInfo.textContent = `${missed.size} Teil(e) ohne Überlappung – bitte näher an die anderen ziehen.`;
  }
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
  if (view !== 'arrange' || !placementView || !combined) return;
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
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

tabArrange.addEventListener('click', () => setView('arrange'));
tabResult.addEventListener('click', () => setView('result'));
regionEl.addEventListener('change', rebuildOutputs);
includeStreets.addEventListener('change', rebuildOutputs);
singleStamp.addEventListener('change', rebuildOutputs);
buildingEl.addEventListener('change', update);
optimizeMore.addEventListener('click', () => startSolve(true));

new ResizeObserver(() => drawStage()).observe(stage);

update();
