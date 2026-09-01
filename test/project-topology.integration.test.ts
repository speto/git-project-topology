import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  inspectProjectTopology,
  ProjectTopologyError,
  resolvePathIdentity,
  type ProjectTopology,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('inspectProjectTopology', () => {
  it('normalizes regular repository, .git, worktree and worktree descendant inputs', async () => {
    const fixture = await createRegularRepository();
    const descendant = path.join(fixture.linkedWorktree, 'src', 'domain');
    await mkdir(descendant, { recursive: true });

    const results = await Promise.all([
      inspectProjectTopology(fixture.repository),
      inspectProjectTopology(path.join(fixture.repository, '.git')),
      inspectProjectTopology(fixture.linkedWorktree),
      inspectProjectTopology(descendant),
      inspectProjectTopology(path.join(fixture.linkedWorktree, '.git')),
    ]);

    assertEquivalentRepository(results);
    assert.equal(results[0]?.selection.kind, 'project-root');
    assert.equal(results[1]?.selection.kind, 'git-common-directory');
    assert.equal(results[2]?.selection.kind, 'worktree');
    assert.equal(results[3]?.selection.kind, 'worktree-descendant');
    assert.equal(results[4]?.selection.kind, 'worktree-descendant');

    const worktrees = results[0]?.git?.worktrees ?? [];
    assert.equal(worktrees.length, 2);
    assert.equal(worktrees[0]?.isMain, true);
    assert.equal(worktrees[0]?.branch, 'main');
    assert.equal(worktrees[1]?.isMain, false);
    assert.equal(worktrees[1]?.branch, 'feature');
  });

  it('resolves a bare .git repository plus child worktrees to the parent project root', async () => {
    const fixture = await createBareDotGitRepository();

    const byProject = await inspectProjectTopology(fixture.projectRoot);
    const byGitDirectory = await inspectProjectTopology(fixture.gitDirectory);
    const byWorktree = await inspectProjectTopology(fixture.worktree);

    assertEquivalentRepository([byProject, byGitDirectory, byWorktree]);
    assert.equal(byProject.projectRoot.canonicalPath, await canonical(fixture.projectRoot));
    assert.equal(byProject.git?.bare, true);
    assert.equal(byProject.git?.worktrees.length, 1);
    assert.equal(byProject.git?.worktrees[0]?.isMain, false);
    assert.equal(byProject.git?.worktrees[0]?.branch, 'main');
  });

  it('derives the project display path from a tilde worktree input in the bare .git layout', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const directory = await mkdtemp(path.join(homedir(), '.git-project-topology-'));
    temporaryDirectories.push(directory);
    const projectRoot = path.join(directory, 'project');
    const gitDirectory = path.join(projectRoot, '.git');
    const worktree = path.join(projectRoot, 'main');
    await mkdir(projectRoot);
    git(['init', '--bare', '--initial-branch=main', gitDirectory]);
    git(['--git-dir', gitDirectory, 'worktree', 'add', worktree]);

    const worktreeInput = `~/${path.relative(homedir(), worktree)}`;
    const expectedProjectDisplay = `~/${path.relative(homedir(), projectRoot)}`;
    const topology = await inspectProjectTopology(worktreeInput);

    assert.equal(topology.projectRoot.displayPath, expectedProjectDisplay);
    assert.equal(topology.selection.kind, 'worktree');
  });

  it('keeps a standalone bare repository as the project root', async () => {
    const root = await makeTemporaryDirectory();
    const bareRepository = path.join(root, 'repository.git');
    git(['init', '--bare', '--initial-branch=main', bareRepository]);

    const topology = await inspectProjectTopology(bareRepository);

    assert.equal(topology.projectRoot.canonicalPath, await canonical(bareRepository));
    assert.equal(topology.git?.commonDirectory.canonicalPath, await canonical(bareRepository));
    assert.equal(topology.git?.bare, true);
    assert.deepEqual(topology.git?.worktrees, []);
  });

  it('preserves registered worktrees that are locked or currently missing', async () => {
    const fixture = await createRegularRepository();
    git(['-C', fixture.repository, 'worktree', 'lock', '--reason', 'portable volume', fixture.linkedWorktree]);

    const linkedWorktreeCanonicalPath = await canonical(fixture.linkedWorktree);
    let topology = await inspectProjectTopology(fixture.repository);
    let linked = topology.git?.worktrees.find(
      (worktree) => worktree.path.canonicalPath === linkedWorktreeCanonicalPath,
    );
    assert.equal(linked?.locked, true);
    assert.equal(linked?.lockReason, 'portable volume');
    assert.equal(linked?.availability, 'available');

    await rm(fixture.linkedWorktree, { recursive: true, force: true });
    topology = await inspectProjectTopology(fixture.repository);
    linked = topology.git?.worktrees.find(
      (worktree) => worktree.path.canonicalPath === linkedWorktreeCanonicalPath,
    );
    assert.equal(linked?.locked, true);
    assert.equal(linked?.availability, 'missing');
  });

  it('resolves relative inputs against an explicit cwd', async () => {
    const fixture = await createRegularRepository();
    const topology = await inspectProjectTopology('repository', {
      cwd: path.dirname(fixture.repository),
    });

    assert.equal(topology.projectRoot.canonicalPath, await canonical(fixture.repository));
  });

  it('normalizes stale paths through the deepest existing symlink ancestor', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const root = await makeTemporaryDirectory();
    const realProject = path.join(root, 'real-project');
    const alias = path.join(root, 'project-alias');
    await mkdir(realProject);
    await symlink(realProject, alias, 'dir');

    const stale = await resolvePathIdentity(path.join(alias, 'removed-worktree', 'src'), {
      allowMissing: true,
    });

    assert.equal(
      stale.canonicalPath,
      path.join(await canonical(realProject), 'removed-worktree', 'src'),
    );
  });

  it('uses the same canonical identity through a symlink alias', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const fixture = await createRegularRepository();
    const alias = path.join(path.dirname(fixture.repository), 'repository-alias');
    await symlink(fixture.repository, alias, 'dir');

    const canonicalTopology = await inspectProjectTopology(fixture.repository);
    const aliasedTopology = await inspectProjectTopology(alias);

    assert.equal(aliasedTopology.projectRoot.canonicalPath, canonicalTopology.projectRoot.canonicalPath);
    assert.equal(
      aliasedTopology.git?.commonDirectory.canonicalPath,
      canonicalTopology.git?.commonDirectory.canonicalPath,
    );
    assert.equal(aliasedTopology.projectRoot.displayPath, alias);
  });

  it('preserves a tilde display namespace while using canonical identity', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const directory = await mkdtemp(path.join(homedir(), '.git-project-topology-'));
    temporaryDirectories.push(directory);
    const repository = path.join(directory, 'repository');
    git(['init', '--initial-branch=main', repository]);
    commitFixture(repository);

    const input = `~/${path.relative(homedir(), repository)}`;
    const topology = await inspectProjectTopology(input);

    assert.equal(topology.projectRoot.displayPath, input);
    assert.equal(topology.selection.path.displayPath, input);
    assert.equal(topology.projectRoot.canonicalPath, await canonical(repository));
  });

  it('returns a valid non-Git project topology instead of throwing', async () => {
    const projectRoot = await makeTemporaryDirectory();
    const topology = await inspectProjectTopology(projectRoot);

    assert.equal(topology.projectRoot.canonicalPath, await canonical(projectRoot));
    assert.equal(topology.git, null);
    assert.equal(topology.selection.kind, 'project-root');
  });

  it('reports a missing selected path with a structured error', async () => {
    const root = await makeTemporaryDirectory();
    const missing = path.join(root, 'missing');

    await assert.rejects(
      inspectProjectTopology(missing),
      (error: unknown) =>
        error instanceof ProjectTopologyError && error.code === 'PATH_NOT_FOUND',
    );
  });

  it('reports a missing Git executable with a structured error', async () => {
    const fixture = await createRegularRepository();

    await assert.rejects(
      inspectProjectTopology(fixture.repository, { gitBinary: 'definitely-not-a-git-binary' }),
      (error: unknown) =>
        error instanceof ProjectTopologyError && error.code === 'GIT_NOT_AVAILABLE',
    );
  });
});

async function createRegularRepository(): Promise<{
  repository: string;
  linkedWorktree: string;
}> {
  const root = await makeTemporaryDirectory();
  const repository = path.join(root, 'repository');
  const linkedWorktree = path.join(root, 'feature-worktree');

  git(['init', '--initial-branch=main', repository]);
  commitFixture(repository);
  git(['-C', repository, 'worktree', 'add', '-b', 'feature', linkedWorktree]);

  return { repository, linkedWorktree };
}

async function createBareDotGitRepository(): Promise<{
  projectRoot: string;
  gitDirectory: string;
  worktree: string;
}> {
  const root = await makeTemporaryDirectory();
  const projectRoot = path.join(root, 'project');
  const gitDirectory = path.join(projectRoot, '.git');
  const worktree = path.join(projectRoot, 'main');

  await mkdir(projectRoot);
  git(['init', '--bare', '--initial-branch=main', gitDirectory]);
  git(['--git-dir', gitDirectory, 'worktree', 'add', worktree]);

  return { projectRoot, gitDirectory, worktree };
}

function commitFixture(repository: string): void {
  git(['-C', repository, 'config', 'user.name', 'git-project-topology tests']);
  git(['-C', repository, 'config', 'user.email', 'tests@example.invalid']);
  execFileSync(process.execPath, ['-e', "require('fs').writeFileSync(process.argv[1], 'fixture\\n')", path.join(repository, 'README.md')]);
  git(['-C', repository, 'add', 'README.md']);
  git(['-C', repository, 'commit', '-m', 'fixture']);
}

function git(args: readonly string[]): void {
  execFileSync('git', [...args], {
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      LANG: 'C',
      LC_ALL: 'C',
    },
  });
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'git-project-topology-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function canonical(inputPath: string): Promise<string> {
  const { realpath } = await import('node:fs/promises');
  return realpath(inputPath);
}

function assertEquivalentRepository(topologies: readonly ProjectTopology[]): void {
  const [first, ...rest] = topologies;
  assert.ok(first);
  assert.ok(first.git);

  for (const topology of rest) {
    assert.equal(topology.projectRoot.canonicalPath, first.projectRoot.canonicalPath);
    assert.equal(topology.git?.commonDirectory.canonicalPath, first.git.commonDirectory.canonicalPath);
    assert.deepEqual(
      topology.git?.worktrees.map((worktree) => worktree.path.canonicalPath),
      first.git.worktrees.map((worktree) => worktree.path.canonicalPath),
    );
  }
}
