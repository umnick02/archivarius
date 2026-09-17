/**
 * Where a change reaches. The map draws what a part exchanges with its
 * neighbours; a reader planning a change asks the further question - what does
 * this part touch, what touches it, is there a way from here to there, and do the
 * arrows come back round. Those answers are read from the relations as recorded,
 * leaf part to leaf part, so nothing here depends on what is expanded on screen.
 */

/** @typedef {{ key: string, from: string, to: string }} Relation */

/**
 * The arrows out of and into each part, with the relation followed. Built once
 * per question so a caller cannot hand in an index that disagrees with the
 * relations.
 * @param {Relation[]} relations
 */
function index(relations) {
  const out = new Map(),
    into = new Map();
  const add = (table, from, to, key) => {
    const edges = table.get(from) ?? [];
    edges.push({ part: to, key });
    table.set(from, edges);
  };
  for (const relation of relations) {
    add(out, relation.from, relation.to, relation.key);
    add(into, relation.to, relation.from, relation.key);
    if (!out.has(relation.to)) out.set(relation.to, []);
    if (!into.has(relation.from)) into.set(relation.from, []);
  }
  // One order for every answer, so the same relations read the same way whatever
  // order they arrived in.
  for (const table of [out, into])
    for (const edges of table.values())
      edges.sort(
        (one, other) =>
          one.part.localeCompare(other.part) ||
          one.key.localeCompare(other.key),
      );
  return { out, into };
}

/**
 * Breadth-first distance from a set of parts, following one table. The starting
 * set is reported only where the arrows lead back into it, because a part standing
 * in a loop does reach itself and a part standing outside one does not. A block
 * answers as one part: the members are the start, and what stays among them is
 * inside the block rather than reach out of it.
 * @param {Map<string, { part: string, key: string }[]>} table
 * @param {string[]} start
 * @param {string} named the part the answer is about
 */
function distances(table, start, named) {
  const inside = new Set(start);
  const found = new Map();
  let frontier = [...start];
  for (let step = 1; frontier.length; step += 1) {
    const next = [];
    for (const part of frontier)
      for (const edge of table.get(part) ?? []) {
        if (found.has(edge.part) || inside.has(edge.part)) {
          // An arrow back into the block is the block reaching itself, reported
          // once under the name the reader selected.
          if (inside.has(edge.part) && inside.size === 1 && !found.has(named))
            found.set(named, { part: named, distance: step });
          continue;
        }
        found.set(edge.part, { part: edge.part, distance: step });
        next.push(edge.part);
      }
    frontier = next;
  }
  return [...found.values()].sort(
    (one, other) =>
      one.distance - other.distance || one.part.localeCompare(other.part),
  );
}

/**
 * The groups of parts that reach each other, within a given set. A cycle is a
 * property of a group, not of the arrow a reader happened to click: parts in one
 * strongly connected group all reach one another, so the group is reported once
 * however it is entered, with one way round it named.
 * @param {ReturnType<typeof index>} tables
 * @param {Set<string>} within
 */
function loops(tables, within) {
  const order = [...within].sort();
  const state = new Map();
  const stack = [];
  const groups = [];
  let counter = 0;
  // Tarjan, written iteratively: an architecture is read from a file and may be
  // deeper than the call stack allows.
  for (const root of order) {
    if (state.has(root)) continue;
    const work = [{ part: root, edge: 0 }];
    while (work.length) {
      const frame = work[work.length - 1];
      if (frame.edge === 0) {
        counter += 1;
        state.set(frame.part, { index: counter, low: counter, open: true });
        stack.push(frame.part);
      }
      const edges = (tables.out.get(frame.part) ?? []).filter((edge) =>
        within.has(edge.part),
      );
      if (frame.edge < edges.length) {
        const next = edges[frame.edge].part;
        frame.edge += 1;
        const seen = state.get(next);
        if (!seen) work.push({ part: next, edge: 0 });
        else if (seen.open) {
          const here = state.get(frame.part);
          here.low = Math.min(here.low, seen.index);
        }
        continue;
      }
      work.pop();
      const here = state.get(frame.part);
      if (work.length) {
        const above = state.get(work[work.length - 1].part);
        above.low = Math.min(above.low, here.low);
      }
      if (here.low === here.index) {
        const group = [];
        for (let member = null; member !== frame.part; ) {
          member = stack.pop();
          state.get(member).open = false;
          group.push(member);
        }
        groups.push(group);
      }
    }
  }
  const cycles = [];
  for (const group of groups) {
    const parts = [...group].sort();
    const members = new Set(parts);
    const selfLoop = (tables.out.get(parts[0]) ?? []).find(
      (edge) => edge.part === parts[0],
    );
    if (parts.length === 1 && !selfLoop) continue;
    cycles.push({ parts, ...roundTrip(tables, parts[0], members) });
  }
  return cycles.sort((one, other) =>
    one.parts[0].localeCompare(other.parts[0]),
  );
}

/**
 * One way round a loop, starting at the named part: the shortest walk that leaves
 * it and arrives back, and the relations followed on the way.
 * @param {ReturnType<typeof index>} tables
 * @param {string} start
 * @param {Set<string>} within
 */
function roundTrip(tables, start, within) {
  const came = new Map();
  let frontier = [start];
  while (frontier.length) {
    const next = [];
    for (const part of frontier)
      for (const edge of tables.out.get(part) ?? []) {
        if (!within.has(edge.part)) continue;
        if (edge.part === start) {
          const loop = [],
            relations = [];
          for (let at = part; at !== start; ) {
            const step = came.get(at);
            loop.unshift(at);
            relations.unshift(step.key);
            at = step.from;
          }
          loop.unshift(start);
          relations.push(edge.key);
          return { loop, relations };
        }
        if (came.has(edge.part)) continue;
        came.set(edge.part, { from: part, key: edge.key });
        next.push(edge.part);
      }
    frontier = next;
  }
  return { loop: [start], relations: [] };
}

/**
 * What a change to one part reaches, and what reaches it. `downstream` is the
 * parts its arrows lead to at any depth, `upstream` the parts whose arrows lead
 * to it, each with the number of steps on the shortest way. `cycles` names the
 * groups within that reach whose members all reach each other. A part the
 * relations never mention is reported as unknown, because a typo and a leaf that
 * exchanges nothing are different answers.
 * @param {Relation[]} relations
 * @param {string} part
 * @param {string[]} [members] the leaves the part stands for, when it is a block
 */
export function reach(relations, part, members = [part]) {
  const tables = index(relations);
  const start = members.filter((member) => tables.out.has(member));
  if (!start.length)
    return { part, known: false, downstream: [], upstream: [], cycles: [] };
  const downstream = distances(tables.out, start, part);
  const upstream = distances(tables.into, start, part);
  const within = new Set([
    ...start,
    ...downstream.map((entry) => entry.part),
    ...upstream.map((entry) => entry.part),
  ]);
  return {
    part,
    known: true,
    downstream,
    upstream,
    cycles: loops(tables, within),
  };
}

/**
 * The shortest way from one part to another, the way the arrows point: the parts
 * passed through and the relations followed, or `null` when the arrows do not
 * lead there. A part is no path to itself - a loop back to it is a cycle, which
 * `reach` reports.
 * @param {Relation[]} relations
 * @param {string | string[]} from one part, or the members of a block
 * @param {string | string[]} to one part, or the members of a block
 */
export function pathBetween(relations, from, to) {
  const start = Array.isArray(from) ? from : [from];
  const target = new Set(Array.isArray(to) ? to : [to]);
  // A block already containing the other end has no way out to it, and neither end
  // may be empty.
  if (!start.length || !target.size) return null;
  if (start.some((part) => target.has(part))) return null;
  const { out } = index(relations);
  if (
    !start.some((part) => out.has(part)) ||
    ![...target].some((part) => out.has(part))
  )
    return null;
  const inside = new Set(start);
  const came = new Map();
  let frontier = [...start];
  while (frontier.length) {
    const next = [];
    for (const part of frontier)
      for (const edge of out.get(part) ?? []) {
        if (inside.has(edge.part) || came.has(edge.part)) continue;
        came.set(edge.part, { from: part, key: edge.key });
        if (target.has(edge.part)) {
          const to = edge.part;
          const parts = [to],
            keys = [];
          for (let at = to; !inside.has(at); ) {
            const step = came.get(at);
            keys.unshift(step.key);
            parts.unshift(step.from);
            at = step.from;
          }
          return { parts, relations: keys };
        }
        next.push(edge.part);
      }
    frontier = next;
  }
  return null;
}
