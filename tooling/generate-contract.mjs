import fs from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { compile } from 'json-schema-to-typescript';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const output = new URL('src/generated/', root);
await fs.mkdir(output, { recursive: true });
for (const [file, name, validatorName, typeName] of [
  [
    'architecture.schema.json',
    'ArchitectureModel',
    'validate.mjs',
    'model.d.mts',
  ],
  [
    'model.schema.json',
    'ProjectModel',
    'validate-project.mjs',
    'project.d.mts',
  ],
  [
    'change.schema.json',
    'ProjectChange',
    'validate-change.mjs',
    'change.d.mts',
  ],
]) {
  const schema = JSON.parse(
    await fs.readFile(new URL('assets/' + file, root), 'utf8'),
  );
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    messages: false,
    code: { source: true, esm: true },
  });
  if (name === 'ProjectChange')
    ajv.addSchema(
      JSON.parse(
        await fs.readFile(new URL('assets/model.schema.json', root), 'utf8'),
      ),
      'model.schema.json',
    );
  const validator = ajv.compile(schema);
  const bundled = await build({
    stdin: {
      contents: standaloneCode(ajv, validator),
      resolveDir: root.pathname,
      sourcefile: 'schema-validator.mjs',
    },
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    write: false,
  });
  const types = await compile(schema, name, {
    cwd: new URL('assets/', root).pathname,
    additionalProperties: false,
    bannerComment: '',
    style: { singleQuote: true },
  });
  // The bundle is ajv's output, so it is neither formatted nor typed by hand:
  // `npm run lint:types` reads the shape from checkStructure's JSDoc instead.
  await fs.writeFile(
    new URL(validatorName, output),
    '// @ts-nocheck\n' + bundled.outputFiles[0].text,
  );
  await fs.writeFile(new URL(typeName, output), types);
  if (name === 'ProjectModel') {
    const fields = Object.fromEntries(
      schema.$defs.record.oneOf.map((variant) => [
        variant.properties.type.const,
        variant.properties,
      ]),
    );
    const references = Object.fromEntries(
      Object.entries(fields).map(([kind, properties]) => [
        kind,
        Object.entries(properties)
          .filter(([, field]) => field['x-targets'])
          .map(([name, field]) => ({
            name,
            types: field['x-targets'],
            history: !!field['x-history'],
          })),
      ]),
    );
    await fs.writeFile(
      new URL('references.mjs', output),
      'export default ' + JSON.stringify(references) + ';\n',
    );
    // The schema already separates prose from structure: a field states prose
    // when it refers to text or texts, while keys, enums and digests describe
    // the graph. Every reader of the model - the map, the readme, an authoring
    // prompt - selects fields from this one table instead of naming them.
    const prose = Object.fromEntries(
      Object.entries(fields).map(([kind, properties]) => [
        kind,
        Object.entries(properties)
          .map(([name, field]) => [
            name,
            /#\/\$defs\/(texts?)$/.exec(field.$ref),
          ])
          .filter(([, match]) => match)
          .map(([name, match]) => ({ name, many: match[1] === 'texts' })),
      ]),
    );
    await fs.writeFile(
      new URL('prose.mjs', output),
      'export default ' + JSON.stringify(prose) + ';\n',
    );
  }
}
