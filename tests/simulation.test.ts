import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FieldLayout } from '../src/field/layout';
import { parseColliders } from '../src/sim/colliders';
import { PHYSICS_DT, Simulation, initPhysics } from '../src/sim/Simulation';
import { DURATION } from '../src/sim/Match';
import { idleInput, SLOTS } from '../src/sim/types';
import { total } from '../src/game/scoring';
import { ROBOTS, SKYLINE, TWIN_FLYWHEEL, BULLDOZER } from '../src/robot/robots';

const layout: FieldLayout = JSON.parse(fs.readFileSync('public/assets/field-layout.json', 'utf8'));
const bin = fs.readFileSync('public/assets/field-colliders.bin');
const colliders = parseColliders(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);

function makeSim() {
  const toasts: string[] = [];
  const sim = new Simulation(layout, colliders, { toast: t => toasts.push(t), finished: () => toasts.push('finished') });
  return { sim, toasts };
}

const run = (sim: Simulation, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / PHYSICS_DT); i++) sim.step();
};

describe('headless REBUILT simulation', () => {
  beforeAll(() => initPhysics());

  it('has 504 FUEL: 8 pre-loaded in each robot, 24 in each DEPOT and CHUTE', () => {
    const { sim } = makeSim();
    expect(sim.balls.all.length).toBe(504);
    const p = sim.addRobot('red1', 'test');
    sim.start('practice');
    expect(p.mech.held).toBe(8);
    expect(sim.balls.all.filter(b => b.state === 'staged').length).toBe(48);
  });

  it('drives a robot forward with the stick convention (up = -1)', () => {
    const { sim } = makeSim();
    sim.addRobot('red1', 'test');
    sim.start('practice');
    const x0 = sim.robots.get('red1')!.robot.position[0];
    sim.setInput('red1', { ...idleInput(), ly: -1 });
    run(sim, 0.5);
    expect(sim.robots.get('red1')!.robot.position[0] - x0).toBeGreaterThan(0.6);
  });

  for (const def of [SKYLINE, TWIN_FLYWHEEL, BULLDOZER]) {
    it(`${def.name} scores its pre-loads from its ALLIANCE ZONE`, () => {
      const { sim } = makeSim();
      const p = sim.addRobot('red2', 'test', def.id);
      sim.start('practice');
      // In the ALLIANCE ZONE, 2.5 m from the HUB, facing it (back to it for a robot whose shooter faces back).
      const [hx] = sim.zones.hub.red;
      const back = Math.abs(Math.cos(def.shooter.facing ?? 0) + 1) < 0.1 && def.shooter.turretLimit === 0;
      p.robot.setPose({ x: hx - 2.6, z: 0.3, yaw: back ? Math.PI : 0 });
      sim.setInput('red2', { ...idleInput(), shooterOn: true });
      run(sim, 1.5);
      sim.setInput('red2', { ...idleInput(), transfer: true });
      run(sim, 4);
      sim.setInput('red2', idleInput());
      run(sim, 2);
      const s = sim.match.score.red;
      expect(p.mech.held).toBe(0);
      expect(s.autoFuel + s.teleopFuel).toBeGreaterThanOrEqual(7);
    });
  }

  it('climbs to LEVEL 3 at its TOWER and scores it at the end of the match', () => {
    const { sim } = makeSim();
    const p = sim.addRobot('red1', 'test', SKYLINE.id);
    sim.start('practice');
    const spot = sim.hangSpot(p.robot);
    expect(spot).toBeNull();
    const t = sim.zones.tower.red;
    p.robot.setPose({ x: t.maxX + 0.5, z: (t.minZ + t.maxZ) / 2, yaw: Math.PI });
    expect(sim.hangSpot(p.robot)).not.toBeNull();
    sim.setInput('red1', { ...idleInput(), climb: true });
    run(sim, 8);
    expect(p.robot.level).toBe(3);
    expect(p.robot.position[1]).toBeGreaterThan(1.1);
  });

  it('plays a full match with six robots fast enough', () => {
    const { sim, toasts } = makeSim();
    for (const slot of SLOTS) sim.addRobot(slot, slot, ROBOTS[SLOTS.indexOf(slot) % ROBOTS.length].id);
    sim.start('match');
    const t0 = performance.now();
    // Everyone drives into the NEUTRAL ZONE pile with the intake running.
    for (const slot of SLOTS) sim.setInput(slot, { ...idleInput(), ly: -0.7, intake: true });
    run(sim, DURATION.auto + 0.05);
    const ms = (performance.now() - t0) / (DURATION.auto / PHYSICS_DT);
    console.log(`step: ${ms.toFixed(2)} ms`, sim.match.score.red, toasts);
    expect(ms).toBeLessThan(4);
    expect(sim.match.period).toBe('transition');
    run(sim, DURATION.transition + DURATION.teleop + 4);
    expect(toasts).toContain('finished');
    expect(total(sim.match.score.red)).toBeGreaterThanOrEqual(0);
  });
});
