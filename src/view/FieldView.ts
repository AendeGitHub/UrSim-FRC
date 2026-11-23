// The REBUILT field in 3D, drawn from the same sizes as the physics (game/field.ts).
// When the official CAD arrives it can replace these shapes; the positions stay.

import * as THREE from 'three';
import {
  ALLIANCE_ZONE, BUMP, DEPOT, FIELD, HALF_L, HALF_W, HUB, IN, OUTPOST, RED, TOWER, TRENCH,
  intoField, place, rng, type Vec2,
} from '../game/field';
import { ALLIANCES, type Alliance } from '../game/types';

export const COLORS = {
  red: 0xe0383d,
  blue: 0x2f6fe4,
  carpet: 0x5b5f66,
  metal: 0x9aa3ad,
  dark: 0x23272e,
  hdpe: 0xe9ecef,
  yellow: 0xf2c230,
};

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...extra });

function box(sx: number, sy: number, sz: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function carpetTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6a6e75';
  g.fillRect(0, 0, 256, 256);
  const r = rng(5);
  for (let i = 0; i < 9000; i++) {
    const v = 90 + Math.floor(r() * 40);
    g.fillStyle = `rgba(${v},${v + 2},${v + 6},0.35)`;
    g.fillRect(r() * 256, r() * 256, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(FIELD.length / 1.2, FIELD.width / 1.2);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A made-up AprilTag-looking square (not a real 36h11 code; the real ones come with the CAD). */
function tagTexture(id: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 80;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 80, 80);
  g.fillStyle = '#000';
  g.fillRect(10, 10, 60, 60);
  const r = rng(id * 97);
  g.fillStyle = '#fff';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (r() < 0.5) g.fillRect(16 + i * 8, 16 + j * 8, 8, 8);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tag(id: number): THREE.Mesh {
  const s = 8.125 * IN;
  return new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ map: tagTexture(id) }));
}

export class FieldView {
  readonly group = new THREE.Group();
  /** Light strips on each HUB: lit while the HUB is active */
  private readonly hubLights: Record<Alliance, THREE.MeshStandardMaterial> = {} as never;
  private readonly hubBeacons: Record<Alliance, THREE.PointLight> = {} as never;
  /** OUTPOST CHUTE fill bars (how much FUEL the human player has left) */
  private readonly chuteFill: Record<Alliance, THREE.Mesh> = {} as never;
  private tagId = 1;

  constructor() {
    this.buildFloor();
    this.buildWalls();
    for (const a of ALLIANCES) this.buildSide(a);
  }

  private buildFloor(): void {
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.length, FIELD.width), mat(0xffffff, { map: carpetTexture(), roughness: 0.95 }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.receiveShadow = true;
    this.group.add(carpet);
    const tape = (x: number, z: number, sx: number, sz: number, color: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.002, z);
      m.receiveShadow = true;
      this.group.add(m);
    };
    const w = 2 * IN;
    // CENTER LINE, ROBOT STARTING LINES, ALLIANCE ZONE edges
    tape(0, 0, w, FIELD.width, 0xffffff);
    for (const a of ALLIANCES) {
      const s = a === 'red' ? -1 : 1;
      const col = COLORS[a];
      tape(s * (HALF_L - ALLIANCE_ZONE), 0, w, FIELD.width, col);
      // HUMAN STARTING LINE, 24 in from the wall
      tape(s * (HALF_L - 24 * IN), 0, w, FIELD.width * 0.92, col);
    }
    // The dark arena floor around the field
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), mat(0x1a1d23, { roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  private buildWalls(): void {
    const poly = new THREE.MeshPhysicalMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0.16, roughness: 0.1, depthWrite: false });
    const rail = mat(COLORS.metal, { metalness: 0.6, roughness: 0.4 });
    for (const s of [1, -1]) {
      const z = s * (HALF_W + 0.02);
      this.group.add(box(FIELD.length, FIELD.rail, 0.01, poly, 0, FIELD.rail / 2, z));
      this.group.add(box(FIELD.length, 0.04, 0.05, rail, 0, FIELD.rail, z));
      this.group.add(box(FIELD.length, 0.06, 0.05, rail, 0, 0.03, z));
      for (let x = -HALF_L; x <= HALF_L + 0.01; x += FIELD.length / 10) this.group.add(box(0.04, FIELD.rail, 0.05, rail, x, FIELD.rail / 2, z));
    }
  }

  private buildSide(a: Alliance): void {
    const P = (p: Vec2) => place(a, p);
    const dir = intoField(a);
    const col = COLORS[a];
    const wallX = a === 'red' ? -HALF_L : HALF_L;
    // ALLIANCE WALL: frame, polycarbonate panels, three DRIVER STATIONS with shelves.
    const frame = mat(COLORS.dark, { metalness: 0.4 });
    const panel = new THREE.MeshPhysicalMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false });
    this.group.add(box(0.05, 0.9, FIELD.width, mat(col, { roughness: 0.5 }), wallX - dir * 0.03, 0.45, 0));
    this.group.add(box(0.03, FIELD.wall - 0.9, FIELD.width, panel, wallX - dir * 0.03, 0.9 + (FIELD.wall - 0.9) / 2, 0));
    this.group.add(box(0.08, 0.08, FIELD.width, frame, wallX - dir * 0.03, FIELD.wall, 0));
    for (const z of RED.stations) {
      const zz = a === 'red' ? z : -z;
      this.group.add(box(0.06, FIELD.wall, 0.06, frame, wallX - dir * 0.03, FIELD.wall / 2, zz + 0.9));
    }

    // HUB
    const [hx, hz] = P(RED.hub);
    const hub = new THREE.Group();
    hub.position.set(hx, 0, hz);
    const shell = mat(0x4a505a, { metalness: 0.35, roughness: 0.5 });
    hub.add(box(HUB.size, HUB.floor, HUB.size, shell, 0, HUB.floor / 2, 0));
    const upper = new THREE.MeshPhysicalMaterial({ color: col, transparent: true, opacity: 0.35, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide });
    const wallH = HUB.height - HUB.floor;
    for (const s of [1, -1]) {
      hub.add(box(0.03, wallH, HUB.size, upper, s * (HUB.size / 2 - 0.015), HUB.floor + wallH / 2, 0));
      hub.add(box(HUB.size, wallH, 0.03, upper, 0, HUB.floor + wallH / 2, s * (HUB.size / 2 - 0.015)));
    }
    // The hexagonal opening ring on top
    const ring = new THREE.Mesh(new THREE.TorusGeometry(HUB.opening / 2, 0.035, 8, 6), mat(col, { emissive: col, emissiveIntensity: 0.3 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = HUB.height + 0.02;
    hub.add(ring);
    // Light strips around the base and the rim: bright while active
    const light = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.5 });
    this.hubLights[a] = light;
    for (const s of [1, -1]) {
      hub.add(box(HUB.size + 0.02, 0.05, 0.02, light, 0, HUB.height - 0.03, s * (HUB.size / 2 + 0.01)));
      hub.add(box(0.02, 0.05, HUB.size + 0.02, light, s * (HUB.size / 2 + 0.01), HUB.height - 0.03, 0));
      hub.add(box(HUB.size + 0.02, 0.04, 0.02, light, 0, 0.5, s * (HUB.size / 2 + 0.01)));
    }
    // Four exits facing the NEUTRAL ZONE
    for (let k = 0; k < 4; k++) hub.add(box(0.02, 0.2, 0.22, mat(0x0d0f12), dir * (HUB.size / 2 + 0.005), 0.12, (k - 1.5) * 0.28));
    // Net at the back
    hub.add(box(0.02, 0.6, HUB.size * 0.9, new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.5 }), -dir * (HUB.size / 2 + 0.02), HUB.height + 0.3, 0));
    for (const s of [1, -1]) {
      const t = tag(this.tagId++);
      t.position.set(-dir * (HUB.size / 2 + 0.003), HUB.tagHeight, s * 0.3);
      t.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      hub.add(t);
      const t2 = tag(this.tagId++);
      t2.position.set(dir * (HUB.size / 2 + 0.003), HUB.tagHeight, s * 0.3);
      t2.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      hub.add(t2);
    }
    const beacon = new THREE.PointLight(col, 4, 6, 1.5);
    beacon.position.set(0, HUB.height + 0.4, 0);
    hub.add(beacon);
    this.hubBeacons[a] = beacon;
    this.group.add(hub);

    // BUMPS: HDPE ramps with alliance-colored edges
    for (const b of RED.bumps) {
      const [bx, bz] = P(b);
      const shape = new THREE.Shape();
      shape.moveTo(-BUMP.depth / 2, 0);
      shape.lineTo(-0.07, BUMP.height);
      shape.lineTo(0.07, BUMP.height);
      shape.lineTo(BUMP.depth / 2, 0);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: BUMP.width, bevelEnabled: false });
      geo.translate(0, 0, -BUMP.width / 2);
      const m = new THREE.Mesh(geo, mat(COLORS.hdpe, { roughness: 0.4 }));
      m.position.set(bx, 0, bz);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      for (const s of [1, -1]) this.group.add(box(BUMP.depth, 0.03, 0.03, mat(col), bx, 0.015, bz + s * (BUMP.width / 2)));
    }

    // TRENCHES: two legs and the arm, yellow and black
    for (const tr of RED.trenches) {
      const [tx, tz] = P(tr);
      const width = RED.trenchWidth;
      const leg = (width - TRENCH.clearWidth) / 2;
      const legMat = mat(COLORS.dark, { metalness: 0.4 });
      for (const s of [1, -1]) this.group.add(box(TRENCH.depth, TRENCH.height, leg, legMat, tx, TRENCH.height / 2, tz + s * (width / 2 - leg / 2)));
      const armH = TRENCH.height - TRENCH.clearHeight;
      const arm = box(TRENCH.depth * 0.5, armH, width, mat(COLORS.yellow, { roughness: 0.5 }), tx, TRENCH.clearHeight + armH / 2, tz);
      this.group.add(arm);
      for (let i = 0; i < 5; i++) this.group.add(box(TRENCH.depth * 0.5 + 0.004, 0.06, 0.12, mat(0x111111), tx, TRENCH.clearHeight + 0.05, tz - width / 2 + 0.2 + i * (width - 0.4) / 4));
      const t = tag(this.tagId++);
      t.position.set(tx + dir * (TRENCH.depth * 0.25 + 0.003), TRENCH.tagHeight, tz);
      t.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(t);
    }

    // TOWER
    const [cx, cz] = P(RED.tower);
    const tower = new THREE.Group();
    tower.position.set(cx, 0, cz);
    const steel = mat(COLORS.metal, { metalness: 0.7, roughness: 0.35 });
    tower.add(box(TOWER.baseDepth, 0.03, TOWER.baseWidth, mat(col, { roughness: 0.6 }), 0, 0.015, 0));
    const front = dir * (TOWER.depth / 2 - TOWER.uprightDeep / 2);
    for (const s of [1, -1]) tower.add(box(TOWER.uprightDeep, TOWER.uprightHeight, TOWER.uprightThick, steel, front, TOWER.uprightHeight / 2, s * (TOWER.uprightGap / 2 + TOWER.uprightThick / 2)));
    const rungLen = TOWER.uprightGap + 2 * TOWER.uprightThick + 2 * TOWER.rungOverhang;
    TOWER.rungs.forEach((y, i) => {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(TOWER.rungRadius, TOWER.rungRadius, rungLen, 12), mat([0xc7ccd3, 0xd8b23a, 0xe8e8e8][i], { metalness: 0.8, roughness: 0.3 }));
      rung.rotation.x = Math.PI / 2;
      rung.position.set(front, y, 0);
      rung.castShadow = true;
      tower.add(rung);
    });
    tower.add(box(0.06, TOWER.height, TOWER.width, mat(col, { roughness: 0.6 }), -dir * (TOWER.depth / 2 - 0.05), TOWER.height / 2, 0));
    const t = tag(this.tagId++);
    t.position.set(-dir * (TOWER.depth / 2 - 0.09), 21.75 * IN, 0);
    t.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    tower.add(t);
    this.group.add(tower);

    // DEPOT
    const [dx, dz] = P(RED.depot);
    const steelDark = mat(0x3a3f47, { metalness: 0.6 });
    this.group.add(box(0.076, DEPOT.barrier, DEPOT.width, steelDark, dx + dir * (DEPOT.depth / 2), DEPOT.barrier / 2, dz));
    for (const s of [1, -1]) this.group.add(box(DEPOT.depth, DEPOT.barrier, 0.076, steelDark, dx, DEPOT.barrier / 2, dz + s * (DEPOT.width / 2)));

    // OUTPOST: the CHUTE box in the corner and the CORRAL in front of it
    const [, oz] = P(RED.outpost);
    const chuteX = wallX - dir * 0.35;
    const chute = box(0.6, 1.1, OUTPOST.width, mat(col, { roughness: 0.6 }), chuteX, 0.85, oz);
    chute.rotation.z = dir * 0.26;
    this.group.add(chute);
    const fill = box(0.05, 1, 0.08, new THREE.MeshStandardMaterial({ color: COLORS.yellow, emissive: COLORS.yellow, emissiveIntensity: 0.6 }), chuteX + dir * 0.31, 0.85, oz);
    this.group.add(fill);
    this.chuteFill[a] = fill;
  }

  /** HUB lights and OUTPOST CHUTE gauges for this frame. */
  update(active: Record<Alliance, boolean>, chuteLeft: Record<Alliance, number>, time: number): void {
    for (const a of ALLIANCES) {
      const on = active[a];
      const pulse = on ? 1.4 + Math.sin(time * 6) * 0.25 : 0.05;
      this.hubLights[a].emissiveIntensity = pulse;
      this.hubLights[a].color.setHex(on ? COLORS[a] : 0x333333);
      this.hubBeacons[a].intensity = on ? 4 : 0;
      const f = Math.max(0.02, chuteLeft[a] / OUTPOST.fuel);
      this.chuteFill[a].scale.y = f;
    }
  }
}
