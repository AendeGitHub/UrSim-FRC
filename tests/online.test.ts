import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FieldLayout } from '../src/field/layout';
import { clampStart, startField } from '../src/field/startPose';
import { buildZones } from '../src/field/zones';
import type { AllianceScore } from '../src/game/scoring';
import type { RoomInfo } from '../src/net/lobbyProtocol';
import { GuestSession, HostSession, InputDecoder, InputEncoder, roomDrivers } from '../src/net/OnlineSession';
import type { Alliance } from '../src/robot/robotConfig';
import { robotById } from '../src/robot/robots';
import { DEFAULT_RULES } from '../src/sim/Referee';
import { parseColliders } from '../src/sim/colliders';
import { initPhysics } from '../src/sim/Simulation';
import { decodeState, encodeState } from '../src/sim/stateCodec';
import { idleInput } from '../src/sim/types';

const layout: FieldLayout = JSON.parse(fs.readFileSync('public/assets/field-layout.json', 'utf8'));
const bin = fs.readFileSync('public/assets/field-colliders.bin');
const colliders = parseColliders(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);

const room: RoomInfo = {
  id: 'abcdef', name: 'Admin', format: '3v3', players: 2, locked: false, running: true, mode: 'match', quick: false, adminId: 1, password: null,
  scoreDisplay: 'live', autoStartIn: null,
  ai: { red2: 'double-deck', blue2: 'twin-flywheel' }, rules: DEFAULT_RULES,
  members: [
    { id: 1, name: 'Admin', robot: 'skyline', slot: 'red1', start: null },
    { id: 2, name: 'Guest', robot: 'twin-flywheel', slot: 'blue1', start: null },
  ],
};

describe('online input', () => {
  it('sends sticks and buttons, and every press exactly once even when packets are lost', () => {
    const enc = new InputEncoder();
    const dec = new InputDecoder();
    dec.receive(enc.encode({ ...idleInput(), ly: -1, intake: true }));
    expect(dec.take()).toMatchObject({ ly: -1, intake: true, shooterOn: false });
    // A press in a packet that is lost still arrives with the next one.
    enc.encode({ ...idleInput(), shooterOn: true });
    dec.receive(enc.encode(idleInput()));
    expect(dec.take().shooterOn).toBe(true);
    expect(dec.take().shooterOn).toBe(false);
    // A late packet is skipped.
    const old = enc.encode({ ...idleInput(), lx: 1 });
    dec.receive(enc.encode({ ...idleInput(), lx: -1 }));
    dec.receive(old);
    expect(dec.take().lx).toBeCloseTo(-1);
  });

  it('sends the IMU reset press and the climber in 10 bytes; a lost press comes with the next packet, once', () => {
    const enc = new InputEncoder();
    const dec = new InputDecoder();
    const first = enc.encode(idleInput());
    expect(first).toHaveLength(10);
    dec.receive(first);
    dec.take();
    enc.encode({ ...idleInput(), imuReset: true });
    dec.receive(enc.encode({ ...idleInput(), climb: true, intake: true }));
    expect(dec.take()).toMatchObject({ imuReset: true, climb: true, intake: true });
    expect(dec.take().imuReset).toBe(false);
  });
});

describe('online match', () => {
  beforeAll(() => initPhysics());

  it("puts the AI where the admin placed it, with its robot, at the room's level", () => {
    const { drivers, ai } = roomDrivers({ ...room, aiLevel: 'hard' });
    expect(drivers.map(d => d.slot)).toEqual(['red1', 'blue1']);
    expect(ai).toEqual([{ slot: 'red2', robot: 'double-deck', level: 'hard' }, { slot: 'blue2', robot: 'twin-flywheel', level: 'hard' }]);
    // A room from an older server has no level: the usual one.
    expect(roomDrivers(room).ai.map(d => d.level)).toEqual(['medium', 'medium']);
  });

  it("starts each player's robot where they put it", () => {
    // On the ROBOT STARTING LINE, toward the audience
    const field = startField(buildZones(layout));
    const start = clampStart({ x: field.line - 0.44, z: 1.9, yaw: 0 }, robotById('twin-flywheel').config, field);
    const placed = { ...room, members: room.members.map(m => (m.slot === 'blue1' ? { ...m, start } : m)) };
    expect(roomDrivers(placed).drivers.find(d => d.slot === 'blue1')?.start).toEqual(start);
    const host = new HostSession(layout, colliders, placed, 1, () => {}, { direct: () => true }, { toast() {}, finished() {} });
    const blue = host.state().robots.find(r => r.slot === 'blue1')!;
    // The guest picked it as for the red side; blue is the same turned about the field center.
    expect(blue.x).toBeCloseTo(-start.x, 3);
    expect(blue.z).toBeCloseTo(-start.z, 3);
    host.dispose();
  });

  it("packs the admin's world into a snapshot and back", () => {
    const host = new HostSession(layout, colliders, room, 1, () => {}, { direct: () => true }, { toast() {}, finished() {} });
    host.update(0.5, {});
    const state = host.state();
    const back = decodeState(encodeState(state));
    expect(back.robots.map(r => [r.slot, r.robot])).toEqual(state.robots.map(r => [r.slot, r.robot]));
    expect(back.robots[0].x).toBeCloseTo(state.robots[0].x, 4);
    expect(back.balls.states).toEqual(state.balls.states);
    expect(back.period).toBe(state.period);
    host.dispose();
  });

  it("drives the guest's robot from the guest's input and shows the admin's match to the guest", () => {
    const toGuest: Uint8Array[] = [];
    const finished: Record<Alliance, AllianceScore>[] = [];
    let guest!: GuestSession;
    // The guest starts in front of a BUMP: driving on, it goes over it.
    const field = startField(buildZones(layout));
    const start = { x: field.line - 0.44, z: -1.7, yaw: 0 };
    const placed = { ...room, members: room.members.map(m => (m.slot === 'blue1' ? { ...m, start } : m)) };
    const host = new HostSession(layout, colliders, placed, 1, (to, data) => to === 2 && toGuest.push(data), { direct: () => true }, { toast() {}, finished() {} });
    guest = new GuestSession(roomDrivers(placed).ai, 'blue1', 1, (to, data) => to === 1 && host.receive(2, data), { toast() {}, finished: s => finished.push(s) });

    const blueStart = host.state().robots.find(r => r.slot === 'blue1')!.x;
    for (let i = 0; i < 90; i++) {
      // The guest pushes forward (toward the red end for blue), the admin stands still.
      guest.update(1 / 60, { blue1: { ...idleInput(), ly: -1 } });
      host.update(1 / 60, { red1: idleInput() });
      host.frame(1 / 60, 0);
    }
    for (const msg of toGuest) guest.receive(1, msg);
    const blueNow = host.state().robots.find(r => r.slot === 'blue1')!.x;
    expect(blueNow).toBeLessThan(blueStart - 0.3);
    expect(guest.remoteStartIn).toBe(0);
    // The guest's own picture of the match (newest snapshot) has the robot there too.
    const seen = guest.state()!;
    expect(seen.robots).toHaveLength(4);

    // The end of the match reaches the guest with the final score.
    const sim = (host as unknown as { session: { simulation: { match: { next(p: string): void } } } }).session.simulation;
    sim.match.next('post');
    toGuest.length = 0;
    // FIELD settling time after the buzzer
    for (let i = 0; i < 240; i++) host.update(1 / 60, {});
    for (const msg of toGuest) guest.receive(1, msg);
    expect(finished).toHaveLength(1);
    expect(finished[0].red).toHaveProperty('calls');
    host.dispose();
  });
});
