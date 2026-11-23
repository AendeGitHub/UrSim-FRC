// Menus, match setup, the HUD, pause and results: everything drawn over the 3D view.

import { ALLIANCE_ZONE } from '../game/field';
import { ROBOTS, robotById } from '../game/robots';
import { AUTO_LENGTH, clock, formatClock, fuelCount, periodAt, rankingPoints, total } from '../game/rules';
import { ALLIANCES, other, slotAlliance, type Alliance } from '../game/types';
import { Game, type MatchSetup } from '../Game';
import type { DriverState } from '../input/Input';
import type { AutoPlan, BotLevel } from '../sim/Bot';
import type { MatchEvent } from '../sim/World';
import { LANGS, LANG_NAMES, lang, setLang, t, tr, type UiKey } from './i18n';
import { CONTROLS, RULES } from './rulesText';

const SETUP_KEY = 'ursim-frc-setup';
const BEST_KEY = 'ursim-frc-best';

function h(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
}

function loadSetup(): MatchSetup {
  const def: MatchSetup = { practice: false, slot: 0, robotId: 'overload', auto: 'shoot', level: 'normal', bots: true };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') };
  } catch {
    return def;
  }
}

export class App {
  private readonly ui: HTMLElement;
  private screen: HTMLElement | null = null;
  private hud: HTMLElement | null = null;
  private toasts!: HTMLElement;
  private setup = loadSetup();
  private resultsTimer = 0;
  private lastShootWarn = 0;

  constructor(private readonly game: Game, root: HTMLElement) {
    this.ui = h('<div class="ui"></div>');
    root.append(this.ui);
    game.onFrame = d => this.frame(d);
    game.onEvent = e => this.event(e);
    game.onPause = () => this.togglePause();
    this.mainMenu();
  }

  private show(el: HTMLElement | null): void {
    this.screen?.remove();
    this.screen = el;
    if (el) this.ui.append(el);
  }

  // ---------------------------------------------------------------- menus

  private footer(): string {
    return `<div class="footer"><span class="pad-status"></span><span>${t('footer', { v: __APP_VERSION__ })}</span></div>`;
  }

  mainMenu(): void {
    this.removeHud();
    this.game.showcase = true;
    this.game.load({ ...this.setup, practice: true, bots: true });
    const el = h(`
      <div class="screen menu">
        <div class="brand"><img src="assets/logo.svg" alt="UrSim"><div class="edition">FRC <b>REBUILT</b> 2026</div></div>
        <nav class="big-nav">
          <button data-go="play">${t('play')}</button>
          <button data-go="practice">${t('practice')}</button>
          <button data-go="howto">${t('howto')}</button>
          <button data-go="controls">${t('controls')}</button>
        </nav>
        <div class="langs">${LANGS.map(l => `<button data-lang="${l}" class="${l === lang ? 'on' : ''}">${LANG_NAMES[l]}</button>`).join('')}</div>
        ${this.footer()}
      </div>`);
    el.querySelectorAll<HTMLButtonElement>('[data-go]').forEach(b => (b.onclick = () => {
      const go = b.dataset.go!;
      if (go === 'play') this.setupScreen(false);
      if (go === 'practice') this.setupScreen(true);
      if (go === 'howto') this.howto();
      if (go === 'controls') this.controls();
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach(b => (b.onclick = () => {
      setLang(b.dataset.lang as never);
      this.mainMenu();
    }));
    this.show(el);
  }

  private setupScreen(practice: boolean): void {
    const s = this.setup;
    const stations = [0, 1, 2, 3, 4, 5]
      .map(i => `<button data-slot="${i}" class="${slotAlliance(i)} ${i === s.slot ? 'on' : ''}">${t(slotAlliance(i))} ${(i % 3) + 1}</button>`)
      .join('');
    const robots = ROBOTS.map(r => `
      <button data-robot="${r.id}" class="card ${r.id === s.robotId ? 'on' : ''}">
        <b>${r.name}</b><span>${tr(r.about)}</span>
        <i>${r.maxSpeed.toFixed(1)} m/s · ${r.capacity} FUEL · ${r.fireRate}/s · L${r.climbMax}</i>
      </button>`).join('');
    const autos: [AutoPlan, UiKey][] = [['shoot', 'autoShoot'], ['collect', 'autoCollect'], ['climb', 'autoClimb'], ['none', 'autoNone']];
    const levels: [BotLevel, UiKey][] = [['easy', 'easy'], ['normal', 'normal'], ['hard', 'hard']];
    const el = h(`
      <div class="screen setup">
        <button class="back">${t('back')}</button>
        <h1>${practice ? t('practice') : t('setupTitle')}</h1>
        <section><h3>${t('alliance')} · ${t('station')}</h3><div class="row stations">${stations}</div></section>
        <section><h3>${t('robot')}</h3><div class="row cards">${robots}</div></section>
        ${practice ? `
          <section><label class="check"><input type="checkbox" data-bots ${s.bots ? 'checked' : ''}> ${t('partners')}</label></section>` : `
          <section><h3>${t('auto')}</h3><div class="row opts">${autos.map(([v, k]) => `<button data-auto="${v}" class="${v === s.auto ? 'on' : ''}">${t(k)}</button>`).join('')}</div></section>
          <section><h3>${t('difficulty')}</h3><div class="row opts">${levels.map(([v, k]) => `<button data-level="${v}" class="${v === s.level ? 'on' : ''}">${t(k)}</button>`).join('')}</div></section>`}
        <button class="primary start">${t('start')}</button>
      </div>`);
    const pick = (attr: string, apply: (v: string) => void) => {
      el.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach(b => (b.onclick = () => {
        el.querySelectorAll(`[data-${attr}]`).forEach(o => o.classList.remove('on'));
        b.classList.add('on');
        apply(b.getAttribute(`data-${attr}`)!);
      }));
    };
    pick('slot', v => (s.slot = +v));
    pick('robot', v => (s.robotId = v));
    pick('auto', v => (s.auto = v as AutoPlan));
    pick('level', v => (s.level = v as BotLevel));
    (el.querySelector('.back') as HTMLButtonElement).onclick = () => this.mainMenu();
    (el.querySelector('.start') as HTMLButtonElement).onclick = () => {
      const bots = el.querySelector<HTMLInputElement>('[data-bots]');
      const setup: MatchSetup = { ...s, practice, bots: practice ? !!bots?.checked : true };
      if (practice) s.bots = setup.bots;
      try { localStorage.setItem(SETUP_KEY, JSON.stringify(s)); } catch { /* ignore */ }
      this.startMatch(setup);
    };
    this.show(el);
  }

  private howto(): void {
    const el = h(`
      <div class="screen page">
        <button class="back">${t('back')}</button>
        <h1>${t('howto')} · REBUILT 2026</h1>
        ${RULES.map(r => `<section><h3>${tr(r.title)}</h3><ul>${r.items.map(i => `<li>${tr(i)}</li>`).join('')}</ul></section>`).join('')}
      </div>`);
    (el.querySelector('.back') as HTMLButtonElement).onclick = () => this.mainMenu();
    this.show(el);
  }

  private controls(): void {
    const el = h(`
      <div class="screen page">
        <button class="back">${t('back')}</button>
        <h1>${t('controls')}</h1>
        <table class="keys">${CONTROLS.map(c => `<tr><td><kbd>${c.keys}</kbd></td><td><kbd>${c.pad}</kbd></td><td>${tr(c.what)}</td></tr>`).join('')}</table>
      </div>`);
    (el.querySelector('.back') as HTMLButtonElement).onclick = () => this.mainMenu();
    this.show(el);
  }

  // ---------------------------------------------------------------- match

  private startMatch(setup: MatchSetup): void {
    this.show(null);
    this.game.load(setup);
    this.game.start();
    this.resultsTimer = 0;
    this.buildHud();
  }

  private buildHud(): void {
    this.removeHud();
    const you = slotAlliance(this.game.setup.slot);
    this.hud = h(`
      <div class="hud">
        <div class="scoreboard">
          <div class="side red"><div class="pts" data-pts="red">0</div><div class="hub" data-hub="red"></div></div>
          <div class="mid"><div class="clock">0:20</div><div class="period">AUTO</div><div class="change"></div></div>
          <div class="side blue"><div class="pts" data-pts="blue">0</div><div class="hub" data-hub="blue"></div></div>
        </div>
        <div class="toasts"></div>
        <div class="panel ${you}">
          <div class="fuel"><span class="label">${t('fuelHeld')}</span><span class="n">0</span><div class="bar"><div></div></div></div>
          <div class="flags"><span class="intake">INTAKE</span><span class="aim">AIM</span><span class="zone">ZONE</span><span class="lvl"></span></div>
          <div class="hint"></div>
        </div>
        <div class="corner"><span class="cam"></span> · V</div>
      </div>`);
    this.toasts = this.hud.querySelector('.toasts')!;
    this.ui.append(this.hud);
  }

  private removeHud(): void {
    this.hud?.remove();
    this.hud = null;
  }

  private toast(text: string, kind = ''): void {
    if (!this.toasts) return;
    const el = h(`<div class="toast ${kind}">${text}</div>`);
    this.toasts.prepend(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
    while (this.toasts.children.length > 3) this.toasts.lastElementChild!.remove();
  }

  private event(e: MatchEvent): void {
    if (this.game.showcase) return;
    const w = this.game.world;
    const name = (a: Alliance) => t(a);
    if (e.type === 'autoWinner' && e.alliance) this.toast(t('autoWon', { who: name(e.alliance) }));
    if (e.type === 'period' && e.period) {
      if (e.period.startsWith('shift')) {
        const on = ALLIANCES.filter(a => w.hubOn(a));
        this.toast(t('shiftChange', { who: on.map(name).join(', ') }), on[0]);
      }
      if (e.period === 'endgame') this.toast(`END GAME · ${t('bothActive')}`);
    }
    if (e.type === 'foul' && e.slot !== undefined) {
      const mine = e.slot === this.game.setup.slot;
      const text: Record<string, string> = {
        G407: tr({ kk: 'G407: тек өз ALLIANCE ZONE-ыңнан ат', ru: 'G407: стрелять можно только из своей ALLIANCE ZONE', en: 'G407: shoot only from your ALLIANCE ZONE' }),
        G403: tr({ kk: 'G403: AUTO-да орталық сызықтан өтпе', ru: 'G403: в AUTO нельзя пересекать центральную линию', en: 'G403: no crossing the CENTER LINE in AUTO' }),
        G420: tr({ kk: 'G420: TOWER-дегі қарсыласқа тиюге болмайды', ru: 'G420: нельзя трогать соперника на TOWER', en: 'G420: hands off an opponent on its TOWER' }),
      };
      this.toast(`MAJOR FOUL ${mine ? '— ' : `(${name(e.alliance!)}) `}${text[e.rule!]} · +15 ${name(other(e.alliance!))}`, 'foul');
    }
    if (e.type === 'wasted' && e.slot === this.game.setup.slot) {
      const now = performance.now();
      if (now - this.lastShootWarn > 4000) {
        this.lastShootWarn = now;
        this.toast(t('wastedNote'), 'warn');
      }
    }
    if (e.type === 'end') this.resultsTimer = 2.5;
  }

  private togglePause(): void {
    if (this.game.showcase || !this.hud) return;
    if (this.game.paused) {
      this.game.paused = false;
      this.show(null);
      return;
    }
    this.game.paused = true;
    const el = h(`
      <div class="screen pause">
        <h1>${t('paused')}</h1>
        <nav class="big-nav small">
          <button data-a="resume">${t('resume')}</button>
          <button data-a="restart">${t('restart')}</button>
          <button data-a="menu">${t('menu')}</button>
        </nav>
      </div>`);
    el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach(b => (b.onclick = () => {
      const a = b.dataset.a;
      this.game.paused = false;
      this.show(null);
      if (a === 'restart') this.startMatch(this.game.setup);
      if (a === 'menu') this.mainMenu();
    }));
    this.show(el);
  }

  private results(): void {
    const w = this.game.world;
    const you = slotAlliance(this.game.setup.slot);
    const us = w.score[you];
    const them = w.score[other(you)];
    const a = total(us), b = total(them);
    const rp = rankingPoints(us, them);
    let best = 0;
    try {
      best = +(localStorage.getItem(BEST_KEY) ?? 0);
      if (a > best) localStorage.setItem(BEST_KEY, String(a));
    } catch { /* ignore */ }
    const row = (k: UiKey, f: (s: typeof us) => number) => `<tr><td>${t(k)}</td><td class="red">${f(w.score.red)}</td><td class="blue">${f(w.score.blue)}</td></tr>`;
    const p = this.game.player;
    const el = h(`
      <div class="screen results">
        <h1 class="${a > b ? 'win' : a < b ? 'loss' : ''}">${a > b ? t('win') : a < b ? t('loss') : t('tie')}</h1>
        <div class="final"><span class="red">${total(w.score.red)}</span><span class="dash">:</span><span class="blue">${total(w.score.blue)}</span></div>
        <table class="breakdown">
          <tr><th></th><th class="red">${t('red')}</th><th class="blue">${t('blue')}</th></tr>
          ${row('rAutoFuel', s => s.autoFuel)}
          ${row('rTeleFuel', s => s.teleFuel)}
          ${row('rAutoTower', s => s.autoTower)}
          ${row('rTower', s => s.tower)}
          <tr><td>FOUL</td><td class="red">${w.score.red.foulPoints}</td><td class="blue">${w.score.blue.foulPoints}</td></tr>
          ${row('rWasted', s => s.wasted)}
          ${row('rTotal', s => total(s))}
        </table>
        <div class="rp">${t('rRp')}: <b>${rp.total}</b>
          <span class="${rp.win ? 'on' : ''}">WIN ${rp.win}</span>
          <span class="${rp.energized ? 'on' : ''}">ENERGIZED ${fuelCount(us)}/100</span>
          <span class="${rp.supercharged ? 'on' : ''}">SUPERCHARGED ${fuelCount(us)}/360</span>
          <span class="${rp.traversal ? 'on' : ''}">TRAVERSAL ${us.autoTower + us.tower}/50</span>
        </div>
        <p>${t('rYou', { fuel: p.scored, lvl: p.level ? t('level', { n: p.level }) : t('noClimb') })} · ${t('rBest', { n: Math.max(best, a) })}</p>
        <nav class="row">
          <button class="primary" data-a="again">${t('restart')}</button>
          <button data-a="menu">${t('menu')}</button>
        </nav>
      </div>`);
    el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach(btn => (btn.onclick = () => (btn.dataset.a === 'again' ? this.startMatch(this.game.setup) : this.mainMenu())));
    this.removeHud();
    this.show(el);
  }

  // ---------------------------------------------------------------- every frame

  private frame(d: DriverState): void {
    const pad = this.ui.querySelector('.pad-status');
    if (pad) pad.textContent = this.game.input.gamepadName ? t('gamepadOk', { name: this.game.input.gamepadName }) : t('gamepadNone');
    if (this.resultsTimer > 0) {
      this.resultsTimer -= 1 / 60;
      if (this.resultsTimer <= 0) this.results();
    }
    const hud = this.hud;
    if (!hud) return;
    const w = this.game.world;
    const r = this.game.player;
    const q = <T extends HTMLElement>(s: string) => hud.querySelector(s) as T;
    for (const a of ALLIANCES) {
      q(`[data-pts="${a}"]`).textContent = String(total(w.score[a]));
      const hub = q(`[data-hub="${a}"]`);
      const on = w.hubOn(a);
      hub.textContent = on ? t('hubActive') : t('hubInactive');
      hub.classList.toggle('off', !on);
    }
    if (w.practice) {
      q('.clock').textContent = '∞';
      q('.period').textContent = t('practiceClock');
      q('.change').textContent = '';
    } else {
      const p = periodAt(w.time);
      q('.clock').textContent = formatClock(clock(Math.min(w.time, 160)));
      q('.period').textContent = t(`period_${p.id}` as UiKey);
      const left = Math.ceil(p.end - w.time);
      q('.change').textContent = p.id.startsWith('shift') || p.id === 'transition' ? t('hubSoon', { s: left }) : '';
    }
    q('.n').textContent = `${r.hopper.length}/${r.spec.capacity}`;
    q<HTMLElement>('.bar div').style.width = `${(100 * r.hopper.length) / r.spec.capacity}%`;
    q('.intake').classList.toggle('on', r.intakeOn || d.intake);
    q('.aim').classList.toggle('on', r.aimed && r.hopper.length > 0);
    const inZone = w.bumpersInZone(r);
    q('.zone').classList.toggle('on', inZone);
    q('.zone').title = `ALLIANCE ZONE ${ALLIANCE_ZONE.toFixed(2)} m`;
    q('.lvl').textContent = r.hanging ? `TOWER ${r.level ? t('level', { n: r.level }) : '…'}` : '';
    let hint = '';
    if (w.isAuto && !w.practice) hint = t('autoDriving');
    else if (!r.hanging && r.nearTower() && r.spec.climbMax > 0) hint = t('climbHint');
    else if (d.shoot && !inZone && r.hopper.length) hint = tr({ kk: 'G407: өз ALLIANCE ZONE-ыңа қайт — ол жақтан ғана атуға болады', ru: 'G407: вернись в свою ALLIANCE ZONE — стрелять можно только оттуда', en: 'G407: get back in your ALLIANCE ZONE — you may only shoot from there' });
    else if (!w.hubOn(r.alliance) && !w.practice && w.time > AUTO_LENGTH) hint = tr({ kk: 'HUB өшірулі: FUEL жина, ауысымды күт', ru: 'HUB выключен: собирай FUEL и жди смены', en: 'HUB is off: collect FUEL and wait for the shift' });
    q('.hint').textContent = hint;
    q('.cam').textContent = { driver: 'DRIVER', chase: 'CHASE', top: 'TOP' }[this.game.cameraMode];
    if (this.robotPanelSpec !== r.spec.id) {
      this.robotPanelSpec = r.spec.id;
      q('.label').textContent = `${robotById(r.spec.id).name} · ${t('fuelHeld')}`;
    }
  }

  private robotPanelSpec = '';
}
