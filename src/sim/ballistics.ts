// How a shooter aims FUEL at the HUB: the launch velocity for a ball to drop into the opening.

import type { Vec3 } from '../game/field';

export const G = 9.81;

/**
 * Flight time for a shot of horizontal distance `d` (m): long enough that the ball comes down
 * into the opening (a lob), short enough to stay in a believable launch speed.
 */
export const flightTime = (d: number): number => 0.62 + 0.085 * d;

/**
 * The launch velocity from `from` to land at `to` after flightTime(); `carry` is the robot's own
 * velocity (x, z), which the ball keeps, so a moving shooter subtracts it (`lead` 0..1: how much).
 */
export function solveShot(from: Vec3, to: Vec3, carry: [number, number] = [0, 0], lead = 1): Vec3 {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const d = Math.hypot(dx, dz);
  const t = flightTime(d);
  const dy = to[1] - from[1];
  return [dx / t - carry[0] * lead, (dy + 0.5 * G * t * t) / t, dz / t - carry[1] * lead];
}

/** Where a ball launched at `p` with `v` is after `t` s (no drag). */
export function ballAt(p: Vec3, v: Vec3, t: number): Vec3 {
  return [p[0] + v[0] * t, p[1] + v[1] * t - 0.5 * G * t * t, p[2] + v[2] * t];
}

/** Launch speed and elevation (degrees) of a velocity, for the HUD and the hood picture. */
export function launchAngles(v: Vec3): { speed: number; pitch: number } {
  const flat = Math.hypot(v[0], v[2]);
  return { speed: Math.hypot(flat, v[1]), pitch: (Math.atan2(v[1], flat) * 180) / Math.PI };
}
