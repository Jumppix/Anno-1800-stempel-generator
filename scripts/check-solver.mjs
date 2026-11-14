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

// ---------------------------------------------------------------------------
// Ausrichten mehrerer Stempelteile: Laden in Reihenfolge (autoPlace) und
// „Alle ausrichten“ (alignPart) müssen die im Spiel geprüfte Lage ergeben.
// Erwartete Offsets relativ zum ersten Teil; Überlappung je Teil mit dem Rest.
// ---------------------------------------------------------------------------
const { autoPlace, alignPart, combineParts, overlapCount } = await server.ssrLoadModule('/src/island.ts');
const alignCases = [
  {
    name: 'Insel_Teil_A+B',
    parts: [
      { file: 'test-parts/Insel_Teil_A', at: [0, 0] },
      { file: 'test-parts/Insel_Teil_B', at: [0, -16] },
    ],
    overlaps: [326, 326],
    island: { w: 29, h: 45, land: 931 },
  },
  {
    // Im Spiel geprüft: Feldweg_01 (48,-22), Feldweg_02 (149,49),
    // Feldweg_03 (138,-60), Kaistrasse (48,-172).
    name: 'insel2 (4 Teile)',
    parts: [
      { file: 'test-parts/insel2/Feldweg_01', at: [0, 0] },
      { file: 'test-parts/insel2/Feldweg_02', at: [101, 71] },
      { file: 'test-parts/insel2/Feldweg_03', at: [90, -38] },
      { file: 'test-parts/insel2/Kaistrasse', at: [0, -150] },
    ],
    overlaps: [3563, 1087, 3437, 382],
    island: { w: 189, h: 290, land: 25630 },
  },
];
for (const c of alignCases) {
  const parts = c.parts.map((p, i) => {
    const s = decodeStamp(new Uint8Array(readFileSync(p.file)));
    return { id: `p${i}`, name: p.file, w: s.width, h: s.height, mask: s.mask, landCount: s.landCount, offsetX: 0, offsetY: 0 };
  });
  const verify = (mode) => {
    const errors = [];
    const [bx, by] = [parts[0].offsetX, parts[0].offsetY];
    parts.forEach((part, i) => {
      const [ex, ey] = c.parts[i].at;
      const [x, y] = [part.offsetX - bx, part.offsetY - by];
      if (x !== ex || y !== ey) errors.push(`${part.name}: (${x},${y}) statt (${ex},${ey})`);
      const ov = overlapCount(parts, part);
      if (ov !== c.overlaps[i]) errors.push(`${part.name}: Überlappung ${ov} statt ${c.overlaps[i]}`);
    });
    const island = combineParts(parts);
    if (island.w !== c.island.w || island.h !== c.island.h || island.landCount !== c.island.land) {
      errors.push(`Insel ${island.w}×${island.h}/${island.landCount} statt ${c.island.w}×${c.island.h}/${c.island.land}`);
    }
    console.log(`${errors.length ? 'FEHLER' : 'ok    '} Ausrichten ${c.name} (${mode}): ${island.w}×${island.h}, ${island.landCount} Land`);
    for (const e of errors) console.log('       ', e);
    if (errors.length) failed++;
  };

  const placed = [];
  for (const part of parts) {
    autoPlace(placed, part);
    placed.push(part);
  }
  verify('Laden');

  // Alle Teile ab dem zweiten weit weg schieben und neu ausrichten.
  parts.slice(1).forEach((part, i) => {
    part.offsetX = 500 + 50 * i;
    part.offsetY = -400;
  });
  for (let i = 1; i < parts.length; i++) alignPart(parts.slice(0, i + 1), parts[i]);
  verify('Alle ausrichten');
}

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
