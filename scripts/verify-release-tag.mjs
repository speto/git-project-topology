import { readFile } from 'node:fs/promises';

const [tag] = process.argv.slice(2);

if (!tag) {
  throw new Error('Expected release tag argument.');
}

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const expectedTag = `v${packageJson.version}`;

if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag} does not match package version ${packageJson.version}. Expected ${expectedTag}.`);
}

console.log(`Release tag ${tag} matches package version ${packageJson.version}.`);
