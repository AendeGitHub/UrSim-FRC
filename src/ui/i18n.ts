// Kazakh, Russian, English. The choice is remembered.

export type Lang = 'kk' | 'ru' | 'en';
export type Text = Record<Lang, string>;
export const LANGS: Lang[] = ['kk', 'ru', 'en'];
export const LANG_NAMES: Record<Lang, string> = { kk: 'Қазақша', ru: 'Русский', en: 'English' };

const KEY = 'ursim-frc-lang';

function initial(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang') as Lang | null;
    if (q && LANGS.includes(q)) return q;
    const s = localStorage.getItem(KEY) as Lang | null;
    if (s && LANGS.includes(s)) return s;
  } catch { /* private mode or tests */ }
  const nav = (globalThis.navigator?.language || '').slice(0, 2);
  return nav === 'kk' ? 'kk' : nav === 'en' ? 'en' : 'ru';
}

export let lang: Lang = typeof location === 'undefined' ? 'en' : initial();

export function setLang(l: Lang): void {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

export function tr(v: Text | string, vars?: Record<string, string | number>): string {
  let s = typeof v === 'string' ? v : v[lang] ?? v.en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}

const UI = {
  play: { kk: 'Матч', ru: 'Матч', en: 'Match' },
  practice: { kk: 'Жаттығу', ru: 'Тренировка', en: 'Practice' },
  howto: { kk: 'Ойын ережесі', ru: 'Правила игры', en: 'How to play' },
  controls: { kk: 'Басқару', ru: 'Управление', en: 'Controls' },
  language: { kk: 'Тіл', ru: 'Язык', en: 'Language' },
  back: { kk: '← Артқа', ru: '← Назад', en: '← Back' },
  start: { kk: 'Бастау', ru: 'Начать', en: 'Start' },
  resume: { kk: 'Жалғастыру', ru: 'Продолжить', en: 'Resume' },
  restart: { kk: 'Қайта бастау', ru: 'Заново', en: 'Restart' },
  menu: { kk: 'Мәзір', ru: 'Меню', en: 'Menu' },
  paused: { kk: 'Үзіліс', ru: 'Пауза', en: 'Paused' },
  loading: { kk: 'Физика жүктелуде…', ru: 'Загружается физика…', en: 'Loading physics…' },
  footer: {
    kk: 'UrSim FRC v{v} · Ресми емес симулятор. FIRST®-пен байланысы жоқ. REBUILT™ — FIRST сауда белгісі.',
    ru: 'UrSim FRC v{v} · Неофициальный симулятор. Не связан с FIRST®. REBUILT™ — товарный знак FIRST.',
    en: 'UrSim FRC v{v} · Unofficial fan-made simulator. Not affiliated with FIRST®. REBUILT™ is a trademark of FIRST.',
  },
  gamepadNone: { kk: 'Геймпад жоқ — пернетақтамен ойна немесе геймпадтың батырмасын бас', ru: 'Геймпад не найден — играй с клавиатуры или нажми кнопку на геймпаде', en: 'No gamepad found — play with the keyboard or press a gamepad button' },
  gamepadOk: { kk: 'Геймпад қосылды: {name}', ru: 'Геймпад подключён: {name}', en: 'Gamepad connected: {name}' },

  setupTitle: { kk: 'Матчқа дайындық', ru: 'Подготовка к матчу', en: 'Match setup' },
  alliance: { kk: 'Альянс', ru: 'Альянс', en: 'Alliance' },
  red: { kk: 'Қызыл', ru: 'Красный', en: 'Red' },
  blue: { kk: 'Көк', ru: 'Синий', en: 'Blue' },
  station: { kk: 'Станция', ru: 'Станция', en: 'Station' },
  robot: { kk: 'Робот', ru: 'Робот', en: 'Robot' },
  auto: { kk: 'Автономды бағдарлама', ru: 'Автономная программа', en: 'Autonomous routine' },
  autoShoot: { kk: 'Алдын ала жүктелген 8 FUEL-ді ату', ru: 'Выстрелить 8 FUEL из предзагрузки', en: 'Shoot the 8 preloaded FUEL' },
  autoCollect: { kk: 'Ату, NEUTRAL ZONE-дан жинап, тағы ату', ru: 'Выстрелить, собрать в NEUTRAL ZONE и снова стрелять', en: 'Shoot, collect in the NEUTRAL ZONE, shoot again' },
  autoClimb: { kk: 'Ату және TOWER-ге 1-деңгейге шығу (15 ұпай)', ru: 'Выстрелить и залезть на TOWER, уровень 1 (15 очков)', en: 'Shoot, then climb the TOWER to level 1 (15 points)' },
  autoNone: { kk: 'Ештеңе істемеу', ru: 'Ничего не делать', en: 'Do nothing' },
  difficulty: { kk: 'Боттардың деңгейі', ru: 'Уровень ботов', en: 'Bot level' },
  easy: { kk: 'Оңай', ru: 'Легко', en: 'Easy' },
  normal: { kk: 'Орташа', ru: 'Нормально', en: 'Normal' },
  hard: { kk: 'Қиын', ru: 'Сложно', en: 'Hard' },
  partners: { kk: 'Серіктестер мен қарсыластар — боттар', ru: 'Партнёры и соперники — боты', en: 'Partners and opponents are bots' },

  period_auto: { kk: 'AUTO', ru: 'AUTO', en: 'AUTO' },
  period_transition: { kk: 'ӨТПЕЛІ', ru: 'ПЕРЕХОД', en: 'TRANSITION' },
  period_shift1: { kk: 'SHIFT 1', ru: 'SHIFT 1', en: 'SHIFT 1' },
  period_shift2: { kk: 'SHIFT 2', ru: 'SHIFT 2', en: 'SHIFT 2' },
  period_shift3: { kk: 'SHIFT 3', ru: 'SHIFT 3', en: 'SHIFT 3' },
  period_shift4: { kk: 'SHIFT 4', ru: 'SHIFT 4', en: 'SHIFT 4' },
  period_endgame: { kk: 'END GAME', ru: 'END GAME', en: 'END GAME' },
  practiceClock: { kk: 'ЖАТТЫҒУ', ru: 'ТРЕНИРОВКА', en: 'PRACTICE' },
  hubActive: { kk: 'HUB белсенді', ru: 'HUB активен', en: 'HUB active' },
  hubInactive: { kk: 'HUB өшірулі', ru: 'HUB выключен', en: 'HUB inactive' },
  hubSoon: { kk: '{s} с кейін ауысады', ru: 'смена через {s} с', en: 'changes in {s} s' },
  fuelHeld: { kk: 'FUEL', ru: 'FUEL', en: 'FUEL' },
  autoDriving: { kk: 'Робот өз бағдарламасымен жүреді', ru: 'Робот едет по своей программе', en: 'The robot runs its own program' },
  climbHint: { kk: 'TOWER жанындасың: C / Y ұстап тұр — көтерілу', ru: 'Ты у TOWER: держи C / Y — подъём', en: 'At the TOWER: hold C / Y to climb' },
  level: { kk: '{n}-деңгей', ru: 'Уровень {n}', en: 'Level {n}' },
  wastedNote: { kk: 'Өшірулі HUB-қа түскен FUEL ұпай бермейді', ru: 'FUEL в выключенный HUB не приносит очков', en: 'FUEL in an inactive HUB scores nothing' },
  shiftChange: { kk: 'Ауысым! Енді белсенді: {who}', ru: 'Смена! Теперь активен: {who}', en: 'Shift! Now active: {who}' },
  bothActive: { kk: 'Екі HUB та белсенді', ru: 'Оба HUB активны', en: 'Both HUBs active' },
  autoWon: { kk: 'AUTO жеңімпазы: {who}. SHIFT 1-де оның HUB-ы өшеді.', ru: 'AUTO выиграл {who}. В SHIFT 1 его HUB выключится.', en: '{who} won AUTO. Its HUB goes inactive in SHIFT 1.' },

  resultTitle: { kk: 'Матч аяқталды', ru: 'Матч окончен', en: 'Match over' },
  win: { kk: 'Жеңіс!', ru: 'Победа!', en: 'Victory!' },
  loss: { kk: 'Жеңіліс', ru: 'Поражение', en: 'Defeat' },
  tie: { kk: 'Тең', ru: 'Ничья', en: 'Tie' },
  rAutoFuel: { kk: 'AUTO-дағы FUEL', ru: 'FUEL в AUTO', en: 'AUTO FUEL' },
  rTeleFuel: { kk: 'TELEOP-тағы FUEL', ru: 'FUEL в TELEOP', en: 'TELEOP FUEL' },
  rAutoTower: { kk: 'AUTO TOWER', ru: 'TOWER в AUTO', en: 'AUTO TOWER' },
  rTower: { kk: 'TOWER (соңында)', ru: 'TOWER (в конце)', en: 'TOWER (end)' },
  rWasted: { kk: 'Өшірулі HUB-қа (0 ұпай)', ru: 'В выключенный HUB (0 очков)', en: 'Into an inactive HUB (0 pts)' },
  rTotal: { kk: 'Барлығы', ru: 'Всего', en: 'Total' },
  rRp: { kk: 'Рейтинг ұпайлары (RP)', ru: 'Рейтинговые очки (RP)', en: 'Ranking points (RP)' },
  rYou: { kk: 'Сенің роботың: {fuel} FUEL, {lvl}', ru: 'Твой робот: {fuel} FUEL, {lvl}', en: 'Your robot: {fuel} FUEL, {lvl}' },
  rBest: { kk: 'Рекорд: {n} ұпай', ru: 'Рекорд: {n} очков', en: 'Best: {n} points' },
  noClimb: { kk: 'көтерілмеді', ru: 'без подъёма', en: 'no climb' },
} satisfies Record<string, Text>;

export type UiKey = keyof typeof UI;
export function t(key: UiKey, vars?: Record<string, string | number>): string {
  return tr(UI[key], vars);
}
