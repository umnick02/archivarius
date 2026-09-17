import { assertProject } from './project-contract.mjs';
import { contractDigest, realizationDigest } from './project-digest.mjs';
import { hashBytes } from './digest.mjs';
import { canonical, digest } from './digest.mjs';

export function relativeArtifactPath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.startsWith('/') &&
    // NUL is rejected on purpose: it truncates paths in native filesystem calls.
    // eslint-disable-next-line no-control-regex
    !/[\\:#?%\u0000]/.test(path) &&
    path.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

/**
 * What one run produced, as the edge that executed it observed it.
 *
 * @typedef {{ exitCode: number, stdout?: string, stderr?: string,
 *   startedAt?: string, finishedAt?: string }} RunOutcome
 */

// The output is kept twice on purpose: readable text for a person, and a digest
// over the bytes for a reader who has to tell whether that text is still the
// text the run produced.
const outputSummary = ({ stdout = '', stderr = '' }) => {
  const bytes = new TextEncoder().encode(stdout + stderr);
  return { bytes: bytes.length, digest: hashBytes(bytes) };
};

/**
 * The receipt a run leaves behind: which check ran, the command it ran, the
 * exit status it ended with, the bytes it printed, and what it ran against —
 * the contract digest and the bound source bytes, named file by file so the
 * receipt still says what it covered without the model beside it.
 *
 * An outcome is derived here rather than passed in: `pass` means the process
 * exited zero, and nothing else may claim it.
 *
 * @param {any} model the snapshot the run read
 * @param {any} check the check record whose command ran
 * @param {RunOutcome} run
 * @returns {any} the evidence document to store
 */
export function runEvidence(model, check, run) {
  const { exitCode, stdout = '', stderr = '', startedAt, finishedAt } = run;
  return {
    version: 1,
    check: check.key,
    contract: contractDigest(model),
    realization: realizationDigest(model),
    bindings: structuredClone(model.bindings),
    command: structuredClone(check.command),
    startedAt,
    finishedAt,
    outcome: exitCode === 0 ? 'pass' : 'fail',
    exitCode,
    stdout,
    stderr,
    output: outputSummary(run),
  };
}

/**
 * Whether one receipt really describes the result it is offered for. Every
 * field a receipt states is held to the model and to itself; a field it does
 * not state is not read as a contradiction, so a receipt written before this
 * module asked for the output digest still confirms what it does state.
 *
 * @param {any} evidence the stored receipt
 * @param {{ result: any, check: any, contract: string, realization: string }} against
 * @returns {boolean}
 */
export function evidenceDescribesRun(evidence, against) {
  const { result, check, contract, realization } = against;
  if (
    evidence.version !== 1 ||
    evidence.check !== result.check ||
    evidence.contract !== contract ||
    evidence.realization !== realization ||
    evidence.outcome !== result.outcome ||
    !check?.command ||
    canonical(evidence.command) !== canonical(check.command) ||
    !Number.isInteger(evidence.exitCode) ||
    (evidence.exitCode === 0) !== (result.outcome === 'pass') ||
    typeof evidence.startedAt !== 'string' ||
    typeof evidence.finishedAt !== 'string'
  )
    return false;
  // The bytes of the run's output, so the text in the receipt cannot be reworded.
  if (evidence.output !== undefined) {
    const summary = outputSummary(evidence);
    if (
      !evidence.output ||
      typeof evidence.output !== 'object' ||
      evidence.output.bytes !== summary.bytes ||
      evidence.output.digest !== summary.digest
    )
      return false;
  }
  // The source bytes it ran against, named file by file: the same set the
  // realization digest stands for, or the receipt is describing another run.
  if (
    evidence.bindings !== undefined &&
    digest(evidence.bindings) !== realization
  )
    return false;
  return true;
}

/**
 * Which results were never run at all. An outcome is a report on a run, so a
 * result may only enter a model whose contract and bound source bytes are the
 * ones a run could have happened against — a basis naming neither is a claim
 * with nothing behind it.
 *
 * @param {any} model the snapshot the results would enter
 * @param {any[]} results the result records being recorded
 * @returns {string[]} the keys that no run stands behind
 */
export function unrunResults(model, results) {
  const contract = contractDigest(model),
    realization = realizationDigest(model);
  return results
    .filter(
      (result) =>
        result.basis?.contract !== contract ||
        result.realization !== realization ||
        !result.evidence?.length,
    )
    .map((result) => result.key);
}

export async function verifyProjectEvidence(model, readBytes) {
  assertProject(model);
  const contract = contractDigest(model),
    realization = realizationDigest(model);
  const diagnostics = [],
    verifiedResults = [],
    cache = new Map();
  const read = (artifact) => {
    const key = artifact.path + ':' + artifact.digest;
    if (!cache.has(key))
      cache.set(
        key,
        (async () => {
          if (!relativeArtifactPath(artifact.path))
            throw new Error('ARTIFACT_PATH');
          const bytes = await readBytes(artifact.path);
          if (hashBytes(bytes) !== artifact.digest)
            throw new Error('ARTIFACT_CHANGED');
          return bytes;
        })(),
      );
    return cache.get(key);
  };
  const bindings = await Promise.allSettled(
    Object.values(model.bindings).map(read),
  );
  const bindingsValid =
    bindings.length > 0 && bindings.every((r) => r.status === 'fulfilled');
  for (const result of model.records.filter((r) => r.type === 'result')) {
    try {
      if (!bindingsValid) throw new Error('REALIZATION_UNAVAILABLE');
      if (
        result.basis?.contract !== contract ||
        result.realization !== realization
      )
        throw new Error('BASIS_CHANGED');
      for (const artifact of result.evidence) {
        const bytes = await read(artifact);
        const evidence = JSON.parse(new TextDecoder().decode(bytes));
        const check = model.records.find(
          (r) => r.key === result.check && r.type === 'check',
        );
        if (
          !evidenceDescribesRun(evidence, {
            result,
            check,
            contract,
            realization,
          })
        )
          throw new Error('EVIDENCE_INVALID');
      }
      verifiedResults.push(result.key);
    } catch (error) {
      diagnostics.push({ code: error.message, key: result.key });
    }
  }
  // Check again after reading receipts so a changed input cannot borrow an earlier read.
  if (verifiedResults.length) {
    const stable = await Promise.allSettled(
      Object.values(model.bindings).map(async (binding) => {
        if (hashBytes(await readBytes(binding.path)) !== binding.digest)
          throw new Error('REALIZATION_CHANGED');
      }),
    );
    if (stable.some((result) => result.status === 'rejected')) {
      diagnostics.push(
        ...verifiedResults.map((key) => ({ code: 'REALIZATION_CHANGED', key })),
      );
      verifiedResults.length = 0;
    }
  }
  return { verifiedResults, diagnostics };
}
