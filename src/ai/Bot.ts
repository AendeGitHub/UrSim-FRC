// The AI driver: partners and opponents, and every AI robot's AUTO. Ten times a second it decides
// what to do: collect FUEL (from the field, the DEPOT or the OUTPOST), shoot it from its ALLIANCE
// ZONE while its HUB is lit, or climb the TOWER for END GAME (and LEVEL 1 in AUTO). It drives there
// through a BUMP or under a TRENCH, around the HUBS and other robots, and sends gamepad input like a
// driver. Its level (easy, medium, hard) sets how fast it drives, how well it aims and how long
// it thinks.

import { TRENCH } from '../frc/field';
import { inRect, footprint, polygonOverlapsRect, type Rect } from '../field/zones';
import { wrapAngle } from '../robot/mecanum';
import type { Alliance } from '../robot/robotConfig';
import { robotById } from '../robot/robots';
import { DURATION, ENDGAME } from '../sim/Match';
import type { PlayerRobot, Simulation } from '../sim/Simulation';
import { idleInput, slotStation, type RobotInput, type Slot } from '../sim/types';
import type { AiLevel } from './level';

export interface Skill {
  /** Top driving speed, share of full stick */
  speed: number;
  /** Fastest turn, share of full stick */
  turn: number;
  /** Extra shot scatter (standard deviation), rad */
  aim: number;
  /** Share of the hopper it fills before it goes to shoot */
  fill: number;
  /** Seconds between decisions */
  think: number;
  /** Waits for its HUB to light up before it shoots (an easy one shoots into a dark HUB too) */
  patient: boolean;
  /** Its turrets aim on the move */
  movingShots: boolean;
}

const DEG = Math.PI / 180;

export const SKILLS: Record<AiLevel, Skill> = {
  easy: { speed: 0.5, turn: 0.55, aim: 7 * DEG, fill: 0.4, think: 0.5, patient: false, movingShots: false },
  medium: { speed: 0.78, turn: 0.8, aim: 3.5 * DEG, fill: 0.6, think: 0.25, patient: true, movingShots: true },
  hard: { speed: 1, turn: 1, aim: 0, fill: 0.8, think: 0.1, patient: true, movingShots: true },
};

/** Physics steps between decisions at most (the bot steers every step) */
const STEER_EVERY = 4;
/** Fuel and robots are this far from a wall at most for the AI to go for them, m */
const WALL_MARGIN = 0.35;
/** The HUB's line (HUB, BUMPS, TRENCHES) is this much wider than the HUB for routing, m */
const LINE_MARGIN = 0.55;

type Task = 'collect' | 'outpost' | 'shoot' | 'climb' | 'letGo' | 'idle';

export class Bot {
  task: Task = 'idle';
  private target: [number, number] | null = null;
  private targetBall = -1;
  private think = 0;
  private steps = 0;
  private stuck = 0;
  /** Times in a row it got stuck going for the same ball */
  private stuckOn = 0;
  /** Balls it gave up on, until a match time */
  private readonly skip = new Map<number, number>();
  private dodge = 0;
  private dodgeDir = 1;
  /** The gate it is crossing the HUB's line through: z, and which way it goes (+1 toward +x) */
  private gate: { z: number; dir: number; lineX: number } | null = null;
  private skill: Skill;
  private input: RobotInput = idleInput();

  constructor(readonly slot: Slot, private current: AiLevel = 'medium') {
    this.skill = SKILLS[current];
  }

  get level(): AiLevel {
    return this.current;
  }

  set level(level: AiLevel) {
    this.current = level;
    this.skill = SKILLS[level];
  }

  /** Call before every physics step. */
  drive(sim: Simulation): void {
    const p = sim.robots.get(this.slot);
    if (!p) return;
    if (this.steps++ % STEER_EVERY !== 0) return;
    const dt = STEER_EVERY / 120;
    p.mech.aimError = this.skill.aim;
    p.mech.movingShots = sim.ruleOptions.movingShots && this.skill.movingShots;
    const input = idleInput();
    if (!sim.match.robotEnabled) {
      this.task = 'idle';
      this.gate = null;
      sim.setInput(this.slot, input);
      return;
    }
    this.think -= dt;
    if (this.think <= 0) {
      this.think = this.skill.think;
      this.decide(sim, p);
    }
    this.input = input;
    this.act(sim, p, dt);
    sim.setInput(this.slot, input);
  }

  // ---- deciding --------------------------------------------------------------

  private decide(sim: Simulation, p: PlayerRobot): void {
    const { robot, mech } = p;
    const match = sim.match;
    const def = robotById(p.robotId);
    const auto = match.period === 'auto';
    const climber = def.climber;
    if (robot.hanging) {
      // Hold on in END GAME; let go after AUTO's LEVEL 1.
      this.task = match.period === 'teleop' && match.teleopLeft > ENDGAME ? 'letGo' : 'climb';
      return;
    }
    if (climber && this.climbTime(sim, p)) {
      this.task = 'climb';
      return;
    }
    const held = mech.held;
    const full = held >= Math.max(1, Math.round(mech.capacity * this.skill.fill));
    const lit = sim.match.hubOn(robot.alliance);
    if (auto) {
      // Pre-loads first; then collect on our side, shooting as the hopper fills.
      this.task = held > 0 && (held >= 8 || full || match.time > DURATION.auto - 6) ? 'shoot' : 'collect';
    } else if (held > 0 && (full || (lit && (this.task === 'shoot' || held >= mech.capacity * 0.25)))) {
      this.task = 'shoot';
    } else {
      this.task = 'collect';
    }
    if (this.task === 'collect') this.pickFuel(sim, p);
  }

  /** Whether it should head for the TOWER now: for END GAME early enough to climb, and in AUTO for LEVEL 1. */
  private climbTime(sim: Simulation, p: PlayerRobot): boolean {
    const match = sim.match;
    const climber = robotById(p.robotId).climber!;
    if (match.period === 'auto') {
      // Two robots at most score AUTO's LEVEL 1: stations 1 and 3, after shooting their pre-loads.
      return slotStation(p.robot.slot) !== 2 && p.mech.held === 0 && match.time > DURATION.auto - 9;
    }
    if (match.period !== 'teleop') return false;
    const [px, , pz] = p.robot.position;
    const spot = this.freeSpot(sim, p);
    if (!spot) return false;
    const travel = Math.hypot(spot.x - px, spot.z - pz) / (3 * this.skill.speed) + 2;
    return match.teleopLeft < travel + climber.levels * climber.time + 3;
  }

  private freeSpot(sim: Simulation, p: PlayerRobot) {
    const [px, , pz] = p.robot.position;
    const spots = sim.hangSpots(p.robot).filter(s => !s.taken)
      // Partners on their way there take a spot too.
      .filter(s => ![...sim.robots.values()].some(o => o !== p && o.robot.alliance === p.robot.alliance && !o.robot.hanging && Math.hypot(o.robot.position[0] - s.pose.x, o.robot.position[2] - s.pose.z) < Math.hypot(px - s.pose.x, pz - s.pose.z) - 0.3 && Math.hypot(o.robot.position[0] - s.pose.x, o.robot.position[2] - s.pose.z) < 1.5));
    spots.sort((a, b) => Math.hypot(a.pose.x - px, a.pose.z - pz) - Math.hypot(b.pose.x - px, b.pose.z - pz));
    return spots[0]?.pose ?? null;
  }

  /** The FUEL worth going for: near, in a bunch, not taken by a partner; on our side in AUTO. */
  private pickFuel(sim: Simulation, p: PlayerRobot): void {
    const { robot } = p;
    const a = robot.alliance;
    const [px, , pz] = robot.position;
    const zones = sim.zones;
    const opponentZone = zones.alliance[a === 'red' ? 'blue' : 'red'];
    const auto = sim.match.period === 'auto';
    const tall = robot.cfg.height > TRENCH.clearHeight - 0.01;
    const t = sim.balls.transforms;
    // FUEL in bunches: counts on a 0.5 m grid.
    const cells = new Map<number, number>();
    const cell = (x: number, z: number) => Math.floor(x / 0.5) * 1000 + Math.floor(z / 0.5);
    for (const b of sim.balls.all) {
      if (b.state !== 'field') continue;
      const k = cell(t[b.id * 7], t[b.id * 7 + 2]);
      cells.set(k, (cells.get(k) ?? 0) + 1);
    }
    let best = -1;
    let bestScore = Infinity;
    for (const b of sim.balls.all) {
      if (b.state !== 'field') continue;
      const skipUntil = this.skip.get(b.id);
      if (skipUntil !== undefined && skipUntil > this.steps) continue;
      const x = t[b.id * 7], y = t[b.id * 7 + 1], z = t[b.id * 7 + 2];
      if (y > 0.25 || Math.abs(z) > zones.halfZ - WALL_MARGIN || Math.abs(x) > zones.halfX - WALL_MARGIN) continue;
      if (inRect(x, z, opponentZone)) continue;
      // G403: in AUTO, nowhere near across the CENTER LINE.
      if (auto && (a === 'red' ? x > -0.6 : x < 0.6)) continue;
      // Not under a HUB, on a BUMP or under a TRENCH it can't get under.
      if (this.onLine(sim, x, z, tall)) continue;
      const others = [...sim.robots.values()].some(o => o !== p && o.robot.alliance === a && Math.hypot(o.robot.position[0] - x, o.robot.position[2] - z) < 1);
      const crossing = this.crossesLine(sim, px, x) ? 2.5 : 0;
      const score = Math.hypot(x - px, z - pz) + crossing + (others ? 2.5 : 0) - 0.12 * Math.min(12, cells.get(cell(x, z)) ?? 0);
      if (score < bestScore) {
        bestScore = score;
        best = b.id;
      }
    }
    if (best !== this.targetBall) this.stuckOn = 0;
    this.targetBall = best;
    if (best >= 0) {
      this.target = [t[best * 7], t[best * 7 + 2]];
      return;
    }
    // Nothing on the field: the OUTPOST's human player has some.
    const left = sim.balls.all.some(b => b.state === 'staged' && b.alliance === a);
    this.task = left ? 'outpost' : 'idle';
    this.target = left ? zones.outpost[a] : null;
  }

  /** Whether (x, z) is on a HUB's line where a robot can't pick FUEL up. */
  private onLine(sim: Simulation, x: number, z: number, tall: boolean): boolean {
    const z0 = sim.zones;
    for (const a of ['red', 'blue'] as Alliance[]) {
      const r = z0.hubRect[a];
      if (x < r.minX - 0.2 || x > r.maxX + 0.2) continue;
      if (Math.abs(z) < r.maxZ + 0.25) return true;
      if (z0.bumps.some(b => inRect(x, z, b, 0.1))) return true;
      if (tall) return true;
    }
    return false;
  }

  /** Whether going from x0 to x1 crosses a HUB's line. */
  private crossesLine(sim: Simulation, x0: number, x1: number): boolean {
    return (['red', 'blue'] as Alliance[]).some(a => {
      const c = (sim.zones.hubRect[a].minX + sim.zones.hubRect[a].maxX) / 2;
      return (x0 - c) * (x1 - c) < 0;
    });
  }

  // ---- acting ---------------------------------------------------------------

  private act(sim: Simulation, p: PlayerRobot, dt: number): void {
    const input = this.input;
    const { robot, mech } = p;
    const a = robot.alliance;
    const zones = sim.zones;
    input.intake = this.task === 'collect' || this.task === 'outpost' || this.task === 'shoot';
    switch (this.task) {
      case 'collect': {
        const b = sim.balls.all[this.targetBall];
        if (!b || b.state !== 'field') {
          this.pickFuel(sim, p);
          if (this.targetBall < 0) return;
        }
        const ball = sim.balls.all[this.targetBall];
        this.target = [sim.balls.transforms[ball.id * 7], sim.balls.transforms[ball.id * 7 + 2]];
        this.goTo(sim, p, this.target, dt, true);
        // Spin up on the way, ready for a quick volley.
        input.shooterOn = mech.held > mech.capacity * 0.5;
        return;
      }
      case 'outpost': {
        const [ox, oz] = zones.outpost[a];
        const dir = a === 'red' ? 1 : -1;
        this.goTo(sim, p, [ox + dir * (robot.cfg.length / 2 + 0.35), oz], dt, false, a === 'red' ? Math.PI : 0);
        return;
      }
      case 'shoot': {
        input.shooterOn = true;
        const spot = this.shootSpot(sim, p);
        const [px, , pz] = robot.position;
        const inZone = polygonOverlapsRect(footprint(px, pz, robot.yaw, robot.cfg.length, robot.cfg.width), zones.alliance[a]);
        const far = Math.hypot(spot[0] - px, spot[1] - pz);
        // A fixed shooter aims with the whole robot.
        const turret = mech.turret;
        const fixed = turret.spec.turretLimit < 0.05;
        const face = fixed && turret.shot ? turret.shot.yaw - (turret.spec.facing ?? 0) : undefined;
        if (far > 0.5 || !inZone) this.goTo(sim, p, spot, dt, false, far < 2 ? face : undefined);
        else if (face !== undefined) this.turnTo(robot.yaw, face);
        const lit = sim.match.hubOn(a) || !this.skill.patient || sim.match.hubOnSoon(a, 1.2);
        const aimed = fixed ? Math.abs(wrapAngle((face ?? 0) - robot.yaw)) < 0.06 : turret.status === 'ready';
        input.transfer = inZone && lit && aimed && turret.status !== 'tooFar' && far < 2.5;
        return;
      }
      case 'climb': {
        input.intake = false;
        if (robot.hanging) {
          const auto = sim.match.period === 'auto';
          input.climb = auto ? robot.level < 1 : true;
          return;
        }
        const spot = sim.hangSpot(robot);
        if (spot) {
          input.climb = true;
          return;
        }
        const free = this.freeSpot(sim, p);
        if (!free) {
          this.task = 'collect';
          return;
        }
        this.goTo(sim, p, [free.x, free.z], dt, false, free.yaw);
        return;
      }
      case 'letGo': {
        // Push the stick to climb down and let go of the TOWER.
        input.ly = a === 'red' ? -1 : 1;
        input.fieldCentric = true;
        return;
      }
      case 'idle':
        return;
    }
  }

  /** Its HUB lights up within the time a shot takes to get there. */
  /** Where it shoots from: in its ALLIANCE ZONE, a couple of meters back from the HUB, on its own lane. */
  private shootSpot(sim: Simulation, p: PlayerRobot): [number, number] {
    const a = p.robot.alliance;
    const [hx, hz] = sim.zones.hub[a];
    const dir = a === 'red' ? 1 : -1;
    const [, , pz] = p.robot.position;
    const lane = [-1.6, 0, 1.6][slotStation(p.robot.slot) - 1] * dir;
    const z = Math.abs(pz - hz) < 2.6 ? Math.max(-2.4, Math.min(2.4, (pz + lane) / 2)) : lane;
    return [hx - dir * 2.3, z];
  }

  private turnTo(yaw: number, want: number): void {
    // rx > 0 turns clockwise (yaw down).
    this.input.rx = Math.max(-1, Math.min(1, -wrapAngle(want - yaw) * 2.2)) * this.skill.turn;
  }

  /**
   * Drives toward (x, z): across a HUB's line through a BUMP or (a robot low enough) under a
   * TRENCH, around robots and the HUBS. `face`: turn the intake the way it goes; or a yaw to turn to.
   */
  private goTo(sim: Simulation, p: PlayerRobot, to: [number, number], dt: number, faceMotion: boolean, faceYaw?: number): void {
    const { robot } = p;
    const zones = sim.zones;
    const [x, , z] = robot.position;
    let [tx, tz] = this.route(sim, p, to);
    let dx = tx - x;
    let dz = tz - z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.06) {
      if (faceYaw !== undefined) this.turnTo(robot.yaw, faceYaw);
      return;
    }
    dx /= dist;
    dz /= dist;
    // Steer clear of solid things nearby: the HUBS, TOWERS, the other robots.
    const push = (ox: number, oz: number, radius: number, k: number) => {
      const ex = x - ox, ez = z - oz;
      const d = Math.hypot(ex, ez);
      if (d > radius || d < 1e-3) return;
      const s = (k * (radius - d)) / radius;
      dx += (ex / d) * s;
      dz += (ez / d) * s;
    };
    const reach = Math.hypot(robot.cfg.length, robot.cfg.width) / 2;
    for (const a of ['red', 'blue'] as Alliance[]) {
      const [hx, hz] = zones.hub[a];
      if (!this.gate) push(hx, hz, 0.85 + reach, 1.6);
      if (this.task !== 'climb') {
        const t = zones.tower[a];
        push((t.minX + t.maxX) / 2, (t.minZ + t.maxZ) / 2, 0.6 + reach, 1.2);
      }
    }
    for (const o of sim.robots.values()) {
      if (o === p) continue;
      push(o.robot.position[0], o.robot.position[2], reach + Math.hypot(o.robot.cfg.length, o.robot.cfg.width) / 2 + 0.15, 1.1);
    }
    const n = Math.hypot(dx, dz) || 1;
    dx /= n;
    dz /= n;
    if (this.dodge > 0) {
      this.dodge -= dt;
      [dx, dz] = [-dz * this.dodgeDir - dx * 0.5, dx * this.dodgeDir - dz * 0.5];
    }
    const final = Math.hypot(to[0] - x, to[1] - z);
    const speed = this.skill.speed * Math.max(0.25, Math.min(1, final / 1.2));
    this.stick(robot.alliance, dx * speed, dz * speed);
    if (faceYaw !== undefined && final < 2) this.turnTo(robot.yaw, faceYaw);
    else if (faceMotion) this.turnTo(robot.yaw, Math.atan2(-dz, dx));
    // Stuck against something: back off to one side for a moment.
    const [vx, vz] = robot.velocity;
    const moving = Math.hypot(vx, vz);
    this.stuck = moving < Math.min(0.2, speed * 0.4) ? this.stuck + dt : Math.max(0, this.stuck - dt);
    if (this.stuck > 0.9) {
      this.stuck = 0;
      // A ball it keeps getting stuck on (wedged by a post or a wall): leave it for a while.
      if (this.task === 'collect' && this.targetBall >= 0 && ++this.stuckOn > 1) {
        this.skip.set(this.targetBall, this.steps + 20 * 120);
        this.stuckOn = 0;
      }
      this.dodge = 0.7;
      this.dodgeDir = Math.random() < 0.5 ? 1 : -1;
      this.gate = null;
    }
  }

  /** The next point on the way to `to`: through a gate in a HUB's line if it lies between. */
  private route(sim: Simulation, p: PlayerRobot, to: [number, number]): [number, number] {
    const [x, , z] = p.robot.position;
    const zones = sim.zones;
    const tall = p.robot.cfg.height > TRENCH.clearHeight - 0.01;
    for (const a of ['red', 'blue'] as Alliance[]) {
      const r: Rect = zones.hubRect[a];
      const lineX = (r.minX + r.maxX) / 2;
      const half = (r.maxX - r.minX) / 2 + LINE_MARGIN + p.robot.cfg.length / 2;
      const across = (x - lineX) * (to[0] - lineX) < 0 || (Math.abs(x - lineX) < half && Math.abs(to[0] - lineX) >= half);
      if (!across) continue;
      const dir = Math.sign(to[0] - lineX) || 1;
      if (!this.gate || this.gate.lineX !== lineX || this.gate.dir !== dir) {
        // The gates: the middle of each BUMP, and under each TRENCH for a low robot.
        const gates = zones.bumps.filter(b => b.minX < lineX && b.maxX > lineX).map(b => (b.minZ + b.maxZ) / 2);
        if (!tall) gates.push(...zones.trenches.filter(t => t.minX < lineX && t.maxX > lineX).map(t => (t.minZ + t.maxZ) / 2));
        const cost = (gz: number) => Math.abs(gz - z) + Math.abs(gz - to[1]) + (gates.length > 2 && Math.abs(gz) > 3 ? -0.4 : 0);
        gates.sort((g1, g2) => cost(g1) - cost(g2));
        this.gate = { z: gates[0], dir, lineX };
      }
      const g = this.gate;
      const before = lineX - dir * half;
      // Line up on the gate, then straight across.
      if (Math.abs(x - lineX) >= half - 0.05 && (x - lineX) * dir < 0 && Math.abs(z - g.z) > 0.25) return [before, g.z];
      return [lineX + dir * (half + 0.3), g.z];
    }
    this.gate = null;
    return to;
  }

  /** World velocity (share of full speed along x and z) as field-centric sticks from this alliance's drivers. */
  private stick(alliance: Alliance, vx: number, vz: number): void {
    const forward = alliance === 'red' ? vx : -vx;
    const right = alliance === 'red' ? vz : -vz;
    this.input.fieldCentric = true;
    this.input.ly = -forward;
    this.input.lx = right;
  }
}
