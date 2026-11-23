# UrSim FRC Edition · REBUILT 2026

Браузерный 3D-симулятор FRC-игры **REBUILT** (сезон 2026) в стиле [UrSim](https://github.com/AendeGitHub/UrSim): сам ведёшь робота на поле, собираешь FUEL, стреляешь в HUB, залезаешь на TOWER. Партнёры и соперники — боты. Языки: қазақша, русский, English.

*Неофициальный симулятор. Не связан с FIRST®. REBUILT™ — товарный знак FIRST.*

## Что есть

- **Поле по Game Manual 2026** (раздел 5): 16,54 × 8,07 м, HUB (вход 1,83 м), BUMP с рампами 15°, TRENCH (проезд 56,5 см), TOWER с перекладинами 69 / 114 / 160 см, DEPOT, OUTPOST. Положения TOWER, DEPOT и OUTPOST поперёк поля взяты из CAD поля.
- **504 FUEL** с физикой (Rapier): 360 в NEUTRAL ZONE, по 24 в DEPOT и CHUTE, по 8 в каждом роботе.
- **Матч 2:40** по таблицам 6-2 и 6-3: AUTO 20 с, ПЕРЕХОД, четыре SHIFT, END GAME. HUB включаются по очереди: альянс, выигравший AUTO, начинает SHIFT 1 с выключенным HUB. FUEL засчитывается ещё 3 с после выключения.
- **Очки и RP** (6.5): FUEL 1, TOWER 15 в AUTO, 10 / 20 / 30 в конце; ENERGIZED, SUPERCHARGED, TRAVERSAL.
- **Фолы**: G407 (стрелять только из своей ALLIANCE ZONE), G403 (AUTO за центральную линию), G420 (не трогать соперника на TOWER в последние 30 с).
- **Swerve-робот**: езда относительно поля, полный интейк, бункер, шутер с автонаведением на HUB (баллистика с учётом движения), подъём на TOWER. Три робота на выбор: Overload, Sprinter, Turret.
- **Автономная программа** на выбор: выстрелить предзагрузку, собрать и выстрелить ещё, залезть на уровень 1.
- **Боты** трёх уровней: собирают FUEL, ждут, когда включится их HUB, стреляют из своей зоны, лезут на TOWER в END GAME.
- **Камеры**: водитель, сзади робота, сверху. Клавиатура и геймпад.
- Режим **тренировки** (без таймера, HUB всегда включён) и страница **правил игры**.

## Управление

| Клавиатура | Геймпад | Действие |
| --- | --- | --- |
| W A S D / ↑ ↓ | левый стик | езда |
| Q E / ← → | правый стик | поворот |
| Space / K | RT / RB | стрелять (робот сам наводится на HUB) |
| I | LB / X | интейк вкл/выкл |
| Shift | LT | интейк, пока держишь |
| C | Y | подъём на TOWER (держать); езда — спуск |
| V | B | камера |
| R | Back | сброс поля в тренировке |
| Esc / P | Start | пауза |

## Запуск

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # правила, физика, полный матч ботов
npm run build      # статический сайт в dist/
```

## Деплой (бесплатно)

`render.yaml` — статический сайт на Render: Dashboard → New → Blueprint → этот репозиторий. Подойдёт любой статический хостинг (GitHub Pages, Netlify): собрать `npm run build` и выложить `dist/`.

## CAD поля

`npm run convert:field` переводит STEP из `Field/` (в git не хранится) в `public/assets/field.glb` и `field-layout.json` с габаритами каждого элемента. Сейчас лежит Team Practice Field: по нему сверены положения элементов. Сам рисунок поля игра пока строит сама по размерам мануала.

## Устройство

- `src/game/` — правила без физики: размеры поля (`field.ts`), периоды, смены HUB, очки (`rules.ts`), роботы (`robots.ts`).
- `src/sim/` — физика: `World.ts` (поле, FUEL, HUB, OUTPOST, фолы), `Robot.ts` (swerve, интейк, шутер, подъём), `Bot.ts`, `ballistics.ts`, `swerve.ts`.
- `src/view/` — three.js: поле, FUEL (один InstancedMesh), роботы.
- `src/ui/` — меню, HUD, результаты, тексты на трёх языках.

---

**English.** A browser 3D driving simulator for the FRC 2026 game REBUILT, in the style of UrSim. Field and rules from the 2026 Game Manual, 504 physics FUEL, HUB shifts, TOWER climbing, fouls, swerve robots, bots, Kazakh / Russian / English. `npm install && npm run dev`.
