import { ProjectTopologyError } from '../errors.js';
import type { RawGitWorktree } from './git.js';

type MutableWorktree = {
  path?: string;
  head: string | null;
  branchRef: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  prunableReason: string | null;
};

export function parseWorktreePorcelain(output: string): readonly RawGitWorktree[] {
  const records: RawGitWorktree[] = [];
  let current: MutableWorktree | null = null;

  const flush = (): void => {
    if (current === null) {
      return;
    }

    if (current.path === undefined || current.path.length === 0) {
      throw new ProjectTopologyError(
        'INVALID_GIT_TOPOLOGY',
        'Git returned a worktree record without a path.',
      );
    }

    records.push({
      path: current.path,
      head: current.head,
      branchRef: current.branchRef,
      bare: current.bare,
      detached: current.detached,
      locked: current.locked,
      lockReason: current.lockReason,
      prunable: current.prunable,
      prunableReason: current.prunableReason,
    });

    current = null;
  };

  for (const field of output.split('\0')) {
    if (field === '') {
      flush();
      continue;
    }

    const separator = field.indexOf(' ');
    const name = separator === -1 ? field : field.slice(0, separator);
    const value = separator === -1 ? null : field.slice(separator + 1);

    if (name === 'worktree') {
      flush();
      current = createWorktree(value);
      continue;
    }

    if (current === null) {
      throw new ProjectTopologyError(
        'INVALID_GIT_TOPOLOGY',
        `Git returned worktree attribute "${name}" before a worktree path.`,
      );
    }

    switch (name) {
      case 'HEAD':
        current.head = value;
        break;
      case 'branch':
        current.branchRef = value;
        break;
      case 'bare':
        current.bare = true;
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'locked':
        current.locked = true;
        current.lockReason = value;
        break;
      case 'prunable':
        current.prunable = true;
        current.prunableReason = value;
        break;
      default:
        break;
    }
  }

  flush();
  return records;
}

function createWorktree(path: string | null): MutableWorktree {
  if (path === null || path.length === 0) {
    throw new ProjectTopologyError(
      'INVALID_GIT_TOPOLOGY',
      'Git returned an empty worktree path.',
    );
  }

  return {
    path,
    head: null,
    branchRef: null,
    bare: false,
    detached: false,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
  };
}
