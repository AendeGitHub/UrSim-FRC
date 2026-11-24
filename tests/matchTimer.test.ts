import { describe, expect, it } from 'vitest';
import { MATCH_COUNTDOWN, recordingTime } from '../src/game/matchTimer';
import { DURATION } from '../src/sim/Match';

describe('match timer', () => {
  it('counts 3-2-1 before AUTO and nothing in practice', () => {
    expect(recordingTime('practice', 12, 0)).toBeNull();
    expect(recordingTime('auto', 0, MATCH_COUNTDOWN)).toBeCloseTo(-MATCH_COUNTDOWN);
    expect(recordingTime('auto', 0, 1)).toBeCloseTo(-1);
    expect(MATCH_COUNTDOWN).toBe(3);
  });

  it('follows the 2:43 REBUILT match: AUTO 0:20, a 3 s transition, TELEOP 2:20', () => {
    expect(recordingTime('auto', DURATION.auto, 0)).toBe(20);
    expect(recordingTime('transition', DURATION.transition, 0)).toBe(23);
    expect(recordingTime('teleop', 0, 0)).toBe(23);
    expect(recordingTime('teleop', DURATION.teleop - 30, 0)).toBe(133);
    expect(recordingTime('post', 0, 0)).toBe(163);
  });
});
