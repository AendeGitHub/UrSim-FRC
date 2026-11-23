// All FUEL in a match: physics bodies and who holds them.
// The ball list is built the same way everywhere (ballSpecs), so ball ids match between
// the simulation and the renderer.

import RAPIER from '@dimforge/rapier3d-compat';
import { FUEL_RADIUS, type FieldLayout, type Vec3 } from '../field/layout';
import { fuelStarts } from '../frc/field';
import { magnusAccel } from '../game/ballistics';
import type { Alliance } from '../robot/robotConfig';
import { SLOTS, type Slot } from './types';

/** field: free physics body · held: inside a robot · staged: in an OUTPOST CHUTE · hub: falling through a HUB */
export type BallState = 'field' | 'held' | 'staged' | 'hub';
export type BallKind = 'fuel';

export interface BallSpec {
  kind: BallKind;
  radius: number;
  homeState: BallState;
  pos: Vec3;
  /** Robot slot whose pre-load this is */
  owner?: Slot;
  /** The alliance whose CHUTE (or DEPOT) it starts in */
  alliance?: Alliance;
}

export interface Ball extends BallSpec {
  readonly id: number;
  readonly body: RAPIER.RigidBody;
  /** Kept: body.collider(0) makes a new wrapper object on every call. */
  readonly collider: RAPIER.Collider;
  state: BallState;
  /** Which robot last shot or ejected it and how long ago (for scoring and the referee); null otherwise */
  launch: { by: Slot; kind: 'shot' | 'eject'; age: number; auto: boolean } | null;
}

/** Pre-loaded FUEL per robot (manual 6.3.4). */
export const PRELOAD = 8;

/** High density foam: 0.203–0.227 kg (manual 5.10.1). */
export const BALL_MASS: Record<BallKind, number> = { fuel: 0.215 };
/** Foam balls bounce a little off the carpet and the field, off each other a little more. */
export const BALL_RESTITUTION = 0.4;
const BALL_FRICTION = 0.7;
/** Balls fly almost freely but roll to a stop on the carpet. */
export const AIR_DAMPING = 0.03;
const FLOOR_DAMPING = 0.9;
/** How fast a ball's spin dies away, in the air as on the carpet, 1/s */
export const SPIN_DAMPING = 0.9;
/** Only a fast ball can jump through a thin wall in one step; slower balls go without CCD. */
const CCD_SPEED = 4;

export function ballSpecs(_layout?: FieldLayout): BallSpec[] {
  return fuelStarts().map(s => {
    const base = { kind: 'fuel' as const, radius: FUEL_RADIUS, pos: s.pos };
    switch (s.where) {
      case 'neutral':
        return { ...base, homeState: 'field' as const };
      case 'depot':
        return { ...base, homeState: 'field' as const, alliance: s.alliance };
      case 'chute':
        return { ...base, homeState: 'staged' as const, alliance: s.alliance };
      case 'preload':
        return { ...base, homeState: 'held' as const, owner: SLOTS[s.slot!] };
    }
  });
}

export class BallSim {
  readonly all: Ball[];
  /**
   * Every ball's position and rotation after the last physics step (x y z qx qy qz qw per ball).
   * Reading them from Rapier allocates on every call and most balls lie asleep, so the simulation
   * reads this copy, refreshed by sync().
   */
  readonly transforms: Float32Array;
  /** Balls that were awake at the last sync() */
  private readonly awake: Uint8Array;

  constructor(world: RAPIER.World, layout: FieldLayout) {
    this.all = ballSpecs(layout).map((spec, id) => {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(...spec.pos).setLinearDamping(AIR_DAMPING).setAngularDamping(SPIN_DAMPING),
      );
      const collider = world.createCollider(RAPIER.ColliderDesc.ball(spec.radius).setMass(BALL_MASS[spec.kind]).setRestitution(BALL_RESTITUTION).setFriction(BALL_FRICTION), body);
      return { ...spec, id, body, collider, state: spec.homeState, launch: null };
    });
    this.transforms = new Float32Array(this.all.length * 7);
    this.awake = new Uint8Array(this.all.length);
    this.reset();
  }

  /** Puts every ball back where the match starts. */
  reset(): void {
    for (const b of this.all) {
      b.state = b.homeState;
      b.launch = null;
      b.body.setEnabled(b.state === 'field');
      b.body.setTranslation({ x: b.pos[0], y: b.pos[1], z: b.pos[2] }, false);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
      if (b.state === 'field') b.body.sleep();
      this.store(b);
    }
  }

  /** Call after every physics step: refreshes the balls that moved (awake now or until now). */
  sync(): void {
    for (const b of this.all) {
      if (b.state !== 'field') continue;
      const sleeping = b.body.isSleeping();
      if (!sleeping || this.awake[b.id]) this.store(b);
      this.awake[b.id] = sleeping ? 0 : 1;
    }
  }

  private store(b: Ball): void {
    const t = b.body.translation();
    const r = b.body.rotation();
    this.transforms.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w], b.id * 7);
  }

  /** FUEL that start the match inside the robot in `slot`. */
  preloads(slot: Slot): Ball[] {
    return this.all.filter(b => b.owner === slot);
  }

  position(b: Ball): Vec3 {
    const o = b.id * 7;
    return [this.transforms[o], this.transforms[o + 1], this.transforms[o + 2]];
  }

  hold(b: Ball): void {
    const [x, y, z] = this.position(b);
    b.state = 'held';
    b.launch = null;
    b.body.setEnabled(false);
    // Resting balls sleep; wake the ones that leaned on this ball (a pile) so they fall.
    for (const o of this.all) {
      if (o.state !== 'field' || !o.body.isSleeping()) continue;
      const [ox, oy, oz] = this.position(o);
      if (Math.hypot(ox - x, oy - y, oz - z) < 0.35) o.body.wakeUp();
    }
  }

  /** Puts a ball into play at `pos` with velocity `vel`, spinning at `spin` (rad/s about each axis). */
  release(b: Ball, pos: Vec3, vel: Vec3, spin: Vec3 = [0, 0, 0]): void {
    b.state = 'field';
    b.launch = null;
    b.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    b.body.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
    b.body.setAngvel({ x: spin[0], y: spin[1], z: spin[2] }, true);
    b.body.enableCcd(Math.hypot(...vel) > CCD_SPEED);
    b.body.setEnabled(true);
    b.body.wakeUp();
    this.store(b);
    this.awake[b.id] = 1;
  }

  /** Takes a ball out of play without a robot holding it: into an OUTPOST CHUTE or a HUB. */
  stow(b: Ball, state: 'staged' | 'hub', pos: Vec3 = b.pos): void {
    b.state = state;
    b.body.setEnabled(false);
    b.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, false);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.store(b);
  }

  /**
   * Rolling resistance on the floor only, so it does not slow shots in the air; CCD only when fast.
   * A spinning ball in the air curves (Magnus): frontspin down, backspin up.
   */
  step(dt: number): void {
    for (const b of this.all) {
      if (b.launch) b.launch.age += dt;
      if (b.state !== 'field' || b.body.isSleeping()) continue;
      const onFloor = this.transforms[b.id * 7 + 1] < b.radius + 0.01;
      const damping = onFloor ? FLOOR_DAMPING : AIR_DAMPING;
      if (b.body.linearDamping() !== damping) b.body.setLinearDamping(damping);
      const v = b.body.linvel();
      const speed2 = v.x * v.x + v.y * v.y + v.z * v.z;
      const fast = speed2 > CCD_SPEED * CCD_SPEED;
      if (b.body.isCcdEnabled() !== fast) b.body.enableCcd(fast);
      if (!onFloor) this.magnus(b, v, Math.sqrt(speed2), dt);
    }
  }

  /** The Magnus force for one step: across the ball's path, along ω × v. */
  private magnus(b: Ball, v: RAPIER.Vector, speed: number, dt: number): void {
    const w = b.body.angvel();
    const [cx, cy, cz] = [w.y * v.z - w.z * v.y, w.z * v.x - w.x * v.z, w.x * v.y - w.y * v.x];
    // |ω × v| = (spin across the path) · speed
    const across = Math.hypot(cx, cy, cz);
    if (across < 1e-6) return;
    const mass = BALL_MASS[b.kind];
    const k = (mass * magnusAccel(speed, across / speed, b.radius, mass) * dt) / across;
    b.body.applyImpulse({ x: cx * k, y: cy * k, z: cz * k }, false);
  }
}
