// A refusal, as something a reader can act on.
//
// The library raises `ArchitectureError` with a code, a list of issues and a list
// of diagnostics. A surface cannot print that as it stands: the code means
// nothing on its own, and a diagnostic is a record of a reading, not a sentence.
// This module turns a raised failure into the statements a surface prints — the
// code, what the catalogue says it means and what to do about it, and one
// statement per diagnostic naming the record, the field, what was read and what
// was expected.
//
// It invents no English. Every word about a code comes from the catalogue in
// `errors.mjs`, and when a code is not catalogued the report says so instead of
// printing a blank as though it were the meaning — a missing catalogue entry is a
// gap in the library, and hiding it would leave the reader with a bare code and
// no way to tell whose fault that is.
import { failureCodes } from './errors.mjs';

const catalogued = (code) =>
  typeof code === 'string' && Object.hasOwn(failureCodes, code)
    ? failureCodes[code]
    : null;

/**
 * One statement per diagnostic, keeping everything the diagnostic stated and
 * adding only whether its own code is catalogued.
 * @param {unknown} diagnostics
 */
const statementsOf = (diagnostics) =>
  (Array.isArray(diagnostics) ? diagnostics : []).map((issue) => ({
    code: issue?.code ?? null,
    path: issue?.path ?? null,
    record: issue?.record ?? null,
    field: issue?.field ?? null,
    value: issue?.value ?? null,
    expected: issue?.expected ?? null,
    catalogued: Boolean(catalogued(issue?.code)),
  }));

/**
 * The issues a failure lists are written `CODE` or `CODE:subject`. Split them so
 * a surface can name the record an issue is about without parsing text itself.
 * @param {unknown} issues
 */
const issuesOf = (issues) =>
  (Array.isArray(issues) ? issues : []).map((issue) => {
    const [code, ...rest] = String(issue).split(':');
    return { code, subject: rest.length ? rest.join(':') : null };
  });

/**
 * Read a raised failure into plain data a surface can hold as state and print.
 * Anything can be thrown, so anything can be read: an `ArchitectureError`, a
 * `TypeError` from a failed fetch, a bare string. `null` in, `null` out — there is
 * no failure to report.
 * @param {unknown} error
 * @returns {{
 *   code: string,
 *   message: string,
 *   catalogued: boolean,
 *   meaning: string | null,
 *   remedy: string | null,
 *   issues: { code: string, subject: string | null }[],
 *   statements: ReturnType<typeof statementsOf>,
 * } | null}
 */
export function failureReport(error) {
  if (error === null || error === undefined) return null;
  // Anything can be thrown, so the shape is read defensively rather than
  // asserted: a raised value is a bag of unknown fields until each one is read.
  const raised = /** @type {Record<string, unknown> | null} */ (
    typeof error === 'object' ? error : null
  );
  const code = String(raised?.code ?? raised?.name ?? 'Error');
  const entry = catalogued(code);
  return {
    code,
    message: raised ? String(raised.message ?? '') : String(error),
    catalogued: Boolean(entry),
    meaning: entry?.meaning ?? null,
    remedy: entry?.remedy ?? null,
    issues: issuesOf(raised?.issues),
    statements: statementsOf(raised?.diagnostics),
  };
}
