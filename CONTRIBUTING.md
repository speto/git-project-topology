# Contributing

## Local-first development

GitHub-hosted Actions are a merge-validation resource, not an interactive development loop.

Before pushing a coherent change set:

```sh
npm install
npm run check
```

For package-surface changes, also verify the package contents locally:

```sh
npm pack --dry-run --ignore-scripts
```

Keep iterative work in a draft pull request and validate locally. Batch changes before pushing instead of using repeated push/CI cycles as a compiler or test loop.

## Hosted CI contract

The repository has two validation tiers:

- **PR Check** runs on non-draft pull-request updates and direct pushes to `main`. It uses one `ubuntu-slim` runner on the minimum supported Node.js version (22), cancels superseded runs, and skips Markdown-only changes.
- **CI** is the full merge-candidate validation. It preserves Node.js 22/24 Linux coverage, Node.js 24 macOS/Windows coverage, and package smoke. It runs when a non-draft pull request is opened or reopened, when a draft is promoted with `ready_for_review`, or when deliberately started with `workflow_dispatch`. It intentionally does **not** run on every `synchronize` event.

If commits are pushed after the latest full CI run, let PR Check validate the iteration cheaply, then manually dispatch **CI** on the pull-request branch once the new state is a merge candidate.

Do not toggle draft/ready state repeatedly just to trigger CI. Use the manual workflow for deliberate revalidation.

CI installs dependencies with `--ignore-scripts` because this package's `prepare` script already builds; `npm run check` owns the build in CI and should not be duplicated during installation. Automatic npm audit/fund network calls are also disabled in CI.
