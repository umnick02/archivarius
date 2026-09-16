import { mountArchitectureMap } from 'archivarius';
import 'archivarius/style.css';
import './style.css';

mountArchitectureMap(document.querySelector('#documentation'), {
  source: '/project.json',
}).ready
  // Archivarius displays loading failures in the viewer.
  .catch((error) => console.error(error));
