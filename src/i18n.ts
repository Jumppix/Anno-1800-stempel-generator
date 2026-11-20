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
  'nav.prod': ['Produktion', 'Production'],
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
  'start.prod.title': ['Produktion & Handelskammer', 'Production & trade union'],
  'start.prod.text': [
    'Alle Produktionsgebäude mit den besten Handelskammer-Items, Produktivität, Ausstoß, Arbeitskraft und dem Layout mit den meisten Gebäuden je Handelskammer – als Stempel.',
    'All production buildings with the best trade-union items, productivity, output, workforce and the layout with the most buildings per trade union – as a stamp.',
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
  // Produktion
  'prod.title': ['Produktion & Handelskammer', 'Production & trade union'],
  'prod.lead': [
    'Je Produktionsgebäude die besten Handelskammer-Items (drei berechnete Vorschläge, per Klick änderbar), Strom, Produktivität, Ausstoß und Arbeitskraft – für ein Gebäude und für alle Gebäude einer Handelskammer.',
    'Per production building the best trade-union items (three computed suggestions, click to change), electricity, productivity, output and workforce – for one building and for all buildings of a trade union.',
  ],
  'prod.clip': ['Geclippt (Item-Effekte ×2)', 'Clipped (item effects ×2)'],
  // Palast & Regionalministerium
  'pal.title': ['Palast & Regionalministerium', 'Palace & Local Department'],
  'pal.loc': ['Wirkung durch', 'Effect from'],
  'pal.loc.none': ['kein Palast-Effekt', 'no palace effect'],
  'pal.loc.palace': ['Palast (Palastinsel)', 'Palace (palace island)'],
  'pal.loc.regional': ['Regionalministerium', 'Local Department'],
  'pal.attr': ['Attraktivität der Palaststadt', 'Attractiveness of the palace city'],
  'pal.prestige': ['Prestige-Stufe {n}', 'Prestige level {n}'],
  'pal.prestigeInfo': [' (ab {a}, je {b} eine Stufe mehr; verstärkt die Ministeriumseffekte)', ' (from {a}, one more level per {b}; strengthens ministry effects)'],
  'pal.ministry': ['Ministerium', 'Ministry'],
  'pal.decreeOf': ['Richtlinie: {m}', 'Policy: {m}'],
  'pal.none': ['keine', 'none'],
  'pal.from': ['ab {n}', 'from {n}'],
  'pal.lockedFrom': ['gesperrt, ab {n}', 'locked, from {n}'],
  'pal.noProd': ['ohne Wirkung auf die Produktion', 'no effect on production'],
  'pal.noneActive': ['Keine Wirkung auf Produktionsgebäude.', 'No effect on production buildings.'],
  'pal.owOnly': [
    'Palast und Regionalministerium gibt es nur in der Alten Welt; ihre Effekte wirken nicht in dieser Region.',
    'The palace and local departments exist only in the Old World; their effects do not apply in this region.',
  ],
  'pal.notePalace': [
    'Auf der Palastinsel wirken alle freigeschalteten Ministerien (Basiseffekt) und je Ministerium eine Richtlinie.',
    'On the palace island every unlocked ministry applies its base effect, plus one policy per ministry.',
  ],
  'pal.noteRegional': [
    'Ein Regionalministerium wirkt mit einem Ministerium und einer seiner Richtlinien (nicht auf der Palastinsel, je Insel höchstens eins).',
    'A local department applies one ministry and one of its policies (not on the palace island, at most one per island).',
  ],
  'pal.note': [
    'Ministerium für Arbeit und seine Richtlinien wirken über die Handelskammern in Straßenreichweite des Palasts/Ministeriums auf Gebäude im Handelskammer-Radius (15); Küstenreformen über Hafenmeisterei (20) bzw. Speicherstadt (30). Freischaltung und Werte aus den Spieldateien. Palast-Effekte werden beim Clipping nicht verdoppelt (Annahme).',
    'The Ministry of Labour and its policies act through trade unions within street range of the palace/department on buildings in the trade-union radius (15); Coastal reforms via harbourmaster (20) or Speicherstadt (30). Unlocks and values from the game files. Palace effects are not doubled by clipping (assumption).',
  ],
  'pal.fx.eb': ['Strombonus', 'Power bonus'],
  'pal.fx.socket': ['+{n} Item-Platz in der Handelskammer', '+{n} item slot in the trade union'],
  'pal.fx.extra': ['Zusatzware jede {n}. Produktion:', 'Extra good every {n}th production:'],
  'slot.Palace': ['Palast', 'Palace'],
  'd.palace': ['Ministerien und Richtlinien', 'Ministries and policies'],
  'd.palaceNote': [
    'Freischaltung über die Attraktivität der Palaststadt. Im Palast wirken alle freigeschalteten Ministerien, je Ministerium eine Richtlinie; ab 9.000 Attraktivität verstärken Prestige-Stufen die Basiseffekte. Werte aus den Spieldateien.',
    'Unlocked by the attractiveness of the palace city. In the palace every unlocked ministry applies, with one policy per ministry; from 9,000 attractiveness prestige levels strengthen the base effects. Values from the game files.',
  ],
  'd.ministryNote': [
    'Ein Regionalministerium wählt ein im Palast freigeschaltetes Ministerium und eine seiner Richtlinien; nur in der Alten Welt, nicht auf der Palastinsel, höchstens eins je Insel. Reichweite abhängig von der Palast-Reichweite (Flügel).',
    'A local department picks one ministry unlocked in the palace and one of its policies; Old World only, not on the palace island, at most one per island. Range depends on the palace range (wings).',
  ],
  'd.palMinistry': ['Ministerium', 'Ministry'],
  'd.palDecree': ['Richtlinie', 'Policy'],
  'd.palBase': ['Basiseffekt des Ministeriums', 'Ministry base effect'],
  'd.palTier': ['Stufe {n}', 'tier {n}'],
  'd.palUnlock': ['Freischaltung', 'Unlock'],
  'd.palAttr': ['ab {n} Attraktivität', 'from {n} attractiveness'],
  'd.palVia': ['Wirkt über', 'Acts through'],
  'd.palRadius': ['Radius {r}', 'radius {r}'],
  'd.paragon': ['Prestige-Stufen', 'Prestige levels'],
  'd.paragonLevel': ['Stufe', 'Level'],
  'd.paragonAttr': ['Attraktivität', 'Attractiveness'],
  'fx.ElectricityBoostUpgrade': ['Strombonus', 'Power bonus'],
  'fx.SocketCountUpgrade': ['Item-Plätze', 'Item slots'],
  'fx.AddDeltas': ['Arbeitskraft je Rathaus', 'Workforce per town hall'],
  'fx.StorageCapacityModifier': ['Lagerkapazität', 'Storage capacity'],
  'fx.IndustrializationRangeUpgrade': ['Strom-Reichweite', 'Electricity range'],
  'fx.InfluenceAmounUpgrade': ['Einfluss', 'Influence'],
  'fx.InfluencePerModuleUpgrade': ['Einfluss je Modul', 'Influence per module'],
  'fx.AttractivenessPerSetUpgrade': ['Attraktivität je Set', 'Attractiveness per set'],
  'fx.BonusRewardAmountUpgrade': ['Zusätzliche Belohnungen', 'Bonus rewards'],
  'fx.OverrideSpecialistPool': ['Spezialisten-Auswahl', 'Specialist pool'],
  'fx.ib.AdditionalMoney': ['Münzen', 'coins'],
  'fx.ib.AdditionalHappiness': ['Zufriedenheit', 'happiness'],
  'fx.ib.AdditionalSupply': ['Versorgung', 'supply'],
  'fx.ib.AdditionalResearch': ['Forschung', 'research'],
  'prod.noWorkforce': ['Ohne Arbeitskraft', 'No workforce'],
  'prod.col.building': ['Gebäude', 'Building'],
  'prod.col.count': ['Anzahl je HK', 'Count per TU'],
  'prod.col.items': ['Handelskammer-Items', 'Trade-union items'],
  'prod.col.power': ['Strom', 'Power'],
  'prod.col.prod': ['Produktivität', 'Productivity'],
  'prod.col.output': ['Ausstoß t/min', 'Output t/min'],
  'prod.col.workforce': ['Arbeitskraft', 'Workforce'],
  'prod.col.goods': ['Zusatzwaren t/min (alle)', 'Extra goods t/min (all)'],
  'prod.setup.max': ['Max', 'Max'],
  'prod.setup.noWorkforce': ['Ohne AK', 'No WF'],
  'prod.setup.noLegendary': ['Ohne Legendär', 'No legendary'],
  'prod.setup.custom': ['eigene Auswahl', 'custom'],
  'prod.slotEmpty': ['Item-Platz – klicken zum Auswählen', 'Item slot – click to choose'],
  'prod.slotClear': ['Platz leeren', 'Clear slot'],
  'prod.pick': ['Item für {b}', 'Item for {b}'],
  'prod.powerOn': ['Strom an (+100 % Produktivität) – klicken zum Ausschalten', 'Power on (+100 % productivity) – click to switch off'],
  'prod.powerOff': ['Strom aus – klicken zum Einschalten', 'Power off – click to switch on'],
  'prod.powerReq': ['Strom erforderlich (+100 % Produktivität)', 'Power required (+100 % productivity)'],
  'prod.powerReqOff': ['Ohne Strom steht dieses Gebäude still', 'Without power this building stops'],
  'prod.powerItem': ['Strom durch {item}', 'Power from {item}'],
  'prod.stopped': ['steht', 'stopped'],
  'prod.layoutTip': ['Layout mit {n} Gebäuden im Radius einer Handelskammer', 'Layout with {n} buildings in one trade-union radius'],
  'prod.layoutTitle': ['{b}: Layout je Handelskammer', '{b}: layout per trade union'],
  'prod.layoutInfo': [
    '{n} Gebäude mit Mittelpunkt im Radius {r} der Handelskammer, alle mit Straßenanschluss ({roads} Straßenkacheln, verbunden mit der Handelskammer).',
    '{n} buildings with their centre inside radius {r} of the trade union, all connected to roads ({roads} road tiles, linked to the trade union).',
  ],
  'prod.layoutNote': [
    'Automatisch berechnet (Straßenreihen + Verbindungsstraße, alle Versätze und Drehungen). Lagerhäuser und Strom sind nicht eingeplant.',
    'Computed automatically (road rows + connecting road, all offsets and rotations). Warehouses and power are not included.',
  ],
  'prod.stamp': ['Stempel herunterladen', 'Download stamp'],
  'prod.stampOnlyOw': ['Stempel-Download vorerst nur für Alte und Neue Welt.', 'Stamp download for the Old and New World only for now.'],
  'prod.applyCount': ['Anzahl {n} übernehmen', 'Use count {n}'],
  'prod.kind.farm': ['Farm mit Feldern – Anzahl selbst eintragen', 'Farm with fields – enter count yourself'],
  'prod.kind.mine': ['Mine – hängt von den Vorkommen ab', 'Mine – depends on deposits'],
  'prod.kind.area': ['Braucht freie Fläche (z. B. Wald) – Anzahl selbst eintragen', 'Needs free area (e.g. forest) – enter count yourself'],
  'prod.kind.coast': ['Küstengebäude – Anzahl hängt von der Küste ab', 'Coastal building – count depends on the coast'],
  'prod.kind.none': ['Keine Größe bekannt – Anzahl selbst eintragen', 'No size known – enter count yourself'],
  'prod.fx.prod': ['Produktivität', 'Productivity'],
  'prod.fx.wf': ['Arbeitskraft', 'Workforce'],
  'prod.fx.power': ['Strom', 'Power'],
  'prod.fx.wfType': ['Arbeitskraft:', 'Workforce:'],
  'prod.fx.noInput': ['entfällt', 'not needed'],
  'prod.fx.maint': ['Unterhalt', 'Upkeep'],
  'prod.formula': [
    'Berechnung wie annolayouts.de: Produktivität = 100 % + Item-Produktivität (geclippt doppelt) + 100 % Strom; Zykluszeit = Basis ÷ Produktivität (abgerundet); Arbeitskraft = Basis × (1 + Item-%) . Vorschläge: Max = höchster Ausstoß, Ohne AK = höchster Ausstoß ohne Arbeitskraft, Ohne Legendär = ohne legendäre Items. Palast und Regionalministerium oben einstellbar (Ministerium für Arbeit +10 % bis +60 % je Prestige-Stufe, Richtlinien wie Gewerkschaftsförderung = 4. Item-Platz, Fabrikinspektionen −50 % Arbeitskraft, Galvanismus +50 % Strombonus); die Zeitung ist nicht eingerechnet.',
    'Calculated like annolayouts.de: productivity = 100 % + item productivity (doubled when clipped) + 100 % power; cycle time = base ÷ productivity (rounded down); workforce = base × (1 + item %). Suggestions: Max = highest output, No WF = highest output without workforce, No legendary = without legendary items. Palace and local department can be set above (Ministry of Labour +10 % to +60 % by prestige level, policies such as Union Subsidies = 4th item slot, Factory Inspections −50 % workforce, Galvanism +50 % power bonus); the newspaper is not included.',
  ],
  // Infofenster
  'hc.more': ['und {n} weitere', 'and {n} more'],
  'hc.slot': ['Ausgerüstet in', 'Equipped in'],
  'hc.affects': ['Beeinflusst', 'Affects'],
  'hc.powerReq': ['erforderlich', 'required'],
  'hc.powerOpt': ['optional (+ Produktivität)', 'optional (+ productivity)'],
  'hc.items': ['{n} Items beeinflussen dieses Gebäude', '{n} items affect this building'],
  'hc.producedIn': ['Hergestellt in', 'Produced in'],
  'hc.usedIn': ['Verbraucht in', 'Used in'],
  'hc.extraBy': ['Als Zusatzware durch', 'As extra good from'],
  'hc.good': ['Ware', 'Good'],
  'hc.noInfo': ['Keine weiteren Angaben in der Datenbank.', 'No further data in the database.'],
  'hc.currency': ['Währung', 'Currency'],
  'hc.workforce': ['Arbeitskraft', 'Workforce'],
  'hc.coinsText': [
    'Einnahmen vor allem aus den Steuern der Wohnhäuser (und Handel); ausgegeben für Baukosten und den laufenden Unterhalt der Gebäude.',
    'Earned mainly from residence taxes (and trade); spent on construction and on the running upkeep of buildings.',
  ],
  'hc.price': ['Grundpreis', 'Base price'],
  'hc.workforceFrom': ['Kommt aus', 'Comes from'],
  'hc.workforcePer': ['1 Arbeitskraft je Einwohner – volles Haus: {n}', '1 workforce per resident – full house: {n}'],
  'hc.upkeepIn': ['Benötigt von {n} Gebäuden (höchster Bedarf)', 'Needed by {n} buildings (highest demand)'],
  'hc.upkeepGood': ['Laufender Verbrauch in {n} Gebäuden', 'Running consumption in {n} buildings'],
  'hc.costIn': ['Baumaterial für {n} Gebäude', 'Construction material for {n} buildings'],
  'hc.needOf': ['Bedürfnis von (je 1.000 Einwohner)', 'Need of (per 1,000 residents)'],
  'hc.needBasic': ['Grundbedürfnis: +{n} Einwohner je Haus', 'Basic need: +{n} residents per house'],
  'hc.needLuxury': ['Luxusbedürfnis: +{n} Zufriedenheit', 'Luxury need: +{n} happiness'],
  'hc.needOther': ['Bedürfnis', 'Need'],
  'hc.needBonus': ['Bonusbedürfnis: +{n} Einwohner je Haus', 'Bonus need: +{n} residents per house'],
  'hc.needUnlock': ['ab {n} {p}', 'from {n} {p}'],
  'hc.bonusNeeds': ['Bonusbedürfnisse (je 1.000 Einwohner)', 'Bonus needs (per 1,000 residents)'],
  'hc.needFrom': ['ab {n} Einwohnern', 'from {n} residents'],
  'hc.population': ['Bevölkerungsstufe', 'Population level'],
  'hc.house': ['Wohnhaus', 'Residence'],
  'hc.gives': ['Liefert', 'Provides'],
  'hc.basicNeeds': ['Grundbedürfnisse (je 1.000 Einwohner)', 'Basic needs (per 1,000 residents)'],
  'hc.luxuryNeeds': ['Luxusbedürfnisse (je 1.000 Einwohner)', 'Luxury needs (per 1,000 residents)'],
  'hc.perThousand': [
    'Verbrauch ohne Zeitungs-/Item-Effekte, Werte aus dem Anno-1800-Rechner.',
    'Consumption without newspaper/item effects, values from the Anno 1800 Calculator.',
  ],
  'hc.group': ['Gruppe mit {n} Gebäuden', 'Group of {n} buildings'],
  'hc.members': ['Enthält', 'Contains'],
  'hc.dlc': ['Erweiterung (DLC)', 'Expansion (DLC)'],
  'hc.dlcBuildings': ['Gebäude in der Datenbank', 'Buildings in the database'],
  'hc.dlcItems': ['Items in der Datenbank', 'Items in the database'],
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
