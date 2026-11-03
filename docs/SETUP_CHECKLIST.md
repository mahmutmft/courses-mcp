# New repository setup checklist

- [ ] Replace placeholders in `docs/PROJECT_CONTEXT.md`
- [ ] Configure GitHub Projects board (Backlog / Todo / In Progress / Review / Done)
- [x] Create issue labels described in `AGENTS.md`
- [ ] Invite collaborators with least privileges needed
- [ ] Replace `CODEOWNERS` sample owner with a valid account/team
- [ ] Set up branch protection / ruleset where plan and repository visibility permit
- [x] Require real CI checks configured for this project's stack (workflow added; required-check enforcement still needs repository settings)
- [ ] Configure code-review tooling (Codex/GitHub integration) independently
- [ ] Enable Dependabot alerts where available
- [ ] Review Actions permissions and secret-handling policies
- [ ] Validate a test PR is blocked if a required check fails
