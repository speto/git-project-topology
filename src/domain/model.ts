export interface TopologyPath {
  readonly canonicalPath: string;
  readonly displayPath: string;
}

export interface SelectedPath extends TopologyPath {
  readonly inputPath: string;
  readonly absolutePath: string;
}

export type WorktreeAvailability = 'available' | 'missing' | 'inaccessible';

export interface GitWorktreeTopology {
  readonly path: TopologyPath;
  readonly head: string | null;
  readonly branch: string | null;
  readonly branchRef: string | null;
  readonly detached: boolean;
  readonly isMain: boolean;
  readonly availability: WorktreeAvailability;
  readonly locked: boolean;
  readonly lockReason: string | null;
  readonly prunable: boolean;
  readonly prunableReason: string | null;
}

export interface GitRepositoryTopology {
  readonly commonDirectory: TopologyPath;
  readonly bare: boolean;
  readonly worktrees: readonly GitWorktreeTopology[];
}

export type ProjectSelectionKind =
  | 'project-root'
  | 'git-common-directory'
  | 'worktree'
  | 'worktree-descendant'
  | 'project-descendant';

export interface ProjectSelection {
  readonly path: SelectedPath;
  readonly kind: ProjectSelectionKind;
  readonly worktreeCanonicalPath: string | null;
}

export interface ProjectTopology {
  readonly projectRoot: TopologyPath;
  readonly git: GitRepositoryTopology | null;
  readonly selection: ProjectSelection;
}
