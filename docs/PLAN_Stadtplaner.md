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

## 12. Noch offene Fragen
- Panorama-Radius: ≤ 5 oder < 5 (ein Hochhaus im Spiel anklicken: wird das
  Haus über die Straße hinweg, 4 Kacheln entfernt, und das diagonal 3/4
  entfernte markiert?).
- Palast: Anzahl Flügel bzw. angezeigte Reichweite des Regionalministeriums,
  Prestige-Stufe.
- Handwerker-Arbeitskraft für Kaufhaus & Co. (Insel hat nur Ingenieure/
  Investoren): Pendlerstation am Lufthafen (3. Modul) oder Pendlerkai?
- Screenshot mit T1–T4 in anderer Form gehört zu welcher Insel?
