// End of a match, as at a real event: a "RED WINS!" / "BLUE WINS!" card in the ALLIANCE colour
// sweeps in over the field, and when it ends the results fade in over it (Game.ts). A tie has no
// animation, so the results fade in over the field at once. It is drawn with CSS (styles.css
// .win-anim), so it costs nothing to load and plays on any computer.

import type { Alliance } from '../robot/robotConfig';
import { h } from './dom';

/** How long the results take to fade in over the animation (styles.css .fr-reveal), ms */
export const REVEAL_MS = 500;
/** The whole animation (styles.css: its keyframes take this long), ms */
const LENGTH_MS = 4200;
/** The fade-in (styles.css .win-anim), after which the animation hides the whole field, ms */
const FADE_MS = 600;
/** Presses this soon after the buzzer are still the drivers': they don't skip the animation, ms */
const SKIP_GRACE_MS = 1500;
const WORDS: Record<Alliance, string> = { red: 'RED', blue: 'BLUE' };

export class WinAnimation {
  readonly el = h('div', { class: 'win-anim' });
  private done: (() => void) | null = null;
  private timer = 0;
  /** When it started (performance time, ms) */
  private startedAt = 0;
  /** Kept for Game.ts: the CSS animation is as light as it gets either way. */
  light = false;

  constructor() {
    this.el.hidden = true;
  }

  /** Nothing to download. */
  preload(): void {}

  /** Between the end of the match and the results. */
  get playing(): boolean {
    return this.done !== null;
  }

  /** Faded in over the whole field: the field needn't be drawn until the results. */
  get covering(): boolean {
    return this.done !== null && performance.now() - this.startedAt >= FADE_MS;
  }

  /** The winner's animation; `done` when it ends (at once after a tie). */
  play(winner: Alliance | null, done: () => void): void {
    this.stop();
    if (!winner) return done();
    this.done = done;
    this.startedAt = performance.now();
    this.el.className = `win-anim win-anim-${winner}`;
    this.el.replaceChildren(
      h('div', { class: 'win-rays' }),
      h('div', { class: 'win-band' }),
      h('div', { class: 'win-title' }, h('span', { class: 'win-word' }, WORDS[winner]), h('span', { class: 'win-wins' }, 'WINS!')),
      h('div', { class: 'win-sub' }, 'REBUILT'),
    );
    this.el.hidden = false;
    // Restarts the CSS animation even for the same winner twice in a row.
    void this.el.offsetWidth;
    this.el.classList.add('win-anim-on');
    this.timer = window.setTimeout(() => this.finish(), LENGTH_MS);
  }

  /** Straight to the results (not on a press that was still driving at the buzzer). */
  skip(): void {
    if (this.done && performance.now() - this.startedAt >= SKIP_GRACE_MS) this.finish();
  }

  /** The results fade in over the last frame, then the animation goes away. */
  private finish(): void {
    const done = this.done;
    if (!done) return;
    this.done = null;
    clearTimeout(this.timer);
    done();
    this.timer = window.setTimeout(() => this.stop(), REVEAL_MS);
  }

  /** Gone at once: a new game or the menu. */
  stop(): void {
    clearTimeout(this.timer);
    this.done = null;
    this.el.classList.remove('win-anim-on');
    this.el.hidden = true;
    this.el.replaceChildren();
  }
}
