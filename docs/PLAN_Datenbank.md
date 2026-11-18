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
