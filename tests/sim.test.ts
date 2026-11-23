import { beforeAll, describe, expect, it } from 'vitest';
import { World, initPhysics, PHYSICS_DT } from '../src/sim/World';
import { HALF_L, HUB, RED } from '../src/game/field';

beforeAll(() => initPhysics());

const run = (w: World, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds / PHYSICS_DT; i++) {
    each?.();
    w.step();
  }
};

describe('World', () => {
  it('starts with 504 FUEL: 8 in each robot, 24 in each DEPOT and CHUTE, the rest on the field', () => {
    const w = new World({ practice: true });
    for (let s = 0; s < 6; s++) w.addRobot(s, 'overload');
    w.reset();
    expect(w.fuel.length).toBe(504);
    expect(w.robots.every(r => r.hopper.length === 8)).toBe(true);
    expect(w.chute.red.length + w.chute.blue.length).toBe(48);
    expect(w.fieldFuel().length).toBe(504 - 48 - 48);
  });

  for (const id of ['overload', 'sprinter', 'turret']) {
    it(`${id}: shoots its 8 pre-loads from the starting line into the HUB`, () => {
      const w = new World({ practice: true });
      const r = w.addRobot(0, id);
      w.reset();
      r.intakeOn = false;
      run(w, 4, () => { r.input.shoot = true; });
      expect(r.hopper.length).toBe(0);
      expect(w.score.red.teleFuel).toBeGreaterThanOrEqual(6);
    });
  }

  it('shoots from far and while driving', () => {
    const w = new World({ practice: true });
    const r = w.addRobot(0, 'overload');
    w.reset();
    r.intakeOn = false;
    r.setPose({ x: -HALF_L + 1.2, z: 2.5, yaw: 0 });
    run(w, 5, () => { r.input.shoot = true; r.input.vz = r.position[2] > 0 ? -0.4 : 0; });
    expect(w.score.red.teleFuel).toBeGreaterThanOrEqual(5);
  });

  it('collects FUEL by driving into it and returns scored FUEL to the field', () => {
    const w = new World({ practice: true });
    const r = w.addRobot(0, 'overload');
    w.reset();
    r.setPose({ x: -1.6, z: 0, yaw: 0 });
    run(w, 1.5, () => { r.input.vx = 0.4; });
    expect(r.hopper.length).toBeGreaterThan(14);
  });

  it('drives under the TRENCH and over a BUMP', () => {
    const w = new World({ practice: true });
    const r = w.addRobot(0, 'overload');
    w.reset();
    r.intakeOn = false;
    const [tx, tz] = RED.trenches[0];
    r.setPose({ x: tx - 1.5, z: tz, yaw: 0 });
    run(w, 1.5, () => { r.input.vx = 0.6; });
    expect(r.position[0]).toBeGreaterThan(tx + 1);
    const [bx, bz] = RED.bumps[0];
    r.setPose({ x: bx - 1.5, z: bz, yaw: 0 });
    run(w, 1.8, () => { r.input.vx = 0.6; r.input.vz = 0; });
    expect(r.position[0]).toBeGreaterThan(bx + 1);
  });

  it('climbs the TOWER to level 3 and back down', () => {
    const w = new World({ practice: true });
    const r = w.addRobot(0, 'overload');
    w.reset();
    const s = r.towerSpot();
    r.setPose({ x: s.x + 0.3, z: s.z, yaw: 0 });
    run(w, 9, () => { r.input.climb = true; });
    expect(r.level).toBe(3);
    run(w, 6, () => { r.input.climb = false; r.input.vx = 1; });
    expect(r.hanging).toBe(false);
  });

  it('a full match: AUTO, SHIFTS, END GAME, then scores', () => {
    const w = new World();
    for (let s = 0; s < 6; s++) w.addRobot(s, 'overload');
    w.reset();
    const events: string[] = [];
    w.onEvent = e => { if (e.type !== 'score' && e.type !== 'wasted') events.push(e.type + (e.period ?? '')); };
    w.start();
    run(w, 3, () => { for (const r of w.robots) r.input.shoot = true; });
    run(w, 165);
    expect(w.ended).toBe(true);
    expect(events).toEqual(['periodtransition', 'autoWinner', 'periodshift1', 'periodshift2', 'periodshift3', 'periodshift4', 'periodendgame', 'end']);
    expect(w.score.red.autoFuel + w.score.blue.autoFuel).toBeGreaterThan(30);
    expect(HUB.height).toBeGreaterThan(1.8);
  });

  it('G407: shooting from outside the ALLIANCE ZONE is a MAJOR FOUL', () => {
    const w = new World();
    const r = w.addRobot(0, 'overload');
    w.reset();
    w.start();
    r.intakeOn = false;
    r.setPose({ x: -1.5, z: 2, yaw: Math.PI });
    const fouls: string[] = [];
    w.onEvent = e => { if (e.type === 'foul') fouls.push(e.rule!); };
    run(w, 2, () => { r.input.shoot = true; });
    expect(fouls).toContain('G407');
    expect(w.score.blue.foulPoints).toBeGreaterThanOrEqual(15);
    // G403: completely across the CENTER LINE in AUTO
    r.setPose({ x: 1.2, z: 2, yaw: 0 });
    run(w, 0.5);
    expect(fouls).toContain('G403');
  });
});
