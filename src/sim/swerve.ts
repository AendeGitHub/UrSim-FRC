// Swerve drive kinematics: four modules that each steer and drive, so the robot moves any way
// while it turns. The simulation drives the chassis directly; the module angles and speeds are
// worked out for the picture and the HUD.

export interface ChassisSpeeds {
  /** Field velocity, m/s */
  vx: number;
  vz: number;
  /** Turn rate, rad/s, counterclockwise seen from above */
  omega: number;
}

export interface ModuleState {
  /** Wheel direction in the robot's frame, radians (0 = forward) */
  angle: number;
  /** Wheel speed, m/s */
  speed: number;
}

export interface DriveSpec {
  maxSpeed: number;
  maxOmega: number;
}

/**
 * Field-centric stick input (each -1..1) to chassis speeds. The two sticks together never ask
 * for more than full speed.
 */
export function fieldCentric(vx: number, vz: number, turn: number, spec: DriveSpec): ChassisSpeeds {
  const mag = Math.hypot(vx, vz);
  const k = mag > 1 ? 1 / mag : 1;
  return { vx: vx * k * spec.maxSpeed, vz: vz * k * spec.maxSpeed, omega: turn * spec.maxOmega };
}

/** Field velocity to the robot's own frame (forward, left) for a robot at `yaw`. */
export function toRobotFrame(vx: number, vz: number, yaw: number): [number, number] {
  // Robot forward is (cos yaw, -sin yaw) in (x, z); its left is (-sin yaw, -cos yaw).
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [vx * c - vz * s, -vx * s - vz * c];
}

/**
 * Module states for chassis speeds, modules at the corners of a square `track` m across, in
 * the order front-left, front-right, back-left, back-right. Speeds over `maxSpeed` are scaled
 * down together (desaturation), the way real swerve code does.
 */
export function moduleStates(speeds: ChassisSpeeds, yaw: number, track: number, maxSpeed: number): ModuleState[] {
  const [fwd, left] = toRobotFrame(speeds.vx, speeds.vz, yaw);
  const h = track / 2;
  const corners: [number, number][] = [[h, h], [h, -h], [-h, h], [-h, -h]];
  const states = corners.map(([px, py]) => {
    // Velocity of a point on a turning body: v + ω × r (2D, robot frame: x forward, y left)
    const mx = fwd - speeds.omega * py;
    const my = left + speeds.omega * px;
    return { angle: Math.atan2(my, mx), speed: Math.hypot(mx, my) };
  });
  const top = Math.max(...states.map(s => s.speed));
  if (top > maxSpeed) for (const s of states) s.speed *= maxSpeed / top;
  return states;
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
