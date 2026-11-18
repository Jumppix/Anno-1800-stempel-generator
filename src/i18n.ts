// Sprachwahl Deutsch/Englisch für die Hilfeseite.
//
// Oberflächentexte stehen in DICT; Spielnamen kommen zweisprachig aus der
// Datenbank (public/db). Elemente mit data-i18n="schlüssel" werden beim
// Umschalten neu beschriftet (data-i18n-ph für Platzhalter, data-i18n-title
// für Tooltips). Die Wahl wird im Browser gespeichert.

export type Lang = 'de' | 'en';

const KEY = 'anno-help-lang';
const listeners = new Set<(lang: Lang) => void>();

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch {
    /* privater Modus */
  }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

let current: Lang = initialLang();

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignorieren */
  }
  document.documentElement.lang = lang;
  applyI18n();
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn: (lang: Lang) => void): void {
  listeners.add(fn);
}

/** Zweisprachiger Wert → aktuelle Sprache. */
export const pick = (v: { de: string; en: string } | [string, string] | undefined): string =>
  !v ? '' : Array.isArray(v) ? (current === 'de' ? v[0] : v[1]) || v[0] : current === 'de' ? v.de : v.en;

const DICT: Record<string, [string, string]> = {
  // Rahmen
  'site.title': ['Anno-1800-Hilfe', 'Anno 1800 Help'],
  'nav.start': ['Übersicht', 'Overview'],
  'nav.db': ['Datenbank', 'Database'],
  'nav.planner': ['Stadtplaner & Stempel', 'City planner & stamps'],
  'footer.fan': [
    'Fanprojekt, nicht offiziell und nicht von Ubisoft unterstützt. Anno 1800, Spielnamen und Icons © Ubisoft.',
    'Fan project, unofficial and not endorsed by Ubisoft. Anno 1800, game names and icons © Ubisoft.',
  ],
  'lang.switch': ['English', 'Deutsch'],
  // Startseite
  'start.lead': [
    'Werkzeuge und Nachschlagewerk für Anno 1800 – Inseln planen, Stempel erzeugen, Gebäude und Items nachschlagen.',
    'Tools and reference for Anno 1800 – plan islands, create stamps, look up buildings and items.',
  ],
  'start.db.title': ['Datenbank', 'Database'],
  'start.db.text': [
    'Alle Gebäude und Items mit Kosten, Unterhalt, Produktion, Reichweiten und Effekten – direkt aus den Spieldaten.',
    'All buildings and items with costs, upkeep, production, ranges and effects – straight from the game data.',
  ],
  'start.planner.title': ['Stadtplaner & Stempel', 'City planner & stamps'],
  'start.planner.text': [
    'Insel aus Stempeln laden, Handelskammern/Rathäuser packen oder eine ganze Hochhaus-Stadt mit maximalen Einwohnern planen und als Stempel exportieren. (Noch nur auf Deutsch.)',
    'Load an island from stamps, pack trade unions/town halls or plan a full skyscraper city with maximum residents and export it as a stamp. (German only for now.)',
  ],
  'start.soon.title': ['Geplant', 'Planned'],
  'start.soon.text': [
    'Baumaterial-Insel, Gelehrten-Insel, Produktion in Handelskammer-Reichweite …',
    'Building-material island, scholar island, production within trade-union range …',
  ],
  'start.open': ['Öffnen', 'Open'],
  // Datenbank
  'db.title': ['Datenbank', 'Database'],
  'db.tab.buildings': ['Gebäude', 'Buildings'],
  'db.tab.items': ['Items', 'Items'],
  'db.search': ['Suchen …', 'Search …'],
  'db.clear': ['Suche löschen', 'Clear search'],
  'db.all': ['Alle', 'All'],
  'db.filter.category': ['Kategorie', 'Category'],
  'db.filter.region': ['Region', 'Region'],
  'db.filter.dlc': ['DLC', 'DLC'],
  'db.filter.slot': ['Platz', 'Slot'],
  'db.filter.rarity': ['Seltenheit', 'Rarity'],
  'db.filter.effect': ['Effekt', 'Effect'],
  'db.base': ['Grundspiel', 'Base game'],
  'db.count': ['{n} Einträge', '{n} entries'],
  'db.count1': ['1 Eintrag', '1 entry'],
  'db.more': ['Weitere anzeigen', 'Show more'],
  'db.loading': ['Lade Daten …', 'Loading data …'],
  'db.error': ['Daten konnten nicht geladen werden.', 'Could not load data.'],
  'db.pick': ['Eintrag links auswählen.', 'Select an entry on the left.'],
  'db.sources': ['Quellen', 'Sources'],
  'db.limits': ['Bekannte Lücken', 'Known gaps'],
  'db.raw': ['Alle Rohwerte aus den Spieldaten', 'All raw values from the game data'],
  // Detail
  'd.general': ['Allgemein', 'General'],
  'd.size': ['Grundfläche', 'Footprint'],
  'd.region': ['Region', 'Region'],
  'd.dlc': ['DLC', 'DLC'],
  'd.template': ['Vorlage', 'Template'],
  'd.cost': ['Baukosten', 'Construction cost'],
  'd.phases': ['Bauphasen', 'Construction phases'],
  'd.phasesTotal': ['Summe aller Phasen', 'Total of all phases'],
  'd.phasesNote': [
    'Kosten je Eintrag laut Spieldaten. Ob der letzte Eintrag (fertiges Gebäude) zusätzlich bezahlt wird, ist noch nicht im Spiel geprüft.',
    'Cost per entry from the game data. Whether the last entry (finished building) is paid in addition is not yet verified in game.',
  ],
  'd.inferred': ['Ware aus der Vorlage abgeleitet (noch unbestätigt)', 'good derived from the template (not yet confirmed)'],
  'd.costInh': ['weitere Kosten aus der Vorlage (noch unbekannt)', 'more costs from the template (not yet known)'],
  'd.upkeep': ['Unterhalt', 'Upkeep'],
  'd.inactive': ['inaktiv', 'inactive'],
  'd.production': ['Produktion', 'Production'],
  'd.inputs': ['Eingang', 'Input'],
  'd.outputs': ['Ausgang', 'Output'],
  'd.cycle': ['Zykluszeit', 'Cycle time'],
  'd.perMin': ['t/min', 't/min'],
  'd.calc': ['laut Anno-1800-Rechner', 'per Anno 1800 Calculator'],
  'd.unknownCycle': ['Zykluszeit steht in templates.xml (folgt)', 'cycle time is in templates.xml (pending)'],
  'd.ranges': ['Reichweiten', 'Ranges'],
  'd.radius': ['Einflussradius (Luftlinie)', 'Influence radius (straight line)'],
  'd.range': ['Einflussreichweite (Straße, Grundwert)', 'Influence range (road, base value)'],
  'd.psFull': ['Volle Versorgung bis (Spielwert)', 'Full supply up to (game value)'],
  'd.psNone': ['Keine Versorgung ab (Spielwert)', 'No supply from (game value)'],
  'd.power': ['Stromreichweite (Spielwert)', 'Power range (game value)'],
  'd.provides': ['Erfüllt', 'Provides'],
  'd.sockets': ['Item-Plätze', 'Item sockets'],
  'd.socketRadius': ['Wirkungsradius', 'Effect radius'],
  'd.residence': ['Wohnen', 'Housing'],
  'd.residents': ['Bewohner (max.)', 'Residents (max.)'],
  'd.tier': ['Bevölkerungsstufe', 'Population level'],
  'd.electric': ['Strom', 'Electricity'],
  'd.powerReq': ['erforderlich – läuft nur mit Strom', 'required – only works with electricity'],
  'd.powerOpt': ['optional – erhöht die Produktivität', 'optional – increases productivity'],
  'd.upgrade': ['Ausbau zu', 'Upgrades to'],
  'd.items': ['Items, die dieses Gebäude beeinflussen', 'Items affecting this building'],
  'd.slot': ['Platz', 'Slot'],
  'd.rarity': ['Seltenheit', 'Rarity'],
  'd.type': ['Art', 'Type'],
  'd.price': ['Handelspreis', 'Trade price'],
  'd.effects': ['Effekte', 'Effects'],
  'd.targets': ['Betrifft', 'Affects'],
  'd.expedition': ['Expedition', 'Expedition'],
  'd.active': ['Aktives Item (eigene Aktion)', 'Active item (own action)'],
  'd.yes': ['ja', 'yes'],
  'd.every': ['alle {n} Zyklen', 'every {n} cycles'],
  'd.everyOne': ['jeden Zyklus', 'every cycle'],
  'd.replace': ['ersetzt', 'replaces'],
  'd.source.preset': ['Quelle: Anno Designer', 'Source: Anno Designer'],
  'd.rangeNote': [
    'Spielwerte sind Grundreichweiten; auf Pflaster etwa ×1,4 (z. B. Kaufhaus 44 → 62 Kacheln).',
    'Game values are base ranges; on paved roads about ×1.4 (e.g. department store 44 → 62 tiles).',
  ],
  // Kategorien
  'cat.residence': ['Wohnen', 'Residences'],
  'cat.public': ['Öffentlich & Versorgung', 'Public & services'],
  'cat.production': ['Produktion', 'Production'],
  'cat.module': ['Module & Felder', 'Modules & fields'],
  'cat.special': ['Besondere Gebäude', 'Special buildings'],
  'cat.harbor': ['Hafen & Logistik', 'Harbour & logistics'],
  'cat.infrastructure': ['Infrastruktur', 'Infrastructure'],
  'cat.ornament': ['Zierde', 'Ornaments'],
  'cat.other': ['Sonstiges', 'Other'],
  // Regionen
  'reg.ow': ['Alte Welt', 'Old World'],
  'reg.nw': ['Neue Welt', 'New World'],
  'reg.arctic': ['Arktis', 'Arctic'],
  'reg.africa': ['Enbesa', 'Enbesa'],
  // Item-Arten
  'itype.Specialist': ['Spezialist', 'Specialist'],
  'itype.Normal': ['Gegenstand', 'Item'],
  // Item-Plätze
  'slot.GuildHouse': ['Handelskammer', 'Trade Union'],
  'slot.TownHall': ['Rathaus', 'Town Hall'],
  'slot.HarborOffice': ['Hafenmeisterei', "Harbourmaster's Office"],
  'slot.Lodge': ['Arktis-Hütte', 'Arctic Lodge'],
  'slot.Zoo': ['Zoo', 'Zoo'],
  'slot.Museum': ['Museum', 'Museum'],
  'slot.BotanicGarden': ['Botanischer Garten', 'Botanical Garden'],
  'slot.Pavilion': ['Weltausstellung', "World's Fair"],
  'slot.Ship': ['Schiff', 'Ship'],
  'slot.Warship': ['Kriegsschiff', 'Warship'],
  'slot.SailShip': ['Segelschiff', 'Sailing ship'],
  'slot.SteamShip': ['Dampfschiff', 'Steamship'],
  'slot.AirShip': ['Luftschiff', 'Airship'],
  'slot.DivingVessel': ['Tauchboot', 'Diving vessel'],
  'slot.AarhantShip': ['Aarhant-Schiff', 'Aarhant ship'],
  'slot.BuildPermit': ['Bauerlaubnis', 'Build permit'],
};

export function t(key: string, vars?: Record<string, string | number>): string {
  const e = DICT[key];
  let s = e ? (current === 'de' ? e[0] : e[1]) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Statische Beschriftungen (data-i18n …) in `root` setzen. */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n ?? '')));
  root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh ?? '')));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle ?? '')));
}

document.documentElement.lang = current;
