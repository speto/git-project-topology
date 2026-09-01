export interface TopologyPath {
  readonly canonicalPath: string;
  readonly displayPath: string;
}

export interface PathIdentity extends TopologyPath {
  readonly inputPath: string;
  readonly absolutePath: string;
}

export type WorktreeAvailability = 'available' | 'missing' | 'inaccessible';

export type GitWorktreeCheckout =
  | {
      readonly kind: 'branch';
      readonly name: string;
      readonly ref: string;
    }
  | {
      readonly kind: 'detached';
    };

export interface GitWorktreeTopology {
  readonly path: TopologyPath;
  readonly head: string | null;
  readonly checkout: GitWorktreeCheckout;
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

export interface SelectedWorktree {
  readonly canonicalPath: string;
  readonly isRoot: boolean;
}

export interface ProjectSelection {
  readonly path: PathIdentity;
  readonly isProjectRoot: boolean;
  readonly isGitCommonDirectory: boolean;
  readonly worktree: SelectedWorktree | null;
}

export interface ProjectTopology {
  readonly projectRoot: TopologyPath;
  readonly git: GitRepositoryTopology | null;
  readonly selection: ProjectSelection;
}
