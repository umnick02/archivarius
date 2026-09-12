import {
  assertProject,
  contractDigest,
  realizationDigest,
} from './project.mjs';
import { hashBytes } from './digest.mjs';
import { canonical } from './digest.mjs';

export function relativeArtifactPath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.startsWith('/') &&
    !/[\\:#?%\u0000]/.test(path) &&
    path.split('/').every((part) => part && part !== '.' && part !== '..')
  );
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
