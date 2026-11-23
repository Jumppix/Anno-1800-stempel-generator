# Plan: Stadtplaner für Crown Falls (Palastinsel)

Stand 23.11.2026. Vorgabe des Nutzers: Der Palast steht **immer** auf der großen Insel in Kap Trelawney
(Crown Falls); alle anderen Inseln haben nur ein Regionalministerium. Die Insel muss **33.000 Attraktivität**
erreichen (höchste Prestige-Stufe 25 – ab 9.000 Stufe 1, je 1.000 eine mehr; vom Nutzer bestätigt).
Gerechnet wird mit **allen Sets in Zoo, Museum und Botanischem Garten** (alle im Forschungsinstitut herstellbar).

## 1. Warum eigener Modus

Auf der Palastinsel wirken **alle fünf Ministerien gleichzeitig** mit je einer Richtlinie, in der
Straßenreichweite des Palasts (Spielwert 50 + 2 je Flügel, Pflaster ≈ 71 + 3 je Flügel). Mit Prestige 25:

| Ministerium | Wirkung bei Prestige 25 (Spieldaten) |
| --- | --- |
| Verwaltung | +300 Bauern/Arbeiter/Handwerker/Ingenieure **je Rathaus** |
| Kultur | Besondere Gäste +120 % |
| Arbeit | +60 % Produktivität (über Handelskammern) |
| Wohlfahrt | öffentliche Gebäude +60 Reichweite (Pflaster ≈ +90) |
| Handel | **+1.200 t Lager je Hafenmeisterei**/Speicherstadt |

Der bisherige Stadtplaner rechnet mit einem Regionalministerium (ein Ministerium, halbe Reichweite). Für
Crown Falls braucht es: Palast als Gebäude (mit Flügeln) statt Ministerium, alle Ministerien zugleich und
die Nebenbedingung Attraktivität ≥ 33.000.

## 2. Richtlinien – Entscheidungen auf der Palastinsel

| Ministerium | Kandidaten | Abwägung |
| --- | --- | --- |
| Verwaltung | **Freigeisterreform** (4. Rathaus-Item) oder **Rathausreform** (+200 Attraktivität je Rathaus) | 25 Rathäuser → +5.000 Attraktivität gegen ≈ +22.000 Einwohner (Messung Insel 2, alle Rathäuser im Bereich). Rechnen lassen: was kostet die Attraktivität sonst an Fläche? |
| Wohlfahrt | Stadtweites Netz | Kraftwerke +15 (Pflaster +22) |
| Kultur | Privatsammlungen (+250 je vollständigem Set in Zoo/Museum/Botanischem Garten) | Attraktivität |
| Handel | Hafenbevorratung (Depots +50) / Hafenverwaltung (+1 HM-Platz) / Küstenreformen | Hafenplaner |
| Arbeit | Gewerkschaftsförderung / Fabrikinspektionen | nur für Produktion auf der Insel |

## 3. Attraktivität – was die Spieldaten hergeben

- **Feste Werte** (Culture.Attractiveness, Vorlagen): Palast +150, **je Palastflügel +15**, Speicherstadt +150,
  je Speicherstadt-Modul +15, Weltausstellung +150, Forschungsinstitut +150, Eiserner Turm +250,
  Skyline Tower +275, Gerichtshof +100; Zierde (182 Ornamente mit eigenem Wert).
- **Kultur**: Zoo/Museum/Botanischer Garten über Module (Tiere/Exponate/Pflanzen = Items mit
  `AttractivenessUpgrade`, 351 Items) und **Sets** (Zusatzwert je vollständigem Set; Privatsammlungen +250).
- **Rathaus-Items** mit Attraktivität (45), Handelskammer-Items (48), Rathausreform +200 je Rathaus.
- **Abzüge**: Schwerindustrie −5 bis −20, Mehrfachfabriken −10, Fertigungsstraßen −5, Hafengeschütze −5 …
  → auf Crown Falls möglichst keine Schwerindustrie.
- Offen (Recherche/Spieltest): ob gleiche Ornamente abnehmend zählen, ob Attraktivität durch Unruhe/
  Verschmutzung/Vorfälle sinkt, Werte der Weltausstellungs-Ereignisse.

## 4. Ablauf im Planer

1. **Insel**: kompletter Stempel von Crown Falls – Land mit Feldweg, Hafengebiet mit Kaimauer (siehe
   PLAN_Kueste.md); Flüsse/Berge wie bisher über Lücken im Feldweg.
2. **Palast**: Hauptgebäude + Flügel (Module, Grenze nach Profilstufe) – zentral platzieren, sodass die
   Straßenreichweite (Pflaster ≈ 71 + 3 je Flügel) alle Rathäuser, öffentlichen Gebäude, Handelskammern und
   Hafenmeistereien erreicht; Flügel bringen Reichweite **und** +15 Attraktivität.
3. **Stadt**: wie bisher (Gitter, Rathäuser, Läden, Hochhaus-Stufen), aber mit allen Ministerien:
   Wohlfahrt-Reichweiten, Verwaltung-Arbeitskraft je Rathaus (deckt Handwerker für Läden), 4. Rathaus-Item
   oder Rathausreform.
4. **Kulturviertel**: Zoo, Museum, Botanischer Garten (Module), Weltausstellung, Forschungsinstitut, Zierde –
   so viel, dass **Attraktivität ≥ 33.000**, bei geringstem Verlust an Wohnfläche (Attraktivität je Kachel
   sortiert, Sets der Nutzer-Sammlung).
5. **Hafen**: Hafenplaner mit Handelsministerium → Hafenmeistereien standardmäßig an (Lager +1.200 t je HM).
6. **Bewertung**: Einwohner maximal unter Attraktivität ≥ 33.000; Anzeige Attraktivität je Quelle und
   Prestige-Stufe.

## 5. Einstellungen (Modus „Crown Falls / Palastinsel“)

- Palastinsel fest; Palast-Einstellungen (Richtlinien je Ministerium) aus dem seitenweiten Dialog.
- Ziel-Attraktivität (Standard 33.000), Anzahl Palastflügel (Grenze nach Profilstufe).
- Vorhandene Kultur: welche Zoo-/Museums-/Garten-Sets der Nutzer besitzt (sonst Schätzwert je Modul).
- Rathausreform vs. Freigeisterreform automatisch vergleichen oder fest wählen.

## 6. Was gebraucht wird

- **Stempel von Crown Falls** (ganze Insel, Küste mit Kaimauer).
- Größen von Palast und Flügeln (Anno Designer: Palast 9×9; Flügel-Module) – im Spiel prüfen, wie Flügel
  angebaut werden (Anschlussregeln Ecke/Kreuzung/Ende/Tor/Verbindung).
- Datenbank-Erweiterung: Attraktivität je Gebäude/Ornament/Kultur-Item in `buildings.json`/`items.json`
  (heute nicht ausgegeben), Sets mit Zusatzwerten.
- Spieltest: Attraktivität einer bekannten Stadt im Spiel gegen die Rechnung (Kalibrierung).

## 7. Meilensteine

1. Datenbank: Attraktivität (Gebäude, Ornamente, Kultur-Items, Sets) + Anzeige; Rechner „Attraktivität“.
2. Palast als Gebäude im Planer (Platzierung, Flügel, Reichweite) statt Regionalministerium.
3. Alle Ministerien gleichzeitig im Einwohnermodell (Verwaltung + Wohlfahrt + 4. Rathaus-Platz).
4. Kulturviertel-Platzierung mit Nebenbedingung Attraktivität.
5. Hafenplaner (PLAN_Kueste.md) einbinden.
6. Kalibrierung mit dem Spielstand des Nutzers.


## 8. Palast und Flügel (Spieldaten + Wiki „Palace“, geprüft 23.11.2026)

- Palast 9×9 (Anno Designer), +150 Attraktivität, Region Alte Welt; einmal je Spiel.
- **Flügel**: alle Varianten (gerade, Ecke, Kreuzung, Ende, Tor, Verbindung) gleich: **3×3**, +15 Attraktivität,
  Kosten 50.000 Münzen + 10 Bretter, 20 Ziegel, 20 Stahlträger, 15 Fenster, 10 Stahlbeton; Reichweite je Flügel
  Feldweg +2, **Pflaster +3**. Flügel müssen direkt oder über andere Flügel am Palast hängen (die Variante
  ist nur Optik). Kein Höchstwert; Grenze nach **Profilstufe** (Weltbevölkerung):

  | Profilstufe | Bevölkerung | Flügel | Reichweite Pflaster |
  | --- | --- | --- | --- |
  | 1–34 | 0–13.200 | 6 | 89 |
  | 35 | 13.600 | 10 | 101 |
  | 40 | 15.600 | 20 | 131 |
  | 50 | 40.780 | 40 | 191 |
  | 60 | 123.540 | 60 | 251 |
  | 70 | 268.520 | 80 | 311 |
  | 80 | 478.360 | 100 | 371 |
  | 90 | 754.980 | 120 | 431 |

  (Spieldaten: `ModulesForCompanyLevelSetup` 6, ab Stufe 35 +4, danach +2 je Stufe; Tabelle aus dem Wiki.)
  Reichweite Pflaster = 71 + 3 × Flügel (wie im Stadtplaner), Regionalministerium die Hälfte.
- Folge für Crown Falls: Bei großer Weltbevölkerung reicht der Palast über die ganze Insel; jeder Flügel
  kostet 9 Kacheln und bringt +15 Attraktivität (≈ 1,7 je Kachel).

## 9. Kultur mit allen Sets (Spieldaten)

Zoo (4×7, Module 6×4), Museum (5×8, Module 5×4), Botanischer Garten (8×5, Module 5×4); je Modul ein
Tier/Exponat/Pflanze; Modulgrenze laut Spieldaten 100 („Main“); kein „einmal je Insel“.

| Gebäude | Items | Sets | Items in Sets | Attraktivität Items (bis 100 Module) | + Privatsammlungen (250 je Set) | Summe |
| --- | --- | --- | --- | --- | --- | --- |
| Zoo | 133 | 18 | 84 | 3.320 | 4.500 | **7.820** |
| Museum | 154 | 17 | 78 | 4.130 | 4.250 | **8.380** |
| Botanischer Garten | 59 | 9 | 42 | 1.630 | 2.250 | **3.880** |
| **Zusammen** | | 44 | | 9.080 | 11.000 | **≈ 20.080** |

Dazu Set-Boni mit Attraktivität für andere Gebäude (z. B. Regenwald +30, Arktische Tundra +100,
Sargassosee +50 auf bestimmte Gebäude) und „Relikte von Thule“ (+20 %) – im Detail zu rechnen.
Weil Zoo/Museum/Garten nicht auf eins je Insel begrenzt sind und Items im Forschungsinstitut
hergestellt werden können, lässt sich die Kultur notfalls verdoppeln (Fläche gegen Attraktivität).

**Grobe Bilanz bis 33.000**: Kultur ≈ 20.000 + Rathausreform (25 Rathäuser) 5.000 + Palast 150 +
Flügel 15 je Stück (z. B. 60 → 900) + Speicherstadt 150 + Module + Weltausstellung 150 + Zierde/Items –
Abzüge der Industrie. Der Rest kommt aus Zierde oder einer zweiten Kulturgruppe; der Planer wählt die
Variante mit dem geringsten Einwohnerverlust (Freigeisterreform statt Rathausreform kostet 5.000
Attraktivität, bringt ≈ 22.000 Einwohner).
