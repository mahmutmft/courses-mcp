# Product and release roadmap

## Direction

Make Moodle course material easy to find, understand, and organize through AI agents. Start with a dependable personal FINKI assistant; grow into a reusable Moodle integration as real usage demonstrates what is needed.

The long-term value is trustworthy access to course knowledge: complete discovery, useful retrieval, verifiable citations, fresh information, and clear permission boundaries. A release should improve an actual student workflow. More tools and infrastructure alone are not success.

This is a living plan, not a delivery-date commitment. The version names below are proposed targets, not published releases. Keep the project useful at every stage and revise later priorities from user feedback.

## Verified baseline

The package currently declares version 0.1.0. The initial implementation was merged in [PR #3](https://github.com/mahmutmft/courses-mcp/pull/3): local stdio MCP, faculty CAS login, enrolled-course listing, main-page browsing, and search of visible section/activity text. Live personal-account checks succeeded, but do not establish support for every course layout. No release tags were present when this roadmap was created.

Safer login diagnostics from [issue #4](https://github.com/mahmutmft/courses-mcp/issues/4) and [PR #5](https://github.com/mahmutmft/courses-mcp/pull/5) are also merged. Merged changes do not by themselves imply a tagged release.

Current limitations: separate section pages and folder contents are not fully traversed; file contents are not searched; no local search index, deadline tools, synchronization, dashboard, or multi-user service exists.

## Path to v1.0

| Target | Student outcome | Main work | Exit condition |
| --- | --- | --- | --- |
| v0.1.x — dependable foundation | Understand why login failed and how to recover | Login diagnostics, cleanup, no credential retries, setup troubleshooting | #4 reviewed/merged; timeout, network, rejection, challenge, and browser failures tested without secret leakage; valid live login still works |
| v0.2.0 — complete discovery | Find all supported resources in a selected semester | Explicit academic-year/semester filters; separate section pages; folders; normalized resource IDs; pagination, deduplication, and bounded responses | Fixture courses with multiple sections/folders return every expected accessible item once; partial/unsupported content is reported; source URLs preserved |
| v0.3.0 — readable documents | Ask an agent to read a lecture PDF and cite its pages | Controlled authenticated file retrieval; text-PDF extraction; MIME/size/time limits; page references; cache deletion | A text-PDF answer can be traced to the correct page; inaccessible/oversized/non-text files fail safely; no arbitrary URL fetch or unrestricted file writes |
| v0.4.0 — semester search | Find a topic across selected courses and documents | Account-scoped local index; Unicode-aware lexical ranking; snippets, course/resource/page citations; refresh/status tools | Reviewed queries retrieve expected evidence across courses; results disclose indexed scope and freshness; unrelated/inaccessible resources are excluded |
| v0.5.0 — coursework overview | See upcoming deadlines and relevant announcements | Read-only assignment metadata, calendar events and supported announcements; timezone-aware dates; explicit missing-data states | Fixture due dates/timezones are correct; no deadline is invented; unavailable sources are reported; access restrictions preserved |
| v0.6.0 — durable daily use | Update and inspect local knowledge without starting over | Incremental refresh; changed/deleted resource handling; resumable bounded jobs; opt-in cache outside the repo; safe diagnostics and resource limits | Interrupted refresh can resume; stale/deleted content is handled; logout/account switching cannot reuse another account's data; cache can be inspected and deleted |
| v1.0.0 — stable personal course assistant | Install, connect, find evidence, and plan coursework confidently | Stable tool contracts; client setup; compatibility fixtures; security review; release packaging; migration/recovery docs | All v1 gates below pass and a human reviews the release |

Dependencies: reliable login → discovery → document retrieval → indexing. Coursework metadata may progress independently after discovery. Do not begin broad indexing before course/resource identity and access checks are dependable.

## The v1.0 promise

A student can connect a supported local MCP client, select courses/semester, discover supported resources, search accessible course text and text PDFs, retrieve page-cited evidence, and inspect supported upcoming deadlines. Results expose source, scope, and freshness; unknown or unavailable data is explicit.

The server supplies retrieval and metadata. The connected AI client writes explanations and study suggestions from that evidence. An additional model API key is not a requirement for the core retrieval workflow.

v1 stays local and read-only. It excludes assignment submissions, forum posts, enrollment changes, grade changes, hosted credential storage, arbitrary web crawling, guaranteed OCR, and universal Moodle compatibility. Unsupported content must be identified rather than silently presented as fully indexed.

### Release gates

- Installation from a clean checkout works on Windows; every additional claimed OS/client has a recorded successful setup check. Document the supported versions and known limitations.
- Public MCP tool input/output/error contracts are documented and tested. Keep source IDs stable; bound response size, pagination, requests, file sizes, and job duration.
- A versioned synthetic reference corpus covers Macedonian/English text, text PDFs, folders, separate sections, inaccessible resources, changed/deleted files, and malformed inputs. No private faculty material is committed.
- A reviewed benchmark includes at least 30 realistic retrieval queries. At least 90% of answerable queries place the expected evidence in the top five results; every result has a valid source reference. Unanswerable queries return an explicit no-result/partial-scope response. These are release targets, not achieved scores.
- Access-denied and account-switching tests prevent cross-course/account leakage. Test prompt-injection content as untrusted data. Keep diagnostics free of passwords, cookies, service tickets, and private document text.
- All required CI checks pass. Investigate high/critical dependency findings before release; document any justified exception. Review authentication, file handling, cache isolation, and client output independently of the implementation author.
- Run a small opt-in live compatibility check and record only non-sensitive results. Never deliberately send wrong credentials to production services for tests.
- Prepare a changelog, exact version/tag, installation instructions, and recovery steps. Fix the currently duplicated package/server version source before publishing. No release is automatic merely because a milestone or PR closes.

## After v1.0

These are candidate increments. Reorder them from actual usage; they are not promises of simultaneous delivery.

| Target | Direction | Evidence required before calling it ready |
| --- | --- | --- |
| v1.1 | Study workflows: topic outlines, revision plans, flashcard/evidence export | Every generated item links back to course evidence; generated suggestions are clearly separated from faculty instructions |
| v1.2 | Better retrieval: hybrid/semantic search, tables, optional OCR for scanned pages | Improve the same retrieval benchmark over lexical search; disclose OCR uncertainty and processing cost; keep optional providers opt-in |
| v1.3 | Opt-in change monitoring: new material and changed deadlines | Bounded polling, explicit monitoring preferences, meaningful-change notifications only, and verifiable last-sync state; no silent calendar writes |
| v1.4+ | Easier operation: optional local dashboard, index health, exports, accessibility | The interface improves observed setup/maintenance problems while the MCP works independently; a dashboard does not require a cloud service |
| v2.0 candidate | Reusable Moodle platform with explicit institution/auth adapters | At least two independently validated Moodle installations, documented adapter contracts and permission differences; only use 2.0 if the public contract actually breaks |
| v3.0 candidate | Optional self-hosted service for multiple users or institutions | A real user need, approved authentication approach, per-user data isolation, quotas, deletion/retention, secure credential handling, operational ownership and independent review; only use 3.0 for an actual breaking contract |

Other possible long-term tracks: DOCX/PPTX extraction, accessible document views, personal notes linked to citations, local offline study packs where permitted, multilingual retrieval, and contributor-maintained adapters. Each needs its own bounded issue, evaluation, and maintenance owner. Collaboration must never share another student's restricted course content.

## Architecture evolution

Keep the current simple local process until a capability needs a new boundary. Separate authentication/session management, Moodle navigation/API adapters, normalized course/resource models, document extraction, indexing/retrieval, and MCP tool presentation as they grow. Define small tested interfaces rather than splitting everything into services.

Use a local database/index only when persistence is introduced, with account/institution namespaces, schema migrations, and user-controlled deletion. Recheck authorization before serving cached material; do not treat a previous download as permanent access. Prefer stable supported Moodle APIs where available and document browser fallback limits. Evaluate semantic search against a lexical baseline before adding model/vector infrastructure.

Multi-user hosting is a separate design decision, not a switch that exposes a personal .env-based browser session over HTTP. Keep the local deployment fully supported even if a hosted option is later added.

## Next issue queue

Linked entries refer to tracked work; unlinked entries are proposed issues. Split proposed work into implementation-sized issues with acceptance criteria when its release becomes active.

| Order | Proposed issue | Target / dependency | Acceptance focus |
| --- | --- | --- | --- |
| 1 | Login diagnostics (#4 / PR #5) — merged | v0.1.x | Five required CI checks, review findings resolved, live positive check |
| 2 | [Add explicit academic-year and semester course filters (#8)](https://github.com/mahmutmft/courses-mcp/issues/8) | v0.2 | Parse supported naming variants; allow explicit selection; never silently infer enrollment from date alone |
| 3 | [Normalize resources and traverse separate course sections (#12)](https://github.com/mahmutmft/courses-mcp/issues/12) | v0.2 | Stable IDs, no duplicates, bounded pagination/traversal, clear partial results |
| 4 | Browse folders and report inaccessible/unsupported activities | v0.2; resource model | Expected nested items found; no cross-origin fetch; access failures remain visible |
| 5 | Add controlled resource retrieval with size/type limits | v0.3; discovery | Enrollment/access recheck; validated redirects, MIME, limits, cancellation, cache policy |
| 6 | Extract text PDFs with page references | v0.3; retrieval | Synthetic PDF fixtures; page-correct citations; explicit scanned/encrypted/unsupported cases |
| 7 | Define local cache/index isolation and lifecycle | v0.4; retrieval | Account namespaces, deletion, freshness, permission rechecks, no tracked private content |
| 8 | Add cross-course lexical search and retrieval benchmark | v0.4; extraction/index | Ranked bounded snippets with source/page references; repeatable quality measurement |
| 9 | List supported upcoming deadlines with timezone handling | v0.5; metadata inspection | Correct dates, source links, missing-data handling; read-only |
| 10 | Establish release/version/changelog workflow | Before first tagged release | One version source, reproducible install, reviewed release notes and exact tag; no automatic publication |

## Versioning and sustained maintenance

Use PATCH for compatible fixes, MINOR for compatible capabilities, and MAJOR for intentional breaking public contracts. During 0.x, explicitly document breaking changes and migration steps. A large feature that preserves compatibility can remain 1.x; do not force a major release just to follow this table.

Work through issue → branch → focused PR → required checks → independent/human review → merge. Group accepted issues into GitHub milestones when starting a release. Keep one primary feature milestone active, while urgent fixes can ship separately. Update this roadmap and changelog as decisions change.

For every feature release, reserve capacity for regression fixes, dependency updates, security, documentation, and compatibility fixtures. Track setup success, login failure categories, discovery completeness, retrieval quality, freshness, and latency through synthetic/local measurements; do not collect private-content telemetry by default. Record baselines before claiming improvement.

At each milestone, review what users actually used, what failed, what now costs too much to maintain, and what should be removed or redesigned. An enduring project needs a bounded reliable core and a growing tested ecosystem, not an ever-growing unfinished v1.
