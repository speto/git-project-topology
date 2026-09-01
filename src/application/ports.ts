import type { PathIdentity, TopologyPath, WorktreeAvailability } from '../domain/model.js';

export interface RawGitWorktree {
  readonly path: string;
  readonly head: string | null;
  readonly branchRef: string | null;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly lockReason: string | null;
  readonly prunable: boolean;
  readonly prunableReason: string | null;
}

export interface DiscoveredGitRepository {
  readonly commonDirectoryPath: string;
  readonly bare: boolean;
}

export interface GitTopologySource {
  discoverRepository(probeDirectory: string): Promise<DiscoveredGitRepository | null>;
  listWorktrees(commonDirectoryPath: string): Promise<readonly RawGitWorktree[]>;
}

export type FileSystemEntryKind = 'directory' | 'file';

export interface PathTopologySource {
  resolveInput(inputPath: string): Promise<PathIdentity>;
  resolveExisting(path: string, displayPath?: string): Promise<TopologyPath>;
  resolvePossiblyMissing(path: string, displayPath?: string): Promise<TopologyPath>;
  entryKind(path: string): Promise<FileSystemEntryKind>;
  availability(path: string): Promise<WorktreeAvailability>;
  deriveDisplayPath(targetCanonicalPath: string, selectedPath: PathIdentity): string;
}
