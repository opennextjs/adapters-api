# Next.js test suite

Runs the end-to-end suite of Next.js ([adapter testing docs](https://nextjs.org/docs/app/api-reference/adapters/testing-adapters)) against the OpenNext adapters. Nothing is deployed to a cloud provider, every test app runs on a local port.

| Target       | Build                         | Server                         | Bundler   |
| ------------ | ----------------------------- | ------------------------------ | --------- |
| `core`       | `open-next build`             | `node` and the local overrides | Turbopack |
| `cloudflare` | `opennextjs-cloudflare build` | `wrangler dev`                 | webpack   |

`core` is the same setup as the `core` job of `.github/workflows/local.yml`. AWS services are not involved.

`cloudflare` uses webpack as the Turbopack chunk loader generates broken paths for apps which are not in a monorepo.

## Running tests

```bash
# Once, about 4GB of disk. Clones and builds Next.js in packages/tests-next-suite/.cache
pnpm next-suite setup

# One test file
pnpm next-suite run --target core -c 1 test/e2e/app-dir/hello-world/hello-world.test.ts
pnpm next-suite run --target cloudflare -c 1 test/e2e/app-dir/hello-world/hello-world.test.ts

# A part of the suite
pnpm next-suite run --target core --group 1/16 -c 2
```

The whole suite is about 800 test files, each one building an app, so it is meant for CI. Only do one run at a time on a checkout, as each run rebuilds and packs the OpenNext packages.

| Option                     | Purpose                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `--ref <ref>`              | The Next.js tag, branch or commit (default in `src/next-checkout.ts`) |
| `--retries <n>`            | How many times a failing file runs again (2 by default)               |
| `--include-disabled`       | Runs the disabled tests too                                           |
| `NEXT_SUITE_NEXT_DIR`      | Uses an existing built Next.js checkout                               |
| `NEXT_TEST_SKIP_CLEANUP=1` | Keeps the test apps                                                   |

Test apps are created in `~/.cache/opennext-next-suite/apps`, outside of this repository as OpenNext looks for the monorepo root. Each app has `.adapter-build.log` and `.adapter-server.log`.

Test apps use TypeScript 5.9 whatever the test asks for: Next.js 16.2 can not load TypeScript 7 and writes a `tsconfig.json` TypeScript 6 rejects. Review `PINNED_DEPENDENCIES` in `src/prepare-app.ts` when updating the Next.js ref.

## Disabling tests

Each adapter has its own list, `disabled/core.json` and `disabled/cloudflare.json`. A test disabled for one adapter still runs on the other one.

```json
{
	"test/e2e/foo/foo.test.ts": { "reason": "Crashes during the worker build" },
	"test/e2e/bar/bar.test.ts": {
		"reason": "Streaming order differs",
		"cases": ["bar suite streams the shell first"]
	}
}
```

- Without `cases`, the whole file is disabled.
- `cases` holds full test names, the `describe` blocks and the test name separated by spaces. They have to match exactly.
- The key is an exact path, globs are not supported.
- A reason is required.

The edge runtime is not supported, so `pnpm next-suite disable-edge` adds every test whose app declares it to both lists, as whole files. Run it again after updating the Next.js ref. Middleware does not count. Fixtures are shared, so one edge page in a fixture disables all of its tests.

A run warns about entries for files which no longer exist, as can happen after updating the Next.js ref. Entries for cases are not checked, so remove them once the test is fixed: use `--include-disabled` to find out.

## CI

`.github/workflows/next-suite.yml` runs the whole suite nightly and on demand (with a `nextRef` input), split in 16 groups per target. Pull requests changing this package only run a smoke test.

Each run uploads a `next-suite-disabled` artifact: the current lists with what failed in that run added to them. Entries already in a list are kept. To accept these failures, copy the files over `disabled/`.

## How it works

The harness of Next.js copies each test app to a directory and calls three scripts with that directory as `cwd`:

- `bin/e2e-deploy.sh` installs the packed OpenNext packages in the app, builds it and starts the server. The URL is the only thing it prints on stdout.
- `bin/e2e-logs.sh` prints the build ids and the logs.
- `bin/e2e-cleanup.sh` stops the server.

## Adding a target

Add it to `TARGETS` in `src/targets.ts`, with its files in `templates/<name>/`, then add its `SETUP_TIMEOUT_MS` and `BUNDLER_ENV` in `src/run-suite.ts`, a `disabled/<name>.json` file, and the target to the matrix of the workflow.
