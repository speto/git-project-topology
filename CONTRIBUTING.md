# Contributing

Contributions are welcome.

For substantial changes to behavior or the public API, open an issue first so the approach can be agreed before implementation.

## Development

Requires Node.js 22+ and Git 2.36+.

```sh
npm install
npm run check
```

`npm run check` runs the type checks, tests, and production build.

For changes affecting the published package surface, also run:

```sh
npm pack --dry-run --ignore-scripts
```

## Pull requests

- Keep changes focused and reviewable.
- Add or update tests for behavior changes.
- Update the README for user-visible changes.
- Preserve existing public API behavior unless a breaking change is intentional.
- Follow the existing TypeScript structure and style.
- Validate locally before pushing; hosted CI is merge validation, not an interactive development loop.

## AI-assisted contributions

AI tools are welcome. Unreviewed AI-generated output is not.

Before requesting review:

- understand the code you are submitting and be able to explain it;
- remove unnecessary abstractions, generated boilerplate, speculative features, and unrelated refactoring;
- follow the existing architecture and style rather than introducing new patterns without a concrete need;
- clean up temporary, fixup, and exploratory commits where practical.

Pull requests should present a coherent change, not the full history of an exploratory implementation. Large generated patches, excessive commit churn, or code that has not been understood and verified by its author may be closed rather than reviewed.

AI tools should reduce implementation effort, not transfer the cost of understanding, cleanup, and verification to maintainers.

Contributions are submitted under the project's MIT License.
