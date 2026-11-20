// Prüfbericht der Spieldatenbank (public/db): Gegenproben und Lücken.
// Aufruf: npm run check-db
import { readFileSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync(new URL(`../../public/db/${f}`, import.meta.url), 'utf8'));
const buildings = load('buildings.json');
const items = load('items.json');
const byGuid = new Map(buildings.map((b) => [b.g, b]));
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok    ' : 'FEHLER'} ${label}${detail ? `  (${detail})` : ''}`);
};

// 1. Zykluszeit gegen den Anno-1800-Rechner
const withBoth = buildings.filter((b) => b.ct && b.calcTpm);
const off = withBoth.filter((b) => Math.abs((60 / b.ct) * (b.out?.[0]?.a ?? 1) - b.calcTpm) > 0.01);
check('Produktion: t/min aus Zykluszeit = Anno-1800-Rechner', off.length === 0, `${withBoth.length - off.length}/${withBoth.length} gleich${off.length ? `; abweichend: ${off.map((b) => b.n.de).join(', ')}` : ''}`);
const noCycle = buildings.filter((b) => !b.ct && b.calcTpm).length;
console.log(`info   ${noCycle} Produktionsgebäude ohne Zykluszeit (templates.xml) – Rechner-Wert wird gezeigt`);

// 2. Werte, die der Stadtplaner fest eingetragen hat (src/catalog.ts)
const expect = [
  [1010516, 'Handelskammer', { sz: [4, 4], rad: 15 }],
  [100415, 'Rathaus', { sz: [4, 4], rad: 20 }],
  [135100, 'Kaufhaus', { sz: [7, 6] }],
  [1010362, 'Universität', { sz: [9, 6] }],
  [117547, 'Gasbetriebenes Kraftwerk', { sz: [5, 6] }],
  [1010371, 'Lagerhaus', { sz: [5, 5] }],
  [269602, 'Regionalministerium', { sz: [8, 5] }],
  [1010323, 'Hochrad-Werkhalle', { sz: [6, 6] }],
];
for (const [g, name, want] of expect) {
  const b = byGuid.get(g);
  const diffs = [];
  if (!b) diffs.push('fehlt');
  else {
    if (want.sz && b.sz?.join('×') !== want.sz.join('×')) diffs.push(`Größe ${b.sz?.join('×')} statt ${want.sz.join('×')}`);
    if (want.rad && b.rad !== want.rad) diffs.push(`Radius ${b.rad} statt ${want.rad}`);
  }
  check(`Stadtplaner-Wert: ${name}`, diffs.length === 0, diffs.join(', '));
}
// Straßenreichweiten: Spielwert × ~1,4 = Pflaster-Kacheln im Stadtplaner
for (const [g, name, paved] of [[135100, 'Kaufhaus', 62], [1010362, 'Universität', 64], [117547, 'Gaskraftwerk', 59]]) {
  const b = byGuid.get(g);
  const base = b?.rng ?? b?.ps?.full ?? b?.pw;
  console.log(`info   ${name}: Spielwert ${base} → Pflaster ${paved} (Faktor ${base ? (paved / base).toFixed(2) : '?'})`);
}

// Strom: Pflicht (MandatoryIndustrialization) bzw. optional
for (const [g, name, want] of [[1010323, 'Hochrad-Werkhalle', 'req'], [135100, 'Kaufhaus', 'req'], [1010283, 'Ziegelei', 'opt'], [1010343, 'Bauernhaus', undefined]]) {
  check(`Strom ${want === 'req' ? 'erforderlich' : want ? 'optional' : 'nicht nötig'}: ${name}`, byGuid.get(g)?.pow === want, `ist ${byGuid.get(g)?.pow ?? 'ohne'}`);
}
console.log(`info   Strom erforderlich: ${buildings.filter((b) => b.pow === 'req').length}, optional: ${buildings.filter((b) => b.pow === 'opt').length}`);

// Produktion & Handelskammer (public/db/prod.json)
{
  const prod = load('prod.json');
  const hochrad = prod.layouts['6x6'];
  check('Layout 6×6 (Hochrad-Werkhalle): ≥ 18 Gebäude je Handelskammer', (hochrad?.n ?? 0) >= 18, `${hochrad?.n}`);
  // Jedes Gebäude im Layout: Mittelpunkt im Radius, keine Überlappung, Straße angrenzend
  let bad = 0;
  for (const [key, L] of Object.entries(prod.layouts)) {
    const [px, pz] = key.split('x').map(Number);
    const occ = new Set(['-2,-2']);
    for (let y = -2; y < 2; y++) for (let x = -2; x < 2; x++) occ.add(`${x},${y}`);
    const roads = new Set(L.r.map(([x, y]) => `${x},${y}`));
    for (const [x, y, turns] of L.b) {
      const w = turns % 2 ? px : pz;
      const h = turns % 2 ? pz : px;
      if (Math.hypot(x + w / 2, y + h / 2) > prod.radius + 1e-9) bad++;
      let road = false;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        const k = `${xx},${yy}`;
        if (occ.has(k) || roads.has(k)) bad++;
        occ.add(k);
      }
      for (let xx = x; xx < x + w; xx++) road ||= roads.has(`${xx},${y - 1}`) || roads.has(`${xx},${y + h}`);
      for (let yy = y; yy < y + h; yy++) road ||= roads.has(`${x - 1},${yy}`) || roads.has(`${x + w},${yy}`);
      if (!road) bad++;
    }
  }
  check('Layouts: alle Gebäude im Radius, ohne Überlappung, mit Straßenanschluss', bad === 0, `${Object.keys(prod.layouts).length} Größen, ${bad} Fehler`);
  const withSetup = Object.values(prod.setups).filter((s) => s.max?.length).length;
  console.log(`info   ${withSetup}/${Object.keys(prod.setups).length} Produktionsgebäude mit Item-Vorschlag`);
}

// 2b. Palast & Regionalministerium (Spieldaten, Paläste der Macht)
{
  let palace = null;
  try {
    palace = load('palace.json');
  } catch {
    /* fehlt */
  }
  check('Palast: palace.json vorhanden', !!palace);
  if (palace) {
    const itemBy = new Map(items.map((i) => [i.g, i]));
    const M = Object.fromEntries(palace.ministries.map((m) => [m.k, m]));
    check('Palast: 5 Ministerien mit je 5 Richtlinien', palace.ministries.length === 5 && palace.ministries.every((m) => m.decrees.length === 5));
    const missing = palace.ministries.flatMap((m) => [...m.base, ...m.decrees.flatMap((d) => d.b)]).filter((g) => !itemBy.get(g)?.pal);
    check('Palast: alle Effekte als Palast-Einträge in items.json', missing.length === 0, missing.join(', '));
    check('Palast: 25 Prestige-Stufen je Ministerium', palace.ministries.every((m) => m.para.length === 25));
    const fxv = (fx, k) => {
      const v = fx.find((e) => e.k === k)?.v;
      return typeof v === 'number' ? v : v?.v;
    };
    const labour = M.Productivity;
    const base = itemBy.get(labour?.base[0]);
    check('Ministerium für Arbeit: +10 % Produktivität, Prestige 25: +60 %', fxv(base?.fx ?? [], 'ProductivityUpgrade') === 10 && fxv(labour.para[24][0], 'ProductivityUpgrade') === 60);
    const dec = (k, name) => M[k]?.decrees.find((d) => d.n.de === name);
    const fi = dec('Productivity', 'Fabrikinspektionen');
    check('Fabrikinspektionen: −50 % Arbeitskraft ab 5.200', fi?.at === 5200 && fxv(itemBy.get(fi.b[0])?.fx ?? [], 'WorkforceAmountUpgrade') === -50);
    const us = dec('Productivity', 'Gewerkschaftsförderung');
    check('Gewerkschaftsförderung: +1 Sockel je Handelskammer ab 6.750', us?.at === 6750 && fxv(itemBy.get(us.b[0])?.fx ?? [], 'SocketCountUpgrade') === 1 && itemBy.get(us.b[0])?.tgx.includes(1010516));
    const gal = dec('Productivity', 'Förderung des Galvanismus');
    check('Förderung des Galvanismus: +50 % Strombonus ab 3.850', gal?.at === 3850 && fxv(itemBy.get(gal.b[0])?.fx ?? [], 'ElectricityBoostUpgrade') === 50);
    const via = items.filter((i) => i.pal?.m === 'Productivity' && i.pal.via).every((i) => i.pal.via.every((v) => v.r === 15 && v.x.length === 1 && v.x[0] === 1010516));
    check('Arbeits-Effekte nur über Handelskammern der Alten Welt (Radius 15)', via);
    const regs = palace.buildings.map((g) => byGuid.get(g)?.reg?.join('/'));
    check('Palast und Regionalministerium nur in der Alten Welt', regs.every((r) => r === 'ow'), regs.join(', '));
    const welfare = itemBy.get(M.Service?.base[0]);
    console.log(`info   Wohlfahrt: öffentliche Gebäude +${fxv(welfare?.fx ?? [], 'PublicServiceFullSatisfactionDistance')} Reichweite (Spielwert), Prestige 25: +${fxv(M.Service.para[24][0], 'PublicServiceFullSatisfactionDistance')}; Ziele: ${welfare?.tgx.length} Gebäude`);
    console.log(`info   Palast-Reichweite: ${palace.range.base} + ${palace.range.perWing} je Flügel (Spielwert); Prestige ab ${palace.paragon.first}, je ${palace.paragon.step}`);
  }
}

// 3. Lücken
const noSize = buildings.filter((b) => !b.sz && b.c !== 'ornament' && b.c !== 'module');
console.log(`info   ${noSize.length} Gebäude (ohne Zierde/Module) ohne Grundfläche im Anno Designer`);
const noTargets = items.filter((i) => !i.tg.length && i.fx.length && ['GuildHouse', 'TownHall', 'HarborOffice'].includes(i.s));
console.log(`info   ${noTargets.length} HK/Rathaus/Hafenmeisterei-Items mit Effekt, aber ohne Zielgebäude`);
console.log(`info   ${buildings.filter((b) => b.costInh).length} Gebäude mit Kosten aus der Vorlage (templates.xml)`);

console.log(failed ? `\n${failed} Fehler` : '\nAlles in Ordnung');
process.exit(failed ? 1 : 0);
