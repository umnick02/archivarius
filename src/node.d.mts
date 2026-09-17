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
export function verifyProjectFiles(
  model: ProjectModel,
  directory: string,
): Promise<{
  verifiedResults: string[];
  diagnostics: Array<{ code: string; key: string }>;
  analysis: ProjectAnalysis;
}>;
export function updateProjectFile(
  file: string,
  context: ProjectContext,
  change: ProjectChange,
): Promise<ProjectModel>;
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
