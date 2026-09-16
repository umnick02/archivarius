import { mountArchitectureMap } from 'archivarius';
import 'archivarius/style.css';
import './style.css';

// Archivarius displays loading failures in the viewer.
mountArchitectureMap(document.querySelector('#documentation'), {
  source: '/project.json',
}).ready.catch((error) => console.error(error));
