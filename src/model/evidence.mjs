import { assertProject } from './project-contract.mjs';
import {
  contractDigest,
  movedDefinitions,
  realizationDigest,
} from './project-digest.mjs';
import { bindingHolds, bindingParts, partDigest } from './binding.mjs';
import { hashBytes } from './digest.mjs';
import { failureCodes } from './errors.mjs';
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
 * @param {{ result: any, check: any, realization: string }} against
 * @returns {boolean}
 */
export function evidenceDescribesRun(evidence, against) {
  const { result, check, realization } = against;
  if (
    evidence.version !== 1 ||
    evidence.check !== result.check ||
    // The contract the run read is the one the result names, not whatever the
    // snapshot says today: an edit elsewhere moves the current contract without
    // touching either. The realization is bytes, so it is held to the present.
    evidence.contract !== result.basis?.contract ||
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
  // A binding is read part by part: only the lines a part claims are hashed, so a
  // file one claim shares with another is read once and an edit outside every
  // claimed range changes none of their digests.
  const files = new Map();
  const readFile = (path) => {
    if (!files.has(path))
      files.set(
        path,
        (async () => {
          if (!relativeArtifactPath(path)) throw new Error('ARTIFACT_PATH');
          return readBytes(path);
        })(),
      );
    return files.get(path);
  };
  // Every part is answered for, not just the first: a part whose lines are gone
  // states a repair, a part whose bytes moved only states a mismatch, and the
  // stated one is the reason worth carrying out of a binding that fails both ways.
  const readBinding = async (binding) => {
    let moved = false;
    for (const part of bindingParts(binding))
      if (partDigest(await readFile(part.path), part) !== part.digest)
        moved = true;
    if (moved) throw new Error('ARTIFACT_CHANGED');
  };
  const bindings = await Promise.allSettled(
    Object.values(model.bindings).map(readBinding),
  );
  // Why nothing anchors the results matters to whoever repairs it: a claim whose
  // lines are gone is rebound, an unreadable file is restored. A raised code
  // states itself; anything else is only the absence of an anchor.
  const rejected = bindings.filter((result) => result.status === 'rejected');
  const refusal =
    rejected.find((result) =>
      Object.hasOwn(failureCodes, result.reason?.code),
    ) ?? rejected[0];
  const bindingsValid = bindings.length > 0 && !rejected.length;
  // The named refusal is preferred, and the fallback is written as a literal so a
  // reader of the source - and the catalogue oracle - can see the code raised here.
  const unanchored =
    refusal?.reason?.code && Object.hasOwn(failureCodes, refusal.reason.code)
      ? new Error(refusal.reason.code)
      : new Error('REALIZATION_UNAVAILABLE');
  for (const result of model.records.filter((r) => r.type === 'result')) {
    try {
      if (!bindingsValid) throw unanchored;
      // The same proportionate rule the analysis reads: a receipt stands while the
      // definitions it names hold and the bytes it ran against are the bytes now.
      // A receipt that names no definitions falls back to the whole contract.
      const moved = movedDefinitions(model, result);
      if (
        (moved ? moved.length > 0 : result.basis?.contract !== contract) ||
        result.realization !== realization
      )
        throw new Error('BASIS_CHANGED');
      for (const artifact of result.evidence) {
        const bytes = await read(artifact);
        const evidence = JSON.parse(new TextDecoder().decode(bytes));
        const check = model.records.find(
          (r) => r.key === result.check && r.type === 'check',
        );
        if (!evidenceDescribesRun(evidence, { result, check, realization }))
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
        const now = new Map();
        for (const part of bindingParts(binding))
          if (!now.has(part.path))
            now.set(part.path, await readBytes(part.path));
        if (!bindingHolds(binding, now)) throw new Error('REALIZATION_CHANGED');
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
