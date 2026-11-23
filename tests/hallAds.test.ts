import { describe, expect, it } from 'vitest';
import { BANNER, BANNER_SPOTS, BOARD_SPOTS, CASING, FACE } from '../src/view/HallAds';

/** Front of the stands (view/Arena.ts), the side guardrails and the ALLIANCE WALLS (frc/field.ts), m */
const STANDS_Z = 7.4;
const FIELD_HALF = 4.03;
const DRIVERS_X = 8.27;

describe('hall advertising', () => {
  it('puts the LED boards apart from each other along both long sides', () => {
    for (const side of [-1, 1]) {
      const xs = BOARD_SPOTS.filter(([, z]) => Math.sign(z) === side).map(([x]) => x).sort((a, b) => a - b);
      expect(xs.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(FACE.length + 2 * CASING.margin + 0.2);
    }
    expect(BOARD_SPOTS.length).toBeLessThanOrEqual(12);
  });

  it('stands the boards beyond the guardrails and clear of the stands, leaning back included', () => {
    const top = FACE.bottom + FACE.height + CASING.margin;
    for (const [, z] of BOARD_SPOTS) {
      expect(Math.abs(z)).toBeGreaterThan(FIELD_HALF + 1);
      expect(Math.abs(z) + top * Math.sin(FACE.lean) + CASING.depth).toBeLessThan(STANDS_Z);
    }
  });

  it('hangs the banners behind the drivers, beside the field and away from the boards', () => {
    for (const [x, z] of BANNER_SPOTS) {
      expect(Math.abs(x)).toBeGreaterThan(DRIVERS_X + 1);
      expect(Math.abs(z) + BANNER.width / 2 + 0.1).toBeLessThan(STANDS_Z);
      expect(Math.abs(z) - BANNER.width / 2).toBeGreaterThan(FIELD_HALF - 0.5);
    }
  });
});
