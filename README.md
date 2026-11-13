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
Mindestanzahlen. Ein Spieltest bleibt für die Spielbarkeit nötig.

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
- Mehrere Stempel werden über ihr Straßenmuster ausgerichtet
  (`alignPart`/`autoPlace` in `island.ts`). Die Überlappung ist der Anker; die
  automatische Ausrichtung sucht den besten Versatz im Suchradius.

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

Hunderte unabhängige Läufe (bis 60 s) fanden nie mehr als 41 HK; 26 Rathäuser
wurden selten gefunden. Ein Beweis der Optimalität ist für Inseln dieser Größe
mit exakten Verfahren (ganzzahlige Optimierung) nicht in vertretbarer Zeit
möglich; für kleine Inseln stimmt der Solver mit dem exakten Optimum überein.

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
