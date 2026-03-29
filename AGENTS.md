# AGENTS.md

Guidelines for AI coding agents working in this repository.

## Project Overview

This is a monorepo for OpenNext.js adapters, enabling Next.js deployment to various platforms (AWS Lambda, Cloudflare Workers, Node.js). The repository uses pnpm workspaces with multiple packages under `packages/` and example applications under `examples/` and `examples-cloudflare/`.

## Build/Lint/Test Commands

### Root-level commands (run from repository root)

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build only opennext packages
pnpm build:opennext

# Run linter
pnpm lint

# Fix linting issues
pnpm lint:fix

# Check formatting
pnpm fmt

# Fix formatting issues
pnpm fmt:fix

# TypeScript type checking (all packages)
pnpm ts:check

# Run all code checks (fmt + lint + ts:check)
pnpm code:checks

# Run all unit tests
pnpm test

# Run e2e tests
pnpm e2e:test
```

### Running single tests

```bash
# Run a specific test file in the cloudflare package
pnpm --filter @opennextjs/cloudflare vitest run path/to/test.spec.ts

# Run tests matching a pattern in the tests-unit package
pnpm --filter tests-unit vitest run --testNamePattern="test name pattern"

# Run a single test file with vitest directly
cd packages/tests-unit && pnpm vitest run tests/core/routing/matcher.test.ts

# Run tests in watch mode
pnpm --filter tests-unit vitest

# Run tests in a specific package
pnpm --filter @opennextjs/cloudflare test
```

### Package-specific commands

```bash
# Build a specific package
pnpm --filter @opennextjs/cloudflare build

# Type check a specific package
pnpm --filter @opennextjs/cloudflare ts:check
```

## Code Style Guidelines

### Imports

- Use explicit file extensions (`.js`) for local imports: `import { foo } from "./bar.js"`
- Use Node.js built-in imports with `node:` prefix: `import fs from "node:fs"`
- Group imports logically: built-ins first, then external packages, then local modules
- Use workspace protocol for internal packages: `"@opennextjs/aws": "workspace:*"`

### TypeScript

- TypeScript strict mode is enabled via `@tsconfig/strictest`
- Use explicit type annotations for function parameters and return types
- Prefer `type` for object types, `interface` for extensible types
- Use `import type` for type-only imports
- Avoid `any` - use `unknown` or specific types; if unavoidable, add `// oxlint-disable @typescript-eslint/no-explicit-any` comment
- Target ES2022 for compilation

### Formatting

- Tabs for indentation (check .editorconfig if present)
- Double quotes for strings
- Trailing commas in objects/arrays
- Semicolons are required

### Naming Conventions

- camelCase for variables and functions
- PascalCase for types, interfaces, and classes
- SCREAMING_SNAKE_CASE for constants
- kebab-case for file names: `my-component.ts`, `use-cache.ts`
- `.spec.ts` suffix for test files (unit tests use vitest)
- `.test.ts` suffix for test files in tests-unit package

### Error Handling

- Throw descriptive `Error` objects with context
- Use typed errors when specific error handling is needed
- Log errors with console.error/console.log for CLI commands
- Handle async errors with try/catch or .catch()

### File Organization

- Source code in `src/` directory
- Test files co-located with source (`.spec.ts`) or in separate tests directory (`.test.ts`)
- Export public API through `index.ts` files
- Use barrel exports: `export * from "./module.js"`
- Configuration files at package root

### Testing

- Use vitest for unit tests
- Use `describe`/`test`/`expect` from vitest
- Test file naming: `*.spec.ts` for co-located tests, `*.test.ts` for tests-unit package
- Mock external dependencies with `vi.mock()` and `vi.fn()`
- Run tests in Node.js environment (not jsdom) by default

### Comments and Documentation

- Use JSDoc comments for public APIs
- Document complex logic with inline comments
- Use `// TODO(username)` or `// TODO: description` for TODOs
- Keep comments concise and relevant

## Package Manager

This project uses **pnpm** exclusively. Do not use npm or yarn commands.

```bash
# Add a dependency to a specific package
pnpm --filter <package-name> add <dependency>

# Add a dev dependency
pnpm --filter <package-name> add -D <dependency>

# Run a script in a specific package
pnpm --filter <package-name> <script-name>
```

## Pre-commit Checks

Before committing, ensure:

1. `pnpm fmt:fix` - Code is properly formatted
2. `pnpm lint:fix` - No linting errors
3. `pnpm ts:check` - TypeScript compiles without errors
4. `pnpm test` - All tests pass

Run `pnpm code:checks` to verify all checks pass.
