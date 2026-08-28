<p align="center">
  <a href="https://opennext.js.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/public/logo-dark.svg">
      <img alt="OpenNext" src="docs/public/logo-light.svg" width="300" />
    </picture>
  </a>
</p>
<p align="center">
  <a href="https://discord.gg/opennextjs"><img alt="Discord" src="https://img.shields.io/discord/1283128968140161065?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@opennextjs/aws"><img alt="npm" src="https://img.shields.io/npm/v/@opennextjs/aws.svg?style=flat-square" /></a>
</p>

---

<h1 align="center">
  <a href="https://opennext.js.org/aws">Docs</a>
</h1>

## Description

OpenNext takes the Next.js build output and converts it into packages that can be deployed across a variety of environments. Natively OpenNext has support for AWS Lambda, and classic Node.js Server.

## Features

OpenNext aims to support all Next.js 15 features. Some features are work in progress. If you are running into any problems make sure to check the [docs](https://opennext.js.org/aws) first before you open a [new issue](/issues/new) or visit our [Discord](https://discord.gg/opennextjs) to let us know!

- [x] App & Pages Router
- [x] API routes
- [x] Dynamic routes
- [x] Static site generation (SSG)
- [x] Server-side rendering (SSR)
- [x] Incremental static regeneration (ISR)
- [x] Middleware
- [x] Server actions
- [x] Image optimization
- [x] [NextAuth.js](https://next-auth.js.org)
- [x] Running at edge
- [x] [Almost no coldstart (\*)](#coldstart)

## Who is using OpenNext?

[Gymshark UK](https://uk.gymshark.com), [Udacity](https://engineering.udacity.com/deploying-next-js-on-the-edge-with-sst-is-sst-the-game-changer-its-claimed-to-be-1f05a0abc27c), [TUDN](https://www.tudn.com), [NHS England](https://github.com/nhs-england-tools/terraform-aws-opennext)

## Configuration

### Configuration file

For personalisation you need to create a file `open-next.config.ts` at the same place as your `next.config.js`, and export a default object that satisfies the `OpenNextConfig` interface. It is possible to not have an open-next.config.ts file, the default configuration will then be applied automatically.

### Debug mode

OpenNext can be executed in debug mode by setting the environment variable `OPEN_NEXT_DEBUG=true` before your build.

This will output A LOT of additional logs to the console. This also disable minifying in esbuild, and add source maps to the output. This can result in code that might be up to 2-3X larger than the production build. Do **not** enable this in production.

You can read more about the configuration in the [docs](https://opennext.js.org/aws/config)

## Preleases

Besides the standard npm releases we also automatically publish prerelease packages on branch pushes (using [`pkg.pr.new`](https://github.com/stackblitz-labs/pkg.pr.new)):

- `https://pkg.pr.new/opennextjs/adapters-api/@opennextjs/aws@main`:
  Updated with every push to the `main` branch, this prerelease contains the most up to date yet (reasonably) stable version of the package.
- `https://pkg.pr.new/opennextjs/adapters-api/@opennextjs/aws@experimental`
  Updated with every push to the `experimental` branch, this prerelease contains the latest experimental version of the package (containing features that we want to test/experiment on before committing to).

The URLs include the `opennextjs/adapters-api` owner/repo prefix: the compact form
(`https://pkg.pr.new/@opennextjs/aws@main`) resolves through the npm `repository` field, which still
points at the previous repositories, so it would serve packages from the wrong repo.

Which you can simply install directly with your package manager of choice, for example:

```bash
npm i https://pkg.pr.new/opennextjs/adapters-api/@opennextjs/aws@main
```

## Contribute

To run `OpenNext` locally:

1. Clone this repository.
1. Build `open-next`:

   ```bash
   cd packages/open-next
   pnpm build
   ```

1. Run `open-next` in watch mode:

   ```bash
   pnpm dev
   ```

1. Now, you can make changes in `open-next` and build your Next.js app to test the changes.

   ```bash
   cd path/to/my/nextjs/app
   path/to/opennextjs-aws/packages/open-next/dist/index.js build
   ```

There is also a way to run OpenNext locally. You can read a guide about it [here](https://opennext.js.org/aws/contribute/local_run). Its mostly used for development/debugging purposes.

## Testing

Install Node.js 24 and pnpm 10, then install the workspace dependencies:

```bash
pnpm install --frozen-lockfile
```

### Unit tests

Run all unit tests, including the AWS and Cloudflare adapter tests, with:

```bash
pnpm test
```

To run only the Cloudflare adapter unit tests, use:

```bash
pnpm --filter @opennextjs/cloudflare test
```

### End-to-end tests

Before running the e2e tests for the first time, install Chromium:

```bash
pnpm exec playwright install chromium
```

#### AWS adapter

Build the AWS adapter and example applications, then start the local servers:

```bash
pnpm --filter @opennextjs/aws... run build
pnpm openbuild:local
pnpm openbuild:local:start
```

Keep the servers running and, in a different shell, run:

```bash
pnpm e2e:test
```

#### Cloudflare adapter

Build the Cloudflare adapter and example Workers, then run the Playwright tests in the Cloudflare Workers environment:

```bash
pnpm --filter @opennextjs/cloudflare run build
pnpm turbo build:worker:cf
CI=1 pnpm turbo e2e:cf
```

The final command starts and stops the required local Wrangler preview servers. Setting `CI=1` matches the CI workflow, where the Workers have already been built by the preceding command.

## Coldstart

OpenNext provide you with a warmer function that can be used to reduce cold start.

On Lambda, there are multiple scenarios where a lambda will trigger a cold start even if you have some warmed instance. For example if you have more requests than warm instances you'll get a cold start. Also NextJs lazy load the routes, so even if you hit a warm instance, this specific route might not have been loaded yet.

## Acknowledgements

We are grateful for the projects that inspired OpenNext and the amazing tools and libraries developed by the community:

- [nextjs-lambda](https://github.com/sladg/nextjs-lambda) by [Jan](https://github.com/sladg) for serving as inspiration for packaging Next.js's standalone output to Lambda.
- [CDK NextJS](https://github.com/jetbridge/cdk-nextjs/) by [JetBridge](https://github.com/jetbridge) for its contribution to the deployment architecture of a Next.js application on AWS.
- [serverless-http](https://github.com/dougmoscrop/serverless-http) by [Doug Moscrop](https://github.com/dougmoscrop) for developing an excellent library for transforming AWS Lambda events and responses.
- [serverless-nextjs](https://github.com/serverless-nextjs/serverless-next.js) by [Serverless Framework](https://github.com/serverless) for paving the way for serverless Next.js applications on AWS.

Special shoutout to [@khuezy](https://github.com/khuezy) and [@conico974](https://github.com/conico974) for their outstanding contributions to the project.

---

Maintained by [SST](https://sst.dev). Join our community: [Discord](https://discord.gg/opennextjs) | [YouTube](https://www.youtube.com/c/sst-dev) | [Twitter](https://twitter.com/SST_dev)
