# git-project-topology

Given a path inside a Git project, find the project, its Git directory and its registered worktrees.

```text
~/Workspace/example
├── .git/
├── main/
└── feature-a/
```

These all resolve to the same project:

```text
~/Workspace/example
~/Workspace/example/.git
~/Workspace/example/main
~/Workspace/example/main/src
```

## Install

```sh
npm install github:speto/git-project-topology
```

Node.js 22+ and Git 2.36+.

## Use

```ts
import { inspectProjectTopology } from 'git-project-topology';

const topology = await inspectProjectTopology('~/Workspace/example/main/src');
```

```ts
{
  projectRoot: {
    canonicalPath: '/Volumes/workspace/example',
    displayPath: '~/Workspace/example',
  },
  git: {
    commonDirectory: {
      canonicalPath: '/Volumes/workspace/example/.git',
      displayPath: '~/Workspace/example/.git',
    },
    bare: true,
    worktrees: [
      {
        path: {
          canonicalPath: '/Volumes/workspace/example/main',
          displayPath: '~/Workspace/example/main',
        },
        head: '…',
        checkout: {
          kind: 'branch',
          name: 'main',
          ref: 'refs/heads/main',
        },
        isMain: false,
        availability: 'available',
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
      },
    ],
  },
  selection: {
    path: {
      inputPath: '~/Workspace/example/main/src',
      absolutePath: '/Users/me/Workspace/example/main/src',
      canonicalPath: '/Volumes/workspace/example/main/src',
      displayPath: '~/Workspace/example/main/src',
    },
    isProjectRoot: false,
    isGitCommonDirectory: false,
    worktree: {
      canonicalPath: '/Volumes/workspace/example/main',
      isRoot: false,
    },
  },
}
```

Selection facts are independent. In a normal repository the project root is also the main worktree root, so both can be true at once.

The library asks Git for registered worktrees using `git worktree list --porcelain -z`. It does not scan directories looking for repositories.

For the layout shown above, a bare repository stored as `<project>/.git` belongs to `<project>`. Other bare repositories are their own project root.

## Paths

Canonicalize a path without inspecting Git:

```ts
import { resolvePathIdentity } from 'git-project-topology';

const path = await resolvePathIdentity('~/Workspace/example/main');
```

Missing historical paths can be normalized through their deepest existing ancestor:

```ts
await resolvePathIdentity('/old/worktree', { allowMissing: true });
```

A directory that is not inside a Git repository is valid and returns `git: null`.

## Errors

Expected failures throw `ProjectTopologyError` with one of:

```text
INVALID_INPUT
PATH_NOT_FOUND
PATH_NOT_ACCESSIBLE
GIT_NOT_AVAILABLE
GIT_EXECUTION_FAILED
INVALID_GIT_TOPOLOGY
```

## Development

```sh
npm install
npm run check
```
