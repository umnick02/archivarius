import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArchitectureMap,
  mountArchitectureMap,
  parseArchitecture,
} from 'archivarius';
import 'archivarius/style.css';
import './style.css';

const source = new URL('./architecture.json', document.baseURI);
const first = mountArchitectureMap(document.querySelector('#first'), {
  source,
});
const second = mountArchitectureMap(document.querySelector('#second'), {
  source,
});
const reactRoot = createRoot(document.querySelector('#react-map'));
const reactRef = createRef();
let reactReady;
let reactError;
const renderReact = (source, extra = {}) =>
  new Promise((resolve, reject) => {
    reactReady = resolve;
    reactError = reject;
    reactRoot.render(
      <React.StrictMode>
        <ArchitectureMap
          source={source}
          ref={reactRef}
          onReady={() => reactReady()}
          onError={(error) => reactError(error)}
          {...extra}
        />
      </React.StrictMode>,
    );
  });
const ready = Promise.all([first.ready, second.ready, renderReact(source)]);
window.consumer = {
  first,
  second,
  reactRef,
  renderReact,
  ready,
  parseArchitecture,
  mountArchitectureMap,
  source,
};
