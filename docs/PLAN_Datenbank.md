# Plan: Anno-1800-Hilfeseite mit Spieldatenbank

Ziel: Die Seite wird eine allgemeine Hilfeseite für Anno 1800. Grundlage ist
eine **Datenbank aller Spieldaten** (zuerst alle Gebäude und alle Items), auf
der die Werkzeuge aufbauen: der bestehende Stadtplaner und später Guides wie
Baumaterial-Insel, Gelehrten-Insel oder „jedes Produktionsgebäude in
Handelskammer-Reichweite“.

## 1. Woher die Daten kommen (nach Verlässlichkeit)

| Rang | Quelle | Was sie liefert | Bewertung |
|---|---|---|---|
| 1 | **Spieldateien** aus der eigenen Installation: `data/config/export/main/asset/assets.xml`, `templates.xml`, `data/config/gui/texts_german.xml` / `texts_english.xml` aus der neuesten `maindata/dataNN.rda` (höchste Nummer überschreibt) | Alle Werte, die das Spiel selbst benutzt: Größen, Kosten, Unterhalt, Arbeitskraft, Produktionszeiten, Reichweiten, Item-Effekte, Bedürfnisse, Freischaltungen | **Maßgeblich.** Auslesen mit RDA Explorer bzw. RdaConsole (anno-mods). |
| 2a | **anno-toolkit** (jansepke, MIT): `data/anno/assets/*.json` | Vollständige Umwandlung von `assets.xml` nach JSON (660 Vorlagen, 136 MB, inkl. DLC 12 „Aufstieg der Neuen Welt“), deutsche und englische Texte | Direkt aus den Spieldateien, aber **ohne `templates.xml`**: `assets.xml` speichert nur Abweichungen von den Vorlagen-Standardwerten. Fehlende Felder sind deshalb nicht „0“, sondern „Standardwert der Vorlage“. |
| 2b | **Anno 1800 Calculator** (NiHoel/DuxVitae, MIT): `js/params.js` (Stand Juni 2024) | 219 Produktionsgebäude, 267 Waren, 144 produktionsrelevante Items, Bevölkerungsstufen mit Bedürfnissen und Verbrauch, Kraftwerke, Palast-Effekte, Sets | Aus den Spieldateien erzeugt und von vielen Spielern genutzt; **Gegenprobe** für Produktion und Verbrauch. |
| 2c | **Anno Designer Presets** (`research/presets.json`, schon im Projekt) | Grundfläche, Einflussradius, Straßenbedarf aller Gebäude | Gegenprobe für Größen und Radien (nutzen wir bereits). |
| 3 | Wikis (anno1800.fandom.com, anno.skotschir.de) | Erklärungen von Mechaniken, die nicht als Zahl in den Dateien stehen | Nur für Mechaniken, immer mit Quelle; teils veraltet. |
| 4 | **Prüfung im Spiel** durch den Nutzer | Mechaniken im Programmcode (Panorama, Clipping, Brandwahrscheinlichkeit) | Endgültige Bestätigung; Ergebnis wird in der Datenbank vermerkt. |

Jeder Datensatz bekommt `quelle` (`spieldatei`, `rechner`, `wiki`, `im-spiel-geprüft`)
und die Spielversion, aus der er stammt. Abweichungen zwischen den Quellen
werden in einem Prüfbericht aufgelistet statt stillschweigend aufgelöst.

Rechtliches: Die Spieldaten gehören Ubisoft. Fan-Werkzeuge (Anno Designer,
Calculator, anno-toolkit) veröffentlichen abgeleitete Werte; wir halten es
genauso: nur abgeleitete Zahlen, Namen und GUIDs im Repository, **keine
Roh-Dateien** (`assets.xml` usw. bleiben außerhalb oder in einem ignorierten
Ordner). Spiel-Icons erst nach Entscheidung des Nutzers.

## 2. Was gespeichert wird

Gemeinsam für alle Einträge: `guid`, `vorlage` (Template), Name deutsch/englisch,
DLC, Region(en) (Alte Welt, Neue Welt, Arktis, Enbesa, Kap/Crown Falls),
Quelle, Spielversion.

**Gebäude**
- Grundfläche (BuildBlocker, Drehung), Straßenanschluss, Bauort (Land/Küste/Wasser)
- Baukosten (Geld, Material), Unterhalt (Geld, Arbeitskraft je Schicht, inaktiv)
- Freischaltung (Einwohnerzahl/Schicht), Bauerlaubnis
- Reichweiten: Einflussradius (Luftlinie) und Straßenreichweite (Pflaster/Feldweg)
- Produktion: Zykluszeit (t/min), Eingänge, Ausgänge, Lager, Strom (Bedarf/Bonus),
  Module (Felder, Anzahl, Größe), Dünger/Bewässerung
- Öffentliche Gebäude: welche Bedürfnisse, Reichweite, Wohlfahrt-fähig
- Wohnhäuser/Hochhäuser: Bewohner je Stufe, Bedürfnisse, Verbrauch, Panorama
- Zwischenfälle: Brand-, Krankheits-, Aufstands-, Explosionsfaktoren, Schutzgebäude
- Attraktivität, Item-Plätze (Rathaus, Handelskammer, Hafenmeisterei, Zoo/Museum …)

**Items**
- Seltenheit, Art (Spezialist/Gegenstand), Platz (Handelskammer, Rathaus,
  Hafenmeisterei, Schiff, Expedition, Kulturgebäude, Palast …)
- Zielgebäude (Effektziele inkl. aufgelöster Gruppen)
- Effekte: Produktivität, Arbeitskraft, Zusatzware (Ware, Zyklus), Ersatz-Eingang,
  Stromersatz, Einwohner/Bedürfnisse, Zwischenfälle, Attraktivität, Reichweite …
- Preis, Herkunft (Händler, Expedition, Belohnung, Herstellung), Set-Zugehörigkeit

**Waren und Bevölkerung**
- Waren: Region, Preis, Lagergröße
- Bevölkerungsstufen: Bedürfnisse (Grund/Lebensstil), Verbrauch je Einwohner,
  Einwohnerbonus, Arbeitskraft je Haus

## 3. Aufbau

- **Datenaufbereitung** (Node/TS-Skripte in `scripts/data/`, nur beim Bauen):
  Roh-JSON/XML lesen → Vorlagen-Vererbung auflösen (`BaseAssetGUID`, Template-
  Standardwerte) → Effektziele und Gruppen auflösen → Texte zuordnen →
  kompakte Dateien `src/data/anno/{gebaeude,items,waren,bevoelkerung,meta}.json`.
- **Prüfbericht** (`npm run check-data`): Vergleich mit Calculator, Anno Designer
  und den bisher fest eingetragenen Werten des Stadtplaners (z. B. Rathaus
  Radius 20, Handelskammer 15, Kaufhaus Straßenreichweite) → Liste der Abweichungen.
- **Oberfläche** (weiter ohne Framework, deutsche Texte): Startseite mit
  Navigation → Datenbank (Suche, Filter nach Region/DLC/Kategorie/Effekt,
  Detailansicht, Verweise Item ↔ Gebäude) → Werkzeuge (Stadtplaner, später Guides).
- Der Stadtplaner liest seine Werte schrittweise aus der Datenbank statt aus
  festen Tabellen (`catalog.ts`, `rules.ts`).

## 4. Meilensteine

- **D1 – Rohdaten beschaffen und prüfen:** Nutzer liest die drei Dateien aus
  seiner Installation aus (Anleitung). Bis dahin dient der anno-toolkit-Abzug als
  Arbeitsgrundlage. Spielversion und Prüfsummen festhalten.
- **D2 – Gebäude:** Vererbung, Größen, Kosten, Unterhalt, Produktion, Reichweiten,
  Freischaltung; Prüfbericht gegen Anno Designer und Calculator.
- **D3 – Items:** Effekte, Ziele, Plätze, Seltenheit, Sets, Herkunft; Prüfbericht
  gegen Calculator und anno-toolkit.
- **D4 – Datenbank-Oberfläche:** Suche, Filter, Detailseiten, Verlinkung.
- **D5 – Umbau zur Hilfeseite:** Startseite, Navigation, Stadtplaner als ein
  Werkzeug, Stadtplaner nutzt die Datenbankwerte.
- **D6 – Mechaniken außerhalb der Dateien:** Liste mit Quelle und Prüfstatus
  (Panorama, Clipping, 149-Bauern-Regel, Zwischenfall-Schwellen …), Nutzer prüft im Spiel.
- Danach: Guides (Baumaterial-Insel, Gelehrten-Insel, Produktion in HK-Reichweite).

## 5. Entscheidungen des Nutzers

1. Rohdaten: Nutzer liest die Dateien mit dem RDA Explorer aus (Anleitung im Chat);
   bis dahin anno-toolkit-Abzug. Wegen der Größe von `assets.xml` zuerst
   `templates.xml` (gezippt), `assets.xml` nur falls nötig.
2. **Mit Spiel-Icons** (wie Anno Designer/Calculator; Seite ist öffentlich
   erreichbar → Hinweis „Fanprojekt, Anno 1800 © Ubisoft, nicht offiziell“ im Fuß).
   Icons liegen im Spiel als `.dds` und werden beim Aufbereiten in PNG umgewandelt.
3. **Deutsch und Englisch umschaltbar:** Spielnamen aus beiden Textdateien,
   Oberflächentexte über eine Übersetzungstabelle, Sprachwahl gespeichert im Browser.
   Gilt später für die ganze Seite (auch den Stadtplaner).

## 6. Stand (18.11.2026)

Gebaut, solange die Spieldateien des Nutzers noch fehlen (Grundlage: anno-toolkit-Abzug):

- **Seitenaufbau:** Startseite, Datenbank, Stadtplaner unter `planer.html`; Navigation,
  Sprachumschalter de/en, Fanprojekt-Hinweis.
- **D2/D3 (vorläufig):** 1.396 Gebäude (Kategorie, Region, DLC, Größe/Radius/Reichweite aus
  Anno Designer, Baukosten, Unterhalt, Produktion, Versorgung, Item-Plätze, Wohnen, Ausbau) und
  1.455 Items (Platz, Seltenheit, Art, Preis, Effekte mit Spieltext-Beschriftung, Zielgebäude
  inkl. aufgelöster Gruppen, Expedition). 2.105 Icons als WebP 64 px (5,7 MB).
- **D4 (Grundversion):** Suche, Filter (Kategorie/Region/DLC bzw. Platz/Seltenheit/Effekt/DLC),
  Detailansicht, Verweise Item ↔ Gebäude, „Items, die dieses Gebäude beeinflussen“, Rohwerte.
- **Prüfbericht** (`npm run check-db`): Zykluszeit = Anno-1800-Rechner bei 126/126
  Produktionsgebäuden; Stadtplaner-Werte (Größen, Radien) stimmen; Reichweiten-Spielwerte ×1,40–1,42
  = Pflaster-Kacheln des Stadtplaners.

Offen, wartet auf `assets.xml`/`templates.xml` des Nutzers:
- Einträge mit `BaseAssetGUID` (fehlen im Abzug), Vorlagen-Standardwerte (79 Zykluszeiten,
  Kosten von 504 Gebäuden, Regionen einzelner Gebäude), Freischaltbedingungen.
- Bevölkerungsstufen/Bedürfnisse/Verbrauch, Herkunft der Items (Händler, Expeditionen),
  Sets (Zoo/Museum).

## 7. Bereich „Produktion & Handelskammer“ (Vorbild annolayouts.de, Nov. 2026)

Aufbau wie die Optimierungs-Übersicht von annolayouts.de: alle Produktionsgebäude
nach Region und Arbeitskraft-Stufe gruppiert, je Gebäude eine Tabellenzeile mit
Handelskammer-Item-Plätzen und den Ergebniswerten. Eigene Umsetzung aus unserer
Datenbank – die Setups und Layout-Bilder von annolayouts.de sind Handarbeit des
Autors und werden nicht übernommen; wir berechnen sie selbst.

Je Gebäude:
- Ein-/Ausgang, Grundfläche, Basis-t/min (Zykluszeit; sonst Anno-1800-Rechner).
- **Item-Plätze (3)** mit drei berechneten Vorschlägen: *Max. Produktion*,
  *Ohne Arbeitskraft* (falls mit Items erreichbar), *Ohne legendäre Items*.
  Plätze per Klick änderbar (Auswahl aller passenden HK-Items, nach Seltenheit).
- **Strom** an/aus (bei Pflicht immer an; Item mit Stromversorgung zählt),
  **Clipping** (Item-Effekte doppelt).
- Werte: Produktivität, Zykluszeit, t/min je Gebäude und je Handelskammer,
  Arbeitskraft (inkl. Ersatz-Arbeitskraft), Zusatzwaren, ersetzte/entfallende Eingänge.
- **Gebäude je Handelskammer**: eigener Packer (Mittelpunkt im Radius 15,
  Straßenanschluss, Straßennetz mit Anschluss an die HK), Vorschau und
  **Stempel-Download** (Alte/Neue Welt). Für Farmen (Felder), Minen (Vorkommen)
  und Flächengebäude (Wald) nur manuelle Anzahl.

Formel (wie annolayouts.de): Produktivität = 100 % + Σ Item-Produktivität
(geclippt ×2) + 100 % Strom (wenn `Industrializable` und nicht
`BoostedByIndustrialization = 0`); Zykluszeit = ⌊Basis · 100 / Produktivität⌋;
Arbeitskraft = Basis · (1 + Σ %/100), mindestens 0.

Später: Palast-Effekte/Zeitung, Hafenmeisterei-Items (Fischerei/Hafengebäude),
Rathaus-Bereich, Produktionsketten-Rechner.

**Stand (18.11.2026) – umgesetzt:** `produktion.html` mit Regionen-Reitern (Alte/Neue Welt,
Arktis, Enbesa), Gruppen je Arbeitskraft, Suche, Clipping-Schalter; je Gebäude drei
vorberechnete Setups (`public/db/prod.json`, `npm run build-prod`), Item-Auswahl (nach
Seltenheit, mit Effekt-Zusammenfassung), Strom-Schalter (Pflicht/optional/Item), Werte je
Gebäude und × Anzahl. Packer: 28 Grundflächen, z. B. 6×6 (Hochrad) 20, 5×5 28, 3×3 66 Gebäude
je Handelskammer; `check-db` prüft Radius, Überlappung und Straßenanschluss aller Layouts.
Stempel-Download (Alte Welt) mit Handelskammer, Gebäuden und Pflaster; Gegenprobe mit dem
eigenen Stempel-Einleser: 20/20 im Radius, keine Überlappung. Farmen, Minen, Flächen- und
Küstengebäude: Anzahl manuell. Test- und Kampagnen-Gebäude ausgeblendet, fehlende Regionen
aus Vorlage/Arbeitskraft abgeleitet.

Offen: Hafenmeisterei-Items für Küstengebäude, Palast/Zeitung, Farmen mit Feldern im
Layout, Stempel für Neue Welt/Enbesa (Handelskammer-GUID der Region fehlt im Abzug),
„+50 % bei 0 Arbeitskraft“ (in annolayouts.de umgesetzt, Spielmechanik noch nicht geprüft).

**Abgleich mit annolayouts.de (18.11.2026):** Deren 520 Item-Setups (175 Gebäude)
mit unserer Formel nachgerechnet und mit unseren Vorschlägen für dasselbe Ziel
verglichen (Setups wurden nur gelesen, nicht übernommen). Ergebnis vorher: in 51
Fällen höherer Ausstoß bei ihnen – fast immer, weil sie mit **4 Items** rechnen
(Palast-Erlass „Gewerkschaftsförderung“ +1 Sockel). Umgesetzt:
- Palast-Erlasse in der Datenbank (Platz „Palast“, erkannt über EffectContainer mit
  Palast-Icon, 47 Effekte), Schalter „Gewerkschaftsförderung (4. Item-Platz)“,
  Vorschläge für 3 und 4 Plätze (`setups`/`setups4` in prod.json).
- Optimierer: bis zu 4 Items; ohne Zykluszeit zählt die Produktivität.
- Hacienda-Düngerwerk (BuffFactoryCulture) zählt jetzt als Produktion.
Ergebnis nachher: 0 Fälle mit höherem Ausstoß bei ihnen, 78 gleich, 442 bei uns höher
(dort verfolgen ihre Setups oft andere Ziele, z. B. Zusatzwaren oder günstige Items).
Offen: Ministerium für Arbeit (+60 % in Ministeriumsreichweite, mehrere Stufen-Varianten),
Zeitung, „Qualifizierte Arbeitskräfte“/„Landbesitzreform“ (Palast-Zusatzwaren je Fabrik).

## 8. Spieldateien des Nutzers eingebunden (18.11.2026)

- `assets.xml` + Texte aus **data33.rda** (11.11.2024, 104.190 Assets), `templates.xml` aus
  **data27.rda**; `properties.xml` bisher nur in der Fassung von 2019 (Standard-Kostenliste und
  Zykluszeit 30 s – beides unverändert gültig; `Industrializable`-Standard fehlt dort).
- `scripts/data/convert-game.py`: XML → JSON wie anno-toolkit, **556 BaseAssetGUID-Einträge
  aufgelöst**, Vorlagen-/Standardwerte für FactoryBase, Cost (inkl. geerbter Listeneinträge),
  Industrializable, PublicService, Powerplant, ItemContainer, Residence7, ModuleOwner,
  Maintenance, Building eingemischt.
- Ergebnis: 1.501 statt 1.388 Gebäude; **0 Produktionsgebäude ohne Zykluszeit** (vorher 83),
  218/218 = Anno-1800-Rechner; **0 Gebäude mit unbekannten Kosten** (vorher 318); Monumente
  ohne Strombonus (Vorlage `BoostedByIndustrialization 0`, vorher falsch angenommen);
  Handelskammer Neue Welt (101284) bekannt → Stempel-Download auch für die Neue Welt (Feldweg).
- Offen: aktuelle `properties.xml` (Strom-Standard für Farmen), Enbesa-Stempel (Regionspfad).

## 9. Palast & Regionalministerium (20.11.2026)

Quelle: Palast-Asset 249947 (`Palace.BaseMinistryEffect`, `MinistryDecree`, Prestige),
Attraktivitätsstufen (`AttractivenessFeature`), Ziel-Pools; Kette `EffectContainer →
ForwardBuff → Buff` in `build-db.mjs` vollständig aufgelöst → `public/db/palace.json` und alle
Palast-Effekte als Einträge mit Platz „Palast“ (`pal`: Ministerium, Richtlinie, Freischaltung,
Überbringer mit Radius). Geprüft in `npm run check-db`.

| Ministerium (ab) | Basiseffekt (Prestige 25) | Richtlinien (ab Attraktivität) |
| --- | --- | --- |
| Verwaltung (0) | +50 Bauern/Arbeiter/Handwerker/Ingenieure-Arbeitskraft je Rathaus (+300) | Umfunktionierung der Kellerräume 700, Maßvolle Ernährung 700, Wissenschaftsmessen 2.700, Freigeisterreform 3.850 (+1 Rathaus-Platz), Rathausreform 5.950 |
| Kultur (450) | Besondere Gäste +20 % (+120 %) | Kulturaustausch 1.000, Kulturerbe 1.000, Naturschutz 3.250, Privatsammlungen 4.500, Expertenprogramm 6.750 |
| Arbeit (700) | +10 % Produktivität (+60 %), über Handelskammern der Alten Welt, Radius 15 | Landbesitzreform 1.350 (Farmen: Zusatzware jede 2.), Qualifizierte Arbeitskräfte 1.350 (Schwerindustrie: jede 3.), Galvanismus 3.850 (+50 % Strombonus), **Fabrikinspektionen 5.200 (−50 % Arbeitskraft)**, Gewerkschaftsförderung 6.750 (+1 HK-Platz) |
| Wohlfahrt (1.000) | öffentliche Gebäude +10 Reichweite (+60) | Verbesserung der Finanzen 1.750, Förderung der Künste 1.750, Stadtweites Netz 2.700 (Kraftwerke +15), Wohlfahrt der Arbeiter 4.500, Verlängerte Ausschankzeiten 5.950 |
| Handel (1.350) | Lager Hafenmeisterei/Speicherstadt +200 (+1.200) | Küstenreformen 2.200 (+300 % Küstenproduktion, Hafenmeisterei 20/Speicherstadt 30), Hafenbevorratung 2.200, Brennstoffreserven 3.250, Hafenverwaltung 5.200, Marinelogistik 7.600 |

- Prestige: ab 9.000 Attraktivität Stufe 1, je 1.000 eine mehr, höchstens 25 (Werte je Stufe in `palace.json`).
- Palast und Regionalministerium nur in der Alten Welt (Vorlage `AssociatedRegions: Moderate`);
  Arbeits-Effekte nur über Handelskammern der Alten Welt (Pool 193860) → keine Wirkung in anderen Regionen.
- Regeln (Spieltexte): im Palast alle freigeschalteten Ministerien mit Basiseffekt, je Ministerium
  eine Richtlinie; Regionalministerium: ein Ministerium + eine Richtlinie. Fabrikinspektionen und
  Gewerkschaftsförderung schließen sich auf einer Insel aus (gleiches Ministerium).
- Produktionsseite: Schalter „Palast & Regionalministerium“ (Ort, Attraktivität → Freischaltung und
  Prestige, Richtlinien Arbeit/Handel); Rechnung `src/db/palace.ts` (`modsFor`) + `evaluate(..., { palace })`;
  Vorschläge `setupsFI` für Fabrikinspektionen. **Clipping:** Effekte, die über die Handelskammern kommen
  (Ministerium für Arbeit und seine Richtlinien), zählen doppelt wie Items (Nutzer: Basiseffekt 60 % → 120 %;
  Richtlinien über dieselbe Weiterleitung, im Spiel noch zu bestätigen).
- **Seitenweite Einstellungen** (`src/palaceSettings.ts`, Knopf „🏛 Palast“ im Seitenkopf): Attraktivität,
  Palastflügel, Richtlinie je Ministerium im Palast, Regionalministerium (Ministerium + Richtlinie);
  gespeichert unter `anno-palace-settings`, Änderungen gehen per Ereignis an Produktion und Stadtplaner
  (auch andere Tabs). Produktion wählt nur noch „Wirkung durch“ (Palast/Regionalministerium/keins);
  der Stadtplaner plant ein Regionalministerium mit dem dort gewählten Ministerium (`cityPalaceRules`).
- Stadtplaner: Wohlfahrt/Stadtweites Netz stimmen mit den Spieldaten überein; die Option „Wohlfahrt auch
  für Feuerwehr/Polizei/Hospital“ entfällt (Spieldaten: nicht im Ziel-Pool).
- Offen: Reichweite des Regionalministeriums (nicht in den Daten; Stadtplaner: halbe Palastreichweite),
  4. Rathaus-Item durch Freigeisterreform im Stadtplaner.
