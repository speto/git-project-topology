import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ProjectTopologyError } from './errors.js';
import type { PathIdentity, TopologyPath, WorktreeAvailability } from './types.js';

export interface PathIdentityOptions {
  readonly cwd?: string;
  readonly allowMissing?: boolean;
}

export interface PathContext {
  readonly cwd: string;
  readonly homeDirectory: string;
}

export type FileSystemEntryKind = 'directory' | 'file';

export function createPathContext(cwd?: string): PathContext {
  return {
    cwd: path.resolve(cwd ?? process.cwd()),
    homeDirectory: path.resolve(homedir()),
  };
}

export async function resolvePathIdentity(
  inputPath: string,
  options: PathIdentityOptions = {},
): Promise<PathIdentity> {
  return resolveInputPath(
    createPathContext(options.cwd),
    inputPath,
    options.allowMissing ?? false,
  );
}

export async function resolveInputPath(
  context: PathContext,
  inputPath: string,
  allowMissing = false,
): Promise<PathIdentity> {
  if (inputPath.length === 0) {
    throw new ProjectTopologyError('INVALID_INPUT', 'Project path cannot be empty.');
  }

  const usesHomeAlias =
    inputPath === '~' || inputPath.startsWith(`~${path.sep}`) || inputPath.startsWith('~/');
  const expandedPath = usesHomeAlias
    ? inputPath === '~'
      ? context.homeDirectory
      : path.join(context.homeDirectory, inputPath.slice(2))
    : inputPath;
  const absolutePath = path.resolve(context.cwd, expandedPath);
  const canonicalPath = allowMissing
    ? await canonicalizePossiblyMissing(absolutePath)
    : await canonicalizeExisting(absolutePath);

  return {
    inputPath,
    absolutePath,
    canonicalPath,
    displayPath: usesHomeAlias
      ? abbreviateHome(absolutePath, context.homeDirectory)
      : absolutePath,
  };
}

export async function resolveExistingPath(
  inputPath: string,
  displayPath?: string,
): Promise<TopologyPath> {
  const absolutePath = path.resolve(inputPath);
  return {
    canonicalPath: await canonicalizeExisting(absolutePath),
    displayPath: displayPath ?? absolutePath,
  };
}

export async function resolvePossiblyMissingPath(
  inputPath: string,
  displayPath?: string,
): Promise<TopologyPath> {
  const absolutePath = path.resolve(inputPath);
  return {
    canonicalPath: await canonicalizePossiblyMissing(absolutePath),
    displayPath: displayPath ?? absolutePath,
  };
}

export async function entryKind(inputPath: string): Promise<FileSystemEntryKind> {
  try {
    const entry = await stat(inputPath);
    return entry.isDirectory() ? 'directory' : 'file';
  } catch (error) {
    throw pathError(error, inputPath);
  }
}

export async function worktreeAvailability(inputPath: string): Promise<WorktreeAvailability> {
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

export function deriveDisplayPath(
  targetCanonicalPath: string,
  selectedPath: PathIdentity,
): string {
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

export function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);

  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

export function findDeepestContainingPath<T>(
  candidatePath: string,
  values: readonly T[],
  pathOf: (value: T) => string,
): T | null {
  let best: T | null = null;
  let bestLength = -1;

  for (const value of values) {
    const rootPath = pathOf(value);
    if (isPathWithin(rootPath, candidatePath) && rootPath.length > bestLength) {
      best = value;
      bestLength = rootPath.length;
    }
  }

  return best;
}

async function canonicalizeExisting(inputPath: string): Promise<string> {
  try {
    return await realpath(inputPath);
  } catch (error) {
    throw pathError(error, inputPath);
  }
}

async function canonicalizePossiblyMissing(inputPath: string): Promise<string> {
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
