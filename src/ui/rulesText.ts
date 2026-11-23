// "How to play": the REBUILT rules in short, in three languages (from the 2026 Game Manual).

import type { Text } from './i18n';

export interface RuleSection {
  title: Text;
  items: Text[];
}

export const RULES: RuleSection[] = [
  {
    title: { kk: 'Ойын туралы', ru: 'Об игре', en: 'The game' },
    items: [
      {
        kk: 'Екі альянс, әрқайсысында 3 робот. Алаң 16,5 × 8,1 м. Мақсат — FUEL (сары көбік доптар) жинап, өз HUB-ыңа ату және соңында TOWER-ге көтерілу.',
        ru: 'Два альянса по 3 робота. Поле 16,5 × 8,1 м. Цель — собирать FUEL (жёлтые поролоновые мячи), забрасывать их в свой HUB и в конце залезть на TOWER.',
        en: 'Two alliances of 3 robots. The field is 16.5 × 8.1 m. Collect FUEL (yellow foam balls), shoot it into your HUB, and climb your TOWER at the end.',
      },
      {
        kk: 'Алаңда 504 FUEL: көбі ортадағы NEUTRAL ZONE-да, 24-тен DEPOT-та және OUTPOST-та, әр роботта 8-ге дейін алдын ала жүктелген.',
        ru: 'На поле 504 FUEL: большинство в центральной NEUTRAL ZONE, по 24 в DEPOT и OUTPOST, до 8 заранее загружено в каждого робота.',
        en: '504 FUEL: most in the central NEUTRAL ZONE, 24 in each DEPOT and OUTPOST, up to 8 preloaded in each robot.',
      },
    ],
  },
  {
    title: { kk: 'Матч уақыты (2:40)', ru: 'Время матча (2:40)', en: 'Match time (2:40)' },
    items: [
      { kk: 'AUTO — 20 с: роботтар өз бағдарламасымен жүреді, жүргізуші басқармайды.', ru: 'AUTO — 20 с: роботы едут по своей программе, водители не управляют.', en: 'AUTO — 20 s: robots run their own programs, no drivers.' },
      { kk: 'TELEOP — 2:20: ӨТПЕЛІ кезең 10 с, төрт SHIFT 25 с-тан, END GAME 30 с.', ru: 'TELEOP — 2:20: ПЕРЕХОД 10 с, четыре SHIFT по 25 с, END GAME 30 с.', en: 'TELEOP — 2:20: TRANSITION 10 s, four 25 s SHIFTS, END GAME 30 s.' },
    ],
  },
  {
    title: { kk: 'HUB ауысымдары — ең маңызды ереже', ru: 'Смены HUB — главное правило', en: 'HUB shifts — the key rule' },
    items: [
      { kk: 'AUTO, ӨТПЕЛІ және END GAME кезінде екі HUB та белсенді.', ru: 'В AUTO, ПЕРЕХОДЕ и END GAME оба HUB активны.', en: 'Both HUBs are active in AUTO, TRANSITION and END GAME.' },
      { kk: 'AUTO-да көп FUEL салған альянстың HUB-ы SHIFT 1-де өшеді, содан кейін HUB-тар кезекпен жанып-өшеді.', ru: 'Альянс, забивший больше FUEL в AUTO, получает выключенный HUB в SHIFT 1, дальше HUB-ы включаются по очереди.', en: 'The alliance that scored more FUEL in AUTO has its HUB off in SHIFT 1; then the HUBs take turns.' },
      { kk: 'Өшірулі HUB-қа түскен FUEL ұпай бермейді. HUB өшкен соң 3 секунд ішінде түскен доп әлі есептеледі.', ru: 'FUEL в выключенный HUB очков не даёт. Мяч, попавший в течение 3 секунд после выключения, ещё засчитывается.', en: 'FUEL in an inactive HUB scores nothing. A ball landing within 3 seconds after it turns off still counts.' },
      { kk: 'Кеңес: HUB өшірулі кезде FUEL жинап, бункерді толтыр, жанған кезде бірден ат.', ru: 'Совет: пока HUB выключен — собирай FUEL в бункер, как только включится — стреляй.', en: 'Tip: while your HUB is off, fill your hopper; shoot as soon as it lights up.' },
    ],
  },
  {
    title: { kk: 'Ұпайлар', ru: 'Очки', en: 'Points' },
    items: [
      { kk: 'Белсенді HUB-тағы әр FUEL — 1 ұпай.', ru: 'Каждый FUEL в активном HUB — 1 очко.', en: 'Each FUEL in an active HUB — 1 point.' },
      { kk: 'TOWER: AUTO-да 1-деңгей — 15 (ең көбі 2 робот). Матч соңында: 1-деңгей 10, 2-деңгей 20, 3-деңгей 30.', ru: 'TOWER: в AUTO уровень 1 — 15 (не больше 2 роботов). В конце матча: уровень 1 — 10, 2 — 20, 3 — 30.', en: 'TOWER: level 1 in AUTO — 15 (2 robots max). At the end: level 1 — 10, level 2 — 20, level 3 — 30.' },
      { kk: 'RP: жеңіс 3, тең 1; ENERGIZED — 100 FUEL, SUPERCHARGED — 360 FUEL, TRAVERSAL — TOWER-ден 50 ұпай.', ru: 'RP: победа 3, ничья 1; ENERGIZED — 100 FUEL, SUPERCHARGED — 360 FUEL, TRAVERSAL — 50 очков за TOWER.', en: 'RP: win 3, tie 1; ENERGIZED — 100 FUEL, SUPERCHARGED — 360 FUEL, TRAVERSAL — 50 TOWER points.' },
    ],
  },
  {
    title: { kk: 'Айыптар (MAJOR FOUL = қарсыласқа 15 ұпай)', ru: 'Фолы (MAJOR FOUL = 15 очков сопернику)', en: 'Fouls (MAJOR FOUL = 15 points to the opponent)' },
    items: [
      { kk: 'G407: HUB-қа тек өз ALLIANCE ZONE-ыңнан ат (бампер ішінара болса да аймақта болуы керек).', ru: 'G407: стрелять в HUB можно только из своей ALLIANCE ZONE (хотя бы частью бампера).', en: 'G407: launch into your HUB only from your ALLIANCE ZONE (bumpers at least partly in it).' },
      { kk: 'G403: AUTO-да орталық сызықты толық кесіп өтпе.', ru: 'G403: в AUTO нельзя полностью пересекать центральную линию.', en: 'G403: in AUTO, do not fully cross the CENTER LINE.' },
      { kk: 'G420: соңғы 30 с ішінде қарсыластың TOWER-дегі роботына тиме — ол 3-деңгей ұпайын алады.', ru: 'G420: в последние 30 с не трогай соперника у его TOWER — он получит очки за уровень 3.', en: 'G420: in the last 30 s, do not touch an opponent on its TOWER — it gets level 3 points.' },
    ],
  },
  {
    title: { kk: 'Алаң элементтері', ru: 'Элементы поля', en: 'Field elements' },
    items: [
      { kk: 'BUMP — HUB-тың екі жағындағы 16 см биік рампалар, үстінен жүруге болады. TRENCH — астынан өтетін қақпа (биіктігі 56 см).', ru: 'BUMP — горки высотой 16 см по бокам HUB, через них можно проехать. TRENCH — арка, под которой можно проехать (56 см).', en: 'BUMP — 16 cm ramps either side of the HUB you can drive over. TRENCH — an arm you can drive under (56 cm).' },
      { kk: 'DEPOT — қабырға жанындағы 24 FUEL. OUTPOST — адам-ойыншы FUEL-ді алаңға домалатады: роботты OUTPOST-тың жанына әкел.', ru: 'DEPOT — 24 FUEL у стены. OUTPOST — человек-игрок подаёт FUEL на поле: подъедь роботом к OUTPOST.', en: 'DEPOT — 24 FUEL by the wall. OUTPOST — the human player rolls FUEL onto the field: drive up to it.' },
      { kk: 'TOWER — үш тұтқасы бар саты: LOW 69 см, MID 114 см, HIGH 160 см.', ru: 'TOWER — лестница из трёх перекладин: LOW 69 см, MID 114 см, HIGH 160 см.', en: 'TOWER — a ladder of three rungs: LOW 69 cm, MID 114 cm, HIGH 160 cm.' },
    ],
  },
];

export const CONTROLS: { keys: string; pad: string; what: Text }[] = [
  { keys: 'W A S D / ↑ ↓', pad: 'L stick', what: { kk: 'Жүру (алаңға қатысты)', ru: 'Езда (относительно поля)', en: 'Drive (field-centric)' } },
  { keys: 'Q E / ← →', pad: 'R stick', what: { kk: 'Бұрылу', ru: 'Поворот', en: 'Turn' } },
  { keys: 'Space / K', pad: 'RT / RB', what: { kk: 'Ату (робот HUB-қа өзі бұрылады)', ru: 'Стрелять (робот сам наводится на HUB)', en: 'Shoot (the robot aims at the HUB)' } },
  { keys: 'I', pad: 'LB / X', what: { kk: 'Интейкті қосу/өшіру', ru: 'Включить/выключить интейк', en: 'Intake on/off' } },
  { keys: 'Shift', pad: 'LT', what: { kk: 'Интейк (ұстап тұр)', ru: 'Интейк (удерживать)', en: 'Intake (hold)' } },
  { keys: 'C', pad: 'Y', what: { kk: 'TOWER-ге көтерілу (ұстап тұр); түсу — жүру батырмасы', ru: 'Подъём на TOWER (удерживать); спуск — кнопки езды', en: 'Climb the TOWER (hold); drive to climb down' } },
  { keys: 'V', pad: 'B', what: { kk: 'Камера: жүргізуші / артынан / жоғарыдан', ru: 'Камера: водитель / сзади / сверху', en: 'Camera: driver / chase / top' } },
  { keys: 'R', pad: 'Back', what: { kk: 'Жаттығуда алаңды қалпына келтіру', ru: 'Сброс поля в тренировке', en: 'Reset the field in practice' } },
  { keys: 'Esc / P', pad: 'Start', what: { kk: 'Үзіліс', ru: 'Пауза', en: 'Pause' } },
];
