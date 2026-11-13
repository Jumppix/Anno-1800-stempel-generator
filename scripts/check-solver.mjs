// Prüft den Solver auf den Teststempeln: Invarianten (Fläche auf Land, keine
// Flächen- oder Radiusüberlappung) und Mindestanzahlen als Regressionstest.
// Aufruf: npm run check   (optional: npm run check -- 8000  für mehr Rechenzeit)
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const budget = Number(process.argv[2] ?? 2500);
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const { solve, validateLayout, splitChunks } = await server.ssrLoadModule('/src/solver.ts');
const { decodeStamp } = await server.ssrLoadModule('/src/stampReader.ts');
const { buildStamp } = await server.ssrLoadModule('/src/stamp.ts');

// Mindestwerte: alter Solver (Hexgitter + Lückenfüllung) lag bei 10 / 33 HK.
const cases = [
  { file: 'test-stamps-fix/Insel_96x65_Feldwege', min: { hk: 12, rh: 7 } },
  { file: 'test-stamps-fix/Insel_51x38_Feldwege', min: { hk: 4, rh: 3 } },
  { file: 'test-stamps-fix/Insel_189x290_Screenshot', min: { hk: 39, rh: 24 } },
];

let failed = 0;
for (const c of cases) {
  const island = decodeStamp(new Uint8Array(readFileSync(c.file)));
  const mask = { w: island.width, h: island.height, data: island.mask, landCount: island.landCount };
  for (const types of [['hk'], ['rh'], ['hk', 'rh']]) {
    const t = performance.now();
    const layout = solve(mask, types, { budgetMs: budget * types.length, seed: 4242 });
    const ms = performance.now() - t;
    const errors = validateLayout(mask, layout);
    const parts = layout.groups.map((g) => {
      const pct = ((g.coveredCount / mask.landCount) * 100).toFixed(1);
      if (types.length === 1 && g.chambers.length < c.min[g.type]) {
        errors.push(`${g.type}: nur ${g.chambers.length}, erwartet ≥ ${c.min[g.type]}`);
      }
      return `${g.chambers.length} ${g.type.toUpperCase()} (${pct} %)`;
    });
    // Export muss funktionieren, Ein-Stempel-Modus = genau ein Stempel.
    if (layout.chambers.length && splitChunks(layout, Infinity).length !== 1) {
      errors.push('Ein-Stempel-Modus liefert nicht genau einen Stempel');
    }
    for (const chunk of splitChunks(layout)) {
      if (chunk.area > 13500) errors.push(`Teilstempel zu groß: ${chunk.area}`);
      buildStamp(chunk.chambers, 'ow', []);
    }
    const name = c.file.split('/').pop();
    console.log(
      `${errors.length ? 'FEHLER' : 'ok    '} ${name.padEnd(26)} ${types.join('+').padEnd(6)} ${parts.join(
        ' · ',
      )}  ${(ms / 1000).toFixed(1)} s`,
    );
    for (const e of errors.slice(0, 5)) console.log('       ', e);
    if (errors.length) failed++;
  }
}
await server.close();
process.exit(failed ? 1 : 0);
