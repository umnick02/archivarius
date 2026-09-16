#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  readArchitectureFile,
  exportProjectDocuments,
  generateDocumentation,
  verifyProjectFiles,
  updateProjectFile,
  executeProjectCheck,
  writeAtomic,
  archiveProjectFile,
} from './node.mjs';
import { analyzeProject } from './model/project-analysis.mjs';
import { projectContext, projectRead } from './model/project-authoring.mjs';
import { parseJSON } from './core.mjs';

async function main() {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        json: { type: 'boolean' },
        output: { type: 'string' },
        check: { type: 'boolean' },
        help: { type: 'boolean' },
        focus: { type: 'string', multiple: true },
        context: { type: 'string' },
        change: { type: 'string' },
        result: { type: 'string' },
        evidence: { type: 'string' },
      },
    }));
    if (values.help && positionals.length === 0) {
      process.stdout.write(
        await fs.readFile(
          new URL('../assets/cli-help.txt', import.meta.url),
          'utf8',
        ),
      );
      return;
    }
    const [command] = positionals;
    const allowed = {
      validate: ['json'],
      reference: ['output', 'check'],
      documents: ['output', 'check', 'json'],
      context: ['focus', 'json', 'output'],
      read: ['focus', 'json'],
      archive: ['json'],
      apply: ['context', 'change', 'json'],
      verify: ['json'],
      run: ['focus', 'result', 'evidence', 'json'],
    };
    if (
      values.help ||
      Object.keys(values).some((key) => !allowed[command]?.includes(key)) ||
      positionals.length !== 2 ||
      ![
        'validate',
        'reference',
        'documents',
        'context',
        'read',
        'archive',
        'apply',
        'verify',
        'run',
      ].includes(command) ||
      (['context', 'read'].includes(command) && !values.focus?.length) ||
      (command === 'apply' && (!values.context || !values.change)) ||
      (command === 'run' &&
        (values.focus?.length !== 1 || !values.result || !values.evidence)) ||
      (command === 'reference' && (!values.output || values.json)) ||
      (command === 'documents' && !values.output) ||
      (command === 'validate' && (values.output !== undefined || values.check))
    )
      throw new Error('INVALID_ARGUMENTS');
  } catch {
    process.stderr.write(
      await fs.readFile(
        new URL('../assets/cli-help.txt', import.meta.url),
        'utf8',
      ),
    );
    process.exitCode = 2;
    return;
  }
  const [command, input] = positionals;
  try {
    const model = await readArchitectureFile(input);
    const print = (value) =>
      process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    if (command === 'documents') {
      print(
        await exportProjectDocuments(model, values.output, {
          check: values.check,
          source: input,
        }),
      );
      return;
    }
    if (command === 'archive') {
      await archiveProjectFile(input);
      print({ valid: true, archived: true });
      return;
    }
    if (command === 'read') {
      print(projectRead(model, values.focus));
      return;
    }
    if (command === 'context') {
      const context = projectContext(model, values.focus);
      if (values.output) {
        const output = path.resolve(values.output);
        const actual = await fs.realpath(output).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        if (
          output === path.resolve(input) ||
          actual === (await fs.realpath(input))
        )
          throw new Error('OUTPUT_IS_MODEL');
        await writeAtomic(output, JSON.stringify(context, null, 2) + '\n');
        print({ ...projectRead(model, values.focus), receipt: output });
      } else print(context);
      return;
    }
    if (command === 'apply') {
      const context = parseJSON(await fs.readFile(values.context, 'utf8'));
      const change = parseJSON(await fs.readFile(values.change, 'utf8'));
      const updated = await updateProjectFile(input, context, change);
      print({ valid: true, contract: analyzeProject(updated).contract });
      return;
    }
    if (command === 'verify') {
      const result = await verifyProjectFiles(
        model,
        path.dirname(path.resolve(input)),
      );
      const outcome = result.analysis.completion[model.root];
      print({ valid: true, ...outcome, evidence: result.diagnostics });
      if (!outcome.implemented) process.exitCode = 1;
      return;
    }
    if (command === 'run') {
      const context = projectContext(model, values.focus);
      const record = await executeProjectCheck(model, values.focus[0], {
        directory: path.dirname(path.resolve(input)),
        resultKey: values.result,
        evidencePath: values.evidence,
      });
      await updateProjectFile(input, context, { put: [record] });
      print({ valid: true, result: record.key, outcome: record.outcome });
      if (record.outcome !== 'pass') process.exitCode = 1;
      return;
    }
    if (command === 'validate') {
      process.stdout.write(
        JSON.stringify(
          { valid: true, errors: [], diagnostics: [] },
          null,
          values.json ? 2 : undefined,
        ) + '\n',
      );
      return;
    }
    const output = path.resolve(values.output);
    const inputStat = await fs.stat(input);
    const outputStat = await fs.stat(output).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (
      path.resolve(input) === output ||
      (outputStat &&
        inputStat.ino === outputStat.ino &&
        inputStat.dev === outputStat.dev)
    )
      throw new Error('OUTPUT_IS_MODEL');
    const markdown = await generateDocumentation(model);
    if (values.check) {
      const existing = await fs.readFile(output, 'utf8').catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (existing !== markdown) throw new Error('DOCUMENT_OUT_OF_DATE');
    } else {
      await writeAtomic(output, markdown);
    }
    process.stdout.write(output + '\n');
  } catch (error) {
    const result = {
      valid: false,
      errors: error.issues?.length
        ? error.issues
        : [error.code || error.message],
      diagnostics: error.diagnostics || [],
    };
    if (values.json)
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else process.stderr.write(result.errors.join('\n') + '\n');
    process.exitCode = 1;
  }
}

await main();
