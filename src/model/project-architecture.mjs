import { index } from './records.mjs';

// The map is a projection of the component and interaction records; there is no
// second hand-drawn copy of the graph to keep in step.
export function projectArchitecture(model) {
  const records = index(model);
  const components = model.records.filter((r) => r.type === 'component');
  function node(record) {
    const children = components
      .filter((r) => r.parent === record.key)
      .map(node);
    return {
      key: record.key,
      title: record.title,
      summary: record.summary,
      kind: record.kind,
      zone: record.zone,
      rules: [],
      implemented: false,
      ...(children.length
        ? { detail: 'mapped', children }
        : { detail: 'boundary', detailNote: record.boundary }),
    };
  }
  return {
    version: 3,
    title: model.title,
    scope: 'target',
    entry: model.entry,
    nodes: components.filter((r) => !r.parent).map(node),
    relations: model.records
      .filter((r) => r.type === 'interaction')
      .map((r) => {
        const contract = records.get(r.contract);
        return {
          key: r.key,
          from: r.from,
          to: r.to,
          kind: r.kind,
          channel: r.channel,
          label: r.title,
          payload: contract.payload,
          meaning: contract.meaning,
          implemented: false,
        };
      }),
  };
}
