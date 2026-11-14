// Erzeugte Stempel für Spieltests und die Analyse-Vorschau.

import { CATALOG_LIST, FARMER_HOUSE, footprint, lookup, STREET_GUIDS } from './catalog';
import type { StampBuilding, StampStreet } from './stamp';

interface Layout {
  buildings: StampBuilding[];
  streets: StampStreet[];
}

function place(guid: number, x: number, y: number, turns: number): StampBuilding {
  const { w, h } = footprint(lookup(guid), turns);
  return { guid, x, y, w, h, turns };
}

function roadRow(streets: StampStreet[], x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) streets.push({ x, y, guid: STREET_GUIDS.paved });
}

/**
 * Katalog-Test: jedes bekannte Gebäude einmal ungedreht und – falls nicht
 * quadratisch – einmal um 90° gedreht, jeweils unter einer Pflasterstraße.
 * Dazu der Lufthafen mit beiden Modulen (gemeinsame Komplex-ID). Zweck: im
 * Spiel prüfen, ob GUIDs, Größen, Drehung und Module stimmen.
 */
export function catalogTestLayout(): Layout {
  const buildings: StampBuilding[] = [];
  const streets: StampStreet[] = [];
  const entries = CATALOG_LIST.filter((e) => e.kind !== 'airport' && e.kind !== 'airportModule');
  const maxRow = 70;
  let x = 0;
  let y = 1;
  let rowH = 0;
  const flush = (): void => {
    roadRow(streets, 0, maxRow, y - 1);
    y += rowH + 2;
    x = 0;
    rowH = 0;
  };
  const add = (guid: number, turns: number): void => {
    const b = place(guid, x, y, turns);
    if (x + b.w > maxRow) {
      flush();
      b.x = 0;
      b.y = y;
    }
    buildings.push(b);
    x = b.x + b.w + 1;
    rowH = Math.max(rowH, b.h);
  };
  for (const e of entries) {
    add(e.guid, 0);
    if (e.size[0] !== e.size[1]) add(e.guid, 1);
  }
  flush();

  // Lufthafen (10×15 ungedreht → 15 breit, 10 hoch) mit Modulen darunter.
  const airport = place(962, 0, y, 0);
  airport.owner = 9001;
  buildings.push(airport);
  const mail = place(966, 0, y + airport.h, 0);
  const items = place(964, mail.w, y + airport.h, 0);
  mail.owner = 9001;
  items.owner = 9001;
  buildings.push(mail, items);
  roadRow(streets, 0, maxRow, y - 1);
  return { buildings, streets };
}

/**
 * Beispielstadt: 8er-Gruppen im Pflasterraster 7 × 13 aus Bauernhäusern (wie
 * Stempel aus dem normalen Spiel), darunter eine Reihe Versorgungsgebäude.
 * Die Schichten ergeben sich in der Analyse aus der Streifen-Regel.
 */
export function demoCityLayout(groupsX = 6, groupsY = 4): Layout {
  const buildings: StampBuilding[] = [];
  const streets: StampStreet[] = [];
  const W = groupsX * 7;
  const H = groupsY * 13;
  for (let y = 0; y <= H; y++) {
    for (let x = 0; x <= W; x++) {
      if (x % 7 === 0 || y % 13 === 0) streets.push({ x, y, guid: STREET_GUIDS.paved });
    }
  }
  for (let gx = 0; gx < groupsX; gx++) {
    for (let gy = 0; gy < groupsY; gy++) {
      for (let c = 0; c < 2; c++) {
        for (let r = 0; r < 4; r++) {
          buildings.push(place(FARMER_HOUSE, gx * 7 + 1 + c * 3, gy * 13 + 1 + r * 3, 0));
        }
      }
    }
  }
  // Versorgungsreihe unter dem Raster, an der unteren Rasterstraße.
  let x = 0;
  const y = H + 1;
  for (const guid of [1010371, 135100, 135099, 134629, 1010362, 117547, 269602, 3741, 1010365]) {
    const b = place(guid, x, y, 0);
    buildings.push(b);
    x += b.w + 1;
  }
  roadRow(streets, W + 1, Math.max(W + 1, x), H);
  // Rathaus mitten im Raster auf einer Kreuzung ersetzt keine Häuser: daneben.
  buildings.push(place(100415, W + 2, Math.floor(H / 2) - 2, 0));
  return { buildings, streets };
}
