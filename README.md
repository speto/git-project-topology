# git-project-topology

Resolve any project-related filesystem path into one canonical Git project and its registered worktrees.

The library is designed for applications that know a **project path**, but should not force users to understand whether that path is a Git common directory, a main worktree, or a linked worktree.

```text
~/projects/example-project
├── .git/          # bare/common Git repository
├── main/          # linked worktree
└── feature-a/     # linked worktree
```

These inputs resolve to the same project topology:

```text
~/projects/example-project
~/projects/example-project/.git
~/projects/example-project/main
~/projects/example-project/main/src
```

## Principles

- **Git is authoritative.** Worktrees come from `git worktree list --porcelain -z`; the filesystem is not recursively scanned for `.git` directories.
- **Canonical paths are identity.** `realpath()` semantics prevent symlink aliases from creating duplicate projects or worktrees.
- **Display paths are presentation.** A user-supplied `~/...` or symlink namespace is preserved when it can be derived safely, but is never used for identity.
- **Project, repository, and worktree are different concepts.** A project can contain a bare `.git` repository and multiple linked worktrees without any of those worktrees becoming the project itself.
- **Read-only by design.** The library never creates, removes, repairs, locks, or mutates Git worktrees.
- **No runtime dependencies.** Git is accessed with `execFile`, never through a shell.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the bounded context, invariants, SOLID/DDD boundaries, and design decisions.

The implementation keeps the domain model independent from the Git CLI and Node filesystem adapters. This is deliberate: topology is the domain; Git and filesystem access are infrastructure.

## Requirements

- Node.js 22 or newer
- Git 2.36 or newer

Git 2.36 is the minimum because the library intentionally uses the NUL-delimited stable porcelain format (`git worktree list --porcelain -z`) so paths and lock reasons can contain unusual characters safely.

## Install

The package is not published yet. From GitHub:

```sh
npm install github:speto/git-project-topology
```

## Usage

```ts
import { inspectProjectTopology } from 'git-project-topology';

const topology = await inspectProjectTopology(
  '~/projects/example-project',
);

console.log(topology.projectRoot);
console.log(topology.git?.commonDirectory);
console.log(topology.git?.worktrees);
```

A simplified result:

```ts
{
  projectRoot: {
    canonicalPath: '/mnt/projects/example-project',
    displayPath: '~/projects/example-project',
  },
  git: {
    commonDirectory: {
      canonicalPath: '/mnt/projects/example-project/.git',
      displayPath: '~/projects/example-project/.git',
    },
    bare: true,
    worktrees: [
      {
        path: {
          canonicalPath: '/mnt/projects/example-project/main',
          displayPath: '~/projects/example-project/main',
        },
        head: '…',
        branch: 'main',
        branchRef: 'refs/heads/main',
        detached: false,
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
    kind: 'project-root',
    worktreeCanonicalPath: null,
    path: {
      inputPath: '~/projects/example-project',
      absolutePath: '/home/user/projects/example-project',
      canonicalPath: '/mnt/projects/example-project',
      displayPath: '~/projects/example-project',
    },
  },
}
```

### Selecting a worktree

```ts
const topology = await inspectProjectTopology(
  '~/projects/example-project/main/src',
);

console.log(topology.projectRoot.displayPath);
// ~/projects/example-project

console.log(topology.selection.kind);
// worktree-descendant

console.log(topology.selection.worktreeCanonicalPath);
// /mnt/projects/example-project/main
```

### Reusing path identity

Higher-level libraries can normalize external path evidence with the same canonicalization rules:

```ts
import { resolvePathIdentity } from 'git-project-topology';

const cwd = await resolvePathIdentity(
  '~/projects/example-project/main/src',
);

console.log(cwd.canonicalPath);
// /mnt/projects/example-project/main/src
```

For history that can refer to a removed directory:

```ts
const staleCwd = await resolvePathIdentity('/old/worktree/src', {
  allowMissing: true,
});
```

This is intended for higher-level consumers; they should not reimplement `~`, symlink, or canonical-path handling.

### Non-Git projects

A directory does not have to be a Git repository:

```ts
const topology = await inspectProjectTopology('/projects/new-project');

console.log(topology.git);
// null
```

The library does not recursively hunt for nested repositories. An explicit project directory remains the project boundary.

### Custom Git executable or relative-path base

```ts
const topology = await inspectProjectTopology('./project', {
  cwd: '/workspace',
  gitBinary: '/usr/bin/git',
  gitTimeoutMs: 15_000,
});
```

## Domain model

```text
ProjectTopology
├── projectRoot
├── git? ── GitRepositoryTopology
│   ├── commonDirectory
│   ├── bare
│   └── worktrees[] ── GitWorktreeTopology
└── selection
```

`isMain` follows **Git terminology**. A normal non-bare repository has one main worktree. A bare repository has no main worktree; all worktrees attached to it are linked worktrees, even if one happens to use a branch named `main`.

Canonical paths are intentionally exposed instead of opaque generated IDs. Consumers that need application-specific IDs can derive them at their own boundary without coupling this low-level library to one persistence or authorization model.

## Errors

Expected failures use `ProjectTopologyError` with a stable `code`:

```ts
import {
  inspectProjectTopology,
  ProjectTopologyError,
} from 'git-project-topology';

try {
  await inspectProjectTopology('/missing/project');
} catch (error) {
  if (error instanceof ProjectTopologyError) {
    console.error(error.code);
  }
}
```

Current codes:

- `INVALID_INPUT`
- `PATH_NOT_FOUND`
- `PATH_NOT_ACCESSIBLE`
- `GIT_NOT_AVAILABLE`
- `GIT_EXECUTION_FAILED`
- `INVALID_GIT_TOPOLOGY`

A directory simply not being a Git repository is **not** an error; `git` is `null`.

## Architecture

```text
public API
   │
   ▼
ProjectTopologyInspector          application service
   │
   ├── PathTopologySource         port
   │      └── NodePathTopologySource
   │
   └── GitTopologySource          port
          └── GitCliTopologySource

Domain
  ProjectTopology
  GitRepositoryTopology
  GitWorktreeTopology
  ProjectTopologyError
```

The abstractions exist only at side-effect boundaries. The package deliberately avoids class-per-concept DDD ceremony: the domain is represented by immutable structural types, while orchestration and infrastructure have explicit responsibilities.

This keeps the design aligned with SOLID without turning a small library into a framework:

- **SRP:** path resolution, Git execution/parsing, and topology orchestration are separate.
- **OCP/DIP:** the inspector depends on ports, not `child_process` or `fs` directly.
- **ISP:** the two infrastructure ports expose only the operations topology discovery requires.
- **DDD:** `ProjectTopology` is the returned aggregate; project root, Git common directory, worktrees, and selection have explicit domain names and distinct semantics.

## Development

```sh
npm install
npm run check
```

`npm run check` performs strict TypeScript checking, real-Git integration tests, and a production declaration build.

The integration suite creates temporary repositories and verifies regular repositories, bare `.git` repositories with linked worktrees, standalone bare repositories, worktree descendants, `.git` inputs, symlink aliases, `~/` display paths, non-Git directories, and structured failures.

## Scope

This package intentionally does **not** provide:

- authorization or write policy;
- Git status / dirty-state inspection;
- Git mutation;
- project persistence;
- agent/session discovery;
- MCP integration;
- UI concerns.

Those belong in consuming applications or higher-level libraries.
