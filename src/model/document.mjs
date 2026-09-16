import { ArchitectureGraph } from './graph.mjs';
import { ArchitectureError } from './core.mjs';
import { renderProjectDocumentation } from './project-document.mjs';

// Model prose is plain text. Only the renderer creates Markdown structure.
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_[\]{}()#+.!|~-])/g, '\\$1')
    .replace(/\r\n?/g, '\n');
const inline = (value) => escape(value).replaceAll('\n', ' ');

export function renderDocumentation(model, copy) {
  if (model.version === 4)
    return renderProjectDocumentation(model, copy.project);
  const graph = ArchitectureGraph.validate(model);
  if (graph.errors.length)
    throw new ArchitectureError(
      'INVALID_MODEL',
      graph.errors,
      graph.diagnostics,
    );
  const labels = copy.document;
  const lines = [];
  const paragraph = (text) => lines.push(escape(text), '');
  const field = (label, text) =>
    lines.push('**' + inline(label) + ':** ' + escape(text), '');
  const link = (key) =>
    '[' + inline(graph.nodes.get(key).title) + '](#node-' + key + ')';
  const interaction = (edge) =>
    '[' + inline(edge.label) + '](#relation-' + edge.key + ')';
  const implementation = (item) => {
    field(
      copy.implementationLabel,
      item.implemented ? copy.implementationYes : copy.implementationNo,
    );
    if (!item.implemented) paragraph(copy.implementationUnconfirmed);
    if (item.implementationEvidence)
      field(copy.implementationEvidence, item.implementationEvidence);
  };
  lines.push('# ' + inline(model.title || copy.title), '');
  paragraph(labels.generated);
  field(labels.version, model.version);
  field(labels.scope, model.scope);
  lines.push('**' + inline(labels.entry) + ':** ' + link(model.entry), '');
  lines.push('## ' + inline(labels.contents), '');
  const index = (nodes, depth = 0) =>
    nodes.forEach((node) => {
      lines.push('  '.repeat(depth) + '- ' + link(node.key));
      if (node.children) index(node.children, depth + 1);
    });
  index(model.nodes);
  lines.push('');
  for (const node of graph.nodes.values()) {
    lines.push(
      '<a id="node-' + node.key + '"></a>',
      '',
      '## ' + inline(node.title),
      '',
    );
    field(labels.key, node.key);
    field(labels.kind, copy.nodeKinds[node.kind]);
    field(labels.zone, copy.zones[node.zone]);
    const parent = graph.parents.get(node.key);
    if (parent)
      lines.push('**' + inline(labels.parent) + ':** ' + link(parent), '');
    paragraph(node.summary);
    implementation(node);
    if (node.children) {
      lines.push(
        '**' + inline(labels.children) + ':**',
        '',
        ...node.children.map((child) => '- ' + link(child.key)),
        '',
      );
      paragraph(copy.partsNote);
    }
    if (node.detailNote) field(copy.boundary, node.detailNote);
    if (node.example) field(copy.example, node.example);
    if (node.rules.length) {
      lines.push('### ' + inline(copy.componentRules), '');
      for (const rule of node.rules) field(rule.title, rule.text);
    }
    const relations = ArchitectureGraph.describe(model, graph, node.key);
    for (const [key, label] of [
      ['incoming', copy.receives],
      ['outgoing', copy.sends],
      ['internal', copy.internalRelations],
    ]) {
      if (!relations[key].length) continue;
      lines.push(
        '### ' + inline(label),
        '',
        ...relations[key].map((edge) => '- ' + interaction(edge)),
        '',
      );
    }
  }
  lines.push('## ' + inline(labels.relations), '');
  for (const edge of model.relations) {
    lines.push(
      '<a id="relation-' + edge.key + '"></a>',
      '',
      '### ' + inline(edge.label),
      '',
    );
    field(labels.key, edge.key);
    lines.push(link(edge.from) + ' → ' + link(edge.to), '');
    field(labels.kind, copy.kinds[edge.kind]);
    field(labels.channel, edge.channel);
    field(copy.payload, edge.payload);
    paragraph(edge.meaning);
    implementation(edge);
  }
  return lines.join('\n');
}
