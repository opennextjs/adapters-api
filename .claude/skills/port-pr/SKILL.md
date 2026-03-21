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

### 7. Run Unit Tests

After code checks pass, run only the unit tests:

```bash
pnpm test
```

**Important:** Do NOT run `pnpm e2e:test` or any full test suite. Only unit tests should be run during the porting process.

### 8. Ask for Package

Before creating the changeset, determine which package the changes apply to:

Ask the user: **"Which package should this changeset be for - `@opennextjs/aws` or `@opennextjs/cloudflare`?"**

Store the answer in `$PACKAGE_NAME` (e.g., "@opennextjs/cloudflare").

### 9. Create Changeset

Create a patch changeset with the link to the PR:

```bash
# Extract PR number from the URL (e.g., "123" from "https://github.com/owner/repo/pull/123")
PR_NUMBER=$(echo "$ARGUMENTS" | grep -oE '[0-9]+$')

# Create the changeset file with the PR link (use the package name from step 7)
echo "---
\"$PACKAGE_NAME\": patch
---

Ported PR #$PR_NUMBER from source repository

$ARGUMENTS" > .changeset/port-pr-$PR_NUMBER.md
```

### 10. Stage Changes and Prepare Commit

Stage the changeset file and prepare a commit message (but do not commit):

```bash
# Stage the changeset file
git add .changeset/port-pr-$PR_NUMBER.md

# Prepare the commit message with the PR link (stored for later)
echo "chore: port PR #$PR_NUMBER from source repository

$ARGUMENTS

Changeset: .changeset/port-pr-$PR_NUMBER.md" > /tmp/commit-message-port-pr-$PR_NUMBER.txt

# Display the prepared commit message
cat /tmp/commit-message-port-pr-$PR_NUMBER.txt
```

The changeset is staged and ready to commit. The commit message is saved at `/tmp/commit-message-port-pr-$PR_NUMBER.txt` for reference.

### 11. Summary

Provide a summary of:

- What was ported
- Any adaptations made
- Files modified/created
- Any remaining TODOs or follow-up items
