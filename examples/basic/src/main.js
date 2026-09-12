import { mountArchitectureMap } from 'archivarius';
import 'archivarius/style.css';
import './style.css';

const map = mountArchitectureMap(document.querySelector('#map'), {
  source: import.meta.env.BASE_URL + 'architecture.json',
});
map.ready.catch(() => {});
document.querySelector('#model-file').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) map.load(file).catch(() => {});
});
window.addEventListener('pagehide', () => map.destroy(), { once: true });
