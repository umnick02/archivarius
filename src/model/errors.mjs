export class ArchitectureError extends Error {
  constructor(code, issues = [], diagnostics = []) {
    super([code, ...issues].join('\n'));
    this.name = 'ArchitectureError';
    this.code = code;
    this.issues = issues;
    this.diagnostics = diagnostics;
  }
}
