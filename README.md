# Anno 1800 – Handelskammer-Planer / Stempel-Generator

Browser-Tool zum Laden von Anno-1800-Inselstempeln (Feldwege), zum Berechnen einer
möglichst vollständigen Handelskammer-Aufstellung und zum Export spielbarer Stempel.

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
```

Der Build läuft mit `tsc --noEmit` (Typprüfung) und Vite. Es gibt aktuell keine
automatisierte Testsuite; die Prüfung erfolgt über Build, die mitgelieferten
Teststempel und einen Spieltest.

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
3. **Ergebnis prüfen:** Der Tab „Ergebnis“ zeigt die platzierten
   Handelskammern, ihre 15er-Radien, Abdeckung und Lücken.
4. **Stempel exportieren:** Im Bereich „Stempel“ herunterladen oder alle
   Ergebnisse als ZIP. Dateien haben bewusst **keine Dateiendung** (Anno-
   Stempelformat). Ablage:
   `Documents\Anno 1800\stamps\<Region>\<Projektname>\`
   Danach Anno 1800 neu starten.

### Exportoptionen

- **Alles in einen Stempel (Test)** – standardmäßig aktiv. Ignoriert die
  13.500-Kachel-Grenze und legt alle Handelskammern plus den Inselrand in einen
  einzigen Stempel. Damit lässt sich prüfen, ob das Spiel den großen Stempel
  annimmt. Abwählen stellt die bisherige Aufteilung wieder her.
- **Inselrand in Stempeln** – standardmäßig aktiv. Exportiert nur den äußeren
  Inselrand als Feldwege, nicht die gesamte Inselfläche. Unter den 4×4-Flächen
  der Handelskammern wird der Rand ausgespart. So lässt sich der Stempel im
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
| `src/solver.ts` | Handelskammer-Packung, Abdeckung, Chunk-Aufteilung |
| `src/stamp.ts` | Anno-Stempel schreiben: `BuildingInfo`, `StreetInfo`, `StreetCount`, Region |
| `src/render.ts` | Ergebnisansicht: Abdeckung, Lücken, Küstenrahmen, HKs, Radien |
| `src/placement.ts` | 2D-Anordnen-Ansicht: pixelgenaue Teile, Kachelraster, Drag-Hit-Test |
| `src/style.css` | Layout und Gestaltung |
| `research/` | Reverse-Engineering-Notizen und Referenzstempel (nicht für die Laufzeit nötig) |
| `test-parts/`, `test-stamps-fix/` | Synthetische Testdaten für Import/Export |
| `artifacts/` | Screenshots und kleine Stempel-Testartefakte |

### Datenfluss

```
Stempeldatei
  → decodeStamp()             (stampReader.ts)
  → IslandPart[]              (Straßenmaske, Region, streetGuid)
  → combineParts()            (island.ts; globale Maske)
  → solve()                   (solver.ts; HK-Layout + Abdeckung)
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

### Handelskammern

- Eine HK belegt **4×4** Kacheln; ihr Einflussradius ist **15** Kacheln.
- Der Mittelpunkt liegt bei `(x + 1.5, y + 1.5)`.
- Zwei HKs dürfen sich mit ihren Radien **nicht überlappen**. Der Solver
  verlangt einen Mittelpunktabstand von mindestens **30** (15 + 15). Ein
  Abstand von genau 30 ist eine Berührung, keine Flächenüberlappung; das
  hexagonale Grundraster nutzt diesen Grenzfall bewusst.
- Das Grundraster ist hexagonal: `DX = 30`, `DY = 26`, ungerade Zeilen um 15
  verschoben. Der Ursprung wird zuerst auf einem 5er-Raster und danach fein
  (±5 in 1er-Schritten) optimiert; bewertet werden Anzahl und danach Abdeckung.
- **Gap-Fill:** Das feste Raster kann an unregelmäßigen Küsten Lücken lassen,
  die zwischen den Rasterpunkten liegen. Deshalb prüft `fillGaps()` anschließend
  **jede** mögliche 4×4-Landposition als Kandidaten. Kandidaten mit
  Mittelpunktabstand < 30 zu einer bestehenden HK werden verworfen. Mehrere
  Greedy-Reihenfolgen (Abdeckung, Zeilen, Spalten, Umkehrungen) und ein lokaler
  Tausch wählen die maximale zusätzliche Abdeckung. Das ist der Grund, warum
  auch Randnischen gefüllt werden, die kein hexagonales Raster trifft.
- Die Abdeckung zählt Landkacheln innerhalb der Radien; Wasser zählt nicht.

### Inselrand im Stempel

- `outerBoundary()` flutet Wasser von außen (4er-Nachbarschaft) und markiert
  Landkacheln, die an dieses Außenwasser oder an den Maskenrand grenzen.
  Inseln im Inneren (Binnenseen) werden dadurch nicht als Außenrand behandelt.
- Es werden **nur diese Randkacheln** exportiert, nicht die Inselfläche.
- Kacheln unter den 4×4-Flächen einer HK werden ausgespart, damit die HKs im
  Spiel Platz haben.
- Der Rand wird als echte `StreetInfo`-Straße mit der GUID des importierten
  Feldwegs geschrieben (Fallback `101308`).

### Stempelformat (Kurzfassung)

Die App schreibt das Anno-1800-Stempelformat ohne Dateiendung:

- zlib-komprimierter Binärbaum mit Tag-/Attribut-Dictionaries,
- Wurzelknoten u. a. `StampPath`, `IconGUID`, `BuildingInfo`, `StreetInfo`,
  `StreetCount`, `Railway`,
- 4×4-`BuildingInfo`-Einträge für die HKs (GUID 1010516),
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
```

Manuell mit den Testdaten:

1. `test-stamps-fix/Insel_96x65_Feldwege` laden.
2. Ergebnis und Stempel erzeugen; ein Stempel mit allen HKs und dem Rand.
3. Optional `test-parts/Insel_Teil_A` + `Insel_Teil_B` laden und die
   automatische Ausrichtung prüfen.
4. Exportierten Stempel im Spiel testen (insbesondere Randposition und
   HK-Platzierung).

Wichtige Invarianten bei Änderungen:
- Keine zwei HK-Radien dürfen sich überlappen (Mittelpunktabstand ≥ 30).
- HK-Footprints müssen vollständig auf Land liegen.
- Stempeldateien ohne Endung exportieren.
- Feldwegrand nur außen, nicht als gefüllte Inselfläche.
- Koordinatentransformation beim Import nicht „vereinfachen“; sie ist die
  Korrektur der Spiegelung.

## Bekannte Grenzen

- Die genaue Spielbarkeit großer Ein-Stempel-Dateien ist noch nicht
  abschließend verifiziert; der Testmodus ist dafür da.
- Das Feldweg-Material/GUID wird aus dem Import übernommen; bei mehreren
  verschiedenen Feldweg-GUIDs wird die erste verwendet.
- Kein Straßenanschluss der HKs wird geprüft; der Planer optimiert die
  Radiusabdeckung.
- Für den Export wird der äußere Rand in jeden Teilstempel gelegt, wenn der
  Ein-Stempel-Modus deaktiviert ist. Bei aktivem Modus gibt es genau einen
  Stempel.
- Es gibt keine automatisierte Browser-/End-to-End-Testsuite.

## Beitragen / für andere KI-Agenten

`AGENTS.md` enthält die Arbeitsregeln, Befehle, Code-Landkarte und Invarianten.
Bitte zuerst `README.md` und `AGENTS.md` lesen, dann die betroffene Datei in
`src/` ändern und mindestens `npm run build` ausführen. Keine Secrets,
`node_modules`, Build-Ausgaben oder Browser-Profile committen.
