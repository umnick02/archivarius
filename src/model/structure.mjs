import validate from '../generated/validate.mjs';
import validateProject from '../generated/validate-project.mjs';

const pointer = (value) =>
  String(value).replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * @typedef {{ instancePath: string, keyword: string, schemaPath: string,
 *   params: Record<string, string | undefined> }} SchemaError
 * @typedef {((model: unknown) => boolean) & { errors?: SchemaError[] | null }}
 *   SchemaValidator
 * @param {{ version?: unknown }} model any parsed JSON, shape unverified
 * @param {SchemaValidator} [validator]
 * @returns {import('./errors.mjs').Diagnostic[]}
 */
export function checkStructure(
  model,
  validator = model?.version === 4 ? validateProject : validate,
) {
  // File input is a tree. Object input can contain cycles, which must be
  // rejected before entering a recursive JSON Schema validator.
  const active = new Set();
  const done = new Set();
  const stack = [{ value: model, path: '' }];
  while (stack.length) {
    const { value, path, leaving } = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (leaving) {
      active.delete(value);
      done.add(value);
      continue;
    }
    if (active.has(value)) return [{ code: 'CONTAINMENT_CYCLE', path }];
    if (done.has(value)) continue;
    active.add(value);
    stack.push({ value, path, leaving: true });
    for (const [key, child] of Object.entries(value))
      stack.push({ value: child, path: path + '/' + pointer(key) });
  }
  if (validator(model)) return [];
  return validator.errors.map(
    ({ instancePath, keyword, schemaPath, params }) => {
      const property =
        params.missingProperty ??
        params.additionalProperty ??
        params.unevaluatedProperty;
      return {
        code: 'SCHEMA_VIOLATION',
        path:
          instancePath +
          (property === undefined ? '' : '/' + pointer(property)),
        keyword,
        schemaPath,
        params: { ...params },
      };
    },
  );
}
