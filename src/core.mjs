import { ArchitectureGraph } from './graph.mjs';

export class ArchitectureError extends Error {
  constructor(code, issues = []) {
    super([code, ...issues].join('\n'));
    this.name = 'ArchitectureError';
    this.code = code;
    this.issues = issues;
  }
}

export function validateArchitecture(model) {
  const { errors } = ArchitectureGraph.validate(model);
  return { valid: errors.length === 0, errors };
}

export function parseArchitecture(text) {
  let model;
  try {
    model = JSON.parse(text);
  } catch {
    throw new ArchitectureError('INVALID_JSON');
  }
  const result = validateArchitecture(model);
  if (!result.valid)
    throw new ArchitectureError('INVALID_MODEL', result.errors);
  return model;
}
