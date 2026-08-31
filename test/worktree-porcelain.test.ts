import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWorktreePorcelain } from '../src/infrastructure/git/worktree-porcelain.js';

describe('parseWorktreePorcelain', () => {
  it('parses stable NUL-delimited worktree records and preserves reasons', () => {
    const output = [
      'worktree /repo',
      'bare',
      '',
      'worktree /repo/main',
      'HEAD 1234567890abcdef',
      'branch refs/heads/main',
      '',
      'worktree /repo/detached',
      'HEAD fedcba0987654321',
      'detached',
      'locked reason with spaces\nand a newline',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\0');

    assert.deepEqual(parseWorktreePorcelain(output), [
      {
        path: '/repo',
        head: null,
        branchRef: null,
        bare: true,
        detached: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
      },
      {
        path: '/repo/main',
        head: '1234567890abcdef',
        branchRef: 'refs/heads/main',
        bare: false,
        detached: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
      },
      {
        path: '/repo/detached',
        head: 'fedcba0987654321',
        branchRef: null,
        bare: false,
        detached: true,
        locked: true,
        lockReason: 'reason with spaces\nand a newline',
        prunable: true,
        prunableReason: 'gitdir file points to non-existent location',
      },
    ]);
  });

  it('ignores unknown future porcelain fields', () => {
    const output = ['worktree /repo/main', 'HEAD abc', 'future-field value', ''].join('\0');
    assert.equal(parseWorktreePorcelain(output)[0]?.path, '/repo/main');
  });
});
