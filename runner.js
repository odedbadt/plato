import { App } from './main_app.js'


localStorage.clear()
window.addEventListener('load', () => {
  const app = new App()
  app.init();
});
