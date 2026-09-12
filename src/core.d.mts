export type Implementation =
  | { implemented: false; implementationEvidence?: string }
  | { implemented: true; implementationEvidence: string };

export type ArchitectureNode = Implementation & {
  key: string;
  title: string;
  summary: string;
  zone: 'presentation' | 'application' | 'infrastructure' | 'pure' | 'external';
  rules: Array<{ title: string; text: string }>;
  example?: string;
} & (
    | {
        kind: 'subsystem';
        detail: 'mapped';
        children: ArchitectureNode[];
        detailNote?: string;
      }
    | {
        kind: 'subsystem' | 'component' | 'store' | 'external';
        detail: 'boundary';
        detailNote: string;
        children?: never;
      }
  );

export type ArchitectureRelation = Implementation & {
  key: string;
  from: string;
  to: string;
  kind: 'data' | 'command' | 'state';
  channel: string;
  label: string;
  payload: string;
  meaning: string;
};

export interface ArchitectureModel {
  $schema?: string;
  version: 3;
  scope: 'target';
  title?: string;
  entry: string;
  nodes: ArchitectureNode[];
  relations: ArchitectureRelation[];
}

export class ArchitectureError extends Error {
  constructor(code: string, issues?: string[]);
  readonly code: string;
  readonly issues: string[];
}
export function validateArchitecture(model: unknown): {
  valid: boolean;
  errors: string[];
};
export function parseArchitecture(text: string): ArchitectureModel;
