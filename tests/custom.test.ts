import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Lobby, type LobbySocket } from '../server/Lobby';
import { parseReport } from '../server/api';
import { recordRun } from '../server/Stats';
import type { FieldLayout } from '../src/field/layout';
import type { ClientMessage, RoomInfo, ServerMessage } from '../src/net/lobbyProtocol';
import { roomDrivers } from '../src/net/OnlineSession';
import {
  DEFAULT_BLUEPRINT, DEFAULT_INTAKE, DEFAULT_TURRET, LIMITS, MAX_TURRETS, TURRET_LIMITS, cleanBlueprint, customDefinition, readShareCode,
  shareCode, sharedRobotId, withTurret, withoutMesh, withoutTurret, type Blueprint,
} from '../src/robot/custom';
import { CUSTOM_ROBOT, SKYLINE, addCustomRobot, isCustomRobotId, robotById } from '../src/robot/robots';
import { parseColliders } from '../src/sim/colliders';
import { DEFAULT_RULES } from '../src/sim/Referee';
import { PHYSICS_DT, Simulation, initPhysics } from '../src/sim/Simulation';
import { decodeState, encodeState } from '../src/sim/stateCodec';
import { idleInput } from '../src/sim/types';

const layout: FieldLayout = JSON.parse(fs.readFileSync('public/assets/field-layout.json', 'utf8'));
const bin = fs.readFileSync('public/assets/field-colliders.bin');
const colliders = parseColliders(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);
/** R101 frame perimeter and R105 height, m */
const PERIMETER = 110 * 0.0254;
const MAX_HEIGHT = 30 * 0.0254;

const blueprint = (patch: Partial<Blueprint> = {}) => cleanBlueprint({ ...DEFAULT_BLUEPRINT, ...patch })!;
const makeSim = () => new Simulation(layout, colliders, { toast: () => {}, finished: () => {} });
const run = (sim: Simulation, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / PHYSICS_DT); i++) sim.step();
};

describe('blueprints of player-made robots', () => {
  it('keeps every number in its range, text without markup, and cleaning a clean one changes nothing', () => {
    const turrets = Array.from({ length: 7 }, () => ({ ...DEFAULT_TURRET, height: 9, range: -5, facing: 1000 }));
    const bp = cleanBlueprint({ ...DEFAULT_BLUEPRINT, rpm: 99999, mass: -3, hopper: 500, climber: 7, name: ' <b>Rocket</b>\n2 ', number: 'No. 12a34', color: 'red', intake: { ...DEFAULT_INTAKE, rate: 99 }, backIntake: { kind: 'x' }, turrets })!;
    expect(bp.rpm).toBe(LIMITS.rpm.max);
    expect(bp.mass).toBe(LIMITS.mass.min);
    expect(bp.hopper).toBe(LIMITS.hopper.max);
    expect(bp.climber).toBe(3);
    expect(bp.name).not.toMatch(/[<>\n]/);
    expect(bp.number).toBe('1234');
    expect(bp.color).toBe(DEFAULT_BLUEPRINT.color);
    expect(bp.intake.rate).toBe(15);
    // A back intake made of nonsense is the usual intake.
    expect(bp.backIntake).toEqual({ ...DEFAULT_INTAKE });
    expect(bp.turrets).toHaveLength(MAX_TURRETS);
    expect(bp.turrets[0]).toMatchObject({ height: TURRET_LIMITS.height.max, range: 0, facing: 180 });
    expect(cleanBlueprint(bp)).toEqual(bp);
    for (const value of [null, 'robot', 42, [1, 2]]) expect(cleanBlueprint(value)).toBeNull();
    // Missing fields get the defaults.
    expect(cleanBlueprint({})).toEqual(cleanBlueprint(DEFAULT_BLUEPRINT));
    expect(blueprint({ turrets: [] }).turrets).toEqual([DEFAULT_TURRET]);
  });

  it('keeps the frame perimeter within 110 in and the robot under 30 in tall (R101, R105)', () => {
    const big = blueprint({ length: 1, width: 1, turrets: [{ ...DEFAULT_TURRET, height: 2 }] });
    const def = customDefinition('custom-big', big);
    const frame = (n: number) => n - 2 * 0.085;
    expect(2 * (frame(big.length) + frame(big.width))).toBeLessThanOrEqual(PERIMETER + 0.01);
    expect(def.config.height).toBeLessThanOrEqual(MAX_HEIGHT + 1e-6);
  });

  it('builds a robot with its hopper, climber and turrets', () => {
    const def = customDefinition('custom-parts', blueprint({ hopper: 30, climber: 2, turrets: [DEFAULT_TURRET, { ...DEFAULT_TURRET, z: 0.15 }] }));
    expect(def.extraTurrets).toHaveLength(1);
    expect(def.config.drive.maxWheelSpeed).toBeGreaterThan(3);
  });

  it('lays out up to four turrets neatly as they are added', () => {
    let bp = blueprint();
    for (let n = 2; n <= MAX_TURRETS; n++) {
      bp = blueprint({ ...bp, turrets: withTurret(bp, 0) });
      expect(bp.turrets).toHaveLength(n);
      bp.turrets.forEach((a, i) => {
        for (const b of bp.turrets.slice(i + 1)) expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)), `${n}`).toBeGreaterThan(0.1099);
      });
    }
    expect(withTurret(bp, 0)).toHaveLength(MAX_TURRETS);
    const three = blueprint({ ...bp, turrets: withoutTurret(bp, 3) });
    expect(three.turrets).toHaveLength(3);
    expect(withoutTurret(blueprint(), 0)).toHaveLength(1);
  });

  it('travels as a share code, without its 3D model, and goes by the same id in every game of an online room', () => {
    const bp = blueprint({ name: 'Ракета', mesh: { id: 'abcd1234', file: 'robot.glb', format: 'glb', scale: 0.001, up: 'z', turn: 1, signs: true } });
    const code = shareCode(bp);
    expect(code.startsWith('URSIM-ROBOT:')).toBe(true);
    expect(readShareCode(`My robot: ${code} — try it`)).toEqual(withoutMesh(bp));
    expect(readShareCode('URSIM-ROBOT:not a code')).toBeNull();
    expect(readShareCode('hello')).toBeNull();
    expect(sharedRobotId(bp)).toBe(sharedRobotId(withoutMesh(bp)));
    expect(sharedRobotId(bp)).not.toBe(sharedRobotId(blueprint({ ...bp, rpm: bp.rpm + 5 })));
    expect(isCustomRobotId(sharedRobotId(bp))).toBe(true);
  });

  it("a player-made robot this game doesn't have shows as the default robot, other unknown ids as Skyline", () => {
    expect(robotById('x-zzzzzzz').id).toBe(CUSTOM_ROBOT);
    expect(robotById('custom-unknown1').custom).toBeTruthy();
    expect(robotById('nobody').id).toBe(SKYLINE.id);
  });
});

describe('a player-made robot on the field', () => {
  beforeAll(() => initPhysics());

  it('drives at its top speed and takes FUEL off the carpet with its intake', () => {
    const def = customDefinition('custom-sim1', blueprint());
    addCustomRobot(def);
    const sim = makeSim();
    const p = sim.addRobot('red1', 'test', def.id);
    sim.start('practice');
    const preloads = p.mech.held;
    expect(preloads).toBeGreaterThan(0);

    // On open floor in the ALLIANCE ZONE, facing the audience.
    p.robot.setPose({ x: -6, z: -2, yaw: -Math.PI / 2 });
    sim.setInput('red1', { ...idleInput(), ly: -1, fieldCentric: false });
    let top = 0;
    for (let i = 0; i < 0.8 / PHYSICS_DT; i++) {
      sim.step();
      top = Math.max(top, p.robot.speed);
    }
    expect(top).toBeGreaterThan(def.config.drive.maxWheelSpeed * 0.85);

    // A FUEL in front of its intake.
    p.robot.setPose({ x: -6, z: -1, yaw: 0 });
    sim.setInput('red1', idleInput());
    run(sim, 0.3);
    const fuel = sim.balls.all.find(b => b.state === 'field')!;
    sim.balls.release(fuel, [-6 + def.intakeFront! + 0.06, fuel.radius, -1], [0, 0, 0]);
    sim.setInput('red1', { ...idleInput(), intake: true });
    run(sim, 0.5);
    expect(p.mech.stored).toContain(fuel);
  });

  it('online: snapshots carry its id and every turret', () => {
    const def = customDefinition('x-three00', blueprint({ turrets: [DEFAULT_TURRET, { ...DEFAULT_TURRET, z: 0.15 }, { ...DEFAULT_TURRET, z: -0.15, facing: 90 }] }));
    addCustomRobot(def);
    const sim = makeSim();
    sim.addRobot('red1', 'a', def.id);
    sim.addRobot('blue1', 'b', 'twin-flywheel');
    sim.start('practice');
    run(sim, 0.1);
    const state = sim.state();
    const back = decodeState(encodeState(state));
    expect(back.robots.map(r => r.robot)).toEqual(['x-three00', 'twin-flywheel']);
    expect(back.robots.map(r => r.extraTurrets.length)).toEqual([2, 1]);
    back.robots[0].extraTurrets.forEach((t, i) => expect(t.yaw).toBeCloseTo(state.robots[0].extraTurrets[i].yaw, 5));
  });
});

class FakeSocket implements LobbySocket {
  readonly messages: ServerMessage[] = [];
  send(m: ServerMessage) {
    this.messages.push(structuredClone(m));
  }
  sendBinary() {}
  get room(): RoomInfo | null {
    return ([...this.messages].reverse().find(m => m.t === 'room') as Extract<ServerMessage, { t: 'room' }> | undefined)?.room ?? null;
  }
}

describe('player-made robots online and in the statistics', () => {
  it("a room takes a player's own robot with its blueprint (without the 3D model); a robot without one falls back to Skyline", () => {
    const lobby = new Lobby();
    const players = ['Admin', 'Guest', 'Third'].map(name => {
      const socket = new FakeSocket();
      const id = lobby.connect(socket)!;
      const send = (m: ClientMessage) => lobby.message(id, m);
      send({ t: 'hello', name });
      return { id, socket, send };
    });
    const [admin, guest, third] = players;
    const bp = blueprint({ name: 'Rocket', mesh: { id: 'abcd1234', file: 'r.stl', format: 'stl', scale: 0.001, up: 'z', turn: 0, signs: true } });
    admin.send({ t: 'create', format: '3v3', robot: 'custom-abcd12', custom: bp, rules: DEFAULT_RULES });
    const room = admin.socket.room!;
    guest.send({ t: 'join', room: room.id, robot: 'custom-zzzz99' });
    third.send({ t: 'join', room: room.id, robot: 'kit-bot', custom: bp });
    const members = admin.socket.room!.members;
    expect(members[0]).toMatchObject({ robot: 'custom-abcd12', custom: withoutMesh(bp) });
    expect(members[1].robot).toBe('skyline');
    expect(members[2]).toMatchObject({ robot: 'kit-bot' });
    expect(members[2].custom).toBeUndefined();
    expect(roomDrivers(admin.socket.room!).drivers[0].robot).toBe(sharedRobotId(bp));

    admin.send({ t: 'robot', robot: 'twin-flywheel' });
    expect(admin.socket.room!.members[0]).toEqual(expect.objectContaining({ robot: 'twin-flywheel' }));
    expect(admin.socket.room!.members[0].custom).toBeUndefined();
  });

  it('a game with a player-made robot counts, but never goes into the high score tables', () => {
    const report = parseReport({ type: 'solo', mode: 'match', duration: 163, score: { red: 120, blue: 0 }, players: [{ alliance: 'red', robot: 'custom-abcd12' }], ai: [], device: 'device-12345678' });
    expect(report).not.toBeNull();
    expect(recordRun({ ...report!, players: report!.players })).toBeNull();
    const team = parseReport({ type: 'solo', mode: 'match', duration: 163, score: { red: 120, blue: 0 }, players: [{ alliance: 'red', robot: 'skyline' }], ai: [], device: 'device-12345678' });
    expect(recordRun({ ...team!, players: team!.players })).toBe('solo');
    expect(parseReport({ type: 'solo', mode: 'match', duration: 163, score: { red: 1, blue: 0 }, players: [{ alliance: 'red', robot: 'robot-of-mine' }], ai: [], device: 'device-12345678' })).toBeNull();
  });
});
