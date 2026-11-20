// Inhalte des Baumaterial-Guides. Idee und Vorgehen nach dem Video
// „Baumaterialinsel 3.0“ (eigene Worte, keine Übernahme von Text/Bildern);
// alle Zahlen rechnet die Seite selbst aus der Spieldatenbank.

/** Video-Quelle (nur verlinkt). */
export const VIDEO_URL = 'https://youtu.be/xGTTDtMcaGI';

/** Endprodukte der Insel (Waren-GUIDs) mit Standard-Ziel in t/min. */
export const MATERIALS: ReadonlyArray<{ p: number; target: number }> = [
  { p: 1010196, target: 300 }, // Bretter
  { p: 1010205, target: 60 }, // Ziegelsteine
  { p: 1010218, target: 60 }, // Stahlträger
  { p: 1010207, target: 45 }, // Fenster
  { p: 1010202, target: 40 }, // Stahlbeton
  { p: 1010245, target: 0 }, // Hochräder
  { p: 134623, target: 0 }, // Fahrstühle
];

/** Rohstoffvorkommen (Eingang der Minen) – kein Import, sondern das Vorkommen selbst. */
export const DEPOSIT = 1591;
/** Kraftwerk (Öl) der Alten Welt. */
export const POWER_PLANT = 100780;
export const OIL = 1010566;

/** Wahl des Erzeugers, wo es mehrere gibt (Ware → Gebäude). */
export const PRODUCER_CHOICES: Readonly<Record<number, readonly number[]>> = {
  1010226: [1010304, 1010298], // Kohle: Kohlemine, Köhlerei
};

/** Standardmäßig importiert (Speicherstadt/Handel), statt selbst hergestellt. */
export const DEFAULT_IMPORT: readonly number[] = [
  1010222, // Dynamit (für Verrückte Viktoria)
  1010224, // Dampfmaschinen (Fahrstühle)
];

export interface Cluster {
  id: string;
  title: string;
  /** Gebäude im Radius dieser Handelskammer. */
  buildings: number[];
  /** Items wie im Video (GUIDs). */
  items: number[];
  /** Kurzbeschreibung (eigene Worte). */
  text: string;
  /** Tipps/Hinweise. */
  tips?: string[];
}

export const CLUSTERS: readonly Cluster[] = [
  {
    id: 'wood',
    title: 'Holzfäller',
    buildings: [1010266],
    items: [190739, 190858, 190857], // Ursula Green, Teutonisch-technisches Schneidewerkzeug, Druidensichel
    text: 'Holz ist die Grundlage für Bretter, Fenster und Holzfurnier. Die drei Items erhöhen die Produktivität und verkleinern gleichzeitig die benötigte Waldfläche – so passen deutlich mehr Holzfäller in einen Handelskammer-Radius.',
    tips: ['Holzfäller haben keinen Strombonus – hier keinen Strom-Platz verschwenden.', 'Waldfläche einplanen: Die Anzahl je Handelskammer hängt vom Wald ab, nicht nur vom Platz.'],
  },
  {
    id: 'sawWindow',
    title: 'Sägewerke + Fensterfabriken',
    buildings: [100451, 1010285],
    items: [191431, 190910, 192450], // Elias Papadikas, Harkers elektrische Drechselbank, Feras Alsarami
    text: 'Sägewerk und Fensterfabrik profitieren von denselben Items, deshalb teilen sie sich eine Handelskammer. Papadikas liefert Strom (kein Kraftwerk nötig) und nebenbei Holzfurnier, die Drechselbank senkt zusätzlich die Arbeitskraft.',
    tips: ['Statt Feras passt auch der Möbeltischler (−60 % Arbeitskraft).', 'Fenster brauchen Holz und Glas – die Glashütten (Quarzsand) gehören in die Nähe.'],
  },
  {
    id: 'brickConcrete',
    title: 'Ziegeleien + Betonwerke',
    buildings: [1010283, 1010280],
    items: [191463, 191464, 192450], // Polier, Gerhard der Architekt, Feras Alsarami
    text: 'Polier und Gerhard der Architekt wirken auf Ziegelei und Betonwerk. Gerhard bringt Strom, der Polier senkt die Arbeitskraft stark und liefert bei jeder 5. Produktion einen Stahlträger dazu – das entlastet die Stahlwerke.',
    tips: ['François Thorne ist eine Alternative zu Feras: +50 % und Holzfurnier, aber Bauern statt Ingenieure im Betonwerk.', 'Stahlbeton braucht Zement und Stahl – Stahl aus den Hochöfen mit einplanen.'],
  },
  {
    id: 'furnace',
    title: 'Hochöfen',
    buildings: [1010297],
    items: [190237, 190832, 192450], // Angela „Meg“ Iver, Bechamelbirne, Feras Alsarami
    text: 'Stahl ist der Engpass jeder Baumaterialinsel: Er geht in Stahlträger, Stahlbeton, Hochräder (ohne Dario) und Dampfmaschinen. Angela bringt Strom und senkt die Arbeitskraft, Bechamelbirne liefert +60 %.',
    tips: ['Die Hochöfen als lange Reihe anlegen, die genau so breit ist wie der Handelskammer-Radius.', 'Vom Verbrennungschemiker eher abraten: Er ersetzt Kohle durch Arktis-Gas.'],
  },
  {
    id: 'steelworks',
    title: 'Stahlwerke',
    buildings: [1010296],
    items: [190832, 190705, 190237], // Bechamelbirne, Henri Zanchi, Angela „Meg“ Iver
    text: 'Bechamelbirne, Zanchi und Angela zusammen senken die Arbeitskraft um 95 %; mit dem Palast-Erlass „Fabrikinspektionen“ arbeiten die Stahlwerke ganz ohne Arbeiter. Zanchi senkt zusätzlich den Unterhalt um 75 %.',
    tips: ['Stahlträger nicht auf jeder Insel abladen – sie sind knapp und werden nur gezielt verteilt.'],
  },
  {
    id: 'ironMine',
    title: 'Eisenminen',
    buildings: [1010305],
    items: [1948, 190761], // Verrückte Viktoria, Jörg von Malching
    text: 'Verrückte Viktoria ersetzt das Erzvorkommen durch Dynamit und liefert alle 2 Produktionen 12 Eisen extra – eine Mine ersetzt so ein Vielfaches an normalen Minen. Jörg von Malching erhöht die Produktivität und liefert Öl und Gold dazu; das Öl reicht für die Kraftwerke der Insel.',
    tips: [
      'Laut Spieldaten verbraucht eine Mine mit Viktoria 2 Dynamit je Zyklus (1 statt Vorkommen + 1 mehr) – im Spiel prüfen. Dynamit wird im Rechner importiert.',
      'Andere Minen (Kohle, Zement, Gold …) lassen sich im Forschungsinstitut auf Eisen umstellen.',
      'Ohne Viktoria: Malching, Erstklassiger Sappeur und Feras (−75 % Arbeitskraft).',
    ],
  },
  {
    id: 'bike',
    title: 'Hochrad-Werkhallen',
    buildings: [1010323],
    items: [190841, 191424, 191422], // „The Cutting Edge“, Dario der Maschinenbauer, Bruno Ironbright
    text: 'Hochräder werden für viele Aufstiege gebraucht. Dario ersetzt Stahl durch Eisen (entlastet die Hochöfen) und liefert Taschenuhren und Phonographen, Bruno liefert Schwere Geschütze und Dampfmaschinen.',
    tips: ['Hochrad-Werkhallen brauchen zwingend Strom – zusammen mit den Fahrstühlen an ein eigenes Kraftwerk.', 'Kautschuk kommt aus der Neuen Welt (Import).'],
  },
  {
    id: 'elevators',
    title: 'Fertigungsstraßen: Fahrstühle',
    buildings: [134622],
    items: [137631, 136833, 136831], // Schneller reich werden VII, VIII, IX
    text: 'Fahrstühle für die Wolkenkratzer. Die drei Bände „Schneller reich werden“ erhöhen die Produktivität stark; Band VII ersetzt die Arbeiter durch Ingenieure und senkt den Bedarf um 80 %.',
    tips: ['Braucht zwingend Strom.', 'Eingänge: Stahl, Holzfurnier und Dampfmaschinen.'],
  },
];

/** Textkapitel (eigene Worte nach dem Video, ergänzt um Spieldaten). */
export const CHAPTERS: ReadonlyArray<{ id: string; title: string; html: string }> = [
  {
    id: 'start',
    title: 'Insel und Start',
    html: `<ul>
      <li>Eine große Insel in der Alten Welt nur für Baumaterial – getrennt von den Wohninseln. So bleiben Handelskammer-Radien frei für die Produktion.</li>
      <li><b>Arbeitskraft am Anfang:</b> Ein Pendlerkai holt Arbeitskraft von anderen Inseln, solange die Items noch fehlen. Später senken Items und der Palast-Erlass „Fabrikinspektionen“ den Bedarf so stark, dass viele Ketten ohne Arbeiter laufen.</li>
      <li><b>Palast / Regionalministerium:</b> Auf der Baumaterialinsel lohnt ein Regionalministerium mit dem Ministerium für Arbeit (+10 % Produktivität, mit Prestige bis +60 %). Richtlinie: „Fabrikinspektionen“ (−50 % Arbeitskraft, ab 5.200 Attraktivität der Palaststadt) – oder auf der Palastinsel „Gewerkschaftsförderung“ für einen 4. Item-Platz. Beides gleichzeitig geht auf einer Insel nicht (gleiches Ministerium). Einstellung oben über „🏛 Palast“.</li>
      <li><b>Hafen:</b> Speicherstadt und mindestens zwei fortschrittliche Anlegestellen, dazu Hafendepots – über diese Insel läuft sehr viel Ware.</li>
    </ul>`,
  },
  {
    id: 'power',
    title: 'Strom und Öl',
    html: `<ul>
      <li>Strom über Items, wo es geht: Papadikas (Sägewerk, Fensterfabrik), Gerhard der Architekt (Ziegelei, Betonwerk), Angela (Hochofen, Stahlwerk). Das spart Kraftwerke und Platz.</li>
      <li>Ein Kraftwerk nur für die Gebäude mit <b>Pflicht-Strom</b>: Hochrad-Werkhallen und Fertigungsstraßen für Fahrstühle.</li>
      <li>Öl ohne Ölhafen: Jörg von Malching in den Eisenminen liefert bei jeder Produktion 1 Öl dazu. Ein Kraftwerk verbraucht laut Spieldaten <span data-calc="oilPerPlant"></span> t/min Öl – die Bilanz steht im Rechner.</li>
    </ul>`,
  },
  {
    id: 'import',
    title: 'Speicherstadt und Import',
    html: `<ul>
      <li>Die Speicherstadt tauscht Waren gegen Waren. Am meisten bringt ein Tausch, dessen Ware hier gebraucht wird und dessen Nebenprodukt ebenfalls weiterverarbeitet wird – zuerst Kautschuk (Hochräder) und Eisen, später Ziegel, Holz, Stahl, Glas und Zement.</li>
      <li>Kautschuk kommt aus der Neuen Welt. Dynamit für Viktoria importieren oder separat herstellen (Talg + Salpeter).</li>
      <li>Hochräder brauchen eine Abfall-Route: Was die Fertigung an Nebenprodukten (Taschenuhren, Phonographen, Schwere Geschütze, Dampfmaschinen) abwirft, regelmäßig abholen.</li>
    </ul>`,
  },
  {
    id: 'routes',
    title: 'Verteilung und Aufstiege',
    html: `<ul>
      <li>Je Baumaterial eine Rundroute über alle Inseln. Auf der letzten Insel den Rest abladen – außer Stahlträger, die bleiben knapp und werden gezielt verteilt.</li>
      <li>Für große Aufstiege eine zusätzliche, vorübergehende Route mit vielen Schiffen einrichten, damit die Lager überall schnell voll werden.</li>
      <li>Als Richtwert hat sich weltweit ein Lager von etwa 60.000–70.000 je Baumaterial bewährt; rund 330–400 t/min Bretter reichen auch für große Imperien, Stahl und Stahlträger sind der Engpass.</li>
    </ul>`,
  },
];
