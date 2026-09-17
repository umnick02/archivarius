import { mountArchitectureMap } from 'archivarius';
import 'archivarius/style.css';
import './style.css';

// Two demo models ship beside this page: the documentation model this
// repository authors and a rendering model that exercises the parts the
// documentation model has none of — a store, an outside participant, every
// relation kind. Both are one click away so the map is never judged by one file.
const demo = (name) => import.meta.env.BASE_URL + name;

const map = mountArchitectureMap(document.querySelector('#map'), {
  source: demo('project.json'),
});
map.ready.catch(() => {});
for (const button of document.querySelectorAll('[data-demo]'))
  button.addEventListener('click', () => {
    map.load(demo(button.dataset.demo)).catch(() => {});
  });
document.querySelector('#model-file').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) map.load(file).catch(() => {});
});
window.addEventListener('pagehide', () => map.destroy(), { once: true });
