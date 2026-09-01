import path from 'node:path';
import type { GitTopologySource, PathTopologySource, RawGitWorktree } from './ports.js';
import { findDeepestContainingPath, isPathWithin } from '../domain/path-containment.js';
import type {
  GitRepositoryTopology,
  GitWorktreeTopology,
  ProjectSelection,
  ProjectTopology,
  PathIdentity,
  TopologyPath,
} from '../domain/model.js';

export class ProjectTopologyInspector {
  readonly #paths: PathTopologySource;
  readonly #git: GitTopologySource;

  constructor(paths: PathTopologySource, git: GitTopologySource) {
    this.#paths = paths;
    this.#git = git;
  }

  async inspect(inputPath: string): Promise<ProjectTopology> {
    const selectedPath = await this.#paths.resolveInput(inputPath);
    const selectedKind = await this.#paths.entryKind(selectedPath.canonicalPath);
    const probeDirectory =
      selectedKind === 'directory' ? selectedPath.canonicalPath : path.dirname(selectedPath.canonicalPath);
    const discoveredRepository = await this.#git.discoverRepository(probeDirectory);

    if (discoveredRepository === null) {
      const rootCanonicalPath =
        selectedKind === 'directory' ? selectedPath.canonicalPath : path.dirname(selectedPath.canonicalPath);
      const projectRoot = await this.#paths.resolveExisting(
        rootCanonicalPath,
        this.#paths.deriveDisplayPath(rootCanonicalPath, selectedPath),
      );

      return {
        projectRoot,
        git: null,
        selection: {
          path: selectedPath,
          kind:
            selectedPath.canonicalPath === projectRoot.canonicalPath
              ? 'project-root'
              : 'project-descendant',
          worktreeCanonicalPath: null,
        },
      };
    }

    const commonDirectory = await this.#paths.resolveExisting(
      discoveredRepository.commonDirectoryPath,
    );
    const rawWorktrees = await this.#git.listWorktrees(commonDirectory.canonicalPath);
    const resolvedWorktrees = await this.#resolveWorktrees(rawWorktrees, commonDirectory.canonicalPath);
    const projectRootCanonicalPath = deriveProjectRoot(commonDirectory.canonicalPath);
    const projectRoot = await this.#paths.resolvePossiblyMissing(
      projectRootCanonicalPath,
      this.#paths.deriveDisplayPath(projectRootCanonicalPath, selectedPath),
    );
    const commonDirectoryWithDisplay = await this.#paths.resolveExisting(
      commonDirectory.canonicalPath,
      displayPathForTopologyPath(commonDirectory.canonicalPath, projectRoot, selectedPath, this.#paths),
    );
    const worktrees = await Promise.all(
      resolvedWorktrees.map((worktree) =>
        this.#toWorktreeTopology(worktree, projectRoot, selectedPath),
      ),
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

  async #resolveWorktrees(
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
      const topologyPath = await this.#paths.resolvePossiblyMissing(rawPath);
      resolved.push({
        ...worktree,
        path: topologyPath.canonicalPath,
        sourceIndex: index,
      });
    }

    return resolved;
  }

  async #toWorktreeTopology(
    worktree: ResolvedRawWorktree,
    projectRoot: TopologyPath,
    selectedPath: PathIdentity,
  ): Promise<GitWorktreeTopology> {
    const displayPath = displayPathForTopologyPath(
      worktree.path,
      projectRoot,
      selectedPath,
      this.#paths,
    );
    const resolvedPath = await this.#paths.resolvePossiblyMissing(worktree.path, displayPath);
    const branchRef = worktree.branchRef;

    return {
      path: resolvedPath,
      head: worktree.head,
      branch: branchRef === null ? null : shortBranchName(branchRef),
      branchRef,
      detached: worktree.detached,
      isMain: worktree.sourceIndex === 0,
      availability: await this.#paths.availability(resolvedPath.canonicalPath),
      locked: worktree.locked,
      lockReason: worktree.lockReason,
      prunable: worktree.prunable,
      prunableReason: worktree.prunableReason,
    };
  }
}

type ResolvedRawWorktree = Omit<RawGitWorktree, 'path'> & {
  readonly path: string;
  readonly sourceIndex: number;
};

function deriveProjectRoot(commonDirectoryPath: string): string {
  return path.basename(commonDirectoryPath) === '.git'
    ? path.dirname(commonDirectoryPath)
    : commonDirectoryPath;
}

function displayPathForTopologyPath(
  canonicalPath: string,
  projectRoot: TopologyPath,
  selectedPath: PathIdentity,
  paths: PathTopologySource,
): string {
  if (isPathWithin(projectRoot.canonicalPath, canonicalPath)) {
    return path.join(
      projectRoot.displayPath,
      path.relative(projectRoot.canonicalPath, canonicalPath),
    );
  }

  return paths.deriveDisplayPath(canonicalPath, selectedPath);
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

  if (selectedPath.canonicalPath === projectRoot.canonicalPath) {
    return {
      path: selectedPath,
      kind: 'project-root',
      worktreeCanonicalPath: matchingWorktree?.path.canonicalPath ?? null,
    };
  }

  if (selectedPath.canonicalPath === commonDirectory.canonicalPath) {
    return {
      path: selectedPath,
      kind: 'git-common-directory',
      worktreeCanonicalPath: null,
    };
  }

  if (matchingWorktree !== null) {
    return {
      path: selectedPath,
      kind:
        selectedPath.canonicalPath === matchingWorktree.path.canonicalPath
          ? 'worktree'
          : 'worktree-descendant',
      worktreeCanonicalPath: matchingWorktree.path.canonicalPath,
    };
  }

  return {
    path: selectedPath,
    kind: 'project-descendant',
    worktreeCanonicalPath: null,
  };
}

function shortBranchName(branchRef: string): string {
  const localBranchPrefix = 'refs/heads/';
  return branchRef.startsWith(localBranchPrefix)
    ? branchRef.slice(localBranchPrefix.length)
    : branchRef;
}
