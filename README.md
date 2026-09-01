# git-project-topology

Resolve any project-related filesystem path into one canonical Git project and its registered worktrees.

Give it the project directory, Git common directory, a worktree, or a directory inside a worktree. It discovers the same project identity and topology either way.

## Why this exists

Path strings are a poor project identifier.

The same Git project can be referenced through a project directory, Git common directory, worktree, worktree descendant, `~` path, symlink, or resolved filesystem path. Comparing those strings directly can make one project look like several unrelated projects.

For example, given:

```text
~/Workspace/example-project
├── .git/
├── main/
└── feature-a/

~/Workspace/example-project.feature-b   # registered worktree of the same repository

/mnt/projects/example-project -> /home/user/Workspace/example-project
```

Registered worktrees do not have to live under the project root or next to the Git common directory.

Different consumers may record paths such as:

```text
~/Workspace/example-project/main/src
~/Workspace/example-project/feature-a
~/Workspace/example-project.feature-b/src
/mnt/projects/example-project/.git
/mnt/projects/example-project
```

Those strings are different, but they all belong to the same Git project.

`git-project-topology` resolves them to a common topology:

```text
project
  /home/user/Workspace/example-project

Git common directory
  /home/user/Workspace/example-project/.git

worktrees
  /home/user/Workspace/example-project/main
  /home/user/Workspace/example-project/feature-a
  /home/user/Workspace/example-project.feature-b
```

It also identifies whether the original input selected the project itself, the Git common directory, a worktree, or a path inside a worktree.

This gives higher-level tooling a consistent project identity without reimplementing Git worktree discovery, `~` expansion, symlink resolution, and canonical path handling.

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
