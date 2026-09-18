#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  readArchitectureFile,
  exportProjectDocuments,
  generateDocumentation,
  generateGraph,
  generateHistory,
  generateReadme,
  initProjectFile,
  verifyProjectFiles,
  reconcileProjectFiles,
  updateProjectFile,
  executeProjectCheck,
  diffProjectFiles,
  writeAtomic,
  archiveProjectFile,
  useGitProjectHistory,
} from './node.mjs';
import { analyzeProject } from './model/project-analysis.mjs';
import { graphFormats } from './model/export.mjs';
import { projectContext, projectRead } from './model/project-authoring.mjs';
import { ArchitectureError, parseJSON } from './core.mjs';

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
        format: { type: 'string' },
        against: { type: 'string' },
        stale: { type: 'boolean' },
        title: { type: 'string' },
        timeout: { type: 'string' },
        resolves: { type: 'string', multiple: true },
        resolution: { type: 'string' },
      },
    }));
    if (values.help && positionals.length === 0) {
      process.stdout.write(
        await fs.readFile(
          new URL('../assets/archivarius-cli-help.txt', import.meta.url),
          'utf8',
        ),
      );
      return;
    }
    const [command] = positionals;
    const allowed = {
      init: ['title', 'json'],
      validate: ['json'],
      reference: ['output', 'check'],
      readme: ['output', 'check'],
      graph: ['output', 'check', 'format'],
      history: ['output', 'check'],
      documents: ['output', 'check', 'json'],
      context: ['focus', 'json', 'output'],
      read: ['focus', 'json'],
      archive: ['json'],
      'git-history': ['json'],
      diff: ['against', 'stale', 'output', 'json'],
      apply: ['context', 'change', 'json'],
      verify: ['json'],
      reconcile: ['json'],
      run: [
        'focus',
        'result',
        'evidence',
        'json',
        'timeout',
        'resolves',
        'resolution',
      ],
    };
    if (
      values.help ||
      Object.keys(values).some((key) => !allowed[command]?.includes(key)) ||
      positionals.length !== 2 ||
      ![
        'init',
        'validate',
        'reference',
        'readme',
        'graph',
        'history',
        'documents',
        'context',
        'read',
        'archive',
        'git-history',
        'diff',
        'apply',
        'verify',
        'reconcile',
        'run',
      ].includes(command) ||
      (['context', 'read'].includes(command) && !values.focus?.length) ||
      (command === 'apply' && (!values.context || !values.change)) ||
      (command === 'run' &&
        (values.focus?.length !== 1 ||
          !values.result ||
          !values.evidence ||
          // A gate that takes ten minutes is exactly the run worth a receipt, so
          // the budget is the caller's to state, in seconds; anything that is not
          // a positive number of them is a bad argument, not a missing budget.
          (values.timeout !== undefined && !(Number(values.timeout) > 0)) ||
          (values.resolves?.length && !values.resolution?.trim()))) ||
      (['reference', 'readme', 'history'].includes(command) &&
        (!values.output || values.json)) ||
      (command === 'graph' &&
        (!values.output ||
          !Object.hasOwn(graphFormats, values.format ?? 'dot'))) ||
      (command === 'documents' && !values.output) ||
      (command === 'validate' && (values.output !== undefined || values.check))
    )
      throw new Error('INVALID_ARGUMENTS');
  } catch {
    process.stderr.write(
      await fs.readFile(
        new URL('../assets/archivarius-cli-help.txt', import.meta.url),
        'utf8',
      ),
    );
    process.exitCode = 2;
    return;
  }
  const [command, input] = positionals;
  try {
    // The one command that writes where nothing is readable yet, so it answers
    // before the model is read rather than after failing to read it.
    if (command === 'init') {
      await initProjectFile(input, { title: values.title });
      process.stdout.write(path.resolve(input) + '\n');
      return;
    }
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
    if (command === 'git-history') {
      await useGitProjectHistory(input);
      print({ valid: true, history: 'git' });
      return;
    }
    if (command === 'read') {
      print(projectRead(model, values.focus));
      return;
    }
    if (command === 'diff') {
      const diff = await diffProjectFiles(input, values.against);
      // --stale keeps the freshness report: every record that lost its basis,
      // with the definition that moved, in the order it should be read.
      const report = values.stale
        ? {
            before: diff.before,
            after: diff.after,
            moved: diff.moved,
            readingList: diff.readingList,
          }
        : diff;
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
        await writeAtomic(output, JSON.stringify(report, null, 2) + '\n');
        process.stdout.write(output + '\n');
      } else print(report);
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
    // A disagreement between a description and the code is a failure of the
    // description, so it is raised by name after the whole report is printed: the
    // edges it could attribute to nothing are reported beside it rather than
    // counted as agreement, and the exit names what is wrong.
    if (command === 'reconcile') {
      const report = await reconcileProjectFiles(
        input,
        path.dirname(path.resolve(input)),
      );
      const disagreement = [
        ...report.absent.map(
          (entry) => entry.relation + ': ' + entry.from + ' -> ' + entry.to,
        ),
        ...report.undeclared.map((entry) => entry.from + ' -> ' + entry.to),
      ];
      print({ valid: !disagreement.length, ...report });
      if (disagreement.length)
        throw new ArchitectureError('DESCRIPTION_CONTRADICTED', disagreement);
      return;
    }
    if (command === 'run') {
      const context = projectContext(model, values.focus);
      const record = await executeProjectCheck(model, values.focus[0], {
        directory: path.dirname(path.resolve(input)),
        resultKey: values.result,
        evidencePath: values.evidence,
        timeout: Number(values.timeout ?? 60) * 1000,
        resolves: values.resolves ?? [],
        ...(values.resolution ? { resolution: values.resolution } : {}),
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
    const contents =
      command === 'graph'
        ? generateGraph(model, values.format)
        : command === 'history'
          ? generateHistory(model)
          : command === 'readme'
            ? await generateReadme(model)
            : await generateDocumentation(model);
    if (values.check) {
      const existing = await fs.readFile(output, 'utf8').catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (existing !== contents) throw new Error('DOCUMENT_OUT_OF_DATE');
    } else {
      await writeAtomic(output, contents);
    }
    process.stdout.write(output + '\n');
  } catch (error) {
    // A refusal names itself first and gives its details after, so a reader of the
    // exit - or of the JSON - learns which failure happened, not only what it saw.
    const result = {
      valid: false,
      errors: [error.code || error.message, ...(error.issues ?? [])],
      diagnostics: error.diagnostics || [],
    };
    if (values.json)
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else process.stderr.write(result.errors.join('\n') + '\n');
    process.exitCode = 1;
  }
}

await main();
