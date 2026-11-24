// A HUB (manual 5.4): FUEL that drops through its top opening is counted by the field and comes
// back out of the exits at its base, rolling into the NEUTRAL ZONE. The HUB itself is solid (its
// CAD collider, sim/colliders.ts); a ball counts once its center is inside the opening, at or
// below the rim.

import { HUB } from '../frc/field';
import type { Alliance } from '../robot/robotConfig';
import type { Ball, BallSim } from './BallSim';

/** A ball takes this long to fall through the HUB to an exit, s */
const PASS_TIME = 0.7;
/** The opening is a little smaller than the HUB's outside */
const INSET = 0.06;
/** Counted up to this far above the rim (the CAD's top lies a few cm higher than the manual's 72 in) */
const RIM_SLACK = 0.12;

export class HubSim {
  /** Balls inside, with seconds until each comes out */
  private readonly inside: { ball: Ball; left: number }[] = [];
  private exitTurn = 0;
  /** FUEL scored: returns whether it counted (the match decides) */
  onScore?: (ball: Ball) => boolean;
  /** Balls that went in since the HUB was made (for the lights' flash) */
  entered = 0;

  constructor(
    readonly alliance: Alliance,
    /** Center (x, z) */
    readonly center: [number, number],
    private readonly balls: BallSim,
  ) {}

  reset(): void {
    this.inside.length = 0;
    this.entered = 0;
  }

  /** Whether a ball at (x, y, z) has dropped into the opening. */
  contains(x: number, y: number, z: number): boolean {
    const half = HUB.size / 2 - INSET;
    return y < HUB.height + RIM_SLACK && y > HUB.height - 0.6 && Math.abs(x - this.center[0]) < half && Math.abs(z - this.center[1]) < half;
  }

  /** Call after every physics step. */
  step(dt: number): void {
    for (const b of this.balls.all) {
      if (b.state !== 'field' || b.body.isSleeping()) continue;
      const [x, y, z] = this.balls.position(b);
      if (!this.contains(x, y, z)) continue;
      this.balls.stow(b, 'hub', [this.center[0], HUB.height - 0.3, this.center[1]]);
      this.inside.push({ ball: b, left: PASS_TIME });
      this.entered++;
      this.onScore?.(b);
    }
    for (let i = this.inside.length - 1; i >= 0; i--) {
      const e = this.inside[i];
      e.left -= dt;
      if (e.left > 0) continue;
      this.inside.splice(i, 1);
      this.release(e.ball);
    }
  }

  /** Out of one of the four exits on the NEUTRAL ZONE side, rolling away from the HUB. */
  private release(b: Ball): void {
    const dir = this.alliance === 'red' ? 1 : -1;
    const k = this.exitTurn++ % 4;
    const z = this.center[1] + (k - 1.5) * 0.26;
    // Past the exit ramps, which reach about 0.3 m out of the HUB in the CAD.
    const x = this.center[0] + dir * (HUB.size / 2 + 0.32);
    this.balls.release(b, [x, b.radius + 0.06, z], [dir * (1.4 + Math.random() * 0.8), 0, (Math.random() - 0.5) * 1.0]);
    b.launch = null;
  }
}
