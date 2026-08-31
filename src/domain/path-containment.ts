import path from 'node:path';

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
