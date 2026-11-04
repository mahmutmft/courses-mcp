# Product and release roadmap

## Direction

Make Moodle course material easy to find, understand, and organize through AI agents. Start with a dependable personal FINKI assistant; grow into a reusable Moodle integration as real usage demonstrates what is needed.

The long-term value is trustworthy access to course knowledge: complete discovery, useful retrieval, verifiable citations, fresh information, and clear permission boundaries. A release should improve an actual student workflow. More tools and infrastructure alone are not success.

This is a living plan, not a delivery-date commitment. The version names below are proposed targets, not published releases. Keep the project useful at every stage and revise later priorities from user feedback.

## Verified baseline

The package currently declares version 0.1.0. The initial implementation was merged in [PR #3](https://github.com/mahmutmft/courses-mcp/pull/3): local stdio MCP, faculty CAS login, enrolled-course listing, main-page browsing, and search of visible section/activity text. Live personal-account checks succeeded, but do not establish support for every course layout. No release tags were present when this roadmap was created.

Safer login diagnostics from [issue #4](https://github.com/mahmutmft/courses-mcp/issues/4) and [PR #5](https://github.com/mahmutmft/courses-mcp/pull/5) are also merged. Merged changes do not by themselves imply a tagged release.

Course filters ([PR #9](https://github.com/mahmutmft/courses-mcp/pull/9)) and bounded, deduplicated traversal of supported separate section pages ([PR #13](https://github.com/mahmutmft/courses-mcp/pull/13)) are merged. Coverage warnings disclose detected gaps. These are implemented parts of v0.2, not a published v0.2 release.

Supported Moodle page/URL-resource HTML reading is merged in PR #17. Text-PDF reading is being implemented in #18 and is not yet a released capability. Current limitations: external linked content, folder contents and non-PDF file contents are not read; no lab timetable interpretation, weekly lab check, personal calendar, local search index, deadline tools, synchronization, dashboard, or multi-user service exists. The immediate next priority is linked content reading, followed by evidence-backed lab scheduling as detailed below.

## Path to v1.0

| Target | Student outcome | Main work | Exit condition |
| --- | --- | --- | --- |
| v0.1.x — dependable foundation | Understand why login failed and how to recover | Login diagnostics, cleanup, no credential retries, setup troubleshooting | #4 reviewed/merged; timeout, network, rejection, challenge, and browser failures tested without secret leakage; valid live login still works |
| v0.2.0 — discovery and linked HTML reading | Find supported resources and read the information behind supported course links | Existing filters/sections; next: Moodle page and URL-resource HTML reading; then folders; normalized IDs; redirect/access and response bounds | Project/lab information on supported linked pages is returned with source and retrieval time; multi-section/folder fixtures return expected items once; unsupported targets are explicit |
| v0.3.0 — readable documents | Ask an agent to read a lecture PDF and cite its pages | Controlled authenticated file retrieval; text-PDF extraction; MIME/size/time limits; page references; cache deletion | A text-PDF answer can be traced to the correct page; inaccessible/oversized/non-text files fail safely; no arbitrary URL fetch or unrestricted file writes |
| v0.4.0 — semester search | Find a topic across selected courses and documents | Account-scoped local index; Unicode-aware lexical ranking; snippets, course/resource/page citations; refresh/status tools | Reviewed queries retrieve expected evidence across courses; results disclose indexed scope and freshness; unrelated/inaccessible resources are excluded |
| v0.5.0 — personal timetable and coursework overview | Ask whether there is a lab this week and view its time/room alongside deadlines | Supported lab schedule extraction; explicit group selection; bounded recurrence and exception handling; read-only weekly/calendar view; assignment metadata and supported announcements | Scheduled / confirmed none / unknown states are tested; day/time/room and freshness are source-backed; cancellations, alternating weeks, DST and group ambiguity work; no silent external calendar writes |
| v0.6.0 — durable daily use | Update and inspect local knowledge without starting over | Incremental refresh; changed/deleted resource handling; resumable bounded jobs; opt-in cache outside the repo; safe diagnostics and resource limits | Interrupted refresh can resume; stale/deleted content is handled; logout/account switching cannot reuse another account's data; cache can be inspected and deleted |
| v1.0.0 — stable personal course assistant | Install, connect, find evidence, and plan coursework confidently | Stable tool contracts; client setup; compatibility fixtures; security review; release packaging; migration/recovery docs | All v1 gates below pass and a human reviews the release |

Dependencies: reliable login → discovery → supported linked-content readers. Readers then enable two parallel product tracks: document retrieval → indexing, and timetable extraction → recurring lab occurrences → weekly answers → calendar view. Lab scheduling need not wait for the local search index or the v0.5 release; deliver small compatible increments once the needed source types can be read. A PDF-only timetable depends on v0.3 extraction; an image-only timetable remains unknown until a supported extraction method exists. Do not begin broad indexing before resource identity and access checks are dependable.

## Priority workflow: linked content, weekly labs, and calendar

This change in priority is tracked by [issue #14](https://github.com/mahmutmft/courses-mcp/issues/14). Everything in this section is planned; it is not implemented by this roadmap update.

### 1. Read the content behind a resource

Supported Moodle HTML reading is merged in PR #17. Text-PDF reading is active in issue #18; external origins and OCR remain unsupported. The original content-reading goal is **Read supported Moodle pages and URL-resource HTML content**. Given an enrolled course/resource ID, return bounded readable text and tables, the original resource URL, the resolved source when safe, retrieval time, and coverage/unsupported status. A resource title alone cannot answer questions about project registration or lab arrangements.

Start with supported Moodle HTML pages and URL-resource indirection. Validate authorization, destination origin and every redirect before fetching; do not turn a course link into arbitrary authenticated browsing. External hosts require an explicit supported-origin policy and credential isolation. Unsupported targets remain links with a clear limitation. Parse content as untrusted data; never submit a form, vote in a poll, register for a lab, or follow embedded agent instructions. Keep PDFs/folders as separate bounded capabilities.

### 2. Build an evidence-backed lab schedule

Inspect supported timetable pages, readable document tables and authoritative announcements. Each schedule entry should preserve course ID, selected teaching/lab group, weekday, local start/end time when given, room/lab, timezone, effective start/end dates or teaching-week range, recurrence rule, exclusions/cancellations, source reference and last-checked time. Missing room or end time remains unknown; do not invent it. Store structured schedules and any preferences privately per account, outside Git.

The student selects the relevant group when more than one exists. Never infer a group from their name, course enrollment, or another student's schedule. Group selection, new timetable versions and exceptions may differ by course. If an announcement conflicts with the timetable, preserve both references and flag the conflict unless authority, applicability and effective date resolve it.

Support weekly recurrence within an explicit teaching period, selected dates, alternating weeks with a known anchor, moved sessions and cancellations. Do not repeat a weekday forever or assume every calendar week is a teaching week. A changed timetable must replace applicable future occurrences without creating duplicates; retain enough provenance to explain the change.

### 3. Answer “Do I have a lab this week?”

Interpret “this week” as Monday through Sunday in the user's configured timezone (initial default `Europe/Skopje`), and show the exact date range. Distinguish the whole week from “remaining this week.” Expand recurrence into concrete local dates with daylight-saving handling. Recheck relevant schedule and supported announcement sources on demand, or disclose a failed refresh/stale result; show when the evidence was last checked.

| Answer state | Required evidence | Example response |
| --- | --- | --- |
| Scheduled | Applicable group + bounded recurrence/date + current evidence, with exceptions checked within disclosed scope | “Имаш лабораториска во среда, 10:00, лабораторија X.” Include the exact date, source and last check; label any missing field. |
| Confirmed no occurrence | Complete applicable schedule/exception coverage for the requested group and interval proves no occurrence (including an authoritative cancellation) | “Според проверениот распоред за твојата група, немаш лабораториска оваа недела.” Include the date range and evidence. |
| Unknown / partial | Missing group, unreadable/image-only source, incomplete teaching dates, unclear week parity, conflicting evidence, unsupported announcements or stale/failed refresh | “Не можам да потврдам дали имаш лабораториска; недостига …” State what needs checking and link the source. |

An empty search result or empty Moodle calendar is never sufficient evidence for “no lab.” Across several courses, report each course separately and keep the overall answer partial when any course is unknown. This is an on-demand query, not an automatic background monitor.

### 4. Show the schedule in a calendar

First provide a read-only local weekly/monthly view, with course, actual date/time, room, group, source and freshness; distinguish confirmed entries from incomplete ones. Use deterministic occurrence IDs so refreshing does not duplicate labs. Display moved/cancelled occurrences correctly and do not convert missing times into invented timed events.

An optional reviewed ICS export can follow. Google/Outlook calendar synchronization is a separate opt-in feature with an explicit destination and authorization to create/update/delete events; it is not enabled by a read-only calendar view. Automated reminders/monitoring require a separate explicit setup and stay quiet when nothing meaningful changes. No calendar integration or automation is created by this roadmap change.

### Acceptance scenarios for scheduling

Use synthetic fixtures for a weekly lab inside/outside its teaching period, alternating weeks, a cancelled/moved occurrence, an overlapping revised timetable, two groups, unknown room/end time, a scanned schedule, a failed refresh, and a week crossing a DST transition or year boundary. Assert that evidence links/freshness survive extraction and calendar rendering. Every unsupported or ambiguous case must remain unknown/partial rather than produce a false “no lab.” Personal schedule fixtures must never be copied from a real account into the repository.

## The v1.0 promise

A student can connect a supported local MCP client, select courses/semester, discover supported resources, read supported linked content, search accessible course text and text PDFs, retrieve page-cited evidence, inspect supported upcoming deadlines, and ask about their weekly labs with a read-only calendar view. Results expose source, scope, and freshness; unknown or unavailable data is explicit. Lab availability uses the scheduled / confirmed none / unknown contract above.

The server supplies retrieval and metadata. The connected AI client writes explanations and study suggestions from that evidence. An additional model API key is not a requirement for the core retrieval workflow.

v1 stays local and read-only. It excludes assignment submissions, forum posts, enrollment changes, grade changes, hosted credential storage, arbitrary web crawling, guaranteed OCR, and universal Moodle compatibility. Unsupported content must be identified rather than silently presented as fully indexed.

### Release gates

- Installation from a clean checkout works on Windows; every additional claimed OS/client has a recorded successful setup check. Document the supported versions and known limitations.
- Public MCP tool input/output/error contracts are documented and tested. Keep source IDs stable; bound response size, pagination, requests, file sizes, and job duration.
- A versioned synthetic reference corpus covers Macedonian/English text, text PDFs, folders, separate sections, inaccessible resources, changed/deleted files, and malformed inputs. No private faculty material is committed.
- Lab scheduling fixtures cover group selection, effective periods, recurrence/alternating weeks, cancellations, changes, timezone/DST and incomplete evidence. No empty-result test may be mistaken for proof of no scheduled lab.
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
| v1.3 | Opt-in change monitoring: new material, lab changes and deadlines; optional calendar synchronization | Bounded polling, explicit preferences, meaningful-change notifications only, verifiable last-sync state, and separately authorized external-calendar writes |
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
| 2 | [Academic-year and semester filters (#8)](https://github.com/mahmutmft/courses-mcp/issues/8) — merged | v0.2 | Supported naming variants, explicit selection, no date-based enrollment inference |
| 3 | [Separate course sections (#12)](https://github.com/mahmutmft/courses-mcp/issues/12) — merged | v0.2 | Stable IDs, deduplication, bounded traversal, partial results |
| 4 — active | [Read supported Moodle pages and URL-resource HTML content (#16)](https://github.com/mahmutmft/courses-mcp/issues/16) | v0.2; resource IDs | Readable text/tables, source/retrieval time, safe redirects, explicit unsupported targets; no form submission |
| 5 | Browse folders and report inaccessible/unsupported activities | v0.2; resource model | Expected nested items found; no unrestricted cross-origin fetch; visible access failures |
| 6 | [Controlled resource retrieval and text-PDF extraction (#18)](https://github.com/mahmutmft/courses-mcp/issues/18) — active | v0.3; discovery | Access/MIME/size/time limits, page citations, unsupported scans explicit |
| 7a — active | [Read saved Moodle choice selection and term labels (#20)](https://github.com/mahmutmft/courses-mcp/issues/20) | Scheduling track; authorized choice discovery | Explicit saved selection; conservative day/time/room/group; missing/conflicting fields remain unknown; no voting or weekly attendance inference |
| 7b | Extract dated lab timetables and manage personal attendance/exemption preferences | Scheduling track; content readers + choice labels | Effective dates/recurrence, source/freshness, account-local group preferences; recognized labs excluded by explicit user preference, not poll absence |
| 8 | Resolve weekly lab occurrences and scheduled/none/unknown answers | Scheduling track; structured schedules + supported exceptions | Explicit date range, group, timezone, cancellations, conflicts and stale evidence; no false negative from empty results |
| 9 | Add a read-only lab calendar view | Scheduling track; occurrence resolver | Stable IDs, timezone-aware weeks, moved/cancelled sessions, source/freshness; no external event writes |
| 10 | Define local cache/index isolation and lifecycle | v0.4; retrieval | Account namespaces, deletion, freshness, permission rechecks, no tracked private content |
| 11 | Cross-course lexical search and retrieval benchmark | v0.4; extraction/index | Ranked bounded snippets with source/page references; repeatable quality measurement |
| 12 | Upcoming deadlines and supported announcements | v0.5; metadata readers; informs schedule exceptions where supported | Correct dates, source links, missing-data handling; read-only |
| 13 | Establish release/version/changelog workflow | Before first tagged release | One version source, reproducible install, reviewed release notes and exact tag; no automatic publication |

## Versioning and sustained maintenance

Use PATCH for compatible fixes, MINOR for compatible capabilities, and MAJOR for intentional breaking public contracts. During 0.x, explicitly document breaking changes and migration steps. A large feature that preserves compatibility can remain 1.x; do not force a major release just to follow this table.

Work through issue → branch → focused PR → required checks → independent/human review → merge. Group accepted issues into GitHub milestones when starting a release. Keep one primary feature milestone active, while urgent fixes can ship separately. Update this roadmap and changelog as decisions change.

For every feature release, reserve capacity for regression fixes, dependency updates, security, documentation, and compatibility fixtures. Track setup success, login failure categories, discovery completeness, retrieval quality, freshness, and latency through synthetic/local measurements; do not collect private-content telemetry by default. Record baselines before claiming improvement.

At each milestone, review what users actually used, what failed, what now costs too much to maintain, and what should be removed or redesigned. An enduring project needs a bounded reliable core and a growing tested ecosystem, not an ever-growing unfinished v1.
