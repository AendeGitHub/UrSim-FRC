import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FieldLayout } from '../src/field/layout';
import { parseColliders } from '../src/sim/colliders';
import { PHYSICS_DT, Simulation, initPhysics } from '../src/sim/Simulation';
import { DURATION } from '../src/sim/Match';
import { SLOTS } from '../src/sim/types';
import { fuelScored, total } from '../src/game/scoring';
import { ROBOTS } from '../src/robot/robots';
import { Bot } from '../src/ai/Bot';

const layout: FieldLayout = JSON.parse(fs.readFileSync('public/assets/field-layout.json', 'utf8'));
const bin = fs.readFileSync('public/assets/field-colliders.bin');
const colliders = parseColliders(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);

describe('REBUILT bots', () => {
  beforeAll(() => initPhysics());

  it('six bots play a full match: they score FUEL and climb', () => {
    let finished = false;
    const sim = new Simulation(layout, colliders, { toast: () => {}, finished: () => { finished = true; } });
    for (const slot of SLOTS) sim.addRobot(slot, slot, ROBOTS[SLOTS.indexOf(slot) % ROBOTS.length].id);
    const bots = SLOTS.map(s => new Bot(s, 'hard'));
    sim.start('match');
    const steps = Math.round((DURATION.auto + DURATION.transition + DURATION.teleop + 4) / PHYSICS_DT);
    for (let i = 0; i < steps && !finished; i++) {
      for (const b of bots) b.drive(sim);
      sim.step();
    }
    const { red, blue } = sim.match.score;
    const summary = (s: typeof red) => ({ fuel: fuelScored(s), total: total(s), levels: s.levels, auto: s.autoClimbed, calls: s.calls });
    console.log('red', summary(red), 'blue', summary(blue));
    expect(finished).toBe(true);
    expect(fuelScored(red) + fuelScored(blue)).toBeGreaterThan(40);
    const climbed = Object.values(red.levels).concat(Object.values(blue.levels)).filter(l => (l ?? 0) > 0);
    expect(climbed.length).toBeGreaterThan(0);
  }, 120_000);
});
