// One match on screen: the world, its picture, the cameras, the driver and the bots.

import * as THREE from 'three';
import { HALF_L, HALF_W, RED, hubCenter, intoField } from './game/field';
import { ROBOTS } from './game/robots';
import { MATCH_LENGTH } from './game/rules';
import { slotAlliance, type Alliance } from './game/types';
import { Input, type DriverState } from './input/Input';
import { Bot, type AutoPlan, type BotLevel } from './sim/Bot';
import type { Robot } from './sim/Robot';
import { PHYSICS_DT, World, type MatchEvent } from './sim/World';
import { FieldView } from './view/FieldView';
import { FuelView } from './view/FuelView';
import { RobotView } from './view/RobotView';

export interface MatchSetup {
  practice: boolean;
  slot: number;
  robotId: string;
  auto: AutoPlan;
  level: BotLevel;
  /** Bots on the field besides the player (practice may have none) */
  bots: boolean;
}

export type CameraMode = 'driver' | 'chase' | 'top';
const CAMERAS: CameraMode[] = ['driver', 'chase', 'top'];

/** Team numbers painted on the bumpers (made up; the player's is first). */
const TEAMS = ['7777', '1690', '254', '4414', '1323', '2910'];

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
  readonly input = new Input();
  world!: World;
  player!: Robot;
  private bots: Bot[] = [];
  private playerAuto: Bot | null = null;
  private field = new FieldView();
  private fuelView!: FuelView;
  private robotViews: RobotView[] = [];
  private robotGroup = new THREE.Group();
  cameraMode: CameraMode = 'driver';
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private acc = 0;
  private last = 0;
  paused = false;
  setup!: MatchSetup;
  /** Called every frame with the latest driver state (HUD), and on match events */
  onFrame: (d: DriverState) => void = () => {};
  onEvent: (e: MatchEvent) => void = () => {};
  onPause: () => void = () => {};
  /** Set while a menu is in front: the field idles behind it with a slow orbit */
  showcase = true;
  private orbit = 0;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.prepend(this.renderer.domElement);
    this.buildArena();
    this.scene.add(this.field.group, this.robotGroup);
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildArena(): void {
    this.scene.background = new THREE.Color(0x0f1216);
    this.scene.fog = new THREE.Fog(0x0f1216, 22, 60);
    this.scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x1a1d23, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-4, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -HALF_L - 1;
    sc.right = HALF_L + 1;
    sc.top = HALF_W + 1.5;
    sc.bottom = -HALF_W - 1.5;
    sc.far = 40;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    for (const x of [-6, 0, 6]) {
      const spot = new THREE.PointLight(0xffffff, 18, 18, 1.6);
      spot.position.set(x, 7, 0);
      this.scene.add(spot);
    }
    // Stands along both long sides, as in an arena
    const seat = new THREE.MeshStandardMaterial({ color: 0x1b2a55, roughness: 0.8 });
    const step = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 1 });
    for (const s of [1, -1]) {
      for (let i = 0; i < 9; i++) {
        const y = 0.6 + i * 0.45;
        const z = s * (HALF_W + 3 + i * 0.8);
        const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(30, 0.45, 0.8), step);
        stepMesh.position.set(0, y - 0.22, z);
        this.scene.add(stepMesh);
        const row = new THREE.Mesh(new THREE.BoxGeometry(28, 0.35, 0.4), seat);
        row.position.set(0, y + 0.15, z - s * 0.1);
        this.scene.add(row);
      }
      const glow = new THREE.Mesh(new THREE.BoxGeometry(30, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0x9fb4ff }));
      glow.position.set(0, 0.55, s * (HALF_W + 2.6));
      this.scene.add(glow);
    }
  }

  private resize(): void {
    const w = this.host.clientWidth || innerWidth;
    const h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** A new world with the field, FUEL and robots; the menu showcase uses one with idle bots. */
  load(setup: MatchSetup): void {
    this.setup = setup;
    this.robotGroup.clear();
    this.robotViews = [];
    if (this.fuelView) this.scene.remove(this.fuelView.mesh);
    if (this.world) this.world.world.free();
    const w = new World({ practice: setup.practice });
    this.world = w;
    const slots = setup.bots ? [0, 1, 2, 3, 4, 5] : [setup.slot];
    const ids = ROBOTS.map(r => r.id);
    const order = [setup.slot, ...slots.filter(s => s !== setup.slot)];
    order.forEach((s, i) => {
      const id = s === setup.slot ? setup.robotId : ids[(s + 1) % ids.length];
      const r = w.addRobot(s, id);
      this.robotViews.push(new RobotView(r, TEAMS[i], s === setup.slot));
    });
    for (const v of this.robotViews) this.robotGroup.add(v.group);
    this.player = w.robot(setup.slot)!;
    const plans: AutoPlan[] = ['shoot', 'collect', 'climb'];
    this.bots = w.robots.filter(r => r !== this.player).map(r => new Bot(w, r, setup.level, plans[r.slot % 3]));
    this.playerAuto = setup.practice ? null : new Bot(w, this.player, 'hard', setup.auto);
    this.fuelView = new FuelView(w);
    this.scene.add(this.fuelView.mesh);
    w.onEvent = e => this.onEvent(e);
    w.reset();
    this.acc = 0;
    this.paused = false;
    this.snapCamera();
  }

  start(): void {
    this.showcase = false;
    this.world.start();
  }

  restart(): void {
    this.load(this.setup);
    this.start();
  }

  nextCamera(): void {
    this.cameraMode = CAMERAS[(CAMERAS.indexOf(this.cameraMode) + 1) % CAMERAS.length];
    this.snapCamera();
  }

  /** The way "up" on the stick points on the field (x, z). */
  private driveForward(): [number, number] {
    const a: Alliance = slotAlliance(this.setup.slot);
    if (this.cameraMode === 'chase') {
      const d = new THREE.Vector3();
      this.camera.getWorldDirection(d);
      const n = Math.hypot(d.x, d.z) || 1;
      return [d.x / n, d.z / n];
    }
    return [intoField(a), 0];
  }

  private applyDriver(d: DriverState): void {
    const r = this.player;
    if (d.toggleIntake) r.intakeOn = !r.intakeOn;
    if (this.playerAuto && this.world.isAuto) {
      this.playerAuto.update(PHYSICS_DT);
      return;
    }
    const [fx, fz] = this.driveForward();
    // right = forward turned a quarter clockwise seen from above
    const rx = -fz, rz = fx;
    r.input.vx = fx * d.moveY + rx * d.moveX;
    r.input.vz = fz * d.moveY + rz * d.moveX;
    r.input.turn = d.turn;
    r.input.shoot = d.shoot;
    r.input.climb = d.climb;
    r.input.intake = d.intake;
  }

  frame(now: number): void {
    const dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 0);
    this.last = now;
    const d = this.input.read();
    if (!this.showcase) {
      if (d.pause) this.onPause();
      if (d.camera) this.nextCamera();
      if (d.reset && this.world.practice) this.world.reset();
    }
    if (!this.paused && this.world) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= PHYSICS_DT && n < 8) {
        if (!this.showcase) this.applyDriver(d);
        for (const b of this.bots) b.update(PHYSICS_DT);
        this.world.step();
        this.acc -= PHYSICS_DT;
        n++;
      }
      if (n === 8) this.acc = 0;
    }
    if (this.world) {
      this.fuelView.update();
      for (const v of this.robotViews) v.update(dt);
      this.field.update({ red: this.world.hubOn('red'), blue: this.world.hubOn('blue') }, { red: this.world.chute.red.length, blue: this.world.chute.blue.length }, now / 1000);
      this.updateCamera(dt);
    }
    this.renderer.render(this.scene, this.camera);
    this.onFrame(d);
  }

  private snapCamera(): void {
    this.updateCamera(0, true);
  }

  private updateCamera(dt: number, snap = false): void {
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (this.showcase) {
      this.orbit += dt * 0.06;
      pos.set(Math.cos(this.orbit) * 13, 7.5, Math.sin(this.orbit) * 9);
      look.set(0, 0, 0);
    } else {
      const a = slotAlliance(this.setup.slot);
      const dir = intoField(a);
      const [px, py, pz] = this.player.position;
      if (this.cameraMode === 'driver') {
        const st = RED.stations[this.setup.slot % 3] * (a === 'red' ? 1 : -1);
        // A driver's eyes, raised a little so the ALLIANCE WALL doesn't hide the near field
        pos.set(-dir * (HALF_L + 1.2), 4.2, st * 0.7);
        // Look between the robot and the middle of the field so both stay in view
        const [hx, hz] = hubCenter(a);
        look.set(px * 0.45 + (hx + dir * 3.5) * 0.55, 0, pz * 0.5 + hz * 0.5);
      } else if (this.cameraMode === 'chase') {
        const [fx, fz] = this.player.forward;
        pos.set(px - fx * 2.6, py + 1.7, pz - fz * 2.6);
        look.set(px + fx * 1.5, py + 0.4, pz + fz * 1.5);
      } else {
        pos.set(px * 0.4 - dir * 1.2, 15, pz * 0.3 + 0.01);
        look.set(px * 0.4, 0, pz * 0.3);
      }
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 5);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    if (snap) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    }
    this.camera.position.copy(this.camPos);
    if (!this.showcase && this.cameraMode === 'top') {
      // Top view: the alliance's "forward" points up the screen
      const a = slotAlliance(this.setup.slot);
      this.camera.up.set(intoField(a), 0, 0);
    } else {
      this.camera.up.set(0, 1, 0);
    }
    this.camera.lookAt(this.camLook);
  }

  /** For the HUD: seconds left in the match. */
  get matchLeft(): number {
    return MATCH_LENGTH - this.world.time;
  }
}

