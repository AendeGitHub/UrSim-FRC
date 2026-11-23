// The whole REBUILT match without graphics: field physics, 504 FUEL, six robots, HUB scoring,
// the OUTPOST human player and the match clock. The picture (view/) only reads from here.

import RAPIER from '@dimforge/rapier3d-compat';
import {
  ALLIANCE_ZONE, BUMP, DEPOT, FIELD, FUEL, HALF_L, HALF_W, HUB, RED, TOWER, TRENCH,
  fuelStarts, intoField, place, rng, type FuelStart, type Vec2, type Vec3,
} from '../game/field';
import { robotById } from '../game/robots';
import {
  AUTO_LENGTH, MATCH_LENGTH, POINTS, SCORE_GRACE, autoTowerPoints, autoWinner, emptyScore, hubActive, periodAt,
  towerPoints, type AllianceScore, type PeriodId,
} from '../game/rules';
import { ALLIANCES, other, slotAlliance, slotStation, type Alliance } from '../game/types';
import { Robot, type Pose } from './Robot';

export const PHYSICS_DT = 1 / 120;

export type FuelState = 'field' | 'held' | 'hub' | 'chute';

export interface Fuel {
  id: number;
  start: FuelStart;
  body: RAPIER.RigidBody;
  state: FuelState;
  /** Match time it was shot, or -1 */
  shotAt: number;
  /** The robot slot that shot it last */
  shotBy: number;
  /** While in a HUB: seconds until the HUB lets it out again, and which HUB */
  hubTimer: number;
  hub: Alliance | null;
}

export interface MatchEvent {
  type: 'score' | 'wasted' | 'period' | 'autoWinner' | 'end' | 'foul';
  /** The rule broken (foul) */
  rule?: 'G403' | 'G407' | 'G420';
  alliance?: Alliance;
  period?: PeriodId;
  slot?: number;
}

export interface WorldOptions {
  /** Practice: no clock, both HUBS always on */
  practice?: boolean;
  seed?: number;
}

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/** A ball dropped into a HUB comes back out of one of its four exits after this long, s */
const HUB_PASS_TIME = 0.7;
/** The OUTPOST human player rolls one FUEL out every so often while a robot waits at the CORRAL */
const OUTPOST_FEED_EVERY = 0.45;
/** FUEL an intake can swallow per second (the rollers and the hopper's funnel) */
const INTAKE_RATE = 7;

export class World {
  readonly world: RAPIER.World;
  readonly fuel: Fuel[];
  /** x y z qx qy qz qw for each FUEL, refreshed after every step */
  readonly transforms: Float32Array;
  readonly robots: Robot[] = [];
  readonly score: Record<Alliance, AllianceScore> = { red: emptyScore(), blue: emptyScore() };
  /** FUEL left in each OUTPOST CHUTE */
  readonly chute: Record<Alliance, number[]> = { red: [], blue: [] };
  /** Seconds since the match started (stops at the end) */
  time = 0;
  running = false;
  ended = false;
  winnerOfAuto: Alliance | null = null;
  /** TOWER levels at the end of AUTO, per slot (for the 15 point AUTO TOWER bonus) */
  private autoLevels: number[] | null = null;
  private lastPeriod: PeriodId = 'auto';
  private feedTimer: Record<Alliance, number> = { red: 0, blue: 0 };
  private readonly awake: Uint8Array;
  private exitTurn = 0;
  /** When each robot last got a foul for a rule, by "slot|rule" (one foul per instance) */
  private readonly lastFoul = new Map<string, number>();
  /** Fouls per alliance (against it) in this match */
  readonly fouls: Record<Alliance, number> = { red: 0, blue: 0 };
  private foulCheck = 0;
  private readonly rand: () => number;
  onEvent: (e: MatchEvent) => void = () => {};

  constructor(readonly options: WorldOptions = {}) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;
    this.rand = rng((options.seed ?? 7) * 31 + 1);
    this.buildField();
    const starts = fuelStarts(options.seed ?? 2026);
    this.fuel = starts.map((start, id) => {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(...start.pos).setLinearDamping(0.05).setAngularDamping(0.8).setCcdEnabled(false),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.ball(FUEL.radius).setMass(FUEL.mass).setRestitution(0.35).setFriction(0.7),
        body,
      );
      return { id, start, body, state: 'field' as FuelState, shotAt: -1, shotBy: -1, hubTimer: 0, hub: null };
    });
    this.transforms = new Float32Array(this.fuel.length * 7);
    this.awake = new Uint8Array(this.fuel.length);
  }

  get practice(): boolean {
    return !!this.options.practice;
  }

  // ---------------------------------------------------------------- field

  private fixed(desc: RAPIER.ColliderDesc, friction = 0.5): RAPIER.Collider {
    return this.world.createCollider(desc.setFriction(friction).setRestitution(0.3));
  }

  private box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, friction = 0.5): void {
    this.fixed(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(cx, cy, cz), friction);
  }

  private buildField(): void {
    // Carpet and walls
    this.fixed(RAPIER.ColliderDesc.cuboid(HALF_L + 2, 0.1, HALF_W + 2).setTranslation(0, -0.1, 0), 0.8);
    const t = 0.1;
    for (const s of [1, -1]) {
      this.box(0, FIELD.rail / 2, s * (HALF_W + t / 2), FIELD.length + 2 * t, FIELD.rail, t, 0.1);
      this.box(s * (HALF_L + t / 2), FIELD.wall / 2, 0, t, FIELD.wall, FIELD.width + 2 * t, 0.1);
    }
    for (const a of ALLIANCES) this.buildAllianceSide(a);
  }

  private buildAllianceSide(a: Alliance): void {
    const P = (p: Vec2) => place(a, p);
    const dir = intoField(a);
    // HUB: solid up to its funnel floor, thin walls above it, open on top.
    const [hx, hz] = P(RED.hub);
    this.box(hx, HUB.floor / 2, hz, HUB.size, HUB.floor, HUB.size);
    const w = 0.04;
    const wallH = HUB.height - HUB.floor;
    const wy = HUB.floor + wallH / 2;
    for (const s of [1, -1]) {
      this.box(hx + s * (HUB.size / 2 - w / 2), wy, hz, w, wallH, HUB.size);
      this.box(hx, wy, hz + s * (HUB.size / 2 - w / 2), HUB.size, wallH, w);
    }
    // BUMPS: a low ridge of two 15° ramps.
    for (const b of RED.bumps) {
      const [bx, bz] = P(b);
      const hd = BUMP.depth / 2, hw = BUMP.width / 2, h = BUMP.height;
      const pts = new Float32Array([
        -hd, 0, -hw, hd, 0, -hw, -hd, 0, hw, hd, 0, hw,
        -0.07, h, -hw, 0.07, h, -hw, -0.07, h, hw, 0.07, h, hw,
      ]);
      const hull = RAPIER.ColliderDesc.convexHull(pts);
      if (hull) this.fixed(hull.setTranslation(bx, 0, bz), 0.6);
    }
    // TRENCHES: two legs and an arm robots drive under.
    for (const tr of RED.trenches) {
      const [tx, tz] = P(tr);
      const width = RED.trenchWidth;
      const leg = (width - TRENCH.clearWidth) / 2;
      for (const s of [1, -1]) this.box(tx, TRENCH.height / 2, tz + s * (width / 2 - leg / 2), TRENCH.depth, TRENCH.height, leg);
      const armH = TRENCH.height - TRENCH.clearHeight;
      this.box(tx, TRENCH.clearHeight + armH / 2, tz, TRENCH.depth * 0.5, armH, width);
    }
    // TOWER: base plate, two UPRIGHTS, three RUNGS sticking out past them.
    const [cx, cz] = P(RED.tower);
    this.box(cx, 0.015, cz, TOWER.baseDepth, 0.03, TOWER.baseWidth);
    const frontX = cx + dir * (TOWER.depth / 2 - TOWER.uprightDeep / 2);
    for (const s of [1, -1]) {
      this.box(frontX, TOWER.uprightHeight / 2, cz + s * (TOWER.uprightGap / 2 + TOWER.uprightThick / 2), TOWER.uprightDeep, TOWER.uprightHeight, TOWER.uprightThick);
    }
    const rungLen = TOWER.uprightGap + 2 * TOWER.uprightThick + 2 * TOWER.rungOverhang;
    for (const y of TOWER.rungs) {
      this.fixed(
        RAPIER.ColliderDesc.capsule(rungLen / 2, TOWER.rungRadius)
          .setTranslation(frontX, y, cz)
          .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }),
      );
    }
    // The TOWER's back wall stands in the ALLIANCE WALL; its side walls close it in.
    const backX = cx - dir * (TOWER.depth / 2 - 0.05);
    this.box(backX, TOWER.height / 2, cz, 0.1, TOWER.height, TOWER.width);
    // DEPOT: a 1 in steel border on three sides (open toward the wall).
    const [dx, dz] = P(RED.depot);
    const bw = 3 * 0.0254;
    this.box(dx + dir * (DEPOT.depth / 2), DEPOT.barrier / 2, dz, bw, DEPOT.barrier, DEPOT.width);
    for (const s of [1, -1]) this.box(dx, DEPOT.barrier / 2, dz + s * (DEPOT.width / 2), DEPOT.depth, DEPOT.barrier, bw);
  }

  // ---------------------------------------------------------------- robots

  startPose(slot: number): Pose {
    const a = slotAlliance(slot);
    const dir = intoField(a);
    const z0 = RED.stations[slotStation(slot)];
    // On the ROBOT STARTING LINE (the ALLIANCE ZONE edge), bumpers behind it, facing the HUB side.
    const x = (a === 'red' ? -HALF_L : HALF_L) + dir * (HUB.fromWall - HUB.size / 2 - 0.55);
    const z = a === 'red' ? z0 : -z0;
    return { x, z, yaw: a === 'red' ? 0 : Math.PI };
  }

  addRobot(slot: number, robotId: string): Robot {
    const r = new Robot(this.world, slot, robotById(robotId), this.startPose(slot));
    this.robots.push(r);
    return r;
  }

  robot(slot: number): Robot | undefined {
    return this.robots.find(r => r.slot === slot);
  }

  // ---------------------------------------------------------------- match

  /** Every FUEL back where it starts, robots to their starts with pre-loads, clock to zero. */
  reset(): void {
    this.time = 0;
    this.running = false;
    this.ended = false;
    this.winnerOfAuto = null;
    this.lastFoul.clear();
    this.fouls.red = this.fouls.blue = 0;
    this.autoLevels = null;
    this.lastPeriod = 'auto';
    this.score.red = emptyScore();
    this.score.blue = emptyScore();
    this.chute.red = [];
    this.chute.blue = [];
    for (const r of this.robots) {
      r.setPose(this.startPose(r.slot));
      r.hopper.length = 0;
      r.scored = 0;
      r.towerProtected = false;
    }
    for (const f of this.fuel) {
      f.shotAt = -1;
      f.shotBy = -1;
      f.hub = null;
      f.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      f.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      const s = f.start;
      if (s.where === 'chute') {
        this.chute[s.alliance!].push(f.id);
        this.stow(f, 'chute');
      } else if (s.where === 'preload') {
        const r = this.robot(s.slot!);
        if (r) {
          r.hopper.push(f.id);
          this.stow(f, 'held');
        } else {
          // No robot in that slot: its pre-loads wait in the NEUTRAL ZONE pile's ends.
          this.putOnField(f, this.spareSpot(f.id));
        }
      } else {
        this.putOnField(f, s.pos);
        f.body.sleep();
      }
    }
  }

  private spareSpot(id: number): Vec3 {
    const k = id % 48;
    const side = k < 24 ? 1 : -1;
    const i = k % 24;
    return [(i % 4 - 1.5) * 0.16, FUEL.radius, side * (2.75 + Math.floor(i / 4) * 0.16)];
  }

  private stow(f: Fuel, state: FuelState): void {
    f.state = state;
    f.body.setEnabled(false);
    f.body.setTranslation({ x: 0, y: -5, z: 0 }, false);
    this.store(f);
  }

  private putOnField(f: Fuel, p: Vec3, v: Vec3 = [0, 0, 0]): void {
    f.state = 'field';
    f.body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
    f.body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
    f.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    f.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    f.body.setEnabled(true);
    f.body.enableCcd(Math.hypot(...v) > 3);
    f.body.wakeUp();
    this.store(f);
    this.awake[f.id] = 1;
  }

  private store(f: Fuel): void {
    const t = f.body.translation();
    const r = f.body.rotation();
    this.transforms.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w], f.id * 7);
  }

  start(): void {
    this.running = true;
  }

  get period(): PeriodId {
    return this.practice ? 'shift1' : periodAt(this.time).id;
  }

  get isAuto(): boolean {
    return !this.practice && this.time < AUTO_LENGTH;
  }

  /** Whether `a`'s HUB is lit now. */
  hubOn(a: Alliance): boolean {
    if (this.practice) return true;
    return hubActive(a, this.period, this.winnerOfAuto);
  }

  /** Whether FUEL entering `a`'s HUB now scores: active now, or active up to 3 s ago (6.5). */
  private scoresNow(a: Alliance): boolean {
    if (this.practice) return true;
    if (this.ended) return false;
    return this.hubOn(a) || hubActive(a, periodAt(Math.max(0, this.time - SCORE_GRACE)).id, this.winnerOfAuto);
  }

  /** Seconds until the HUB status may change (the end of this period), or null. */
  get periodLeft(): number {
    return periodAt(this.time).end - this.time;
  }

  // ---------------------------------------------------------------- step

  step(): void {
    const dt = PHYSICS_DT;
    if (this.running && !this.ended && !this.practice) this.advanceClock(dt);
    for (const r of this.robots) {
      const shot = r.control(dt);
      if (shot) {
        this.launch(r, shot.pos, shot.vel);
        // G407: launch into the HUB only with bumpers at least partly in the own ALLIANCE ZONE.
        if (!this.bumpersInZone(r)) this.foul(r, 'G407', 2);
      }
      if (r.input.intake || r.intakeOn) this.intake(r);
    }
    this.world.step();
    this.afterStep(dt);
  }

  private advanceClock(dt: number): void {
    this.time += dt;
    const p = periodAt(this.time).id;
    if (p !== this.lastPeriod) {
      if (this.lastPeriod === 'auto') this.autoLevels = this.robots.map(r => r.level);
      this.lastPeriod = p;
      this.onEvent({ type: 'period', period: p });
    }
    // AUTO's FUEL is counted 3 s after AUTO (6.4): then the SHIFT order is known.
    if (!this.winnerOfAuto && this.time >= AUTO_LENGTH + SCORE_GRACE) {
      const fuel = { red: this.score.red.autoFuel, blue: this.score.blue.autoFuel };
      this.winnerOfAuto = autoWinner(fuel, this.rand);
      for (const a of ALLIANCES) {
        this.score[a].autoTower = autoTowerPoints(this.robots.filter(r => r.alliance === a).map(r => this.autoLevels?.[this.robots.indexOf(r)] ?? 0));
      }
      this.onEvent({ type: 'autoWinner', alliance: this.winnerOfAuto });
    }
    if (this.time >= MATCH_LENGTH + SCORE_GRACE) {
      this.time = MATCH_LENGTH + SCORE_GRACE;
      this.finish();
    }
  }

  private finish(): void {
    if (this.ended) return;
    for (const a of ALLIANCES) this.score[a].tower = towerPoints(this.robots.filter(r => r.alliance === a).map(r => (r.towerProtected && r.hanging ? 3 : r.level)));
    this.ended = true;
    this.running = false;
    this.onEvent({ type: 'end' });
  }

  /** Whether a robot's bumpers are at least partly in its own ALLIANCE ZONE (G407). */
  bumpersInZone(r: Robot): boolean {
    const x = r.position[0];
    const h = r.spec.size / 2;
    return r.alliance === 'red' ? x - h < -HALF_L + ALLIANCE_ZONE : x + h > HALF_L - ALLIANCE_ZONE;
  }

  /** A MAJOR FOUL against `r`'s alliance: 15 points to the other one. Once per `every` s per rule. */
  private foul(r: Robot, rule: 'G403' | 'G407' | 'G420', every = Infinity): void {
    if (this.practice) return;
    const key = `${r.slot}|${rule}`;
    const last = this.lastFoul.get(key);
    if (last !== undefined && this.time - last < every) return;
    this.lastFoul.set(key, this.time);
    this.score[other(r.alliance)].foulPoints += POINTS.majorFoul;
    this.fouls[r.alliance]++;
    this.onEvent({ type: 'foul', rule, alliance: r.alliance, slot: r.slot });
  }

  private checkFouls(): void {
    for (const r of this.robots) {
      // G403: in AUTO, not completely across the CENTER LINE.
      if (this.isAuto) {
        const x = r.position[0];
        const h = r.spec.size / 2;
        if (r.alliance === 'red' ? x - h > 0 : x + h < 0) this.foul(r, 'G403');
      }
      // G420: in the last 30 s, hands off an opponent on its TOWER (it gets LEVEL 3 points).
      if (MATCH_LENGTH - this.time <= 30) {
        for (const o of this.robots) {
          if (o.alliance === r.alliance || !o.hanging) continue;
          let touching = false;
          this.world.contactPair(r.collider, o.collider, m => {
            if (m.numContacts() > 0) touching = true;
          });
          if (touching) {
            this.foul(r, 'G420');
            o.towerProtected = true;
          }
        }
      }
    }
  }

  /** Points a robot's TOWER level would give if the match ended now (HUD). */
  liveTower(a: Alliance): number {
    return towerPoints(this.robots.filter(r => r.alliance === a).map(r => r.level));
  }

  private launch(r: Robot, pos: Vec3, vel: Vec3): void {
    const id = r.hopper.shift();
    if (id === undefined) return;
    const f = this.fuel[id];
    this.putOnField(f, pos, vel);
    f.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    f.shotAt = this.time;
    f.shotBy = r.slot;
  }

  /** The intake takes FUEL lying in front of the robot, across its whole width. */
  private intake(r: Robot): void {
    r.intakeWait -= PHYSICS_DT;
    if (r.hanging || r.hopper.length >= r.spec.capacity || r.intakeWait > 0) return;
    const p = r.body.translation();
    const [fx, fz] = r.forward;
    const half = r.spec.size / 2;
    for (const f of this.fuel) {
      if (f.state !== 'field') continue;
      const o = f.id * 7;
      const dx = this.transforms[o] - p.x;
      const dz = this.transforms[o + 2] - p.z;
      if (dx * dx + dz * dz > 1) continue;
      const y = this.transforms[o + 1] - p.y;
      if (y > 0.35) continue;
      const along = dx * fx + dz * fz;
      const across = dx * -fz + dz * fx;
      if (along < half - 0.02 || along > half + FUEL.radius * 1.6 || Math.abs(across) > half - 0.03) continue;
      r.hopper.push(f.id);
      this.stow(f, 'held');
      r.intakeWait = 1 / INTAKE_RATE;
      return;
    }
  }

  private afterStep(dt: number): void {
    for (const f of this.fuel) {
      if (f.state === 'hub') {
        f.hubTimer -= dt;
        if (f.hubTimer <= 0) this.exitHub(f);
        continue;
      }
      if (f.state !== 'field') continue;
      const sleeping = f.body.isSleeping();
      if (!sleeping || this.awake[f.id]) this.store(f);
      this.awake[f.id] = sleeping ? 0 : 1;
      if (sleeping) continue;
      const o = f.id * 7;
      const x = this.transforms[o], y = this.transforms[o + 1], z = this.transforms[o + 2];
      if (f.body.isCcdEnabled() && f.body.linvel().y < 0 && y < 0.6) f.body.enableCcd(false);
      // Into a HUB: below the rim, above the funnel floor, inside the walls.
      if (y < HUB.height && y > HUB.floor - 0.05) {
        for (const a of ALLIANCES) {
          const [hx, hz] = place(a, RED.hub);
          if (Math.abs(x - hx) < HUB.size / 2 - 0.04 && Math.abs(z - hz) < HUB.size / 2 - 0.04) this.enterHub(f, a);
        }
      }
      // Out of the field (over a guardrail): the field staff put it back in the NEUTRAL ZONE.
      if (y < -0.5 || Math.abs(x) > HALF_L + 0.3 || Math.abs(z) > HALF_W + 0.3) {
        this.putOnField(f, [(this.rand() - 0.5) * 3, 0.3, (this.rand() - 0.5) * 4]);
      }
    }
    this.feedOutposts(dt);
    this.foulCheck -= dt;
    if (this.running && !this.practice && !this.ended && this.foulCheck <= 0) {
      this.foulCheck = 0.1;
      this.checkFouls();
    }
  }

  private enterHub(f: Fuel, a: Alliance): void {
    f.state = 'hub';
    f.hub = a;
    f.hubTimer = HUB_PASS_TIME;
    f.body.setEnabled(false);
    const counts = this.scoresNow(a);
    const s = this.score[a];
    const auto = !this.practice && f.shotAt >= 0 && f.shotAt < AUTO_LENGTH;
    if (counts) {
      if (auto) s.autoFuel++;
      else s.teleFuel++;
      const shooter = this.robot(f.shotBy);
      if (shooter) shooter.scored++;
    } else {
      s.wasted++;
    }
    this.onEvent({ type: counts ? 'score' : 'wasted', alliance: a, slot: f.shotBy });
  }

  /** The HUB lets FUEL out of its four exits at the base, into the NEUTRAL ZONE. */
  private exitHub(f: Fuel): void {
    const a = f.hub!;
    const [hx, hz] = place(a, RED.hub);
    const dir = intoField(a);
    const k = this.exitTurn++ % 4;
    const z = hz + (k - 1.5) * 0.28;
    f.hub = null;
    f.shotAt = -1;
    this.putOnField(f, [hx + dir * (HUB.size / 2 + FUEL.radius + 0.03), 0.12, z], [dir * (1.6 + this.rand()), 0, (this.rand() - 0.5) * 1.2]);
  }

  /** A robot at the CORRAL gets FUEL from the CHUTE, one at a time. */
  private feedOutposts(dt: number): void {
    for (const a of ALLIANCES) {
      const left = this.chute[a];
      if (!left.length) continue;
      const [ox, oz] = place(a, RED.outpost);
      const waiting = this.robots.some(r => r.alliance === a && !r.hanging && Math.hypot(r.position[0] - ox, r.position[2] - oz) < 1.25);
      this.feedTimer[a] = waiting ? this.feedTimer[a] + dt : 0;
      if (this.feedTimer[a] < OUTPOST_FEED_EVERY) continue;
      this.feedTimer[a] = 0;
      const f = this.fuel[left.pop()!];
      const dir = intoField(a);
      this.putOnField(f, [ox, 0.12, oz], [dir * 2.2, 0, (this.rand() - 0.5) * 0.4]);
    }
  }

  /** FUEL still on the field (for bots looking for some). */
  fieldFuel(): Fuel[] {
    return this.fuel.filter(f => f.state === 'field');
  }

  fuelPos(id: number): Vec3 {
    const o = id * 7;
    return [this.transforms[o], this.transforms[o + 1], this.transforms[o + 2]];
  }
}
