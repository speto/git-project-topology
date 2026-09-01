import { execFile } from 'node:child_process';
import path from 'node:path';
import { ProjectTopologyError } from '../errors.js';
import { parseWorktreePorcelain } from './worktree-porcelain.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const REPOSITORY_LOCAL_GIT_ENVIRONMENT = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM',
  'GIT_DIR',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_NAMESPACE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
  'GIT_CEILING_DIRECTORIES',
] as const;

export interface GitOptions {
  readonly gitBinary?: string;
  readonly timeoutMs?: number;
}

export interface DiscoveredGitRepository {
  readonly commonDirectoryPath: string;
  readonly bare: boolean;
  readonly currentGitDirectoryPath: string | null;
  readonly currentWorktreeRootPath: string | null;
}

export interface RawGitWorktree {
  readonly path: string;
  readonly head: string | null;
  readonly branchRef: string | null;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly lockReason: string | null;
  readonly prunable: boolean;
  readonly prunableReason: string | null;
}

export async function discoverGitRepository(
  probeDirectory: string,
  options: GitOptions = {},
): Promise<DiscoveredGitRepository | null> {
  const commonDirectoryResult = await runGit(
    ['-C', probeDirectory, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    probeDirectory,
    options,
  );

  if (commonDirectoryResult.exitCode !== 0) {
    if (isNotRepository(commonDirectoryResult)) {
      return null;
    }

    throw gitCommandError(commonDirectoryResult);
  }

  const commonDirectoryPath = path.resolve(stripFinalLineEnding(commonDirectoryResult.stdout));
  const bareResult = await runGit(
    ['--git-dir', commonDirectoryPath, 'rev-parse', '--is-bare-repository'],
    path.dirname(commonDirectoryPath),
    options,
  );
  requireSuccess(bareResult);

  const bare = stripFinalLineEnding(bareResult.stdout) === 'true';
  if (bare) {
    return {
      commonDirectoryPath,
      bare: true,
      currentGitDirectoryPath: null,
      currentWorktreeRootPath: null,
    };
  }

  const gitDirectoryResult = await runGit(
    ['-C', probeDirectory, 'rev-parse', '--path-format=absolute', '--git-dir'],
    probeDirectory,
    options,
  );
  requireSuccess(gitDirectoryResult);
  const worktreeRootResult = await runGit(
    ['-C', probeDirectory, 'rev-parse', '--show-toplevel'],
    probeDirectory,
    options,
  );

  return {
    commonDirectoryPath,
    bare: false,
    currentGitDirectoryPath: path.resolve(stripFinalLineEnding(gitDirectoryResult.stdout)),
    currentWorktreeRootPath:
      worktreeRootResult.exitCode === 0
        ? path.resolve(stripFinalLineEnding(worktreeRootResult.stdout))
        : null,
  };
}

export async function listGitWorktrees(
  commonDirectoryPath: string,
  options: GitOptions = {},
): Promise<readonly RawGitWorktree[]> {
  const result = await runGit(
    ['--git-dir', commonDirectoryPath, 'worktree', 'list', '--porcelain', '-z'],
    path.dirname(commonDirectoryPath),
    options,
  );
  requireSuccess(result);

  return parseWorktreePorcelain(result.stdout);
}

interface GitCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runGit(
  args: readonly string[],
  cwd: string,
  options: GitOptions,
): Promise<GitCommandResult> {
  const gitBinary = options.gitBinary ?? 'git';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (gitBinary.length === 0) {
    throw new ProjectTopologyError('INVALID_INPUT', 'Git executable cannot be empty.');
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ProjectTopologyError(
      'INVALID_INPUT',
      'Git timeout must be a positive finite number.',
    );
  }

  return new Promise((resolve, reject) => {
    execFile(
      gitBinary,
      [...args],
      {
        cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: gitEnvironment(),
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }

        if (isNodeError(error) && error.code === 'ENOENT') {
          reject(
            new ProjectTopologyError(
              'GIT_NOT_AVAILABLE',
              `Git executable "${gitBinary}" was not found.`,
              { cause: error },
            ),
          );
          return;
        }

        if (typeof error.code === 'number') {
          resolve({ exitCode: error.code, stdout, stderr });
          return;
        }

        reject(
          new ProjectTopologyError(
            'GIT_EXECUTION_FAILED',
            `Git command failed: ${stderr.trim() || error.message}`,
            { cause: error },
          ),
        );
      },
    );
  });
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };

  for (const key of REPOSITORY_LOCAL_GIT_ENVIRONMENT) {
    delete environment[key];
  }
  for (const key of Object.keys(environment)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) {
      delete environment[key];
    }
  }

  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.LANG = 'C';
  environment.LC_ALL = 'C';
  return environment;
}

function isNotRepository(result: GitCommandResult): boolean {
  return result.exitCode === 128 && result.stderr.trim().startsWith('fatal: not a git repository');
}

function requireSuccess(result: GitCommandResult): void {
  if (result.exitCode !== 0) {
    throw gitCommandError(result);
  }
}

function gitCommandError(result: GitCommandResult): ProjectTopologyError {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
  return new ProjectTopologyError('GIT_EXECUTION_FAILED', `Git command failed: ${detail}`);
}

function stripFinalLineEnding(value: string): string {
  return value.endsWith('\r\n')
    ? value.slice(0, -2)
    : value.endsWith('\n')
      ? value.slice(0, -1)
      : value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
