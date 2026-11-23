// Bereich „Produktion & Handelskammer“ vorberechnen → public/db/prod.json:
//   layouts: je Grundfläche die meisten Gebäude im Radius einer Handelskammer (src/prod/layout.ts)
//   setups:  je Produktionsgebäude drei Item-Vorschläge (src/prod/calc.ts, Strom an, ohne Clipping);
//            setups4 mit Gewerkschaftsförderung (4 Plätze), setupsFI mit Fabrikinspektionen
// Aufruf: npm run build-prod (nach build-db).
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const root = new URL('../..', import.meta.url).pathname;
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { packAroundTradeUnion } = await server.ssrLoadModule('/src/prod/layout.ts');
const { bestSetup, SETUP_KINDS, slotsFor, isUseful, itemFx } = await server.ssrLoadModule('/src/prod/calc.ts');
const { activeEffects, modsFor, FACTORY_INSPECTIONS_DECREE } = await server.ssrLoadModule('/src/db/palace.ts');
const read = (f) => JSON.parse(readFileSync(`${root}public/db/${f}`, 'utf8'));
const buildings = read('buildings.json');
const items = read('items.json');
const meta = read('meta.json');
const workforce = new Set(meta.workforce);
const palace = read('palace.json');
const dbLike = { itemBy: new Map(items.map((i) => [i.g, i])), buildingBy: new Map(buildings.map((b) => [b.g, b])) };
// Palast-Erlass „Fabrikinspektionen“ (−50 % Arbeitskraft): eigene Vorschläge, da sich
// „Ohne Arbeitskraft“ damit mit weniger Items erreichen lässt (nur 3 Plätze: dieselbe
// Richtlinie schließt die Gewerkschaftsförderung aus).
const fiEffects = activeEffects(dbLike, palace, { loc: 'regional', attr: palace.levels.Impeccable, ministry: 'Productivity', decrees: { Productivity: FACTORY_INSPECTIONS_DECREE } })
  .filter((e) => e.decree);

const prodBuildings = buildings.filter((b) => b.c === 'production' && b.out);
const t0 = performance.now();

const layouts = {};
for (const b of prodBuildings) {
  if (b.kind || !b.sz) continue;
  const key = b.sz.join('x');
  if (layouts[key]) continue;
  const L = packAroundTradeUnion(b.sz, 15);
  layouts[key] = { n: L.count, b: L.buildings.map((x) => [x.x, x.y, x.turns]), r: L.roads.map((r) => [r.x, r.y]) };
}

// Vorschläge für 3 Plätze und für 4 Plätze (Palast-Erlass „Gewerkschaftsförderung“)
const setups = {};
const setups4 = {};
const setupsFI = {};
for (const b of prodBuildings) {
  const slots = slotsFor(b);
  const cands = items.filter((i) => slots.includes(i.s) && i.tgx.includes(b.g));
  for (const [target, n] of [[setups, 3], [setups4, 4]]) {
    const entry = {};
    for (const kind of SETUP_KINDS) {
      const s = bestSetup(b, cands, kind, { power: true, clip: false }, workforce, n);
      if (s) entry[kind] = s.map((i) => i.g);
    }
    target[b.g] = entry;
  }
  const mods = modsFor(dbLike, palace, fiEffects, b);
  if (mods.wf) {
    const entry = {};
    for (const kind of SETUP_KINDS) {
      const s = bestSetup(b, cands, kind, { power: true, clip: false, palace: mods }, workforce, 3);
      if (s) entry[kind] = s.map((i) => i.g);
    }
    setupsFI[b.g] = entry;
  }
}
// Hafenmeisterei-Items (Küstengebäude): bester Satz zusätzlich zu den Handelskammer-Items derselben Art,
// für 3 Plätze und 4 Plätze (Palast-Richtlinie „Hafenverwaltung“)
const setupsHO = {};
const setupsHO4 = {};
const byG = new Map(items.map((i) => [i.g, i]));
for (const b of prodBuildings) {
  const ho = items.filter((i) => i.s === 'HarborOffice' && i.tgx.includes(b.g) && isUseful(itemFx(i)));
  if (!ho.length) continue;
  for (const [target, n] of [[setupsHO, 3], [setupsHO4, 4]]) {
    const entry = {};
    for (const kind of SETUP_KINDS) {
      const baseItems = ((setups[b.g]?.[kind] ?? setups[b.g]?.max) ?? []).map((g) => byG.get(g)).filter(Boolean);
      const s = bestSetup(b, ho, kind, { power: true, clip: false }, workforce, n, baseItems);
      if (s) entry[kind] = s.map((i) => i.g);
    }
    target[b.g] = entry;
  }
}
writeFileSync(`${root}public/db/prod.json`, JSON.stringify({ radius: 15, hk: [-2, -2], layouts, setups, setups4, setupsFI, setupsHO, setupsHO4 }));
console.log(`${Object.keys(layouts).length} Layouts, ${prodBuildings.length} Gebäude mit Vorschlägen in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
await server.close();
