import { ArchitectureGraph } from './model/graph.mjs';
import { visit } from 'jsonc-parser';
import { ArchitectureError } from './model/errors.mjs';
import { validateProject } from './model/project-contract.mjs';
export { ArchitectureError } from './model/errors.mjs';
export { analyzeProject } from './model/project-analysis.mjs';
export {
  applyProjectChanges,
  projectContext,
  projectRead,
} from './model/project-authoring.mjs';
export { validateProject } from './model/project-contract.mjs';
export {
  contractDigest,
  dependencyDigest,
  realizationDigest,
} from './model/project-digest.mjs';

export function validateArchitecture(model) {
  if (model?.version === 4) return validateProject(model);
  const { errors, diagnostics } = ArchitectureGraph.validate(model);
  return { valid: errors.length === 0, errors, diagnostics };
}

export function parseJSON(text) {
  if (typeof text !== 'string') throw new ArchitectureError('INVALID_JSON');
  const diagnostics = [],
    objects = [];
  visit(
    text,
    {
      onObjectBegin: () => {
        objects.push(new Set());
      },
      onObjectEnd: () => {
        objects.pop();
      },
      onObjectProperty(property, offset, length, line, column, path) {
        const keys = objects.at(-1);
        if (keys.has(property))
          diagnostics.push({
            code: 'DUPLICATE_PROPERTY',
            path:
              '/' +
              [...path(), property]
                .map((part) =>
                  String(part).replaceAll('~', '~0').replaceAll('/', '~1'),
                )
                .join('/'),
            params: { line: line + 1, column: column + 1 },
          });
        keys.add(property);
      },
      onError(error, offset, length, line, column) {
        diagnostics.push({
          code: 'INVALID_JSON',
          path: '',
          params: { error, line: line + 1, column: column + 1 },
        });
      },
    },
    {
      disallowComments: true,
      allowTrailingComma: false,
      allowEmptyContent: false,
    },
  );
  if (diagnostics.length)
    throw new ArchitectureError(
      'INVALID_JSON',
      diagnostics.map((issue) => issue.code + ':' + (issue.path || '/')),
      diagnostics,
    );
  let model;
  try {
    model = JSON.parse(text);
  } catch {
    throw new ArchitectureError('INVALID_JSON');
  }
  return model;
}

export function parseArchitecture(text) {
  const model = parseJSON(text);
  const result = validateArchitecture(model);
  if (!result.valid)
    throw new ArchitectureError(
      'INVALID_MODEL',
      result.errors,
      result.diagnostics,
    );
  return model;
}

export { renderDocument } from './model/documents.mjs';
