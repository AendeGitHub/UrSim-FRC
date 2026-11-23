// One FRC robot: a swerve chassis, a full-width ground intake, a hopper, a shooter that aims at
// its own HUB, and a climber for the TOWER.

import RAPIER from '@dimforge/rapier3d-compat';
import { HALF_L, TOWER, hubCenter, intoField, towerCenter, HUB, type Vec3 } from '../game/field';
import type { RobotSpec } from '../game/robots';
import { slotAlliance, type Alliance, type RobotInput } from '../game/types';
import { solveShot } from './ballistics';
import { fieldCentric, moduleStates, wrapAngle, type ModuleState } from './swerve';

export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

/** Bottom of the bumpers off the carpet while hanging on each level (0 = on the carpet). */
export const HANG_HEIGHT = [0, 0.16, TOWER.rungs[0] + 0.08, TOWER.rungs[1] + 0.08];
/** Above this the robot counts as off the carpet at that level. */
const LEVEL_DONE = 0.98;
const CLEARANCE = 0.01;
/** The shooter turns the robot toward the HUB: proportional gain, rad/s per rad */
const AIM_GAIN = 7;
/** Fires only when the robot points this close to the HUB, rad */
const AIM_TOLERANCE = (4 * Math.PI) / 180;
/** Farthest shot the shooter can make, m */
export const MAX_RANGE = 7.5;
/** Top of the HUB opening the shooter aims at */
export const AIM_POINT_Y = HUB.height + 0.3;

export interface Shot {
  pos: Vec3;
  vel: Vec3;
}

export class Robot {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly alliance: Alliance;
  input: RobotInput = { vx: 0, vz: 0, turn: 0, intake: false, shoot: false, climb: false };
  /** FUEL ids in the hopper */
  readonly hopper: number[] = [];
  /** For the picture: each swerve module's angle and speed */
  modules: ModuleState[] = [0, 1, 2, 3].map(() => ({ angle: 0, speed: 0 }));
  /** Seconds until the intake can take the next FUEL */
  intakeWait = 0;
  /** Seconds until the shooter can fire again */
  private cooldown = 0;
  /** The intake is out and spinning (it can be toggled; bots keep it on) */
  intakeOn = true;
  /** Climb: 0 on the carpet; while hanging, how far up (levels, e.g. 1.5 = halfway to level 2) */
  climb = 0;
  /** The climb's starting pose and the hanging spot it slides to */
  private hang: { from: Pose; to: Pose; align: number } | null = null;
  /** Seconds the driver has asked to drive while hanging (lets go after a moment) */
  private letGo = 0;
  /** An opponent touched it on its TOWER in the last 30 s (G420): it scores LEVEL 3 */
  towerProtected = false;
  /** FUEL shot by this robot that scored points */
  scored = 0;
  /** Robot is lifted off the floor by the climber */
  get hanging(): boolean {
    return this.hang !== null;
  }
  /** The TOWER level it has fully reached (0 = none) */
  get level(): number {
    return this.hang && this.hang.align >= 1 ? Math.floor(this.climb + 1 - LEVEL_DONE + 1e-6) : 0;
  }
  /** Within reach of the shooter target and pointing at it (for the HUD) */
  aimed = false;
  /** Distance to the own HUB, m */
  hubDistance = 0;

  constructor(private readonly world: RAPIER.World, readonly slot: number, readonly spec: RobotSpec, pose: Pose) {
    this.alliance = slotAlliance(slot);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        // Swerve robots on carpet don't tip in this game; only the yaw turns.
        .enabledRotations(false, true, false)
        .setCanSleep(false),
    );
    const r = 0.04;
    const h = spec.height - CLEARANCE;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(spec.size / 2 - r, h / 2 - r, spec.size / 2 - r, r)
        .setTranslation(0, CLEARANCE + h / 2, 0)
        .setMass(spec.mass)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0.05)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
      this.body,
    );
    this.setPose(pose);
  }

  setPose(p: Pose): void {
    this.hang = null;
    this.climb = 0;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setTranslation({ x: p.x, y: 0.005, z: p.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.cooldown = 0;
  }

  get yaw(): number {
    const q = this.body.rotation();
    return 2 * Math.atan2(q.y, q.w);
  }

  get pose(): Pose {
    const t = this.body.translation();
    return { x: t.x, z: t.z, yaw: this.yaw };
  }

  get position(): Vec3 {
    const t = this.body.translation();
    return [t.x, t.y, t.z];
  }

  get velocity(): [number, number] {
    const v = this.body.linvel();
    return [v.x, v.z];
  }

  get forward(): [number, number] {
    const y = this.yaw;
    return [Math.cos(y), -Math.sin(y)];
  }

  /** The yaw that points the robot at its HUB */
  hubBearing(): number {
    const [hx, hz] = hubCenter(this.alliance);
    const t = this.body.translation();
    return Math.atan2(-(hz - t.z), hx - t.x);
  }

  /** Where the hanging robot ends up in front of its TOWER, and whether it is close enough to start. */
  towerSpot(): Pose {
    const [tx, tz] = towerCenter(this.alliance);
    const dir = intoField(this.alliance);
    // Bumpers just in front of the UPRIGHTS, facing the TOWER (the ALLIANCE WALL).
    return { x: tx + dir * (TOWER.depth / 2 + this.spec.size / 2 - 0.12), z: tz, yaw: dir > 0 ? Math.PI : 0 };
  }

  nearTower(): boolean {
    const s = this.towerSpot();
    const t = this.body.translation();
    return Math.abs(t.x - s.x) < 0.75 && Math.abs(t.z - s.z) < 0.7;
  }

  /**
   * One control step: drive (or climb), aim. Returns a shot when the shooter fires this step;
   * the world launches the ball. `canScore` is false while the HUB is off (bots hold fire, the
   * driver may still shoot).
   */
  control(dt: number): Shot | null {
    const inp = this.input;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.hang || (inp.climb && this.spec.climbMax > 0 && this.nearTower())) {
      this.doClimb(dt);
      return null;
    }
    const spec = this.spec;
    const want = fieldCentric(inp.vx, inp.vz, inp.turn, { maxSpeed: spec.maxSpeed, maxOmega: spec.maxOmega });
    const t = this.body.translation();
    const [hx, hz] = hubCenter(this.alliance);
    this.hubDistance = Math.hypot(hx - t.x, hz - t.z);
    const turret = spec.look === 'turret';
    const err = wrapAngle(this.hubBearing() - this.yaw);
    // Holding "shoot" turns the robot toward its HUB (a turret aims by itself).
    if (inp.shoot && !turret && this.hopper.length) {
      want.omega = Math.max(-spec.maxOmega, Math.min(spec.maxOmega, err * AIM_GAIN)) + want.omega * 0.25;
    }
    this.aimed = (turret || Math.abs(err) < AIM_TOLERANCE) && this.hubDistance < MAX_RANGE;
    this.applySpeeds(want.vx, want.vz, want.omega, dt);
    this.modules = moduleStates(want, this.yaw, spec.track, spec.maxSpeed);

    if (!inp.shoot || !this.aimed || !this.hopper.length || this.cooldown > 0) return null;
    this.cooldown = 1 / spec.fireRate;
    return this.makeShot();
  }

  private makeShot(): Shot {
    const spec = this.spec;
    const t = this.body.translation();
    const [fx, fz] = this.forward;
    const pos: Vec3 = [t.x + fx * 0.12, t.y + spec.height + 0.05, t.z + fz * 0.12];
    const [hx, hz] = hubCenter(this.alliance);
    const vel = solveShot(pos, [hx, AIM_POINT_Y, hz], this.velocity, spec.lead);
    // A fixed shooter fires where the robot points; a turret where it aims.
    const flat = Math.hypot(vel[0], vel[2]);
    let dir = spec.look === 'turret' ? Math.atan2(-vel[2], vel[0]) : this.yaw;
    if (spec.look !== 'turret') {
      // The robot points at the HUB itself; the shot keeps the lead for the robot's motion.
      const lead = Math.atan2(-vel[2], vel[0]) - this.hubBearing();
      dir += lead;
    }
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
    const moving = Math.hypot(...this.velocity) / spec.maxSpeed;
    dir += (gauss() * (spec.aimNoise + moving * 1.5) * Math.PI) / 180;
    const k = 1 + gauss() * (spec.spread + moving * 0.01);
    // The ball keeps the robot's own velocity.
    const [cx, cz] = this.velocity;
    return { pos, vel: [Math.cos(dir) * flat * k + cx, vel[1] * k, -Math.sin(dir) * flat * k + cz] };
  }

  private applySpeeds(vx: number, vz: number, omega: number, dt: number): void {
    const v = this.body.linvel();
    let dx = vx - v.x;
    let dz = vz - v.z;
    const max = this.spec.maxAccel * dt;
    const dv = Math.hypot(dx, dz);
    if (dv > max) {
      dx *= max / dv;
      dz *= max / dv;
    }
    this.body.setLinvel({ x: v.x + dx, y: Math.min(v.y, 1.5), z: v.z + dz }, true);
    const w = this.body.angvel().y;
    const maxW = this.spec.maxOmega * 3 * dt;
    this.body.setAngvel({ x: 0, y: w + Math.max(-maxW, Math.min(maxW, omega - w)), z: 0 }, true);
  }

  private doClimb(dt: number): void {
    const inp = this.input;
    if (!this.hang) {
      this.hang = { from: this.pose, to: this.towerSpot(), align: 0 };
      this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      this.climb = 0;
    }
    const h = this.hang;
    this.modules = this.modules.map(m => ({ angle: m.angle, speed: 0 }));
    if (h.align < 1) {
      h.align = Math.min(1, h.align + dt / 0.6);
    } else if (inp.climb) {
      this.climb = Math.min(this.spec.climbMax - 1 + LEVEL_DONE + 0.02, this.climb + dt / this.spec.climbTime);
    }
    // Pushing the drive stick while hanging climbs back down and lets go.
    const pushing = Math.hypot(inp.vx, inp.vz) > 0.5 && !inp.climb;
    this.letGo = pushing ? this.letGo + dt : 0;
    if (this.letGo > 0.3) {
      this.climb = Math.max(-0.01, this.climb - dt / (this.spec.climbTime * 0.6));
      if (this.climb < 0) {
        const p = this.pose;
        const dir = intoField(this.alliance);
        this.setPose({ x: p.x + dir * 0.05, z: p.z, yaw: p.yaw });
        this.letGo = 0;
        return;
      }
    }
    const e = h.align * h.align * (3 - 2 * h.align);
    const x = h.from.x + (h.to.x - h.from.x) * e;
    const z = h.from.z + (h.to.z - h.from.z) * e;
    const yaw = h.from.yaw + wrapAngle(h.to.yaw - h.from.yaw) * e;
    const lvl = Math.max(0, this.climb);
    const i = Math.min(2, Math.floor(lvl));
    const y = HANG_HEIGHT[i] + (HANG_HEIGHT[i + 1] - HANG_HEIGHT[i]) * Math.min(1, (lvl - i) / LEVEL_DONE);
    this.body.setNextKinematicTranslation({ x, y: y + 0.005, z });
    this.body.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
  }

  /** Whether the robot is inside the field and on its wheels (sanity checks for tests). */
  get onField(): boolean {
    const t = this.body.translation();
    return Math.abs(t.x) < HALF_L + 0.5 && t.y > -0.5;
  }

  remove(): void {
    this.world.removeRigidBody(this.body);
  }
}
