// @ts-nocheck
import { App } from './app'


localStorage.clear()
window.addEventListener('load', () => {
  const app = new App()
  app.init();
});
