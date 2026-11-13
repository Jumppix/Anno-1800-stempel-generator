import type { CombinedMask, IslandPart } from './island';

export interface PlacementView {
  scale: number;
  originX: number;
  originY: number;
  minX: number;
  minY: number;
}

const partCache = new Map<string, HTMLCanvasElement>();

export function clearPlacementCache(): void {
  partCache.clear();
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(value)) return [217, 179, 108];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function partImage(part: IslandPart): HTMLCanvasElement {
  const cached = partCache.get(part.id);
  if (cached) return cached;

  const image = document.createElement('canvas');
  image.width = part.w;
  image.height = part.h;
  const ctx = image.getContext('2d');
  if (ctx) {
    const data = ctx.createImageData(part.w, part.h);
    const [r, g, b] = hexToRgb(part.color);
    for (let i = 0; i < part.w * part.h; i++) {
      if (!part.mask[i]) continue;
      const o = i * 4;
      data.data[o] = r;
      data.data[o + 1] = g;
      data.data[o + 2] = b;
      data.data[o + 3] = 210;
    }
    ctx.putImageData(data, 0, 0);
  }
  partCache.set(part.id, image);
  return image;
}

// Draws the actual land silhouette of a part (not just its rectangular
// bounds) along tile edges. This is what makes the draggable pieces readable.
function drawPartEdges(
  ctx: CanvasRenderingContext2D,
  part: IslandPart,
  x: number,
  y: number,
  scale: number,
  color: string,
  lineWidth: number,
): void {
  const { w, h, mask } = part;
  const land = (lx: number, ly: number): boolean =>
    lx >= 0 && ly >= 0 && lx < w && ly < h && mask[ly * w + lx] === 1;

  ctx.beginPath();
  for (let ly = 0; ly < h; ly++) {
    const y0 = y + ly * scale;
    for (let lx = 0; lx < w; lx++) {
      if (!mask[ly * w + lx]) continue;
      const x0 = x + lx * scale;
      if (!land(lx, ly - 1)) {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + scale, y0);
      }
      if (!land(lx, ly + 1)) {
        ctx.moveTo(x0, y0 + scale);
        ctx.lineTo(x0 + scale, y0 + scale);
      }
      if (!land(lx - 1, ly)) {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0, y0 + scale);
      }
      if (!land(lx + 1, ly)) {
        ctx.moveTo(x0 + scale, y0);
        ctx.lineTo(x0 + scale, y0 + scale);
      }
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'miter';
  ctx.stroke();
}

export function renderPlacement(
  canvas: HTMLCanvasElement,
  parts: readonly IslandPart[],
  combined: CombinedMask,
  selectedId: string | null,
): PlacementView {
  const parent = canvas.parentElement;
  if (!parent) return { scale: 1, originX: 0, originY: 0, minX: combined.minX, minY: combined.minY };

  const cw = parent.clientWidth;
  const ch = parent.clientHeight;
  if (cw < 20 || ch < 20) {
    return { scale: 1, originX: 0, originY: 0, minX: combined.minX, minY: combined.minY };
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pxW = Math.round(cw * dpr);
  const pxH = Math.round(ch * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { scale: 1, originX: 0, originY: 0, minX: combined.minX, minY: combined.minY };
  }

  const snap = (value: number): number => Math.round(value * dpr) / dpr;
  const hair = 1 / dpr;
  const lineAt = (value: number): number => snap(value) + hair / 2;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const background = ctx.createLinearGradient(0, 0, 0, ch);
  background.addColorStop(0, '#0a1b27');
  background.addColorStop(1, '#061019');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, cw, ch);

  const top = 30;
  const pad = 35;
  const rawScale = Math.min((cw - pad * 2) / combined.w, (ch - top - pad) / combined.h);
  // Snap the tile size to whole device pixels. Together with disabled image
  // smoothing this keeps every tile edge hard instead of antialiased/blurred.
  const scale = Math.max(1 / dpr, Math.floor(rawScale * dpr) / dpr);
  const originX = snap((cw - combined.w * scale) / 2);
  const originY = snap(top + (ch - top - pad - combined.h * scale) / 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(originX, originY, combined.w * scale, combined.h * scale);
  ctx.clip();

  ctx.fillStyle = '#0b1a24';
  ctx.fillRect(originX, originY, combined.w * scale, combined.h * scale);

  ctx.lineWidth = hair;
  for (let x = 0; x <= combined.w; x += 10) {
    const major = x % 50 === 0;
    ctx.strokeStyle = major ? 'rgba(235, 244, 250, 0.16)' : 'rgba(235, 244, 250, 0.06)';
    ctx.beginPath();
    ctx.moveTo(lineAt(originX + x * scale), originY);
    ctx.lineTo(lineAt(originX + x * scale), originY + combined.h * scale);
    ctx.stroke();
  }
  for (let y = 0; y <= combined.h; y += 10) {
    const major = y % 50 === 0;
    ctx.strokeStyle = major ? 'rgba(235, 244, 250, 0.16)' : 'rgba(235, 244, 250, 0.06)';
    ctx.beginPath();
    ctx.moveTo(originX, lineAt(originY + y * scale));
    ctx.lineTo(originX + combined.w * scale, lineAt(originY + y * scale));
    ctx.stroke();
  }

  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = 'lighter';
  for (const part of parts) {
    const x = originX + (part.offsetX - combined.minX) * scale;
    const y = originY + (part.offsetY - combined.minY) * scale;
    ctx.globalAlpha = part.id === selectedId ? 1 : 0.82;
    ctx.drawImage(partImage(part), x, y, part.w * scale, part.h * scale);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;

  // One-tile grid on top of the parts. This is deliberately only drawn when
  // tiles are large enough to read, and keeps individual tiles identifiable.
  if (scale >= 3) {
    ctx.lineWidth = hair;
    ctx.strokeStyle = 'rgba(235, 244, 250, 0.075)';
    ctx.beginPath();
    for (let x = 0; x <= combined.w; x++) {
      const px = lineAt(originX + x * scale);
      ctx.moveTo(px, originY);
      ctx.lineTo(px, originY + combined.h * scale);
    }
    for (let y = 0; y <= combined.h; y++) {
      const py = lineAt(originY + y * scale);
      ctx.moveTo(originX, py);
      ctx.lineTo(originX + combined.w * scale, py);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(235, 244, 250, 0.15)';
    ctx.beginPath();
    for (let x = 0; x <= combined.w; x += 10) {
      const px = lineAt(originX + x * scale);
      ctx.moveTo(px, originY);
      ctx.lineTo(px, originY + combined.h * scale);
    }
    for (let y = 0; y <= combined.h; y += 10) {
      const py = lineAt(originY + y * scale);
      ctx.moveTo(originX, py);
      ctx.lineTo(originX + combined.w * scale, py);
    }
    ctx.stroke();
  }

  for (const part of parts) {
    const x = originX + (part.offsetX - combined.minX) * scale;
    const y = originY + (part.offsetY - combined.minY) * scale;
    const selected = part.id === selectedId;

    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(235, 244, 250, 0.2)';
    ctx.lineWidth = hair;
    ctx.strokeRect(x, y, part.w * scale, part.h * scale);
    ctx.restore();

    drawPartEdges(
      ctx,
      part,
      x,
      y,
      scale,
      selected ? '#f0d79a' : 'rgba(240, 248, 255, 0.78)',
      selected ? Math.max(1.5, hair * 2) : Math.max(1, hair),
    );
  }

  // Labels are drawn after all pieces, so a later overlapping piece cannot
  // cover them. They sit at the center of each piece as requested.
  const labelOrder = [...parts].sort(
    (a, b) => Number(a.id === selectedId) - Number(b.id === selectedId),
  );
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 11px ui-sans-serif, system-ui';
  for (const part of labelOrder) {
    const x = originX + (part.offsetX - combined.minX) * scale;
    const y = originY + (part.offsetY - combined.minY) * scale;
    const centerX = x + (part.w * scale) / 2;
    const centerY = y + (part.h * scale) / 2;
    const label = `T${parts.indexOf(part) + 1}`;
    const textWidth = ctx.measureText(label).width;
    const boxW = textWidth + 12;
    const boxH = 18;
    const bx = snap(centerX - boxW / 2);
    const by = snap(centerY - boxH / 2);
    const selected = part.id === selectedId;

    ctx.fillStyle = 'rgba(5, 10, 15, 0.9)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = selected ? '#f0d79a' : 'rgba(240, 248, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
    ctx.fillStyle = selected ? '#f0d79a' : '#dbe7ef';
    ctx.fillText(label, centerX, centerY + 0.5);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.restore();

  ctx.strokeStyle = 'rgba(217, 179, 108, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(originX + 0.5, originY + 0.5, combined.w * scale - 1, combined.h * scale - 1);

  ctx.font = '600 13px ui-sans-serif, system-ui';
  ctx.fillStyle = 'rgba(230, 237, 243, 0.75)';
  ctx.fillText(
    `${combined.w} × ${combined.h} Kacheln · ${parts.length} Teil${parts.length === 1 ? '' : 'e'} · 1 Kachel = ${scale.toFixed(1)} px`,
    16,
    22,
  );

  return { scale, originX, originY, minX: combined.minX, minY: combined.minY };
}
