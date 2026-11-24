import { describe, expect, it } from 'vitest';
import { emptyScore } from '../src/game/scoring';
import { Replay, ReplayRecorder, findHighlights } from '../src/game/replay';
import type { Period } from '../src/sim/Match';
import type { WorldState } from '../src/sim/state';

function world(time: number, period: Period, opts: { x?: number; stored?: number; level?: number } = {}): WorldState {
  return {
    time,
    period,
    periodTime: time,
    hubs: { red: true, blue: true },
    autoWinner: null,
    score: { red: emptyScore(), blue: emptyScore() },
    robots: [{
      slot: 'red1', robot: 'skyline', x: opts.x ?? 0, z: 0, yaw: 0, heading: 0, speed: 0, turretYaw: 0, pitch: 1, flywheel: 1, intakeDir: 0, transfer: true,
      status: 'ready', shotSpeed: 5, shotDistance: 1, powers: { fl: 0, fr: 0, bl: 0, br: 0 }, stored: Array.from({ length: opts.stored ?? 0 }, (_, i) => i), voltage: 14, minVoltage: 14,
      y: 0, climb: 0, level: opts.level ?? 0, extraTurrets: [],
    }],
    balls: { states: new Uint8Array([0]), transforms: new Float32Array([0, 0.04, 0, 0, 0, 0, 1]) },
  };
}

/** A game 30 frames a second: `at(t)` says what the field looks like `t` s in. */
function record(seconds: number, at: (t: number) => WorldState): ReplayRecorder {
  const rec = new ReplayRecorder();
  for (let i = 0; i <= seconds * 60; i++) rec.capture(1 / 60, at(i / 60), 3 - i / 60);
  return rec;
}

describe('replays', () => {
  it('plays back any moment, blended between frames', () => {
    const rec = record(2, t => world(t, 'auto', { x: t }));
    const replay = new Replay(rec.frames);
    expect(replay.duration).toBeCloseTo(2, 1);
    expect(replay.at(1.01)!.world.robots[0].x).toBeCloseTo(1, 1);
    expect(replay.at(1.01)!.startIn).toBeCloseTo(2, 1);
  });

  it('finds the start, a volley, a climb and the finish, and joins clips that touch', () => {
    const rec = record(60, t => {
      // 4 balls out in 0.4 s at 20 s; red 1 climbs to LEVEL 2 at 40 s; the match ends at 58 s.
      const stored = t < 20 ? 4 : t < 20.4 ? 4 - Math.floor((t - 20) / 0.1) : 0;
      return world(t, t < 58 ? 'teleop' : 'post', { stored, level: t < 40 ? 0 : 2 });
    });
    const clips = findHighlights(rec.frames);
    expect(clips.map(c => c.kind)).toEqual(['start', 'volley', 'climb', 'finish']);
    const climb = clips[2];
    expect(climb.alliance).toBe('red');
    expect(climb.start).toBeCloseTo(35, 0);
    expect(climb.end).toBeCloseTo(43, 0);
    expect(clips[1].start).toBeCloseTo(17.5, 0);
    expect(clips[3].end).toBeCloseTo(60, 0);
  });
});
