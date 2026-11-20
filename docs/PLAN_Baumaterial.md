# Plan: Baumaterial-Guide

Quelle der Spielidee: YouTube-Video „Baumaterialinsel 3.0“ (automatisches Transkript, vom Nutzer
eingefügt). Übernommen werden **Ideen und Vorgehen**, nicht Text oder Bilder des Videos; alle Zahlen
rechnet unsere Datenbank/unser Rechner selbst nach. Das Video wird auf der Seite als Quelle verlinkt.

## 1. Was das Video empfiehlt (Kurzfassung)

| Thema | Empfehlung im Video |
| --- | --- |
| Insel | Eine große Alte-Welt-Insel nur für Baumaterial (Bretter, Ziegel, Stahlträger, Fenster, Stahlbeton, Hochräder für Aufstiege, Fahrstühle). |
| Arbeitskraft | Pendlerkai am Anfang; später Items mit Arbeitskraft-Senkung, Regionalministerium-Erlass „Fabrikinspektion“ (−50 %, Palastinsel-Attraktivität), Ziel: viele Ketten mit 0 Arbeitskraft. |
| Strom | Ein Kraftwerk nur für Gebäude mit Pflicht-Strom (Hochrad-Werkhallen, Fertigungsstraße Fahrstühle); sonst Strom über Items (Papadikas, Gerhard, Angela). |
| Öl | Eisenminen mit Jörg von Malching (Öl als Zusatzware) statt Ölhafen; Minen per Forschungsinstitut auf Eisen umstellen. |
| HK-Cluster | Sägewerk + Fensterfabrik · Ziegelei + Betonwerk · Stahlwerke · Hochöfen (Hochofen-Reihe so breit wie der HK-Radius) · Holzfäller · Eisenminen (Verrückte Viktoria + Dynamit) · Hochrad-Werkhallen · Fertigungsstraße Fahrstühle (Schneller reich werden VII/VIII/IX). |
| Import | Speicherstadt mit ≥ 2 fortschrittlichen Anlegestellen, Hafendepots; Tauschgeschäfte so wählen, dass Nebenprodukte (Kautschuk, Eisen, später Ziegel/Holz/Stahl/Glas/Zement) weiterverwertet werden. |
| Verteilung | Je Baumaterial eine Rundroute über alle Inseln (auf der letzten Insel Rest abwerfen, außer Stahlträger); für Aufstiege eine temporäre Route mit vielen Schiffen; weltweit ~60–70 k Lager. |
| Grenzen | Stahl/Stahlträger sind der Engpass; ~330–400 t/min Bretter reichen. |

### Gegenprobe mit unserem Rechner (Strom an, ohne Clipping, volles HK-Layout je Gebäudeart)

| Gebäude + Items aus dem Video | Produktivität | t/min je Gebäude | Gebäude je HK | t/min je HK |
| --- | --- | --- | --- | --- |
| Sägewerk + Papadikas, Harkers Drechselbank, Feras | 350 % | 15,0 (+5 Holzfurnier) | 51 | 765 |
| Fensterfabrik + Papadikas, Drechselbank, Möbeltischler | 330 % | 3,33 | 28 | 93 |
| Ziegelei + Polier, Gerhard, Feras | 300 % | 3,0 (+0,6 Stahlträger) | 28 | 84 |
| Betonwerk + Polier, Gerhard, Thorne | 300 % | 3,0 (+0,6 Stahlträger, +1,5 Holzfurnier) | 23 | 69 |
| Stahlwerk + Bechamelbirne, Zanchi, Angela | 310 % | 4,29 | 14 | 60 |
| Hochofen + Angela, Bechamelbirne, Feras | 310 % | 6,67 | 24 | 160 |
| Holzfäller + Ursula, Schneidewerkzeug, Druidensichel | 220 % | 10,0 | 38 | 380 |
| Eisenmine + Verrückte Viktoria, Malching | 235 % | 10,0 (+10 Öl, +1,7 Gold) | (an Vorkommen gebunden) | – |
| Hochrad-Werkhalle + The Cutting Edge, Dario, Bruno | 290 % | 6,0 | 20 | 120 |

Die Video-Zahlen (z. B. „20 Sägewerke ≈ 326 t Bretter“) liegen in derselben Größenordnung; die
gemischten Cluster des Videos teilen sich einen HK-Radius, deshalb sind seine Mengen je HK kleiner.
Unklar/zu prüfen: Höhe der „Fabrikinspektion“, „Verrückte Viktoria“ +Dynamit-Bedarf je Mine,
Arbeitskraft-Rest bei Stahlwerk (Rechner: 10 Arbeiter ohne Erlass).

## 2. Bausteine

### B1 – Daten ergänzen (Voraussetzung)
- Regionalministerium-Erlässe (u. a. Fabrikinspektion) in die Datenbank aufnehmen (wie Palast-Erlässe).
- Ketten-Daten: Rohstoff → Zwischenprodukt → Baumaterial (aus `in`/`out` der Gebäude, schon vorhanden).
- Speicherstadt-Tauschgeschäfte (Ware → Ware, Mengen) aus den Spieldateien ziehen, falls vorhanden.
- Rechner um gemeinsame HK-Wirkung „Arbeitskraft-Erlass“ erweitern.

### B2 – Guide-Seite `baumaterial.html` (Text + Live-Werte)
- Navigation wie die übrigen Seiten, de/en, Hover-Infos für alle Items/Waren/Gebäude.
- Abschnitte in Spielreihenfolge: Insel wählen → Start ohne Items (Pendlerkai) → Strom & Öl →
  HK-Cluster (Karten wie oben, Werte live aus `calc.ts`, Schalter Strom/Clipping/Erlass) →
  Speicherstadt → Verteilung & Aufstiegsroute → typische Fehler.
- Je Cluster: Items (Icons), Produktivität, t/min, Arbeitskraft, Zusatzwaren, Alternativen ohne
  legendäre Items (aus `bestSetup`), Link zur Produktionsseite.

### B3 – Baumaterial-Rechner
- Eingabe: Ziel-t/min je Baumaterial (oder Ziel „Aufstiege pro Stunde“), vorhandene Items, Erlass an/aus.
- Ausgabe: Gebäude je Kette inkl. Vorprodukte, benötigte HKs, Arbeitskraft je Art, Strombedarf,
  Öl (Kraftwerke ↔ Minen mit Malching), Nebenprodukte/Überschüsse, Import-Bedarf.
- Zustand in `localStorage` wie auf der Produktionsseite.

### B4 – Gemischte HK-Layouts + Stempel
- Packer `packAroundTradeUnion` für zwei Gebäudearten mit Mengenverhältnis erweitern
  (Sägewerk:Fensterfabrik, Ziegelei:Betonwerk), dazu „Hochofen-Reihe“.
- Vorschau + Stempel-Download wie auf der Produktionsseite (eigene Layouts, nichts übernommen).

### B5 – Speicherstadt-Planer (nach B1)
- Auswahl der Tauschgeschäfte, Ausgabe: Ein-/Ausgang je Minute, Nebenprodukte und wo sie
  weiterverarbeitet werden, Zahl der Anlegestellen/Schiffe.

### B6 – Verteilung
- Anleitung + kleine Rechnung: Schiffe je Rundroute aus Ladung, Strecke, Bedarf; Lagergröße.

## 3. Reihenfolge

1. B1 (Erlässe, Rechner-Schalter) – klein, Grundlage für alles.
2. B2 Guide-Seite mit Cluster-Karten – sichtbarer Nutzen sofort.
3. B3 Rechner.
4. B4 gemischte Layouts + Stempel.
5. B5/B6 je nach Datenlage (Speicherstadt-Tausch in den Spieldateien prüfen).

## 4. Stand
- Plan erstellt; Gegenprobe der Video-Cluster mit dem Rechner (Tabelle oben).
