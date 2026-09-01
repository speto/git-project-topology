import path from 'node:path';
import { ProjectTopologyError } from './errors.js';
import {
  discoverGitRepository,
  listGitWorktrees,
  type DiscoveredGitRepository,
  type GitOptions,
  type RawGitWorktree,
} from './git/git.js';
import {
  createPathContext,
  deriveDisplayPath,
  entryKind,
  findDeepestContainingPath,
  isPathWithin,
  resolveExistingPath,
  resolveInputPath,
  resolvePossiblyMissingPath,
  worktreeAvailability,
} from './paths.js';
import type {
  GitRepositoryTopology,
  GitWorktreeCheckout,
  GitWorktreeTopology,
  PathIdentity,
  ProjectSelection,
  ProjectTopology,
  TopologyPath,
} from './types.js';

export interface InspectProjectTopologyOptions {
  readonly cwd?: string;
  readonly gitBinary?: string;
  readonly gitTimeoutMs?: number;
}

export async function inspectProjectTopology(
  inputPath: string,
  options: InspectProjectTopologyOptions = {},
): Promise<ProjectTopology> {
  const pathContext = createPathContext(options.cwd);
  const gitOptions: GitOptions = {
    ...(options.gitBinary === undefined ? {} : { gitBinary: options.gitBinary }),
    ...(options.gitTimeoutMs === undefined ? {} : { timeoutMs: options.gitTimeoutMs }),
  };
  const selectedPath = await resolveInputPath(pathContext, inputPath);
  const selectedKind = await entryKind(selectedPath.canonicalPath);
  const probeDirectory =
    selectedKind === 'directory' ? selectedPath.canonicalPath : path.dirname(selectedPath.canonicalPath);
  const discoveredRepository = await discoverGitRepository(probeDirectory, gitOptions);

  if (discoveredRepository === null) {
    const rootCanonicalPath =
      selectedKind === 'directory' ? selectedPath.canonicalPath : path.dirname(selectedPath.canonicalPath);
    const projectRoot = await resolveExistingPath(
      rootCanonicalPath,
      deriveDisplayPath(rootCanonicalPath, selectedPath),
    );

    return {
      projectRoot,
      git: null,
      selection: {
        path: selectedPath,
        isProjectRoot: selectedPath.canonicalPath === projectRoot.canonicalPath,
        isGitCommonDirectory: false,
        worktree: null,
      },
    };
  }

  const commonDirectory = await resolveExistingPath(discoveredRepository.commonDirectoryPath);
  const rawWorktrees = await listGitWorktrees(commonDirectory.canonicalPath, gitOptions);
  const resolvedWorktrees = await correctSeparateGitDirMainWorktree(
    discoveredRepository,
    commonDirectory.canonicalPath,
    await resolveRawWorktrees(rawWorktrees, commonDirectory.canonicalPath),
  );
  const projectRootCanonicalPath = deriveProjectRoot(
    discoveredRepository.bare,
    commonDirectory.canonicalPath,
    resolvedWorktrees,
  );
  const projectRoot = await resolvePossiblyMissingPath(
    projectRootCanonicalPath,
    deriveDisplayPath(projectRootCanonicalPath, selectedPath),
  );
  const commonDirectoryWithDisplay = await resolveExistingPath(
    commonDirectory.canonicalPath,
    displayPathForTopologyPath(commonDirectory.canonicalPath, projectRoot, selectedPath),
  );
  const worktrees = await Promise.all(
    resolvedWorktrees.map((worktree) => toWorktreeTopology(worktree, projectRoot, selectedPath)),
  );
  const git: GitRepositoryTopology = {
    commonDirectory: commonDirectoryWithDisplay,
    bare: discoveredRepository.bare,
    worktrees,
  };

  return {
    projectRoot,
    git,
    selection: resolveSelection(selectedPath, projectRoot, commonDirectoryWithDisplay, worktrees),
  };
}

type ResolvedRawWorktree = Omit<RawGitWorktree, 'path'> & {
  readonly path: string;
  readonly sourceIndex: number;
};

async function resolveRawWorktrees(
  rawWorktrees: readonly RawGitWorktree[],
  commonDirectoryPath: string,
): Promise<readonly ResolvedRawWorktree[]> {
  const repositoryBase = path.dirname(commonDirectoryPath);
  const resolved: ResolvedRawWorktree[] = [];

  for (const [index, worktree] of rawWorktrees.entries()) {
    if (worktree.bare) {
      continue;
    }

    const rawPath = path.isAbsolute(worktree.path)
      ? worktree.path
      : path.resolve(repositoryBase, worktree.path);
    const topologyPath = await resolvePossiblyMissingPath(rawPath);
    resolved.push({
      ...worktree,
      path: topologyPath.canonicalPath,
      sourceIndex: index,
    });
  }

  return resolved;
}

async function correctSeparateGitDirMainWorktree(
  repository: DiscoveredGitRepository,
  commonDirectoryPath: string,
  worktrees: readonly ResolvedRawWorktree[],
): Promise<readonly ResolvedRawWorktree[]> {
  const mainWorktree = worktrees.find((worktree) => worktree.sourceIndex === 0);
  if (
    repository.bare ||
    mainWorktree === undefined ||
    mainWorktree.path !== commonDirectoryPath ||
    repository.currentGitDirectoryPath === null ||
    repository.currentWorktreeRootPath === null
  ) {
    return worktrees;
  }

  const currentGitDirectory = await resolveExistingPath(repository.currentGitDirectoryPath);
  if (currentGitDirectory.canonicalPath !== commonDirectoryPath) {
    return worktrees;
  }

  const currentWorktreeRoot = await resolveExistingPath(repository.currentWorktreeRootPath);
  return worktrees.map((worktree) =>
    worktree.sourceIndex === 0
      ? { ...worktree, path: currentWorktreeRoot.canonicalPath }
      : worktree,
  );
}

function deriveProjectRoot(
  bare: boolean,
  commonDirectoryPath: string,
  worktrees: readonly ResolvedRawWorktree[],
): string {
  if (bare) {
    // Project convention supported by this library: a bare repository stored as
    // <project>/.git belongs to <project>. Other bare repositories are their own root.
    return path.basename(commonDirectoryPath) === '.git'
      ? path.dirname(commonDirectoryPath)
      : commonDirectoryPath;
  }

  const mainWorktree = worktrees.find((worktree) => worktree.sourceIndex === 0);
  if (mainWorktree === undefined) {
    throw new ProjectTopologyError(
      'INVALID_GIT_TOPOLOGY',
      'Git did not report the main worktree for a non-bare repository.',
    );
  }

  return mainWorktree.path;
}

async function toWorktreeTopology(
  worktree: ResolvedRawWorktree,
  projectRoot: TopologyPath,
  selectedPath: PathIdentity,
): Promise<GitWorktreeTopology> {
  const displayPath = displayPathForTopologyPath(worktree.path, projectRoot, selectedPath);
  const resolvedPath = await resolvePossiblyMissingPath(worktree.path, displayPath);

  return {
    path: resolvedPath,
    head: worktree.head,
    checkout: resolveCheckout(worktree),
    isMain: worktree.sourceIndex === 0,
    availability: await worktreeAvailability(resolvedPath.canonicalPath),
    locked: worktree.locked,
    lockReason: worktree.lockReason,
    prunable: worktree.prunable,
    prunableReason: worktree.prunableReason,
  };
}

function resolveCheckout(worktree: ResolvedRawWorktree): GitWorktreeCheckout {
  if (worktree.detached) {
    if (worktree.branchRef !== null) {
      throw new ProjectTopologyError(
        'INVALID_GIT_TOPOLOGY',
        'Git reported a detached worktree with a branch reference.',
      );
    }
    return { kind: 'detached' };
  }

  if (worktree.branchRef === null) {
    throw new ProjectTopologyError(
      'INVALID_GIT_TOPOLOGY',
      'Git reported a worktree without a branch or detached state.',
    );
  }

  return {
    kind: 'branch',
    name: shortBranchName(worktree.branchRef),
    ref: worktree.branchRef,
  };
}

function displayPathForTopologyPath(
  canonicalPath: string,
  projectRoot: TopologyPath,
  selectedPath: PathIdentity,
): string {
  if (isPathWithin(projectRoot.canonicalPath, canonicalPath)) {
    return path.join(
      projectRoot.displayPath,
      path.relative(projectRoot.canonicalPath, canonicalPath),
    );
  }

  return deriveDisplayPath(canonicalPath, selectedPath);
}

function resolveSelection(
  selectedPath: PathIdentity,
  projectRoot: TopologyPath,
  commonDirectory: TopologyPath,
  worktrees: readonly GitWorktreeTopology[],
): ProjectSelection {
  const matchingWorktree = findDeepestContainingPath(
    selectedPath.canonicalPath,
    worktrees,
    (worktree) => worktree.path.canonicalPath,
  );

  return {
    path: selectedPath,
    isProjectRoot: selectedPath.canonicalPath === projectRoot.canonicalPath,
    isGitCommonDirectory: selectedPath.canonicalPath === commonDirectory.canonicalPath,
    worktree:
      matchingWorktree === null
        ? null
        : {
            canonicalPath: matchingWorktree.path.canonicalPath,
            isRoot: selectedPath.canonicalPath === matchingWorktree.path.canonicalPath,
          },
  };
}

function shortBranchName(branchRef: string): string {
  const localBranchPrefix = 'refs/heads/';
  return branchRef.startsWith(localBranchPrefix)
    ? branchRef.slice(localBranchPrefix.length)
    : branchRef;
}
