# Independent v1 security review handoff

Status: **prepared for review; no independent review or security verdict recorded**.
Tracks [#48](https://github.com/mahmutmft/courses-mcp/issues/48). Preparation by the
implementation assistant does not satisfy reviewer independence or close the gate.

## Scope baseline

- Source to inspect: `6d2b2b8238399756bc49dd67058b32018060c6d4` (2026-11-26).
- Package: 0.1.0, pre-v1; no release/tag was published by this preparation.
- Reviewed inventory: 29 tools in [tool-contracts.json](../test/fixtures/tool-contracts.json).
- Prerequisites #38, #41 and #44 are closed. Scope includes saved schedules,
  refresh jobs and the ICS exporter merged after the original review issue opened.
- A later implementation change requires a recorded review delta; this baseline
  is not automatically the eventual release candidate.

The reviewer must be independent of the implementation author. Record a reviewer
identity/handle, independence statement, exact inspected SHA, environment, methods,
results and residual risks. Another implementation self-check or green CI alone is
not independent approval. No reviewer is assigned by this document.

## Preparation checks, not reviewer approval

On 2026-11-26 the implementation assistant ran syntax checks, the full offline
suite (277 passed, one Windows symlink test skipped for OS privilege), demo drift
checks and the 31-case synthetic retrieval benchmark. Full and production-only
npm audits reported zero vulnerabilities. Documentation was rendered and local
links/inventory references checked. No faculty requests or private data were used.
These results help reproduce the baseline; the independent reviewer must record
their own inspected scope, results and verdict below.

## Safe starting procedure

Use a separate checkout/fork at the scoped revision and Node.js 24+. Do not copy a
student's .env, browser session, cookies, private cache or course files. Offline
fixtures need no faculty account. Do not run doctor or live tools for this review
without separate authorization; no production stress/destructive testing is needed.

```powershell
git rev-parse HEAD
node --version
npm --version
npm ci
npm run check
npm test
npm run demo:check
npm run benchmark:retrieval
npm audit
npm audit --omit=dev
git diff --check
```

Inspect the source as well as executing commands. Record failures/skips and the
audit date; zero reported dependency vulnerabilities is not a security verdict.
The independent ical.js parser is a devDependency; production dependency auditing
does not replace the full audit or review of test/build tooling.

## Review matrix

The listed tests are starting evidence, not proof that the boundary is complete.

| Boundary | Source | Questions and starting tests |
| --- | --- | --- |
| CAS, credentials and session lifetime | [moodle.js](../src/moodle.js), [login.js](../src/login.js), [config.js](../src/config.js) | Verify allowed login origins/form actions, no repeated credential submission, challenge handling, in-memory session cleanup and safe errors. Inspect account-change/restart assumptions rather than trusting a cache namespace as identity proof. [login.test.js](../test/login.test.js), [moodle.test.js](../test/moodle.test.js) |
| Enrollment/module ownership and redirects | [sections.js](../src/sections.js), [resources.js](../src/resources.js), [pdf-resource.js](../src/pdf-resource.js), [folders.js](../src/folders.js) | Trace current access checks for every tool, including after multi-step reads. Try synthetic foreign-origin/action redirects, wrong course/module identity, stale discovered links and revoked access. [sections](../test/sections.test.js), [resources](../test/resources.test.js), [folders](../test/folders.test.js) tests |
| Private file boundaries | [preferences.js](../src/preferences.js), [lab-terms.js](../src/lab-terms.js), [course-cache.js](../src/course-cache.js) | Inspect root/account/path derivation, account isolation, schema/size limits, symlink/junction behavior, check/use races, file modes and actual Windows ACL assumptions. Verify malformed-file cleanup, locks and interrupted writers. [preferences](../test/preferences.test.js), [lab terms](../test/lab-terms.test.js), [cache](../test/course-cache.test.js) tests |
| Durable evidence and refresh | [saved-lab-schedules.js](../src/saved-lab-schedules.js), [refresh-jobs.js](../src/refresh-jobs.js), [moodle.js](../src/moodle.js) | Review every read/write/inspect/delete access path, TTL/future-clock handling, changed settings, final revocation and snapshots replaced mid-request. [saved schedules](../test/saved-lab-schedules.test.js), [refresh jobs](../test/refresh-jobs.test.js), [indexes](../test/course-index.test.js) tests |
| Untrusted text, privacy and model boundary | [server.js](../src/server.js), [content.js](../src/content.js), [forums.js](../src/forums.js), [assignments.js](../src/assignments.js) | Verify source content cannot select actions or grant permission for local writes. Inspect exclusions for forms, profiles, grades, attempts and attachments; errors must not reflect raw secrets. Returned content reaches the configured model provider. [trust evidence](../test/trust-evidence.test.js), [student workflows](../test/student-workflows.test.js), [forums](../test/forums.test.js), [assignments](../test/assignments.test.js) tests |
| Resource/cancellation bounds | [PDF worker](../src/pdf-worker.js), [pdf.js](../src/pdf.js), [tool-results.js](../src/tool-results.js), [moodle.js](../src/moodle.js) | Review time/page/byte/output/queue limits, cancellation, failed-operation recovery and response disposal. Understand buffering/native-memory limits. [PDF](../test/pdf.test.js), [output limits](../test/tool-results.test.js), [protocol](../test/protocol.test.js), [Moodle queue](../test/moodle.test.js) tests |
| Calendar export | [lab-calendar.js](../src/lab-calendar.js), [lab-ics.js](../src/lab-ics.js) | Trace reviewed-ID selection through fresh authorization, unknown/conflict exclusions, URL/TEXT injection, UTC/DST handling, output bounds and no filesystem/calendar writes. [calendar](../test/lab-calendar.test.js), [ICS](../test/lab-ics.test.js) tests and independent parser checks |
| Supply chain and CI | [package-lock.json](../package-lock.json), [workflows](../.github/workflows/ci.yml), [secret scan](../.github/workflows/security.yml), [static analysis](../.github/workflows/semgrep.yml) | Inspect runtime/dev dependencies and install scripts, workflow permissions/triggers, external action references and what scanners actually cover. Investigate material findings; do not equate absent findings with complete coverage. |

Seven tools are explicitly annotated local writes: set_lab_preference,
set_lab_term_preference, save_lab_schedule, clear_saved_lab_schedule,
clear_course_cache, start_course_refresh and advance_course_refresh. Inspect the
actual behavior of every tool too: opted-in search can update/invalidate its local
index during a read-oriented workflow. An annotation is a hint, not an enforcement
or permission boundary. New tools must be included in the review delta.

## Limits and unresolved release evidence

- Playwright may buffer a response before the documented byte checks. PDF worker
  V8 heap limits do not cap all native/external memory and are not an OS sandbox.
  See [reader budgets](READER_BUDGETS.md) and [limits audit](LIMITS_AUDIT.md).
- Local app-data storage is not encrypted. Verify platform permissions, concurrent
  local-user threat assumptions, retention/deletion and backup/cloud-sync risks.
  Git ignore does not prevent synchronizing .env. See [cache lifecycle](COURSE_CACHE.md).
- Untrusted-content guidance cannot guarantee how an external assistant behaves.
  Neither passing parser tests nor authored demo answers establish model robustness.
  See [evidence/privacy](TRUST_AND_PRIVACY.md).
- Live authentication/workflow verification remains separate under #90/#125;
  the latest recorded quiz check stopped at LOGIN_TIMEOUT before reading courses.
  Cold Chromium setup and final GUI/candidate checks remain under #124. These
  are outstanding compatibility observations, not established vulnerabilities.
- No private disclosure endpoint has been verified by this preparation. Confirm a
  working private reporting channel with the maintainer before exchanging sensitive
  findings. Do not publish an exploit or private data just because no channel is set.

This list is a set of review questions/known limits, not a claim that a particular
race, account switch or exploit has been demonstrated. Distinguish confirmed defects
from untested hypotheses and decide whether residual risks block the scoped release.

## Reviewer outcome record

Complete this only after the independent work; do not pre-check approval boxes.

```text
Reviewer identity/handle:
Independence from the scoped implementation:
Inspected commit SHA and any delta:
OS / Node / client versions:
Source areas inspected; exclusions:
Commands/tests run, results and skips:
Dependency audit date and findings/disposition:
Confirmed findings: severity, affected path/line, safe reproduction, remediation issue
Untested hypotheses and residual risks:
Verdict: incomplete / changes required / review completed with stated limits
Release-blocking findings resolved or explicitly addressed by the maintainer:
Review evidence link and date:
```

Record public summaries only with synthetic reproduction data. Keep sensitive
details in the verified private channel. Focused remediation PRs need regression
tests and review; refresh this record when the implementation changes. Leave #48
open until reviewer evidence and disposition of material risks actually satisfy
its acceptance criteria. Final version/tag approval remains the separate
[release procedure](RELEASING.md).
