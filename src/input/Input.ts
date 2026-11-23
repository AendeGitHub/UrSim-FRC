// Keyboard and gamepad, read once per frame into one driver's sticks and buttons.
// Driving is field-centric: "up" on the stick is away from the camera.

export interface DriverState {
  /** Left stick: x right, y up (away from the driver), -1..1 */
  moveX: number;
  moveY: number;
  /** Turn: positive counterclockwise */
  turn: number;
  shoot: boolean;
  climb: boolean;
  /** Pressed this frame */
  toggleIntake: boolean;
  camera: boolean;
  pause: boolean;
  /** Pressed this frame: reset the field (practice) */
  reset: boolean;
  /** Held: intake runs even when switched off */
  intake: boolean;
}

const DEAD = 0.12;
const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export class Input {
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private padPrev: boolean[] = [];
  gamepadName: string | null = null;

  constructor() {
    addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  read(): DriverState {
    const k = (c: string) => this.keys.has(c);
    const once = (c: string) => this.pressed.has(c);
    let moveX = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    let moveY = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    let turn = (k('KeyQ') || k('ArrowLeft') ? 1 : 0) - (k('KeyE') || k('ArrowRight') ? 1 : 0);
    if (k('ArrowUp')) moveY = Math.max(moveY, 1);
    if (k('ArrowDown')) moveY = Math.min(moveY, -1);
    let shoot = k('Space') || k('KeyK');
    let climb = k('KeyC');
    let intake = k('ShiftLeft') || k('ShiftRight');
    let toggleIntake = once('KeyI');
    let camera = once('KeyV');
    let pause = once('Escape') || once('KeyP');
    let reset = once('KeyR');
    const p = this.pad();
    this.gamepadName = p ? p.id.replace(/\(.*\)/, '').trim() || 'Gamepad' : null;
    if (p) {
      const b = (i: number) => !!p.buttons[i]?.pressed || (p.buttons[i]?.value ?? 0) > 0.4;
      const was = (i: number) => this.padPrev[i] ?? false;
      const edge = (i: number) => b(i) && !was(i);
      moveX += dz(p.axes[0] ?? 0);
      moveY -= dz(p.axes[1] ?? 0);
      turn -= dz(p.axes[2] ?? 0);
      shoot ||= b(7) || b(5);
      intake ||= b(6);
      climb ||= b(3);
      toggleIntake ||= edge(4) || edge(2);
      camera ||= edge(1);
      reset ||= edge(8);
      pause ||= edge(9);
      this.padPrev = p.buttons.map((_, i) => b(i));
    }
    this.pressed.clear();
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    return { moveX: clamp(moveX), moveY: clamp(moveY), turn: clamp(turn), shoot, climb, intake, toggleIntake, camera, pause, reset };
  }
}
