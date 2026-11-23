// Procedural texture for the FIELD's grey event carpet (manual 5.2): fine fibre speckle and the
// faint stripes the carpet's rolls leave, tiled across the floor.

import * as THREE from 'three';

/** One tile of carpet, `metres` square (repeat it over the floor). */
export const CARPET_TILE = 2;

export function createCarpetTexture(px = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const g = c.getContext('2d')!;
  // Deterministic noise so the floor looks the same every run.
  let seed = 1234567;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = 'rgb(92,96,103)';
  g.fillRect(0, 0, px, px);
  // Pile rows: barely visible stripes along the carpet's length.
  for (let y = 0; y < px; y += 4) {
    g.fillStyle = `rgba(${y % 8 ? 255 : 0},${y % 8 ? 255 : 0},${y % 8 ? 255 : 0},0.025)`;
    g.fillRect(0, y, px, 2);
  }
  for (let i = 0; i < px * px * 0.12; i++) {
    const v = 92 + (rand() - 0.5) * 46;
    g.fillStyle = `rgba(${v},${v + 3},${v + 9},0.5)`;
    g.fillRect(rand() * px, rand() * px, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // Sharp at the low angle a driver sees it (WebGL clamps this to what the GPU supports).
  tex.anisotropy = 16;
  return tex;
}
