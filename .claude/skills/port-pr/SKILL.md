---
name: port-pr
description: Port PRs from a GitHub repository. Use when you need to bring changes from a source repo. Invoke with /port-pr <github-pr-url>
argument-hint: <github-pr-url>
disable-model-invocation: true
---

# Port PR Skill

This skill enables porting PRs from a GitHub repository into this repository.

## Required Inputs

This skill receives arguments via `$ARGUMENTS`:

- `$ARGUMENTS`: GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)

## Workflow

### 1. Extract PR Information

```bash
gh pr view <url> --json mergeCommit,title,body,headRepository
git diff <mergeCommit>^..<mergeCommit>
```

Run these commands in the source repository using `workdir` parameter.

### 2. Analyze Changes

- Identify all files changed, added, and deleted
- Understand the purpose and scope of the change
- Note any dependencies or related changes

### 3. Map to Target Repository

- Find equivalent files in this repository
- Identify any structural differences between repos
- Note files that don't exist or have different paths

### 4. Ask for Guidance

Before implementing, ask the user for clarification when:

- A file doesn't exist in the target repo
- The code structure differs significantly between repos
- The feature/change may not apply to this repository
- There's ambiguity about how to adapt the changes

### 5. Implement Changes

Apply similar changes following this repository's conventions:

- Follow AGENTS.md guidelines (formatting, imports, naming)
- Maintain consistent code style with surrounding code
- Use explicit file extensions (`.js`) for local imports
- Use `node:` prefix for Node.js built-ins

### 6. Verification

After implementation, run:

```bash
pnpm code:checks
```

This runs formatting, linting, and TypeScript checks.

### 7. Summary

Provide a summary of:

- What was ported
- Any adaptations made
- Files modified/created
- Any remaining TODOs or follow-up items
