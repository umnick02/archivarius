import React, { createRef } from 'react';
import {
  ArchitectureMap,
  mountArchitectureMap,
  parseArchitecture,
  type MapNavigation,
  type ArchitectureSource,
} from 'archivarius';
import { validateArchitecture, type ArchitectureModel } from 'archivarius/core';

const source: ArchitectureSource = new URL(
  'https://example.com/architecture.json',
);
const ref = createRef<MapNavigation>();
const element = (
  <ArchitectureMap
    source={source}
    ref={ref}
    locale="en"
    onReady={(map) => {
      void map.home();
      map.snapshot().relations.map((edge) => edge.implemented);
    }}
  />
);
const map = mountArchitectureMap(document.createElement('div'), {
  source: new File([], 'architecture.json'),
});
void map.load(source);
void map.ready;
map.destroy();
const parsed: ArchitectureModel = parseArchitecture('{}');
validateArchitecture(parsed);
// @ts-expect-error implementation status is deliberately not a string
parsed.nodes[0].implemented = 'partial';
// @ts-expect-error unsupported locale must not silently select another language
const invalid = <ArchitectureMap source={source} locale="xx" />;
void element;
void invalid;
