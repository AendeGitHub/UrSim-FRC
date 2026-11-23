import { describe, expect, it } from 'vitest';
import {
  RP_THRESHOLDS, autoPoints, earnedPoints, emptyScore, matchRankingPoints, matchWinner, rankingPoints, scoreRows, total, type AllianceScore,
} from '../src/game/scoring';

const score = (patch: Partial<AllianceScore>): AllianceScore => ({ ...emptyScore(), ...patch });

describe('REBUILT scoring (manual 6.5)', () => {
  it('counts 1 point a FUEL in an active HUB, 15 for each of two robots on the TOWER in AUTO, 10/20/30 for LEVELS 1–3', () => {
    const s = score({ autoFuel: 12, teleopFuel: 40, wasted: 9, autoClimbed: ['red1', 'red2', 'red3'], levels: { red1: 3, red2: 1, red3: 0 } });
    expect(autoPoints(s)).toBe(12 + 30);
    expect(earnedPoints(s)).toBe(52 + 30 + 30 + 10);
    expect(total(s)).toBe(earnedPoints(s));
  });

  it('groups points into the rows of the results display (AUTO, FUEL, TOWER, FOUL)', () => {
    const s = score({ autoFuel: 5, teleopFuel: 20, autoClimbed: ['blue1'], levels: { blue1: 2 }, foulPoints: 15 });
    expect(scoreRows(s)).toEqual({ auto: 5 + 15, fuel: 25, tower: 15 + 20, foul: 15 });
    expect(total(s)).toBe(25 + 35 + 15);
  });

  it('gives ENERGIZED, SUPERCHARGED and TRAVERSAL at their thresholds', () => {
    expect(rankingPoints(score({ teleopFuel: RP_THRESHOLDS.energized - 1 }))).toEqual({ energized: false, supercharged: false, traversal: false });
    expect(rankingPoints(score({ autoFuel: 20, teleopFuel: RP_THRESHOLDS.energized - 20 })).energized).toBe(true);
    expect(rankingPoints(score({ teleopFuel: RP_THRESHOLDS.supercharged })).supercharged).toBe(true);
    // TRAVERSAL: 50 TOWER points, AUTO included.
    expect(rankingPoints(score({ levels: { red1: 3, red2: 1 } })).traversal).toBe(false);
    expect(rankingPoints(score({ autoClimbed: ['red2'], levels: { red1: 3, red2: 1 } })).traversal).toBe(true);
  });

  it('gives 3 RP for a win, 1 for a tie, one for each bonus, none when disqualified', () => {
    const red = score({ teleopFuel: 120 });
    const blue = score({ teleopFuel: 60, levels: { blue1: 3, blue2: 2 } });
    expect(matchWinner({ red, blue })).toBe('red');
    expect(matchRankingPoints({ red, blue })).toMatchObject({ red: { result: 'win', energized: true, total: 4 }, blue: { result: 'loss', traversal: true, total: 1 } });
    expect(matchRankingPoints({ red, blue: red }).red).toMatchObject({ result: 'tie', total: 2 });
    const carded = score({ teleopFuel: 400, redCards: 1 });
    expect(total(carded)).toBe(0);
    expect(matchRankingPoints({ red: carded, blue }).red.total).toBe(0);
  });
});
