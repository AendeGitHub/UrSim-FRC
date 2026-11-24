// The whole REBUILT match without graphics: field physics, 504 FUEL, HUBS, six robots with their
// climbers, the match with its SHIFTS and the referee. Runs in the browser, for solo play, split
// screen and the admin of an online room.

import RAPIER from '@dimforge/rapier3d-compat';
import type { FieldLayout } from '../field/layout';
import { buildZones, footprint, polygonOverlapsRect, type Zones } from '../field/zones';
import { defaultStart, forAlliance, resolveStarts, startField, type StartField, type StartPose } from '../field/startPose';
import { BUMP, HUB, TOWER, TRENCH } from '../frc/field';
import { fieldCentric } from '../robot/mecanum';
import type { Alliance } from '../robot/robotConfig';
import { DEFAULT_ROBOT_ID, robotById } from '../robot/robots';
import { BALL_RESTITUTION, BallSim, type Ball } from './BallSim';
import type { ColliderPart } from './colliders';
import { HubSim } from './HubSim';
import { ENDGAME, Match, type MatchEvents } from './Match';
import { Mechanisms } from './Mechanisms';
import { RobotSim, type Pose } from './RobotSim';
import type { WorldState } from './state';
import { DEFAULT_RULES, type RuleOptions } from './Referee';
import { SLOTS, idleInput, mergeInput, slotAlliance, slotStation, type GameMode, type RobotInput, type Slot } from './types';

export const PHYSICS_DT = 1 / 120;
/** ALLIANCE WALLS stand tall; the guardrails along the sides are 20 in (manual 5.2) */
const WALL = { end: 2.0, side: 0.51, thickness: 0.08 };

/**
 * A PIN (G418): the pinned robot's driver pushes the sticks this far but it moves slower than
 * `stuck`, held within `against` of a wall or field element.
 */
const PIN = { trying: 0.3, stuck: 0.2, against: 0.04, foulEvery: 3, apart: 1.83, endAfterApart: 3 };
/**
 * A ball leaving a robot keeps only `keep` of its speed. Shots start inside their robot, so a ball
 * shot less than `shotClear` s ago is left alone.
 */
const ROBOT_HIT = { keep: 0.45, shotClear: 0.3 };
/** Robots that run into each other faster than this (closing speed) knock both turrets off aim, m/s */
const KNOCK_SPEED = 1.2;
/** A robot within this of a free hanging spot on its TOWER can start climbing, m */
const CLIMB_REACH = 0.8;
/** Where the uprights and their RUNGS stand, from the ALLIANCE WALL (measured in the field CAD), m */
const UPRIGHTS = TOWER.depth - 0.07;
/** A robot at the side of the TOWER grips this much of a RUNG's end, m */
const RUNG_GRIP = 0.12;

const box = (minX: number, maxX: number, minZ: number, maxZ: number) => ({ minX, maxX, minZ, maxZ });

export interface PlayerRobot {
  /** Which robot (robots.ts) this player drives */
  robotId: string;
  robot: RobotSim;
  mech: Mechanisms;
  input: RobotInput;
  name: string;
}

let rapierReady: Promise<void> | null = null;
/** Loads the physics engine (WASM) once. */
export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export class Simulation {
  readonly world: RAPIER.World;
  readonly zones: Zones;
  readonly balls: BallSim;
  readonly hubs: Record<Alliance, HubSim>;
  readonly match: Match;
  readonly robots = new Map<Slot, PlayerRobot>();
  /** The red side's limits for a start (G303) */
  readonly startField: StartField;
  private starts = new Map<Slot, Pose>();
  /** Simulated seconds since creation */
  time = 0;
  private rules: RuleOptions = { ...DEFAULT_RULES };
  /** Outlines of field elements a robot can be pinned against (G418) */
  private readonly obstacles: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  /** Each TOWER's collider, for G420 */
  private readonly towers: Partial<Record<Alliance, RAPIER.Collider>> = {};
  /** Robot pairs ("red1|blue1") touching at the last step */
  private readonly robotContact = new Set<string>();
  /** PIN counts keyed "pinner|pinned" */
  private readonly pins = new Map<string, { time: number; fouls: number; apart: number }>();
  /** 1 for each ball (by id) that touched a robot at the last step */
  private readonly onRobot: Uint8Array;
  /** 1 for each ball (by id) a robot presses against the wall or a field element */
  private readonly pressed: Uint8Array;

  /** Call initPhysics() first. */
  constructor(readonly layout: FieldLayout, colliders: ColliderPart[], events: MatchEvents) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;
    this.zones = buildZones(layout);
    this.startField = startField(this.zones);
    this.buildField(colliders);
    this.balls = new BallSim(this.world, layout);
    this.onRobot = new Uint8Array(this.balls.all.length);
    this.pressed = new Uint8Array(this.balls.all.length);
    this.hubs = { red: new HubSim('red', this.zones.hub.red, this.balls), blue: new HubSim('blue', this.zones.hub.blue, this.balls) };
    this.match = new Match(this.balls, this.hubs, () => [...this.robots.values()].map(p => p.robot), this.zones, events);
    this.reset();
  }

  private buildField(colliders: ColliderPart[]): void {
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const part of colliders) {
      // The CAD's BUMP mesh has holes in its ramps (robots stop at a step); they are rebuilt below.
      if (part.kind !== 'static' || part.name === 'bumps') continue;
      const collider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(part.vertices, part.indices).setFriction(0.5).setRestitution(0.3), ground);
      if (part.name === 'tower_red' || part.name === 'tower_blue') this.towers[part.name.slice(6) as Alliance] = collider;
      // Robots get pinned against the HUBS and TOWERS (BUMPS and TRENCHES they drive over or under).
      if (/^(hub|tower|depot)_/.test(part.name)) {
        const v = part.vertices;
        const b = box(Infinity, -Infinity, Infinity, -Infinity);
        for (let i = 0; i < v.length; i += 3) {
          b.minX = Math.min(b.minX, v[i]);
          b.maxX = Math.max(b.maxX, v[i]);
          b.minZ = Math.min(b.minZ, v[i + 2]);
          b.maxZ = Math.max(b.maxZ, v[i + 2]);
        }
        this.obstacles.push(b);
      }
    }
    // Carpet and the perimeter as simple boxes, so nothing slips through the thin CAD walls.
    const { halfX, halfZ } = this.zones;
    // The TRENCH arms: robots taller than 22.25 in can't drive under them (manual 5.6).
    for (const t of this.zones.trenches) {
      const h = (TRENCH.height - TRENCH.clearHeight) / 2;
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid((t.maxX - t.minX) / 2, h, (t.maxZ - t.minZ) / 2).setTranslation((t.minX + t.maxX) / 2, TRENCH.clearHeight + h, (t.minZ + t.maxZ) / 2).setFriction(0.3).setRestitution(0.3),
        ground,
      );
    }
    // BUMPS (manual 5.5): a ramp up from each side to a narrow crest, closed solids that robots and FUEL ride over.
    for (const b of this.zones.bumps) {
      const cx = (b.minX + b.maxX) / 2;
      const crest = 0.005;
      const pts: number[] = [];
      for (const z of [b.minZ, b.maxZ]) pts.push(b.minX, 0, z, b.maxX, 0, z, cx - crest, BUMP.height, z, cx + crest, BUMP.height, z);
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
      if (desc) this.world.createCollider(desc.setFriction(0.5).setRestitution(0.3), ground);
    }
    const t = WALL.thickness;
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(halfX + 2, 0.05, halfZ + 2).setTranslation(0, -0.05, 0).setFriction(0.9).setRestitution(BALL_RESTITUTION), ground);
    for (const s of [1, -1]) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(t / 2, WALL.end / 2, halfZ + t).setTranslation(s * (halfX + t / 2), WALL.end / 2, 0).setFriction(0.2).setRestitution(0.4), ground);
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(halfX + t, WALL.side / 2, t / 2).setTranslation(0, WALL.side / 2, s * (halfZ + t / 2)).setFriction(0.2).setRestitution(0.4), ground);
    }
  }

  /** Where a robot starts: picked by its driver (setStarts), or its driver station's usual spot on the ROBOT STARTING LINE. */
  startPose(slot: Slot, robotLength: number): Pose {
    return this.starts.get(slot) ?? forAlliance(defaultStart(slotStation(slot), robotLength, this.startField), slotAlliance(slot));
  }

  /**
   * Drivers' own starts (red side, manual G303) for the robots on the field; a robot without one,
   * or with one that G303 doesn't allow there, starts in a free default spot.
   */
  setStarts(picked: Partial<Record<Slot, StartPose | null>>): void {
    this.starts = resolveStarts([...this.robots].map(([slot, p]) => ({ slot, cfg: p.robot.cfg, start: picked[slot] })), this.startField);
    for (const [slot, p] of this.robots) p.robot.setPose(this.startPose(slot, p.robot.cfg.length));
  }

  addRobot(slot: Slot, name: string, robotId: string = DEFAULT_ROBOT_ID): PlayerRobot {
    this.removeRobot(slot);
    const def = robotById(robotId);
    const robot = new RobotSim(this.world, slot, def.config, this.startPose(slot, def.config.length), def.climber);
    const [hx, hz] = this.zones.hub[robot.alliance];
    const target: [number, number, number] = [hx, HUB.height + 0.08, hz];
    const mech = new Mechanisms(robot, this.balls, () => target, def);
    mech.reset(this.balls.preloads(slot));
    mech.onShot = b => this.judgeShot(robot, b);
    robot.battery.enabled = this.rules.battery;
    mech.movingShots = this.rules.movingShots;
    const player = { robotId: def.id, robot, mech, input: idleInput(), name };
    this.robots.set(slot, player);
    return player;
  }

  removeRobot(slot: Slot): void {
    const p = this.robots.get(slot);
    if (!p) return;
    p.mech.dropAll();
    p.robot.remove();
    this.robots.delete(slot);
  }

  /** Field, balls, HUBS and robots back to the match start. */
  reset(): void {
    this.balls.reset();
    this.hubs.red.reset();
    this.hubs.blue.reset();
    this.robotContact.clear();
    this.pins.clear();
    for (const [slot, p] of this.robots) {
      p.robot.setPose(this.startPose(slot, p.robot.cfg.length));
      p.robot.battery.reset();
      p.mech.reset(this.balls.preloads(slot));
      p.input = idleInput();
    }
    // Pre-loads of empty driver stations wait in the NEUTRAL ZONE's ends (manual 6.3.4: unused ones are staged there).
    let spare = 0;
    for (const slot of SLOTS) {
      if (this.robots.has(slot)) continue;
      for (const b of this.balls.preloads(slot)) {
        const k = spare++;
        const side = k % 2 ? 1 : -1;
        const i = Math.floor(k / 2);
        this.balls.release(b, [((i % 4) - 1.5) * 0.16, b.radius, side * (3.0 + Math.floor(i / 4) * 0.16)], [0, 0, 0]);
        b.body.sleep();
      }
    }
  }

  /** House rules: the referee's fouls and cards, the battery, shooting on the move. */
  setRules(rules: RuleOptions): void {
    this.rules = { ...rules };
    this.match.referee.options = { ...rules };
    for (const p of this.robots.values()) {
      p.robot.battery.enabled = rules.battery;
      p.mech.movingShots = rules.movingShots;
    }
  }

  /** The house rules in play (the AI drives by them too). */
  get ruleOptions(): Readonly<RuleOptions> {
    return this.rules;
  }

  start(mode: GameMode): void {
    this.reset();
    this.match.start(mode === 'match' ? 'auto' : 'practice');
  }

  setInput(slot: Slot, input: RobotInput): void {
    const p = this.robots.get(slot);
    if (p) p.input = mergeInput(p.input, input);
  }

  /**
   * The hanging spots on `robot`'s TOWER: in front of the RUNGS facing the wall, and at either end
   * of them, along the field; `taken` by another robot hanging there.
   */
  hangSpots(robot: RobotSim): { pose: Pose; taken: boolean }[] {
    const a = robot.alliance;
    const t = this.zones.tower[a];
    const dir = a === 'red' ? 1 : -1;
    const rungX = (a === 'red' ? -this.zones.halfX : this.zones.halfX) + dir * UPRIGHTS;
    const cz = (t.minZ + t.maxZ) / 2;
    const half = (t.maxZ - t.minZ) / 2;
    const { length, width } = robot.cfg;
    const facingWall = a === 'red' ? Math.PI : 0;
    const spots: Pose[] = [
      { x: rungX + dir * (length / 2 + 0.02), z: cz, yaw: facingWall },
      ...[-1, 1].map(side => ({ x: rungX, z: cz + side * (half + width / 2 - RUNG_GRIP), yaw: facingWall + Math.PI / 2 })),
    ];
    return spots.map(pose => ({
      pose,
      taken: [...this.robots.values()].some(p => p.robot !== robot && p.robot.hanging && Math.hypot(p.robot.position[0] - pose.x, p.robot.position[2] - pose.z) < 0.5),
    }));
  }

  /** The free hanging spot on `robot`'s TOWER nearest it, if it is close enough to start climbing. */
  hangSpot(robot: RobotSim): Pose | null {
    const [px, , pz] = robot.position;
    let best: Pose | null = null;
    let bestD = CLIMB_REACH;
    for (const { pose, taken } of this.hangSpots(robot)) {
      const d = Math.hypot(px - pose.x, pz - pose.z);
      if (!taken && d < bestD) {
        best = pose;
        bestD = d;
      }
    }
    return best;
  }

  /** One fixed physics step. */
  step(): void {
    const dt = PHYSICS_DT;
    const enabled = this.match.robotEnabled;
    for (const p of this.robots.values()) {
      const { robot, mech, input } = p;
      const stick = Math.hypot(input.lx, input.ly);
      const climbing = enabled && robot.stepClimb(input.climb, stick, robot.hanging || input.climb ? this.hangSpot(robot) : null, dt);
      if (climbing) {
        // The climber has it: no driving.
      } else if (enabled) {
        if (input.imuReset) robot.resetImu();
        let forward = -input.ly;
        let strafe = input.lx;
        if (input.fieldCentric) ({ forward, strafe } = fieldCentric(forward, strafe, robot.heading));
        robot.drive(forward, strafe, input.rx, dt);
      } else if (!robot.hanging) {
        robot.drive(0, 0, 0, dt);
      }
      mech.step(dt, input, enabled);
      const { fl, fr, bl, br } = robot.powers;
      robot.battery.step(dt, mech.flywheel, (Math.abs(fl) + Math.abs(fr) + Math.abs(bl) + Math.abs(br)) / 4 + (climbing && input.climb ? 0.8 : 0));
      input.shooterOn = input.shooterOff = input.imuReset = false;
    }
    this.balls.step(dt);
    this.match.step(dt);
    // How fast the robots were going into the step is how hard they hit each other in it.
    const before = this.robots.size > 1 ? new Map([...this.robots].map(([slot, p]) => [slot, p.robot.velocity])) : null;
    this.world.step();
    this.balls.sync();
    this.hubs.red.step(dt);
    this.hubs.blue.step(dt);
    if (before) this.knockTurrets(before);
    this.softenRobotHits();
    this.judgeContacts(dt);
    this.time += dt;
  }

  /** G407: a ball launched with the robot's bumpers fully outside its ALLIANCE ZONE. AUTO's shots score as AUTO's. */
  private judgeShot(robot: RobotSim, b: Ball): void {
    if (b.launch) b.launch.auto = this.match.period === 'auto';
    if (!this.match.judging) return;
    if (!polygonOverlapsRect(this.outline(robot), this.zones.alliance[robot.alliance])) this.match.referee.shotOutsideZone(robot.slot, this.time);
  }

  private outline(r: RobotSim): [number, number][] {
    const [x, , z] = r.position;
    return footprint(x, z, r.yaw, r.cfg.length, r.cfg.width);
  }

  private touching(a: RAPIER.Collider, b: RAPIER.Collider): boolean {
    let contact = false;
    this.world.contactPair(a, b, manifold => {
      if (manifold.numContacts() > 0) contact = true;
    });
    return contact;
  }

  /** Direction a contact pushes from `a` onto `b` (world space), or null if they don't touch. */
  private contactNormal(a: RAPIER.Collider, b: RAPIER.Collider): RAPIER.Vector | null {
    let normal: RAPIER.Vector | null = null;
    this.world.contactPair(a, b, (manifold, flipped) => {
      if (manifold.numContacts() === 0) return;
      const n = manifold.normal();
      normal = flipped ? { x: -n.x, y: -n.y, z: -n.z } : n;
    });
    return normal;
  }

  /**
   * A robot pressing a ball against the wall or a field element: the light ball would give way to
   * the heavy robot and squeeze through the wall. Squeezed like that a real ball stops the robot, so
   * the ball becomes something robots can't push (a higher dominance group) until no robot touches it.
   */
  private pressedAgainstField(b: Ball, push: RAPIER.Vector): boolean {
    let pressed = false;
    this.world.contactPairsWith(b.collider, other => {
      const body = other.parent();
      if (pressed || !body || !(body.isFixed() || body.isKinematic())) return;
      const n = this.contactNormal(b.collider, other);
      if (n && Math.abs(n.y) < 0.7 && n.x * push.x + n.y * push.y + n.z * push.z > 0.5) pressed = true;
    });
    return pressed;
  }

  /**
   * Bumpers and foam soak up a hit: a ball pushed or struck by a robot rolls off slowly
   * instead of shooting across the field. It loses the speed as it leaves the robot, so the robot
   * can still push it along.
   */
  private softenRobotHits(): void {
    const robots = [...this.robots.values()].map(({ robot }) => {
      const [x, , z] = robot.position;
      return { robot, x, z, reach: Math.hypot(robot.cfg.length, robot.cfg.width) / 2 };
    });
    for (const b of this.balls.all) {
      let touching = false;
      if (b.state === 'field' && !b.body.isSleeping() && !(b.launch?.kind === 'shot' && b.launch.age < ROBOT_HIT.shotClear)) {
        const [x, , z] = this.balls.position(b);
        for (const { robot, x: rx, z: rz, reach } of robots) {
          if (Math.hypot(x - rx, z - rz) > reach + b.radius + 0.02) continue;
          const push = this.contactNormal(robot.collider, b.collider);
          if (!push) continue;
          touching = true;
          if (!this.pressed[b.id] && this.pressedAgainstField(b, push)) {
            this.pressed[b.id] = 1;
            b.body.setDominanceGroup(1);
          }
          if (this.pressed[b.id]) {
            // Pushed back out of the wall it just rests there: it must not shove the robot away.
            const v = b.body.linvel();
            const back = v.x * push.x + v.y * push.y + v.z * push.z;
            if (back < 0) b.body.setLinvel({ x: v.x - back * push.x, y: v.y - back * push.y, z: v.z - back * push.z }, true);
          }
        }
      }
      if (this.pressed[b.id] && !touching) {
        this.pressed[b.id] = 0;
        b.body.setDominanceGroup(0);
      }
      if (this.onRobot[b.id] && !touching && b.state === 'field') {
        const v = b.body.linvel();
        const w = b.body.angvel();
        const k = ROBOT_HIT.keep;
        b.body.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
        // Its spin too, or the floor would turn the spin back into speed.
        b.body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
      }
      this.onRobot[b.id] = touching ? 1 : 0;
    }
  }

  /** Robots near each other, or near a field element (a cheap test before asking Rapier). */
  private near(r: RobotSim, other: RobotSim | { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
    const [x, , z] = r.position;
    const reach = Math.hypot(r.cfg.length, r.cfg.width) / 2 + 0.05;
    if (other instanceof RobotSim) {
      const [ox, , oz] = other.position;
      return Math.hypot(x - ox, z - oz) < reach + Math.hypot(other.cfg.length, other.cfg.width) / 2;
    }
    return x > other.minX - reach && x < other.maxX + reach && z > other.minZ - reach && z < other.maxZ + reach;
  }

  /** Defence: two robots that run into each other hard knock each other's turrets off their aim. */
  private knockTurrets(before: Map<Slot, [number, number]>): void {
    const players = [...this.robots.values()];
    players.forEach((a, i) => {
      for (const b of players.slice(i + 1)) {
        const key = `${a.robot.slot}|${b.robot.slot}`;
        const contact = this.near(a.robot, b.robot) && this.touching(a.robot.collider, b.robot.collider);
        if (contact && !this.robotContact.has(key)) {
          const [ax, , az] = a.robot.position;
          const [bx, , bz] = b.robot.position;
          const [avx, avz] = before.get(a.robot.slot)!;
          const [bvx, bvz] = before.get(b.robot.slot)!;
          // Speed along the line between them: a glancing scrape doesn't count.
          const closing = ((avx - bvx) * (bx - ax) + (avz - bvz) * (bz - az)) / Math.max(1e-6, Math.hypot(bx - ax, bz - az));
          if (closing > KNOCK_SPEED) {
            a.mech.knock();
            b.mech.knock();
          }
        }
        if (contact) this.robotContact.add(key);
        else this.robotContact.delete(key);
      }
    });
  }

  /** Whether a robot is completely across the CENTER LINE, on the other alliance's side (G403). */
  private acrossCenterLine(r: RobotSim): boolean {
    return this.outline(r).every(([x]) => (r.alliance === 'red' ? x > 0 : x < 0));
  }

  /** Rules about contact: G403 (AUTO across the CENTER LINE), G418 (PINS), G420 (TOWER protection). */
  private judgeContacts(dt: number): void {
    const match = this.match;
    const players = [...this.robots.values()];
    if (!match.judging) {
      this.pins.clear();
      return;
    }
    if (match.period === 'auto') for (const p of players) if (this.acrossCenterLine(p.robot)) match.referee.acrossCenterLine(p.robot.slot, false);
    const endgame = match.teleopLeft <= ENDGAME;
    for (const a of players) {
      for (const b of players) {
        if (a.robot.alliance !== 'red' || b.robot.alliance !== 'blue') continue;
        const contact = this.near(a.robot, b.robot) && this.touching(a.robot.collider, b.robot.collider);
        // One more MAJOR FOUL per instance of contact while across in AUTO.
        const key = `auto|${a.robot.slot}|${b.robot.slot}`;
        if (contact && match.period === 'auto' && !this.robotContact.has(key)) {
          for (const p of [a, b]) if (this.acrossCenterLine(p.robot)) match.referee.acrossCenterLine(p.robot.slot, true);
        }
        if (contact) this.robotContact.add(key);
        else this.robotContact.delete(key);
        if (endgame) {
          this.judgeTower(a, b, contact);
          this.judgeTower(b, a, contact);
        }
        this.judgePin(a, b, contact, dt);
        this.judgePin(b, a, contact, dt);
      }
    }
  }

  /** G420: `other` touching `climber`, which is in contact with its own TOWER, in the last 30 s. */
  private judgeTower(other: PlayerRobot, climber: PlayerRobot, contact: boolean): void {
    const r = climber.robot;
    const tower = this.towers[r.alliance];
    const onTower = r.hanging || (!!tower && this.touching(r.collider, tower));
    if (contact && onTower) this.match.referee.towerContact(other.robot.slot, r.slot, r.hanging);
    else if (!contact) this.match.referee.towerContactEnded(other.robot.slot, r.slot);
  }

  /** A robot right up against the perimeter wall or a field element. */
  private againstFieldElement(robot: RobotSim): boolean {
    const e = PIN.against;
    const { halfX, halfZ } = this.zones;
    return this.outline(robot).some(([cx, cz]) =>
      Math.abs(cx) > halfX - e || Math.abs(cz) > halfZ - e
      || this.obstacles.some(o => cx > o.minX - e && cx < o.maxX + e && cz > o.minZ - e && cz < o.maxZ + e));
  }

  /**
   * G418: `pinner` holds `pinned` against a field element while its driver tries to get away.
   * The count pauses when they separate and ends once they stay 72 in apart for 3 s.
   */
  private judgePin(pinner: PlayerRobot, pinned: PlayerRobot, contact: boolean, dt: number): void {
    const key = `${pinner.robot.slot}|${pinned.robot.slot}`;
    const { lx, ly, rx } = pinned.input;
    const held = contact
      && Math.hypot(lx, ly, rx) > PIN.trying
      && pinned.robot.speed < PIN.stuck
      && this.againstFieldElement(pinned.robot);
    const count = this.pins.get(key);
    if (held) {
      const c = count ?? { time: 0, fouls: 0, apart: 0 };
      c.time += dt;
      c.apart = 0;
      if (c.time > PIN.foulEvery * (c.fouls + 1)) {
        c.fouls++;
        this.match.referee.pin(pinner.robot.slot, c.fouls);
      }
      this.pins.set(key, c);
      return;
    }
    if (!count) return;
    const [ax, , az] = pinner.robot.position;
    const [bx, , bz] = pinned.robot.position;
    const gap = Math.hypot(ax - bx, az - bz) - (pinner.robot.cfg.length + pinned.robot.cfg.length) / 2;
    if (gap > PIN.apart) {
      count.apart += dt;
      if (count.apart > PIN.endAfterApart) this.pins.delete(key);
    }
  }

  /** Everything a renderer or a network snapshot needs. */
  state(): WorldState {
    const transforms = this.balls.transforms.slice();
    const states = new Uint8Array(this.balls.all.length);
    this.balls.all.forEach((b, i) => {
      states[i] = b.state === 'field' ? 0 : b.state === 'held' ? 1 : 2;
    });
    return {
      time: this.time,
      period: this.match.period,
      periodTime: this.match.time,
      hubs: { red: this.match.hubOn('red'), blue: this.match.hubOn('blue') },
      autoWinner: this.match.winnerOfAuto,
      score: { red: structuredClone(this.match.score.red), blue: structuredClone(this.match.score.blue) },
      robots: SLOTS.filter(s => this.robots.has(s)).map(slot => {
        const { robot, mech, robotId, input } = this.robots.get(slot)!;
        const [x, , z] = robot.position;
        return {
          slot,
          robot: robotId,
          x,
          y: robot.elevation,
          z,
          yaw: robot.yaw,
          heading: robot.heading,
          speed: robot.speed,
          turretYaw: mech.turretYaw,
          pitch: mech.shot?.pitch ?? 0.9,
          flywheel: mech.turret.flywheel,
          extraTurrets: mech.turrets.slice(1).map(t => ({ yaw: t.yaw, pitch: t.shot?.pitch ?? 0.9, flywheel: t.flywheel })),
          intakeDir: mech.intakeDir,
          transfer: input.transfer && this.match.robotEnabled,
          status: mech.status,
          shotSpeed: mech.shot?.speed ?? 0,
          shotDistance: mech.shot?.distance ?? 0,
          powers: { ...robot.powers },
          stored: mech.stored.map(b => b.id),
          voltage: robot.battery.voltage,
          minVoltage: robot.battery.minVoltage,
          climb: robot.climb,
          level: robot.level,
        };
      }),
      balls: { states, transforms },
    };
  }
}
