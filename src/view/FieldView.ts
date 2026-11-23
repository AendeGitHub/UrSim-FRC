// REBUILT field graphics: the field CAD model in competition colours, the grey carpet with its tape
// lines (manual 5.3) and the HUB lights that show which HUB is active (the venue is view/Arena.ts).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CARPET_TILE, createCarpetTexture } from '../field/floorTexture';
import type { FieldLayout } from '../field/layout';
import { ALLIANCE_ZONE, HUB, IN } from '../frc/field';
import type { Alliance } from '../robot/robotConfig';
import { asset } from './assets';

/** The field parts that cast shadows */
const SHADOW_CASTERS = /^(hub_|tower_|trenches|outpost_)/;
/** The field model stores no normals; edges sharper than this stay sharp. */
const CREASE_ANGLE = (32 * Math.PI) / 180;
const ALLIANCE_COLOR: Record<Alliance, string> = { red: '#ff3434', blue: '#3a78ff' };
/** 2 in gaffers tape (manual 5.3) */
const TAPE = 2 * IN;

/**
 * The practice field CAD is plywood; the competition field is aluminium, black HDPE and
 * polycarbonate with ALLIANCE colours. Its plywood is painted per part (by node name).
 */
const PAINT: { match: RegExp; wood: string | ((a: Alliance) => string) }[] = [
  { match: /^hub_/, wood: a => (a === 'red' ? '#a3232b' : '#1f4fb8') },
  { match: /^outpost_/, wood: a => (a === 'red' ? '#7c2228' : '#20407f') },
  { match: /^tower_/, wood: '#b7bec7' },
  { match: /^trenches/, wood: '#8f98a3' },
  { match: /^bumps/, wood: '#2d3138' },
  { match: /^depot_/, wood: '#3a3f47' },
  { match: /^perimeter/, wood: '#6c737d' },
];
/** The CAD's plywood colour (linear) */
const WOOD = new THREE.Color(0.66, 0.32, 0.12);
/** Its grey sheets are polycarbonate: the guardrail panels and the HUB's sides */
const isSheet = (c: THREE.Color) => Math.abs(c.r - c.g) < 0.01 && Math.abs(c.g - c.b) < 0.01 && c.r > 0.25 && c.r < 0.7;

export class FieldView {
  readonly root = new THREE.Group();
  private readonly hubLights: Record<Alliance, THREE.MeshStandardMaterial[]> = { red: [], blue: [] };
  private hubsOn: Record<Alliance, boolean> = { red: true, blue: true };

  private constructor(readonly layout: FieldLayout) {}

  static async load(layout: FieldLayout, scene: THREE.Scene, onProgress?: (p: number) => void): Promise<FieldView> {
    const view = new FieldView(layout);
    const gltf = await new GLTFLoader().loadAsync(asset('assets/field.glb'), e => {
      if (e.total) onProgress?.(e.loaded / e.total);
    });
    view.build(gltf.scene);
    scene.add(view.root);
    return view;
  }

  /** Lights round each HUB's opening: bright in its ALLIANCE colour while it is active, dark when not. */
  setHubs(on: Record<Alliance, boolean>, time: number): void {
    this.hubsOn = on;
    for (const a of ['red', 'blue'] as Alliance[]) {
      const glow = on[a] ? 2.2 + 0.4 * Math.sin(time * 3) : 0.06;
      for (const m of this.hubLights[a]) m.emissiveIntensity = glow;
    }
  }

  get hubs(): Record<Alliance, boolean> {
    return this.hubsOn;
  }

  private build(cad: THREE.Group): void {
    this.root.add(cad);
    cad.updateMatrixWorld(true);

    for (const part of [...cad.children]) {
      const alliance: Alliance = /_blue$/.test(part.name) ? 'blue' : 'red';
      const paint = PAINT.find(p => p.match.test(part.name));
      const shadows = SHADOW_CASTERS.test(part.name);
      const painted = new Map<THREE.Material, THREE.Material>();
      part.traverse(obj => {
        if (!(obj instanceof THREE.Mesh)) return;
        if (!obj.geometry.getAttribute('normal')) obj.geometry = toCreasedNormals(obj.geometry, CREASE_ANGLE);
        const mat = obj.material as THREE.MeshStandardMaterial;
        let next = painted.get(mat);
        if (!next) {
          const c = mat.color;
          if (paint && Math.abs(c.r - WOOD.r) < 0.02 && Math.abs(c.g - WOOD.g) < 0.02) {
            const color = typeof paint.wood === 'string' ? paint.wood : paint.wood(alliance);
            next = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: /tower|trench|perimeter/.test(part.name) ? 0.45 : 0.1 });
          } else if (isSheet(c)) {
            next = new THREE.MeshStandardMaterial({ color: '#dfe8f2', transparent: true, opacity: 0.16, roughness: 0.08, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
          } else {
            next = mat;
          }
          painted.set(mat, next);
        }
        obj.material = next;
        obj.castShadow = shadows && !(next as THREE.Material).transparent;
        obj.receiveShadow = true;
      });
    }

    // Carpet, out to the ALLIANCE AREAS behind the walls.
    const { halfX, halfZ } = this.layout.wall;
    const carpetMap = createCarpetTexture();
    const cx = halfX + 1.2;
    const cz = halfZ + 0.4;
    carpetMap.repeat.set((cx * 2) / CARPET_TILE, (cz * 2) / CARPET_TILE);
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(cx * 2, cz * 2), new THREE.MeshStandardMaterial({ map: carpetMap, roughness: 0.97, metalness: 0 }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.receiveShadow = true;
    this.root.add(carpet);

    // Tape (manual 5.3): each ROBOT STARTING LINE at its ALLIANCE ZONE's edge, and the white CENTER LINE.
    // They glow a little to read in the dim hall.
    const line = (x: number, color: string) => {
      const tape = new THREE.Mesh(
        new THREE.PlaneGeometry(TAPE, halfZ * 2),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 }),
      );
      tape.rotation.x = -Math.PI / 2;
      tape.position.set(x, 0.002, 0);
      tape.receiveShadow = true;
      this.root.add(tape);
    };
    line(-halfX + ALLIANCE_ZONE - TAPE / 2, ALLIANCE_COLOR.red);
    line(halfX - ALLIANCE_ZONE + TAPE / 2, ALLIANCE_COLOR.blue);
    line(0, '#f4f4f4');

    // HUB lights: a hexagon round the top opening and a strip down each corner (manual 5.4).
    for (const a of ['red', 'blue'] as Alliance[]) {
      const box = this.layout.elements[`hub_${a}`];
      const x = (box.min[0] + box.max[0]) / 2;
      const z = (box.min[2] + box.max[2]) / 2;
      const mat = new THREE.MeshStandardMaterial({ color: '#202020', emissive: ALLIANCE_COLOR[a], emissiveIntensity: 2.2, roughness: 0.4, toneMapped: false });
      this.hubLights[a].push(mat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(HUB.opening / 2 + 0.03, 0.025, 6, 6), mat);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = Math.PI / 6;
      ring.position.set(x, HUB.height + 0.04, z);
      this.root.add(ring);
      const half = HUB.size / 2 + 0.006;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.05, 0.03), mat);
          strip.position.set(x + sx * half, 0.25 + 0.525, z + sz * half);
          this.root.add(strip);
        }
      }
    }
  }
}
