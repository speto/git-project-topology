import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { ProjectTopologyError } from '../../domain/errors.js';
import type {
  DiscoveredGitRepository,
  GitTopologySource,
  RawGitWorktree,
} from '../../application/ports.js';
import { parseWorktreePorcelain } from './worktree-porcelain.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface GitCliTopologySourceOptions {
  readonly gitBinary?: string;
  readonly timeoutMs?: number;
}

export class GitCliTopologySource implements GitTopologySource {
  readonly #gitBinary: string;
  readonly #timeoutMs: number;

  constructor(options: GitCliTopologySourceOptions = {}) {
    this.#gitBinary = options.gitBinary ?? 'git';
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (this.#gitBinary.length === 0) {
      throw new ProjectTopologyError('INVALID_INPUT', 'Git executable cannot be empty.');
    }

    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new ProjectTopologyError(
        'INVALID_INPUT',
        'Git timeout must be a positive finite number.',
      );
    }
  }

  async discoverRepository(probeDirectory: string): Promise<DiscoveredGitRepository | null> {
    const result = await this.#runAllowingNotRepository(
      ['-C', probeDirectory, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      probeDirectory,
    );

    if (result === null) {
      return null;
    }

    const commonDirectoryPath = path.resolve(stripFinalLineEnding(result));
    const bareOutput = await this.#run(
      ['--git-dir', commonDirectoryPath, 'rev-parse', '--is-bare-repository'],
      path.dirname(commonDirectoryPath),
    );

    return {
      commonDirectoryPath,
      bare: stripFinalLineEnding(bareOutput) === 'true',
    };
  }

  async listWorktrees(commonDirectoryPath: string): Promise<readonly RawGitWorktree[]> {
    const output = await this.#run(
      ['--git-dir', commonDirectoryPath, 'worktree', 'list', '--porcelain', '-z'],
      path.dirname(commonDirectoryPath),
    );

    return parseWorktreePorcelain(output);
  }

  async #runAllowingNotRepository(args: readonly string[], cwd: string): Promise<string | null> {
    try {
      return await this.#run(args, cwd);
    } catch (error) {
      if (
        error instanceof ProjectTopologyError &&
        error.code === 'GIT_EXECUTION_FAILED' &&
        error.message.includes('not a git repository')
      ) {
        return null;
      }

      throw error;
    }
  }

  async #run(args: readonly string[], cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.#gitBinary, [...args], {
        cwd,
        encoding: 'utf8',
        timeout: this.#timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          LANG: 'C',
          LC_ALL: 'C',
        },
      });

      return stdout;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new ProjectTopologyError(
          'GIT_NOT_AVAILABLE',
          `Git executable "${this.#gitBinary}" was not found.`,
          { cause: error },
        );
      }

      const stderr = readStderr(error);
      const detail = stderr.length > 0 ? stderr : errorMessage(error);
      throw new ProjectTopologyError(
        'GIT_EXECUTION_FAILED',
        `Git command failed: ${detail}`,
        { cause: error },
      );
    }
  }
}

function stripFinalLineEnding(value: string): string {
  return value.endsWith('\r\n')
    ? value.slice(0, -2)
    : value.endsWith('\n')
      ? value.slice(0, -1)
      : value;
}

function readStderr(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) {
    return '';
  }

  const stderr = error.stderr;
  return typeof stderr === 'string' ? stderr.trim() : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
