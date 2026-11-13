import { BUILDINGS } from './buildings';
import type { Chunk, LandMask, Layout } from './solver';

const COLORS = [
  '#e2b25f',
  '#6fb3d6',
  '#cf7d8e',
  '#8cc07a',
  '#b394d6',
  '#dd925f',
  '#5fc3b2',
  '#d8d06a',
  '#a8c7e8',
  '#e08f8f',
];

function drawIslandFrame(
  ctx: CanvasRenderingContext2D,
  mask: LandMask,
  ox: number,
  oy: number,
  scale: number,
): void {
  const { w, h, data } = mask;
  const land = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;

  // Ein Kachel breiter Feldweg-Saum entlang der Küste. Er macht den Insel-
  // umriss lesbar, ohne die HK-Flächen zu überdecken.
  if (scale >= 2) {
    ctx.fillStyle = 'rgba(214, 178, 108, 0.2)';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!land(x, y)) continue;
        if (!land(x - 1, y) || !land(x + 1, y) || !land(x, y - 1) || !land(x, y + 1)) {
          ctx.fillRect(ox + x * scale, oy + y * scale, scale + 0.4, scale + 0.4);
        }
      }
    }
  }

  // Die eigentliche Küstenlinie als durchgehende Feldweg-Kante.
  ctx.strokeStyle = 'rgba(238, 206, 143, 0.94)';
  ctx.lineWidth = Math.max(1, Math.min(2.5, scale * 0.18));
  ctx.beginPath();
  for (let y = 0; y < h; y++) {
    const y0 = oy + y * scale;
    for (let x = 0; x < w; x++) {
      if (!land(x, y)) continue;
      const x0 = ox + x * scale;
      if (!land(x, y - 1)) {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + scale, y0);
      }
      if (!land(x, y + 1)) {
        ctx.moveTo(x0, y0 + scale);
        ctx.lineTo(x0 + scale, y0 + scale);
      }
      if (!land(x - 1, y)) {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0, y0 + scale);
      }
      if (!land(x + 1, y)) {
        ctx.moveTo(x0 + scale, y0);
        ctx.lineTo(x0 + scale, y0 + scale);
      }
    }
  }
  ctx.stroke();
}

export function render(
  canvas: HTMLCanvasElement,
  layout: Layout,
  chunks: Chunk[],
  mask?: LandMask,
): void {
  const parent = canvas.parentElement;
  if (!parent) return;
  const cw = parent.clientWidth;
  const ch = parent.clientHeight;
  if (cw < 20 || ch < 20) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pxW = Math.round(cw * dpr);
  const pxH = Math.round(ch * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const bg = ctx.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, '#0a1b27');
  bg.addColorStop(1, '#061019');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);

  const pad = 34;
  const scale = Math.min((cw - pad * 2) / layout.w, (ch - pad * 2) / layout.h);
  const ox = (cw - layout.w * scale) / 2;
  const oy = (ch - layout.h * scale) / 2;

  if (mask) {
    const off = document.createElement('canvas');
    off.width = mask.w;
    off.height = mask.h;
    const octx = off.getContext('2d');
    if (octx) {
      const img = octx.createImageData(mask.w, mask.h);
      for (let i = 0; i < mask.w * mask.h; i++) {
        const o = i * 4;
        if (mask.data[i]) {
          img.data[o] = 54;
          img.data[o + 1] = 52;
          img.data[o + 2] = 34;
        } else {
          img.data[o] = 7;
          img.data[o + 1] = 18;
          img.data[o + 2] = 26;
        }
        img.data[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, ox, oy, mask.w * scale, mask.h * scale);
      ctx.imageSmoothingEnabled = true;
    }
  } else {
    ctx.fillStyle = '#262b1c';
    ctx.fillRect(ox, oy, layout.w * scale, layout.h * scale);
  }

  const multi = layout.groups.filter((g) => g.chambers.length > 0).length > 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, layout.w * scale, layout.h * scale);
  ctx.clip();
  for (const group of layout.groups) {
    const spec = BUILDINGS[group.type];
    const [r, g, b] = spec.rgb;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${multi ? 0.32 : 0.55})`;
    const half = spec.size / 2;
    for (const c of group.chambers) {
      ctx.beginPath();
      ctx.arc(ox + (c.x + half) * scale, oy + (c.y + half) * scale, spec.radius * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  if (mask) drawIslandFrame(ctx, mask, ox, oy, scale);

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.beginPath();
  for (let x = 0; x <= layout.w; x += 10) {
    ctx.moveTo(ox + x * scale + 0.5, oy);
    ctx.lineTo(ox + x * scale + 0.5, oy + layout.h * scale);
  }
  for (let y = 0; y <= layout.h; y += 10) {
    ctx.moveTo(ox, oy + y * scale + 0.5);
    ctx.lineTo(ox + layout.w * scale, oy + y * scale + 0.5);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.beginPath();
  for (let x = 0; x <= layout.w; x += 50) {
    ctx.moveTo(ox + x * scale + 0.5, oy);
    ctx.lineTo(ox + x * scale + 0.5, oy + layout.h * scale);
  }
  for (let y = 0; y <= layout.h; y += 50) {
    ctx.moveTo(ox, oy + y * scale + 0.5);
    ctx.lineTo(ox + layout.w * scale, oy + y * scale + 0.5);
  }
  ctx.stroke();

  const chunkOf = new Map<string, number>();
  for (const chunk of chunks) {
    for (const c of chunk.chambers) chunkOf.set(`${c.x},${c.y}`, chunk.index);
  }

  // Chunk-Rahmen und T-Labels unter die HK-Kästchen legen, damit die
  // HK-Nummern immer lesbar bleiben.
  chunks.forEach((chunk) => {
    const x = ox + chunk.minX * scale;
    const y = oy + chunk.minY * scale;
    const w = (chunk.maxX - chunk.minX) * scale;
    const h = (chunk.maxY - chunk.minY) * scale;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  });

  for (const c of layout.chambers) {
    const idx = chunkOf.get(`${c.x},${c.y}`) ?? 0;
    const size = BUILDINGS[c.type].size;
    ctx.fillStyle = 'rgba(8, 15, 22, 0.94)';
    ctx.fillRect(ox + c.x * scale, oy + c.y * scale, size * scale, size * scale);
    ctx.strokeStyle = COLORS[idx % COLORS.length];
    ctx.lineWidth = Math.max(1, Math.min(2, scale * 0.35));
    ctx.strokeRect(
      ox + c.x * scale + 0.5,
      oy + c.y * scale + 0.5,
      size * scale - 1,
      size * scale - 1,
    );
  }

  for (const group of layout.groups) {
    const spec = BUILDINGS[group.type];
    const [r, g, b] = spec.rgb;
    const half = spec.size / 2;
    ctx.strokeStyle = multi ? `rgb(${r}, ${g}, ${b})` : '';
    ctx.lineWidth = multi ? 1.4 : 1;
    ctx.globalAlpha = multi ? 0.85 : 0.45;
    for (const c of group.chambers) {
      if (!multi) {
        const idx = chunkOf.get(`${c.x},${c.y}`) ?? 0;
        ctx.strokeStyle = COLORS[idx % COLORS.length];
      }
      ctx.beginPath();
      ctx.arc(ox + (c.x + half) * scale, oy + (c.y + half) * scale, spec.radius * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  if (scale >= 2.2) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.max(7, Math.min(11, scale * 0.85))}px ui-sans-serif, system-ui`;
    for (const group of layout.groups) {
      const spec = BUILDINGS[group.type];
      const half = spec.size / 2;
      group.chambers.forEach((c, i) => {
        const idx = chunkOf.get(`${c.x},${c.y}`) ?? 0;
        ctx.fillStyle = COLORS[idx % COLORS.length];
        const label = multi ? `${spec.short[0]}${i + 1}` : String(i + 1);
        ctx.fillText(label, ox + (c.x + half) * scale, oy + (c.y + half) * scale);
      });
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  ctx.strokeStyle = 'rgba(214, 178, 108, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox + 0.5, oy + 0.5, layout.w * scale - 1, layout.h * scale - 1);

  ctx.font = '600 13px ui-sans-serif, system-ui';
  ctx.fillStyle = 'rgba(230, 237, 243, 0.72)';
  const summary = layout.groups
    .map((g) => `${g.chambers.length} ${BUILDINGS[g.type].plural}`)
    .join(' · ');
  ctx.fillText(`${layout.w} × ${layout.h} Kacheln · ${summary}`, 16, 24);
}
