import React, { createRef } from 'react';
import {
  ArchitectureMap,
  mountArchitectureMap,
  parseArchitecture,
  type MapNavigation,
  type ArchitectureSource,
} from 'archivarius';
import {
  validateArchitecture,
  analyzeProject,
  type ArchitectureInput,
  type ProjectModel,
  type ProjectRecord,
  projectContext,
  applyProjectChanges,
} from 'archivarius/core';
import type { ArchitectureNode, Implementation } from 'archivarius/core';
import { readArchitectureFile, generateDocumentation } from 'archivarius/node';

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
const parsed: ArchitectureInput = parseArchitecture('{}');
validateArchitecture(parsed);
// @ts-expect-error implementation status is deliberately not a string
parsed.nodes[0].implemented = 'partial';
declare const project: ProjectModel;
const analyzed = analyzeProject(project);
const implementationState: 'confirmed' | 'partial' | 'unconfirmed' =
  analyzed.completion[project.root].state;
analyzed.completion[project.root].progress.confirmedCriteria.map((key) =>
  key.toUpperCase(),
);
void implementationState;
const context = projectContext(project, [project.root]);
applyProjectChanges(project, context, { put: [] });
declare const requirement: Extract<ProjectRecord, { type: 'requirement' }>;
requirement.rule.toUpperCase();
// @ts-expect-error project implementation is derived, not a manual status field
requirement.implemented = true;
// @ts-expect-error unsupported locale must not silently select another language
const invalid = <ArchitectureMap source={source} locale="xx" />;
void element;
void invalid;

declare const node: ArchitectureNode;
if (node.detail === 'mapped') {
  const kind: 'subsystem' = node.kind;
  node.children[0].title;
  void kind;
} else {
  const absent: undefined = node.children;
  node.detailNote.toUpperCase();
  void absent;
}
if (node.implemented) node.implementationEvidence.toUpperCase();
// @ts-expect-error confirmation requires evidence in generated types
const noEvidence: Implementation = { implemented: true };
// @ts-expect-error mapped nodes must have children
const noParts: ArchitectureNode = {
  key: 'x',
  title: 'x',
  summary: 'x',
  kind: 'subsystem',
  zone: 'application',
  rules: [],
  detail: 'mapped',
  implemented: false,
};
declare const boundary: Extract<ArchitectureNode, { detail: 'boundary' }>;
const withParts = { ...boundary, children: [node] as [ArchitectureNode] };
// @ts-expect-error a boundary cannot silently acquire children
const invalidParts: ArchitectureNode = withParts;
void noEvidence;
void noParts;
void withParts;
void invalidParts;
void readArchitectureFile('architecture.json').then((model) =>
  generateDocumentation(model),
);
