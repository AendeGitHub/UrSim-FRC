// The FRC match timer: the field's sounds at the moments of a REBUILT match (3-2-1, the start of
// AUTO, its end, the start of TELEOP, each SHIFT, END GAME and the end), made with Web Audio, and
// the scoreboard drawn on the screens beside the field (view/TimerScreens.ts). The game clock
// leads: the timer only notices which moments it has passed, so it holds with the pause menu and
// never plays a sound twice.

import { DURATION, type Period } from '../sim/Match';
import type { Alliance } from '../robot/robotConfig';

/** A match starts after a 3-2-1. */
export const MATCH_COUNTDOWN = 3;
const VOLUME = 0.35;
/** The board's canvas, px */
const BOARD = { width: 1024, height: 432 };

const TELEOP_AT = DURATION.auto + DURATION.transition;
const MATCH_END = TELEOP_AT + DURATION.teleop;

/** Seconds since AUTO started at a moment of a match (negative in the 3-2-1); null in practice. */
export function recordingTime(period: Period, time: number, startIn: number): number | null {
  switch (period) {
    case 'practice':
      return null;
    case 'auto':
      return startIn > 0 ? -startIn : time;
    case 'transition':
      return DURATION.auto + time;
    case 'teleop':
      return TELEOP_AT + time;
    case 'post':
      return MATCH_END + time;
  }
}

type Cue = 'beep' | 'start' | 'buzzer' | 'bells' | 'chime' | 'horn' | 'end';

/** The moments that make a sound, s since AUTO started */
const CUES: { at: number; cue: Cue }[] = [
  { at: -3, cue: 'beep' },
  { at: -2, cue: 'beep' },
  { at: -1, cue: 'beep' },
  { at: 0, cue: 'start' },
  { at: DURATION.auto, cue: 'buzzer' },
  { at: TELEOP_AT, cue: 'bells' },
  // SHIFTS 1–4: the HUBS change over (frc/rules.ts: TRANSITION 10 s, then 25 s each).
  ...[0, 1, 2, 3].map(i => ({ at: TELEOP_AT + 10 + i * 25, cue: 'chime' as Cue })),
  { at: MATCH_END - 30, cue: 'horn' },
  { at: MATCH_END, cue: 'end' },
];

/** What the board shows besides the clock */
export interface Board {
  label: string;
  score: Record<Alliance, number>;
  hubs: Record<Alliance, boolean>;
}

export class MatchTimer {
  /** The scoreboard picture, for the screens beside the field */
  readonly canvas = document.createElement('canvas');
  /** Set when the picture changed, for the screens' texture */
  changed = true;
  private audio: AudioContext | null = null;
  private out: GainNode | null = null;
  private stream: MediaStreamAudioDestinationNode | null = null;
  private last: number | null = null;
  private mute = false;
  private shown = '';

  constructor() {
    this.canvas.width = BOARD.width;
    this.canvas.height = BOARD.height;
    this.draw(null, null);
  }

  /** Nothing to load: the sounds are made as they play. */
  async load(): Promise<void> {}

  set muted(on: boolean) {
    this.mute = on;
  }

  /** The match sounds as a stream, for recording them with the picture (replay studio). */
  audioStream(): MediaStream | null {
    const ctx = this.context();
    if (!ctx || !this.out) return null;
    if (!this.stream) {
      this.stream = ctx.createMediaStreamDestination();
      this.out.connect(this.stream);
    }
    return this.stream.stream;
  }

  /** Follows the match: `at` s since AUTO started, running or held; null outside a match. */
  update(at: number | null, running: boolean, board: Board | null = null): void {
    this.draw(at, board);
    if (at === null || !running) {
      this.last = at;
      return;
    }
    // A jump (a new match, the studio's timeline) makes no sound; time going on plays what it passed.
    const from = this.last;
    this.last = at;
    if (from === null || at < from || at - from > 1) return;
    for (const c of CUES) if (c.at > from && c.at <= at) this.play(c.cue);
  }

  private context(): AudioContext | null {
    if (this.audio) return this.audio;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    this.audio = new Ctx();
    this.out = this.audio.createGain();
    this.out.gain.value = VOLUME;
    this.out.connect(this.audio.destination);
    return this.audio;
  }

  private play(cue: Cue): void {
    if (this.mute) return;
    const ctx = this.context();
    if (!ctx || !this.out) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    const tone = (freq: number, start: number, length: number, type: OscillatorType = 'square', level = 0.5, slideTo?: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0 + start);
      if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, t0 + start + length);
      gain.gain.setValueAtTime(0, t0 + start);
      gain.gain.linearRampToValueAtTime(level, t0 + start + 0.01);
      gain.gain.setValueAtTime(level, t0 + start + Math.max(0.01, length - 0.05));
      gain.gain.linearRampToValueAtTime(0, t0 + start + length);
      osc.connect(gain).connect(this.out!);
      osc.start(t0 + start);
      osc.stop(t0 + start + length + 0.02);
    };
    switch (cue) {
      case 'beep':
        tone(880, 0, 0.16, 'sine', 0.6);
        break;
      case 'start':
        // A rising fanfare.
        [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, i === 3 ? 0.5 : 0.12, 'sawtooth', 0.32));
        break;
      case 'buzzer':
        tone(140, 0, 0.9, 'sawtooth', 0.55);
        tone(147, 0, 0.9, 'square', 0.25);
        break;
      case 'bells':
        [0, 0.35, 0.7].forEach(s => {
          tone(1318, s, 0.3, 'sine', 0.5);
          tone(1976, s, 0.25, 'sine', 0.18);
        });
        break;
      case 'chime':
        tone(988, 0, 0.18, 'triangle', 0.45);
        tone(1319, 0.16, 0.3, 'triangle', 0.45);
        break;
      case 'horn':
        tone(330, 0, 0.45, 'sawtooth', 0.4, 300);
        tone(330, 0.55, 0.45, 'sawtooth', 0.4, 300);
        break;
      case 'end':
        tone(110, 0, 1.6, 'sawtooth', 0.6);
        tone(116, 0, 1.6, 'square', 0.25);
        break;
    }
  }

  /** The board: the clock, the period, both ALLIANCES' scores and which HUB is active. */
  private draw(at: number | null, board: Board | null): void {
    let clock = '2:43';
    if (at !== null) {
      const left = at < 0 ? DURATION.auto : at < DURATION.auto ? DURATION.auto - at : at < TELEOP_AT ? DURATION.teleop : Math.max(0, MATCH_END - at);
      const s = Math.ceil(left - 1e-6);
      clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    const key = `${clock}|${board?.label ?? ''}|${board?.score.red ?? ''}|${board?.score.blue ?? ''}|${board?.hubs.red}|${board?.hubs.blue}`;
    if (key === this.shown) return;
    this.shown = key;
    this.changed = true;
    const g = this.canvas.getContext('2d')!;
    const { width: w, height: h } = BOARD;
    g.fillStyle = '#05070b';
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const font = (px: number) => `800 ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
    // Alliance panels with their scores, lit while their HUB is active.
    for (const [a, x] of [['red', 0], ['blue', w - 300]] as [Alliance, number][]) {
      const lit = board ? board.hubs[a] : true;
      g.fillStyle = a === 'red' ? (lit ? '#d8202c' : '#4a1216') : lit ? '#1f5fe0' : '#121f45';
      g.fillRect(x, 0, 300, h);
      g.fillStyle = '#ffffff';
      g.font = font(150);
      g.fillText(board ? String(board.score[a]) : '0', x + 150, h / 2 - 20);
      g.font = font(36);
      g.globalAlpha = 0.85;
      g.fillText(lit ? 'HUB ●' : 'HUB ○', x + 150, h - 60);
      g.globalAlpha = 1;
    }
    g.fillStyle = '#ffffff';
    g.font = font(190);
    g.fillText(clock, w / 2, h / 2 - 30);
    g.fillStyle = '#ffd23f';
    g.font = font(40);
    g.fillText(board?.label ?? 'REBUILT', w / 2, h - 70);
  }
}
