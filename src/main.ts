import './style.css';
import { zipSync, strToU8 } from 'fflate';
import { solve, splitChunks, type Chunk, type LandMask, type Layout } from './solver';
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

const statChambers = el<HTMLElement>('#stat-chambers');
const statCoverage = el<HTMLElement>('#stat-coverage');
const statGaps = el<HTMLElement>('#stat-gaps');
const statInfluence = el<HTMLElement>('#stat-influence');
const statCost = el<HTMLElement>('#stat-cost');
const statUpkeep = el<HTMLElement>('#stat-upkeep');

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
let layout: Layout = solve(EMPTY_MASK.w, EMPTY_MASK.h, EMPTY_MASK);
let chunks: Chunk[] = [];
let stamps: Uint8Array[] = [];
let view: 'arrange' | 'result' = 'arrange';
let placementView: PlacementView | null = null;

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

function stampName(index: number): string {
  const { w, h } = currentSize();
  const tag = regionKey() === 'ow' ? 'AW' : 'NW';
  return `HK_${w}x${h}_${tag}_T${String(index + 1).padStart(2, '0')}`;
}

function placementText(): string {
  const region = REGIONS[regionKey()];
  const { w, h } = currentSize();
  const coverage = layout.landCount
    ? ((layout.coveredCount / layout.landCount) * 100).toFixed(1)
    : '0.0';
  const source = combined
    ? `Inselform: ${parts.length} Teile (${combined.w} × ${combined.h}, ${num(combined.landCount)} Landkacheln)`
    : 'Inselform: keine';
  const lines = [
    'Anno 1800 – Handelskammer-Planer',
    `Insel: ${w} × ${h} Kacheln`,
    source,
    `Region: ${region.label} (Ordner: ${region.folder})`,
    `Kammern: ${layout.chambers.length}`,
    `Abdeckung: ${coverage} %`,
    '',
    singleStamp.checked
      ? `Teststempel: alle ${layout.chambers.length} HKs in einem Stempel (ohne 13.500-Kachel-Grenze).`
      : `Aufteilung: ${chunks.length} Stempel (max. 13.500 Kacheln).`,
    '',
    includeStreets.checked
      ? 'Jeder Stempel enthält den äußeren Inselrand als Feldwege (unter den HK-Flächen ausgespart).'
      : 'Die Stempel enthalten nur die Handelskammern.',
    includeStreets.checked
      ? 'Den Inselrand im Spiel an der Küste ausrichten; die HK sitzen dann richtig.'
      : 'Die Stempel am Hex-Muster der Insel ausrichten.',
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
  const count = layout.chambers.length;
  const coverage = layout.landCount ? (layout.coveredCount / layout.landCount) * 100 : 0;
  const gaps = layout.landCount - layout.coveredCount;
  statChambers.textContent = num(count);
  statCoverage.textContent = `${coverage.toFixed(1)} %`;
  statGaps.textContent = `${num(gaps)} Kacheln`;
  statInfluence.textContent = num(Math.max(0, (count - 1) * 20));
  statCost.textContent = `${num(count * 2500)} $`;
  statUpkeep.textContent = `${num(count * 50)} $/min`;
}

function updateStampList(): void {
  if (!combined) {
    stampList.innerHTML = '<p class="empty">Bitte zuerst eine Inselform aus Stempeln laden.</p>';
    zipButton.disabled = true;
    return;
  }
  if (chunks.length === 0) {
    stampList.innerHTML = '<p class="empty">Keine Kammer passt – Fläche zu schmal.</p>';
    zipButton.disabled = true;
    return;
  }
  stampList.innerHTML = chunks
    .map((c, i) => {
      const bw = c.maxX - c.minX;
      const bh = c.maxY - c.minY;
      return `<div class="stamp-row">
        <div><strong>T${i + 1}</strong><span>${c.chambers.length} Kammern · ${bw}×${bh}</span></div>
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

function update(): void {
  combined = combineParts(parts);
  const { w, h } = currentSize();
  layout = solve(w, h, combined ?? EMPTY_MASK);
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
  download(`HK_${w}x${h}_${regionKey() === 'ow' ? 'AW' : 'NW'}_stamps.zip`, archive);
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
regionEl.addEventListener('change', update);
includeStreets.addEventListener('change', update);
singleStamp.addEventListener('change', update);

new ResizeObserver(() => drawStage()).observe(stage);

update();
