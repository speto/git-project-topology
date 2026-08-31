# Architecture

## Bounded context

`git-project-topology` owns one bounded context: **read-only project topology discovery**.

Its ubiquitous language is intentionally small:

- **Project root** — the logical directory a user thinks of as the project.
- **Git common directory** — the repository-wide administrative directory shared by all worktrees.
- **Worktree** — a working tree registered by Git, including Git's main/linked semantics and state reported by porcelain.
- **Selection** — the relationship between the caller's input path and the resolved project/worktree topology.
- **Canonical path** — filesystem identity after symlink resolution.
- **Display path** — a presentation path derived from the caller's namespace when that derivation is safe.

Anything outside that language is outside this package. In particular: authorization, persistence, Git status, agent sessions, MCP, and UI.

## Aggregate

`ProjectTopology` is the returned aggregate:

```text
ProjectTopology
├── projectRoot: TopologyPath
├── git: GitRepositoryTopology | null
│   ├── commonDirectory: TopologyPath
│   ├── bare: boolean
│   └── worktrees: GitWorktreeTopology[]
└── selection: ProjectSelection
```

The aggregate is immutable structural data. DDD does not require entity classes when there is no behavior or lifecycle to protect inside those values.

## Invariants

1. Inputs that belong to the same Git repository resolve to the same canonical Git common directory.
2. A `.git` common directory resolves to its parent as project root.
3. A standalone bare repository not named `.git` is its own project root.
4. A Git common directory not named `.git` is itself the project root; Git does not provide a generally reliable reverse mapping from arbitrary separate Git directories to a user-facing parent project directory.
5. Bare Git records from `git worktree list` are repository metadata, not worktrees exposed in `worktrees`.
6. `isMain` means the first/main worktree reported by Git. It never means "branch named main".
7. Canonical paths determine identity. Display paths never do.
8. Worktree enumeration comes from Git's stable porcelain output, never recursive filesystem discovery.
9. An explicit non-Git project directory is valid and returns `git: null`.
10. Discovery is read-only.

## Dependency direction

```text
                   domain
                     ▲
                     │
                 application
                 /         \
                /           \
        PathTopologySource   GitTopologySource
                ▲                 ▲
                │                 │
 NodePathTopologySource     GitCliTopologySource
```

The application service depends on narrow ports. Infrastructure implements them.

The domain has no dependency on `fs`, `child_process`, Git commands, Workspace Relay, or any agent product.

## SOLID application

### Single Responsibility Principle

- `ProjectTopologyInspector` orchestrates topology discovery.
- `NodePathTopologySource` resolves filesystem identity and availability.
- `GitCliTopologySource` executes read-only Git commands.
- `parseWorktreePorcelain` parses one stable external format.
- path-containment functions perform path relationship logic.

### Open/Closed + Dependency Inversion

The inspector depends on `PathTopologySource` and `GitTopologySource`, so infrastructure can be replaced without rewriting the domain orchestration. This is useful for tests and for environments that may eventually expose Git through another process boundary.

### Interface Segregation

The ports contain only operations required for topology inspection. There is deliberately no generic filesystem abstraction and no generic Git client abstraction.

That constraint matters: an abstraction broader than the use case would make the package harder to reason about and would turn infrastructure interfaces into accidental frameworks.

### Liskov Substitution

Port implementations must preserve domain semantics rather than infrastructure-specific semantics. For example, `discoverRepository()` returns `null` only for "not a Git repository"; malformed/inaccessible repositories remain errors.

## Why there are no generated IDs

The canonical Git common directory is already a stable repository identity within a machine, and the canonical worktree path is already a stable worktree identity within that repository.

Opaque hashes would add representation without adding information. Applications that require database IDs, authorization IDs, or privacy-preserving IDs should derive them at their own boundary.

## Why Git porcelain is authoritative

Git documents `git worktree list --porcelain` as stable for scripts and recommends `-z`; `-z` makes path and reason parsing safe when unusual characters are present.

The package requires Git 2.36+ because that version exposes `git worktree list --porcelain -z`.

We intentionally do **not**:

- scan child directories looking for `.git`;
- parse `$GIT_DIR/worktrees` internals directly;
- infer registered worktrees from filesystem layout;
- infer detached/locked/prunable state ourselves.

## Path identity

Path identity has two layers:

```text
input/display namespace
~/Workspace/t7/speto/workspace-relay/main
                 │
                 ▼ realpath
canonical identity
/Volumes/t7-workspace/speto/workspace-relay/main
```

`resolvePathIdentity()` is public so higher-level libraries can normalize external path evidence—such as future agent session `cwd` values—using exactly the same rules as project topology discovery.

With `allowMissing: true`, the resolver canonicalizes the deepest existing ancestor and appends the missing suffix. This keeps stale session/worktree paths comparable without pretending the missing path exists.

## Read-only subprocess boundary

Git is executed with `execFile`, not a shell. Paths are separate arguments, so shell quoting/injection is not part of the command model.

The adapter sets:

- `GIT_OPTIONAL_LOCKS=0` to avoid unnecessary optional locks;
- `LANG=C` and `LC_ALL=C` so expected Git error classification is deterministic.

Unexpected Git failures remain typed `ProjectTopologyError`s rather than being silently converted to "not a repository".
