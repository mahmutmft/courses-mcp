# Request and resource-limit audit

Scope: current pre-v1 implementation, including all 29 public tools, refresh jobs
and local storage. This is an implementation audit and regression inventory, not
the independent security review (#48) or a production stress test. Reconcile it
when adding adapters/tools and on the final v1 candidate.

## Shared lifecycle

All tool actions share one serialized session queue. At most eight actions may be
active/waiting together (one executing, seven waiting). Overflow returns the safe
REQUEST_QUEUE_LIMIT error; the action is never invoked. Failures release capacity
and cannot poison later requests. SDK cancellation is checked before admission and
again before execution. Queued cancelled work returns REQUEST_CANCELLED without
touching Moodle/local state when its turn arrives. It occupies a bounded slot until
that turn. Already-running work retains serialization and existing cleanup/time
limits; cancellation is not a hard interrupt or a rollback of a local write.

Successful JSON text is capped at 1 MiB after serialization (TOOL_OUTPUT_LIMIT),
not cut into invalid JSON. Known safe errors retain codes; unexpected errors do
not expose raw diagnostics. Stdio contains protocol messages only. Login has one
explicit attempt and fixed timeout/network/rejection/challenge categories, not
an automatic credential retry loop. Shutdown closes the in-memory browser/session.

## Tool inventory and bounds

All stages may additionally need current enrollment/login. A stage deadline is
not a whole-tool or whole-session deadline. See [reader budgets](READER_BUDGETS.md)
for byte/time caps and [contracts](MCP-CONTRACTS.md) for current schemas/defaults.

| Public tools | Bounded work and cleanup |
| --- | --- |
| `get_lab_calendar` | Inclusive 1–31 civil dates, at most six weekly projections/four courses. Timetable/news evidence shared only within the request, at most one read/pair. Final freshness/enrollment checks; source failure stops further weeks without automatic login retries. No new whole-month deadline; 1 MiB output cap applies. |
| `list_courses` | 100 pages × 100 items; pagination budget 30 seconds after authentication; each streamed API response at most 2 MiB/10 seconds. Repeated/nonadvancing cursors terminate with truncation. |
| `get_course`, `search_course` | Course traversal at most 20 logical pages in batches of four, 30 seconds, 4 MiB processed HTML/page, 200 sections/1,000 resources. Redirect/ownership checks and response disposal; search at most 100 hits. |
| `read_resource` | Selected discovered HTML or PDF only. HTML five hops/15 seconds/2 MiB processed response, text 20,000 characters; PDF bounds below. |
| `search_courses` | At most four explicit courses and three selected documents; five-second discovery budget/course and existing resource-reader budgets. Index at most 32 sources/96 chunks of 1,000 code points per course; at most 30 hits. No hard new aggregate call deadline. |
| `get_folder`, `read_folder_file` | Folder traversal 30 seconds/five pages/200 items, 2 MiB processed HTML/response and 6 MiB total. Selected PDF requires fresh discovery/context checks and bounded retrieval/extraction. No bulk files. |
| `get_choice_selection` | One canonical GET, redirects rejected, 15 seconds/2 MiB; saved label at most 700 characters; response disposed. |
| `get_announcements` | 30 seconds, three index-page/ten discussion-page attempts, 50 discovered links; 2 MiB/response and 8 MiB total, 40,000 text characters. Redirect rejection and disposal; unavailable scope stays partial. |
| `get_assignment`, `get_quiz` | One canonical discovered view, no redirect traversal; 15 seconds/2 MiB, introduction 10,000 characters. No attempts/submissions/grades; response disposed. |
| `get_coursework_deadlines` | 1–10 explicit courses, inclusive 1–31 dates, 45-second metadata/discovery budget after enrollment, at most 24 activity reads and smaller per-stage limits. Skipped scope stays visible. |
| `get_lab_timetable` | Existing selected reader bounds, at most 200 entries/1,000 inspected rows, optional 1–31-day occurrence expansion and one bounded news forum. Composition has no new whole-tool deadline. |
| `get_lab_schedule`, `get_weekly_labs` | One week/course, weekly aggregation up to four courses, per-course discovery/choice reads; assignment enrichment at most five reads/30-second enrichment budget. Weekly evidence adds at most one selected timetable/news pair per course, using their existing bounds and a final freshness check. No separate whole-week call deadline. Empty/unchecked evidence is not confirmed absence. |
| `get_lab_preference`, `set_lab_preference`, `get_lab_term_preference`, `set_lab_term_preference` | Current enrollment, account-scoped files outside clone, bounded records, exclusive per-course locks, atomic temp replacement and cleanup. No source reads beyond required enrollment/discovery checks. |
| `get_course_cache`, `clear_course_cache` | Current enrollment before metadata/deletion, 1 MiB/record and 32-course quota. No recursive tool deletion. Account locks serialize writes; explicit discard handles corrupt regular files without following links. |
| `start_course_refresh`, `get_course_refresh`, `advance_course_refresh` | One private job/account, 1–4 course IDs/three selected documents, bounded 4 KiB metadata. One course rebuilt per advance. Cancel/resume between steps, not mid-download; no background worker or polling. Locks/checkpoints follow private storage rules. |

PDF retrieval has five-hop and 15-second limits, a 10 MiB accepted body, then a
terminable worker with a 10-second extraction limit and V8 limits of 128 MiB old /
32 MiB young generation. Each call extracts at most 30 pages/60,000 characters,
with at most 20,000 characters/page. startPage/nextPage permit explicit continuation;
partial/blank/failed pages remain disclosed. Extraction does not perform OCR.

## Limitations retained explicitly

- Most Playwright request readers check body size after buffering. Content-Length
  rejection and processed-size ceilings do not guarantee a streaming memory cap.
- Queue admission follows SDK argument parsing; eight admitted actions is not a
  transport-level input-byte or total client-message memory limit.
- Chromium, PDF parser native memory, JSON serialization allocations and the OS
  filesystem are outside the V8/output-text limits. There is no OS sandbox claim.
- Composite calls can exceed a single-stage budget. Queued wait time, browser
  startup/login, filesystem work and reader stages do not share one hard deadline.
- Aborting an active client request does not immediately terminate browser work.
  Starting another action before cleanup finishes would break session safety, so
  the queue remains serialized. Refresh cancellation applies between advances.
- A crash can leave a private storage lock/temp file. Committed snapshots remain
  atomic, but there is no power-loss durability guarantee or automatic lock stealing.
  Recover only after stopping all writers, using documented account-local cleanup.

## Regression evidence

All tests are offline/synthetic; no load was sent to faculty services.

| Coverage | Regression tests |
| --- | --- |
| Queue quota/FIFO, skipped queued cancellation, active cancellation, failure recovery | test/moodle.test.js; explicit gates rather than wall-clock timing |
| Real stdio overflow/oversize errors and subsequent valid JSON responses | test/tool-results.test.js; mocked slow first action, no faculty requests |
| Protocol inputs, annotations and schema inventory | test/protocol.test.js |
| Pagination loops, time budgets and streamed enrollment response caps | test/moodle.test.js |
| Redirect ownership/loops, request/processed-body limits and response disposal | test/sections.test.js, test/resources.test.js, test/choices.test.js, test/assignments.test.js, test/forums.test.js, test/folders.test.js |
| Worker errors, malformed/encrypted/oversized PDFs, parser timeout and page continuation | test/pdf.test.js |
| Refresh cancellation/restart, revoked access, competing checkpoints and safe failures | test/refresh-jobs.test.js |
| Real interrupted writer, quota contention, corruption and private storage guards | test/course-cache.test.js and test/preferences.test.js |

CI runs syntax checks, offline tests and the retrieval benchmark. Report results
for the reviewed revision in its PR. Final client/live compatibility and independent
review remain separate release gates; passing these tests does not certify security.

## Saved schedule reuse

save_lab_schedule verifies one course/group, one timetable and one news forum using their existing bounded readers. get_saved_lab_schedule checks enrollment before/after, reads one news forum without course/poll discovery, and expands 1-31 dates. clear_saved_lab_schedule deletes one explicit scope. At most 32 snapshots/account, 32 entries/snapshot, 64 KiB/file and seven days reuse; no background refresh. See SAVED_LAB_SCHEDULES.md.

## ICS export

export_lab_calendar reuses the existing bounded calendar read, then considers at most 100 explicit IDs. It permits at most 16 safe source URLs/event, 256 KiB ICS text and the normal 1 MiB MCP result cap. No file writes, background jobs or external calendar calls. See LAB_ICS.md.
