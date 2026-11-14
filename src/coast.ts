// Äußerer Inselrand: Landkacheln, die an Außenwasser (von außen geflutet,
// 4er-Nachbarschaft) oder an den Maskenrand grenzen. Binnenseen zählen nicht.

export interface GridMask {
  w: number;
  h: number;
  data: Uint8Array;
}

export function outerBoundary(mask: GridMask): Uint8Array {
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
