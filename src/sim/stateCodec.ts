// Compact binary form of the world state, for online snapshots (a few KB instead of ~60 KB of
// JSON). Referee calls are not in it: they go with the final score.

import { emptyScore } from '../game/scoring';
import { ROBOTS, isCustomRobotId } from '../robot/robots';
import { PERIODS } from './Match';
import type { ShooterStatus } from './Mechanisms';
import type { RobotState, TurretState, WorldState } from './state';
import { SLOTS, type Slot } from './types';

const STATUSES: ShooterStatus[] = ['off', 'spinning', 'ready', 'tooFar'];
const SCORE_FIELDS = ['autoFuel', 'teleopFuel', 'wasted', 'warnings', 'yellowCards', 'redCards', 'minorFouls', 'majorFouls', 'foulPoints'] as const;
/** UrSim FRC's first snapshot format (504 FUEL, six robots). Other versions are refused. */
const VERSION = 1;
const CUSTOM = 255;
const ALLIANCE_CODE = { red: 1, blue: 2 } as const;

class Writer {
  private buf = new ArrayBuffer(4096);
  private view = new DataView(this.buf);
  offset = 0;
  private ensure(n: number) {
    if (this.offset + n <= this.buf.byteLength) return;
    const bigger = new ArrayBuffer(this.buf.byteLength * 2);
    new Uint8Array(bigger).set(new Uint8Array(this.buf));
    this.buf = bigger;
    this.view = new DataView(bigger);
  }
  u8(v: number) { this.ensure(1); this.view.setUint8(this.offset, v); this.offset += 1; }
  i8(v: number) { this.ensure(1); this.view.setInt8(this.offset, v); this.offset += 1; }
  u16(v: number) { this.ensure(2); this.view.setUint16(this.offset, v, true); this.offset += 2; }
  i16(v: number) { this.ensure(2); this.view.setInt16(this.offset, v, true); this.offset += 2; }
  f32(v: number) { this.ensure(4); this.view.setFloat32(this.offset, v, true); this.offset += 4; }
  text(v: string) { const bytes = new TextEncoder().encode(v.slice(0, 32)); this.u8(bytes.length); for (const b of bytes) this.u8(b); }
  done(): ArrayBuffer { return this.buf.slice(0, this.offset); }
}

class Reader {
  private readonly view: DataView;
  offset = 0;
  constructor(buf: ArrayBuffer) { this.view = new DataView(buf); }
  u8() { return this.view.getUint8(this.offset++); }
  i8() { return this.view.getInt8(this.offset++); }
  u16() { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  i16() { const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  f32() { const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }
  text() { const n = this.u8(); const bytes = new Uint8Array(this.view.buffer, this.offset, n); this.offset += n; return new TextDecoder().decode(bytes); }
}

const clampI16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v)));

function writeTurret(w: Writer, t: TurretState): void {
  w.f32(t.yaw);
  w.f32(t.pitch);
  w.u8(Math.round(Math.min(1, t.flywheel) * 255));
}

const readTurret = (r: Reader): TurretState => ({ yaw: r.f32(), pitch: r.f32(), flywheel: r.u8() / 255 });

export function encodeState(s: WorldState): ArrayBuffer {
  const w = new Writer();
  w.u8(VERSION);
  w.f32(s.time);
  w.u8(PERIODS.indexOf(s.period));
  w.f32(s.periodTime);
  w.u8((s.hubs.red ? 1 : 0) | (s.hubs.blue ? 2 : 0));
  w.u8(s.autoWinner ? ALLIANCE_CODE[s.autoWinner] : 0);
  for (const a of ['red', 'blue'] as const) {
    for (const k of SCORE_FIELDS) w.u16(s.score[a][k]);
    const climbed = s.score[a].autoClimbed;
    w.u8(climbed.length);
    for (const slot of climbed) w.u8(SLOTS.indexOf(slot));
    const levels = Object.entries(s.score[a].levels) as [Slot, number][];
    w.u8(levels.length);
    for (const [slot, level] of levels) {
      w.u8(SLOTS.indexOf(slot));
      w.u8(level);
    }
  }
  w.u8(s.robots.length);
  for (const r of s.robots) {
    w.u8(SLOTS.indexOf(r.slot));
    const team = ROBOTS.findIndex(d => d.id === r.robot);
    if (team < 0 && isCustomRobotId(r.robot)) {
      w.u8(CUSTOM);
      w.text(r.robot);
    } else {
      w.u8(Math.max(0, team));
    }
    for (const v of [r.x, r.y, r.z, r.yaw, r.heading, r.speed, r.turretYaw, r.pitch, r.flywheel, r.shotSpeed, r.shotDistance, r.climb]) w.f32(v);
    w.i8(r.intakeDir);
    w.u8(r.transfer ? 1 : 0);
    w.u8(STATUSES.indexOf(r.status));
    w.u8(r.level);
    for (const v of [r.powers.fl, r.powers.fr, r.powers.bl, r.powers.br]) w.i8(Math.round(v * 127));
    w.u8(r.stored.length);
    for (const id of r.stored) w.u16(id);
    // Centivolts, like the Driver Station's two decimals.
    w.u16(Math.round(r.voltage * 100));
    w.u16(Math.round(r.minVoltage * 100));
    w.u8(r.extraTurrets.length);
    for (const t of r.extraTurrets) writeTurret(w, t);
  }
  const n = s.balls.states.length;
  w.u16(n);
  for (let i = 0; i < n; i++) {
    w.u8(s.balls.states[i]);
    const t = s.balls.transforms;
    // Millimetres and unit-quaternion components fit in 16 bits.
    for (let k = 0; k < 3; k++) w.i16(clampI16(t[i * 7 + k] * 1000));
    for (let k = 3; k < 7; k++) w.i16(clampI16(t[i * 7 + k] * 32767));
  }
  return w.done();
}

export function decodeState(buf: ArrayBuffer): WorldState {
  const r = new Reader(buf);
  const version = r.u8();
  if (version !== VERSION) throw new Error('snapshot version mismatch');
  const time = r.f32();
  const period = PERIODS[r.u8()];
  const periodTime = r.f32();
  const lit = r.u8();
  const hubs = { red: (lit & 1) !== 0, blue: (lit & 2) !== 0 };
  const winner = r.u8();
  const autoWinner = winner === 1 ? 'red' : winner === 2 ? 'blue' : null;
  const score = { red: emptyScore(), blue: emptyScore() };
  for (const a of ['red', 'blue'] as const) {
    for (const k of SCORE_FIELDS) score[a][k] = r.u16();
    score[a].autoClimbed = Array.from({ length: r.u8() }, () => SLOTS[r.u8()]);
    const n = r.u8();
    for (let i = 0; i < n; i++) {
      const slot = SLOTS[r.u8()];
      score[a].levels[slot] = r.u8();
    }
  }
  const robots: RobotState[] = [];
  const count = r.u8();
  for (let i = 0; i < count; i++) {
    const slot = SLOTS[r.u8()];
    const index = r.u8();
    const robot = index === CUSTOM ? r.text() : ROBOTS[index]?.id ?? ROBOTS[0].id;
    const [x, y, z, yaw, heading, speed, turretYaw, pitch, flywheel, shotSpeed, shotDistance, climb] = Array.from({ length: 12 }, () => r.f32());
    const intakeDir = r.i8();
    const transfer = r.u8() !== 0;
    const status = STATUSES[r.u8()];
    const level = r.u8();
    const [fl, fr, bl, br] = Array.from({ length: 4 }, () => r.i8() / 127);
    const stored = Array.from({ length: r.u8() }, () => r.u16());
    const voltage = r.u16() / 100;
    const minVoltage = r.u16() / 100;
    const extraTurrets = Array.from({ length: r.u8() }, () => readTurret(r));
    robots.push({ slot, robot, x, y, z, yaw, heading, speed, turretYaw, pitch, flywheel, intakeDir, transfer, status, shotSpeed, shotDistance, powers: { fl, fr, bl, br }, stored, voltage, minVoltage, climb, level, extraTurrets });
  }
  const n = r.u16();
  const states = new Uint8Array(n);
  const transforms = new Float32Array(n * 7);
  for (let i = 0; i < n; i++) {
    states[i] = r.u8();
    for (let k = 0; k < 3; k++) transforms[i * 7 + k] = r.i16() / 1000;
    for (let k = 3; k < 7; k++) transforms[i * 7 + k] = r.i16() / 32767;
  }
  return { time, period, periodTime, hubs, autoWinner, score, robots, balls: { states, transforms } };
}
