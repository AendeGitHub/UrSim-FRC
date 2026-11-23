// REBUILT point values (manual 6.5) and ranking points, built on the pure rules in frc/rules.ts.

import { POINTS as RULE_POINTS, RP, towerPoints } from '../frc/rules';
import type { Alliance } from '../robot/robotConfig';
import type { Slot } from '../sim/types';
import { t } from '../ui/i18n';

export const POINTS = {
  fuel: RULE_POINTS.fuel,
  autoTower: RULE_POINTS.autoTowerL1,
  tower: RULE_POINTS.tower,
};

/** Ranking point thresholds (manual 6.5): FUEL scored for ENERGIZED and SUPERCHARGED, TOWER points for TRAVERSAL. */
export const RP_THRESHOLDS = { energized: RP.energized, supercharged: RP.supercharged, traversal: RP.traversal };

export interface AllianceScore {
  /** FUEL scored in an active HUB, in AUTO and in TELEOP */
  autoFuel: number;
  teleopFuel: number;
  /** FUEL that went into the HUB while it was inactive: no points */
  wasted: number;
  /** Robots off the carpet on the TOWER at the end of AUTO (15 points each, two at most) */
  autoClimbed: Slot[];
  /** Each robot's TOWER level now / at the end of the match (0: not climbed) */
  levels: Partial<Record<Slot, number>>;
  /** Rule violations (manual 7): a red card disqualifies — 0 match points */
  warnings: number;
  yellowCards: number;
  redCards: number;
  /** FOULS this alliance committed */
  minorFouls: number;
  majorFouls: number;
  /** Points credited to this alliance for the opponent's FOULS */
  foulPoints: number;
  /** Referee calls against this alliance, e.g. "G407 · MAJOR FOUL · Red 1" (sim/Referee.ts) */
  calls: string[];
}

export const emptyScore = (): AllianceScore => ({
  autoFuel: 0, teleopFuel: 0, wasted: 0, autoClimbed: [], levels: {},
  warnings: 0, yellowCards: 0, redCards: 0, minorFouls: 0, majorFouls: 0, foulPoints: 0, calls: [],
});

export const fuelScored = (s: AllianceScore): number => s.autoFuel + s.teleopFuel;
export const autoTowerPoints = (s: AllianceScore): number => Math.min(2, s.autoClimbed.length) * POINTS.autoTower;
export const endTowerPoints = (s: AllianceScore): number => towerPoints(Object.values(s.levels).map(l => l ?? 0));

/** Point breakdown for one alliance. */
export function breakdown(s: AllianceScore): { label: string; count: number; points: number }[] {
  const levels = Object.values(s.levels).map(l => l ?? 0);
  return [
    { label: t('score.autoFuel'), count: s.autoFuel, points: s.autoFuel * POINTS.fuel },
    { label: t('score.autoTower'), count: Math.min(2, s.autoClimbed.length), points: autoTowerPoints(s) },
    { label: t('score.teleopFuel'), count: s.teleopFuel, points: s.teleopFuel * POINTS.fuel },
    ...[1, 2, 3].map(level => {
      const count = levels.filter(l => l === level).length;
      return { label: t(`score.level${level}` as 'score.level1'), count, points: count * POINTS.tower[level] };
    }),
    { label: t('score.fouls'), count: 1, points: s.foulPoints },
  ];
}

export function total(s: AllianceScore): number {
  if (s.redCards > 0) return 0;
  return breakdown(s).reduce((sum, row) => sum + row.points, 0);
}

export function rankingPoints(s: AllianceScore): { energized: boolean; supercharged: boolean; traversal: boolean } {
  const fuel = fuelScored(s);
  return {
    energized: fuel >= RP_THRESHOLDS.energized,
    supercharged: fuel >= RP_THRESHOLDS.supercharged,
    traversal: autoTowerPoints(s) + endTowerPoints(s) >= RP_THRESHOLDS.traversal,
  };
}

/** Points by row of the results display: FUEL, TOWER, then the opponent's FOULS. */
export interface ScoreRows {
  auto: number;
  fuel: number;
  tower: number;
  foul: number;
}

export function scoreRows(s: AllianceScore): ScoreRows {
  return {
    auto: s.autoFuel * POINTS.fuel + autoTowerPoints(s),
    fuel: fuelScored(s) * POINTS.fuel,
    tower: autoTowerPoints(s) + endTowerPoints(s),
    foul: s.foulPoints,
  };
}

/** What the alliance scored on the field itself: no points from the opponent's FOULS, no red card zeroing it. */
export function earnedPoints(s: AllianceScore): number {
  return fuelScored(s) * POINTS.fuel + autoTowerPoints(s) + endTowerPoints(s);
}

/** Points scored in AUTO (a ranking tiebreaker). */
export function autoPoints(s: AllianceScore): number {
  return s.autoFuel * POINTS.fuel + autoTowerPoints(s);
}

export type MatchResult = 'win' | 'tie' | 'loss';

/** The RANKING POINTS of the results display: WIN 3 or TIE 1, then ENERGIZED, SUPERCHARGED and TRAVERSAL. */
export interface MatchRankingPoints {
  result: MatchResult;
  energized: boolean;
  supercharged: boolean;
  traversal: boolean;
  total: number;
}

/** The winning alliance, or null for a tie. */
export function matchWinner(score: Record<Alliance, AllianceScore>): Alliance | null {
  const red = total(score.red);
  const blue = total(score.blue);
  return red === blue ? null : red > blue ? 'red' : 'blue';
}

/** Both alliances' RP. A DISQUALIFIED alliance (red card) gets none. */
export function matchRankingPoints(score: Record<Alliance, AllianceScore>): Record<Alliance, MatchRankingPoints> {
  const winner = matchWinner(score);
  const of = (a: Alliance): MatchRankingPoints => {
    if (score[a].redCards > 0) return { result: 'loss', energized: false, supercharged: false, traversal: false, total: 0 };
    const result: MatchResult = winner === null ? 'tie' : winner === a ? 'win' : 'loss';
    const rp = rankingPoints(score[a]);
    const won = result === 'win' ? RP.win : result === 'tie' ? RP.tie : 0;
    return { result, ...rp, total: won + Number(rp.energized) + Number(rp.supercharged) + Number(rp.traversal) };
  };
  return { red: of('red'), blue: of('blue') };
}
