import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  FileSystemEntryKind,
  PathTopologySource,
} from '../../application/ports.js';
import { ProjectTopologyError } from '../../domain/errors.js';
import { isPathWithin } from '../../domain/path-containment.js';
import type { SelectedPath, TopologyPath, WorktreeAvailability } from '../../domain/model.js';

export interface NodePathTopologySourceOptions {
  readonly cwd?: string;
  readonly homeDirectory?: string;
}

export class NodePathTopologySource implements PathTopologySource {
  readonly #cwd: string;
  readonly #homeDirectory: string;

  constructor(options: NodePathTopologySourceOptions = {}) {
    this.#cwd = path.resolve(options.cwd ?? process.cwd());
    this.#homeDirectory = path.resolve(options.homeDirectory ?? homedir());
  }

  async resolveInput(inputPath: string): Promise<SelectedPath> {
    return this.resolvePathIdentity(inputPath, false);
  }

  async resolvePathIdentity(inputPath: string, allowMissing: boolean): Promise<SelectedPath> {
    if (inputPath.length === 0) {
      throw new ProjectTopologyError('INVALID_INPUT', 'Project path cannot be empty.');
    }

    const usesHomeAlias =
      inputPath === '~' || inputPath.startsWith(`~${path.sep}`) || inputPath.startsWith('~/');
    const expandedPath = usesHomeAlias
      ? path.join(this.#homeDirectory, inputPath.slice(2))
      : inputPath;
    const absolutePath = path.resolve(this.#cwd, expandedPath);
    const canonicalPath = allowMissing
      ? await this.#canonicalizePossiblyMissing(absolutePath)
      : await this.#canonicalizeExisting(absolutePath);

    return {
      inputPath,
      absolutePath,
      canonicalPath,
      displayPath: usesHomeAlias
        ? abbreviateHome(absolutePath, this.#homeDirectory)
        : absolutePath,
    };
  }

  async resolveExisting(inputPath: string, displayPath?: string): Promise<TopologyPath> {
    const absolutePath = path.resolve(inputPath);
    return {
      canonicalPath: await this.#canonicalizeExisting(absolutePath),
      displayPath: displayPath ?? absolutePath,
    };
  }

  async resolvePossiblyMissing(inputPath: string, displayPath?: string): Promise<TopologyPath> {
    const absolutePath = path.resolve(inputPath);
    return {
      canonicalPath: await this.#canonicalizePossiblyMissing(absolutePath),
      displayPath: displayPath ?? absolutePath,
    };
  }

  async entryKind(inputPath: string): Promise<FileSystemEntryKind> {
    try {
      const entry = await stat(inputPath);
      return entry.isDirectory() ? 'directory' : 'file';
    } catch (error) {
      throw pathError(error, inputPath);
    }
  }

  async availability(inputPath: string): Promise<WorktreeAvailability> {
    try {
      await stat(inputPath);
      return 'available';
    } catch (error) {
      if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return 'missing';
      }
      if (isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM')) {
        return 'inaccessible';
      }
      throw pathError(error, inputPath);
    }
  }

  deriveDisplayPath(targetCanonicalPath: string, selectedPath: SelectedPath): string {
    if (isPathWithin(targetCanonicalPath, selectedPath.canonicalPath)) {
      const relativePath = path.relative(targetCanonicalPath, selectedPath.canonicalPath);
      return ascendPath(selectedPath.displayPath, relativePath);
    }

    if (isPathWithin(selectedPath.canonicalPath, targetCanonicalPath)) {
      return path.join(
        selectedPath.displayPath,
        path.relative(selectedPath.canonicalPath, targetCanonicalPath),
      );
    }

    return targetCanonicalPath;
  }

  async #canonicalizeExisting(inputPath: string): Promise<string> {
    try {
      return await realpath(inputPath);
    } catch (error) {
      throw pathError(error, inputPath);
    }
  }

  async #canonicalizePossiblyMissing(inputPath: string): Promise<string> {
    let currentPath = inputPath;
    const missingSegments: string[] = [];

    while (true) {
      try {
        const existingCanonicalPath = await realpath(currentPath);
        return path.join(existingCanonicalPath, ...missingSegments);
      } catch (error) {
        if (!isNodeError(error) || (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')) {
          throw pathError(error, inputPath);
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
          return inputPath;
        }

        missingSegments.unshift(path.basename(currentPath));
        currentPath = parentPath;
      }
    }
  }
}

function abbreviateHome(absolutePath: string, homeDirectory: string): string {
  if (absolutePath === homeDirectory) {
    return '~';
  }

  if (isPathWithin(homeDirectory, absolutePath)) {
    return path.join('~', path.relative(homeDirectory, absolutePath));
  }

  return absolutePath;
}

function ascendPath(displayPath: string, relativePath: string): string {
  if (relativePath === '') {
    return displayPath;
  }

  const segmentCount = relativePath.split(path.sep).filter(Boolean).length;
  let result = displayPath;
  for (let index = 0; index < segmentCount; index += 1) {
    result = path.dirname(result);
  }

  return result;
}

function pathError(error: unknown, inputPath: string): ProjectTopologyError {
  if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
    return new ProjectTopologyError(
      'PATH_NOT_FOUND',
      `Path does not exist: ${inputPath}`,
      { cause: error },
    );
  }

  return new ProjectTopologyError(
    'PATH_NOT_ACCESSIBLE',
    `Path is not accessible: ${inputPath}`,
    { cause: error },
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
