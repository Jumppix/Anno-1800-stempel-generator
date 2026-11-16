# AGENTS.md – Anno 1800 Handelskammer- & Rathaus-Planer

Diese Datei ist die Kurzanleitung für KI-Agenten und Entwickler. Ausführliche
Hintergründe stehen in `README.md`; der Quellcode in `src/` ist maßgeblich.

## Auftrag

Ein reines Browser-Tool (TypeScript + Vite) zum:
1. Importieren von Anno-1800-Inselstempeln (Feldwege/Straßen),
2. Zusammensetzen und Ausrichten mehrerer Stempelteile,
3. Packen von 4×4-Handelskammern (Radius 15) und/oder Rathäusern (Radius 20)
   ohne Radiusüberlappung gleichartiger Gebäude,
4. Exportieren spielbarer Stempel ohne Dateiendung, inklusive äußerem
   Inselrand als Feldweg-Orientierung.

Es gibt kein Backend, keine Datenbank und keine Uploads.

## Befehle

```bash
npm ci
npm run dev       # lokaler Dev-Server, Basis /
npm run build     # tsc + Vite; Pflichtprüfung nach Änderungen
npm run preview   # Produktionsbuild lokal
npm run check     # Solver-Regressionstest + Invarianten (scripts/check-solver.mjs)
```

Node 22+ wird in GitHub Actions verwendet. `package-lock.json` nicht
unnötig verändern.

## GitHub Pages

- Workflow: `.github/workflows/pages.yml`
- Build: `npm ci && npm run build`, Upload `dist/`, Deploy via
  `actions/deploy-pages`.
- `vite.config.js` setzt die Basis automatisch:
  - lokal `/`
  - Actions `/<repo>/` aus `GITHUB_REPOSITORY`
- Live-URL: https://jumppix.github.io/Anno-1800-stempel-generator/
- Falls Pages noch nicht aktiv ist: Repository → Settings → Pages → Source:
  **GitHub Actions**. Optional Secret `PAGES_ADMIN_TOKEN` für automatisches
  Aktivieren; niemals Token in Dateien schreiben.

## Code-Landkarte

- `src/main.ts`: UI, Import, Zustand, `update()`/`rebuildOutputs()`, Export,
  Randstrecken.
- `src/buildings.ts`: Gebäudetypen (Größe, Radius, GUID, Farbe).
- `src/stampReader.ts`: Binärparser, Koordinatentransformation
  `(x, y) = (−rawY, −rawX)`, Gebäude/Straßen/GUIDs.
- `src/island.ts`: `combineParts`, `overlapCount`, `alignPartTo`/`scanOffsets` (Einzelteil).
- `src/assemble.ts`: `assembleParts` – alle Teile gemeinsam zusammensetzen (Paarbewertung per FFT
  inkl. Nähte und Schnittkanten, Strahlsuche, unsichere Teile melden); Referenzen
  `test-parts/insel2/` (exakt) und `test-parts/insel3/` (Kante an Kante).
- `src/solver.ts`: `solve` (Gitter-Starts → Iterated Local Search mit
  (1,2)-Tausch → Simulated-Annealing-Politur der Abdeckung), `validateLayout`,
  `splitChunks`.
- `src/solver.worker.ts` / `src/solveRunner.ts`: Solver im Web Worker, mehrere
  Worker mit verschiedenen Seeds, bester gewinnt; bei „Beide“ erst HK, dann
  Rathäuser um die HK-Flächen.
- `src/stamp.ts`: `buildStamp` (HK/RH), `buildGenericStamp` (beliebige
  Gebäude mit Drehung), `StreetInfo`/`BuildingInfo`-Writer.
- `src/stampReader.ts`: zusätzlich `decodeStampFull` (Gebäude + Straßen mit
  GUID; Attribut-IDs über das Namensverzeichnis, da Spiel- und App-Stempel
  verschiedene IDs nutzen).
- Stadt-Analyse (Phase 1 von `docs/PLAN_Stadtplaner.md`): `src/catalog.ts`,
  `src/rules.ts`, `src/city.ts`, `src/analysis.ts`, `src/cityUi.ts`,
  `src/testStamps.ts`. Phase 2: `src/fill.ts` (vollständige Bebauung: Gitter über die ganze
  Insel mit je Band verschobenen Längsstraßen, gieriges Füllen, Straßenverlängerung, Gittersuche),
  `src/planner.ts` (Plan, Rathaus-Problem über `solve(..., { allowed, overlapPenalty })`,
  Rathäuser auf Querstraßen `crossRoadTiles`, `compactCity`), `src/compact.ts` (Nachverdichtung:
  Fenster räumen/neu belegen, Rathäuser verschieben), `src/planner.worker.ts` (Gittersuche,
  Versorgung und Nachverdichtung im Worker), `src/plannerUi.ts`. Phase 3: `src/services.ts`
  (Versorgungsgebäude + Lagerhäuser, gewichtetes Überdeckungsproblem mit lokaler Suche;
  Zelltyp `SERVICE` in `fill.ts`, `CityPlan.services`),
  `src/coast.ts`. Generierte Wohnhäuser sind immer Bauernhäuser (1010343).
  Footprint in Kachelachsen: Preset `[x, z]` → bei Dir 0
  Breite z × Höhe x, bei 90°/270° vertauscht.
- `src/placement.ts`: 2D-Anordnen-Ansicht, pixelgenaue Zeichnung,
  Kachelraster, Drag-Hit-Test.
- `src/render.ts`: Ergebnisansicht.
- `src/persist.ts`: letzte Insel (Teile/Anordnung) und Einstellungen im
  Browser speichern.
- `src/post.ts`: Briefkästen planen (Produktion nach Einwohnern im Radius, Post inselweit);
  Ministerium und Lufthafen (`options.ministry`, `options.airport`, Komplex-ID 9001) in `services.ts`;
  Hauptanlegestelle per Klick (`PlannerUi.setHarbor`, `harborPick` in `main.ts`).
- `src/production.ts`: geclippte Produktion (Phase 5) – Liste `CLIPPABLE` in `catalog.ts`,
  `findFormations` (HK-Gitter mit Kanten genau 30: quadratisch, Raute, optional schräges Quadrat;
  Gebäude auf Kantenmitte), Einbau/Strom/Lagerhaus in `services.ts` (`options.production`).
  Optional exakter Löser für die Läden: `options.mip` (HiGHS, `highs`, im `pipeline.worker.ts`
  nur bei `PassInput.exact` per dynamischem Import geladen; Worker im ES-Format, `vite.config.js`).
- Plan bearbeiten (Phase 6): `editCity`/`editTargetAt` in `src/planner.ts`, Ziehen/Tasten in
  `CityUi` (`PlanEditor`, `setEditor`), Verlauf/Neuberechnen in `PlannerUi`.
- `src/levels.ts`: Hochhaus-Stufen (3-3-5/4-5) per Simulated Annealing;
  Option Mindest-Ingenieure (250 je Gaskraftwerk).
- Brücken (`addBridges`, Zelltyp `BRIDGE`, `GridPlan.bridges`) und
  Straßenstummel (`replaceRoadStubs`) in `src/fill.ts`.
  Abgetrennte Straßenstücke langer Bänder werden per `connectRoadPieces` angebunden.
  Getrennte Landstücke bekommen in `searchFill` je ein eigenes Raster (`orientationMap`);
  `realignLanes` belegt Häuserspalten exakt neu (Ende der Nachverdichtung).
- `src/thin.ts`: `thinCrossRoads` – Querstraßen-Stücke nach der Versorgung ausdünnen
  (Häuserwert gegen Abdeckung, Lagerwege, Ministerium, Netz); Hülle `thinCity` in `planner.ts`.
  `PlannerUi.run` startet bis zu 10 Durchläufe (`passList`) gleichzeitig im Worker-Pool
  (`src/pipeline.ts` `runPass` in `src/pipeline.worker.ts`), bester Plan gewinnt.
- `src/codesign.ts`: `insertCrossRoads` – Querstraßen (auch Ketten) nach Bedarf einfügen
  (Abdeckungsgewinn gegen Häuser); `improveRoads` in `planner.ts` = Einfügen + Ausdünnen.
- `src/camera.ts`: Zoom/Verschieben (Mausrad, rechte Maustaste) für Anordnen,
  Ergebnis und Plan/Analyse; Ereignisse in `main.ts`, `CityUi.camera`.
- `src/style.css`: Styling.
- `research/`: Reverse-Engineering, Referenzstempel, keine Laufzeitabhängigkeit.
- `test-parts/`, `test-stamps-fix/`: Testdaten ohne Endung
  (`test-parts/insel2/`: echte Insel in 4 überlappenden Teilen;
  `test-stamps-fix/Clipping_*`: Clipping-Formationen aus dem Spiel).

## Invarianten (nicht brechen)

1. **Keine Radiusüberlappung gleichartiger Gebäude:** Mittelpunktabstand
   ≥ 2 × Radius (HK 30, Rathaus 40). Genau 2 × Radius ist Berührung und
   erlaubt. Konfliktdefinition: `Packer.conflict`/`span` in `solver.ts`;
   `validateLayout` und `npm run check` prüfen das.
2. **Footprint:** 4×4, vollständig auf Land (Präfixsumme in `Packer`), keine
   Überlappung der Flächen – auch nicht zwischen HK und Rathaus.
3. **Keine gespiegelten Koordinaten:** Die Transformation in
   `stampReader.ts` ist die Anno-Designer-Konvention und behebt die frühere
   Spiegelung. Nicht durch eine naive 1:1-Übernahme ersetzen.
4. **Stempel ohne Endung** exportieren; nicht `.stamp` anhängen.
5. **Feldwegrand:** nur äußerer Inselrand, keine gefüllte Inselfläche;
   unter HK-Flächen aussparen.
6. **Ein-Stempel-Testmodus:** Checkbox `single-stamp` ist standardmäßig an und
   ignoriert die 13.500er-Aufteilung. Abwählen muss die alte
   `splitChunks`-Aufteilung wiederherstellen.
7. **Vite-Basis:** nicht hart auf `/` setzen; GitHub Pages braucht
   `/<repo>/`. Die Logik in `vite.config.js` beibehalten.
8. **Keine Secrets / generierten Dateien committen:** `.env*`,
   `node_modules/`, `dist/`, Caches sind ignoriert.

## Änderungs-Workflow

1. `README.md` und diesen Abschnitt lesen.
2. Relevante Datei in `src/` ändern; bestehende Konventionen (deutsche UI-Texte,
   keine zusätzlichen Frameworks) beibehalten.
3. `npm run build` ausführen; bei Solver-/Exportänderungen zusätzlich
   `npm run check` (Teststempel + Invarianten).
4. Bei UI-Änderungen die Anordnen-/Ergebnisansicht im Browser prüfen.
5. Nur bei ausdrücklichem Auftrag committen/pushen; GitHub Pages deployt
   danach automatisch von `main`.

## Bekannte offene Punkte

- Spielbarkeit des großen Ein-Stempel-Exports ist noch ein Praxistest.
- Kein automatisierter End-to-End-/Browser-Test (nur `npm run check` für den
  Solver).
- Stadtplaner: Produktion → Lagerhaus 60 Pflasterkacheln (Angabe des Nutzers für Hochrad-Werkhallen;
  für andere Fabriken ungeprüft).
- Optimalität ist für große Inseln nicht bewiesen; Benchmark-Insel
  189 × 290: 41 HK / 25–26 Rathäuser (alter Solver: 33 HK).
- Der Feldweg-GUID wird aus dem ersten importierten Stempel übernommen
  (Fallback 101308).
