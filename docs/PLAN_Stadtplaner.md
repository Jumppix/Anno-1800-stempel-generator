# Plan: Stadtplaner – Insel maximal mit Einwohnern bebauen

Stand: Konzept, noch nichts umgesetzt. Grundlage: Anforderungsdokument des
Nutzers (`Anforderungen.docx`), drei Screenshots seiner Städte, die Daten aus
dem Projekt `anno-inselgenerator` (Anno-Designer-Presets) und eine
Web-Recherche. Offene Fragen stehen am Ende; Werte mit „(prüfen)“ sind nicht
verlässlich belegt und müssen im Spiel getestet oder konfigurierbar sein.

---

## 1. Ziel

**Einziges Ziel: möglichst viele Einwohner auf einer Insel.** Dazu kommen
Pflichtgebäude (Versorgung, Strom, Post, Lufthafen, Regionalministerium) und
optional eine kleine Produktions-„Clipping“-Formation für Arbitrage.

Nicht im Umfang: Skyline Tower, Weltausstellung, Forschungsinstitut und
ähnliche Monumente; Gebäude aus Mods (in den Screenshots sichtbar) werden
ignoriert; Waren, die nicht über die Speicherstadt handelbar sind (Kekse,
Kaugummi …), organisiert der Nutzer selbst.

## 2. Erfasste Anforderungen

### 2.1 Wohnen
- Wohnhäuser immer in **8er-Gruppen: 4 Ingenieure + 4 Investoren**, 3×3 je
  Haus, ringsum Straße (Screenshot 3: drei Gruppen nebeneinander, jede
  2 Spalten × 4 Reihen, 1 Kachel breite Straßen, die sich benachbarte Gruppen
  teilen; rechts eine Mini-Variante mit 2 Häusern).
- **Streifen-Regel statt Panorama-Optimierung:** Die Insel wird gedanklich von
  Nord nach Süd in Streifen geteilt; Streifen abwechselnd Ingenieure /
  Investoren. Innerhalb einer Gruppe ist also eine Spalte Ingenieure, eine
  Spalte Investoren; über die Straße hinweg liegt die andere Schicht.
- Stufe: Hochhäuser Ingenieure 3 und Investoren 3 (bisheriges Vorgehen).
- **Stempel enthalten nur normale Wohnhäuser** (Ingenieurshaus GUID 1010346,
  Investorenhaus 1010347); hochgezogen wird im Spiel. Für das Tool also
  unerheblich, nur für die Einwohnerschätzung relevant.
- Straßen: **immer Pflasterstraße**.

### 2.2 Pflichtgebäude
| Gebäude | Fläche | Wirkung | Bemerkung |
| --- | --- | --- | --- |
| Rathaus | 4×4 | Kreis Radius 20 | **Oberste Priorität**: möglichst viele Wohnhäuser beeinflussen; Radien dürfen sich nicht überlappen |
| Gasbetriebenes Kraftwerk | 5×6 | Straße, Basis 42 | **immer Gas**; Strom für alle Wohnhäuser und Produktionsgebäude |
| Kaufhaus / Einrichtungshaus / Drogerie | je 7×6 | Straße, Basis 44 (Pflaster ≈ 61) | sehr hohe Priorität; Reichweite **nicht** vom Ministerium betroffen |
| Universität | 9×6 | Straße, Basis 45 (Pflaster ≈ 63) | sehr hohe Priorität |
| Postamt | 6×4 | Kreis Radius 24 | 1–3 je nach Insel; Post-Radien (Postamt **und** Briefkasten) dürfen sich nicht überlappen |
| Briefkasten | 1×1 | Kreis Radius 12 | in ungenutzte Randflächen |
| Lufthafen + Item-Terminal + Luftpostlager | 10×15 + 2 × 5×3 | – | möglichst wenig Platz verschenken, **möglichst weit weg von der Hauptanlegestelle** |
| Regionalministerium | 8×5 | Wirkung über Straße (prüfen) | Ministerium für Wohlfahrt (Reichweite öffentlicher Gebäude) oder für Arbeit (Produktion); Palast-Stufe/Attraktivität einstellbar |

Optional: Bank (12×10), Varieté (4×5), Clubhaus (6×6), Feuerwache (5×3),
Polizeiwache (4×6). Lehmgruben und Ölquellen sind per Forschung verschiebbar
→ Rohstoffplätze gelten als normales Bauland.

### 2.3 Ministerium und Erlasse (Richtlinien)
- Wohlfahrt: vergrößert die Reichweite öffentlicher Gebäude in Reichweite des
  Ministeriums (Wiki: +10 (prüfen); laut Nutzer abhängig von der Palast-Stufe
  → **als Tabelle einstellbar**).
- Sinnvolle Erlasse laut Nutzer:
  - Verlängerte Ausschankzeiten (*Late Licence Act*) – Wirkung unklar (prüfen),
  - Stadtweites Netz (*City-Wide Web Act*) – größere Reichweite der Kraftwerke,
  - Gewerkschaftsförderung (*Union Subsidies Act*) – +1 Item-Slot in
    Handelskammern,
  - Förderung des Galvanismus (*Galvanic Grants Act*, Ministerium für Arbeit) –
    Strombonus für Produktion auch ohne Kraftwerksanschluss (prüfen).
  - Vermutlich ist je Ministerium nur **ein** Erlass aktiv (prüfen).

### 2.4 Produktion / Arbeitsweise „Arbitrage“
- Mindestens **4 geclippte Produktionsgebäude**, gern mehr:
  Hochrad-Werkhallen (6×6), Baumschulen (4×4, durch Clipping ohne
  Anbaufläche) oder Chemiefabriken (8×8).
- **Clipping:** Produktionsgebäude steht genau zwischen zwei Handelskammern
  (deren Radien sich berühren, aber nicht überlappen), sodass beide Kammern
  wirken. Funktioniert nicht mit allen Gebäuden → genaue Regel unbekannt,
  daher **Formation als Vorlage vom Nutzer** übernehmen.
- Produktion braucht ein **Lagerhaus in Reichweite**, grob 1 Lagerhaus (5×5)
  je 8 Produktionsgebäude, und Strom.
- Handelskammern sonst unwichtig: nur so viele, wie die Formation braucht.
- Arbitrage-Kette (Hochräder etc. → Speicherstadt → Dampfwagen →
  Bedürfnisgüter) findet auf anderen Inseln statt; hier nur die Werkhallen.

### 2.5 Prioritäten (vom Nutzer)
1. Rathäuser optimal (maximal viele Wohnhäuser im Radius).
2. Strom (Gaskraftwerke), Kaufhaus, Einrichtungshaus, Drogerie, Universität.
3. Postämter (+ Briefkästen), Lufthafen, Regionalministerium.
4. Clipping-Formation mit Handelskammern, Lagerhaus.
5. Optional: Bank, Varieté, Clubhaus, Feuerwehr, Polizei.
6. Alles Übrige: Wohnhäuser.

## 3. Recherchierte Spielmechanik (Kurzfassung)

- **Reichweite über Straßen** (Anno-Designer-Algorithmus, MIT-lizenziert):
  Breitensuche ab den Straßenkacheln, die das Gebäude an einer Kante
  (nicht diagonal) berühren; jeder Schritt auf einer Straßenkachel kostet 1;
  ein Gebäude ist versorgt, wenn die Suche eine seiner Nachbar-Straßenkacheln
  innerhalb der Reichweite erreicht. Pflaster verlängert die Reichweite
  (≈ × 1,38–1,43 auf den Preset-Wert; exakter Faktor prüfen).
- **Kreisradien** (Rathaus 20, Handelskammer 15, Postamt 24, Briefkasten 12):
  Luftlinie, keine Straße nötig; Radien gleichartiger Gebäude dürfen sich nicht
  überlappen – dasselbe Packungsproblem wie bei den Handelskammern, der
  vorhandene Solver ist wiederverwendbar.
- **Hochhäuser:** 3×3; Ing. 3 = 100, Inv. 3 = 125 Einwohner + Panorama
  (+5 … +25). Mit der Streifen-Regel liegt jedes Haus voraussichtlich bei
  Panorama-Stärke 4 (Rechnung unter Annahmen, nicht verifiziert).
- **Dichte des 8er-Rasters:** Gruppe 6×12, mit geteilten 1er-Straßen
  Periode 7 × 13 = 91 Kacheln für 8 Häuser.
- **Versorgungsbedarf grob:** Pflaster-Reichweite ~61 Straßenkacheln deckt im
  Raster eine Raute von einigen tausend Kacheln ab → je Bedürfnis-Gebäude
  vermutlich nur wenige Exemplare pro Insel (mit Wohlfahrt noch weniger).
- **Bekannte GUIDs/Größen** (Anno-Designer-Presets): Gaskraftwerk 117547 (5×6),
  Kaufhaus 135100, Einrichtungshaus 135099, Drogerie 134629 (je 7×6),
  Universität 1010362 (9×6), Bank 1010365 (12×10), Varieté 1010361 (4×5),
  Clubhaus 1010364 (6×6), Postamt 3741 (6×4), Briefkasten 538 (1×1),
  Lufthafen 962 (10×15), Item-Terminal 964 (5×3), Luftpostlager 966 (5×3),
  Regionalministerium 269602 (8×5), Lagerhaus 1010371 (5×5),
  Hochrad-Werkhalle 1010323 (6×6), Feuerwache 1010463, Polizeiwache 1010462,
  Rathaus 100415, Handelskammer 1010516, Pflasterstraße 1010035.

## 4. Kernidee der Umsetzung: Zellenraster statt freier Planung

Freie Planung von Straßen + Gebäuden ist kombinatorisch nicht beherrschbar.
Deine Bauweise ist aber regelmäßig – das nutzen wir:

1. **Straßenraster:** Über die Insel wird ein Gitter aus 1‑Kachel-Pflaster-
   straßen gelegt (Abstand 7 in Ost-West, 13 in Nord-Süd). Jede Masche ist
   eine **Zelle** (6×12) = Platz für genau eine 8er-Gruppe. Alle Häuser sind
   automatisch angeschlossen, die Straßenentfernungen sind regelmäßig und
   schnell berechenbar.
2. **Zellen belegen:** Jede Zelle bekommt entweder eine 8er-Gruppe oder einen
   **Sonderblock** (vorgefertigte Belegung einer oder mehrerer Zellen):
   - 1 Zelle (6×12): z. B. Kaufhaus (gedreht 6×7) + Gaskraftwerk (gedreht
     6×5) übereinander, oder Universität (gedreht 6×9), Postamt, Clubhaus …
   - 2 Zellen (Straße dazwischen entfällt, 13×12): Bank, Ministerium + X …
   - 2×2 Zellen (13×25): Lufthafen 10×15 mit beiden Modulen.
   - Clipping-Formation als Mehrzellen-Vorlage.
   Wie genau die Sonderblöcke aussehen, legen wir gemeinsam fest (Katalog,
   erweiterbar, aus Stempeln importierbar).
3. **Küste:** Randzellen, die nicht vollständig auf Land liegen, werden mit
   kleineren Varianten gefüllt (2×3, 2×2, 2×1 wie im Screenshot, Einzelhäuser
   mit Anschluss), die Restflächen mit Briefkästen.
4. **Optimierung** wird damit ein überschaubares Zuordnungsproblem auf ein paar
   hundert Zellen statt auf zehntausenden Kacheln: Welche Zelle bekommt
   welchen Sonderblock, sodass alle Wohnzellen versorgt sind und möglichst
   viele Häuser in Rathausradien liegen.

### Rathäuser zuerst
- Rathäuser (4×4, keine Straße nötig (prüfen)) werden auf das Raster
  abgestimmt platziert: Ziel = Anzahl Wohnhäuser im Radius 20 maximieren.
  Ein Haus zählt als beeinflusst nach einer festzulegenden Regel (Mittelpunkt
  im Radius oder Teilfläche – prüfen).
- Da Rathausradien nicht überlappen dürfen, bleiben zwangsläufig Lücken
  (bei dichtester Packung ≈ 10 % der Fläche, an Küsten mehr). **Genau dorthin
  kommen die Sonderblöcke** (Versorgung, Kraftwerke, Post, Lufthafen,
  Ministerium, Produktion). Damit landen Häuser bevorzugt im Rathausradius –
  das ist der Haupthebel für die Einwohnerzahl.
- Rathäuser selbst brauchen einen Platz: auf Straßenkreuzungen/Zellenrändern
  oder als Teil eines Sonderblocks; der Solver wägt die verdrängten Häuser ab.

### Versorgung (Überdeckungsproblem)
- Für jede Wohnzelle wird geprüft, ob Kaufhaus, Einrichtungshaus, Drogerie,
  Universität und Gaskraftwerk über die Straße erreichbar sind (Reichweite
  inkl. Pflaster, Wohlfahrt und Erlass, wenn das Gebäude im Wirkungsbereich des
  Ministeriums steht).
- Gesucht: möglichst wenige Sonderblöcke, die alles abdecken, und zwar in
  Rathaus-Lücken. Lösung per Greedy + lokaler Suche (gleiche Technik wie der
  Handelskammer-Solver), Bewertung = Häuser × Gewicht (im Rathausradius höher).

### Post
- Postämter (Radius 24) und Briefkästen (Radius 12) gemeinsam ohne
  Überlappung packen → vorhandenen Kreis-Solver um gemischte Radien erweitern
  (Mindestabstand = Summe der beiden Radien). Postämter in Sonderblöcken,
  Briefkästen in Restflächen an der Küste.

### Lufthafen
- Hauptanlegestelle (Kontor) per Klick in der Karte markieren (sie ist im
  Feldweg-Stempel nicht enthalten). Lufthafen-Sonderblock in die Zelle mit
  größtem Abstand dazu, unter den Platz- und Versorgungsbedingungen.

### Produktion
- Clipping-Formation (Vorlage) + Lagerhaus + Stromversorgung als Sonderblock,
  bevorzugt in eine Rathaus-Lücke am Rand. Anzahl Produktionsgebäude
  einstellbar (≥ 4).

### Einwohnerschätzung
- Je Haus: Basis (Ing. 3 = 100, Inv. 3 = 125) + Panorama (Streifen-Regel,
  berechnet) + einstellbarer Rathaus-Item-Bonus, falls im Radius.
- Summe, Aufschlüsselung, unversorgte Häuser rot. Werte sind Schätzungen;
  Kalibrierung über Vergleich mit einer echten Stadt des Nutzers.

## 5. Oberfläche (Entwurf)

Neuer Bereich „Stadtplaner“ in der bestehenden App, Schritt für Schritt:

1. **Insel** (wie bisher, Feldweg-Stempel) + Hauptanlegestelle anklicken.
2. **Einstellungen:** Palast-Stufe, Ministerium (Wohlfahrt/Arbeit), Erlass,
   optionale Gebäude an/aus, Anzahl Postämter/Produktion, Rathaus-Bonus.
3. **Raster:** Ausrichtung/Versatz automatisch (oder manuell schieben),
   Vorschau der Zellen, Anzahl voller 8er-Gruppen.
4. **Optimieren:** Rathäuser → Pflichtgebäude → Post/Lufthafen/Ministerium →
   Produktion → Rest Wohnen. Fortschritt wie beim HK-Solver, „Weiter
   optimieren“.
5. **Ansichten/Ebenen:** Rathausradien, Versorgung je Bedürfnis (grün/rot),
   Post-Radien, Panorama-Schätzung je Haus.
6. **Bearbeiten:** Sonderblock in andere Zelle ziehen, Zelle sperren,
   Rest neu optimieren lassen.
7. **Export:** Stempel (Aufteilung in Teilstempel wie bisher), dazu eine
   Übersicht (Anzahl je Gebäude, geschätzte Einwohner).

## 6. Umsetzungsphasen

| Phase | Inhalt | Ergebnis |
| --- | --- | --- |
| 0 – Klärung & Spieltests | Rückfragen klären; Test-Stempel: je ein Gebäude jedes Typs, gedreht, mit Pflasterstraße; Lufthafen mit Modulen (Komplex-IDs!); großer Ein-Stempel-Export | gesicherte GUIDs, Drehungen, Modul-Format, Stempelgröße |
| 1 – Fundament | Gebäudekatalog (aus Presets + Konfiguration), Stempel-Writer mit Drehung und beliebigen GUIDs, Stempel-**Reader für Gebäude**, Straßen-Reichweite (Breitensuche), Regelparameter-Tabelle | Bestehende Stadt des Nutzers importieren und **analysieren** (wer ist unversorgt?) – Kalibrierung |
| 2 – Wohnraster + Rathäuser | Zellenraster mit Ausrichtungs-/Versatzsuche, Randvarianten, Streifen-Regel, Rathaus-Platzierung auf Wohnhäuser optimiert, Export | erste spielbare Wohn-Stempel |
| 3 – Versorgung | Sonderblock-Katalog, Überdeckungs-Optimierung (Kraftwerk, Kaufhaus, Einrichtungshaus, Drogerie, Universität), Ministerium/Erlass-Effekte | vollständig versorgte Wohnstadt |
| 4 – Post, Lufthafen, Ministerium | gemischter Kreis-Solver für Post, Lufthafen fern der Anlegestelle, Ministerium zentral | alle Pflichtgebäude |
| 5 – Produktion | Clipping-Formation als Vorlage, Lagerhaus, Strom/Galvanismus | Arbitrage-Werkhallen |
| 6 – Feinschliff | Bearbeiten per Drag, optionale Gebäude, Einwohner-Bericht, Doku/Tests | komplettes Tool |

Jede Phase ist für sich nutzbar und wird mit `npm run check` (Invarianten:
keine Flächenüberlappung, alle Häuser angeschlossen, Radiusregeln) abgesichert.

## 7. Risiken

- **Spielregeln unscharf** (Pflaster-Faktor, Ministeriumswerte, Rathaus-
  „beeinflusst“-Regel, Clipping): alles als Parameter, Kalibrierung mit
  echten Städten und kleinen Test-Stempeln.
- **Komplexe mit Modulen** (Lufthafen) brauchen evtl. gemeinsame
  `ComplexOwnerID` im Stempel – offen seit dem Stempelformat-Research.
- **Stempelgröße:** Große Ein-Stempel-Exporte sind im Spiel noch nicht
  bestätigt; notfalls Teilstempel mit Straßenraster als Ausrichthilfe.
- **Rechenzeit:** durch das Zellenraster gering; mehrere CPU-Kerne wie bisher.

## 8. GPU

Theoretisch ja (WebGPU im Browser, ohne Installation). Praktisch lohnt es sich
hier kaum: Die Suche ist eine verzweigte, sequentielle lokale Suche, die sich
schlecht auf tausende GPU-Kerne verteilen lässt; der größte Gewinn kommt aus
dem Zellenraster (Problem wird um Größenordnungen kleiner) und mehreren
CPU-Kernen, die schon genutzt werden. Später denkbar für Massenberechnungen
(z. B. viele Rasterversätze/Reichweitenkarten gleichzeitig bewerten).

## 9. Antworten des Nutzers (Runde 1)

1./2. Gruppenform: unklar, was am effektivsten ist → sinnvolle Annahme treffen und
   vergleichen. Öffentliche Gebäude wirken nur über Straßen (Reichweite 60 =
   60 zusammenhängende Straßenkacheln).
3. „Beeinflusst“ = **Mittelpunkt des Gebäudes im Radius** (gilt für Rathaus,
   Handelskammer, Post …). Clipping mit Wohnhäusern: nicht planen. Rathaus braucht
   keinen Straßenanschluss, Handelskammern schon (laut Wiki nur für Palast-Effekte,
   siehe 10.). Rathaus-Item-Bonus: später.
4. Je Ministerium genau **ein Erlass** und **eine Richtlinie**; nicht jede
   Richtlinie unter jedem Ministerium. Werte recherchieren → Abschnitt 10.
5. Clipping: zwei Formationen als Stempel geliefert (quadratisch, Raute), nur
   diese sind möglich; Hochrad-Werkhallen teils austauschbar.
6. Lufthafen 15×10, Module 3×5 **angrenzend**; keine Küste, keine Straße nötig;
   kann als Lagerhaus dienen.
7. Hauptanlegestelle per Klick: ja. Küste/Randbebauung macht der Nutzer selbst.
8. Nur Stufe 3.
9. Großer Ein-Stempel funktioniert, ruckelt aber → Ein-Stempel vs. 13.500er-
   Aufteilung bleibt wählbar.
10. „Insel 2“ = vier Feldweg-Stempel (siehe 11.).

## 10. Recherchierte Werte (Anno-1800-Wiki, per MediaWiki-API gelesen)

### Palast / Regionalministerium
- Regionalministerium (Local Department): 5×8, **Straßenreichweite = halbe
  Palastreichweite**; genau **ein** Ministerium und **eine** Richtlinie aktiv;
  wirkt auf Gebäude in seiner Straßenreichweite. Passiver Effekt richtet sich
  nach dem **Prestige** des Hauptpalasts.
- Palastreichweite: Basis Feldweg 48 / Pflaster 71; je Flügel +2 / +3.
  Flügellimit nach Profilstufe + Weltbevölkerung (z. B. 40 Flügel ≈ 191
  Pflaster → Regionalministerium ≈ 95).
- Prestige: ab 9.000 Attraktivität Stufe 1, je +1.000 eine Stufe, max. 25
  (33.000); jede Stufe +20 % des Basiseffekts.
- **Wohlfahrt** (ab 1.000 Attr.): +10 Reichweite für alle öffentlichen Gebäude
  (Feldweg), **Pflaster ×1,5 = +15**, mit Prestige bis +60 / **+90**.
- **Arbeit** (ab 700 Attr.): +10 % Produktivität in Handelskammer-Reichweite
  (Prestige bis +60 %).
- Richtlinien Wohlfahrt: Aspirational Finance (1.750), Arts Patronage (1.750),
  **Stadtweites Netz / City Wide Web** (2.700): Kraftwerke **+15 / +22**
  Reichweite; Social Welfare (4.500): +5 Zufriedenheit;
  **Verlängerte Ausschankzeiten / Late Licence** (5.950): −20 % Getränkebedarf
  für Häuser in Reichweite verbundener Wirtshäuser, Varietés, Clubhäuser,
  Funktürme.
- Richtlinien Arbeit: Land Reform, Skilled Labour (je 1.350),
  **Förderung des Galvanismus / Galvanic Grants** (3.850): +50 % Produktivität
  durch Strom; Factory Inspections (5.200): −50 % Arbeitskraft;
  **Gewerkschaftsförderung / Union Subsidies** (6.750): +1 Item-Slot
  Handelskammer.
- Handelskammer/Rathaus brauchen selbst keine Straße; **für Palast-Effekte**
  müssen sie per Straße in Reichweite des Ministeriums liegen.

### Hochhäuser und Panorama (bestätigt)
- Ausgangswert = eigene Stufe; jedes Hochhaus im Radius: niedriger +1, gleich
  hoch oder höher −1, **gleiche Stufe andere Schicht +1**. Summe ≤ 0 keine,
  1 schwach … 5 intensiv. Radius Stufe 3 = 5.
- Max. Einwohner Stufe 3 je Stärke 0…5: Ingenieure 100/120/140/160/180/200,
  Investoren 125/150/175/200/225/250.
- Eigene Rechnung (Mittelpunktabstand, Radius ≤ 5): Raster mit gleicher
  Reihenfolge Ingenieur-Spalte | Investor-Spalte in jeder Gruppe → **alle
  inneren Häuser Stärke 5**, Ø 225 Einw./Haus, ≈ 19,8 Einw./Kachel.
  Jede zweite Gruppe gespiegelt: nur Stärke 1–2 (−35 %). → Streifen-Regel
  streng durchziehen, auch um Sonderblöcke herum.
- Gruppenlänge (Reihen je Gruppe) bei gleicher Regel: 4 Reihen 19,8 →
  8 Reihen 20,6 → 16 Reihen 21,0 Einw./Kachel (weniger Querstraßen), dafür
  längere Straßenwege. Tool vergleicht; Standard 4 Reihen.
- Offen: zählt „im Radius“ mit ≤ oder < (bei < : 4 Reihen 18,9 Einw./Kachel).

### Versorgung und Logistik
| Gebäude | Fläche | Reichweite Pflaster | Zusatz |
| --- | --- | --- | --- |
| Kaufhaus / Einrichtungshaus / Drogerie | 6×7 | 62 | brauchen **Lagerhaus/Kontor in Reichweite**, Strom und **Handwerker-Arbeitskraft**; Patent im Kreis 45 |
| Universität | 6×9 | voll 64 / max 131 | Ingenieure +6 bei voller Reichweite |
| Gaskraftwerk | 5×6 | 59 (+22 mit Stadtweitem Netz) | Gas per Karren → **Lagerhaus/Kontor in Reichweite**, Ingenieurs-Arbeitskraft |
| Postamt | 4×6 | Kreis 24 | 500 Einw. = 100 %, max. 3.100 % bei 15.500 Einw.; keine Überlappung mit Postämtern/Briefkästen |
| Briefkasten | 1×1 | Kreis 12 | wie Postamt |
| Lufthafen | 10×15 | – | wirkt wie Kontor (Anschluss + Ladeplatz für Karren); Module 3×5 angrenzend |
| Lagerhaus | 5×5 | – | braucht Straßenverbindung zum Kontor/Lufthafen |
- Reichweite über Straße: Start an Straßenkacheln, die das Gebäude seitlich
  berühren; kürzeste Straßenentfernung zum Haus zählt.
- Wohlfahrt +15 … +90 gilt nur für öffentliche Gebäude in Reichweite des
  Regionalministeriums; Kaufhaus/Einrichtungshaus/Drogerie laut Nutzer nicht
  betroffen (Wiki ordnet sie als „Shopping Arcade“ ein – passt dazu).

### Clipping (bestätigt durch die Stempel des Nutzers)
- Nur Gebäude mit **gerader Breite und Länge**; quadratische auch diagonal.
- Formation „quadratisch“: 4 Handelskammern im Quadrat (Abstand 30), je eine
  Hochrad-Werkhalle (6×6) auf der Kantenmitte → Mitte genau 15,0 von beiden HK.
- Formation „Raute“: Handelskammer-Abstände 30 über die Diagonale (18, 24);
  Werkhallen-Mitten genau 15,0 von zwei HK.
- Beide Stempel enthalten keine Straßen/Lagerhaus → Tool ergänzt Straßen und
  Lagerhaus.

## 11. Testinsel „Insel 2“
- Vier Feldweg-Stempel (127×112, 88×69, 84×121, 111×151) = dieselbe Insel wie
  im ersten Screenshot; mit den Versätzen aus dem Screenshot 189×290,
  25.630 Landkacheln. Alter HK-Solver 33 HK / 79,8 % (exakt wie Screenshot),
  neuer 40–41 HK.
- Die automatische Ausrichtung findet die Versätze nicht (eigener Fehler,
  separat erfasst).

## 12. Antworten Runde 2 und Stand Phase 1

- **Panorama-Radius: ≤** (Screenshots: Haus über die Straße schräg in genau
  5,0 Kacheln ist markiert, 5,66 nicht). Mittelpunkt zu Mittelpunkt.
- Ingenieur-Hochhaus im Spiel mit Items bis 400, Investor bis 602 Einwohner →
  Rathaus-Items sind der größte Hebel.
- Palastflügel und Prestige: konfigurierbar (umgesetzt).
- Handwerker: zunächst Pendlerkai annehmen, später ggf. eigene Häuser planen.
- Richtiger Screenshot zu Insel 2 geliefert (T1–T4 wie im ersten Screenshot).

**Phase 1 umgesetzt (Modus „Stadt-Analyse“):** Gebäudekatalog mit Wiki-Werten,
Regelparameter (Palast, Ministerium, Richtlinien), Stempel-Leser für Gebäude,
allgemeiner Stempel-Schreiber mit Drehung, Straßen-Reichweite, Ministeriums-
bereich, Rathaus/Post/HK-Radien, Clipping-Erkennung, Panorama, Einwohner-
Schätzung, Warnungen, Katalog-Teststempel, Beispielstadt, Tests in
`npm run check`.

**Nächster Schritt vor Phase 2:** Katalog-Teststempel im Spiel setzen (GUIDs,
Größen, Drehung, Lufthafen-Module) und einen Stempel der fertigen Stadt in der
Analyse prüfen (Kalibrierung: stimmen Versorgung/Panorama mit dem Spiel?).

## 13. Ergebnis Spieltest Phase 1

- Katalog-Teststempel: im Spiel eingefügt, **alle Gebäude vorhanden**.
- Stadt-Stempel aus dem normalen Spiel enthalten **nur Bauernhäuser**
  (GUID 1010343); Ingenieure/Investoren lassen sich nur im Kreativmodus
  stempeln. Konsequenzen:
  - Analyse: Schichten werden per Streifen-Regel zugeordnet (Graph-
    Zweifärbung: links/rechts andere Schicht, übereinander gleiche; auch über
    eine Straße). Umschaltbar auf „wie im Stempel“.
  - **Generator (ab Phase 2) exportiert Bauernhäuser**; der Nutzer baut im
    Spiel aus. Die Schicht je Haus wird zusätzlich als Bauplan angezeigt.

**Panorama-Kalibrierung (Spiel-Tooltip):** Stufenwert 3, „kleinere benachbarte“
0, „mindestens gleich hohe“ −2, „Resident Variety Bonus“ +3 → 4 =
„Beeindruckend“ (+20 Einwohner, +12 %). Formel bestätigt. Abweichung im Tool kam
von Randhäusern (einzelne Spalte links, im Spiel keine Stufe-3-Hochhäuser).
Nutzer: **alle Häuser sind Stufe-3-Hochhäuser**, keine automatische
Sonderbehandlung. Zweiter Screenshot (waagerechte Gruppe, Haus unten Mitte:
links/rechts gleiche Schicht −2, Reihe darüber +3 = 4) zeigt: **Eine 8er-Gruppe
ist eine Linie aus 4 Ingenieuren + eine Linie aus 4 Investoren** – bei
senkrechten Gruppen Spalten, bei waagerechten Reihen.
→ Zuordnung jetzt gruppenbasiert: direkt anstoßende Häuser = Gruppe; Linien
wechseln; welche Linie Ingenieure sind, wählt das Tool je Gruppe nach bestem
Panorama. Klick tauscht die Gruppe, Umschalt+Klick ein einzelnes Haus.
Tooltip zeigt die Aufschlüsselung wie im Spiel. Für den Generator gilt
dieselbe Gruppenregel (Bauplan je Gruppe).

## 14. Phase 2 umgesetzt (Wohnraster + Rathäuser)

- Gitter aus 1er-Pflasterstraßen, Periode 7 × (3·n + 1) bzw. transponiert;
  Ausrichtung (senkrecht/waagerecht/automatisch) und alle Verschiebungen
  werden durchprobiert; nur Gruppen, deren Zelle + Ringstraße komplett auf Land
  liegt (Küste plant der Nutzer).
- Rathäuser: vorhandener Solver mit Ziel „Hausmittelpunkte im Radius 20“,
  Bauplatz Land ohne Straße, Abzug 6 (vorher 3) je verdrängtem Haus; danach verdrängte
  Häuser entfernen, Rathäuser mit < N Häusern verwerfen.
- Insel 2 (189 × 290): 191–196 Gruppen ≈ 1.500 Häuser, 24–25 Rathäuser,
  ≈ 82–86 % der Häuser im Rathausradius, alle Häuser Panorama ≥ 4,
  Schätzung ≈ 264.000 Einwohner ohne Items und ohne Versorgung.
- Export: Bauernhäuser + Pflaster + Rathäuser (+ Feldweg-Inselrand), ein
  Stempel oder Bänder bis 13.500 Kacheln, Bauplan-Bild.

**Nächste Phase (3):** Versorgung – Kaufhaus, Einrichtungshaus, Drogerie,
Universität, Gaskraftwerke (+ Lagerhäuser) als Sonderzellen in Rathaus-
Lücken, Ministeriums-/Erlass-Effekte.

## 15. Rathaus-Items und Referenz annolayouts.de

- **Referenz für Item-Kombinationen: https://annolayouts.de/1800/** (Daten unter
  `data/optimization.json`, `data/sandbox/items.json`, `data/texts_de.json`;
  in dieser Umgebung freigegeben). Empfehlung „Rathaus → Wolkenkratzer“ =
  137798 Zofe „Blauer Himmel“, 137797 Lieferdienst „Blauer Himmel“, 190193
  Saint D'Artois – genau die Items des Nutzers für alle Rathäuser.
- Wirkung (Spieldaten): Zofe +5 Einwohner je erfülltem Bedürfnis aus Kekse,
  Schreibmaschinen, Cognac, Violinen, Billardtische, Spielwaren, Kaufhaus,
  Einrichtungshaus, Drogerie; Lieferdienst: Kaufhaus/Einrichtungshaus/Drogerie
  liefern Kaugummi/Billardtische/Violinen; Saint D'Artois +2 je Bedürfnis aus
  Fisch, Brot, Fleischkonserven, Universität, Kaffee, Glühbirnen, Sekt,
  Dampfwagen, Schokolade, Gebackene Bananen.
- Stufe 3: Ingenieure +33, Investoren +30 im Rathausradius (Kaufhaus,
  Einrichtungshaus, Drogerie, Universität nur, wenn versorgt). Umgesetzt in
  `TOWN_HALL_ITEM_BONUS` (rules.ts), Schalter in der Analyse.
- Für später (Phase 5): annolayouts enthält auch Handelskammer-Setups je
  Produktionsgebäude (z. B. Hochrad-Werkhalle) als Referenz.
- Die Spiel-Maxima (Ingenieur 359–400, Investor 602) enthalten weitere
  Bonus-Bedürfnisse (Post, Seife, Schokolade, Shampoo …); die Schätzung bleibt
  bewusst ein Vergleichswert, kein exakter Spielwert.

## 16. Korrektur: ganze Insel bebauen (kein freier Küstenstreifen)

Missverständnis geklärt: „Küste baut der Nutzer selbst“ meinte den
**Wasserbereich** (Kontor, Werften, Speicherstadt). Die eingegebene Fläche ist
nur Land und soll **bis zur letzten Kachel** mit Wohnhäusern bebaut werden.
→ `src/fill.ts`: Gitter über die ganze Insel inkl. angeschnittener Zellen,
gieriges Füllen, Straßenverlängerung (1–2 Kacheln), Gittersuche nach
Häuserzahl; nach den Rathäusern Lücken neu füllen.
Insel 2: 1.568 → 2.086 Häuser (+33 %) ohne Rathäuser; Rest ≈ 6 % (1–2 Kacheln
breite Ränder, dort passt kein 3×3-Haus). Längere Gruppen: 10er 2.109,
12er 2.136, 16er 2.154 Häuser (wählbar).
**Folge für Phase 3+:** Da kein Land mehr frei ist, ersetzen Versorgungs-
gebäude etc. Häuser; der Optimierer wählt Plätze mit minimalem Verlust
(Ränder, Rathaus-Reste) und maximaler Abdeckung.

## 17. Nachverdichtung: Platz an Rathäusern und Rändern nutzen

Wunsch: „alles ein bisschen schieben und anpassen“, das Rechteckmuster muss
nicht überall durchgehen. Umgesetzt in drei Stufen:
1. **Bandverschiebung** (`optimizeShifts` in `src/fill.ts`): Jedes Band
   zwischen zwei Querstraßen bekommt seine eigene Lage der Längsstraßen
   (Koordinatenabstieg über alle Bänder). Insel 2 ohne Rathäuser:
   2.086 → 2.107 Häuser.
2. **Rathäuser auf Querstraßen** (`crossRoadTiles` in `src/planner.ts`):
   Die Häuser hängen an den Längsstraßen; Querstraßen verbinden nur. Ein
   Rathaus darf auf Querstraßen-Abschnitten/T-Einmündungen stehen, wenn das
   Netz zusammenhängend bleibt (Prüfung je 4er-Fenster, in `finishPlan` noch
   einmal). Kostet ≈ 2 statt 4 Häuser.
3. **Nachverdichtung** (`src/compact.ts`): Fenster (Rathaus ± 9, Restflächen,
   zufällige Stellen 11–19 Kacheln) räumen, mit vielen Reihenfolgen neu
   belegen, optional eine zusätzliche Straßenkachel; Rathäuser bis 6 Kacheln
   verschieben (Abstand ≥ 40 bleibt, Straße nur ohne Netztrennung). Annahme
   nur bei höherem Wert (Häuser × 225 + Häuser im Radius × 31). Läuft in Web
   Workern mit verschiedenen Seeds, bester gewinnt.

Insel 2 (Einwohner laut Analyse, gleiche Regeln): 390.444 → 392.992
(Bänder) → 395.795 (+ Querstraßen) → 398.216 (+ Nachverdichtung), Häuser
2.012 → 2.054, freie Kacheln 7,4 % → 6,0 %. Die Restfläche besteht fast nur aus
1–2 Kacheln breiten Küstenrändern; im ganzen Rest passen ohne Straßenpflicht
nur noch ≈ 8 Häuser. Ideal des 8er-Rasters ohne Ränder/Rathäuser: 2.253.

## 18. Phase 3 umgesetzt: Versorgung

`src/services.ts` setzt Kaufhaus, Einrichtungshaus, Drogerie, Universität und
Gaskraftwerk in den fertigen Wohnplan (nach Rathäusern, vor der
Nachverdichtung) und danach Lagerhäuser:
- Kandidaten: alle Plätze (beide Drehungen) auf Land ohne Rathaus/anderes
  Gebäude mit Straßenanschluss; Häuser dürfen weichen, Straßen nur als
  Querstraßen-Stück (Netz bleibt zusammenhängend, alle Häuser/Gebäude
  angeschlossen). Je 4×4-Feld die zwei günstigsten Plätze.
- Abdeckung je Kandidat per Breitensuche über Straßen (wie die Analyse).
- Je Art: gierig nach Gewinn = Σ Wert neu versorgter Häuser − Σ Wert
  verdrängter Häuser (225, im Rathausradius +31), dann lokale Suche
  (überflüssige Gebäude entfernen, jedes Gebäude probeweise verlegen).
  Werte je Haus: Kaufhaus 22,5 (+5 Item), Einrichtungshaus 10 (+5), Strom 5,
  Universität 3 (+1), Drogerie 2,5 (+2,5); „Vollversorgung“ hebt jeden Wert
  auf mindestens 30.
- Lagerhäuser: gierige Überdeckung, bis jedes Gebäude mit Lagerbedarf eines in
  seiner Straßenreichweite hat.
Insel 2: Vollversorgung ≈ 8 Kaufhäuser, 8 Einrichtungshäuser, 8–9 Drogerien,
8 Universitäten, 10 Kraftwerke, 7 Lagerhäuser; ≈ 175 Häuser ersetzt; alle
Arten 91–99 %; Einwohner-Schätzung 395.000 → 459.000. „Max. Einwohner“:
≈ 470.000, dabei Drogerie/Universität nur ≈ 55–70 %.
Die Insel hat 4 getrennte Straßennetze (Flussarme); jedes Teil wird eigens
versorgt – dort braucht ein Lagerhaus eine eigene Anlegestelle/Kontor.
Offen für Phase 4: Regionalministerium (Wohlfahrt +15…+90, Stadtweites Netz
+22 für Kraftwerke) reduziert die Anzahl; Handwerker-Arbeitskraft (Pendler).

## 19. Lohnen sich Drogerie und Universität? (Recherche Wiki, Nov. 2026)

Wiki-Werte (Seiten „Needs“, „Skyscrapers“, „Drug Store“, „University“,
Item „Blue Skies Delivery Service“):
- **Drogerie** ist Grundbedürfnis nur für **Ingenieur-Hochhäuser Stufe 3**
  (+5 Einwohner) und Investoren-Hochhäuser **erst ab Stufe 5** – unsere
  Investoren (Stufe 3) brauchen sie nicht. Kosten: 240 Handwerker, drei
  Waren (1 t/min je Ware), Strom, 400 Unterhalt, Lagerhaus in Reichweite.
- **Universität**: Ingenieure +6 bei voller Reichweite (64), abgeschwächt bis
  131 Kacheln; keine Arbeitskraft, keine Waren, 400 Unterhalt; kein Einkommen.
- **Lieferdienst „Blauer Himmel“** (Rathaus, alle Hochhäuser): versorgte
  Häuser bekommen über das Kaufhaus Kaugummi (Ing./Inv. +10), über das
  Einrichtungshaus Billardtische (Investoren erst ab Stufe 4), über die
  Drogerie **Violinen** (Ingenieure Stufe 3 +5). Zofe: +5 für Violinen.
- Investoren Stufe 3: Kaufhaus 25, Einrichtungshaus 10 (ab 15 Hochhäusern
  Stufe 3), Strom 8. Ingenieure: Kaufhaus 20, Einrichtungshaus 10, Strom 2.

Umgesetzt: Analyse rechnet die Universität abgestuft (linear 64 → 131) und
kennt die Option „Kaugummi & Violinen nur über den Lieferdienst“ (dann zählen
sie nur im Rathausradius und mit versorgendem Laden). Die Versorgungsplanung
bewertet entsprechend und rechnet einen Betriebsaufwand je Gebäude ein
(Laden 450 Einw.-Gegenwert, Kraftwerk 225, Universität 0). Standardziel ist
jetzt „Max. Einwohner“.

Insel 2 (25 Rathäuser, Max. Einwohner, ohne Ministerium):
| Kaugummi/Violinen | alle 5 Arten | ohne Drogerie | ohne Universität | ohne beide | Vollversorgung |
| --- | --- | --- | --- | --- | --- |
| produziert | 471.600 (2 DR, 2 UNI) | 468.700 | 468.400 | 465.500 | 463.600 |
| nur Lieferdienst | 465.400 (3 DR, 2 UNI) | 456.900 | 462.200 | 453.600 | 459.900 |
Fazit: Drogerie lohnt sich nur gezielt (2–3 Stück in dichten Rathaus-
Bereichen): +0,6 % Einwohner, wenn Violinen produziert werden, +1,8 %, wenn
Violinen nur über den Lieferdienst kommen. Universität: 2 Stück, +0,7 %, sehr
günstig. Vollversorgung kostet 1,5–2 % Einwohner gegenüber „Max. Einwohner“.

**Brücken** (Wiki „Roads“): Straßen können Flüsse per Brücke überqueren;
Start und Ende auf beiden Ufern, kürzeste Strecke, parallele Brücken mit
mindestens 1 Kachel Abstand; Pflasterbrücke 2.000 Münzen + 20 Ziegel. Eine
importierte Insel ist immer **eine** Insel mit einem Kontor – getrennte
Straßennetze werden später per Brücke verbunden (wo der Fluss schmal ist,
lässt sich dem Feldweg-Stempel nicht entnehmen; Nutzer klärt das später).

## 20. Hochhaus-Stufen 3-3-5 / 4-5 (Anregung aus dem Rekord-Spielstand)

Mechanik (Wiki „Skyscrapers“, „Needs“, Item „Blue Skies Maid“):
- Panorama: Ausgangswert = eigene Stufe; jedes Hochhaus im Radius der
  **eigenen** Stufe (3: 5, 4: 6, 5: 6,75): niedriger +1, höher −1, gleiche
  Stufe andere Schicht +1, gleiche Schicht −1.
- Max. Einwohner (Stärke 0…5): Ing. 3 100…200; Inv. 3 125…250, Inv. 4
  150…275, Inv. 5 175…300. Ingenieure höchstens Stufe 3.
- Zusatzbedürfnisse Investoren: Stufe 4 Schreibmaschinen (10), Billardtische
  (15, Lieferdienst über Einrichtungshaus); Stufe 5 Violinen (5, Lieferdienst
  über Drogerie), **Drogerie (5)**, Spielzeug (15).
- Zofe „Blauer Himmel“: +5 je erfülltem Bedürfnis aus Kekse,
  Schreibmaschinen, Cognac, Violinen, Billardtische, Spielzeug, Kaufhaus,
  Einrichtungshaus, Drogerie → Investor 3: +20, 4: +30, 5: +45 (+ Saint 10).

Umsetzung: `rules.ts` (gemeinsames Einwohnermodell `skyscraperResidents`,
`panoramaDelta`), Analyse mit Stufe je Haus (`TierEdits.planned`),
`src/levels.ts` (Simulated Annealing über alle Häuser; Einwohner je Haus ×
Zustand × Panorama vorab tabelliert; Bauweisen nur Stufe 3, 3-3-5, 4-5, frei;
„automatisch“ prüft 3-3-5, 4-5 und frei). Läuft nach Versorgung im Worker.
Insel 2 (8er-Gruppen, mit Versorgung, Max. Einwohner): nur Stufe 3 ≈ 475.700,
3-3-5 ≈ 530.600 (+11,5 %), 4-5 ≈ 538.800 (+13,3 %).
Werkzeug-Referenz: NiHoel/Anno1800OptimizationTools „Skyscraper Levels“
(MILP mit SCIP).

Zweiter Durchgang: Nach der Stufenwahl wird die Versorgung mit dem genauen
Wert je Haus neu gesetzt (Einwohner mit minus ohne Gebäude für die geplante
Schicht/Stufe) und die Stufen werden erneut optimiert – z. B. keine
Universität bei 4-5 (keine Ingenieure), mehr Kraftwerke (Investoren +8).
Insel 2, 6er-Linien: 546.900 → 549.700 (+0,5 %).

**Lange Reihen** (Häuser je Linie = Länge der Gruppe zwischen Querstraßen;
Insel 2, 4-5, mit Versorgung, je 6 s Stufen-Optimierung):
| je Linie | 4 | 6 | 8 | 10 | 12 | 16 |
| --- | --- | --- | --- | --- | --- | --- |
| Einwohner | 538.800 | **548.300** | 546.800 | 543.600 | 544.800 | 528.200 |
| ohne Bandverschiebung | 537.500 | 545.800 | 547.100 | 540.200 | 529.700 | 523.300 |
Ab 10 sinkt es: weniger Querstraßen = weniger Plätze für Rathäuser/Läden auf
Querstraßen und längere Straßenwege der Versorgung. Standard jetzt 6.
Bandverschiebung hilft fast überall (die im Beitrag genannte „Symmetrie“
ist für unsere Stufen-Optimierung kein Nachteil, da sie jedes Haus einzeln
bewertet).

## 21. Brücken, Straßenstummel, eigene Ingenieure, Speichern

- **Brücken** (`addBridges` in `fill.ts`): Getrennte Straßennetze werden über
  gerade Wasserstreifen bis zur gewählten Länge (Standard 12) verbunden –
  erst die kürzesten, die alles verbinden, dann je Netzpaar bis zu zwei
  weitere im Abstand ≥ 40 Kacheln; 1 Kachel Abstand zwischen parallelen
  Brücken. Brückenkacheln (Zelltyp `BRIDGE`, `GridPlan.bridges`) zählen für
  Wege und Zusammenhang, sind aber kein Bauplatz; sie stehen in der Ansicht,
  nicht im exportierten Stempel (Brücke baust du im Spiel).
  Fehler gefunden und behoben: Die Netz-Prüfung für Rathäuser auf
  Querstraßen zählte Brücken nicht – dadurch wurden 9 von 25 Rathäusern
  verworfen. Insel 2: 4 Netze → 1 Netz mit 5 Brücken.
  Zweiter Fehler (Spieltest): Brückenköpfe wurden abgeschnitten, weil alle
  Prüfungen „Netz bleibt zusammenhängend“ die Brücke selbst als Verbindung
  zählten. Jetzt gilt: Jedes Ufer muss für sich zusammenhängend bleiben
  (nur Landstraßen), Straßenkacheln am Brückenkopf werden nie überbaut, und
  Brücken ohne Anschluss auf beiden Seiten werden wieder entfernt
  (`pruneBridges`).
- **Straßenstummel** (`replaceRoadStubs`): 3×3-Plätze aus freien Kacheln und
  bis zu drei Straßenkacheln werden bebaut, wenn das Netz zusammenhängt und
  alle Nachbarn angeschlossen bleiben (die Lücke aus dem Screenshot). Insel 2:
  +16…18 Häuser. Läuft am Ende der Nachverdichtung und vor der Versorgung.
- **Eigene Ingenieure**: Gaskraftwerk braucht 250 Ingenieure (Wiki); mit der
  Option plant die Stufen-Optimierung mindestens 250 × Kraftwerke
  Ingenieurs-Einwohner ein (Strafterm im Annealing, in jeder Bauweise
  erlaubt). Insel 2: 12–16 Ingenieurs-Hochhäuser, ≈ ±0 Einwohner.
- **Speichern**: Teile, Anordnung, Region, Modus und alle Planer-/Regel-
  Einstellungen im Browser (localStorage, `src/persist.ts`).
- Seitenleiste: Grundeinstellungen sichtbar, Rechenzeiten u. Ä. unter
  „Erweitert“; Regeln und Stadt-Analyse einklappbar; „Inselrand als Feldweg“
  entfernt; Ergebnis als kurze Liste.

Insel 2 (6er-Linien, Brücken 12, eigene Ingenieure, automatisch): ≈ 551.000
Einwohner, 2.009 Häuser, 25 Rathäuser, keine Warnungen.

## 22. Noch offene Fragen
- Panorama-Radius: ≤ 5 oder < 5 (ein Hochhaus im Spiel anklicken: wird das
  Haus über die Straße hinweg, 4 Kacheln entfernt, und das diagonal 3/4
  entfernte markiert?).
- Palast: Anzahl Flügel bzw. angezeigte Reichweite des Regionalministeriums,
  Prestige-Stufe.
- Handwerker-Arbeitskraft für Kaufhaus & Co. (Insel hat nur Ingenieure/
  Investoren): Pendlerstation am Lufthafen (3. Modul) oder Pendlerkai?
- Screenshot mit T1–T4 in anderer Form gehört zu welcher Insel?
