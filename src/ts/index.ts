import { App } from './app';

localStorage.clear();
window.addEventListener('load', () => {
  const app = new App('stellated_dodecahedron');
  app.init();
});