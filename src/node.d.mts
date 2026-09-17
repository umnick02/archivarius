import type {
  ArchitectureInput,
  ProjectModel,
  ProjectRecord,
  ProjectChange,
  ProjectContext,
  ProjectAnalysis,
} from './core.mjs';

export function readArchitectureFile(
  path: string | URL,
): Promise<ArchitectureInput>;
export function writeAtomic(
  file: string,
  contents: string | Uint8Array,
): Promise<void>;
export function generateDocumentation(
  model: ArchitectureInput,
): Promise<string>;
export function generateReadme(model: ProjectModel): Promise<string>;
export function generateGraph(
  model: ArchitectureInput,
  format?: 'dot' | 'mermaid' | 'table',
): string;
export function generateHistory(model: ProjectModel): string;
export function initProjectFile(
  file: string,
  options?: { title?: string },
): Promise<ProjectModel>;
export function verifyProjectFiles(
  model: ProjectModel,
  directory: string,
): Promise<{
  verifiedResults: string[];
  diagnostics: Array<{ code: string; key: string }>;
  analysis: ProjectAnalysis;
}>;
export function reconcileProjectFiles(
  file: string,
  directory: string,
  options?: { within?: string[]; skip?: string[] },
): Promise<{
  confirmed: Array<{
    relation: string;
    from: string;
    to: string;
    fromPath: string;
    toPath: string;
  }>;
  absent: Array<{
    relation: string;
    from: string;
    to: string;
    fromPath: string;
    toPath: string;
  }>;
  undeclared: Array<{
    from: string;
    to: string;
    fromPath: string;
    toPath: string;
  }>;
  contained: Array<{
    from: string;
    to: string;
    fromPath: string;
    toPath: string;
    reason: 'inside-container' | 'into-contained';
  }>;
  undeclarable: Array<{
    from: string;
    to: string;
    fromPath: string;
    toPath: string;
    reason: 'source-is-group' | 'target-is-group';
  }>;
  unjudged: Array<{
    relation: string;
    from: string;
    to: string;
    reason:
      | 'endpoints-unbound'
      | 'source-unbound'
      | 'target-unbound'
      | 'shared-file';
  }>;
  unattributed: Array<{
    from: string;
    to: string;
    reason: 'endpoints-unknown' | 'source-unknown' | 'target-unknown';
  }>;
  observed: number;
}>;
export function updateProjectFile(
  file: string,
  context: ProjectContext,
  change: ProjectChange,
): Promise<ProjectModel>;

export interface ProjectDiffRecord {
  key: string;
  type: string;
  title: string;
}
export interface ProjectDiffSide {
  snapshot: string;
  contract: string;
  realization: string;
}
export interface ProjectDiff {
  before: ProjectDiffSide;
  after: ProjectDiffSide;
  added: ProjectDiffRecord[];
  removed: ProjectDiffRecord[];
  changed: Array<ProjectDiffRecord & { fields: string[] }>;
  moved: string[];
  readingList: Array<ProjectDiffRecord & { code: string; moved: string[] }>;
}
export function diffProjectFiles(
  file: string | URL,
  against?: string | URL | null,
): Promise<ProjectDiff>;
export function executeProjectCheck(
  model: ProjectModel,
  key: string,
  options: {
    directory: string;
    resultKey: string;
    evidencePath: string;
    timeout?: number;
  },
): Promise<Extract<ProjectRecord, { type: 'result' }>>;

export function exportProjectDocuments(
  model: ProjectModel,
  directory: string,
  options?: { check?: boolean; source?: string },
): Promise<{ files: string[]; changed: string[] }>;

export function archiveProjectFile(file: string): Promise<ProjectModel>;
