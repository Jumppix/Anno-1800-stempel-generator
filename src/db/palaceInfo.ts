// Kurze Erklärungen der Palast-Ministerien und -Richtlinien (eigene Worte, Werte aus den
// Spieldaten: Effekte der Richtlinien in items.json, Ziele über die Effekt-Pools).
// Die Spieltexte der Richtlinien sind nur Zitate ohne Wirkungsbeschreibung.
import { getLang } from '../i18n';
import type { MinistryKey } from './data';

type Bi = readonly [de: string, en: string];

/** Basiseffekt je Ministerium (Prestige verstärkt ihn bis Stufe 25). */
const MINISTRY: Readonly<Record<MinistryKey, Bi>> = {
  City: [
    'Basiseffekt: je Rathaus +50 Arbeitskraft für Bauern, Arbeiter, Handwerker und Ingenieure (mit Prestige bis +300).',
    'Base effect: +50 workforce per town hall for farmers, workers, artisans and engineers (up to +300 with prestige).',
  ],
  Culture: [
    'Basiseffekt: Besucher- und Touristenhafen locken +20 % besondere Gäste an (mit Prestige mehr).',
    'Base effect: visitor and tourist harbours attract +20 % special guests (more with prestige).',
  ],
  Productivity: [
    'Basiseffekt: +10 % Produktivität aller Produktionsgebäude im Radius einer Handelskammer (mit Prestige bis +60 %).',
    'Base effect: +10 % productivity for all production buildings within a trade union radius (up to +60 % with prestige).',
  ],
  Service: [
    'Basiseffekt: öffentliche Gebäude und Kraftwerke +10 Reichweite (Feldweg; Pflaster ×1,5; mit Prestige bis +60).',
    'Base effect: public buildings and power plants +10 range (dirt road; ×1.5 on paved roads; up to +60 with prestige).',
  ],
  Harbor: [
    'Basiseffekt: +200 Insellager je Hafenmeisterei und Speicherstadt (mit Prestige bis +1.200).',
    'Base effect: +200 island storage per harbourmaster and Speicherstadt (up to +1,200 with prestige).',
  ],
};

/** Richtlinien (GUID) → kurze Wirkung. */
const DECREE: Readonly<Record<number, Bi>> = {
  // Verwaltung
  269172: ['Rathäuser: +200 Insellager je Rathaus.', 'Town halls: +200 island storage per town hall.'],
  273691: [
    'Bewohner verbrauchen 30 % weniger einiger Grundwaren (z. B. Fisch, Wurst, Brot, Konserven).',
    'Residents consume 30 % less of some basic goods (e.g. fish, sausages, bread, canned food).',
  ],
  269174: ['+1 Einfluss je Ingenieurshaus.', '+1 influence per engineer residence.'],
  269175: ['+1 Item-Platz in jedem Rathaus (4. Rathaus-Item).', '+1 item slot in every town hall (4th town-hall item).'],
  269176: ['+200 Attraktivität je Rathaus.', '+200 attractiveness per town hall.'],
  // Kultur
  269179: ['Weltausstellung: +1 Belohnung je Ausstellung.', 'World’s fair: +1 reward per exhibition.'],
  269180: ['+10 Einfluss je Museumsmodul.', '+10 influence per museum module.'],
  269181: ['+10 Einfluss je Zoo-Modul.', '+10 influence per zoo module.'],
  269182: [
    '+250 Attraktivität je vollständigem Set in Zoo, Museum und Botanischem Garten.',
    '+250 attractiveness per completed set in zoo, museum and botanical garden.',
  ],
  269183: [
    'Besucher- und Touristenhafen bringen gezielt bekannte Spezialisten (z. B. Feras, Angela, Papadikas).',
    'Visitor and tourist harbours bring well-known specialists (e.g. Feras, Angela, Papadikas).',
  ],
  // Arbeit
  269193: ['Farmen: +1 Zusatzware bei jeder 2. Produktion.', 'Farms: +1 extra good every 2nd production.'],
  279501: [
    'Schwerindustrie (Stahlwerk, Hochofen, Köhlerei …): +1 Zusatzware bei jeder 3. Produktion.',
    'Heavy industry (steelworks, furnace, charcoal kiln …): +1 extra good every 3rd production.',
  ],
  269196: ['+50 % Strombonus für Produktionsgebäude mit Strom.', '+50 % electricity bonus for powered production buildings.'],
  269194: ['−50 % Arbeitskraft aller Produktionsgebäude.', '−50 % workforce for all production buildings.'],
  269197: ['+1 Item-Platz in jeder Handelskammer (4. Platz).', '+1 item slot in every trade union (4th slot).'],
  // Wohlfahrt
  269141: [
    '+50 Münzen je versorgtem Haus für Universität, Varieté, Strom und Bankhaus.',
    '+50 coins per supplied residence for university, variety theatre, electricity and bank.',
  ],
  269142: ['+3 Attraktivität je Handwerker- und Ingenieurshaus.', '+3 attractiveness per artisan and engineer residence.'],
  269143: ['Kraftwerke +15 Reichweite (Pflaster ≈ +22).', 'Power plants +15 range (paved ≈ +22).'],
  273680: [
    '+5 Zufriedenheit durch öffentliche Dienste (Wirtshaus, Schule, Bankhaus …).',
    '+5 happiness from public services (pub, school, bank …).',
  ],
  279497: ['−20 % Verbrauch von Getränken (Schnaps, Bier …).', '−20 % consumption of drinks (schnapps, beer …).'],
  // Handel
  269207: [
    'Produktionsgebäude an der Küste (Fischerei, Perlenfarm …): +300 % Produktivität laut Spieldaten.',
    'Coastal production buildings (fishery, pearl farm …): +300 % productivity according to the game data.',
  ],
  269208: ['+50 Insellager je Hafendepot.', '+50 island storage per depot.'],
  269209: ['+200 Lager je Ölhafen und Öllager.', '+200 storage per oil harbour and oil storage.'],
  269210: ['+1 Item-Platz in jeder Hafenmeisterei.', '+1 item slot in every harbourmaster.'],
  269211: ['Hafengebäude (Anlegestellen): +50 % Lade-/Entladegeschwindigkeit.', 'Harbour buildings (piers): +50 % loading speed.'],
};

const pickBi = (b: Bi | undefined): string => (b ? b[getLang() === 'de' ? 0 : 1] : '');
export const decreeInfo = (g: number): string => pickBi(DECREE[g]);
export const ministryInfo = (k: MinistryKey): string => pickBi(MINISTRY[k]);
