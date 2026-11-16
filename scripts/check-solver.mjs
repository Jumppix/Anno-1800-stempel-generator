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
const { planFromFill, townHallProblem, finishPlan, refillAroundTownHalls, planToStampItems, freeTiles, compactCity, planServices, editCity, thinCity } =
  await server.ssrLoadModule('/src/planner.ts');
const { searchFill } = await server.ssrLoadModule('/src/fill.ts');
{
  const island = decodeStamp(new Uint8Array(readFileSync('test-stamps-fix/Insel_189x290_Screenshot')));
  const mask = { w: island.width, h: island.height, data: island.mask, landCount: island.landCount };
  const plan = planFromFill(searchFill(mask, { orientation: 'auto', housesPerLine: 4 }));
  expect('Planer: ≥ 2.000 Häuser (ganze Insel bebaut)', plan.houses.length >= 2000, `${plan.houses.length} Häuser`);
  const problem = townHallProblem(mask, plan);
  const L = solve(problem.target, ['rh'], { budgetMs: budget, seed: 7, allowed: problem.allowed, overlapPenalty: problem.penalty });
  const withHalls = refillAroundTownHalls(mask, finishPlan(plan, L.groups[0].chambers, 12));
  const { city: dense } = compactCity(mask, withHalls, { deadline: performance.now() + Math.min(budget, 5000), seed: 1 });
  expect('Nachverdichtung: nicht weniger Häuser, Netze unverändert', dense.houses.length >= withHalls.houses.length &&
    dense.plan.networks === withHalls.plan.networks, `${withHalls.houses.length} → ${dense.houses.length} Häuser, Netze ${withHalls.plan.networks} → ${dense.plan.networks}`);
  const kinds = new Set(['departmentStore', 'furnitureStore', 'drugStore', 'university', 'powerPlant']);
  const serviced = planServices(mask, dense, { kinds, fullCoverageValue: 30 });
  expect('Versorgung: Netze unverändert, Lagerhäuser gesetzt', serviced.city.plan.networks === dense.plan.networks &&
    serviced.report.warehouses > 0, `${serviced.report.warehouses} Lagerhäuser, ${serviced.report.removedHouses} Häuser ersetzt`);
  const city = serviced.city;
  {
    // Lufthafen mit Modulen weit weg von einer Anlegestelle im Süden; Ministerium gesetzt.
    const air = planServices(mask, dense, {
      kinds,
      fullCoverageValue: 0,
      airport: { harbor: { x: 144, y: 279 } },
      ministry: { range: 95, welfare: 15, web: 22 },
    });
    const items3 = planToStampItems(mask, air.city, { coast: false, coastGuid: 1000178 });
    const airCity = cityFromStamp(decodeStampFull(buildGenericStamp(items3.buildings, 'ow', items3.streets)));
    const airA = analyzeCity(airCity, DEFAULT_RULES);
    const parts = air.city.services.filter((sv) => sv.owner === 9001);
    expect('Lufthafen: mit 2 Modulen, ≥ 150 Kacheln von der Anlegestelle, Ministerium, keine Warnungen',
      air.report.airport.placed && parts.length === 3 && air.report.airport.distance >= 150 && air.report.ministry.placed &&
        airA.warnings.length === 0 && airCity.conflicts === 0 && air.city.plan.networks === dense.plan.networks,
      `${air.report.airport.distance} Kacheln, ${air.report.airport.houses} Häuser verdrängt; ${airA.warnings.join('; ')}`);
  }
  {
    // Phase 5: geclippte Produktion – 4 Hochrad-Werkhallen + 4 Baumschulen, jede von genau 2 HK erfasst.
    const prod = planServices(mask, dense, {
      kinds,
      fullCoverageValue: 0,
      production: { requests: [{ guid: 1010323, count: 4 }, { guid: 132933, count: 4 }], power: true },
    });
    const itemsP = planToStampItems(mask, prod.city, { coast: false, coastGuid: 1000178 });
    const prodCity = cityFromStamp(decodeStampFull(buildGenericStamp(itemsP.buildings, 'ow', itemsP.streets)));
    const prodA = analyzeCity(prodCity, DEFAULT_RULES);
    const factories = prodCity.buildings.filter((b) => b.entry.kind === 'production');
    const hits = factories.map((b) => prodA.tradeUnionHits.get(b.index) ?? 0);
    const unions = prodCity.buildings.filter((b) => b.entry.kind === 'tradeUnion');
    let close = 0;
    for (let i = 0; i < unions.length; i++) for (let j = i + 1; j < unions.length; j++) {
      if (Math.hypot(unions[i].cx - unions[j].cx, unions[i].cy - unions[j].cy) < 30 - 1e-9) close++;
    }
    const p = prod.report.production;
    expect('Produktion: 8 Gebäude geclippt (je 2 HK), HK-Abstand ≥ 30, Netz unverändert, keine Warnungen',
      p?.placed === 8 && factories.length === 8 && hits.every((n) => n === 2) && close === 0 &&
        prod.city.plan.networks === dense.plan.networks && prodA.warnings.length === 0 && prodCity.conflicts === 0,
      `${p?.placed} Gebäude (${p?.lattice}), ${p?.tradeUnions} HK, ${p?.houses} Häuser verdrängt, Treffer ${hits.join('')}; ${prodA.warnings.join('; ')}`);
  }
  {
    // Phase 6: optionale Gebäude (keine Einwohner) erreichen fast alle Häuser.
    const opt = planServices(mask, dense, { kinds: new Set([...kinds, 'fireStation']), fullCoverageValue: 0 });
    const fire = opt.report.coverage.fireStation ?? 0;
    expect('Optionale Gebäude: Feuerwachen erreichen ≥ 95 % der Häuser, Netz unverändert',
      fire >= 0.95 && opt.city.plan.networks === dense.plan.networks,
      `${opt.report.placed.fireStation} Feuerwachen, ${(fire * 100).toFixed(1)} %`);
  }
  {
    // Querstraßen ausdünnen: nicht weniger Häuser, Netz zusammenhängend, keine Überlappung/Warnung.
    const th = thinCity(mask, city, { deadline: performance.now() + 10000, houseValue: 300 });
    const itT = planToStampItems(mask, th.city, { coast: false, coastGuid: 1000178 });
    const cT = cityFromStamp(decodeStampFull(buildGenericStamp(itT.buildings, 'ow', itT.streets)));
    const aT = analyzeCity(cT, DEFAULT_RULES);
    expect('Querstraßen ausdünnen: Häuser ≥ vorher, Netz unverändert, keine Überlappung/Warnung',
      th.city.houses.length >= city.houses.length && th.city.plan.networks === city.plan.networks && cT.conflicts === 0 &&
        aT.warnings.length === 0,
      `${th.report.segments} Stücke, ${city.houses.length} → ${th.city.houses.length} Häuser; ${aT.warnings.join('; ')}`);
  }
  {
    // Phase 6: Plan bearbeiten – Kaufhaus verschieben/drehen, ungültige Züge ablehnen.
    const ki = city.services.findIndex((sv) => sv.kind === 'departmentStore');
    let moved = null;
    for (const [dx, dy] of [[7, 0], [-7, 0], [0, 7], [0, -7], [14, 0], [0, 14], [3, 0], [0, 3]]) {
      const r = editCity(mask, city, { kind: 'service', index: ki }, { type: 'move', dx, dy });
      if (r.ok) { moved = r; break; }
    }
    const rot = moved && editCity(mask, moved.city, { kind: 'service', index: ki }, { type: 'rotate' });
    const ok = (r) => {
      const it = planToStampItems(mask, r.city, { coast: false, coastGuid: 1000178 });
      const c = cityFromStamp(decodeStampFull(buildGenericStamp(it.buildings, 'ow', it.streets)));
      return c.conflicts === 0 && r.city.plan.networks === city.plan.networks;
    };
    const water = editCity(mask, city, { kind: 'service', index: ki }, { type: 'move', dx: -500, dy: 0 });
    // Rathaus 0 genau auf Rathaus 1 schieben → abgelehnt (Fläche oder Radius).
    const t0 = city.townHalls[0];
    const t1 = city.townHalls[1];
    const onto = editCity(mask, city, { kind: 'townHall', index: 0 }, { type: 'move', dx: t1.x - t0.x + 6, dy: t1.y - t0.y });
    expect('Bearbeiten: Kaufhaus verschieben/drehen ohne Überlappung, Netz unverändert; ungültige Züge abgelehnt',
      !!moved && ok(moved) && (!rot.ok || ok(rot)) && !water.ok && !onto.ok,
      `${moved?.message}; ${rot?.message}; ${water.message}; ${onto.message}`);
  }
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
  expect('Planer: ≥ 20 Rathäuser, ≥ 78 % der Häuser im Radius', city.townHalls.length >= 20 && planA.totals.townHallShare >= 0.78,
    `${city.townHalls.length} RH, ${(planA.totals.townHallShare * 100).toFixed(1)} %`);
  const minCov = Math.min(...['departmentStore', 'furnitureStore', 'drugStore', 'powerPlant'].map((k) => planA.totals.coverage[k] ?? 0));
  const uniShare = planA.residences.reduce((a, r) => a + r.universityFactor, 0) / Math.max(1, planA.residences.length);
  expect('Versorgung: Läden/Strom ≥ 85 %, Universität ≥ 85 % Wirkung (Vollversorgung)', minCov >= 0.85 && uniShare >= 0.85,
    `min. ${(minCov * 100).toFixed(1)} %, Universität ${(uniShare * 100).toFixed(1)} %`);
  expect('Planer: Stempel ohne Überlappung, alle Häuser angeschlossen, keine Warnungen',
    planCity.conflicts === 0 && planA.warnings.length === 0, planA.warnings.join('; '));
  const onLand = city.houses.every((hs) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) if (!mask.data[(hs.y + dy) * mask.w + hs.x + dx]) return false;
    return true;
  });
  expect('Planer: alle Häuser und Straßen auf Land', onLand && city.plan.roads.every((r, i) => !r || mask.data[i]));

  // 6. Hochhaus-Stufen (3-3-5 / 4-5): Optimierer und Analyse rechnen gleich, mehr Einwohner als nur Stufe 3.
  const { optimizeLevels } = await server.ssrLoadModule('/src/levels.ts');
  const lv = optimizeLevels(planA.residences, DEFAULT_RULES, 'auto', Math.min(budget * 3, 9000), 3);
  const planB = analyzeCity(planCity, DEFAULT_RULES, { houses: new Map(), groups: new Map(), planned: lv.planned });
  const skyB = planB.residences.reduce((a, r) => a + (r.tier === 'artisan' ? 0 : r.residents), 0);
  expect('Stufen: Optimierer = Analyse', skyB === lv.residents, `${lv.residents} / ${skyB}`);
  expect('Stufen: ≥ 8 % mehr Einwohner als nur Stufe 3', planB.totals.residents >= planA.totals.residents * 1.08,
    `${planA.totals.residents} → ${planB.totals.residents} (${lv.mode}, ${JSON.stringify(lv.counts)})`);
  expect('Stufen: Ingenieure höchstens Stufe 3', [...lv.planned.values()].every((st) => st.tier === 'investor' || st.level === 3));

  // 7. Post: Briefkästen decken den Bedarf weitgehend, Radien überlappen nicht.
  {
    const { planPost } = await server.ssrLoadModule('/src/planner.ts');
    const { MAIL_NEEDS, mailTypes } = await server.ssrLoadModule('/src/rules.ts');
    const residentsAt = new Map();
    for (const r of planB.residences) {
      const hs = city.houses[r.building.index];
      if (hs) residentsAt.set(`${hs.x},${hs.y}`, r.residents - r.mailBonus);
    }
    const types = mailTypes(DEFAULT_RULES.mail);
    let full = 0;
    for (const r of planB.residences) if (r.tier !== 'artisan') for (const m of MAIL_NEEDS[r.tier]) if (types.includes(m.type)) full += m.residents;
    const need = planB.totals.mail.need;
    const posted = planPost(mask, city, residentsAt, need, full / need);
    const items2 = planToStampItems(mask, posted.city, { coast: false, coastGuid: 1000178 });
    const postCity = cityFromStamp(decodeStampFull(buildGenericStamp(items2.buildings, 'ow', items2.streets)));
    const postA = analyzeCity(postCity, DEFAULT_RULES);
    expect('Post: Briefkästen decken ≥ 80 % des Bedarfs, keine Überlappung/Warnung',
      postA.totals.mail.share >= 0.8 && postA.warnings.length === 0 && postCity.conflicts === 0,
      `${posted.report.boxes} Briefkästen (${posted.report.removedHouses} statt Haus), ${postA.totals.mail.production.toFixed(0)}/${postA.totals.mail.need.toFixed(0)} t/min, +${postA.totals.mail.residents} EW ${postA.warnings.join('; ')}`);
  }
  const lvEng = optimizeLevels(planA.residences, DEFAULT_RULES, '45', Math.min(budget * 2, 6000), 5, { minEngineers: 1500 });
  expect('Stufen: Mindestzahl Ingenieure (eigene Arbeitskraft) erfüllt', lvEng.engineers >= 1500, `${lvEng.engineers} / 1500`);

  // 7. Brücken verbinden die Flussarme der Benchmark-Insel zu einem Straßennetz.
  const { addBridges, replaceRoadStubs } = await server.ssrLoadModule('/src/fill.ts');
  const bridged = searchFill(mask, { orientation: 'auto', housesPerLine: 6 });
  const nBridges = addBridges(bridged, 12);
  const bridgedPlan = planFromFill(bridged);
  expect('Brücken: ein zusammenhängendes Straßennetz', bridgedPlan.networks === 1 && nBridges >= 3, `${nBridges} Brücken, ${bridgedPlan.networks} Netze`);
  expect('Brücken: nur auf Wasser', bridgedPlan.bridges.every((i) => !mask.data[i]));
  const stubCity = refillAroundTownHalls(mask, finishPlan(bridgedPlan, [], 12));
  const { fillRoadStubs } = await server.ssrLoadModule('/src/planner.ts');
  const stubbed = fillRoadStubs(mask, stubCity);
  expect('Straßenstummel: Netz bleibt zusammenhängend', stubbed.city.plan.networks === stubCity.plan.networks, `+${stubbed.added} Häuser`);
  // Jede Brücke hängt nach allen Schritten auf beiden Ufern an Landstraßen.
  const W = mask.w;
  const br = new Set(stubbed.city.plan.bridges ?? []);
  let deadEnds = 0;
  const seenB = new Set();
  for (const b of br) {
    if (seenB.has(b)) continue;
    const g = [b];
    seenB.add(b);
    for (let q = 0; q < g.length; q++) for (const k of [g[q] - 1, g[q] + 1, g[q] - W, g[q] + W]) if (br.has(k) && !seenB.has(k)) (seenB.add(k), g.push(k));
    const heads = new Set();
    for (const t of g) for (const k of [t - 1, t + 1, t - W, t + W]) if (k >= 0 && stubbed.city.plan.roads[k]) heads.add(k);
    if (heads.size < 2) deadEnds++;
  }
  expect('Brücken: keine Brücke als Sackgasse', deadEnds === 0, `${deadEnds} ohne Anschluss`);
  void replaceRoadStubs;
}

// 7. Automatisches Ausrichten der Stempelteile (unabhängig von der Ladereihenfolge).
{
  const { assembleParts } = await server.ssrLoadModule('/src/assemble.ts');
  const { combineParts } = await server.ssrLoadModule('/src/island.ts');
  const load = (path, id) => {
    const d = decodeStamp(new Uint8Array(readFileSync(path)));
    return { id, name: id, w: d.width, h: d.height, mask: d.mask, landCount: d.landCount, offsetX: 0, offsetY: 0, color: '', region: d.region, streetGuid: d.streetGuid };
  };
  const rel = (parts, ref) => {
    const r = parts.find((p) => p.id === ref);
    return Object.fromEntries(parts.map((p) => [p.id, [p.offsetX - r.offsetX, p.offsetY - r.offsetY]]));
  };
  // Insel 2: großzügige Überlappungen mit Küste → exakt wie im Spiel.
  const truth2 = { Feldweg_01: [0, 0], Feldweg_02: [101, 71], Feldweg_03: [90, -38], Kaistrasse: [0, -150] };
  const orders = [
    ['Feldweg_01', 'Feldweg_02', 'Feldweg_03', 'Kaistrasse'],
    ['Kaistrasse', 'Feldweg_03', 'Feldweg_02', 'Feldweg_01'],
    ['Feldweg_02', 'Kaistrasse', 'Feldweg_01', 'Feldweg_03'],
  ];
  let good = 0;
  let size = '';
  for (const order of orders) {
    const parts = order.map((n) => load(`test-parts/insel2/${n}`, n));
    const r = assembleParts(parts);
    const got = rel(parts, 'Feldweg_01');
    if (Object.entries(truth2).every(([k, v]) => got[k][0] === v[0] && got[k][1] === v[1]) && r.spread.size === 0) good++;
    const c = combineParts(parts);
    size = `${c.w} × ${c.h}`;
  }
  expect('Ausrichten: Insel 2 in jeder Ladereihenfolge wie im Spiel, eindeutig', good === orders.length, `${good}/${orders.length}, ${size}`);
  // Einzeln nachladen: vorhandene Teile bleiben liegen, neue finden ihren Platz.
  const one = [];
  for (const n of ['Kaistrasse', 'Feldweg_03', 'Feldweg_01', 'Feldweg_02']) {
    const prev = new Set(one.map((p) => p.id));
    one.push(load(`test-parts/insel2/${n}`, n));
    assembleParts(one, prev);
  }
  const g1 = rel(one, 'Feldweg_01');
  expect('Ausrichten: Insel 2 einzeln nachgeladen', Object.entries(truth2).every(([k, v]) => g1[k][0] === v[0] && g1[k][1] === v[1]),
    JSON.stringify(g1));
  // Insel 3: Teile Kante an Kante bzw. Überlappung ohne Küste → Lage bis auf ±1–3, unsichere Teile gemeldet.
  const parts3 = ['Kaistrasse', 'Feldweg', 'Kaistrasse_02', 'Feldweg_02'].map((n) => load(`test-parts/insel3/${n}`, n));
  const r3 = assembleParts(parts3);
  const g3 = rel(parts3, 'Kaistrasse_02');
  const near = (k, x, y, tol) => Math.abs(g3[k][0] - x) <= tol && Math.abs(g3[k][1] - y) <= tol;
  expect('Ausrichten: Insel 3 (Nähte ohne Überlappung) wie im Screenshot ±3, Unsicheres gemeldet',
    near('Feldweg', -80, -34, 0) && near('Feldweg_02', 0, -80, 1) && near('Kaistrasse', 50, 80, 3) && r3.spread.size > 0,
    `${JSON.stringify(g3)} unsicher: ${[...r3.spread].map(([k, v]) => `${k}±${v}`).join(', ')}`);
  const a = load('test-parts/Insel_Teil_A', 'A');
  const b = load('test-parts/Insel_Teil_B', 'B');
  assembleParts([a, b]);
  expect('Ausrichten: Insel_Teil_A + B', b.offsetX - a.offsetX === 0 && b.offsetY - a.offsetY === -16, `${b.offsetX - a.offsetX}, ${b.offsetY - a.offsetY}`);
}

for (const c of cityChecks) {
  console.log(`${c.ok ? 'ok    ' : 'FEHLER'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  if (!c.ok) failed++;
}

await server.close();
process.exit(failed ? 1 : 0);
