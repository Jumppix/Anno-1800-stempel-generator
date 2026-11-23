# Plan & Recherche: Küsten- und Wassergebäude (Grundlage für einen späteren Optimierer)

Stand 23.11.2026. Quellen: Spieldateien des Nutzers (assets.xml/templates.xml, `Building.TerrainType`,
`Blocking`, `ItemContainer`, `BuildingUnique`, `ModuleOwner`), Anno-Designer-Presets (Grundflächen),
Anno-1800-Wiki (Seiten „Harbour buildings“, „Pier“, „Quay“, „Harbourmaster's Office“, „Docklands“,
„Commuter Pier“, „Oil Harbour“, einzelne Produktionsgebäude).

## 1. Geländearten (Spieldaten `Building.TerrainType`)

| TerrainType | Bedeutung (Wiki) | Gebäude (Auswahl) |
| --- | --- | --- |
| `Coast` | **freie Küstenlinie** – Gebäude sitzt auf der Uferlinie (teils Land, teils Wasser) | Kontor (alle Größen), Ölhafen, Besucherhafen/Touristenhafen, Pendlerkai, Dicke Berta, Saline, Zuchtbecken (Hummer), Walfängerei, Robbenfängerei, Strand (NW), Cyanidlaugerei |
| `Water_Including_Coast` | **freies Hafengebiet** – Wasser- bzw. Küstenkacheln im Hafengebiet | Fischerei, Quarzgrube, Salpeterwerk, Perlenfarm, Fischölfabrik, Calamares-Fischerei, Anlegestelle, Hafenmeisterei, Depot, Öllager, Steinkohlelager, Segel-/Dampfschiffswerft, Reparaturkran, Geschützstellung/Kanonenturm/Flak/Flammenwerfer/Panzerbrechendes Geschütz, Speicherstadt mit allen Modulen, Kai/Kaimauer/Kaistraße, Hafen-Zierde (Leuchttürme, Fässer, Uferbänke …) |
| `Water_Excluding_Coast` | nur offenes Wasser | Zierde: Angedockter/Verankerter Frachter, Beladener Kahn, Fischschwarm |
| `Beach` / `Terrain_Including_Beach` | Strandkacheln | Strand-Zierde (Bootshaus, Eissalon, Umkleiden, Sand, Piraten-Zierde) |
| `Terrain` (Rest) | Land | alle übrigen Gebäude |

## 2. Regeln (Wiki + Spieldaten)

- **Hafengebiet**: Wasser-/Küstenkacheln vor der Uferlinie, in denen Hafengebäude stehen dürfen.
  Es entsteht und wächst durch Gebäude mit `Blocking.HarbourAreaExpand` (Kontor, Ölhafen,
  Besucherhafen, Speicherstadt, Docklands-Anlegestelle u. a.; `HarbourAreaSize` 1–2 bei den
  Speicherstadt-Modulen). **Die genaue Form (Tiefe ins Wasser) steht nicht in assets.xml** – sie
  liegt in den Insel-/Geometriedateien (cfg/ifo, Inselkarten) → im Spiel messen (Abschnitt 5).
- **Kai (Quay)** ist reine Zierde im Hafengebiet, ohne Funktion und ohne Attraktivität;
  Verbindungen zum Kontor/Lagerhaus nur über Straßen.
- **Straßenanschluss** nötig: Fischerei, Quarzgrube, Salpeterwerk, Perlenfarm, Fischölfabrik, Pendlerkai
  (an Kontor/Lagerhaus, Nachbarschaft zum Kontor reicht nicht). **Ohne Straße**: Depot, Öllager,
  Hafenmeisterei, Anlegestelle, Reparaturkran, Geschütze, Speicherstadt; Ölhafen braucht Schienen.
- **Einmal je Insel** (`BuildingUnique` Area): Kontor, Ölhafen, Besucherhafen, Pendlerkai, Speicherstadt.
- **Fruchtbarkeit/Vorkommen**: Salpeterwerk (Salpeter), Perlenfarm (Perlen), Walfängerei (Wale,
  + Heizung), Robbenfängerei (Robben, + Heizung), Zuchtbecken/Hummer (Hummer).
- **Anlegestelle**: freies Hafengebiet und „keine Hindernisse davor“ (Schiffe brauchen eine freie
  Anfahrt); je Anlegestelle ein Handelsroutenschiff gleichzeitig (+ ein Luftschiff); 2 t/s.
- **Hafenmeisterei**: 3 Item-Plätze, Radius 20; **Radien zweier Hafenmeistereien bzw.
  Speicherstädte dürfen sich nicht überschneiden** (kein Clipping, anders als bei Handelskammern);
  Speicherstadt wirkt wie eine Hafenmeisterei mit Radius 30 (3 Plätze). Palast-Richtlinie
  „Hafenverwaltung“: +1 Platz (nur Hafenmeisterei); „Küstenreformen“: +300 % für
  Küsten-Produktion im Radius.
- **Speicherstadt**: Module im selben Hafengebiet, aber nicht zwingend im Radius. Modul-Grenzen
  (Spieldaten): Depot 5, Hafenmeisterei 2, Anlegestelle 3, Exportbüro 2, Reparaturkran 3,
  Verladekai 2 – je Exportstufe mehr. Ein Tauschvertrag je Speicherstadt, je Exportbüro einer mehr
  (bis 14).
- **Bögen**: 17 Gebäude haben `HasBuildableTilesBelowArch` (Bogenhöhe 1,0–1,2) – darunter lässt
  sich bauen.

## 3. Alle Küsten-/Wassergebäude (Spieldaten, ohne NPC-/Kampagnen-Varianten)

Größe aus Anno Designer („?“ = dort nicht hinterlegt).

| Gelände | Vorlage | Gebäude | GUID | Region | Größe (AD) | Limit | Besonderheiten |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Coast | BuffFactory | Strand | 6264 | NW | ? |  | blockiert Wasser |
| Coast | FactoryBuilding7 | Saline | 114440 | En | 13×6 |  |  |
| Coast | FactoryBuilding7 | Zuchtbecken | 118729 | En | 16×5 |  |  |
| Coast | FactoryBuilding7_Arctic | Walfängerei | 112666 | Ar | 17×6 |  |  |
| Coast | FarmBuilding | Cyanidlaugerei | 24844 | NW | 9×6 |  |  |
| Coast | HarborBuildingAttacker | Dicke Berta | 101571 | NW | ? |  |  |
| Coast | HarborBuildingAttacker | Dicke Berta | 1010524 | AW | 6×4 |  |  |
| Coast | HarborWarehouse7 | Großes Kontor | 100511 | AW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Großes Kontor | 101292 | NW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Großes Kontor | 112661 | Ar | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Großes Kontor | 114628 | En | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Kleines Kontor | 101290 | NW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Kleines Kontor | 112659 | Ar | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Kleines Kontor | 114626 | En | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Kleines Kontor | 1010517 | AW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Kleines Kontor | 1010540 | AW | 9×7 |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Mittleres Kontor | 100510 | AW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Mittleres Kontor | 101291 | NW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Mittleres Kontor | 112660 | Ar | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Mittleres Kontor | 114627 | En | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouse7 | Paketschiffbüro | 101407 | Meta,AW,NW,Ar | ? |  | Anlegeplatz |
| Coast | HarborWarehouse7 | Riesiges Kontor | 269867 | AW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Großer Ölhafen | 101404 | AW | ? | 1/Insel | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Großer Ölhafen | 101406 | NW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Großer Ölhafen | 119033 | En | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Kleiner Ölhafen | 100783 | AW | 10×7 | 1/Insel | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Kleiner Ölhafen | 101329 | NW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Kleiner Ölhafen | 119031 | En | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Mittlerer Ölhafen | 101403 | AW | ? | 1/Insel | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Mittlerer Ölhafen | 101405 | NW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Mittlerer Ölhafen | 119032 | En | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Riesiger Ölhafen | 119259 | AW | ? | 1/Insel | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Riesiger Ölhafen | 119281 | NW | ? |  | Anlegeplatz |
| Coast | HarborWarehouseStrategic | Riesiger Ölhafen | 270172 | En | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | HarborWarehouseStrategic | Steinkohlehafen | 100781 | AW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Coast | PostBoxBuildingWithDepot | Wasseraufbereitungsanlage | 7413 | NW | ? |  | Item-Radius 26 |
| Coast | VisitorPier | Besucherhafen | 100429 | AW | 25×8 | 1/Insel | erweitert Hafengebiet |
| Coast | VisitorPier | Touristenhafen | 133890 | AW | ? |  |  |
| Coast | VisitorPierColony | Besucherhafen | 102284 | NW | ? | 1/Insel | erweitert Hafengebiet |
| Coast | WorkforceConnector | Pendlerkai | 101642 | Meta,AW,NW,Ar | 15×5 | 1/Insel |  |
| Water_Including_Coast | BuffFactory | Verladekran | 7314 | NW | ? |  |  |
| Water_Including_Coast | DocklandItemModule | Hafenmeisterei | 601461 | AW | 3×3 |  | Hafengebiet 1 |
| Water_Including_Coast | DocklandMain | Speicherstadt | 601470 | AW | 7×6 | 1/Insel | erweitert Hafengebiet, Anlegeplatz, Item-Radius 30 |
| Water_Including_Coast | DocklandModule | Exportbüro | 601462 | AW | 3×3 |  | Hafengebiet 1 |
| Water_Including_Coast | DocklandModule | Verladekai | 131778 | AW | 3×3 |  | Hafengebiet 1 |
| Water_Including_Coast | DocklandModuleRepair | Reparaturkran | 131777 | AW | 3×3 |  | Hafengebiet 1 |
| Water_Including_Coast | DocklandPierModule | Anlegestelle | 601460 | AW | 5×5 |  | erweitert Hafengebiet, Hafengebiet 2, Anlegeplatz |
| Water_Including_Coast | DocklandStorageModule | Depot | 601463 | AW | 3×3 |  | Hafengebiet 1 |
| Water_Including_Coast | FactoryBuilding7 | Calamares-Fischerei | 7919 | NW | ? |  |  |
| Water_Including_Coast | FactoryBuilding7 | Fischerei | 1010278 | AW | 11×5 |  |  |
| Water_Including_Coast | FactoryBuilding7 | Fischölfabrik | 101262 | NW | 11×5 |  |  |
| Water_Including_Coast | FactoryBuilding7 | Perlenfarm | 1010339 | NW | 14×6 |  |  |
| Water_Including_Coast | FactoryBuilding7 | Quarzgrube | 1010560 | AW | 10×6 |  |  |
| Water_Including_Coast | FactoryBuilding7 | Salpeterwerk | 101303 | NW | ? |  |  |
| Water_Including_Coast | FactoryBuilding7 | Salpeterwerk | 1010310 | AW | 10×6 |  |  |
| Water_Including_Coast | FactoryBuilding7 | Sea Salt Factory | 7319 | NW | ? |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Bedrohliche Kanone | 123075 | AW | ? |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Beeindruckende Kanone | 123074 | AW | ? |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Flakstellung | 736 | AW | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Flakstellung | 742 | NW | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Flakstellung | 743 | En | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Flakstellung | 822 | Ar | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Flammenwerfer | 625 | AW | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Flammenwerfer | 632 | NW | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Flammenwerfer | 823 | En | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Flammenwerfer | 824 | Ar | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Geschützstellung | 101563 | NW | ? |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Geschützstellung | 117861 | En | ? |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Geschützstellung | 1010522 | AW | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Hochwertige Kanone | 124529 | AW | ? |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Kanonenturm | 80037 | Meta,AW,NW,Ar | ? |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Kanonenturm | 101570 | NW | ? |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Kanonenturm | 112671 | Ar | ? |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Kanonenturm | 117863 | En | ? |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Kanonenturm | 1010523 | AW | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Panzerbrechendes Geschütz | 3700 | AW | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Panzerbrechendes Geschütz | 4797 | NW | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Panzerbrechendes Geschütz | 4798 | Ar | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Panzerbrechendes Geschütz | 4799 | En | 4×4 |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Polierte Kanone | 123076 | AW | ? |  |  |
| Water_Including_Coast | HarborBuildingAttacker | Starke Kanone | 124528 | AW | ? |  |  |
| Water_Including_Coast | HarborDepot | Depot | 101278 | NW | ? |  |  |
| Water_Including_Coast | HarborDepot | Depot | 112670 | Ar | ? |  |  |
| Water_Including_Coast | HarborDepot | Depot | 117870 | En | ? |  |  |
| Water_Including_Coast | HarborDepot | Depot | 1010519 | AW | 10×4 |  |  |
| Water_Including_Coast | HarborDepot | Steinkohlelager | 100782 | AW | ? |  |  |
| Water_Including_Coast | HarborDepot | Öllager | 100784 | AW | 4×8 |  |  |
| Water_Including_Coast | HarborDepot | Öllager | 101330 | NW | ? |  |  |
| Water_Including_Coast | HarborDepot | Öllager | 119034 | En | ? |  |  |
| Water_Including_Coast | HarborLandingStage7 | Anlegestelle | 100519 | AW | 6×7 |  | erweitert Hafengebiet, Anlegeplatz |
| Water_Including_Coast | HarborLandingStage7 | Anlegestelle | 101344 | NW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Water_Including_Coast | HarborLandingStage7 | Anlegestelle | 116030 | Ar | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Water_Including_Coast | HarborLandingStage7 | Anlegestelle | 117871 | En | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Water_Including_Coast | HarborLandingStage7_BuildPermit | Fortschrittliche Anlegestelle | 125028 | AW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Water_Including_Coast | HarborLandingStage7_BuildPermit | Fortschrittliche Anlegestelle | 125191 | NW | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Water_Including_Coast | HarborLandingStage7_BuildPermit | Fortschrittliche Anlegestelle | 125192 | Ar | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Water_Including_Coast | HarborLandingStage7_BuildPermit | Fortschrittliche Anlegestelle | 125193 | En | ? |  | erweitert Hafengebiet, Anlegeplatz |
| Water_Including_Coast | HarborOffice | Hafenmeisterei | 100586 | AW | 4×4 |  | Item-Radius 20 |
| Water_Including_Coast | HarborOffice | Hafenmeisterei | 101286 | NW | ? |  | Item-Radius 20 |
| Water_Including_Coast | HarborOffice | Hafenmeisterei | 117860 | En | ? |  | Item-Radius 20 |
| Water_Including_Coast | RepairCrane | Reparaturkran | 101573 | NW | ? |  |  |
| Water_Including_Coast | RepairCrane | Reparaturkran | 117864 | En | ? |  |  |
| Water_Including_Coast | RepairCrane | Reparaturkran | 1010525 | AW | 5×5 |  |  |
| Water_Including_Coast | Shipyard | Dampfschiffswerft | 1010521 | AW | 17×7 |  | erweitert Hafengebiet |
| Water_Including_Coast | Shipyard | Segelschiffswerft | 101277 | NW | ? |  | erweitert Hafengebiet |
| Water_Including_Coast | Shipyard | Segelschiffswerft | 1010520 | AW | 17×6 |  | erweitert Hafengebiet |
| Water_Including_Coast | Street | Kai | 101339 | Meta,AW,NW,Ar | ? |  |  |
| Water_Including_Coast | Street | Kai | 131865 | NW | ? |  |  |
| Water_Including_Coast | Street | Kaimauer | 100691 | Meta,AW,NW,Ar,En | ? |  |  |
| Water_Including_Coast | Street | Kaimauer | 117729 | En | ? |  |  |
| Water_Including_Coast | Street | Kaimauer | 1010567 | Meta,AW,NW,Ar | ? |  |  |
| Water_Including_Coast | Street | Kaistraße | 601443 | AW | ? |  |  |

## 4. Was ein Optimierer braucht

1. **Geländekarte der Insel** je Kachel: Land / Küste (Uferlinie) / Hafengebiet / offenes Wasser,
   Fruchtbarkeiten (Salpeter, Perlen …). Unsere Stempel enthalten nur Land (Feldwegrand) – die
   Küste ergibt sich aus dem Rand der Landmaske, Wasser und Hafengebiet fehlen.
2. **Gebäudeformen mit Geländeanforderung je Kachel** (welche Kacheln Land, Ufer oder Wasser sein
   müssen, z. B. Fischerei 11×5 mit Steg ins Wasser). Diese Masken stehen in den ifo-Dateien der
   Gebäude (Grafikdaten), nicht in assets.xml.
3. **Regeln**: Straßenanschluss, je Insel einmal, Fruchtbarkeit, Hafenmeisterei-Radien ohne
   Überschneidung, freie Anfahrt vor Anlegestellen, Strom (Quarzgrube/Salpeterwerk optional).
4. **Ziele**: z. B. meiste Fischereien/Quarzgruben im Radius einer Hafenmeisterei mit Items,
   Anlegestellen nahe Lager, Speicherstadt mit Modulen, Kontorgröße, Platz für Werften.

## 5. Nächste Schritte

- **M1 – Messung im Spiel (Nutzer)**: Stempel einer Küste mit maximal gelegtem Kai (zeigt die Fläche
  des Hafengebiets), einzeln gesetzte Fischerei/Quarzgrube/Anlegestelle/Depot/Hafenmeisterei an
  gerader und schräger Küste – daraus Kachelmasken (Land/Ufer/Wasser) je Gebäude ableiten.
- **M2 – Daten**: prüfen, ob der Stempel Wasser-/Ufer-Kacheln enthält; sonst Insel-Geometrie aus den
  Spieldateien (Inselkarten in den RDA-Archiven) oder Uferlinie aus der Landmaske ableiten.
- **M3 – Modell**: Gelände je Kachel, Masken je Gebäude, Regeln aus Abschnitt 2.
- **M4 – Optimierer**: entlang der Uferlinie (1D-Abschnitte, dynamische Programmierung) plus lokale
  Suche; Hafenmeisterei-Radien ohne Überschneidung wie die Packer für Handelskammern.

---

## 6. Hafenplaner im Stadtplaner (Auftrag 23.11.2026)

**Ziel:** Der Nutzer stempelt die ganze Insel: Land mit Feldweg, das komplette Hafengebiet mit
**Kaimauer bzw. Kaistraße**. Der Stadtplaner erkennt daraus Land, Uferlinie und Hafengebiet und plant
die Küste auf **maximalen Lagerplatz** – zusammen mit der Stadt (Straßenanschluss, Regionalministerium).

**Einstellungen (Nutzer):**
- Speicherstadt ja/nein; Anzahl je Modul (Depot, Anlegestelle, Hafenmeisterei-Modul, Exportbüro,
  Reparaturkran, Verladekai) bis zur Grenze der gewählten Exportstufe.
- Kontor je Insel (Stufe klein/mittel/groß/riesig; „schon im Stempel“ oder neu einplanen).
- Je Küstengebäude: ob und wie viele (Fischerei, Quarzgrube, Salpeterwerk, Anlegestelle, Depot, Öllager,
  Ölhafen, Pendlerkai, Besucherhafen, Werften, Reparaturkran, Geschütze, Dicke Berta …).
- **Hafenmeistereien ein/aus** (Ziel: möglichst viele, also Anzahl für Lagerplatz, nicht Abdeckung).
  **Standard nach den Palast-Einstellungen:** an, wenn auf dieser Insel das Ministerium für Handel wirkt
  (Palastinsel mit freigeschaltetem Handelsministerium ab 1.350 Attraktivität, oder Regionalministerium
  mit Ministerium „Handel“), sonst aus. Eine Änderung durch den Nutzer bleibt erhalten, bis er sie
  zurücksetzt. Umgesetzt als `harborOfficesDefault()` in `src/palaceSettings.ts` (Regionalministerium
  „Haupthafen“ im Palast-Dialog; Muster für die Übersteuerung: `src/plannerDefaults.ts`). Bei
  Hafenbevorratung Depots bevorzugt in Radien von Hafenmeistereien/Speicherstadt (+50 je Depot).

### 6.1 Lagerplatz (Spieldaten)

| Quelle | Lager | Hinweis |
| --- | --- | --- |
| Kontor klein / mittel / groß / riesig | 75 / 150 / 250 / 500 t | einmal je Insel, Ausbau in Stufen |
| Depot (10×4) | 50 t | **+50 t** mit Richtlinie „Hafenbevorratung“, wenn im Radius einer Hafenmeisterei (20) bzw. Speicherstadt (30) („+50 Insel-Lagerplatz pro Depot“) |
| Speicherstadt (7×6) | 100 t | einmal je Insel |
| Speicherstadt-Depotmodul (3×3) | 100 t | auch +50 mit „Hafenbevorratung“; Grenze 5 (+2 je Exportstufe, max. 13) |
| **Hafenmeisterei (4×4)** | **+200 t … +1.200 t** | Basiseffekt **Ministerium für Handel** („+X Insel-Lagerplatz pro Hafenmeisterei“, +40 je Prestige-Stufe); gilt auch für die Speicherstadt; Hafenmeisterei braucht dafür eine **Straße zum Palast/Regionalministerium in dessen Reichweite** |
| Öllager (4×8) | 200 t Öl | nur Öl |

Je Kachel ist die Hafenmeisterei mit Handelsministerium das stärkste Lager (16 Kacheln → 200–1.200 t,
Depot 40 Kacheln → 50–100 t). Ohne Handelsministerium bringt sie keinen Lagerplatz.

### 6.2 Abstände und Grenzen

- **Hafenmeisterei-Radius 20, Speicherstadt-Radius 30, Kategorie „HarborOffice“ – Radien dürfen sich nicht
  überschneiden**: Mittelpunktabstand Hafenmeisterei–Hafenmeisterei ≥ 40, Hafenmeisterei–Speicherstadt ≥ 50
  (ob genau 40/50 erlaubt ist wie bei Handelskammern: Test T3).
- Speicherstadt-Module (Spieldaten): Grenzen Depot 5, Hafenmeisterei-Modul 2, Anlegestelle 3, Exportbüro 2,
  Reparaturkran 3, Verladekai 2; je Exportstufe mehr (Ungewöhnlich +2 Depot, +1 Anlegestelle, +1 Export,
  +1 Verladekai; Selten +2/+1 HM-Modul/+1/+1/+1 Kran/+1; Episch +2/+1/+1/+1/+1/+2; Legendär +2 auf alles).
  Module müssen im **selben Hafengebiet** stehen, nicht im Radius. Module 3×3, Anlegestelle 5×5.
- Einmal je Insel: Kontor, Speicherstadt, Ölhafen, Besucherhafen, Pendlerkai.
- Straße nötig: Fischerei, Quarzgrube, Salpeterwerk, Perlenfarm, Fischölfabrik, Pendlerkai (zu Kontor/Lager);
  Hafenmeisterei für Palast-Effekte (Straße zum Ministerium). Ohne Straße: Depot, Öllager, Anlegestelle,
  Reparaturkran, Geschütze, Speicherstadt.
- Anlegestellen, Kontor, Speicherstadt: „keine Hindernisse davor“ (freie Zufahrt für Schiffe).

### 6.3 Was die Teststempel klären müssen

Stempel enthalten je Straßenkachel nur GUID und Position, kein Gelände. Deshalb:
- **T1 – Gelände**: ganze Insel, Land mit Feldweg, **gesamtes Hafengebiet mit Kaimauer** (zweiter Stempel
  mit Kaistraße). Klärt: GUIDs der Kai-Arten, wie weit das Hafengebiet ins Wasser reicht, ob es entlang der
  ganzen Küste existiert.
- **T2 – Gebäudemasken**: an einer **geraden Küste** je ein Gebäude setzen und rundherum Land mit Feldweg und
  Hafengebiet mit Kaimauer auffüllen: Kontor (jede Stufe, falls Größe wechselt), Speicherstadt + je ein Modul,
  Hafenmeisterei, Depot, Öllager, Anlegestelle, Fischerei, Quarzgrube, Salpeterwerk, Pendlerkai, Besucherhafen,
  Ölhafen, Segel-/Dampfschiffswerft, Reparaturkran, Kanonenturm, Geschützstellung, Dicke Berta.
  Dasselbe einmal an einer Küste in **anderer Himmelsrichtung** (Drehung) und an einer **Ecke/schrägen Küste**.
  Daraus: welche Kacheln Land, Ufer oder Hafengebiet sein müssen und in welche Richtung das Gebäude zeigt.
- **T3 – Abstände**: zwei Hafenmeistereien so nah wie das Spiel erlaubt; Hafenmeisterei so nah wie möglich an
  der Speicherstadt.

### 6.4 Umsetzung (nach den Teststempeln)

1. Einlesen: Kaimauer/Kaistraße-GUIDs als **Hafengebiet** führen (nicht als Land); Uferlinie = Grenze
   Land ↔ Hafengebiet; Kontor aus dem Stempel übernehmen, falls vorhanden.
2. Gebäudemasken (aus T2) mit Drehungen; Prüfung „passt hier“ je Kachel (Land/Ufer/Hafengebiet).
3. Reihenfolge: Kontor → Speicherstadt + Module → gewünschte Küstengebäude → Hafenmeistereien
   (Packung mit Abständen 40/50, wie die Handelskammer-Packung) → Depots in die Restflächen, bevorzugt in
   Hafenmeisterei-Radien. Straßenanschlüsse über das Stadtnetz; Hafenmeistereien an Straßen im
   Ministeriumsbereich.
4. Bewertung: Lagerplatz nach 6.1 (Palast-Einstellungen: Handelsministerium, Prestige, Hafenbevorratung),
   Nebenbedingungen 6.2; lokale Suche (verschieben/tauschen) wie bei Rathäusern.
5. Anzeige: Lagerplatz gesamt und je Quelle, Hafenmeistereien, Depots, Module; Stempel-Export.
