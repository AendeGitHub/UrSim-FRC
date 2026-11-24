// Match flow (AUTO → a short pause → TELEOP with its SHIFTS), the HUBS turning on and off, the
// OUTPOST human players, the TOWER and the live score (manual 6.4, 6.5).

import { ballInRect, footprint, polygonOverlapsRect, type Zones } from '../field/zones';
import { FUEL } from '../frc/field';
import { AUTO_LENGTH, SCORE_GRACE, autoWinner, hubActive, periodAt, type PeriodId } from '../frc/rules';
import { emptyScore, type AllianceScore } from '../game/scoring';
import type { Alliance } from '../robot/robotConfig';
import { t } from '../ui/i18n';
import type { BallSim } from './BallSim';
import type { HubSim } from './HubSim';
import { Referee } from './Referee';
import type { RobotSim } from './RobotSim';

export type Period = 'practice' | 'auto' | 'transition' | 'teleop' | 'post';
export const PERIODS: Period[] = ['practice', 'auto', 'transition', 'teleop', 'post'];

/** Seconds: AUTO 0:20, robots disabled 3 s while the field switches over, TELEOP 2:20 (manual 6.4). */
export const DURATION = { auto: AUTO_LENGTH, transition: 3, teleop: 140 };
/** The pause before TELEOP counts down 3-2-1. */
export const TELEOP_COUNTDOWN = 3;
/** END GAME: the last 30 s, both HUBS active, the TOWER scores (G420 protects climbers). */
export const ENDGAME = 30;
/** Time for balls to settle before the final score: FUEL in the air still counts for 3 s (6.5). */
const SETTLE = SCORE_GRACE;
/** The OUTPOST human player rolls a FUEL out of the CHUTE this often while one of their robots waits at it, s */
const HUMAN_PLAYER_INTERVAL = 0.45;
/** A robot this close to its OUTPOST's opening is waiting for FUEL, m */
const OUTPOST_REACH = 1.25;
/** Seconds before FIELD STAFF bring back a ball that left the field. */
export const RETURN_DELAY = 3;
/** A ball is out once its center is past the perimeter (inner face + wall thickness). */
const OUT_MARGIN = 0.12;

export interface MatchEvents {
  toast(text: string): void;
  finished(): void;
}

const ALLIANCES: Alliance[] = ['red', 'blue'];

/** The REBUILT phase (TRANSITION SHIFT, SHIFT 1–4, END GAME) at a moment of TELEOP, AUTO otherwise. */
export function phaseAt(period: Period, time: number): PeriodId {
  if (period === 'teleop') return periodAt(AUTO_LENGTH + time).id;
  if (period === 'post') return 'endgame';
  return 'auto';
}

/** Seconds left in the current REBUILT phase (Infinity in practice). */
export function phaseLeft(period: Period, time: number): number {
  if (period === 'auto') return DURATION.auto - time;
  if (period === 'teleop') return periodAt(AUTO_LENGTH + time).end - (AUTO_LENGTH + time);
  if (period === 'transition') return DURATION.transition - time;
  return Infinity;
}

/** The field timer as drivers see it (0:20 → 0:00 in AUTO, then 2:20 → 0:00 TELEOP). */
export function matchClock(period: Period, time: number): { text: string; label: string; urgent: boolean } {
  const fmt = (s: number) => {
    const t = Math.max(0, Math.ceil(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  switch (period) {
    case 'practice':
      return { text: '∞', label: t('menu.practice'), urgent: false };
    case 'auto':
      return { text: fmt(DURATION.auto - time), label: t('clock.auto'), urgent: false };
    case 'transition':
      return { text: fmt(DURATION.transition - time), label: t('clock.transition'), urgent: true };
    case 'teleop': {
      const left = DURATION.teleop - time;
      return { text: fmt(left), label: t(`phase.${phaseAt(period, time)}`), urgent: left <= ENDGAME };
    }
    case 'post':
      return { text: '0:00', label: t('clock.over'), urgent: false };
  }
}

/** Drivers may control robots (not between periods or after the match). */
export const robotsEnabled = (period: Period) => period === 'practice' || period === 'auto' || period === 'teleop';

export class Match {
  period: Period = 'practice';
  /** Seconds since the current period started */
  time = 0;
  readonly score: Record<Alliance, AllianceScore> = { red: emptyScore(), blue: emptyScore() };
  /** The alliance that scored more FUEL in AUTO: its HUB is off first (null until it is known) */
  winnerOfAuto: Alliance | null = null;
  private settle = 0;
  private finished = false;
  private readonly humanTimer: Record<Alliance, number> = { red: 0, blue: 0 };
  readonly referee = new Referee(this.score);
  private scoreTimer = 0;
  /** Seconds each ball (by id) has been outside the field */
  private readonly outside = new Map<number, number>();
  private lastPhase: PeriodId = 'auto';

  constructor(
    private readonly balls: BallSim,
    hubs: Record<Alliance, HubSim>,
    private readonly robots: () => RobotSim[],
    private readonly zones: Zones,
    private readonly events: MatchEvents,
  ) {
    for (const a of ALLIANCES) hubs[a].onScore = ball => this.scored(a, ball.launch?.auto ?? this.period === 'auto');
  }

  start(period: 'practice' | 'auto'): void {
    this.period = period;
    this.time = 0;
    this.settle = 0;
    this.finished = false;
    this.winnerOfAuto = null;
    this.lastPhase = 'auto';
    for (const a of ALLIANCES) {
      Object.assign(this.score[a], emptyScore());
      this.humanTimer[a] = 0;
    }
    this.referee.reset();
    this.outside.clear();
    this.updateTower();
  }

  get isMatch(): boolean {
    return this.period !== 'practice';
  }

  get robotEnabled(): boolean {
    return robotsEnabled(this.period);
  }

  /** Seconds left in TELEOP (Infinity outside it). */
  get teleopLeft(): number {
    return this.period === 'teleop' ? DURATION.teleop - this.time : this.period === 'post' ? 0 : Infinity;
  }

  /** The REBUILT phase now */
  get phase(): PeriodId {
    return phaseAt(this.period, this.time);
  }

  /** Whether `a`'s HUB is lit now. */
  hubOn(a: Alliance): boolean {
    if (this.period === 'practice') return true;
    if (this.period === 'post') return false;
    return hubActive(a, this.phase, this.winnerOfAuto);
  }

  /** Whether `a`'s HUB will be lit `ahead` seconds from now in TELEOP (bots start shooting early). */
  hubOnSoon(a: Alliance, ahead: number): boolean {
    if (this.period !== 'teleop') return false;
    return hubActive(a, periodAt(AUTO_LENGTH + this.time + ahead).id, this.winnerOfAuto);
  }

  /** Whether FUEL entering `a`'s HUB now scores: lit now, or lit up to 3 s ago (6.5). */
  private scoresNow(a: Alliance): boolean {
    if (this.period === 'practice') return true;
    if (this.finished) return false;
    if (this.hubOn(a)) return true;
    if (this.period === 'transition' || (this.period === 'post' && this.settle < SCORE_GRACE)) return true;
    if (this.period !== 'teleop') return false;
    const before = periodAt(AUTO_LENGTH + Math.max(0, this.time - SCORE_GRACE)).id;
    return hubActive(a, before, this.winnerOfAuto);
  }

  /** FUEL into `a`'s HUB: points if it is lit (or was a moment ago), else wasted. Returns whether it counted. */
  private scored(a: Alliance, auto: boolean): boolean {
    const counts = this.scoresNow(a);
    const s = this.score[a];
    if (!counts) s.wasted++;
    else if (auto && this.period !== 'teleop' && this.period !== 'post') s.autoFuel++;
    else s.teleopFuel++;
    return counts;
  }

  step(dt: number): void {
    if (this.finished) return; // final score is frozen
    this.time += dt;
    switch (this.period) {
      case 'auto':
        if (this.time >= DURATION.auto) {
          // AUTO TOWER: robots off the carpet now earn 15 points each (two at most).
          for (const r of this.robots()) if (r.level >= 1) this.score[r.alliance].autoClimbed.push(r.slot);
          this.next('transition');
          this.events.toast(t('toast.autoOver'));
        }
        break;
      case 'transition':
        if (this.time >= DURATION.transition) {
          // AUTO's FUEL is counted by now (3 s grace): the SHIFT order is known.
          this.winnerOfAuto = autoWinner({ red: this.score.red.autoFuel, blue: this.score.blue.autoFuel });
          this.next('teleop');
          this.events.toast(t('toast.teleop'));
        }
        break;
      case 'teleop': {
        const phase = this.phase;
        if (phase !== this.lastPhase) {
          this.lastPhase = phase;
          this.announcePhase(phase);
        }
        if (this.time >= DURATION.teleop) this.next('post');
        break;
      }
      case 'post':
        this.settle += dt;
        if (this.settle >= SETTLE) {
          this.updateTower();
          this.finished = true;
          this.events.finished();
          return;
        }
        break;
    }
    this.returnLostBalls(dt);
    if (this.robotEnabled) this.runHumanPlayers(dt);

    this.scoreTimer -= dt;
    if (this.scoreTimer <= 0) {
      this.scoreTimer = 0.25;
      this.updateTower();
    }
  }

  private announcePhase(phase: PeriodId): void {
    if (phase === 'endgame') {
      this.events.toast(t('toast.endgame'));
      return;
    }
    const on = ALLIANCES.filter(a => this.hubOn(a));
    if (on.length === 1) this.events.toast(t(on[0] === 'red' ? 'toast.redHub' : 'toast.blueHub'));
  }

  /** The referee calls rules during matches while robots play (practice is free play). */
  get judging(): boolean {
    return this.isMatch && !this.finished && this.period !== 'post';
  }

  /** Jumps to a period (used by tests and debugging). */
  next(period: Period): void {
    this.period = period;
    this.time = 0;
  }

  /** TOWER levels, live: once the match is over they are final (G420 gives a protected climber LEVEL 3). */
  private updateTower(): void {
    for (const a of ALLIANCES) {
      const levels: AllianceScore['levels'] = {};
      for (const r of this.robots()) if (r.alliance === a) levels[r.slot] = this.isMatch && r.level ? (this.referee.protectedClimber(r.slot) ? 3 : r.level) : 0;
      this.score[a].levels = levels;
    }
  }

  private corners(r: RobotSim): [number, number][] {
    const [x, , z] = r.position;
    return footprint(x, z, r.yaw, r.cfg.length, r.cfg.width);
  }

  /** A robot at its OUTPOST gets FUEL rolled out of the CHUTE, one at a time (manual 6.3.4). */
  private runHumanPlayers(dt: number): void {
    for (const a of ALLIANCES) {
      const [ox, oz] = this.zones.outpost[a];
      const waiting = this.robots().some(r => r.alliance === a && !r.hanging && Math.hypot(r.position[0] - ox, r.position[2] - oz) < OUTPOST_REACH);
      this.humanTimer[a] = waiting ? this.humanTimer[a] + dt : 0;
      if (this.humanTimer[a] < HUMAN_PLAYER_INTERVAL) continue;
      const next = this.balls.all.find(b => b.state === 'staged' && b.alliance === a);
      if (!next) continue;
      // Not onto a ball that is already lying at the opening.
      const spot: [number, number, number] = [ox, FUEL.radius + 0.06, oz];
      if (this.balls.all.some(b => b.state === 'field' && ballInRect(this.balls.position(b), b.radius, { minX: ox - 0.12, maxX: ox + 0.12, minZ: oz - 0.12, maxZ: oz + 0.12 }))) continue;
      const dir = a === 'red' ? 1 : -1;
      this.balls.release(next, spot, [dir * 2.2, 0, (Math.random() - 0.5) * 0.4]);
      this.humanTimer[a] = 0;
    }
  }

  /** Whether a robot is in the field part of its TOWER (for the AI and the camera). */
  atTower(r: RobotSim): boolean {
    return polygonOverlapsRect(this.corners(r), this.zones.tower[r.alliance]);
  }

  /**
   * FUEL that leaves the FIELD is put back by FIELD STAFF: into the NEUTRAL ZONE, near where it
   * went out.
   */
  private returnLostBalls(dt: number): void {
    const { halfX, halfZ } = this.zones;
    for (const b of this.balls.all) {
      if (b.state !== 'field') {
        this.outside.delete(b.id);
        continue;
      }
      const [x, y, z] = this.balls.position(b);
      if (Math.abs(x) < halfX + OUT_MARGIN && Math.abs(z) < halfZ + OUT_MARGIN && y > -0.5) {
        this.outside.delete(b.id);
        continue;
      }
      // A ball a robot just ejected (not shot) that leaves the field is a foul (G-rule on launching out).
      if (!this.outside.has(b.id) && b.launch?.kind === 'eject' && b.launch.age < 3 && this.judging) this.referee.ejectedOutOfField(b.launch.by);
      const t = (this.outside.get(b.id) ?? 0) + dt;
      if (t < RETURN_DELAY) {
        this.outside.set(b.id, t);
        continue;
      }
      this.outside.delete(b.id);
      const nz = Math.max(-halfZ + 0.4, Math.min(halfZ - 0.4, z));
      this.balls.release(b, [(Math.random() - 0.5) * 2, b.radius + 0.05, nz], [0, 0, 0]);
    }
  }
}
