import { ProjectTopologyInspector } from './application/project-topology-inspector.js';
import { GitCliTopologySource } from './infrastructure/git/git-cli-topology-source.js';
import { NodePathTopologySource } from './infrastructure/node/node-path-topology-source.js';

export { ProjectTopologyError } from './domain/errors.js';
export type { ProjectTopologyErrorCode } from './domain/errors.js';
export { isPathWithin } from './domain/path-containment.js';
export type {
  GitRepositoryTopology,
  GitWorktreeTopology,
  ProjectSelection,
  ProjectSelectionKind,
  ProjectTopology,
  PathIdentity,
  TopologyPath,
  WorktreeAvailability,
} from './domain/model.js';

export interface PathIdentityOptions {
  readonly cwd?: string;
  readonly allowMissing?: boolean;
}

export interface InspectProjectTopologyOptions {
  readonly cwd?: string;
  readonly gitBinary?: string;
  readonly gitTimeoutMs?: number;
}

export async function resolvePathIdentity(
  inputPath: string,
  options: PathIdentityOptions = {},
): Promise<import('./domain/model.js').PathIdentity> {
  const paths = new NodePathTopologySource(
    options.cwd === undefined ? {} : { cwd: options.cwd },
  );

  return paths.resolvePathIdentity(inputPath, options.allowMissing ?? false);
}

export async function inspectProjectTopology(
  inputPath: string,
  options: InspectProjectTopologyOptions = {},
): Promise<import('./domain/model.js').ProjectTopology> {
  const inspector = new ProjectTopologyInspector(
    new NodePathTopologySource(
      options.cwd === undefined ? {} : { cwd: options.cwd },
    ),
    new GitCliTopologySource({
      ...(options.gitBinary === undefined ? {} : { gitBinary: options.gitBinary }),
      ...(options.gitTimeoutMs === undefined ? {} : { timeoutMs: options.gitTimeoutMs }),
    }),
  );

  return inspector.inspect(inputPath);
}
