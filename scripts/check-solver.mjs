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
// ---------------------------------------------------------------------------
// Stadt-Analyse (Phase 1): Stempel lesen/schreiben, Straßenreichweite, Panorama
// ---------------------------------------------------------------------------
const { decodeStampFull } = await server.ssrLoadModule('/src/stampReader.ts');
const { buildGenericStamp } = await server.ssrLoadModule('/src/stamp.ts');
const { cityFromStamp } = await server.ssrLoadModule('/src/city.ts');
const { analyzeCity } = await server.ssrLoadModule('/src/analysis.ts');
const { DEFAULT_RULES } = await server.ssrLoadModule('/src/rules.ts');
const { demoCityLayout, catalogTestLayout } = await server.ssrLoadModule('/src/testStamps.ts');

const cityChecks = [];
const expect = (name, ok, detail = '') => cityChecks.push({ name, ok: !!ok, detail });

// 1. Generischer Stempel: Schreiben → Lesen ergibt dieselben Gebäude/Größen.
const cat = catalogTestLayout();
const catCity = cityFromStamp(decodeStampFull(buildGenericStamp(cat.buildings, 'ow', cat.streets)));
const key = (list) => list.map((b) => `${b.guid}:${b.w}x${b.h}`).sort().join(',');
expect('Katalog-Stempel Roundtrip (GUID, Größe, Drehung)', key(cat.buildings) === key(catCity.buildings));
expect('Katalog-Stempel ohne Überlappungen', catCity.conflicts === 0, `${catCity.conflicts} Konflikte`);

// 2. Clipping-Stempel aus dem Spiel: Mittelpunkte genau 15 von zwei HK.
for (const file of ['Clipping_Hochraeder_quadratisch', 'Clipping_Hochraeder_Raute']) {
  const city = cityFromStamp(decodeStampFull(new Uint8Array(readFileSync(`test-stamps-fix/${file}`))));
  const a = analyzeCity(city, DEFAULT_RULES);
  const prod = city.buildings.filter((b) => b.entry.kind === 'production');
  const clipped = prod.filter((b) => a.tradeUnionHits.get(b.index) === 2).length;
  expect(`${file}: 4 HK, 4 Werkhallen, alle geclippt`, city.buildings.length === 8 && clipped === 4, `${clipped}/4`);
  expect(`${file}: HK-Radien überlappen nicht`, !a.warnings.some((w) => w.startsWith('Handelskammern')));
}

// 3. Beispielstadt: Streifen-Regel ergibt im Inneren intensives Panorama.
const demo = demoCityLayout();
const demoCity = cityFromStamp(decodeStampFull(buildGenericStamp(demo.buildings, 'ow', demo.streets)));
const demoA = analyzeCity(demoCity, DEFAULT_RULES);
const intense = demoA.totals.panorama[5];
expect('Beispielstadt: ≥ 150 Hochhäuser mit Panorama 5', intense >= 150, `${intense}`);
expect('Beispielstadt: Universität deckt alle Häuser', demoA.totals.coverage.university === 1);
expect('Beispielstadt: keine Warnungen', demoA.warnings.length === 0, demoA.warnings.join('; '));

// 3b. Streifen-Regel auch für waagerechte 4×2-Gruppen: Spalten wechseln ab.
const { assignTiers } = await server.ssrLoadModule('/src/analysis.ts');
const horiz = { buildings: [], streets: [] };
for (let g = 0; g < 3; g++) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 2; r++) horiz.buildings.push({ guid: 1010343, x: g * 13 + 1 + c * 3, y: 1 + r * 3, w: 3, h: 3, turns: 0 });
  }
}
for (let x = 0; x < 40; x++) horiz.streets.push({ x, y: 0, guid: 1010035 }, { x, y: 7, guid: 1010035 });
const horizCity = cityFromStamp(decodeStampFull(buildGenericStamp(horiz.buildings, 'ow', horiz.streets)));
const horizTiers = assignTiers(horizCity.buildings, DEFAULT_RULES);
const colOk = horizCity.buildings.every((b) => {
  const col = Math.round((b.x - Math.min(...horizCity.buildings.map((o) => o.x))) / 3);
  return horizTiers.tier.get(b.index) === (col % 2 === 0 ? 'engineer' : 'investor') || col >= 4;
});
expect('Streifen-Regel: waagerechte Gruppe abwechselnd I/V', colOk && horizTiers.conflicts === 0, `${horizTiers.conflicts} Konflikte`);

// 3c. Spieltest-Fall: 2×4-Gruppe, links über die Straße einzelne Randhäuser.
// Im Spiel: Haus der linken Gruppenspalte (Ingenieur) = Stufe 3 − 2 + Variety 3 = 4.
const edge = { buildings: [], streets: [] };
for (let r = 0; r < 4; r++) {
  edge.buildings.push({ guid: 1010343, x: 5, y: 1 + r * 3, w: 3, h: 3, turns: 0 });
  edge.buildings.push({ guid: 1010343, x: 8, y: 1 + r * 3, w: 3, h: 3, turns: 0 });
}
for (const y of [1, 4, 7]) edge.buildings.push({ guid: 1010343, x: 1, y, w: 3, h: 3, turns: 0 });
for (let y = 0; y < 14; y++) edge.streets.push({ x: 4, y, guid: 1010035 }, { x: 11, y, guid: 1010035 });
const edgeCity = cityFromStamp(decodeStampFull(buildGenericStamp(edge.buildings, 'ow', edge.streets)));
const edgeA = analyzeCity(edgeCity, DEFAULT_RULES);
const minGroupX = Math.min(...edgeCity.buildings.filter((b) => b.y === edgeCity.buildings[0].y).map((b) => b.x));
const target = edgeA.residences.find(
  (r) => r.building.x === minGroupX + 4 && r.building.y === Math.min(...edgeCity.buildings.map((b) => b.y)) + 3,
);
expect(
  'Spieltest-Fall: Randhäuser kein Hochhaus, Nachbar = Ingenieur mit Wert 4',
  target && target.tier === 'engineer' && target.panoramaValue === 4 && edgeA.nonSkyscrapers.length === 3,
  target ? `${target.tier}, Wert ${target.panoramaValue}, ${edgeA.nonSkyscrapers.length} Randhäuser` : 'Haus nicht gefunden',
);

// 4. Straßenreichweite: Kaufhaus (62) an einer langen Straße versorgt bis Entfernung 62.
const line = { buildings: [], streets: [] };
for (let x = 0; x < 120; x++) line.streets.push({ x, y: 0, guid: 1010035 });
line.buildings.push({ guid: 135100, x: 0, y: 1, w: 6, h: 7, turns: 0 });
for (let k = 0; k < 30; k++) line.buildings.push({ guid: 1010347, x: 7 + k * 3, y: 1, w: 3, h: 3, turns: 0 });
const lineCity = cityFromStamp(decodeStampFull(buildGenericStamp(line.buildings, 'ow', line.streets)));
const lineA = analyzeCity(lineCity, { ...DEFAULT_RULES, ministry: 'none', policy: 'none' });
const lastCovered = Math.max(
  ...lineA.residences.filter((r) => r.services.departmentStore).map((r) => r.building.x),
);
// Kaufhaus belegt x 0–5 (Straßenkacheln 0–5 haben Entfernung 1); Haus bei x ist erreicht,
// wenn eine seiner Straßenkacheln (x..x+2) Entfernung ≤ 62 hat, also x − 5 ≤ 62.
expect('Straßenreichweite: letztes versorgtes Haus bei x ≤ 67', lastCovered <= 67 && lastCovered >= 61, `x=${lastCovered}`);

for (const c of cityChecks) {
  console.log(`${c.ok ? 'ok    ' : 'FEHLER'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  if (!c.ok) failed++;
}

await server.close();
process.exit(failed ? 1 : 0);
