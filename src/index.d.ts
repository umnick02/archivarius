import type {
  CSSProperties,
  ForwardRefExoticComponent,
  RefAttributes,
} from 'react';
import type { ArchitectureModel, ArchitectureRelation } from './core.mjs';
export type {
  ArchitectureModel,
  ArchitectureNode,
  ArchitectureRelation,
  Implementation,
} from './core.mjs';
export {
  ArchitectureError,
  parseArchitecture,
  validateArchitecture,
} from './core.mjs';

export type ArchitectureSource = string | URL | Blob | ArchitectureModel;
export interface MapSnapshot {
  viewport: { x: number; y: number; zoom: number };
  expanded: string[];
  visible: string[];
  nodeGeometry: Array<{
    id: string;
    position: { x: number; y: number };
    width: number;
    height: number;
  }>;
  relations: Array<{
    from: string;
    to: string;
    kind: ArchitectureRelation['kind'];
    implemented: boolean;
    members: string[];
  }>;
  layer: 'all' | ArchitectureRelation['kind'];
  layoutPasses: number;
  panel: 'node' | 'relation' | 'contracts' | 'about' | null;
}
export interface MapNavigation {
  home(): Promise<boolean>;
  focus(key: string): Promise<boolean>;
  snapshot(): MapSnapshot;
}
export interface ArchitectureMapProps {
  source: ArchitectureSource;
  locale?: 'ru' | 'en';
  assetsBaseUrl?: string | URL;
  className?: string;
  style?: CSSProperties;
  onReady?: (map: MapNavigation) => void;
  onError?: (error: Error) => void;
}
export interface MountedArchitectureMap extends MapNavigation {
  readonly ready: Promise<void>;
  load(source: ArchitectureSource): Promise<void>;
  destroy(): void;
}
export const ArchitectureMap: ForwardRefExoticComponent<
  ArchitectureMapProps & RefAttributes<MapNavigation>
>;
export function mountArchitectureMap(
  container: HTMLElement,
  options: ArchitectureMapProps,
): MountedArchitectureMap;
