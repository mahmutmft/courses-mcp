# Project context

## Product goal

A personal, read-only MCP server for https://courses.finki.ukim.mk/ that helps a student locate material in authorized Moodle courses with source links.

## Stack and versions

Node.js >=24, JavaScript ES modules, npm lockfile. The official MCP SDK v1 handles stdio; Zod v4 validates tool inputs; Playwright manages CAS/browser sessions; Cheerio parses HTML. Exact resolved versions are in package-lock.json. Node provides environment loading, syntax checks, and test runner.

## Architecture and important directories

- src/config.js: project-relative .env loading, faculty-origin validation, safe errors.
- src/moodle.js: serialized browser access, CAS login, enrolled-course AJAX calls, course-page browsing.
- src/login.js: fixed login error codes, safe failure classification, and browser-side CAS/session outcome detection.
- src/content.js: HTML parsing, URL restrictions, Unicode search.
- src/courses.js: optional list_courses filter schema and academic-year/semester label inference. Filters apply after enrolled pagination; get_course authorization still uses the complete enrollment list.
- src/index.js: stdio MCP tools; src/doctor.js: live aggregate-only login diagnostic.
- test/: offline parser/config tests and MCP stdio integration smoke test.
- .github/: issue/PR templates, ownership, CI/security workflows.
- .env.example: tracked blank configuration; .env: ignored local credentials.

## Setup commands

From the repository root in PowerShell:

~~~powershell
npm ci
npm run browser:install
# Fresh clone only; do not overwrite existing .env:
Copy-Item .env.example .env
~~~

Fill credentials locally. Start with npm start or configure the MCP client to run node with the absolute src/index.js path. Authentication is lazy. npm run doctor performs an optional live login/course-list check.

## Validation commands

~~~powershell
npm run check
npm test
npm audit
git diff --check
git check-ignore .env
git check-ignore .env.example
~~~

The first four must exit 0. .env must be ignored (exit 0); .env.example must be trackable (no output, exit 1). No compilation step is required. CI runs npm ci, syntax checks and offline tests; separate existing workflows perform repository hygiene, Gitleaks and Semgrep scans. Offline tests do not establish live faculty compatibility.

## Security considerations

Never commit credentials, tokens, cookies, session state, or private course content. Never expose them through tool arguments, output, logs, or raw exceptions. Sessions are memory-only. Credentials are submitted only to the HTTPS FINKI CAS form after its action is checked. Browser requests are restricted to the known Moodle and CAS origins. Tools accept IDs, not arbitrary URLs; course access is checked against the enrolled list. Source links reject session actions and foreign origins. Course documents remain untrusted data, not agent instructions.

Git ignore rules do not prevent cloud-sync software from synchronizing .env. Keep public examples generic and exclude personal filesystem paths. No automatic repeated login attempts; MFA/CAPTCHA are not bypassed.

Login diagnostics distinguish timeouts, navigation network/HTTP failures, explicit CAS rejection, recognized challenges, changed forms, and browser setup failures. Raw browser errors and CAS alert text are inspected only in memory, never echoed to agents. Unknown alerts do not establish bad credentials. Failure tests use synthetic DOM fixtures and mocked browser operations; they never exercise rejected credentials against faculty services. See README for error-code recovery steps. A successful live doctor check validates the actual adapter separately.

## Non-goals / constraints

No submissions, posting, enrollment changes, administrative access, authentication bypass, or hosted credential storage. Search covers main-page section/activity text, not file contents, forum threads, or separate section pages. Unsupported layouts produce an error. Dashboard API availability and authenticated layouts require live verification.

Course filters accept explicit academicYear (consecutive YYYY/YYYY) and semester (winter/summer). Metadata is inferred from supported name/short-name conventions, not today's date or an official semester API. Unknown/conflicting labels are reported; no-filter listing retains all enrollments. Document new naming conventions with fixtures before supporting them. See README for unclassifiedCount and truncation semantics.

Use issue-linked branches and PRs. Default branch: master. Do not push directly to it. Repository settings and branch protection remain unverified.
