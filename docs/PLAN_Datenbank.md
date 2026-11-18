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

## 5. Offene Fragen an den Nutzer

1. Kannst du die Dateien aus deiner Installation auslesen (Windows, RDA Explorer)?
2. Sollen Spiel-Icons angezeigt werden?
3. Namen nur deutsch oder deutsch und englisch?
