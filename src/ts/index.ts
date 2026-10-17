import { App } from './app';

window.addEventListener('load', () => {
  const app = new App('stellated_dodecahedron');
  app.init();
});