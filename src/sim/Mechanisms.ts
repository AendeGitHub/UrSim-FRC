// Intake (or one at each end) → hopper → transfer → flywheel shooters on auto-aiming turrets (or
// fixed ones the driver aims with the robot).

import type { Vec3 } from '../field/layout';
import { launchVelocity, solveShot, type ShotSolution, type ShotSpin } from '../game/ballistics';
import { wrapAngle } from '../robot/mecanum';
import { turretsOf, type RobotDefinition, type ShooterSpec } from '../robot/robots';
import { AIR_DAMPING, BALL_MASS, SPIN_DAMPING, type Ball, type BallSim } from './BallSim';
import type { RobotSim } from './RobotSim';


export const SHOOTER = {
  /** Ball exit speed at full flywheel speed, m/s */
  maxSpeed: 13,
  /** Lob arrives descending at this angle into the HUB's level opening */
  descent: (50 * Math.PI) / 180,
  /** Flywheel acceleration as fraction of max speed per second (velocity PID holds the target exactly) */
  spinUpRate: 2.5,
  spinDownRate: 0.7,
  /** Each shot slows the flywheel; it then recovers */
  shotDrop: 0.97,
  /**
   * The flywheel mass these rates are for, kg. A heavier one (ShooterSpec.flywheelMass) changes
   * speed that many times slower, but each shot also takes that many times less of its speed, so
   * it recovers in the same time.
   */
  flywheelMass: 0.6,
  turretRate: 6,
  aimTolerance: 0.035,
  /** A target this far past the turret's stop is not worth swinging round for yet, rad */
  unwindMargin: 0.2,
  /**
   * Out of its turn either way, the turret leaves the stop it went to for the other one only once
   * that is this much nearer the target, rad: near the robot, the target behind it swings a few
   * degrees each way as the turret's exit goes round.
   */
  stopMargin: 0.5,
};

/**
 * A robot slower than this (m/s, and turning slower than rad/s) stands still for a turret that can't
 * aim on the move (house rule `movingShots` off).
 */
const STILL = { speed: 0.05, turn: 0.1 };

/** Where the intake grabs balls (from its mouth) and how often, if the robot doesn't say. */
const INTAKE = { reach: 0.12, inside: 0.1, halfWidth: 0.3, maxHeight: 0.2, interval: 0.12 };

/** Seconds between balls a robot's front intake takes in. */
export const intakeInterval = (def: RobotDefinition): number => def.intakeInterval ?? INTAKE.interval;

/** How many times slower than the usual one a turret's flywheel changes speed (SHOOTER.flywheelMass). */
const heaviness = (spec: ShooterSpec): number => (spec.flywheelMass ?? SHOOTER.flywheelMass) / SHOOTER.flywheelMass;
/**
 * Where an intake takes balls: which way its mouth faces (1 forward, -1 back) and how far from the
 * footprint center it is (m), how wide and which balls, how often (s), and the time to the next one.
 */
interface Mouth {
  dir: 1 | -1;
  at: number;
  halfWidth: number;
  interval: number;
  timer: number;
}

const DEG = Math.PI / 180;

/**
 * Defence: a hard hit from another robot knocks the turrets off their aim for `duration` s. Shots
 * scatter `angle` more (standard deviation), so about 3 in 4 still score from the sweet spot.
 */
export const KNOCK = { duration: 2, angle: 4.8 * DEG };

/**
 * Shot scatter (standard deviations) at a given distance: tight inside the sweet spot,
 * growing quadratically to wide scatter at max range, and wider still with the turret knocked.
 */
export function shotSpread(distance: number, acc: Pick<ShooterSpec, 'sweetSpot' | 'maxRange'>, knocked = false): { angle: number; speed: number } {
  const t = Math.max(0, Math.min(1.3, (distance - acc.sweetSpot) / (acc.maxRange - acc.sweetSpot)));
  const k = t * t;
  // Even close in, no robot is perfect: a little scatter on every shot.
  const angle = 0.8 * DEG + k * 4.5 * DEG;
  return { angle: knocked ? Math.hypot(angle, KNOCK.angle) : angle, speed: 0.009 + k * 0.07 };
}

export type ShotRange = 'near' | 'mid' | 'far';

export function shotRange(distance: number, acc: Pick<ShooterSpec, 'sweetSpot' | 'maxRange'>): ShotRange {
  if (distance <= acc.sweetSpot) return 'near';
  return distance <= (acc.sweetSpot + acc.maxRange) / 2 ? 'mid' : 'far';
}
const EJECT = { speed: 2.2, interval: 0.12 };

export interface MechanismInput {
  intake: boolean;
  eject: boolean;
  shooterOn: boolean;
  shooterOff: boolean;
  transfer: boolean;
}

export type ShooterStatus = 'off' | 'spinning' | 'ready' | 'tooFar';

/** Gaussian noise (Box–Muller) so shots are not perfectly repeatable. */
function noise(sigma: number): number {
  return sigma * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

/** A turret with its flywheel. A robot may have several: each shoots its kind of ball, or any. */
export class Turret {
  /** Flywheel speed as a fraction of maximum */
  flywheel = 0;
  /** Turret angle relative to the robot, CCW positive, within spec.turretLimit of where it rests */
  yaw = 0;
  shot: ShotSolution | null = null;
  status: ShooterStatus = 'off';
  feedTimer = 0;
  /** The stop it went to with the target out of its turn either way (1 or -1), until it is back in reach; 0 none */
  stop = 0;

  constructor(readonly spec: ShooterSpec) {
    this.reset();
  }

  reset(): void {
    this.flywheel = 0;
    this.yaw = this.spec.facing ?? 0;
    this.shot = null;
    this.status = 'off';
    this.feedTimer = 0;
    this.stop = 0;
  }
}

export class Mechanisms {
  /** The hopper: front of the queue goes to the shooters next; the back is nearest the intake. */
  readonly stored: Ball[] = [];
  shooterOn = false;
  /** The main turret first */
  readonly turrets: Turret[];
  /** Balls the hopper holds */
  readonly capacity: number;
  /** The front intake, and the back one of a robot that has one */
  private readonly mouths: Mouth[];
  /** -1 ejecting, 0 idle, 1 intaking — for the roller animation */
  intakeDir = 0;
  /** Seconds the turrets stay knocked off their aim by a robot hit */
  knocked = 0;
  /** Shooting on the move (a house rule, RuleOptions.movingShots): off, turrets aim only with the robot still */
  movingShots = true;
  /** Extra shot scatter (standard deviation), rad: the AI below its best (ai/skill.ts) */
  aimError = 0;
  /** Called for every ball an intake picks up, with where it was (for the referee). */
  onPickup?: (ball: Ball, at: Vec3) => void;
  /** Called for every ball a shooter launches (G407). */
  onShot?: (ball: Ball) => void;
  private ejectTimer = 0;

  constructor(
    private readonly robot: RobotSim,
    private readonly balls: BallSim,
    private readonly target: () => Vec3,
    def: RobotDefinition,
  ) {
    this.turrets = turretsOf(def).map(t => new Turret(t.shooter));
    this.capacity = def.capacity;
    const front = def.intakeFront ?? def.config.length / 2;
    this.mouths = [{ dir: 1, at: front, halfWidth: def.intakeHalfWidth ?? INTAKE.halfWidth, interval: intakeInterval(def), timer: 0 }];
    const back = def.backIntake;
    if (back) this.mouths.push({ dir: -1, at: back.back, halfWidth: back.halfWidth, interval: back.interval, timer: 0 });
  }

  /** The main turret, as the HUD, the battery and the referee see the robot's shooter */
  get turret(): Turret {
    return this.turrets[0];
  }

  get turretYaw(): number {
    return this.turret.yaw;
  }

  get shot(): ShotSolution | null {
    return this.turret.shot;
  }

  get status(): ShooterStatus {
    return this.turret.status;
  }

  /** Flywheel load on the battery: every flywheel that is spinning */
  get flywheel(): number {
    return this.turrets.reduce((sum, t) => sum + t.flywheel, 0);
  }

  /** Balls the robot holds */
  get held(): number {
    return this.stored.length;
  }

  reset(preloads: Ball[]): void {
    this.stored.length = 0;
    for (const b of preloads) {
      this.balls.hold(b);
      this.stored.push(b);
    }
    this.shooterOn = false;
    for (const t of this.turrets) t.reset();
    this.knocked = 0;
  }

  /** Another robot hit this one hard (Simulation.knockTurrets). */
  knock(): void {
    this.knocked = KNOCK.duration;
  }

  /** Drops everything the robot holds where it stands (robot leaving the field). */
  dropAll(): void {
    const [px, , pz] = this.robot.position;
    this.stored.splice(0).forEach((b, i) => this.balls.release(b, [px + (i % 3 - 1) * 0.16, 0.2 + Math.floor(i / 3) * 0.16, pz], [0, 0, 0]));
  }

  /** World position where balls leave a turret's shooter. */
  launchPoint(turret = this.turret): Vec3 {
    const [px, , pz] = this.robot.position;
    const yaw = this.robot.yaw;
    const [fx, fz] = [Math.cos(yaw), -Math.sin(yaw)];
    const [rx, rz] = [Math.sin(yaw), Math.cos(yaw)];
    const [tf, tr] = turret.spec.at;
    const aim = yaw + turret.yaw;
    return [
      px + fx * tf + rx * tr + Math.cos(aim) * turret.spec.exit,
      turret.spec.height + this.robot.elevation,
      pz + fz * tf + rz * tr - Math.sin(aim) * turret.spec.exit,
    ];
  }

  step(dt: number, input: MechanismInput, enabled: boolean): void {
    this.knocked = Math.max(0, this.knocked - dt);
    if (!enabled) {
      // No powered movement between periods or after the match.
      this.shooterOn = false;
      this.intakeDir = 0;
      for (const t of this.turrets) {
        this.spinFlywheel(t, 0, dt);
        this.updateStatus(t, false);
      }
      return;
    }
    if (input.shooterOn) this.shooterOn = true;
    if (input.shooterOff) this.shooterOn = false;

    // The transfer runs the intakes too, so balls picked up while feeding go straight to the shooter.
    this.intakeDir = input.eject ? -1 : (input.intake || input.transfer) && !this.robot.hanging ? 1 : 0;
    if (this.intakeDir === 1) this.runIntake(dt);
    if (this.intakeDir === -1) this.runEject(dt);

    for (const t of this.turrets) {
      this.aim(t, dt);
      if (input.transfer) this.runTransfer(t, dt);
      else t.feedTimer = Math.min(t.feedTimer, 0);
    }
  }

  private runIntake(dt: number): void {
    for (const m of this.mouths) m.timer -= dt;
    if (this.held >= this.capacity) return;
    const [px, , pz] = this.robot.position;
    const yaw = this.robot.yaw;
    const [fx, fz] = [Math.cos(yaw), -Math.sin(yaw)];
    for (const m of this.mouths) {
      if (m.timer > 0 || this.held >= this.capacity) continue;
      for (const b of this.balls.all) {
        if (b.state !== 'field') continue;
        const o = b.id * 7;
        const dx = this.balls.transforms[o] - px;
        const dz = this.balls.transforms[o + 2] - pz;
        if (dx * dx + dz * dz > 2) continue;
        const y = this.balls.transforms[o + 1];
        // Out from the robot's center through the mouth, and across it.
        const out = (dx * fx + dz * fz) * m.dir;
        const across = dx * -fz + dz * fx;
        if (y < INTAKE.maxHeight && out > m.at - INTAKE.inside && out < m.at + INTAKE.reach && Math.abs(across) < m.halfWidth) {
          const at = this.balls.position(b);
          this.balls.hold(b);
          this.stored.push(b);
          m.timer = m.interval;
          this.onPickup?.(b, at);
          break;
        }
      }
    }
  }

  private runEject(dt: number): void {
    this.ejectTimer -= dt;
    if (this.ejectTimer > 0 || !this.stored.length) return;
    const b = this.stored.pop()!;
    const [px, , pz] = this.robot.position;
    const yaw = this.robot.yaw;
    const [fx, fz] = [Math.cos(yaw), -Math.sin(yaw)];
    const out = this.robot.cfg.length / 2 + b.radius + 0.04;
    const [vx, vz] = this.robot.velocity;
    this.balls.release(b, [px + fx * out, b.radius + 0.02, pz + fz * out], [vx + fx * EJECT.speed, 0, vz + fz * EJECT.speed]);
    b.launch = { by: this.robot.slot, kind: 'eject', age: 0, auto: false };
    this.ejectTimer = EJECT.interval;
  }

  /** How the turret's next ball will spin (ShooterSpec.spin), so the aim allows for its curve. */
  private shotSpin(turret: Turret): ShotSpin | undefined {
    if (!turret.spec.spin) return undefined;
    return { spin: turret.spec.spin, radius: 0.075, mass: BALL_MASS.fuel, damping: AIR_DAMPING, spinDamping: SPIN_DAMPING };
  }

  private aim(turret: Turret, dt: number): void {
    const launch = this.launchPoint(turret);
    // Without shooting on the move the turret aims only while the robot stands still, and the shot
    // doesn't allow for the robot's motion: fired on the move, it misses.
    const still = this.movingShots || (this.robot.speed < STILL.speed && Math.abs(this.robot.turnRate) < STILL.turn);
    const shot = solveShot(launch, this.target(), SHOOTER.descent, this.movingShots ? this.robot.velocity : [0, 0], this.shotSpin(turret));
    turret.shot = shot;
    // The turret cannot spin round and round (its wires would wind up): it turns at most
    // turretLimit either way from where it rests. It takes the short way to the target while that
    // stays within the limit, otherwise it unwinds the long way round.
    const limit = turret.spec.turretLimit;
    const rest = turret.spec.facing ?? 0;
    const target = wrapAngle(shot.yaw - this.robot.yaw);
    let desired = turret.yaw + wrapAngle(target - turret.yaw);
    const past = Math.abs(desired - rest) - limit;
    if (past > 0) {
      const side = Math.sign(desired - rest);
      const around = desired - side * 2 * Math.PI;
      // Just past the stop: wait there instead of swinging all the way round for a few degrees.
      if (past < SHOOTER.unwindMargin) desired = rest + side * limit;
      else if (Math.abs(around - rest) <= limit) desired = around;
      else {
        // Out of its turn either way (it turns less than half a turn each way): it waits at the
        // stop nearer the target, staying at (or on its way to) the one it picked unless the other
        // is clearly nearer. With the target right behind, both are about as near, and the target
        // shifts a little as the turret turns (its exit swings round): without keeping to its pick,
        // the turret would turn back and forth on the spot.
        const toHigh = Math.abs(wrapAngle(target - (rest + limit)));
        const toLow = Math.abs(wrapAngle(target - (rest - limit)));
        let stop = turret.stop;
        if (!stop) stop = turret.yaw > rest ? (toHigh <= toLow + SHOOTER.unwindMargin ? 1 : -1) : toHigh + SHOOTER.unwindMargin < toLow ? 1 : -1;
        else if (stop > 0 ? toLow + SHOOTER.stopMargin < toHigh : toHigh + SHOOTER.stopMargin < toLow) stop = -stop;
        turret.stop = stop;
        desired = rest + stop * limit;
      }
    }
    if (past <= 0) turret.stop = 0;
    const maxStep = still ? SHOOTER.turretRate * dt : 0;
    const step = Math.max(-maxStep, Math.min(maxStep, desired - turret.yaw));
    turret.yaw = Math.max(rest - limit, Math.min(rest + limit, turret.yaw + step));
    const err = wrapAngle(target - turret.yaw);

    // Auto speed: the flywheel targets exactly the speed this distance needs.
    const needed = shot.speed / SHOOTER.maxSpeed;
    this.spinFlywheel(turret, this.shooterOn ? Math.min(needed, 1) : 0, dt);
    this.updateStatus(turret, still && Math.abs(err) < SHOOTER.aimTolerance);
  }

  private spinFlywheel(turret: Turret, target: number, dt: number): void {
    const rate = ((target > turret.flywheel ? SHOOTER.spinUpRate : SHOOTER.spinDownRate) * dt) / heaviness(turret.spec);
    turret.flywheel += Math.max(-rate, Math.min(rate, target - turret.flywheel));
  }

  private updateStatus(turret: Turret, aimed: boolean): void {
    const { shot } = turret;
    if (!this.shooterOn) turret.status = 'off';
    else if (shot && shot.speed > SHOOTER.maxSpeed) turret.status = 'tooFar';
    else if (aimed && shot && Math.abs(turret.flywheel - shot.speed / SHOOTER.maxSpeed) < 0.02) turret.status = 'ready';
    else turret.status = 'spinning';
  }

  /** Feeds the turret the next ball, at its fire rate. */
  private runTransfer(turret: Turret, dt: number): void {
    turret.feedTimer -= dt;
    if (turret.feedTimer > 0 || !this.stored.length || !turret.shot) return;
    const b = this.stored.shift()!;
    const spread = shotSpread(turret.shot.distance, turret.spec, this.knocked > 0);
    const angle = Math.hypot(spread.angle, this.aimError);
    const yaw = this.robot.yaw + turret.yaw + noise(angle);
    const pitch = turret.shot.pitch + noise(angle);
    // A stopped flywheel just lets the ball drop out of the shooter.
    const speed = Math.max(0.6, turret.flywheel * SHOOTER.maxSpeed * (1 + noise(spread.speed)));
    const v = launchVelocity(yaw, pitch, speed);
    const [rvx, rvz] = this.robot.velocity;
    // The shooter's spin (frontspin: about the axis across its flight, its top turning forward).
    const w = (turret.spec.spin * speed) / b.radius;
    this.balls.release(b, this.launchPoint(turret), [v[0] + rvx, v[1], v[2] + rvz], [-Math.sin(yaw) * w, 0, -Math.cos(yaw) * w]);
    b.launch = { by: this.robot.slot, kind: 'shot', age: 0, auto: false };
    this.onShot?.(b);
    turret.flywheel *= 1 - (1 - SHOOTER.shotDrop) / heaviness(turret.spec);
    // Balls leave evenly spaced at the fire rate (the leftover fraction of a step carries over so
    // the spacing doesn't drift).
    turret.feedTimer = Math.max(turret.feedTimer, -dt) + 1 / turret.spec.fireRate;
  }
}
