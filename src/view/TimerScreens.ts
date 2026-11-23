// The field's scoreboard screens: one big screen beyond each long side of the field, facing it, so
// drivers and the audience both see the clock, the scores and which HUB is active. They show the
// board game/matchTimer.ts draws.
// Field center is the origin; red drivers stand at -X, the audience side is +Z.

import * as THREE from 'three';

/** Screen width, m; the height follows the board (1024 × 432) */
const WIDTH = 4.2;
const HEIGHT = (WIDTH * 432) / 1024;
/** Beyond the side guardrails (at |z| = 4.03), in front of the stands, m */
const Z = 5.6;
/** Bottom edge of the picture, m */
const BOTTOM = 1.4;
const CENTER_Y = BOTTOM + HEIGHT / 2;
const BEZEL = 0.08;
const DEPTH = 0.12;

export class TimerScreens {
  private readonly texture: THREE.CanvasTexture;

  constructor(scene: THREE.Scene, private readonly board: { canvas: HTMLCanvasElement; changed: boolean }) {
    this.texture = new THREE.CanvasTexture(board.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    // Lit by itself, like a real screen in a dim hall.
    const screen = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    const frame = new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.5, metalness: 0.3 });
    const metal = new THREE.MeshStandardMaterial({ color: '#3a3f48', roughness: 0.45, metalness: 0.7 });
    // Only the far one: the near one would stand in front of the audience camera.
    for (const side of [-1]) {
      const tv = new THREE.Group();
      tv.position.set(0, 0, side * Z);
      tv.rotation.y = side < 0 ? 0 : Math.PI;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, HEIGHT), screen);
      face.position.set(0, CENTER_Y, DEPTH / 2 + 0.002);
      const back = new THREE.Mesh(new THREE.BoxGeometry(WIDTH + 2 * BEZEL, HEIGHT + 2 * BEZEL, DEPTH), frame);
      back.position.y = CENTER_Y;
      for (const x of [-WIDTH * 0.3, WIDTH * 0.3]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, BOTTOM, 0.12), metal);
        leg.position.set(x, BOTTOM / 2, -0.05);
        tv.add(leg);
      }
      tv.add(face, back);
      scene.add(tv);
    }
  }

  /** Each frame: a new picture goes up when the board changed. */
  update(): void {
    if (!this.board.changed) return;
    this.board.changed = false;
    this.texture.needsUpdate = true;
  }
}
