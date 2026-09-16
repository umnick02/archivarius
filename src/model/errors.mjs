/**
 * What a validator reports about one failure: a stable `code` and the JSON
 * Pointer `path` that failed, plus whichever detail the producer has — the
 * record a rule names, or the schema keyword that rejected the value.
 *
 * @typedef {{ code: string, path: string, subject?: string, keyword?: string,
 *   schemaPath?: string, params?: Record<string, string | undefined> }} Diagnostic
 */

export class ArchitectureError extends Error {
  constructor(code, issues = [], diagnostics = []) {
    super([code, ...issues].join('\n'));
    this.name = 'ArchitectureError';
    this.code = code;
    this.issues = issues;
    this.diagnostics = diagnostics;
  }
}
