// Robot rigid body, drivetrain controller (swerve, mecanum or tank) and the TOWER climber.

import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from '../field/layout';
import { chassisSpeeds, forwardVector, mecanumPowers, rightVector, swerveDrive, wrapAngle, type ChassisSpeeds, type WheelPowers } from '../robot/mecanum';
import type { Alliance, RobotConfig } from '../robot/robotConfig';
import type { ClimberSpec } from '../robot/robots';
import { Battery } from './Battery';
import { slotAlliance, type Slot } from './types';

export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

/** The frame's bottom off the carpet, m: FRC robots clear the BUMP's lip and the TOWER BASE */
const GROUND_CLEARANCE = 0.03;
/** Rounded edges let the robot ride up the BUMPS' 15° ramps instead of stopping at their foot, m */
const EDGE_RADIUS = 0.04;
/**
 * Bottom of the frame off the carpet while hanging at each TOWER level (manual 6.5.2): LEVEL 1 off
 * the carpet and the TOWER BASE, LEVEL 2 and 3 with the bumpers all above the LOW and MID RUNG.
 */
export const HANG_HEIGHT = [0, 0.1, 0.73, 1.19];
/** Of a level's climb, this much is done when it counts */
const LEVEL_DONE = 0.98;
/** Seconds to slide into the hanging spot before the climb starts */
const ALIGN_TIME = 0.6;
/** A robot that pushes the sticks this long while hanging climbs back down */
const LET_GO_AFTER = 0.25;

export class RobotSim {
  readonly body: RAPIER.RigidBody;
  /** Kept: body.collider(0) makes a new wrapper object on every call. */
  readonly collider: RAPIER.Collider;
  readonly alliance: Alliance;
  /** Yaw the simulated IMU reports as zero: away from the drivers at init, then wherever "reset heading" was pressed. */
  private imuZero = 0;
  powers: WheelPowers = { fl: 0, fr: 0, bl: 0, br: 0 };
  readonly battery = new Battery();

  /** Climb: 0 on the carpet; while hanging, how far up (levels: 1.5 is halfway to LEVEL 2) */
  climb = 0;
  /** The climb's starting pose and the hanging spot it slides to (align 0..1) */
  private hang: { from: Pose; to: Pose; align: number } | null = null;
  private pushing = 0;

  constructor(private readonly world: RAPIER.World, readonly slot: Slot, readonly cfg: RobotConfig, pose: Pose, readonly climber?: ClimberSpec) {
    this.alliance = slotAlliance(slot);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .enabledRotations(false, true, false) // robots this low and wide rarely tip; keeps driving stable
        // No CCD: at full speed a robot moves 2 cm per step, far less than its own size or a wall.
        .setCanSleep(false),
    );
    const bodyHeight = cfg.height - GROUND_CLEARANCE;
    const frame = cfg.frame ?? { length: cfg.length, offset: 0 };
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(frame.length / 2 - EDGE_RADIUS, bodyHeight / 2 - EDGE_RADIUS, cfg.width / 2 - EDGE_RADIUS, EDGE_RADIUS)
        .setTranslation(frame.offset, GROUND_CLEARANCE + bodyHeight / 2, 0)
        .setMass(cfg.mass)
        // Traction comes from the drive controller below, so the body itself slides freely.
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        // Bumpers soak up hits: nothing bounces off the robot.
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
      this.body,
    );
    this.setPose(pose);
  }

  remove(): void {
    this.world.removeRigidBody(this.body);
  }

  setPose(pose: Pose): void {
    this.letGo();
    this.body.setTranslation({ x: pose.x, y: 0.002 - GROUND_CLEARANCE, z: pose.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(pose.yaw / 2), z: 0, w: Math.cos(pose.yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    // The IMU starts with "forward" pointing away from the drivers, however the robot was put
    // down at the start (a turned start position), so field-centric driving matches the sticks.
    this.imuZero = this.alliance === 'red' ? 0 : Math.PI;
    this.powers = { fl: 0, fr: 0, bl: 0, br: 0 };
  }

  /** Hanging on the TOWER: the climber holds the robot off the carpet. */
  get hanging(): boolean {
    return this.hang !== null;
  }

  /** The TOWER level it has fully reached (0: none) */
  get level(): number {
    if (!this.hang || this.hang.align < 1) return 0;
    return Math.max(0, Math.floor(this.climb + 1 - LEVEL_DONE + 1e-6));
  }

  /** How high the frame's bottom is off the carpet, m */
  get liftHeight(): number {
    if (!this.hang) return 0;
    const lvl = Math.max(0, this.climb);
    const i = Math.min(HANG_HEIGHT.length - 2, Math.floor(lvl));
    return HANG_HEIGHT[i] + (HANG_HEIGHT[i + 1] - HANG_HEIGHT[i]) * Math.min(1, (lvl - i) / LEVEL_DONE);
  }

  /**
   * One step of the climber. `spot`: where it hangs on its TOWER if it is close enough to start,
   * else null. Climbs while `up` is held; pushing the sticks while hanging climbs back down and
   * lets go. Returns true while the climber has the robot (it doesn't drive).
   */
  stepClimb(up: boolean, stick: number, spot: Pose | null, dt: number): boolean {
    const c = this.climber;
    if (!c || c.levels <= 0) return false;
    if (!this.hang) {
      if (!up || !spot) return false;
      this.hang = { from: { x: this.position[0], z: this.position[2], yaw: this.yaw }, to: spot, align: 0 };
      this.climb = 0;
      this.pushing = 0;
      this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
    const h = this.hang;
    this.pushing = stick > 0.5 && !up ? this.pushing + dt : 0;
    if (h.align < 1) {
      h.align = Math.min(1, h.align + dt / ALIGN_TIME);
    } else if (up) {
      this.climb = Math.min(c.levels - 1 + LEVEL_DONE + 0.02, this.climb + dt / c.time);
    } else if (this.pushing > LET_GO_AFTER) {
      this.climb -= dt / (c.time * 0.6);
      if (this.climb < 0) {
        this.letGo();
        return false;
      }
    }
    const k = h.align * h.align * (3 - 2 * h.align);
    const x = h.from.x + (h.to.x - h.from.x) * k;
    const z = h.from.z + (h.to.z - h.from.z) * k;
    const yaw = h.from.yaw + wrapAngle(h.to.yaw - h.from.yaw) * k;
    this.body.setNextKinematicTranslation({ x, y: this.liftHeight - GROUND_CLEARANCE, z });
    this.body.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    this.powers = { fl: 0, fr: 0, bl: 0, br: 0 };
    return true;
  }

  /** Back on the carpet, driving. */
  private letGo(): void {
    if (!this.hang) return;
    this.hang = null;
    this.climb = 0;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    const t = this.body.translation();
    this.body.setTranslation({ x: t.x, y: 0.002 - GROUND_CLEARANCE, z: t.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  get yaw(): number {
    const q = this.body.rotation();
    return 2 * Math.atan2(q.y, q.w);
  }

  /** Heading as the robot's IMU would report it (CCW positive, radians). */
  get heading(): number {
    return wrapAngle(this.yaw - this.imuZero);
  }

  resetImu(): void {
    this.imuZero = this.yaw;
  }

  /** How high the robot's frame stands over where it would on flat carpet (a BUMP, the climber), m */
  get elevation(): number {
    return Math.max(0, this.body.translation().y + GROUND_CLEARANCE);
  }

  get position(): Vec3 {
    const t = this.body.translation();
    return [t.x, t.y, t.z];
  }

  get speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.z);
  }

  /** Horizontal velocity (x, z), m/s */
  get velocity(): [number, number] {
    const v = this.body.linvel();
    return [v.x, v.z];
  }

  /** How fast the robot turns, rad/s (counterclockwise positive, like its yaw) */
  get turnRate(): number {
    return this.body.angvel().y;
  }

  /** Called every physics step with stick inputs in -1..1 (turn > 0 = clockwise). */
  drive(forward: number, strafe: number, turn: number, dt: number): void {
    // Motors run at a speed proportional to the battery voltage.
    const drive = { ...this.cfg.drive, maxWheelSpeed: this.cfg.drive.maxWheelSpeed * this.battery.speedScale };
    let target: ChassisSpeeds;
    if (drive.type === 'swerve') {
      const swerve = swerveDrive(forward, strafe, turn, drive);
      this.powers = swerve.powers;
      target = swerve.speeds;
    } else {
      // A tank drive's wheels don't move it sideways.
      this.powers = mecanumPowers(forward, drive.type === 'tank' ? 0 : strafe, turn);
      target = chassisSpeeds(this.powers, drive);
    }
    const yaw = this.yaw;
    const [fx, fz] = forwardVector(yaw);
    const [rx, rz] = rightVector(yaw);
    const tx = target.forward * fx + target.right * rx;
    const tz = target.forward * fz + target.right * rz;

    // Move toward the commanded velocity, limited by traction. Contacts (walls, other robots)
    // are resolved by the physics step afterwards, so pushing against something stalls the robot.
    const v = this.body.linvel();
    let dx = tx - v.x;
    let dz = tz - v.z;
    const maxDv = this.cfg.maxAccel * dt;
    const dv = Math.hypot(dx, dz);
    if (dv > maxDv) {
      dx *= maxDv / dv;
      dz *= maxDv / dv;
    }
    // Up a BUMP's ramp the robot rises with it, but it doesn't fly off the top.
    this.body.setLinvel({ x: v.x + dx, y: Math.min(v.y, 1.6), z: v.z + dz }, true);

    const w = this.body.angvel().y;
    const maxDw = this.cfg.maxTurnAccel * dt;
    const dw = Math.max(-maxDw, Math.min(maxDw, -target.turnCw - w));
    this.body.setAngvel({ x: 0, y: w + dw, z: 0 }, true);
  }
}
