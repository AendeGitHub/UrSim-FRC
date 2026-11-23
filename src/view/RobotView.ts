// A robot drawn from its spec: bumpers in the alliance color with the team number, four swerve
// modules that steer and spin, a full-width intake, a hopper that fills with FUEL, a shooter.

import * as THREE from 'three';
import { FUEL } from '../game/field';
import type { Robot } from '../sim/Robot';
import { COLORS } from './FieldView';

function numberTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#fff';
  g.font = 'bold 46px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...extra });

export class RobotView {
  readonly group = new THREE.Group();
  private readonly modules: { steer: THREE.Group; wheel: THREE.Mesh }[] = [];
  private readonly intakeRoller: THREE.Mesh;
  private readonly hopperBalls: THREE.InstancedMesh;
  private readonly hood: THREE.Group;
  private readonly climber: THREE.Mesh;
  private readonly marker: THREE.Mesh;
  private spin = 0;

  constructor(readonly robot: Robot, team: string, isPlayer: boolean) {
    const s = robot.spec;
    const color = COLORS[robot.alliance];
    const css = robot.alliance === 'red' ? '#c8262c' : '#1f5bd0';
    const bumperH = 0.13;
    const bw = 0.08;
    const half = s.size / 2;
    const frame = half - bw;
    const label = new THREE.MeshStandardMaterial({ map: numberTexture(team, css), roughness: 0.8 });
    const plain = mat(color, { roughness: 0.85, metalness: 0 });
    // Bumpers: four padded sides, the number printed on each
    for (let i = 0; i < 4; i++) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(s.size, bumperH, bw), [plain, plain, plain, plain, label, label]);
      const a = (i * Math.PI) / 2;
      side.position.set(Math.cos(a) * (half - bw / 2), 0.03 + bumperH / 2, -Math.sin(a) * (half - bw / 2));
      side.rotation.y = a + Math.PI / 2;
      side.castShadow = true;
      this.group.add(side);
    }
    // Frame and belly pan
    const alu = mat(0x9aa3ad, { metalness: 0.7, roughness: 0.35 });
    const dark = mat(0x22262c, { metalness: 0.3 });
    const pan = new THREE.Mesh(new THREE.BoxGeometry(frame * 2, 0.02, frame * 2), dark);
    pan.position.y = 0.06;
    this.group.add(pan);
    for (const [x, z, sx, sz] of [[0, frame - 0.02, frame * 2, 0.04], [0, -frame + 0.02, frame * 2, 0.04], [frame - 0.02, 0, 0.04, frame * 2], [-frame + 0.02, 0, 0.04, frame * 2]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.05, sz), alu);
      rail.position.set(x, 0.11, z);
      rail.castShadow = true;
      this.group.add(rail);
    }
    // Swerve modules at the corners
    const t = s.track / 2;
    for (const [x, z] of [[t, -t], [t, t], [-t, -t], [-t, t]]) {
      const steer = new THREE.Group();
      steer.position.set(x, 0.05, z);
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 16), mat(0xd04a1a));
      housing.position.y = 0.09;
      steer.add(housing);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16), mat(0x111111, { roughness: 0.9 }));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.y = 0;
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.042), mat(0x777777));
      tread.position.set(0.045, 0, 0);
      wheel.add(tread);
      steer.add(wheel);
      this.group.add(steer);
      this.modules.push({ steer, wheel });
    }
    // Intake: a deployed full-width roller in front of the bumper
    this.intakeRoller = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, s.size - 0.06, 14), mat(0x3a8f3a, { roughness: 0.8 }));
    this.intakeRoller.rotation.x = Math.PI / 2;
    this.intakeRoller.position.set(half + 0.04, 0.07, 0);
    this.group.add(this.intakeRoller);
    for (const z of [-(half - 0.05), half - 0.05]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.02), alu);
      arm.position.set(half - 0.03, 0.12, z);
      arm.rotation.z = -0.35;
      this.group.add(arm);
    }
    // Hopper: a net box that shows the FUEL inside
    const hopperH = s.height - 0.2;
    const net = new THREE.Mesh(
      new THREE.BoxGeometry(frame * 1.7, hopperH, frame * 1.8),
      new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: 0.35, roughness: 0.9, depthWrite: false }),
    );
    net.position.set(-0.04, 0.16 + hopperH / 2, 0);
    this.group.add(net);
    this.hopperBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(FUEL.radius * 0.95, 10, 8), mat(0xf5c518, { roughness: 0.85, metalness: 0 }), s.capacity);
    this.hopperBalls.count = 0;
    const m = new THREE.Matrix4();
    const cols = Math.max(1, Math.floor((frame * 1.7) / (FUEL.radius * 2)));
    const rows = Math.max(1, Math.floor((frame * 1.8) / (FUEL.radius * 2)));
    for (let i = 0; i < s.capacity; i++) {
      const layer = Math.floor(i / (cols * rows));
      const k = i % (cols * rows);
      const x = -0.04 + ((k % cols) - (cols - 1) / 2) * FUEL.radius * 2;
      const z = (Math.floor(k / cols) - (rows - 1) / 2) * FUEL.radius * 2;
      m.makeTranslation(x, 0.17 + FUEL.radius + layer * FUEL.radius * 1.7, z);
      this.hopperBalls.setMatrixAt(i, m);
    }
    this.group.add(this.hopperBalls);
    // Shooter: a drum with a hood (or a turret ring)
    this.hood = new THREE.Group();
    this.hood.position.set(0.12, s.height - 0.06, 0);
    const drumW = s.look === 'turret' ? 0.22 : frame * 1.6;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, drumW, 16), mat(0x2b6cb0));
    drum.rotation.x = Math.PI / 2;
    this.hood.add(drum);
    const hoodPlate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, drumW + 0.02), mat(0x111111, { metalness: 0.5 }));
    hoodPlate.position.set(0.05, 0.06, 0);
    hoodPlate.rotation.z = 0.5;
    this.hood.add(hoodPlate);
    if (s.look === 'turret') {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 24), alu);
      ring.position.y = -0.07;
      this.hood.add(ring);
    }
    this.group.add(this.hood);
    // Climber hook
    this.climber = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), alu);
    this.climber.position.set(half - 0.15, s.height - 0.25, 0);
    this.group.add(this.climber);
    // Player marker: a soft ring on the floor
    this.marker = new THREE.Mesh(new THREE.RingGeometry(half + 0.1, half + 0.16, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.01;
    this.marker.visible = isPlayer;
    this.group.add(this.marker);
    this.group.traverse(o => {
      if (o instanceof THREE.Mesh && o !== this.marker) o.castShadow = true;
    });
  }

  update(dt: number): void {
    const r = this.robot;
    const t = r.body.translation();
    const q = r.body.rotation();
    this.group.position.set(t.x, t.y, t.z);
    this.group.quaternion.set(q.x, q.y, q.z, q.w);
    r.modules.forEach((ms, i) => {
      const md = this.modules[i];
      // Steer: smoothly toward the module angle (shortest way, wheels can run backwards)
      let target = ms.angle;
      const cur = md.steer.rotation.y;
      let diff = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
      let sign = 1;
      if (Math.abs(diff) > Math.PI / 2) {
        target += Math.PI;
        diff = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
        sign = -1;
      }
      if (ms.speed > 0.05) md.steer.rotation.y = cur + diff * Math.min(1, dt * 18);
      md.wheel.rotation.y -= (sign * ms.speed * dt) / 0.05;
    });
    const intaking = (r.input.intake || r.intakeOn) && r.hopper.length < r.spec.capacity && !r.hanging;
    this.spin += dt * (intaking ? 20 : 0);
    this.intakeRoller.rotation.y = this.spin;
    this.intakeRoller.visible = !r.hanging;
    this.hopperBalls.count = Math.min(r.hopper.length, r.spec.capacity);
    if (r.spec.look === 'turret') {
      const want = r.hubBearing() - r.yaw;
      this.hood.rotation.y += Math.atan2(Math.sin(want - this.hood.rotation.y), Math.cos(want - this.hood.rotation.y)) * Math.min(1, dt * 10);
    }
    // The climber reaches up while climbing
    const reach = r.hanging ? 0.75 : 0;
    this.climber.scale.y += (1 + reach * 2 - this.climber.scale.y) * Math.min(1, dt * 6);
    this.climber.position.y = r.spec.height - 0.25 + (this.climber.scale.y - 1) * 0.25;
  }
}
