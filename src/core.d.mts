import type { ArchitectureModel } from './generated/model.mjs';
import type { ProjectModel, ProjectRecord } from './generated/project.mjs';
import type { ProjectChange } from './generated/change.mjs';
export type { ProjectModel, ProjectRecord } from './generated/project.mjs';
export type { ProjectChange } from './generated/change.mjs';
export type ArchitectureInput = ArchitectureModel | ProjectModel;
export type {
  ArchitectureModel,
  ArchitectureNode,
  ArchitectureRelation,
  Implementation,
} from './generated/model.mjs';

export interface ArchitectureDiagnostic {
  code: string;
  path: string;
  subject?: string;
  keyword?: string;
  schemaPath?: string;
  params?: Record<string, unknown>;
}

export class ArchitectureError extends Error {
  constructor(
    code: string,
    issues?: string[],
    diagnostics?: ArchitectureDiagnostic[],
  );
  readonly code: string;
  readonly issues: string[];
  readonly diagnostics: ArchitectureDiagnostic[];
}
export function validateArchitecture(model: unknown): {
  valid: boolean;
  errors: string[];
  diagnostics: ArchitectureDiagnostic[];
};
export function parseArchitecture(text: string): ArchitectureInput;
export interface ProjectReason {
  code: string;
  key: string;
}
export type ImplementationState = 'confirmed' | 'partial' | 'unconfirmed';
export interface ProjectCompletion {
  implemented: boolean;
  state: ImplementationState;
  progress: { criteria: string[]; confirmedCriteria: string[] };
  reasons: ProjectReason[];
}
export interface ProjectAnalysis {
  contract: string;
  realization: string;
  freshness: Record<string, { current: boolean; reasons: ProjectReason[] }>;
  completion: Record<string, ProjectCompletion>;
}
export interface ProjectContext {
  documents: Array<{
    key: string;
    path: string;
    digest: string;
    sections: Array<{ index: number; block: unknown }>;
  }>;
  snapshot: string;
  contract: string;
  keys: string[];
  reads: Record<string, string>;
  records: ProjectRecord[];
  omitted: number;
}
export function validateProject(
  model: unknown,
): ReturnType<typeof validateArchitecture>;
export function analyzeProject(
  model: ProjectModel,
  options?: { verifiedResults?: string[] },
): ProjectAnalysis;
export function projectContext(
  model: ProjectModel,
  keys: string[],
): ProjectContext;
export function applyProjectChanges(
  model: ProjectModel,
  context: ProjectContext,
  change: ProjectChange,
): ProjectModel;
export function contractDigest(model: ProjectModel): string;
export function realizationDigest(model: ProjectModel): string;

export function renderDocument(
  model: ProjectModel,
  document: Extract<ProjectModel['records'][number], { type: 'document' }>,
  options?: { notice?: boolean; headingOffset?: number },
): string;
