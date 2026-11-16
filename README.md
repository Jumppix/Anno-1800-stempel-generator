# Anno 1800 – Handelskammer- & Rathaus-Planer / Stempel-Generator

Browser-Tool zum Laden von Anno-1800-Inselstempeln (Feldwege), zum Berechnen einer
Aufstellung mit möglichst vielen **Handelskammern** (Radius 15) und/oder
**Rathäusern** (Radius 20) ohne Radiusüberlappung und zum Export spielbarer Stempel.

**Live:** https://jumppix.github.io/Anno-1800-stempel-generator/

Die App läuft vollständig im Browser. Es gibt keinen Server, keine Datenbank und
keine Uploads: Stempeldateien werden nur lokal per Datei-Input gelesen.

## Schnellstart

Voraussetzungen: Node.js 22+ und npm.

```bash
npm ci
npm run dev
```

Vite zeigt danach die lokale URL an (standardmäßig `http://localhost:5173/`).

```bash
npm run build    # tsc + Vite-Produktionsbuild nach dist/
npm run preview  # gebauten Build lokal ansehen
npm run check    # Solver auf den Teststempeln + Invarianten prüfen
```

Der Build läuft mit `tsc --noEmit` (Typprüfung) und Vite. `npm run check`
(`scripts/check-solver.mjs`) löst die Teststempel für HK, Rathaus und beide,
prüft Fläche-auf-Land, Flächen- und Radiusüberlappung, Stempelaufteilung und
Mindestanzahlen. Dazu Tests der Stadt-Analyse: Stempel-Roundtrip mit Drehung,
die Clipping-Stempel aus dem Spiel, Panorama der Beispielstadt und die
Straßenreichweite. Ein Spieltest bleibt für die Spielbarkeit nötig.

## GitHub Pages

Die Seite wird über `.github/workflows/pages.yml` gebaut und veröffentlicht:

1. Push auf `main` (oder manueller Workflow-Start).
2. GitHub Actions führt `npm ci` und `npm run build` aus.
3. `actions/upload-pages-artifact` lädt `dist/` hoch.
4. `actions/deploy-pages` veröffentlicht den Build.

`vite.config.js` setzt den Basis-Pfad automatisch:
- lokal: `/`
- in GitHub Actions: `/<repo>/`, ermittelt aus `GITHUB_REPOSITORY`.

Deshalb funktionieren sowohl der lokale Dev-Server als auch der Projekt-Pfad
`https://jumppix.github.io/Anno-1800-stempel-generator/`.

### Einmalige Pages-Einstellung

Falls der Workflow bei „Configure GitHub Pages“ mit „Get Pages site failed“
abbricht, muss Pages im Repository einmal aktiviert werden:

**Settings → Pages → Build and deployment → Source: GitHub Actions**

Danach den Workflow erneut starten (Actions → Deploy to GitHub Pages → Re-run
jobs) oder erneut auf `main` pushen.

Optional kann das Repository-Secret `PAGES_ADMIN_TOKEN` hinterlegt werden
(feines PAT/App-Token mit Pages-Administrationsrecht). Dann kann
`actions/configure-pages` Pages beim ersten Lauf selbst aktivieren. Das Secret
wird nie im Repository gespeichert; es ist nur für den Workflow gedacht.

## Bedienung

1. **Inselform laden:** Einen oder mehrere Anno-Stempel (ohne Dateiendung) über
   „Stempel wählen“ laden. Die Straßen/Feldwege im Stempel bilden die Inselform.
   Mehrere Teile werden automatisch über die Straßenmuster ausgerichtet.
2. **Teile anordnen:** Im Tab „Anordnen“ per Drag & Drop oder über X/Y
   verschieben. Das 1×1-Kachelraster und die Teilumrisse machen die Ausrichtung
   kachelgenau. T1/T2/… sitzen mittig in den Teilen.
3. **Gebäude wählen:** Handelskammern, Rathäuser oder beide. Die Rechenzeit
   (2–60 s) wird auf mehrere CPU-Kerne verteilt; „Weiter optimieren“ setzt mit
   dem aktuellen Ergebnis als Startlösung fort.
4. **Ergebnis prüfen:** Der Tab „Ergebnis“ zeigt die platzierten Gebäude, ihre
   Radien (HK grün, Rathaus blau), Abdeckung und Lücken.
5. **Stempel exportieren:** Im Bereich „Stempel“ herunterladen oder alle
   Ergebnisse als ZIP. Dateien haben bewusst **keine Dateiendung** (Anno-
   Stempelformat). Ablage:
   `Documents\Anno 1800\stamps\<Region>\<Projektname>\`
   Danach Anno 1800 neu starten.

### Stadtplaner (Modus oben links umschalten)

Der Stadtplaner ist eigenständig nutzbar: Die Karten „Inselform aus Stempeln“
und „Teile“ sowie der Tab „Anordnen“ (2D-Editor mit Drag & X/Y) gibt es in
beiden Modi; die Insel ist zwischen den Modi geteilt. Der Tab „Plan / Analyse“
zeigt Plan bzw. analysierten Stadt-Stempel. Der HK/RH-Solver rechnet nur im
Modus „Verwaltung“.

**Wohnraster planen** (Phase 2): Die **gesamte Landfläche** der geladenen
Insel wird bebaut (`src/fill.ts`):
1. 8er-Raster aus Pflasterstraßen (eine Linie aus 4 Ingenieuren, eine aus 4
   Investoren; senkrecht oder waagerecht) über die ganze Insel – auch
   angeschnittene Gruppen am Rand; je Landstück bleibt ein zusammenhängendes
   Straßennetz, ungenutzte Straßenenden werden abgebaut.
2. Restflächen gierig mit Häusern füllen (passgenaue Plätze zuerst).
3. Straßen um 1–2 Kacheln verlängern, wo das weitere Häuser anschließt.
4. Ausrichtung/Verschiebung des Gitters nach der Gesamtzahl der Häuser wählen;
   danach jedes Band zwischen zwei Querstraßen einzeln verschieben
   (Längsstraßen müssen nicht über die ganze Insel fluchten).
5. Rathäuser: Solver mit Ziel „Hausmittelpunkte im Radius 20“, Bauplatz Land
   ohne Längsstraße – Querstraßen-Abschnitte und T-Einmündungen sind erlaubt,
   wenn das Netz zusammenhängend bleibt (kostet ≈ 2 statt 4 Häuser) –, Abzug 10
   je verdrängtem Haus; danach Lücken neu füllen.
6. Nachverdichtung (`src/compact.ts`, Web Worker, mehrere Kerne mit
   verschiedenen Seeds): Fenster um Rathäuser, Restflächen und zufällige
   Stellen werden geräumt und neu belegt (viele Reihenfolgen, optional eine
   neue Straßenkachel); Rathäuser dürfen dabei bis zu 6 Kacheln rücken, auch
   auf Querstraßen. Übernommen wird nur, was Häuser × 225 + Häuser im
   Rathausradius × 31 erhöht.

7. Versorgung (`src/services.ts`, Phase 3): Kaufhaus, Einrichtungshaus,
   Drogerie, Universität und Gaskraftwerk (je abwählbar) ersetzen Häuser.
   Je Art gewichtet gierig + lokale Suche (überflüssige entfernen, verlegen):
   Gewinn = Wert der neu versorgten Häuser − Wert der verdrängten Häuser.
   Ziel „Max. Einwohner“ (Standard) wertet nach Einwohnern laut Wiki inkl.
   Rathaus-Items und Betriebsaufwand je Laden (Handwerker, Waren);
   „Vollversorgung“ wertet jedes versorgte Haus mit ≥ 30. Universität wirkt
   abgestuft bis 131 Kacheln; Option „Kaugummi & Violinen nur über den
   Lieferdienst“ (Karte Palast & Ministerium) macht Kaufhaus/Drogerie im
   Rathausradius wertvoller (siehe `docs/PLAN_Stadtplaner.md` §19). Gebäude dürfen
   auf Querstraßen stehen, wenn Netz und Anschlüsse erhalten bleiben. Danach
   Lagerhäuser, sodass jedes Gebäude mit Lagerbedarf eines in Reichweite hat;
   dann Lücken füllen und Nachverdichtung. Ministerium/Wohlfahrt folgt in
   Phase 4 (bis dahin Grundreichweiten).

8. Hochhaus-Stufen (`src/levels.ts`): Bauweise automatisch (3-3-5, 4-5 oder
   frei gemischt, die mit den meisten Einwohnern), nur 3-3-5, nur 4-5 oder nur
   Stufe 3. Simulated Annealing über alle Häuser mit dem gemeinsamen
   Einwohnermodell (`rules.ts`: Panorama je Stufe, Bedürfnisse Stufe 4/5,
   Zofe/Saint). Danach Versorgung mit genauen Werten je Haus neu setzen und
   Stufen erneut optimieren. Export bleibt Bauernhäuser; die Ansicht zeigt
   die Zielstufe (V4/V5).

9. Regionalministerium (Wohlfahrt/Stadtweites Netz) vor der Versorgung, und
   Briefkästen in Restkacheln (`src/post.ts`) bis die Post-Produktion den
   Bedarf deckt (Post ist inselweit verfügbar; Zeitungs-Verbrauchssenkung
   einstellbar). Strom zählt zu den Panorama-Bedürfnissen.

10. Lufthafen (15×10) mit Item-Terminal und Luftpostlager, möglichst weit weg
   von der Hauptanlegestelle (per Klick in „Anordnen“ gesetzt); zählt als
   Lagerhaus.
11. Geclippte Produktion (`src/production.ts`): Gebäude aus der Liste aller
   clipbaren Produktionsgebäude (gerade Breite und Länge, z. B.
   Hochrad-Werkhalle, Baumschule, Chemiefabrik) mit Anzahl wählen. Jedes steht
   genau zwischen zwei Handelskammern (Mitten 30 auseinander, Gebäudemitte 15
   von beiden) – quadratisch oder als Raute wie in den Clipping-Stempeln.
   Handelskammern, Lagerhaus (Weg höchstens 40 Kacheln) und auf Wunsch Strom werden
   ergänzt; gesucht wird die Formation mit den wenigsten verdrängten Häusern.

Plan bearbeiten: Gebäude anklicken und mit der linken Maustaste ziehen, R
drehen, Entf entfernen, Strg+Z rückgängig; danach „Stufen & Post neu
berechnen“.

Optionale Gebäude (Feuerwache, Polizei, Hospital, Bank, Varieté, Clubhaus)
lassen sich zuschalten; nach dem Planen zeigt „Bauliste & Einwohner-Bericht“
die Anzahl je Gebäude und die Einwohner-Aufschlüsselung (als Text speicherbar).

Leiste im Stadtplaner: Reiter „Planen“ (Insel, alle Einstellungen in
aufklappbaren Gruppen mit Kurzinfo – Versorgung, Produktion, Palast/
Ministerium/Items, Erweitert – direkt über „Wohnraster planen“, darunter
Ladeanzeige, Ergebnis & Export) und „Weitere Funktionen“ (Stadt-Stempel
analysieren, Beispielstadt, Katalog-Teststempel, Bedienung). Die Ebene der
Plan-Ansicht wählt man oben rechts im Bild. Die Ladeanzeige (Schritt x/y,
Balken, Zeit, Details) erscheint unter dem Button und groß über dem Bild.

Gründlichkeit (unter „Erweitert“): **Durchläufe** 1/3/5/10 – die ganze Planung
läuft mehrmals mit anderer Linienlänge bzw. anderem Zufall, gleichzeitig in
eigenen Workern (so viele wie CPU-Kerne frei sind); der Plan mit den meisten
Einwohnern gewinnt (Standard 10). **Querstraßen nach Bedarf**: nach der
Versorgung Querstraßen dort einfügen, wo sie Läden/Strom mehr Häuser
erreichen lassen, als sie kosten (+0,7 % auf Insel 2). **Querstraßen ausdünnen**: nach der
Versorgung entbehrliche Querstraßen-Stücke entfernen und Reihen
zusammenschieben, ohne Versorgung, Lagerwege oder Netz zu verschlechtern.
**Läden zusätzlich exakt prüfen** (Standard aus): nach der gierigen Wahl ein
ganzzahliges Modell mit dem Löser HiGHS (WebAssembly, wird nur dann geladen);
die bessere Lösung bleibt. Gemessen fast immer dieselbe Auswahl, Durchlauf
deutlich länger (Abschnitt 27, M4).
Getrennte Inselteile bekommen je ein eigenes Raster. Messungen und Grenzen:
`docs/PLAN_Stadtplaner.md`, Abschnitt 25.

Beim Planen zuschauen (Standard an): Nach jedem Schritt (Bebauung,
Rathäuser – während der Suche etwa alle 2 s –, Nachverdichtung, Versorgung,
Stufen) zeigt die Plan-Ansicht den Zwischenstand.

Insel 2 mit Stufen (6er-Linien, 4-5): ≈ 549.700 Einwohner (nur Stufe 3 ≈
484.000). Brücken verbinden getrennte Inselteile (Ansicht/Berechnung, nicht
im Export), überflüssige Straßenstummel werden bebaut, optional genug
Ingenieure für die Kraftwerke. Die zuletzt geladene Insel und alle
Einstellungen werden im Browser gespeichert.

Insel 2 (189 × 290): ≈ 2.110 Häuser ohne bzw. ≈ 2.055 mit 25 Rathäusern
(vorher 2.010), geschätzte Einwohner 390.400 → 398.300 (+2 %); mit
Vollversorgung (≈ 8 je Art, 7 Lagerhäuser, ≈ 1.880 Häuser) ≈ 459.000; Rest ≈ 6 %,
fast nur 1–2 Kacheln breite Küstenränder. Theoretisches Ideal des 8er-Rasters
ohne Ränder und Rathäuser: 2.253 Häuser.
Export: Bauernhäuser, Pflasterstraßen, Rathäuser, optional Feldweg auf freien
Randkacheln; ein Stempel oder Teile bis 13.500 Kacheln; Bauplan als Bild.

**Ansicht bedienen** (alle Ansichten): Mausrad zoomt um den Mauszeiger,
rechte (oder mittlere) Maustaste gedrückt halten verschiebt das Bild, Knöpfe
unten rechts: +, −, ganze Insel. In „Plan / Analyse“ stehen ab etwa 4× Zoom
Schicht, Einwohner, Panorama und Rathaus-Abdeckung auf jedem Haus. Klick wählt
ein Gebäude an (Infofeld rechts oben mit allen Werten, bei Häusern Knöpfe zum
Tauschen von Ingenieuren/Investoren; Radius des Gebäudes wird eingezeichnet);
Strg+Klick tauscht die Gruppe, Umschalt+Klick ein einzelnes Haus.

**Stadt-Stempel analysieren** (Phase 1):

1. Einen Ausschnitt der fertigen Stadt im Spiel als Stempel speichern und unter
   „Stadt-Stempel wählen“ laden (oder „Beispielstadt öffnen“).
2. Palastflügel, Prestige, Ministerium (Wohlfahrt/Arbeit) und Richtlinie
   einstellen. Daraus folgen die Reichweite des Regionalministeriums (halbe
   Palastreichweite) und der Reichweitenbonus öffentlicher Gebäude.
3. Ebenen ansehen: Panorama je Hochhaus, geschätzte Einwohner, Versorgung je
   Gebäudeart über Straßen (grün/rot), Rathaus- und Post-Radien, Wirkungsbereich
   des Ministeriums, Handelskammern/Clipping. Maus über ein Gebäude zeigt Details.
4. „Katalog-Teststempel herunterladen“ erzeugt einen Stempel mit jedem bekannten
   Gebäude (auch gedreht) und dem Lufthafen mit Modulen – zum Prüfen von GUIDs,
   Größen und Drehung im Spiel.

Regeln (Wiki-Werte, Pflasterstraße): Reichweite über Straßen per Breitensuche ab
den seitlich berührenden Straßenkacheln; Kreisradien zählen, wenn der
Gebäudemittelpunkt im Radius liegt (≤); Panorama: Ausgangswert = Stufe, im
Radius gleiche Stufe gleiche Schicht −1, andere Schicht +1, niedriger +1.

### Exportoptionen

- **Alles in einen Stempel (Test)** – standardmäßig aktiv. Ignoriert die
  13.500-Kachel-Grenze und legt alle Gebäude plus den Inselrand in einen
  einzigen Stempel. Damit lässt sich prüfen, ob das Spiel den großen Stempel
  annimmt. Abwählen stellt die bisherige Aufteilung wieder her.
- **Inselrand in Stempeln** – standardmäßig aktiv. Exportiert nur den äußeren
  Inselrand als Feldwege, nicht die gesamte Inselfläche. Unter den 4×4-Flächen
  der Gebäude wird der Rand ausgespart. So lässt sich der Stempel im
  Spiel an der Küste ausrichten.
- **ZIP** – enthält alle Stempel und `platzierung.txt` mit einer kurzen
  Beschreibung. Koordinatenlisten werden bewusst nicht mehr exportiert.

## Architektur

Reines TypeScript + Vite, keine Framework-Abhängigkeit außer `fflate` für ZIP.

| Datei | Aufgabe |
| --- | --- |
| `src/main.ts` | UI-Verdrahtung, Datei-Import, Teilezustand, Layout-/Exportfluss |
| `src/stampReader.ts` | Anno-Stempel dekodieren: Gebäude, Straßen, Region, GUIDs, Koordinatentransformation |
| `src/island.ts` | Teile kombinieren, Überlappung, automatische Ausrichtung |
| `src/buildings.ts` | Gebäudetypen: Handelskammer (GUID 1010516, R 15), Rathaus (GUID 100415, R 20) |
| `src/solver.ts` | Packung (Gitter-Starts, ILS, Abdeckungs-Politur), Validierung, Stempel-Aufteilung |
| `src/solver.worker.ts` | Web Worker: rechnet einen Solver-Lauf im Hintergrund |
| `src/solveRunner.ts` | verteilt Läufe mit verschiedenen Seeds auf mehrere Worker, nimmt den besten |
| `src/catalog.ts` | Gebäudekatalog: GUID, Größe, Reichweite (Pflaster), Radius, Wohlfahrt; Presets für alle übrigen Gebäude (`src/data/presets.json`, MIT, Anno Designer) |
| `src/rules.ts` | Palast/Regionalministerium, Richtlinien, Panorama- und Hochhaus-Tabellen |
| `src/city.ts` | Stadtmodell aus Stempel (Gebäude + Straßen in Kachelachsen), Straßen-Breitensuche |
| `src/analysis.ts` | Versorgung, Ministeriumsbereich, Rathaus/Post/HK-Radien, Panorama, Einwohner-Schätzung, Warnungen |
| `src/cityUi.ts` | Oberfläche der Stadt-Analyse |
| `src/testStamps.ts` | Katalog-Teststempel und Beispielstadt |
| `src/planner.ts` | Wohnraster (Gitter, Gruppen), Rathaus-Problem, Plan → Stempel, Bänder |
| `src/plannerUi.ts` | Oberfläche „Wohnraster planen“ |
| `src/coast.ts` | äußerer Inselrand (Verwaltung und Stadtplaner) |
| `src/stamp.ts` | Anno-Stempel schreiben: `BuildingInfo`, `StreetInfo`, `StreetCount`, Region |
| `src/render.ts` | Ergebnisansicht: Abdeckung, Lücken, Küstenrahmen, HKs, Radien |
| `src/placement.ts` | 2D-Anordnen-Ansicht: pixelgenaue Teile, Kachelraster, Drag-Hit-Test |
| `src/style.css` | Layout und Gestaltung |
| `research/` | Reverse-Engineering-Notizen und Referenzstempel (nicht für die Laufzeit nötig) |
| `test-parts/`, `test-stamps-fix/` | Testdaten für Import/Export; `Insel_189x290_Screenshot` ist eine aus einem Screenshot rekonstruierte echte Insel (Benchmark) |
| `scripts/check-solver.mjs` | Regressionstest des Solvers (`npm run check`) |
| `artifacts/` | Screenshots und kleine Stempel-Testartefakte |

### Datenfluss

```
Stempeldatei
  → decodeStamp()             (stampReader.ts)
  → IslandPart[]              (Straßenmaske, Region, streetGuid)
  → combineParts()            (island.ts; globale Maske)
  → SolveRunner / Worker      (solveRunner.ts, solver.worker.ts)
  → solve()                   (solver.ts; Layout je Gebäudetyp + Abdeckung)
  → splitChunks()             (nur wenn Ein-Stempel-Testmodus aus)
  → collectOuterStreets()     (main.ts; äußerer Inselrand)
  → buildStamp()              (stamp.ts; spielbarer Stempel)
  → Download / ZIP
```

## Algorithmus

### Inselmaske und Koordinaten

- Die Feldwege eines Anno-Stempels werden als Straßenkacheln gelesen; ihre
  Vereinigung ist die Inselmaske.
- Die Rohkoordinaten aus dem Stempel werden in `stampReader.ts` mit der
  Anno-Designer-Konvention `(x, y) = (−rawY, −rawX)` gedreht. Das behebt die
  frühere Spiegelung in der 2D-Ansicht.
- Mehrere Stempel werden automatisch zusammengesetzt (`assembleParts` in
  `src/assemble.ts`). Stempel kennen nur Lagen relativ zu ihrer Mitte; die
  Anordnung kommt aus der Form, und Information steckt fast nur an der Küste:
  - Je Paar werden alle Verschiebungen bewertet (FFT): übereinstimmende
    Küstenkacheln und Uferwasser (offenes Meer zählt nicht), − 32 ×
    Widersprüche; zusätzlich **Nähte** (Kante an Kante ohne Überlappung) und
    geschlossene Schnittkanten (quer durchs Land geschnittener Rand, hinter dem
    ein Nachbarteil Land hat).
  - Die Gesamtanordnung sucht eine Strahlsuche nach der Summe aller
    Paarbewertungen minus offener Schnittkanten – unabhängig von der
    Ladereihenfolge. Beim Nachladen bleiben vorhandene Teile liegen.
  - Lässt sich ein Teil um 1–3 Kacheln verschieben, ohne schlechter zu passen,
    wird es als „nicht eindeutig“ gemeldet und in die Mitte des Bereichs gelegt.
  - Tipp: Stempel mit 10–20 Kacheln Überlappung speichern, die auf beiden Seiten
    bis an die Küste reicht – dann ist die Lage eindeutig.
  - Referenzen: `test-parts/insel2/` (große Überlappungen, exakt) und
    `test-parts/insel3/` (Kante an Kante, ±1–3 Kacheln, wird gemeldet).

### Gebäude und Regel

| Gebäude | Größe | Radius | Mindestabstand der Mittelpunkte | GUID |
| --- | --- | --- | --- | --- |
| Handelskammer | 4×4 | 15 | 30 | 1010516 |
| Rathaus | 4×4 | 20 | 40 | 100415 |

- Der Mittelpunkt liegt bei `(x + 2, y + 2)` (Kachelzentren bei `+0,5`).
- Gleichartige Gebäude dürfen sich mit ihren Radien **nicht überlappen**:
  Mittelpunktabstand ≥ 2 × Radius. Genau 2 × Radius ist Berührung und erlaubt.
- HK und Rathaus dürfen sich gegenseitig überlappen, nur ihre 4×4-Flächen
  nicht. Im Modus „Beide“ werden zuerst die HK gelöst, die Rathäuser weichen
  deren Flächen aus.
- Die Abdeckung zählt Landkacheln, deren Zentrum im Radius liegt; Wasser zählt
  nicht. Da sich gleichartige Kreise nicht überlappen, ist die Abdeckung die
  Summe der Einzelabdeckungen.

### Optimierungsproblem

Jede 4×4-Landposition ist ein Kandidat; zwei Kandidaten stehen im Konflikt,
wenn ihr Abstand < 2 × Radius ist. Gesucht ist eine **maximale unabhängige
Menge** in diesem Unit-Disk-Graphen (NP-schwer), lexikographisch bewertet:
1. möglichst viele Gebäude, 2. möglichst viel abgedecktes Land.

Wichtig: Nur die 4×4-Fläche muss auf Land liegen, der Kreis darf über Wasser
ragen. Ein einzelnes, starres Hexagonalgitter (früheres Verfahren) ist im
Inneren optimal, verschenkt aber an unregelmäßigen Küsten viel Platz.

### Verfahren (`solver.ts`)

1. **Startlösungen:** Hexagonale Gitter in 12 Drehwinkeln (0°–55°) mit je 18
   zufälligen Verschiebungen, dazu das exakte Ganzzahlgitter (30 × 26 bzw.
   40 × 35) in beiden Ausrichtungen. Rundungskonflikte werden übersprungen,
   danach gierig aufgefüllt (Kandidaten mit wenigen freien Nachbarn zuerst –
   Ecken und Ränder).
2. **Iterated Local Search** (nach Andrade, Resende & Werneck 2012, „Fast local
   search for the maximum independent set problem“):
   - lokale Suche mit **(1,2)-Tausch**: ein Gebäude raus, zwei hinein, wenn
     zwei nicht-konfliktierende Kandidaten nur mit diesem einen Gebäude
     kollidieren (exakt über den Durchmesser der konvexen Hülle geprüft),
   - Störung: einen Kandidaten erzwingen (Konflikte entfernen) und gierig
     auffüllen; Plateau-Züge werden immer akzeptiert,
   - alles inkrementell über einen `tight`-Zähler je Kandidat und nur lokal
     um geänderte Positionen (einige tausend Iterationen pro Sekunde),
   - kurze Läufe abwechselnd von der besten Lösung, von verschiedenen
     Startgittern und von frischen Zufallsgittern (Neustarts bringen mehr als
     ein langer Lauf).
3. **Abdeckungs-Politur:** Simulated Annealing über Verschiebungen einzelner
   Gebäude an Stellen, die nur mit ihnen selbst kollidieren; wird dabei Platz
   frei, kommt sofort ein weiteres Gebäude hinzu.
4. **Parallelisierung:** `solveRunner.ts` startet mehrere Worker mit
   verschiedenen Seeds und übernimmt das beste Ergebnis.

`validateLayout()` prüft am Ende die Invarianten; `npm run check` nutzt das.

### Ergebnisse (Benchmark)

Reale 189 × 290-Insel (25.823 Landkacheln, aus einem Screenshot rekonstruiert,
`test-stamps-fix/Insel_189x290_Screenshot`):

| Verfahren | Handelskammern | Abdeckung | Rathäuser | Abdeckung |
| --- | --- | --- | --- | --- |
| altes Hexgitter + Lückenfüllung | 33 | 79,4 % | – | – |
| neuer Solver, 2 s, 1 Kern | 40–41 | ≈ 85 % | 25 | ≈ 87 % |
| neuer Solver, 6 s+, mehrere Kerne | 41 | ≈ 86 % | 25–26 | ≈ 88 % |

Viele unabhängige Läufe (bis 60 s) fanden nie mehr als 41 HK; 26 Rathäuser
wurden selten gefunden (etwa 1 von 20–50 Läufen). Ein Optimalitätsbeweis ist
für Inseln dieser Größe mit exakter ganzzahliger Optimierung (HiGHS) nicht in
vertretbarer Zeit gelungen. Exakt bestätigt ist bisher nur eine kleine
Testinsel (≈ 2.300 Landkacheln): Optimum 4 HK, vom Solver gefunden.

### Inselrand im Stempel

- `outerBoundary()` flutet Wasser von außen (4er-Nachbarschaft) und markiert
  Landkacheln, die an dieses Außenwasser oder an den Maskenrand grenzen.
  Inseln im Inneren (Binnenseen) werden dadurch nicht als Außenrand behandelt.
- Es werden **nur diese Randkacheln** exportiert, nicht die Inselfläche.
- Kacheln unter den 4×4-Flächen der Gebäude werden ausgespart, damit sie im
  Spiel Platz haben.
- Der Rand wird als echte `StreetInfo`-Straße mit der GUID des importierten
  Feldwegs geschrieben (Fallback `101308`).

### Stempelformat (Kurzfassung)

Die App schreibt das Anno-1800-Stempelformat ohne Dateiendung:

- zlib-komprimierter Binärbaum mit Tag-/Attribut-Dictionaries,
- Wurzelknoten u. a. `StampPath`, `IconGUID`, `BuildingInfo`, `StreetInfo`,
  `StreetCount`, `Railway`,
- 4×4-`BuildingInfo`-Einträge für HKs (GUID 1010516) und Rathäuser (GUID 100415),
  `IconGUID` = Typ des ersten Gebäudes,
- `StreetInfo` mit Gruppenknoten (Tag 1), GUID-Attribut `0x8000` und
  Kachel-Tags für den Feldwegrand,
- `StreetCount` entspricht der Anzahl der geschriebenen Straßenkacheln.

Details und Referenzdateien liegen in `research/` (`filedb_v2.md`, `wiki.md`,
`stamp_converter.py`, `writer.py`, `real_stamp.bin`). Der Reader/Writer in
`src/` ist die maßgebliche Laufzeitimplementierung.

## Verifikation

Mindestens:

```bash
npm run build
npm run check
```

Manuell mit den Testdaten:

1. `test-stamps-fix/Insel_96x65_Feldwege` laden.
2. Ergebnis und Stempel erzeugen; ein Stempel mit allen HKs und dem Rand.
3. Optional `test-parts/Insel_Teil_A` + `Insel_Teil_B` laden und die
   automatische Ausrichtung prüfen.
4. Exportierten Stempel im Spiel testen (insbesondere Randposition und
   HK-Platzierung).

Wichtige Invarianten bei Änderungen:
- Keine zwei Radien gleichen Typs dürfen sich überlappen (Mittelpunktabstand
  ≥ 30 bei HK, ≥ 40 bei Rathäusern).
- 4×4-Flächen müssen vollständig auf Land liegen und dürfen sich nicht
  überlappen (auch nicht HK mit Rathaus).
- Stempeldateien ohne Endung exportieren.
- Feldwegrand nur außen, nicht als gefüllte Inselfläche.
- Koordinatentransformation beim Import nicht „vereinfachen“; sie ist die
  Korrektur der Spiegelung.

## Bekannte Grenzen

- Die genaue Spielbarkeit großer Ein-Stempel-Dateien ist noch nicht
  abschließend verifiziert; der Testmodus ist dafür da.
- Das Feldweg-Material/GUID wird aus dem Import übernommen; bei mehreren
  verschiedenen Feldweg-GUIDs wird die erste verwendet.
- Kein Straßenanschluss der Gebäude wird geprüft; der Planer optimiert die
  Radiusabdeckung.
- Die Suche ist randomisiert: Zwei Läufe können unterschiedliche, gleich gute
  oder leicht verschiedene Ergebnisse liefern. Mehr Rechenzeit bzw. „Weiter
  optimieren“ hilft bei großen Inseln.
- Für den Export wird der äußere Rand in jeden Teilstempel gelegt, wenn der
  Ein-Stempel-Modus deaktiviert ist. Bei aktivem Modus gibt es genau einen
  Stempel.
- Es gibt keine automatisierte Browser-/End-to-End-Testsuite; `npm run check`
  deckt nur den Solver ab.

## Beitragen / für andere KI-Agenten

`AGENTS.md` enthält die Arbeitsregeln, Befehle, Code-Landkarte und Invarianten.
Bitte zuerst `README.md` und `AGENTS.md` lesen, dann die betroffene Datei in
`src/` ändern und mindestens `npm run build` ausführen. Keine Secrets,
`node_modules`, Build-Ausgaben oder Browser-Profile committen.
