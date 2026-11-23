import './styles.css';
import { Game } from './Game';
import { initPhysics } from './sim/World';
import { App } from './ui/App';
import { lang, t } from './ui/i18n';

async function boot(): Promise<void> {
  document.documentElement.lang = lang;
  const root = document.getElementById('app')!;
  const label = document.querySelector('.loading-label');
  const fill = document.querySelector<HTMLElement>('.loading-fill');
  if (label) label.textContent = t('loading');
  if (fill) fill.style.width = '40%';
  await initPhysics();
  if (fill) fill.style.width = '100%';
  const game = new Game(root);
  new App(game, root);
  const loop = (now: number) => {
    game.frame(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  document.getElementById('loading')?.remove();
}

boot().catch(err => {
  console.error(err);
  const label = document.querySelector('.loading-label');
  if (label) label.textContent = String(err);
});
