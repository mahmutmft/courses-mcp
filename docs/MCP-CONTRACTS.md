# MCP tool contracts

The [evidence and privacy inventory](TRUST_AND_PRIVACY.md) maps every tool category
to its actual source/freshness fields or their absence, local-declaration semantics,
diagnostic tests and client data flow. Initialization guidance asks clients to
preserve citations/uncertainty, but cannot guarantee an external assistant's wording.

## Request admission and cancellation

At most eight tool actions may execute/wait on the shared session queue. Overflow
returns REQUEST_QUEUE_LIMIT as an isError text result. REQUEST_CANCELLED prevents
an SDK-cancelled queued action from executing when its turn arrives; already-active
work retains its reader cleanup/limits and serialization. This is not a hard
in-flight cancellation or rollback. Failed requests release their queue slots.
The [limits audit](LIMITS_AUDIT.md) inventories every current tool and its bounds.

## Explicit refresh jobs

start_course_refresh and advance_course_refresh are annotated non-read-only,
non-idempotent local writes; get_course_refresh is read-only. All require explicit
cache opt-in and current enrollment. Progress responses contain counts/state only.
One advance processes at most one course. Cancellation applies between calls,
and complete means all steps attempted, not complete evidence. Check partial/failed
counts and warnings. See [refresh job contracts and recovery](REFRESH_JOBS.md).

## Cache inspection freshness

get_course_cache retains stored/empty presence status. A present record additionally
includes record.freshness: fresh (age under seven days), expired (seven days or
more), future (timestamp after the local clock), or unknown (unverifiable clock).
This is local storage age, not live Moodle evidence freshness. Only fresh snapshots
can be considered for reuse after live authorization and fingerprint checks.
Inspect does not return cached content; clearing still requires an explicit request.

## PDF resource continuation

read_resource accepts optional startPage (positive, 1-based, PDF resources only).
Omission starts at page 1. Each call still downloads and authorizes the resource
and extracts at most 30 pages within the existing 10 MiB, 60,000-character and
worker time limits. A 54-page document can be inspected with startPage=1, then
startPage=31. Original page numbers and source URLs are preserved.

PDF results expose startPage, nextPage and partialPages. Follow nextPage until
null; this does not certify complete text: blank, failed or text-truncated pages
remain explicit. A character-budget cut after earlier pages may set nextPage to
the same last page so a fresh call can recover its text. A single page exceeding
the per-page text cap remains in partialPages and cannot be fully recovered by
page selection alone. Out-of-range pages return PDF_PAGE_OUT_OF_RANGE. Later-page
calls remain partial because they exclude the beginning of the document. No
automatic full-file crawl or expanded search scope is introduced. HTML resources
reject explicit startPage rather than silently ignoring it. Restart the MCP
client after updating to discover the new input.

The server uses stdio. Restart the client connection after updating the checkout so it initializes the new server and refreshes its tool list. The initialization version comes from package.json. See [release workflow](RELEASING.md) for compatibility and migrations.

| Tool | Inputs | Result |
| --- | --- | --- |
| start_course_refresh | courseIds (1–4), optional documents (up to 3) | Creates private refresh progress without fetching documents |
| get_course_refresh | No inputs | Account-scoped progress counts/state after current access checks |
| advance_course_refresh | Optional action (next, cancel, resume; default next) | One-course refresh/checkpoint or between-call cancellation/resumption |
| list_courses | Optional academicYear and semester (winter or summer) | Enrolled courses, label classification and truncation |
| get_course_cache | courseId | Local cache size and write timestamp, with enrollment verification |
| clear_course_cache | courseId | Explicit local deletion of the selected course cache |
| get_course | courseId | Sections, discovered resources and traversal coverage |
| search_course | courseId, query, optional limit | Matches in visible section and activity text |
| search_courses | courseIds (1–4), query, optional limit (1–30), documents (up to 3 pairs), refresh, academicYear, semester | Ranked snippets, current citations, explicit selection and coverage |
| read_resource | courseId, resourceId, optional startPage (PDF only) | Supported HTML or page-cited PDF text with continuation metadata |
| get_folder | courseId, folderId | Discovered folder contents and coverage |
| read_folder_file | courseId, folderId, fileId | Text of one discovered folder PDF |
| get_choice_selection | courseId, choiceId | Saved selection, explicit absence or unknown |
| get_announcements | courseId, forumId | Supported news starter posts and source timestamps |
| get_assignment | courseId, assignmentId | Description and published opening, due and cutoff fields |
| get_quiz | courseId, quizId | Description and published opening and closing fields |
| get_coursework_deadlines | courseIds, range | Published date fields across selected courses |
| get_lab_timetable | courseId, resourceId, optional occurrenceRange and announcementForumId | Timetable evidence, optional dated expansion and announcement changes |
| get_lab_schedule | courseId, weekStart | Dated candidates and term-linked homework for one course |
| get_weekly_labs | courseIds (1–4), weekStart, optional fromDate within the week | Cross-course dated candidates, undated homework and uncertainty |
| get_lab_preference | courseId | Local attendance preference |
| set_lab_preference | courseId, attendance | Saves attending or exempt, or clears the record with unknown |
| get_lab_term_preference | courseId | Local group and term preference |
| set_lab_term_preference | courseId, term | Replaces the local term, or resets it with null |

IDs are positive safe integers. Activity IDs are Moodle course-module IDs from discovered resource URLs. Folder file IDs are opaque 24-character lowercase hexadecimal strings issued by get_folder. weekStart is an explicit Monday in YYYY-MM-DD format. Date ranges use inclusive from and through fields, with 1–31 days. announcementForumId requires occurrenceRange.

Successful calls return a JSON object encoded in a text content item. Validation and request failures use MCP isError with text. Expected reader errors may include an uppercase diagnostic code in the message. Codes and warnings are reader-specific. Unexpected exceptions use a generic message.

Where available, sourceUrl or per-item sources identify evidence. checkedAt records when the reader checked it. Published timestamps describe the source event. A null timezone or instant preserves uncertainty. partial means coverage or fields are incomplete. unsupported describes an unreadable layout or format. Consult each tool's coverage and warnings before treating an empty result as complete.

Search queries accept up to 200 characters. search_course returns at most 100 matches (default 30); search_courses returns at most 30 (default 10). Coursework deadline lookup accepts up to 10 course IDs and reads at most 24 activities. Other readers apply tool-specific page, text and traversal limits. See [README](../README.md), [folder contracts](FOLDERS.md) and [timetable contracts](TIMETABLES.md).

The two preference setters, clear_course_cache and start/advance_course_refresh are local writes. Invoke writes only for an explicit user request. clear_course_cache is destructive and idempotent; preference setters are idempotent; refresh start/advance are non-idempotent. All other tools are annotated read-only. Moodle access remains read-only.

## Reviewed schema inventory and compatibility

[The machine-readable inventory](../test/fixtures/tool-contracts.json) records all
24 tools' input schemas, required/optional fields, defaults and annotations as
discovered over actual stdio. The contractVersion field versions this inventory's
format, not the package or a published v1 API. The current package is pre-v1.
The protocol test compares every tool to it and verifies this table's tool names.
It deliberately does not freeze descriptive prose or claim output JSON schemas
that the server does not advertise.

When changing public inputs or annotations, run `npm run contracts:update`, inspect
the complete diff and update these docs plus behavior tests. Do not regenerate a
snapshot just to hide an unexplained failure. Preserve existing input names,
defaults and response fields where possible. Additive optional fields are normally
compatible; removing/renaming fields or changing meaning requires explicit migration
notes and the version policy in docs/RELEASING.md. Reconcile the inventory again
after remaining features and on the final v1 candidate; this is not a v1 release.

## Result envelope, errors and size limit

Successful tool results have one text content item containing complete JSON.
Reader-level partial/unsupported outcomes are successful envelopes whose JSON
must be inspected for coverage and warnings. Thrown errors use isError=true and
plain text, not a JSON result object. SDK argument-validation errors can use the
SDK's own text format; clients must not parse them as successful reader JSON.

Known safe error messages retain their existing codes/text; unexpected runtime or
serialization errors use the fixed generic message. Existing code families include
LOGIN_*, PDF_*, RESOURCE_*, CACHE_*, REFRESH_* and local preference codes. Reader
warnings remain reader-specific; no new universal error wrapper renames old fields.

Every successful JSON text is limited to 1 MiB measured as UTF-8 bytes after JSON
serialization, excluding MCP framing. Oversized output becomes the fixed
TOOL_OUTPUT_LIMIT error asking for narrower input. It is never sliced into invalid
JSON or silently returned as complete evidence. An error does not roll back any
local write already completed. Reader-specific smaller bounds still apply. This
check bounds emitted success text, not allocations made before/while serializing,
total process memory, worker native memory, or the wire envelope size. The limits
audit remains #47; independent review remains #48.

## Cross-course search coverage

search_courses accepts 1–4 enrolled course IDs and up to three explicitly
selected HTML or PDF resources. The query is limited to 200 characters.
The default result limit is 10, with a maximum of 30. An unavailable course
has no hits and is reported in coverage. Unselected documents and folders
are outside the search scope.

An opt-in local cache can reuse the search index when fresh Moodle evidence
matches the stored fingerprint. A course's indexReused flag reports reuse.
The checkedAt timestamp reflects the live read. CACHE_INVALIDATION_FAILED
means the old snapshot could not be removed. Search still uses current
evidence. See [private cache settings and limits](COURSE_CACHE.md).

Enrollment pagination has a 30-second request budget after dashboard authentication, with up to 10 seconds per API call. If time runs out between pages, the result returns collected courses with truncated set to true.

See [Moodle reader budgets](READER_BUDGETS.md) for request, processing and buffering limits.

Cross-course hits include courseName and sourceName where the reader supplied titles. Section snippets may have a null sourceName.

For search_courses, truncated is true when ranked matches exceed the requested result limit. Course coverage separately reports how much evidence could be indexed.

search_courses returns status=read when all selected evidence was read within the supported scope, or partial when coverage is incomplete. matchStatus is found when at least one indexed snippet matches, no_match when complete selected evidence has no hits, and unknown when incomplete evidence has no hits. Unselected files remain outside the stated scope.

## Weekly lab overview

get_weekly_labs accepts 1–4 explicit enrolled course IDs and weekStart as a
Monday in YYYY-MM-DD format. It returns the whole Monday–Sunday week in
Europe/Skopje. Each course retains its warnings, source check times, local
exemption state and undated homework. Published dated candidates appear in
a separate sorted occurrences list. Each course is processed once, sequentially,
using the existing per-course schedule reader and its request limits.

The overview remains partial until the recurrence and announcement exception
pipelines are integrated. All-exempt selections return exempt based on the
student's local declarations. An empty list is insufficient evidence of no lab.

Optional fromDate selects an inclusive local calendar date within that same week
through Sunday. Omission preserves the whole-week behavior. The returned range
states the actual selected days. fromDate includes all times on that day; it is
not an instant-based filter. Clients should use the user's Europe/Skopje date
explicitly rather than a server UTC date for remaining-week questions. Invalid
or out-of-week dates fail before any Moodle read through the tool. Undated
homework, per-course freshness and warnings remain visible even if all dated
candidates are filtered out. For example, weekStart=2026-12-28 and
fromDate=2027-01-01 returns January 1–3, including sessions earlier on January 1.
