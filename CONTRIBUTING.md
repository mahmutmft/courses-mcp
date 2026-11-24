# Contributing

Thank you for your interest in contributing to courses-mcp!

Contributions are welcome through GitHub issues and pull requests. You do not need collaborator write access to contribute; fork-based pull requests are supported.

## Before you start

1. Browse the [open issues](https://github.com/mahmutmft/courses-mcp/issues) and choose a task that interests you.
2. Read the issue description, acceptance criteria, existing discussion, and dependencies.
3. Comment on the issue explaining that you would like to work on it and briefly describe your intended approach.
4. Coordinate with the maintainer and other contributors before starting, especially when work may overlap.

You do not need to assign yourself to an issue or obtain repository write access. Wait for any necessary coordination before making overlapping changes.

Documentation contributions and offline fixture-based tests do not require Moodle credentials or access to private course materials.

## Development setup

### Prerequisites

- Node.js >=24
- npm

Check your installed versions:

```bash
node --version
npm --version
```

### Install dependencies

From the repository root, run:

```bash
npm ci
```

This installs the dependencies recorded in `package-lock.json`.

### Offline validation

Run these commands:

```bash
npm run check
npm test
```

- `npm run check` performs JavaScript syntax checks.
- `npm test` runs the offline test suite using Node's test runner.

These checks use local code and synthetic fixtures. They do not require Moodle credentials or live faculty access.

For documentation-only changes:

- Preview the Markdown and check headings, lists, and code blocks.
- Verify repository-relative links and issue links.
- Run:

```bash
git diff --check
```

Runtime checks do not need to be rerun locally solely for prose or link changes. Existing CI will run the repository's required checks. Verify that all required CI checks pass before requesting a merge.

## Fork and branch workflow

All external contributions should be submitted through a fork-based pull request.

### 1. Fork the repository

Open the [courses-mcp repository](https://github.com/mahmutmft/courses-mcp) and click **Fork**.

Create a fork under your GitHub account.

### 2. Clone your fork

Replace `<your-github-username>` with your GitHub username:

```bash
git clone https://github.com/<your-github-username>/courses-mcp.git
cd courses-mcp
```

### 3. Configure the remotes

Your fork should be configured as `origin`, and the original repository as `upstream`.

```bash
git remote add upstream https://github.com/mahmutmft/courses-mcp.git
git remote -v
```

If `upstream` is already configured, do not add it again.

The two remotes have different purposes:

- `origin` points to your fork. You push your contributions here.
- `upstream` points to the original `mahmutmft/courses-mcp` repository. You fetch the latest project changes from here.

### 4. Create a branch from the latest upstream master

The default branch is `master`, not `main`.

Fetch the latest changes:

```bash
git fetch upstream
```

Create a new working branch from the latest upstream master:

```bash
git switch -c docs/51-contributor-guide upstream/master
```

Use a descriptive branch name that includes the issue number. For example:

- `docs/51-contributor-guide`
- `feat/29-announcement-reader`
- `fix/42-quiz-metadata`

For an existing local branch, switch to it instead of creating it again. Make sure your work is based on the latest appropriate upstream changes.

### 5. Make a focused change

Keep each pull request limited to its agreed scope.

- Follow the repository's existing conventions.
- Avoid unrelated changes or unnecessary refactoring.
- Add or update tests when changing runtime behaviour.
- Never commit credentials, tokens, `.env` files, cookies, session data, or private course materials.

For documentation changes, preserve unrelated documentation and existing setup instructions.

### 6. Commit and push your changes

Use a descriptive commit message.

For example:

```bash
git add CONTRIBUTING.md
git commit -m "docs: clarify contributor workflow"
```

Push your branch to your fork:

```bash
git push -u origin docs/51-contributor-guide
```

Do not push directly to `upstream/master`.

### 7. Open a pull request

On GitHub, create a pull request with the following configuration:

- **Base repository:** `mahmutmft/courses-mcp`
- **Base branch:** `master`
- **Head repository:** your fork
- **Compare branch:** your contribution branch

Use the included pull request template.

In your PR description:

- Explain what the change does and why it is needed.
- Reference the related issue using `Refs #<issue-number>`.
- Describe which part of the issue your PR completes.
- List the validation checks you performed.
- Mention any checks that were not run.

Use `Closes #<issue-number>` or `Fixes #<issue-number>` only when the PR completes the entire issue. For partial contributions, use `Refs` so the issue remains open until all agreed work is complete.

### 8. CI, review and follow-up changes

Wait for all required CI checks to complete and pass. Do not treat skipped, missing, or failed checks as passing.

Maintainers may request changes or clarification during review. Read the feedback, make the requested updates, commit them to the same working branch, and push again:

```bash
git add CONTRIBUTING.md
git commit -m "docs: address contributor guide review"
git push
```

GitHub automatically updates the existing pull request when you push additional commits to its branch. You do not need to open another PR.

Follow the repository's review and branch protection requirements. A pull request is ready to merge only after the required checks and reviews are complete.

## Optional live Moodle setup

Live Moodle integration is separate from documentation work and offline fixture-based development.

Only contributors who need to verify live Moodle behaviour should follow the live setup instructions in the [README](README.md).

Live verification may require:

- Your own authorized Moodle credentials, kept locally in an ignored `.env` file.
- Browser installation using:

  ```bash
  npm run browser:install
  ```

- The optional live diagnostic:

  ```bash
  npm run doctor
  ```

These steps are not prerequisites for documentation contributions or synthetic offline tests.

Never commit credentials, tokens, session data, or private course information. Never share private faculty materials in issues, pull requests, commits, or test fixtures.

Thank you for helping improve courses-mcp!

## Contribution license

New contributions to this licensed repository are submitted under GNU GPL version 3
only (`GPL-3.0-only`), unless a separate agreement explicitly says otherwise.
Contribute only work you have the right to license on these terms and preserve
existing copyright and third-party license notices. You retain copyright in your
contributions; contributing does not transfer ownership to the maintainer.
See [LICENSE](LICENSE) and the [project licensing notice](LICENSE-NOTE.md).
This statement does not retroactively obtain permission for contributions made
before the repository adopted a license.
