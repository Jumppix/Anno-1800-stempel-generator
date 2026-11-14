// Kamera für die Zeichenfläche: Zoom (Mausrad, um den Mauszeiger) und
// Verschieben (rechte oder mittlere Maustaste gedrückt halten). Jede Ansicht
// berechnet zuerst ihre eingepasste Grundlage (Maßstab + Ursprung); die Kamera
// vergrößert diese um die Bildmitte und verschiebt sie.

export interface ViewBase {
  scale: number;
  ox: number;
  oy: number;
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 40;

export class Camera {
  zoom = 1;
  panX = 0;
  panY = 0;

  /** Zuletzt gezeichnete Grundlage und Größe (für Zoom per Mausrad). */
  private last: { base: ViewBase; cw: number; ch: number } | null = null;

  /** Eingepasste Grundlage → tatsächliche Darstellung. */
  apply(base: ViewBase, cw: number, ch: number): ViewBase {
    this.last = { base, cw, ch };
    return {
      scale: base.scale * this.zoom,
      ox: cw / 2 + (base.ox - cw / 2) * this.zoom + this.panX,
      oy: ch / 2 + (base.oy - ch / 2) * this.zoom + this.panY,
    };
  }

  /** Zoomen so, dass der Punkt unter (mx, my) an seiner Stelle bleibt. */
  zoomAt(mx: number, my: number, factor: number): void {
    if (!this.last) return;
    const { base, cw, ch } = this.last;
    const before = this.apply(base, cw, ch);
    const tx = (mx - before.ox) / before.scale;
    const ty = (my - before.oy) / before.scale;
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    const scale = base.scale * this.zoom;
    this.panX = mx - tx * scale - (cw / 2 + (base.ox - cw / 2) * this.zoom);
    this.panY = my - ty * scale - (ch / 2 + (base.oy - ch / 2) * this.zoom);
  }

  reset(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  get isDefault(): boolean {
    return this.zoom === 1 && this.panX === 0 && this.panY === 0;
  }
}
