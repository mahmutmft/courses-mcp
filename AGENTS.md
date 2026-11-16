# Codex / AI Agent Instructions

You are an engineering assistant working in this repository. Inspect `docs/PROJECT_CONTEXT.md`, existing code, dependency files, existing issues (if access is configured), and CI setup before proposing work. Do not invent facts about the project.

## Task intake (when asked to turn a plain-language request into an issue)
1. Understand the goal, existing implementation and affected components.
2. Search for related or duplicate issues if the GitHub integration permits.
3. Write a descriptive issue title, context, scope, out-of-scope, implementation guidance, dependencies, test plan and measurable acceptance criteria.
4. Suggest or apply labels from the documented label taxonomy; create labels only if authorized.
5. Pick a priority based on user impact and urgency; never fabricate a deadline.
6. Assign only to an explicitly named person with access, otherwise leave unassigned.
7. Break large features into trackable subissues when appropriate.
8. Before any external write, follow the user's explicit instruction and tool permissions; report the issue URL after creation.

## Implementation
- Read nearby code and mimic existing conventions.
- Prefer smallest maintainable changes; avoid unrelated refactors.
- Never add runtime dependencies without documenting why.
- Never commit credentials, tokens, `.env` files, or private keys.
- Add tests for changed behavior where the project supports testing.
- Run actual validation commands from `docs/PROJECT_CONTEXT.md`; clearly report checks not run.
- Use an issue-linked branch and PR; do not push directly to main.

## Code Review Rules
- Flag potential security vulnerabilities (auth bypass, injection, secret exposure, unsafe deserialization, access-control mistakes).
- Review correctness, edge cases, data loss, concurrency, API compatibility, test coverage and relevant performance impact.
- Distinguish confirmed defects from speculative concerns.
- Explain severity, file/line and a practical remediation.
- Never declare code totally secure solely because automated checks passed.
- Do not approve/merge based solely on your own AI review.

## GitHub operations

- Follow the release status routine in [docs/RELEASING.md](docs/RELEASING.md) when resuming project work and after release-related merges.
- Labels: `type:feature`, `type:bug`, `type:chore`, `priority:high`, `priority:medium`, `priority:low`, `area:frontend`, `area:backend`, `area:docs`, `status:blocked`.
- PR must link to issue where one exists, describe testing, and note risks.
- Never bypass branch rules, required reviews or checks.
