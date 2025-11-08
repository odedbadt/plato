import { App } from 'main_app.ts'


localStorage.clear()
window.addEventListener('load', () => {
  const app = new App()
  app.init();
});
