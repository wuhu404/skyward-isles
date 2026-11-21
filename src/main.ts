import { Game } from './core/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.init().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui')!;
  ui.innerHTML = `<div class="screen dim center"><div class="h2 red">启动失败</div><p class="lead">浏览器需要支持 WebGL2 与 WebAssembly。<br>${String(err?.message ?? err)}</p></div>`;
});
// 开发调试用：仅在 dev 模式暴露
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
