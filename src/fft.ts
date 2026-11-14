// Kleine radix-2-FFT für die Kreuzkorrelation der Straßenmasken beim
// Ausrichten von Stempelteilen. Ohne Abhängigkeiten, nur Float64Array.

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// In-place-FFT der Länge n (Zweierpotenz) auf re/im ab `offset` mit `stride`.
function fft1d(
  re: Float64Array,
  im: Float64Array,
  n: number,
  inverse: boolean,
  bufRe: Float64Array,
  bufIm: Float64Array,
  offset: number,
  stride: number,
): void {
  for (let i = 0; i < n; i++) {
    bufRe[i] = re[offset + i * stride];
    bufIm[i] = im[offset + i * stride];
  }

  // Bitumkehr-Permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = bufRe[i];
      bufRe[i] = bufRe[j];
      bufRe[j] = t;
      t = bufIm[i];
      bufIm[i] = bufIm[j];
      bufIm[j] = t;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tRe = bufRe[b] * curRe - bufIm[b] * curIm;
        const tIm = bufRe[b] * curIm + bufIm[b] * curRe;
        bufRe[b] = bufRe[a] - tRe;
        bufIm[b] = bufIm[a] - tIm;
        bufRe[a] += tRe;
        bufIm[a] += tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }

  const scale = inverse ? 1 / n : 1;
  for (let i = 0; i < n; i++) {
    re[offset + i * stride] = bufRe[i] * scale;
    im[offset + i * stride] = bufIm[i] * scale;
  }
}

// 2D-FFT eines w × h-Felds (beides Zweierpotenzen), zeilenweise abgelegt.
export function fft2d(
  re: Float64Array,
  im: Float64Array,
  w: number,
  h: number,
  inverse: boolean,
): void {
  const n = Math.max(w, h);
  const bufRe = new Float64Array(n);
  const bufIm = new Float64Array(n);
  for (let y = 0; y < h; y++) fft1d(re, im, w, inverse, bufRe, bufIm, y * w, 1);
  for (let x = 0; x < w; x++) fft1d(re, im, h, inverse, bufRe, bufIm, x, w);
}
