import { beforeAll, expect, it } from 'vitest';
import { World, initPhysics, PHYSICS_DT } from '../src/sim/World';
import { Bot, type AutoPlan } from '../src/sim/Bot';
import { MATCH_LENGTH, total } from '../src/game/rules';

beforeAll(() => initPhysics());

it('six bots play a whole match: they score, the SHIFTS alternate, some climb', () => {
  const w = new World({ seed: 3 });
  const plans: AutoPlan[] = ['shoot', 'collect', 'climb', 'shoot', 'collect', 'climb'];
  const ids = ['overload', 'sprinter', 'turret'];
  const bots = [0, 1, 2, 3, 4, 5].map(s => new Bot(w, w.addRobot(s, ids[s % 3]), 'hard', plans[s]));
  w.reset();
  w.start();
  let autoTowerSeen = false;
  for (let i = 0; i < (MATCH_LENGTH + 4) / PHYSICS_DT; i++) {
    for (const b of bots) b.update(PHYSICS_DT);
    w.step();
    if (w.time > 19.9 && w.time < 20) autoTowerSeen ||= w.robots.some(r => r.level >= 1);
  }
  const s = w.score;
  console.log(JSON.stringify(s), JSON.stringify(w.fouls), total(s.red), total(s.blue), w.robots.map(r => `${r.spec.id}:${r.scored}/L${r.level}`).join(' '));
  expect(w.ended).toBe(true);
  expect(s.red.autoFuel + s.blue.autoFuel).toBeGreaterThan(25);
  expect(s.red.teleFuel).toBeGreaterThan(40);
  expect(s.blue.teleFuel).toBeGreaterThan(40);
  expect(autoTowerSeen).toBe(true);
  expect(s.red.tower + s.blue.tower).toBeGreaterThan(0);
  expect(w.robots.every(r => r.onField)).toBe(true);
}, 60000);
