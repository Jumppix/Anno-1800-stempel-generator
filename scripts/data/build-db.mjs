// Spieldatenbank aufbereiten: Rohdaten → public/db/*.json (+ Icons).
//
// Quellen (siehe docs/PLAN_Datenbank.md):
//   research/raw/anno-toolkit      assets.xml als JSON (je Vorlage), Texte de/en, Icons (PNG)
//   research/raw/Anno1800Calculator js/params.js – Gegenprobe Produktion, DLCs
//   research/presets.json          Anno Designer – Grundfläche, Einflussradius/-reichweite
// Aufruf: npm run build-db   (vorher einmalig: bash scripts/data/fetch-sources.sh)
//
// Wichtig: Der anno-toolkit-Abzug enthält nur Einträge mit eigener Vorlage
// (keine über BaseAssetGUID abgeleiteten) und keine Vorlagen-Standardwerte
// (templates.xml). Fehlende Felder sind deshalb „unbekannt“, nicht 0 –
// sobald assets.xml/templates.xml vom Nutzer vorliegen, wird ergänzt.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const RAW = join(ROOT, 'research/raw');
const TK = join(RAW, 'anno-toolkit');
// Hauptquelle: Spieldateien des Nutzers (scripts/data/convert-game.py → research/raw/game),
// sonst der anno-toolkit-Abzug. Icons kommen immer aus dem anno-toolkit.
const GAME = join(RAW, 'game');
const FROM_GAME = existsSync(join(GAME, 'assets'));
const ASSETS = FROM_GAME ? join(GAME, 'assets') : join(TK, 'data/anno/assets');
const TEXTS = FROM_GAME ? join(GAME, 'texts') : join(TK, 'data/anno/texts');
const GAME_INFO = (() => {
  try {
    return JSON.parse(readFileSync(join(GAME, 'source.json'), 'utf8'));
  } catch {
    return null;
  }
})();
const CALC = join(RAW, 'Anno1800Calculator/js/params.js');
const PRESETS = join(ROOT, 'research/presets.json');
const OUT = join(ROOT, 'public/db');
const ICONS_OUT = join(OUT, 'icons');

if (!existsSync(ASSETS)) {
  console.error('Rohdaten fehlen: zuerst  bash scripts/data/fetch-sources.sh');
  process.exit(1);
}

// ---------------------------------------------------------------- Hilfen
const arr = (x) => (x === undefined || x === null || x === '' ? [] : Array.isArray(x) ? x : [x]);
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const commit = (dir) => {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

const cleanText = (t) =>
  typeof t !== 'string'
    ? t === undefined || t === null
      ? undefined
      : String(t)
    : t
        .replace(/​/g, '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || undefined;

// ---------------------------------------------------------------- Laden
console.log('Lade Assets …');
const byGuid = new Map();
const byTemplate = new Map();
for (const f of readdirSync(ASSETS)) {
  const list = JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
  if (!Array.isArray(list)) continue;
  for (const a of list) {
    const g = a?.Values?.Standard?.GUID;
    if (typeof g !== 'number') continue;
    const rec = { g, t: a.Template, v: a.Values };
    byGuid.set(g, rec);
    if (!byTemplate.has(a.Template)) byTemplate.set(a.Template, []);
    byTemplate.get(a.Template).push(rec);
  }
}
const textsDe = JSON.parse(readFileSync(join(TEXTS, 'texts_german.json'), 'utf8'));
const textsEn = JSON.parse(readFileSync(join(TEXTS, 'texts_english.json'), 'utf8'));
const txt = (id) => {
  if (id === undefined || id === null || id === '') return undefined;
  const de = cleanText(textsDe[id]);
  const en = cleanText(textsEn[id]);
  return de || en ? { de: de ?? en, en: en ?? de } : undefined;
};
console.log(`  ${byGuid.size} Assets, ${byTemplate.size} Vorlagen`);

const presets = new Map();
for (const b of JSON.parse(readFileSync(PRESETS, 'utf8')).Buildings) {
  if (b.Header === '(A7) Anno 1800' && typeof b.Guid === 'number') presets.set(b.Guid, b);
}

let calc = null;
if (existsSync(CALC)) {
  const s = readFileSync(CALC, 'utf8');
  calc = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
}
const calcFactory = new Map((calc?.factories ?? []).map((f) => [f.guid, f]));
const calcDlc = new Map((calc?.dlcs ?? []).map((d) => [d.id, d.guid]));

// ---------------------------------------------------------------- Namen / Icons
const referenced = new Set(); // GUIDs, deren Namen die Oberfläche braucht
const ref = (g) => {
  if (typeof g === 'number' && g > 0) referenced.add(g);
  return g;
};
const iconsUsed = new Map(); // Ausgabename → Quelldatei
const icon = (path) => {
  if (typeof path !== 'string' || !path.startsWith('data/ui/2kimages/')) return undefined;
  const rel = path.slice('data/ui/2kimages/'.length).replace(/\.png$/, '');
  const src = join(TK, 'public/img', `${rel}_0.png`);
  if (!existsSync(src)) return undefined;
  const name = rel.replace(/^main\//, '').replace(/[\/]/g, '-') + '.webp';
  iconsUsed.set(name, src);
  return name;
};
const nameOf = (rec) => txt(rec.g) ?? (rec.v?.Text?.LocaText?.English?.Text ? { de: rec.v.Text.LocaText.English.Text, en: rec.v.Text.LocaText.English.Text } : undefined);

// ---------------------------------------------------------------- Effekt-Beschriftungen (Spieltexte)
const EFFECT_LABELS = {
  ProductivityUpgrade: 118000, MaintenanceUpgrade: 2320, ReplaceInputs: 20081, AttractivenessUpgrade: 145011,
  AdditionalOutput: 20074, ReplacingWorkforce: 12480, WorkforceAmountUpgrade: 12337, ModuleLimitPercent: 12075,
  NeededAreaPercentUpgrade: 15319, IncidentFireIncreaseUpgrade: 12225, ProvideIndustrialization: 12485,
  IncidentExplosionIncreaseUpgrade: 14292, IncidentRiotIncreaseUpgrade: 14290, PipeCapacityUpgrade: 127395,
  RiotInfluenceUpgrade: 14513, AdditionalHappiness: 12314, ResolverUnitDecreaseUpgrade: 21508,
  ResolverUnitMovementSpeedUpgrade: 12012, ResolverUnitCountUpgrade: 3897, AddedFertility: 23371,
  PublicServiceFullSatisfactionDistance: 2321, InputBenefitModifier: 12690, ResidentsUpgrade: 2322,
  TaxModifierInPercent: 12677, IncidentIllnessIncreaseUpgrade: 12226, NeedProvideNeedUpgrade: 12315,
  StressUpgrade: 2323, GoodConsumptionUpgrade: 21386, WorkforceModifierInPercent: 12676, InputAmountUpgrade: 23509,
  SpecialUnitHappinessThresholdUpgrade: 21593, BlockHostileTakeover: 15801, SpawnProbabilityFactor: 20084,
  ConstructionCostInPercent: 12723, AddAssemblyOptions: 21494, BaseDamageUpgrade: 2334, AttackSpeedUpgrade: 2336,
  Hitpoints: 2333, GenProbability: 12920, GenPool: 12315, BlockBuyShare: 15802, HappinessIgnoresMorale: 15811,
  MaxHitpointsUpgrade: 1154, AttackRangeUpgrade: 12021, HitpointDamage: 2334, LineOfSightRangeUpgrade: 15266,
  SelfHealUpgrade: 15195, SelfHealPausedTimeIfAttackedUpgrade: 15196, HealRadiusUpgrade: 15264,
  HealPerMinuteUpgrade: 15265, HealBuildingsPerMinuteUpgrade: 15265, AccuracyUpgrade: 12062, PierSpeedUpgrade: 15197,
  DamageReceiveFactor: 19136, MoraleDamage: 9499, IncidentArcticIllnessIncreaseUpgrade: 22982, HeatRangeUpgrade: 2321,
  ForwardSpeedUpgrade: 2339, IgnoreDamageFactorUpgrade: 15262, LoadingSpeedUpgrade: 15197,
  IgnoreWeightFactorUpgrade: 15261, MaintainanceUpgrade: 2320, ActiveTradePriceInPercent: 15198,
};
const EXPEDITION_LABELS = {
  Might: 800004, Faith: 800028, Diplomacy: 800029, Hunting: 800030, Medicine: 800031, Melee: 800032,
  Navigation: 800033, Crafting: 800034, PerkFormerPirate: 191598, PerkMale: 15797, PerkFemale: 15798,
  PerkZoologist: 9998, PerkHypnotist: 3929, PerkAnthropologist: 3928, PerkArcheologist: 12262,
  PerkEntertainer: 12261, PerkPolyglot: 12266, PerkJackOfAllTraits: 12260,
};
const RARITY_LABELS = { common: 118002, uncommon: 118003, rare: 118004, epic: 118005, legendary: 118006, narrative: 19850 };
const IGNORED_EFFECTS = new Set(['ChangeModule', 'AdditionalModuleSoundLoop', 'ForcedFeedbackVariation', 'HideBuff', 'PublicServiceNoSatisfactionDistance']);
// Testpool „GGJ Items“ (aus anno-toolkit übernommen)
const IGNORED_ITEMS = new Set([24012, 24014, 24016, 24018, 24019, 24023, 24033, 24034, 24036, 24043, 24044, 24054, 24048, 24061, 24064, 24065, 24068, 24077, 24078, 24079, 24081, 24082, 24086, 24087, 24100, 24107, 24108, 24109, 24113, 24114, 24151, 24152, 24153, 24154, 24155, 24159, 24160, 24162, 24163, 24164, 24179, 24191, 24192, 24195, 24196, 24197, 24201, 24199, 24198, 24248, 24286, 24368, 24372, 24373, 24656, 24655, 24654]);

/** Werte normalisieren: {Value, Percental} → {v, pct}; Listen {Item: …} → Arrays; GUID-Verweise merken. */
function norm(x, key = '') {
  if (x === '' || x === undefined || x === null) return undefined;
  if (typeof x === 'number') {
    if (x >= 1000 && Number.isInteger(x) && (byGuid.has(x) || textsDe[x])) ref(x);
    return x;
  }
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return x.map((y) => norm(y)).filter((y) => y !== undefined);
  if (isObj(x)) {
    if ('Value' in x && Object.keys(x).every((k) => k === 'Value' || k === 'Percental')) {
      return x.Percental ? { v: x.Value, pct: true } : x.Value;
    }
    if ('Item' in x && Object.keys(x).length === 1) return norm(arr(x.Item));
    const out = {};
    for (const [k, v] of Object.entries(x)) {
      const n = norm(v, k);
      if (n !== undefined) out[k] = n;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return x;
}

/** Für die Rohansicht: Darstellungs-/Tonfelder weglassen. */
const NOISE = new Set(['Object', 'Mesh', 'SoundEmitter', 'Selection', 'FeedbackController', 'Infolayer', 'AmbientMoodProvider', 'Text', 'Blocking', 'MinimapToken', 'Audio', 'Nameable', 'QuestObject']);
function stripNoise(v) {
  const out = {};
  // Leere Komponenten bleiben sichtbar: vorhanden, alle Werte aus der Vorlage.
  for (const [k, x] of Object.entries(v)) if (!NOISE.has(k)) out[k] = x === '' ? '(Vorlage)' : x;
  return out;
}

// ---------------------------------------------------------------- Effektziele
const pools = new Map((byTemplate.get('ItemEffectTargetPool') ?? []).map((r) => [r.g, r]));
function expandTargets(g, seen = new Set()) {
  if (seen.has(g)) return [];
  seen.add(g);
  const pool = pools.get(g);
  if (!pool) return [g];
  return arr(pool.v.ItemEffectTargetPool?.EffectTargetGUIDs?.Item).flatMap((t) => expandTargets(t.GUID, seen));
}
const rewardPools = new Map((byTemplate.get('RewardPool') ?? []).map((r) => [r.g, r]));

// ---------------------------------------------------------------- Items
const ITEM_TEMPLATES = {
  GuildhouseItem: 'GuildHouse',
  TownhallItem: 'TownHall',
  HarborOfficeItem: 'HarborOffice',
  CultureItem: 'Zoo',
  ShipSpecialist: 'Ship',
  VehicleItem: 'Ship',
  ActiveItem: 'Ship',
  ItemSpecialAction: undefined,
  ItemSpecialActionVisualEffect: undefined,
  ItemWithUI: undefined, // nur mit Allocation (Bauerlaubnis)
  ItemWithUICrafting: undefined,
  // Palast-Effekte (Palastflügel/Ministerien), kein Item-Teil: Platz „Palace“
  GuildhouseBuff: 'Palace',
  TownhallBuff: 'Palace',
  HarbourOfficeBuff: 'Palace',
  CultureBuff: 'Palace',
};
const BUFF_TEMPLATES = new Set(['GuildhouseBuff', 'TownhallBuff', 'HarbourOfficeBuff', 'CultureBuff']);
// Palast-Erlasse/Ministerien: EffectContainer mit Palast-Icon verweisen auf die Buff-Assets.
const palaceEffects = new Set();
for (const rec of byTemplate.get('EffectContainer') ?? []) {
  if (!/3dicons\/palace\//.test(rec.v.Standard?.IconFilename ?? '')) continue;
  for (const e of arr(rec.v.EffectContainer?.Effects?.Item)) if (typeof e?.Effect === 'number') palaceEffects.add(e.Effect);
}
console.log('Items …');
const items = [];
const itemsRaw = {};
for (const [tmpl, defSlot] of Object.entries(ITEM_TEMPLATES)) {
  for (const rec of byTemplate.get(tmpl) ?? []) {
    const v = rec.v;
    const isBuff = BUFF_TEMPLATES.has(tmpl);
    if (isBuff && !palaceEffects.has(rec.g)) continue;
    if ((!isObj(v.Item) && !isBuff) || IGNORED_ITEMS.has(rec.g)) continue;
    const item = isObj(v.Item) ? v.Item : {};
    const slot = isBuff ? defSlot : item.Allocation ?? defSlot;
    if (!slot) continue;
    const name = nameOf(rec);
    if (!name) continue;
    const effects = [];
    for (const [grp, block] of Object.entries(v)) {
      if (!grp.endsWith('Upgrade') || !isObj(block)) continue;
      for (const [k, raw] of Object.entries(block)) {
        if (IGNORED_EFFECTS.has(k)) continue;
        let val = norm(raw, k);
        if (k === 'GenPool' && rewardPools.has(raw)) {
          val = arr(rewardPools.get(raw).v.RewardPool?.ItemsPool?.Item).map((p) => ref(p.ItemLink));
        }
        if (k === 'ReplacingWorkforce') ref(raw);
        if (val === undefined) continue;
        effects.push({ grp, k, v: val });
      }
    }
    const targets = arr(v.ItemEffect?.EffectTargets?.Item).map((t) => t.GUID).filter((g) => typeof g === 'number');
    const expanded = [...new Set(targets.flatMap((g) => expandTargets(g)))];
    targets.forEach(ref);
    expanded.forEach(ref);
    const exp = arr(v.ExpeditionAttribute?.ExpeditionAttributes?.Item)
      .filter((a) => isObj(a) && a.Attribute)
      .map((a) => ({ k: a.Attribute, v: a.Amount ?? 1 }));
    const dlc = v.Locked?.DLCDependency;
    if (dlc) ref(dlc);
    items.push({
      g: rec.g,
      t: tmpl,
      n: name,
      d: txt(v.Standard.InfoDescription),
      i: icon(v.Standard.IconFilename),
      r: (item.Rarity ?? 'Common').toLowerCase(),
      s: slot,
      it: item.ItemType,
      p: item.TradePrice,
      tg: targets,
      tgx: expanded,
      fx: effects,
      ex: exp.length ? exp : undefined,
      dlc,
      act: v.ItemAction && v.ItemAction !== '' ? true : undefined,
    });
    itemsRaw[rec.g] = norm(stripNoise(v));
  }
}
console.log(`  ${items.length} Items`);

// ---------------------------------------------------------------- Gebäude
const SKIP_TEMPLATES = new Set(['QuestLighthouse', 'Slot', 'SimpleBuilding', 'CampaignUncleMansion', 'OrnamentalNotes', 'QuestObjectHarborBuildingAttacker', 'HarborWarehouseSlot7']);
const CATEGORY = [
  [/^Residence/, 'residence'],
  [/^(PublicService|Mall|CityInstitution|Market|Restaurant|TowerRestaurant|PostBox|Powerplant|Heater)/, 'public'],
  [/^(Factory|Farm|FreeArea|Heavy|SlotFactory|Multifactory|RecipeFarm|OilPump|FertilizerBase|Hacienda$|BuffFactory$|BuffFactoryCulture)/, 'production'],
  [/^(Farmfield|FactoryModule|BuffFactoryModule|AdditionalModule|FertilizerBaseModule|CultureModule|OrnamentalModule|PalaceModule|BuildPermitModules|Airship.*Module|AirshipPost|Dockland.*Module|DocklandModule)/, 'module'],
  [/^(Guildhouse|Palace|PalaceMinistry|ResearchCenter|Monument|Culture)/, 'special'],
  [/^(Harbor|Warehouse|Dockland|Visitor|Shipyard|Repair|WorkforceConnector)/, 'harbor'],
  [/^(Street|Bridge|Busstop|Airship|Irrigation)/, 'infrastructure'],
  [/^(Ornamental|HarborOrnament|BuildPermitBuilding)/, 'ornament'],
];
const REGION = { Moderate: 'ow', Colony01: 'nw', Arctic: 'arctic', Africa: 'africa' };
const categoryOf = (t) => CATEGORY.find(([re]) => re.test(t))?.[1] ?? 'other';

// Geerbte Kosten (VectorElement/InheritedIndex): Die Ware steht in der Vorlage
// (templates.xml). Abgeleitet nur für Vorlagen, deren ausgeschriebene
// Kostenlisten alle der Standardfolge entsprechen; sonst „unbekannt“.
const STD_COST = [1010017, 1010196, 1010205, 1010218, 1010207, 1010202];
const stdCostTemplates = new Set();
{
  const ok = new Map();
  for (const rec of byGuid.values()) {
    const list = arr(rec.v?.Cost?.Costs?.Item);
    if (!list.length || list.some((c) => c?.VectorElement)) continue;
    const good = list.slice(0, STD_COST.length).every((c, i) => c?.Ingredient === STD_COST[i]);
    ok.set(rec.t, (ok.get(rec.t) ?? true) && good);
  }
  for (const [tmpl, good] of ok) if (good) stdCostTemplates.add(tmpl);
}

// Bauphasen (Monumente): Monument.UpgradeTarget verkettet die Phasen.
const nextPhase = new Map();
const hasPrev = new Set();
for (const rec of byGuid.values()) {
  const target = isObj(rec.v?.Monument) ? rec.v.Monument.UpgradeTarget : undefined;
  if (typeof target === 'number' && byGuid.has(target)) {
    nextPhase.set(rec.g, target);
    hasPrev.add(target);
  }
}
const phaseChain = new Map(); // GUID → Liste aller Phasen (Start bis Ende)
for (const start of nextPhase.keys()) {
  if (hasPrev.has(start)) continue;
  const chain = [start];
  for (let g = nextPhase.get(start); g !== undefined && !chain.includes(g); g = nextPhase.get(g)) chain.push(g);
  for (const g of chain) phaseChain.set(g, chain);
}

// Arbeitskraft → Region (Name der Arbeitskraft-Ware: moderate/colony/arctic/africa …)
const WF_REGION = { moderate: 'ow', colony: 'nw', arctic: 'arctic', africa: 'africa' };
const workforceRegion = new Map();
for (const r of byTemplate.get('Product') ?? []) {
  if (!isObj(r.v.Product) || !r.v.Product.IsWorkforce) continue;
  const key = String(r.v.Standard.Name ?? '').split(' ')[0].toLowerCase();
  if (WF_REGION[key]) workforceRegion.set(r.g, WF_REGION[key]);
}

console.log('Gebäude …');
const buildings = [];
const buildingsRaw = {};
for (const rec of byGuid.values()) {
  const v = rec.v;
  if (!('Building' in v) || !('Constructable' in v) || SKIP_TEMPLATES.has(rec.t)) continue;
  if (/^CreativeMode|^Campaign/i.test(v.Standard.Name ?? '')) continue;
  // Test- und Kampagnen-Gebäude (z. B. „GASOLINE TEST“, „Edvards Holzhof“)
  if (/\bTEST\b|Testr|Edvard/.test(`${v.Standard.Name ?? ''} ${v.Text?.LocaText?.English?.Text ?? ''} ${textsEn[rec.g] ?? ''}`)) continue;
  const name = nameOf(rec);
  if (!name) continue;
  const p = presets.get(rec.g);
  // Region: Spielangabe; fehlt sie (Vorlagen-Standard), aus der Vorlage bzw. der Arbeitskraft ableiten.
  // Standard der Eigenschaft („Meta;Moderate;…“ = überall) gilt als „nicht angegeben“.
  const regions = isObj(v.Building) && v.Building.AssociatedRegions && !String(v.Building.AssociatedRegions).includes('Meta')
    ? String(v.Building.AssociatedRegions).split(';').map((r) => REGION[r] ?? r)
    : /_Arctic$/.test(rec.t)
      ? ['arctic']
      : /Africa/.test(rec.t)
        ? ['africa']
        : (() => {
            const wf = arr(v.Maintenance?.Maintenances?.Item).map((m) => workforceRegion.get(m.Product)).find(Boolean);
            return wf ? [wf] : undefined;
          })();
  const costItems = arr(v.Cost?.Costs?.Item);
  const cost = [];
  let costInherited;
  for (const c of costItems) {
    if ((c?.Amount ?? 0) <= 0) continue;
    if (typeof c.Ingredient === 'number') cost.push({ p: ref(c.Ingredient), a: c.Amount });
    else if (c.VectorElement) {
      const idx = c.VectorElement.InheritedIndex ?? 0;
      if (stdCostTemplates.has(rec.t) && idx < STD_COST.length) cost.push({ p: ref(STD_COST[idx]), a: c.Amount, inf: 1 });
      else costInherited = true;
    }
  }
  const maint = arr(v.Maintenance?.Maintenances?.Item)
    .filter((m) => typeof m.Product === 'number')
    .map((m) => ({ p: ref(m.Product), a: m.Amount ?? 0, ia: m.InactiveAmount }));
  const fb = isObj(v.FactoryBase) ? v.FactoryBase : undefined;
  const io = (x) => arr(x?.Item).filter((e) => typeof e.Product === 'number').map((e) => ({ p: ref(e.Product), a: e.Amount ?? 1 }));
  const inputs = fb ? io(fb.FactoryInputs) : [];
  const outputs = fb ? io(fb.FactoryOutputs) : [];
  const ct = fb?.CycleTime;
  const cf = calcFactory.get(rec.g);
  const ps = isObj(v.PublicService) ? v.PublicService : undefined;
  const psOut = arr(ps?.PublicServiceOutputs?.Item).map((o) => ref(o.Product)).filter(Boolean);
  const dlc = v.Locked?.DLCDependency ?? (cf?.dlcs?.length ? calcDlc.get(cf.dlcs[0]) : undefined);
  if (dlc) ref(dlc);
  const res = isObj(v.Residence7) ? v.Residence7 : undefined;
  // Farmen und Flächengebäude (Wald) laufen im Spiel ohne Strom; der Vorlagen-Standard
  // von Industrializable ist dort unbekannt → nur ausdrückliche Angaben/„Electrifiable“-Vorlagen.
  const noPowerDefault = (isObj(v.ModuleOwner) || 'FreeAreaProductivity' in v) && !/Electrifiable/.test(rec.t);
  if (res?.PopulationLevel7) ref(res.PopulationLevel7);
  buildings.push({
    g: rec.g,
    t: rec.t,
    c: categoryOf(rec.t),
    n: name,
    d: txt(v.Standard.InfoDescription),
    i: icon(v.Standard.IconFilename),
    reg: regions,
    sz: p ? [p.BuildBlocker.x, p.BuildBlocker.z] : undefined,
    rad: p?.InfluenceRadius || undefined,
    rng: p?.InfluenceRange || undefined,
    road: p ? p.Road : undefined,
    cost: cost.length ? cost : undefined,
    costInh: costInherited,
    mt: maint.length ? maint : undefined,
    in: inputs.length ? inputs : undefined,
    out: outputs.length ? outputs : undefined,
    ct,
    calcTpm: cf?.tpmin,
    ps: ps ? { full: ps.FullSatisfactionDistance, none: ps.NoSatisfactionDistance, out: psOut.length ? psOut : undefined } : undefined,
    pw: isObj(v.Powerplant) ? v.Powerplant.IndustrializationDistance : undefined,
    // Strom: Komponente Industrializable (auch leer = Vorlagen-Standard: Bonus, nicht Pflicht).
    // MandatoryIndustrialization 1 = läuft nur mit Strom; BoostedByIndustrialization 0 = Strom ohne Wirkung.
    pow: 'Industrializable' in v && (!noPowerDefault || (isObj(v.Industrializable) && v.Industrializable.MandatoryIndustrialization))
      ? isObj(v.Industrializable) && v.Industrializable.MandatoryIndustrialization
        ? 'req'
        : isObj(v.Industrializable) && v.Industrializable.BoostedByIndustrialization === 0
          ? undefined
          : 'opt'
      : undefined,
    // Strombonus (+100 % laut annolayouts.de): Industrializable vorhanden und nicht BoostedByIndustrialization 0.
    eb: 'Industrializable' in v && !noPowerDefault && !(isObj(v.Industrializable) && v.Industrializable.BoostedByIndustrialization === 0) ? 1 : undefined,
    // Bauart für den Handelskammer-Packer: Farm (Felder), Mine (Vorkommen), Fläche (Wald/Gebiet), sonst Fabrik.
    kind: /Water|Coast/.test(isObj(v.Building) ? String(v.Building.TerrainType ?? '') : '')
      ? 'coast'
      : isObj(v.ModuleOwner)
      ? 'farm'
      : 'Slot' in v || /^(SlotFactory|OilPump)/.test(rec.t)
        ? 'mine'
        : 'FreeAreaProductivity' in v
          ? 'area'
          : undefined,
    mods: isObj(v.ModuleOwner)
      ? {
          g: arr(v.ModuleOwner.ConstructionOptions?.Item ?? v.ModuleOwner.ConstructionOptions).map((o) => ref(o?.ModuleGUID)).filter(Boolean),
          n: v.ModuleOwner.ModuleLimits?.Main?.Limit,
        }
      : undefined,
    sock: isObj(v.ItemContainer) ? { r: v.ItemContainer.SocketScopeRadius, a: v.ItemContainer.SocketAllocation } : undefined,
    res: res ? { lvl: res.PopulationLevel7, max: res.ResidentMax } : undefined,
    up: isObj(v.Upgradable) && v.Upgradable.NextGUID ? ref(v.Upgradable.NextGUID) : undefined,
    ph: phaseChain.get(rec.g)?.map(ref),
    dlc,
  });
  buildingsRaw[rec.g] = norm(stripNoise(v));
}
console.log(`  ${buildings.length} Gebäude`);

// ---------------------------------------------------------------- Waren, Bevölkerung, Zielgruppen (Infofenster)
const goods = {};
for (const tmpl of ['Product', 'Product_Ammunition']) {
  for (const rec of byTemplate.get(tmpl) ?? []) {
    const pr = isObj(rec.v.Product) ? rec.v.Product : {};
    const regs = String(pr.AssociatedRegion ?? '')
      .split(';')
      .filter(Boolean)
      .map((r) => REGION[r] ?? r);
    if (pr.ProductCategory) ref(pr.ProductCategory);
    goods[rec.g] = {
      d: txt(rec.v.Standard?.InfoDescription),
      cat: pr.ProductCategory,
      price: pr.BasePrice,
      civ: pr.CivLevel,
      reg: regs.length ? regs : undefined,
      wf: pr.IsWorkforce ? 1 : undefined,
    };
    ref(rec.g);
  }
}
// Bevölkerungsstufen: Wohnhaus, Arbeitskraft je vollem Haus, Bedürfnisse.
// Verbrauch (t/min je Einwohner) und Einwohner je Bedürfnis aus dem Anno-1800-Rechner,
// sonst Spielwert × 1,2 (Umrechnung wie im Rechner).
const calcLevels = new Map((calc?.populationLevels ?? []).map((l) => [l.guid, l]));
const population = {};
for (const rec of byTemplate.get('PopulationLevel7') ?? []) {
  const pl = isObj(rec.v.PopulationLevel7) ? rec.v.PopulationLevel7 : {};
  const cl = calcLevels.get(rec.g);
  const calcNeeds = new Map((cl?.needs ?? []).map((n) => [n.guid, n]));
  const needs = arr(pl.PopulationInputs?.Item)
    .filter((i) => typeof i?.Product === 'number')
    .map((i) => {
      const c = calcNeeds.get(i.Product);
      return {
        p: ref(i.Product),
        t: c ? c.tpmin : i.Amount ? i.Amount * 1.2 : undefined,
        r: c ? c.residents || undefined : i.SupplyWeight,
        h: c ? c.happiness || undefined : i.HappinessValue,
        from: i.NoWeightPopulationCount !== undefined ? i.NoWeightPopulationCount + 1 : undefined,
        bonus: i.IsBonusNeed ? 1 : undefined,
        unlock: isObj(i.AdditionalGlobalUnlockRequirement) && i.AdditionalGlobalUnlockRequirement.Population
          ? [ref(i.AdditionalGlobalUnlockRequirement.Population), i.AdditionalGlobalUnlockRequirement.MinPopulationAmount ?? 0]
          : undefined,
      };
    });
  population[rec.g] = {
    res: typeof pl.DefaultResidence === 'number' ? ref(pl.DefaultResidence) : undefined,
    max: cl?.fullHouse,
    out: arr(pl.PopulationOutputs?.Item)
      .filter((o) => typeof o?.Product === 'number')
      .map((o) => ({ p: ref(o.Product), a: o.Amount })),
    needs,
  };
  ref(rec.g);
}
// Zielgruppen der Items (z. B. „Alle Minen und Zementwerke“) mit Mitgliedern
const targetPools = {};
for (const it of items) for (const g of it.tg) if (targetPools[g] === undefined && pools.has(g)) targetPools[g] = expandTargets(g).map(ref);

// ---------------------------------------------------------------- Namen aller Verweise
for (const b of buildings) ref(b.g);
for (const i of items) ref(i.g);
const names = {};
for (const g of referenced) {
  const rec = byGuid.get(g);
  const n = rec ? nameOf(rec) : txt(g);
  if (!n) continue;
  const ic = rec ? icon(rec.v?.Standard?.IconFilename) : undefined;
  names[g] = ic ? [n.de, n.en, ic] : [n.de, n.en];
}

// Beschriftungen aus den Spieltexten
const labels = { effects: {}, rarity: {}, expedition: {} };
for (const [k, id] of Object.entries(EFFECT_LABELS)) {
  const t = txt(id);
  if (t) labels.effects[k] = [t.de, t.en];
}
for (const [k, id] of Object.entries(EXPEDITION_LABELS)) {
  const t = txt(id);
  if (t) labels.expedition[k] = [t.de, t.en];
}
for (const [k, id] of Object.entries(RARITY_LABELS)) {
  const t = txt(id);
  if (t) labels.rarity[k] = [t.de, t.en];
}

// ---------------------------------------------------------------- Schreiben
// Nur eigene Ausgaben ersetzen (prod.json von build-prod bleibt erhalten).
rmSync(ICONS_OUT, { recursive: true, force: true });
for (const f of ['items.json', 'buildings.json', 'names.json', 'info.json', 'items-raw.json', 'buildings-raw.json', 'meta.json']) rmSync(join(OUT, f), { force: true });
mkdirSync(ICONS_OUT, { recursive: true });
// Icons als WebP 64 px (Pillow nötig: pip install pillow)
const pairsFile = join(OUT, '_icons.json');
writeFileSync(pairsFile, JSON.stringify([...iconsUsed].map(([name, src]) => [src, join(ICONS_OUT, name)])));
execFileSync('python3', ['-I', join(ROOT, 'scripts/data/shrink-icons.py'), pairsFile], { stdio: 'inherit' });
rmSync(pairsFile);
let iconBytes = 0;
for (const name of iconsUsed.keys()) iconBytes += statSync(join(ICONS_OUT, name)).size;
const write = (file, data) => {
  const s = JSON.stringify(data);
  writeFileSync(join(OUT, file), s);
  return { file, bytes: s.length, sha1: createHash('sha1').update(s).digest('hex').slice(0, 12) };
};
const files = [
  write('items.json', items),
  write('buildings.json', buildings),
  write('names.json', names),
  write('info.json', { goods, population, pools: targetPools }),
  write('items-raw.json', itemsRaw),
  write('buildings-raw.json', buildingsRaw),
];
// Arbeitskraft-Waren (Product.IsWorkforce), Reihenfolge wie im Spiel.
const workforce = (byTemplate.get('Product') ?? [])
  .filter((r) => isObj(r.v.Product) && r.v.Product.IsWorkforce)
  .map((r) => ref(r.g));
const meta = {
  built: new Date().toISOString(),
  workforce,
  sources: [
    ...(FROM_GAME
      ? [{ name: `Spieldateien (${GAME_INFO?.archive ?? 'maindata'}, ${GAME_INFO?.date ?? 'aktuell'})`, url: 'https://www.ubisoft.com/game/anno/1800', commit: null, license: '© Ubisoft', use: 'assets.xml (inkl. abgeleiteter Einträge), Texte de/en' }]
      : []),
    { name: 'anno-toolkit (jansepke)', url: 'https://github.com/jansepke/anno-toolkit', commit: commit(TK), license: 'MIT', use: FROM_GAME ? 'Icons' : 'assets.xml als JSON, Texte, Icons' },
    { name: 'Anno1800Calculator (NiHoel)', url: 'https://github.com/NiHoel/Anno1800Calculator', commit: commit(join(RAW, 'Anno1800Calculator')), license: 'MIT', use: 'Gegenprobe Produktion (t/min), DLC-Zuordnung' },
    { name: 'Anno Designer Presets', url: 'https://github.com/AnnoDesigner/anno-designer', commit: null, license: 'MIT', use: 'Grundfläche, Einflussradius/-reichweite' },
  ],
  counts: { items: items.length, buildings: buildings.length, names: Object.keys(names).length, icons: iconsUsed.size },
  limits: [
    ...(FROM_GAME ? [] : ['Einträge, die ihre Werte über BaseAssetGUID von einem anderen Eintrag erben, fehlen (anno-toolkit übernimmt sie nicht).']),
    'Standardwerte der Vorlagen (templates.xml) fehlen: nicht angegebene Felder sind unbekannt, nicht 0.',
    'Geerbte Baukosten sind nur dort aufgelöst, wo alle Kostenlisten der Vorlage die Standardfolge Münzen, Bretter, Ziegel, Stahlträger, Fenster, Stahlbeton haben (markiert als abgeleitet).',
  ],
  labels,
  files,
};
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(`Fertig: ${items.length} Items, ${buildings.length} Gebäude, ${Object.keys(names).length} Namen, ${iconsUsed.size} Icons (${(iconBytes / 1e6).toFixed(1)} MB)`);
for (const f of files) console.log(`  ${f.file}: ${(f.bytes / 1e6).toFixed(2)} MB`);
