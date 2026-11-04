# Product and release roadmap

## Direction

Make Moodle course material easy to find, understand, and organize through AI agents. Start with a dependable personal FINKI assistant; grow into a reusable Moodle integration as real usage demonstrates what is needed.

The long-term value is trustworthy access to course knowledge: complete discovery, useful retrieval, verifiable citations, fresh information, and clear permission boundaries. A release should improve an actual student workflow. More tools and infrastructure alone are not success.

This is a living plan, not a delivery-date commitment. The version names below are proposed targets, not published releases. Keep the project useful at every stage and revise later priorities from user feedback.

## Verified baseline

The package currently declares version 0.1.0. The initial implementation was merged in [PR #3](https://github.com/mahmutmft/courses-mcp/pull/3): local stdio MCP, faculty CAS login, enrolled-course listing, main-page browsing, and search of visible section/activity text. Live personal-account checks succeeded, but do not establish support for every course layout. No release tags were present when this roadmap was created.

Safer login diagnostics from [issue #4](https://github.com/mahmutmft/courses-mcp/issues/4) and [PR #5](https://github.com/mahmutmft/courses-mcp/pull/5) are also merged. Merged changes do not by themselves imply a tagged release.

Course filters ([PR #9](https://github.com/mahmutmft/courses-mcp/pull/9)) and bounded, deduplicated traversal of supported separate section pages ([PR #13](https://github.com/mahmutmft/courses-mcp/pull/13)) are merged. Coverage warnings disclose detected gaps. These are implemented parts of v0.2, not a published v0.2 release.

Supported Moodle HTML reading (PR #17), text-PDF reading (PR #19), saved choices (PR #21), local attendance preferences (PR #23), group-homework linking (PR #25) and assignment descriptions/published dates (PR #27) are merged. The current lab tool is partial: undated homework is linked to the saved slot, while supported dated titles are reported separately; assignment deadlines never prove presentation dates. Announcements, bounded recurrence/exception resolution, a complete weekly/calendar view, folder expansion, local indexing and durable refresh remain planned.

The remaining v1 work is tracked in [issue #28](https://github.com/mahmutmft/courses-mcp/issues/28) and the [v1.0 milestone](https://github.com/mahmutmft/courses-mcp/milestone/1). All 23 remaining work items have individual issues; 22 are required and ICS export is optional. Version targets below describe capability groups, not published releases or delivery dates.

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

This change in priority is tracked by [issue #14](https://github.com/mahmutmft/courses-mcp/issues/14). The readers and partial homework linking are now implemented as summarized above. Recurrence, announcement exceptions and complete weekly/calendar answers below remain planned.

### 1. Read the content behind a resource

Supported Moodle HTML and text-PDF reading are merged in PR #17 and PR #19. External origins and OCR remain unsupported. The original content-reading goal is **Read supported Moodle pages and URL-resource HTML content**. Given an enrolled course/resource ID, return bounded readable text and tables, the original resource URL, the resolved source when safe, retrieval time, and coverage/unsupported status. A resource title alone cannot answer questions about project registration or lab arrangements.

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

v1 stays local, with read-only Moodle access and explicitly requested local personal preference writes. It excludes assignment submissions, forum posts, enrollment changes, grade changes, hosted credential storage, arbitrary web crawling, guaranteed OCR, and universal Moodle compatibility. Unsupported content must be identified rather than silently presented as fully indexed.

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

## Tracked v1 issue backlog

[Main tracker #28](https://github.com/mahmutmft/courses-mcp/issues/28) has the live task checklist and release exit criteria. All tasks belong to the [v1.0 milestone](https://github.com/mahmutmft/courses-mcp/milestone/1); optional ICS #36 is not a release blocker. Existing implemented issues are not duplicated.

Ready tasks are labelled [help wanted](https://github.com/mahmutmft/courses-mcp/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22). Starter tasks #45 and #51 also use [good first issue](https://github.com/mahmutmft/courses-mcp/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22). Dependent tasks carry status:blocked until their prerequisites land. Comment on an issue before starting, agree the approach, use synthetic fixtures and submit a focused fork-based PR; no faculty credentials or private course material are needed.

Immediate feature priority: announcement reader #29. Parallel independent work is available for folder discovery, private cache design, fixtures, reliability, client compatibility, contracts and release preparation. Read each issue's scope and acceptance criteria.

### Scheduling and coursework

| Issue | Dependency | Ready for implementation |
| --- | --- | --- |
| [#29 — Read supported Moodle announcement forums with dates and citations](https://github.com/mahmutmft/courses-mcp/issues/29) | Current baseline | Yes; discuss approach first |
| [#30 — Store explicit private lab-group and term preferences](https://github.com/mahmutmft/courses-mcp/issues/30) | Current baseline | Yes; discuss approach first |
| [#31 — Extract source-backed lab timetable entries with effective dates](https://github.com/mahmutmft/courses-mcp/issues/31) | #30 | After dependencies |
| [#32 — Expand bounded lab recurrence and alternating teaching weeks](https://github.com/mahmutmft/courses-mcp/issues/32) | #31 | After dependencies |
| [#33 — Resolve lab cancellations, moved sessions and conflicting evidence](https://github.com/mahmutmft/courses-mcp/issues/33) | #29, #32 | After dependencies |
| [#34 — Provide cross-course weekly lab answers with scheduled/none/unknown states](https://github.com/mahmutmft/courses-mcp/issues/34) | #30, #32, #33 | After dependencies |
| [#35 — Add a read-only weekly and monthly lab calendar view](https://github.com/mahmutmft/courses-mcp/issues/35) | #34 | After dependencies |
| [#42 — Read supported quiz availability and deadline metadata without question content](https://github.com/mahmutmft/courses-mcp/issues/42) | Current baseline | Yes; discuss approach first |
| [#43 — Aggregate upcoming coursework deadlines separately from lab presentation slots](https://github.com/mahmutmft/courses-mcp/issues/43) | #42 | After dependencies |

### Discovery, retrieval and durable local use

| Issue | Dependency | Ready for implementation |
| --- | --- | --- |
| [#37 — Discover Moodle folder contents with bounded read-only traversal](https://github.com/mahmutmft/courses-mcp/issues/37) | Current baseline | Yes; discuss approach first |
| [#38 — Design and implement private local cache isolation and lifecycle](https://github.com/mahmutmft/courses-mcp/issues/38) | Current baseline | Yes; discuss approach first |
| [#39 — Build bounded lexical indexes of supported course text and text PDFs](https://github.com/mahmutmft/courses-mcp/issues/39) | #38, #37 | After dependencies |
| [#40 — Add cross-course lexical search with evidence and scope reporting](https://github.com/mahmutmft/courses-mcp/issues/40) | #39 | After dependencies |
| [#41 — Refresh changed/deleted sources with resumable bounded jobs](https://github.com/mahmutmft/courses-mcp/issues/41) | #38, #39 | After dependencies |

### Quality, contributors and release gates

| Issue | Dependency | Ready for implementation |
| --- | --- | --- |
| [#44 — Document and lock stable MCP tool, error and provenance contracts](https://github.com/mahmutmft/courses-mcp/issues/44) | Current baseline | Yes; discuss approach first |
| [#45 — Create a versioned synthetic MK/EN/SQ compatibility corpus](https://github.com/mahmutmft/courses-mcp/issues/45) | Current baseline | Yes; discuss approach first |
| [#46 — Add a reproducible retrieval benchmark with at least 30 queries](https://github.com/mahmutmft/courses-mcp/issues/46) | #45, #40 | After dependencies |
| [#47 — Audit request, pagination, response and worker resource limits](https://github.com/mahmutmft/courses-mcp/issues/47) | Current baseline | Yes; discuss approach first |
| [#48 — Perform independent v1 authorization, privacy and untrusted-content review](https://github.com/mahmutmft/courses-mcp/issues/48) | #38, #41, #44 | After dependencies |
| [#49 — Validate clean Windows installation and supported MCP client recovery](https://github.com/mahmutmft/courses-mcp/issues/49) | Current baseline | Yes; discuss approach first |
| [#50 — Establish one version source, changelog and reviewed v1 release procedure](https://github.com/mahmutmft/courses-mcp/issues/50) | Current baseline | Yes; discuss approach first |
| [#51 — Make first-time fork and pull-request contribution instructions accurate](https://github.com/mahmutmft/courses-mcp/issues/51) | Current baseline | Yes; discuss approach first |

### Optional increment (not a v1 release blocker)

| Issue | Dependency | Ready for implementation |
| --- | --- | --- |
| [#36 — Export reviewed lab occurrences as an ICS file (optional v1 increment)](https://github.com/mahmutmft/courses-mcp/issues/36) | #35 | After dependencies |

The readiness labels/table reflect the planning snapshot; use the live issues for current status. Contracts, compatibility and release gates must be rechecked against the final v1 candidate after all feature changes. No issue or milestone closure automatically publishes a release.

## Versioning and sustained maintenance

Use PATCH for compatible fixes, MINOR for compatible capabilities, and MAJOR for intentional breaking public contracts. During 0.x, explicitly document breaking changes and migration steps. A large feature that preserves compatibility can remain 1.x; do not force a major release just to follow this table.

Work through issue → branch → focused PR → required checks → independent/human review → merge. Group accepted issues into GitHub milestones when starting a release. Keep one primary feature milestone active, while urgent fixes can ship separately. Update this roadmap and changelog as decisions change.

For every feature release, reserve capacity for regression fixes, dependency updates, security, documentation, and compatibility fixtures. Track setup success, login failure categories, discovery completeness, retrieval quality, freshness, and latency through synthetic/local measurements; do not collect private-content telemetry by default. Record baselines before claiming improvement.

At each milestone, review what users actually used, what failed, what now costs too much to maintain, and what should be removed or redesigned. An enduring project needs a bounded reliable core and a growing tested ecosystem, not an ever-growing unfinished v1.


### Scheduling increment: homework-to-term linking (#24)

The #24 implementation introduces get_lab_schedule for one explicitly selected course/week: retain group-specific homework with its saved presentation slot, and separately return supported dated title matches. This is not a complete weekly resolver: undated assignments remain date_unconfirmed, announcements/cancellations and activity details remain unread. Next scheduling work must establish assignment applicability/availability and dated exceptions before claiming confirmed weekly attendance or absence. Local attendance preferences are merged in PR #23; choice reading and PDF extraction are merged in PR #21 and PR #19 respectively (older active labels above describe the original queue).


### Scheduling increment: assignment descriptions and published dates (#26)

The #26 implementation adds get_assignment and bounded enrichment of matching group homework in get_lab_schedule. Opening/due/cutoff fields retain source labels and explicit timezone/parse uncertainty. A due date can distinguish deadline calendar relevance but never proves the presentation date or completion. Assignment-details reading follows merged homework linking (PR #25). Next: supported announcements and explicit applicability/presentation dates, then exception-aware weekly resolution and calendar/ICS. No release version has been tagged by this increment.
