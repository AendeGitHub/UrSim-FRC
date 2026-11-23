// All 504 FUEL as one instanced mesh: yellow foam balls with dimples.

import * as THREE from 'three';
import { FUEL } from '../game/field';
import type { World } from '../sim/World';

function foamTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f5c518';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = 'rgba(160,110,0,0.35)';
  for (let y = 6; y < 64; y += 12) for (let x = (y / 12) % 2 ? 4 : 10; x < 128; x += 14) {
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FuelView {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor(private readonly world: World) {
    const geo = new THREE.SphereGeometry(FUEL.radius, 14, 10);
    const mat = new THREE.MeshStandardMaterial({ map: foamTexture(), roughness: 0.85 });
    this.mesh = new THREE.InstancedMesh(geo, mat, world.fuel.length);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  update(): void {
    const t = this.world.transforms;
    for (const f of this.world.fuel) {
      if (f.state !== 'field') {
        this.mesh.setMatrixAt(f.id, this.hidden);
        continue;
      }
      const o = f.id * 7;
      this.p.set(t[o], t[o + 1], t[o + 2]);
      this.q.set(t[o + 3], t[o + 4], t[o + 5], t[o + 6]);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(f.id, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
