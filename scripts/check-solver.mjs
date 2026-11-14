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

// 3b. 8er-Gruppen: senkrecht → Spalten wechseln, waagerecht → Reihen wechseln.
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
const rowsOk = horizCity.buildings.every((b) =>
  horizCity.buildings.every((o) => {
    if (horizTiers.groupOf.get(o.index) !== horizTiers.groupOf.get(b.index)) return true;
    const same = horizTiers.tier.get(o.index) === horizTiers.tier.get(b.index);
    return (o.y === b.y) === same;
  }),
);
expect('8er-Gruppe waagerecht: Reihe gleich, Reihen wechseln', rowsOk);

// 3c. Spieltest-Fall: waagerechte Gruppe, Haus unten in der Mitte.
// Im Spiel: Stufenwert 3, gleich hohe −2 (links/rechts), Variety +3 (Reihe darüber) = 4.
const game = { buildings: [], streets: [] };
for (let c = 0; c < 4; c++) {
  for (let r = 0; r < 2; r++) game.buildings.push({ guid: 1010343, x: 1 + c * 3, y: 1 + r * 3, w: 3, h: 3, turns: 0 });
}
for (let x = 0; x < 14; x++) game.streets.push({ x, y: 0, guid: 1010035 });
const gameCity = cityFromStamp(decodeStampFull(buildGenericStamp(game.buildings, 'ow', game.streets)));
const gameA = analyzeCity(gameCity, DEFAULT_RULES);
const minX = Math.min(...gameCity.buildings.map((b) => b.x));
const maxY = Math.max(...gameCity.buildings.map((b) => b.y));
const t = gameA.residences.find((r) => r.building.x === minX + 3 && r.building.y === maxY);
const p = t?.panoramaParts;
expect(
  'Spieltest-Fall: unten Mitte = 3 − 2 + 3 = 4 (beeindruckend)',
  t && t.panoramaValue === 4 && p.sameOrHigher === -2 && p.variety === 3,
  t ? `Wert ${t.panoramaValue}, gleich ${p.sameOrHigher}, Variety +${p.variety}` : 'Haus nicht gefunden',
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

// 5. Stadtplaner Phase 2: vollständige Bebauung + Rathäuser auf der Benchmark-Insel.
const { planFromFill, townHallProblem, finishPlan, refillAroundTownHalls, planToStampItems, freeTiles, compactCity } =
  await server.ssrLoadModule('/src/planner.ts');
const { searchFill } = await server.ssrLoadModule('/src/fill.ts');
{
  const island = decodeStamp(new Uint8Array(readFileSync('test-stamps-fix/Insel_189x290_Screenshot')));
  const mask = { w: island.width, h: island.height, data: island.mask, landCount: island.landCount };
  const plan = planFromFill(searchFill(mask, { orientation: 'auto', housesPerLine: 4 }));
  expect('Planer: ≥ 2.000 Häuser (ganze Insel bebaut)', plan.houses.length >= 2000, `${plan.houses.length} Häuser`);
  const problem = townHallProblem(mask, plan);
  const L = solve(problem.target, ['rh'], { budgetMs: budget, seed: 7, allowed: problem.allowed, overlapPenalty: problem.penalty });
  const refilled = refillAroundTownHalls(mask, finishPlan(plan, L.groups[0].chambers, 12));
  const { city } = compactCity(mask, refilled, { deadline: performance.now() + Math.min(budget, 5000), seed: 1 });
  expect('Nachverdichtung: nicht weniger Häuser, Netze unverändert', city.houses.length >= refilled.houses.length &&
    city.plan.networks === refilled.plan.networks, `${refilled.houses.length} → ${city.houses.length} Häuser, Netze ${refilled.plan.networks} → ${city.plan.networks}`);
  let rhClose = 0;
  for (let i = 0; i < city.townHalls.length; i++) for (let j = i + 1; j < city.townHalls.length; j++) {
    if (Math.hypot(city.townHalls[i].x - city.townHalls[j].x, city.townHalls[i].y - city.townHalls[j].y) < 40) rhClose++;
  }
  expect('Planer: Rathäuser mit Abstand ≥ 40', rhClose === 0, `${rhClose} Paare zu nah`);
  const free = freeTiles(mask, city);
  expect('Planer: < 7 % freie Restkacheln (inkl. Rathaus-Reste)', free / mask.landCount < 0.07, `${((100 * free) / mask.landCount).toFixed(1)} %`);
  const items = planToStampItems(mask, city, { coast: false, coastGuid: 1000178 });
  const planCity = cityFromStamp(decodeStampFull(buildGenericStamp(items.buildings, 'ow', items.streets)));
  const planA = analyzeCity(planCity, DEFAULT_RULES);
  expect('Planer: ≥ 20 Rathäuser, ≥ 80 % der Häuser im Radius', city.townHalls.length >= 20 && planA.totals.townHallShare >= 0.8,
    `${city.townHalls.length} RH, ${(planA.totals.townHallShare * 100).toFixed(1)} %`);
  expect('Planer: Stempel ohne Überlappung, alle Häuser angeschlossen, keine Warnungen',
    planCity.conflicts === 0 && planA.warnings.length === 0, planA.warnings.join('; '));
  const onLand = city.houses.every((hs) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) if (!mask.data[(hs.y + dy) * mask.w + hs.x + dx]) return false;
    return true;
  });
  expect('Planer: alle Häuser und Straßen auf Land', onLand && city.plan.roads.every((r, i) => !r || mask.data[i]));
}

for (const c of cityChecks) {
  console.log(`${c.ok ? 'ok    ' : 'FEHLER'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  if (!c.ok) failed++;
}

await server.close();
process.exit(failed ? 1 : 0);
