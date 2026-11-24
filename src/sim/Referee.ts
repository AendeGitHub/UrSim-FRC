// Automatic referee for the REBUILT game rules the simulation can judge by itself (manual 7.4).
//
// FOULS give points to the other alliance: MINOR FOUL 5, MAJOR FOUL 15. A second YELLOW CARD turns
// into a RED CARD, and a RED CARD disqualifies (0 match points).
//
// Judged here:
//   G403  in AUTO, completely across the CENTER LINE: MAJOR FOUL, and one more per contact with
//         an opponent there
//   G405  FUEL ejected out of the field: MINOR FOUL, MAJOR FOUL if repeated
//   G407  launching FUEL into the HUB with the BUMPERS fully outside the ALLIANCE ZONE: MAJOR FOUL
//   G418  pinning an opponent for more than 3 s: MINOR FOUL, then a MAJOR FOUL every 3 s
//   G420  in the last 30 s, contact with an opponent touching its TOWER: MAJOR FOUL, and the
//         opponent, if off the ground, scores LEVEL 3
//
// Cannot be broken in the simulation, so nothing to judge: robots are disabled between periods and
// after the match, the hopper holds what it holds, intakes reach only the floor (G408: nothing is
// caught in the air). The rest are about people, inspection or a referee's judgement of intent.

import type { AllianceScore } from '../game/scoring';
import type { Alliance } from '../robot/robotConfig';
import { SLOT_NAMES, slotAlliance, type Slot } from './types';

export type RuleId = 'G403' | 'G405' | 'G407' | 'G418' | 'G420';

export const FOUL_POINTS = { minor: 5, major: 15 };

/** House rules (Settings → Rules): penalties and the battery can be switched off. */
export interface RuleOptions {
  /** FOULS give points to the opponent */
  fouls: boolean;
  /** The battery sags and drains, and a tired battery makes a slow robot (sim/Battery.ts) */
  battery: boolean;
  /** VERBAL WARNINGS, YELLOW and RED CARDS */
  cards: boolean;
  /**
   * Shooting on the move: turrets aim while their robot drives and shots allow for its motion. Off,
   * like a team without that code, a turret aims only with its robot standing still.
   */
  movingShots: boolean;
}

export const DEFAULT_RULES: RuleOptions = { fouls: true, cards: true, battery: true, movingShots: true };

/** Rule options from an untrusted source (a network message), with defaults for anything odd. */
export function cleanRules(value: unknown): RuleOptions {
  const v = (value ?? {}) as Partial<RuleOptions>;
  const flag = (key: keyof RuleOptions) => (typeof v[key] === 'boolean' ? v[key] : DEFAULT_RULES[key]);
  return { fouls: flag('fouls'), cards: flag('cards'), battery: flag('battery'), movingShots: flag('movingShots') };
}

/** G407 is called once per robot in this many seconds (a stream of shots is one instance), s */
const SHOOT_ZONE_EVERY = 2;

const opponent = (a: Alliance): Alliance => (a === 'red' ? 'blue' : 'red');

export class Referee {
  /** Times each robot broke each rule this match, keyed "slot|rule" */
  private readonly counts = new Map<string, number>();
  private readonly perMatch = new Set<string>();
  private readonly yellow = new Set<Slot>();
  private readonly red = new Set<Slot>();
  /** When each robot was last called for G407 */
  private readonly lastZoneCall = new Map<Slot, number>();
  /** Robots an opponent touched on their TOWER in the last 30 s (they score LEVEL 3) */
  private readonly protectedClimbers = new Set<Slot>();
  options: RuleOptions = { ...DEFAULT_RULES };

  constructor(private readonly score: Record<Alliance, AllianceScore>) {}

  reset(): void {
    this.counts.clear();
    this.perMatch.clear();
    this.yellow.clear();
    this.red.clear();
    this.lastZoneCall.clear();
    this.protectedClimbers.clear();
  }

  /** G403: MAJOR FOUL the first time the robot is across in AUTO; `contact`: another one per opponent touched there. */
  acrossCenterLine(slot: Slot, contact: boolean): void {
    if (this.once(slot, 'G403') || contact) this.foul(slot, 'G403', 'major');
  }

  /** G405: MINOR FOUL, MAJOR FOUL if repeated. */
  ejectedOutOfField(slot: Slot): void {
    this.foul(slot, 'G405', this.repeated(slot, 'G405') ? 'major' : 'minor');
  }

  /** G407: MAJOR FOUL for shooting from outside the ALLIANCE ZONE, once per stream of shots. */
  shotOutsideZone(slot: Slot, time: number): void {
    const last = this.lastZoneCall.get(slot);
    this.lastZoneCall.set(slot, time);
    if (last !== undefined && time - last < SHOOT_ZONE_EVERY) return;
    this.foul(slot, 'G407', 'major');
  }

  /** G418: MINOR FOUL when a PIN passes 3 s, then a MAJOR FOUL for every 3 s more (`count`: 1 first). */
  pin(slot: Slot, count: number): void {
    this.foul(slot, 'G418', count <= 1 ? 'minor' : 'major');
  }

  /** G420: MAJOR FOUL per instance; an opponent off the ground scores LEVEL 3. */
  towerContact(slot: Slot, climber: Slot, offGround: boolean): void {
    if (offGround) this.protectedClimbers.add(climber);
    const key = `${climber}`;
    if (!this.once(slot, 'G420', key)) return;
    this.foul(slot, 'G420', 'major');
  }

  /** Whether an opponent touched this robot on its TOWER in the last 30 s (G420). */
  protectedClimber(slot: Slot): boolean {
    return this.protectedClimbers.has(slot);
  }

  /** A new contact on a TOWER can be called again once the robots have separated. */
  towerContactEnded(slot: Slot, climber: Slot): void {
    this.perMatch.delete(`${slot}|G420|${climber}`);
  }

  /** MINOR or MAJOR FOUL: the points go to the opposing alliance. */
  private foul(slot: Slot, rule: RuleId, kind: 'minor' | 'major'): void {
    if (!this.options.fouls) return;
    const a = slotAlliance(slot);
    if (kind === 'major') this.score[a].majorFouls++;
    else this.score[a].minorFouls++;
    this.score[opponent(a)].foulPoints += FOUL_POINTS[kind];
    this.call(slot, rule, kind === 'major' ? 'MAJOR FOUL' : 'MINOR FOUL');
  }

  /** The first time false; true when the robot does it again. */
  private repeated(slot: Slot, rule: RuleId): boolean {
    const key = `${slot}|${rule}`;
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n > 1;
  }

  /** "per instance": true only the first time for this robot, rule (and what it is about). */
  private once(slot: Slot, rule: RuleId, about = ''): boolean {
    const key = about ? `${slot}|${rule}|${about}` : `${slot}|${rule}`;
    if (this.perMatch.has(key)) return false;
    this.perMatch.add(key);
    return true;
  }

  /** Every call is listed on the results board, which puts the words into the player's language. */
  private call(slot: Slot, rule: RuleId, what: string): void {
    this.score[slotAlliance(slot)].calls.push(`${rule} · ${what} · ${SLOT_NAMES[slot]}`);
  }

  /** Cards are not given automatically in REBUILT's judged rules; kept for the results board. */
  get cards(): { yellow: number; red: number } {
    return { yellow: this.yellow.size, red: this.red.size };
  }
}
