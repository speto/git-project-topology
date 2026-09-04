import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const keepTarball = process.argv.includes('--keep');
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const expectedTarball = `git-project-topology-${packageJson.version}.tgz`;
let tarballPath;
let consumerDirectory;

try {
  const dryRun = await runJson(npm, ['pack', '--dry-run', '--ignore-scripts', '--json'], root);
  const packedFiles = dryRun[0]?.files?.map(({ path: filePath }) => filePath) ?? [];
  verifyPackedFiles(packedFiles);

  const packed = await runJson(npm, ['pack', '--ignore-scripts', '--json'], root);
  const tarball = packed[0]?.filename;

  if (tarball !== expectedTarball) {
    throw new Error(`Expected ${expectedTarball}, got ${tarball ?? 'no tarball'}.`);
  }

  tarballPath = path.join(root, tarball);
  consumerDirectory = await mkdtemp(path.join(tmpdir(), 'git-project-topology-consumer-'));
  await writeFile(
    path.join(consumerDirectory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2),
  );

  await run(npm, ['install', '--no-audit', '--no-fund', tarballPath], consumerDirectory);

  await writeFile(
    path.join(consumerDirectory, 'runtime.mjs'),
    `import { inspectProjectTopology, resolvePathIdentity, isPathWithin, ProjectTopologyError } from 'git-project-topology';\n\nfor (const value of [inspectProjectTopology, resolvePathIdentity, isPathWithin, ProjectTopologyError]) {\n  if (typeof value !== 'function') throw new Error('Public runtime API is not importable.');\n}\n`,
  );
  await run(process.execPath, ['runtime.mjs'], consumerDirectory);

  await writeFile(
    path.join(consumerDirectory, 'consumer.ts'),
    `import { inspectProjectTopology, resolvePathIdentity, isPathWithin, ProjectTopologyError, type ProjectTopology } from 'git-project-topology';\n\nconst topology: ProjectTopology | undefined = undefined;\nvoid topology;\nvoid inspectProjectTopology;\nvoid resolvePathIdentity;\nvoid isPathWithin;\nvoid ProjectTopologyError;\n`,
  );

  const typeScriptCompiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  await run(
    process.execPath,
    [
      typeScriptCompiler,
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      path.join(consumerDirectory, 'consumer.ts'),
    ],
    consumerDirectory,
  );

  const installedPackage = path.join(
    consumerDirectory,
    'node_modules',
    'git-project-topology',
  );
  await assertMissing(path.join(installedPackage, 'src'));
  await assertMissing(path.join(installedPackage, 'test'));
  await assertMissing(path.join(installedPackage, 'scripts'));
  await assertMissing(path.join(installedPackage, 'node_modules', 'typescript'));

  console.log(`Verified ${tarball}: runtime imports, declarations, and prebuilt consumer install.`);
} finally {
  if (consumerDirectory) {
    await rm(consumerDirectory, { recursive: true, force: true });
  }

  if (tarballPath && !keepTarball) {
    await rm(tarballPath, { force: true });
  }
}

function verifyPackedFiles(files) {
  const required = ['LICENSE', 'README.md', 'package.json', 'dist/index.js', 'dist/index.d.ts'];
  const missing = required.filter((file) => !files.includes(file));
  const unexpected = files.filter(
    (file) =>
      file !== 'LICENSE' &&
      file !== 'README.md' &&
      file !== 'package.json' &&
      !file.startsWith('dist/'),
  );

  if (missing.length > 0) {
    throw new Error(`Packed package is missing: ${missing.join(', ')}`);
  }

  if (unexpected.length > 0) {
    throw new Error(`Packed package contains unexpected files: ${unexpected.join(', ')}`);
  }

  console.log(`Packed files (${files.length}):\n${files.join('\n')}`);
}

async function assertMissing(targetPath) {
  try {
    await access(targetPath);
  } catch {
    return;
  }

  throw new Error(`Consumer package unexpectedly contains ${targetPath}.`);
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown status'}`));
    });
  });
}

function runJson(command, args, cwd) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'inherit'],
      shell: false,
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown status'}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}
