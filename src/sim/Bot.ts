// A robot that drives itself: the partners and opponents, and every robot's AUTO routine.
// It collects FUEL, waits for its HUB to light up, shoots, and climbs the TOWER in END GAME.

import { HALF_L, HALF_W, HUB, RED, TOWER, hubCenter, inAllianceZone, intoField, place, type Vec2 } from '../game/field';
import { MATCH_LENGTH } from '../game/rules';
import { other, slotStation } from '../game/types';
import type { Robot } from './Robot';
import type { World } from './World';
import { wrapAngle } from './swerve';

export type BotLevel = 'easy' | 'normal' | 'hard';
export type AutoPlan = 'shoot' | 'collect' | 'climb' | 'none';

const LEVEL = {
  easy: { speed: 0.55, fill: 0.45, patience: false, think: 0.6 },
  normal: { speed: 0.8, fill: 0.65, patience: true, think: 0.35 },
  hard: { speed: 1, fill: 0.85, patience: true, think: 0.2 },
} as const;

type Task = 'collect' | 'shoot' | 'climb' | 'leave' | 'idle';

export class Bot {
  task: Task = 'idle';
  private target: Vec2 | null = null;
  private targetFuel = -1;
  private think = 0;
  private stuck = 0;
  private dodge = 0;
  private dodgeDir = 1;
  private readonly cfg: (typeof LEVEL)[BotLevel];

  constructor(private readonly world: World, readonly robot: Robot, level: BotLevel, public auto: AutoPlan = 'shoot') {
    this.cfg = LEVEL[level];
  }

  /** Sets the robot's input for this step. */
  update(dt: number): void {
    const r = this.robot;
    const w = this.world;
    const inp = r.input;
    inp.vx = inp.vz = inp.turn = 0;
    inp.shoot = inp.climb = false;
    inp.intake = true;
    if (w.ended || (!w.running && !w.practice)) return;
    this.think -= dt;
    if (this.think <= 0) {
      this.think = this.cfg.think;
      this.decide();
    }
    switch (this.task) {
      case 'collect': {
        if (this.targetFuel >= 0 && w.fuel[this.targetFuel].state !== 'field') this.decide();
        if (this.target) this.driveTo(this.target, dt, true);
        break;
      }
      case 'shoot': {
        const spot = this.shootSpot();
        const far = Math.hypot(spot[0] - r.position[0], spot[1] - r.position[2]);
        if (far > 0.6) this.driveTo(spot, dt, false);
        inp.shoot = far < 2.2 && w.bumpersInZone(r) && (w.hubOn(r.alliance) || !this.cfg.patience);
        break;
      }
      case 'climb': {
        const s = r.towerSpot();
        if (r.hanging) {
          inp.climb = w.isAuto ? r.climb < 0.99 : true;
        } else if (r.nearTower()) {
          inp.climb = true;
        } else {
          this.driveTo([s.x + intoField(r.alliance) * 0.35, s.z], dt, false);
        }
        break;
      }
      case 'leave': {
        // Let go of the TOWER after AUTO.
        inp.vx = intoField(r.alliance);
        break;
      }
    }
  }

  private decide(): void {
    const r = this.robot;
    const w = this.world;
    const t = w.time;
    const auto = w.isAuto;
    if (auto) {
      if (this.auto === 'none') return void (this.task = 'idle');
      if (r.hopper.length > 0 && (this.auto !== 'collect' || t < 9 || r.hopper.length > 6)) return void (this.task = 'shoot');
      if (this.auto === 'climb') return void (this.task = 'climb');
      if (this.auto === 'collect') return this.pickFuel();
      return void (this.task = 'idle');
    }
    if (r.hanging && !this.climbTime()) return void (this.task = 'leave');
    if (!w.practice && this.climbTime() && r.spec.climbMax > 0 && this.towerFree()) return void (this.task = 'climb');
    const fill = r.hopper.length / r.spec.capacity;
    const soonOn = w.hubOn(r.alliance) || (w.periodLeft < 4 && !w.practice);
    if (r.hopper.length && (fill >= this.cfg.fill || (soonOn && fill > 0.25) || (this.task === 'shoot' && soonOn))) {
      return void (this.task = 'shoot');
    }
    this.pickFuel();
  }

  /** Time to head for the TOWER: early enough for the climb this robot can do. */
  private climbTime(): boolean {
    const w = this.world;
    if (w.practice || w.isAuto) return false;
    const left = MATCH_LENGTH - w.time;
    return left < 10 + this.robot.spec.climbMax * this.robot.spec.climbTime;
  }

  private towerFree(): boolean {
    const s = this.robot.towerSpot();
    return !this.world.robots.some(o => o !== this.robot && o.alliance === this.robot.alliance && Math.hypot(o.position[0] - s.x, o.position[2] - s.z) < 1.1);
  }

  /** Where this robot shoots from: in its ALLIANCE ZONE, a few meters from its HUB. */
  private shootSpot(): Vec2 {
    const r = this.robot;
    const [hx, hz] = hubCenter(r.alliance);
    const dir = intoField(r.alliance);
    const side = [1.7, 0, -1.7][slotStation(r.slot)] * (r.alliance === 'red' ? 1 : -1);
    return [hx - dir * 2.3, hz + side];
  }

  private pickFuel(): void {
    const r = this.robot;
    const w = this.world;
    const [px, , pz] = r.position;
    const foe = other(r.alliance);
    let best = -1;
    let bestD = Infinity;
    for (const f of w.fuel) {
      if (f.state !== 'field') continue;
      const [x, y, z] = w.fuelPos(f.id);
      // G403: in AUTO, stay on our side of the CENTER LINE.
      if (w.isAuto && (r.alliance === 'red' ? x > -0.5 : x < 0.5)) continue;
      if (y > 0.3 || inAllianceZone(foe, x) || Math.abs(z) > HALF_W - 0.35 || Math.abs(x) > HALF_L - 0.4) continue;
      // Don't chase FUEL on the HUB's line (inside a BUMP or TRENCH leg).
      const hubLine = Math.abs(Math.abs(x) - (HALF_L - HUB.fromWall)) < 0.75;
      // Others' targets count as farther, so partners spread out.
      const d = Math.hypot(x - px, z - pz) + (hubLine ? 3 : 0) + (w.robots.some(o => o !== r && Math.hypot(o.position[0] - x, o.position[2] - z) < 0.8) ? 2 : 0);
      if (d < bestD) {
        bestD = d;
        best = f.id;
      }
    }
    this.task = best >= 0 ? 'collect' : 'idle';
    this.targetFuel = best;
    if (best >= 0) {
      const [x, , z] = w.fuelPos(best);
      this.target = [x, z];
    }
  }

  /** Steers toward a point around the HUBS, TOWERS and other robots; `face` turns the intake to the way it goes. */
  private driveTo(p: Vec2, dt: number, face: boolean): void {
    const r = this.robot;
    const [x, , z] = r.position;
    let dx = p[0] - x;
    let dz = p[1] - z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return;
    dx /= dist;
    dz /= dist;
    // Push away from solid things nearby.
    const push = (ox: number, oz: number, radius: number, k: number) => {
      const ex = x - ox, ez = z - oz;
      const d = Math.hypot(ex, ez);
      if (d > radius || d < 1e-3) return;
      const s = (k * (radius - d)) / radius;
      dx += (ex / d) * s;
      dz += (ez / d) * s;
      // and slide around it rather than stop
      dx += (-ez / d) * s * 0.6 * Math.sign(dx * -ez + dz * ex || 1);
    };
    for (const a of ['red', 'blue'] as const) {
      const [hx, hz] = place(a, RED.hub);
      push(hx, hz, 1.45, 2.2);
      const [tx, tz] = place(a, RED.tower);
      if (this.task !== 'climb') push(tx, tz, TOWER.width + 0.4, 1.5);
      for (const tr of RED.trenches) {
        const [cx, cz] = place(a, tr);
        // The TRENCH legs at either side of the passage under it
        push(cx, cz + RED.trenchWidth / 2, 0.55, 1.2);
        push(cx, cz - RED.trenchWidth / 2, 0.55, 1.2);
      }
    }
    for (const o of this.world.robots) if (o !== r) push(o.position[0], o.position[2], 1.05, 1.1);
    const n = Math.hypot(dx, dz) || 1;
    dx /= n;
    dz /= n;
    if (this.dodge > 0) {
      this.dodge -= dt;
      [dx, dz] = [-dz * this.dodgeDir, dx * this.dodgeDir];
    }
    const slow = Math.min(1, dist / 0.8);
    const speed = this.cfg.speed * Math.max(0.35, slow);
    r.input.vx = dx * speed;
    r.input.vz = dz * speed;
    if (face) {
      const want = Math.atan2(-dz, dx);
      r.input.turn = Math.max(-1, Math.min(1, wrapAngle(want - r.yaw) * 1.6));
    }
    // Stuck against something: sidestep for a moment.
    const moving = Math.hypot(...r.velocity);
    this.stuck = moving < 0.25 && speed > 0.3 ? this.stuck + dt : 0;
    if (this.stuck > 1.2) {
      this.stuck = 0;
      this.dodge = 0.8;
      this.dodgeDir = Math.random() < 0.5 ? 1 : -1;
    }
  }
}
