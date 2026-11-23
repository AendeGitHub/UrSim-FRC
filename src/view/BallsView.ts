// Draws all FUEL from a world state (one instanced mesh of yellow foam balls). The simulation moves a
// ball into the robot, along its queue and out of the shooter in one step; here those moves are
// eased over a few frames so you can see the intake take a ball and the shooter fire it.

import * as THREE from 'three';
import type { FieldLayout } from '../field/layout';
import { FUEL_RADIUS } from '../field/layout';
import { ballSpecs, type BallSpec } from '../sim/BallSim';
import type { WorldState } from '../sim/state';

/** FUEL: high-density foam balls, yellow (manual 5.10) */
export const FUEL_COLOR = '#f2c21b';

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const pos = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Vector3(0, 0, 0);

/** How long each move is eased, s */
const EASE = { pickup: 0.22, shift: 0.14, launch: 0.09 };

/** A ball inside a robot: where it sits, and which place in which robot (to notice it moving up). */
export interface HeldBall {
  pos: [number, number, number];
  place: string;
}

/** The FUEL ball: a sphere whose surface is dimpled a little, like moulded foam. */
export function fuelGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(FUEL_RADIUS, 3);
  const p = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const dimple = 1 - 0.025 * Math.max(0, Math.sin(n.x * 17) * Math.sin(n.y * 17) * Math.sin(n.z * 17));
    v.copy(n).multiplyScalar(FUEL_RADIUS * dimple);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export class BallsView {
  /** Same order as the simulation's ball ids. */
  readonly specs: BallSpec[];
  private readonly mesh: THREE.InstancedMesh;
  /** Per ball: where it was drawn last, how far that is from where it now is, and the ease left */
  private readonly shown: Float32Array;
  private readonly offset: Float32Array;
  private readonly easeLeft: Float32Array;
  private readonly easeTime: Float32Array;
  private readonly lastState: Int8Array;
  private readonly lastPlace: string[];

  constructor(layout: FieldLayout, scene: THREE.Scene) {
    this.specs = ballSpecs(layout);
    const n = this.specs.length;
    this.shown = new Float32Array(n * 3);
    this.offset = new Float32Array(n * 3);
    this.easeLeft = new Float32Array(n);
    this.easeTime = new Float32Array(n);
    this.lastState = new Int8Array(n).fill(-1);
    this.lastPlace = new Array<string>(n).fill('');
    this.mesh = new THREE.InstancedMesh(fuelGeometry(), new THREE.MeshStandardMaterial({ color: FUEL_COLOR, roughness: 0.75 }), n);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }

  /** `held` places balls that are inside a robot (by ball id); other held balls are hidden. */
  update(balls: WorldState['balls'], held: Map<number, HeldBall> = new Map(), dt = 0): void {
    const t = balls.transforms;
    this.specs.forEach((_, i) => {
      const state = balls.states[i];
      const h = state === 1 ? held.get(i) : undefined;
      if (state === 1 && !h) {
        // Held by a robot that isn't drawn
        this.mesh.setMatrixAt(i, matrix.compose(ZERO, quat.identity(), ZERO));
        this.lastState[i] = state;
        return;
      }
      const target = h ? h.pos : [t[i * 7], t[i * 7 + 1], t[i * 7 + 2]];
      this.startEase(i, state, h?.place ?? '', target);
      const o = i * 3;
      let k = 0;
      if (this.easeLeft[i] > 0) {
        this.easeLeft[i] = Math.max(0, this.easeLeft[i] - dt);
        const r = this.easeLeft[i] / this.easeTime[i];
        k = r * r; // fast at first, settling at the end
      }
      pos.set(target[0] + this.offset[o] * k, target[1] + this.offset[o + 1] * k, target[2] + this.offset[o + 2] * k);
      pos.toArray(this.shown, o);
      if (h) quat.identity();
      else quat.set(t[i * 7 + 3], t[i * 7 + 4], t[i * 7 + 5], t[i * 7 + 6]).normalize();
      this.mesh.setMatrixAt(i, matrix.compose(pos, quat, ONE));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** A pickup, a move up the robot's queue or a shot starts an ease from where the ball was drawn. */
  private startEase(i: number, state: number, place: string, target: number[]): void {
    const was = this.lastState[i];
    const duration = was === 0 && state === 1 ? EASE.pickup
      : was === 1 && state === 1 && place !== this.lastPlace[i] ? EASE.shift
        : was === 1 && state === 0 ? EASE.launch
          : 0;
    this.lastState[i] = state;
    this.lastPlace[i] = place;
    if (duration) {
      const o = i * 3;
      for (let c = 0; c < 3; c++) this.offset[o + c] = this.shown[o + c] - target[c];
      this.easeLeft[i] = this.easeTime[i] = duration;
    } else if (was !== state) {
      // Anything else (a reset, a ball handed to the human player) just jumps.
      this.easeLeft[i] = 0;
    }
  }
}
