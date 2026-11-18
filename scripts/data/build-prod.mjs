// Bereich „Produktion & Handelskammer“ vorberechnen → public/db/prod.json:
//   layouts: je Grundfläche die meisten Gebäude im Radius einer Handelskammer (src/prod/layout.ts)
//   setups:  je Produktionsgebäude drei Item-Vorschläge (src/prod/calc.ts, Strom an, ohne Clipping)
// Aufruf: npm run build-prod (nach build-db).
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const root = new URL('../..', import.meta.url).pathname;
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { packAroundTradeUnion } = await server.ssrLoadModule('/src/prod/layout.ts');
const { bestSetup, SETUP_KINDS, slotsFor } = await server.ssrLoadModule('/src/prod/calc.ts');
const read = (f) => JSON.parse(readFileSync(`${root}public/db/${f}`, 'utf8'));
const buildings = read('buildings.json');
const items = read('items.json');
const meta = read('meta.json');
const workforce = new Set(meta.workforce);

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
}
writeFileSync(`${root}public/db/prod.json`, JSON.stringify({ radius: 15, hk: [-2, -2], layouts, setups, setups4 }));
console.log(`${Object.keys(layouts).length} Layouts, ${prodBuildings.length} Gebäude mit Vorschlägen in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
await server.close();
