import { describe, expect, it } from 'vitest';
import { ReplayRecorder } from '../src/game/replay';
import { gunzip, gzip, packReplay, unpackReplay } from '../src/game/replayFile';
import { emptyScore } from '../src/game/scoring';
import { decodeState } from '../src/sim/stateCodec';
import type { WorldState } from '../src/sim/state';

const world = (x: number): WorldState => ({
  time: x, period: 'teleop', periodTime: x, hubs: { red: true, blue: true }, autoWinner: null,
  score: { red: emptyScore(), blue: emptyScore() },
  robots: [{
    slot: 'red1', robot: 'skyline', x, z: 0, yaw: 0, heading: 0, speed: 0, turretYaw: 0, pitch: 1, flywheel: 1, intakeDir: 0, transfer: true,
    status: 'ready', shotSpeed: 5, shotDistance: 1, powers: { fl: 0, fr: 0, bl: 0, br: 0 }, stored: [], voltage: 14, minVoltage: 14,
    y: 0, climb: 0, level: 0, extraTurrets: [],
  }],
  balls: { states: new Uint8Array([0]), transforms: new Float32Array([0, 0.04, 0, 0, 0, 0, 1]) },
});

describe('replay files', () => {
  it('keep every frame through packing and gzip', async () => {
    const rec = new ReplayRecorder();
    for (let i = 0; i < 120; i++) rec.capture(1 / 60, world(i / 60), 3 - i / 60);
    const file = await gzip(packReplay(rec.frames));
    expect([file[0], file[1]]).toEqual([0x1f, 0x8b]);
    const frames = unpackReplay(await gunzip(file));
    expect(frames).toHaveLength(rec.frames.length);
    expect(frames[30].t).toBeCloseTo(rec.frames[30].t, 5);
    expect(frames[30].startIn).toBeCloseTo(rec.frames[30].startIn, 5);
    expect(decodeState(frames[30].data).robots[0].x).toBeCloseTo(decodeState(rec.frames[30].data).robots[0].x, 3);
  });

  it('refuses anything that is not a whole replay', () => {
    expect(() => unpackReplay(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow('not a replay');
    const rec = new ReplayRecorder();
    rec.capture(1, world(0), 0);
    const whole = packReplay(rec.frames);
    expect(() => unpackReplay(whole.subarray(0, whole.length - 10))).toThrow('cut short');
  });
});
