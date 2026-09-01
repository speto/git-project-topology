import { readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const testOutput = new URL('../.test-dist', import.meta.url);
const compiledTests = new URL('../.test-dist/test', import.meta.url);

await rm(testOutput, { recursive: true, force: true });
const typeScriptCompiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
await run(process.execPath, [typeScriptCompiler, '-p', 'tsconfig.test.json']);

const testFiles = (await readdir(compiledTests))
  .filter((fileName) => fileName.endsWith('.test.js'))
  .map((fileName) => path.join(fileURLToPath(compiledTests), fileName));

await run(process.execPath, ['--test', ...testFiles]);
await rm(testOutput, { recursive: true, force: true });

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
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
