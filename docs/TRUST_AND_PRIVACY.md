# Sources, uncertainty and privacy

Courses MCP reads authorized Moodle evidence and returns it to the MCP client you
choose. It does not guarantee the wording or accuracy of an external assistant's
final answer. Server initialization asks clients to preserve citations, PDF page
numbers and uncertainty, and to distinguish personal declarations from faculty data.
Clients can ignore that guidance, so inspect the actual tool result when in doubt.

## Evidence inventory

This covers the current 24 tools. Field names describe the actual contracts; a
missing field is not an invitation to invent a timestamp or Moodle citation.

| Tools | Source and freshness | Interpretation and evidence tests |
| --- | --- | --- |
| `list_courses` | Returned course URLs; classificationSource explains label inference. No universal checkedAt field. | Enrolled list/naming metadata, not official current-semester inference. Pagination/unknown labels stay visible. test/courses.test.js, test/moodle.test.js |
| `get_course`, `search_course` | Course/section/resource URLs and hit URLs; no universal checkedAt field. | Current discovery/visible-page text only. Preserve traversal/truncation warnings; no hidden file search. test/sections.test.js |
| `search_courses` | Hit url, page (null for non-PDF), checkedAt; coverage sources, status and selection. | Unknown/partial selected scope is not no_match. Cache reuse still checks live evidence; unselected documents remain unsearched. test/sections.test.js, test/course-index.test.js |
| `read_resource`, `read_folder_file` | sourceUrl, checkedAt and per-page sourceUrl/pageNumber; folder files also carry fileId/path. | PDF pages are original document numbers. Blank, failed, partial and unread pages do not become an empty successful document. test/pdf.test.js, test/folders.test.js, test/trust-evidence.test.js |
| `get_folder` | Folder/item sourceUrl and listing checkedAt. | Listing a file is not reading it. Follow unsupported/partial coverage. test/folders.test.js |
| `get_choice_selection` | sourceUrl, checkedAt and explicit saved selection state. | No default-radio inference, roster reading or voting. A saved term alone does not establish weekly attendance. test/choices.test.js |
| `get_announcements` | Forum/post sourceUrl, checkedAt and explicit publication/update instants where available. | Starter posts only; publication time is not a lab effective date. Missing/failed discussions remain partial. test/forums.test.js |
| `get_assignment`, `get_quiz` | sourceUrl, checkedAt and published date fields with timezone uncertainty. | Deadlines/availability, not lab presentation dates, grades or attempts. test/assignments.test.js |
| `get_coursework_deadlines` | Per-item sourceUrl/checkedAt, range and coverage. | Read only published date fields; preserve missing dates, unread activities and unknown offsets. test/deadlines.test.js |
| `get_lab_timetable` | Timetable/entry source references, checkedAt, optional expansion and announcementChanges evidence. | Candidate schedules and supported changes, not automatically verified personal attendance. Conflicts preserve alternatives. test/timetables.test.js, test/lab-changes.test.js |
| `get_lab_schedule`, `get_weekly_labs` | Dated occurrence sources, selected poll/local field provenance, check times and per-course coverage where available. | Undated homework remains separate. Empty/unchecked evidence is not confirmed absence; exemptions are user declarations. test/labs.test.js, test/weekly-labs.test.js |
| `get_lab_preference`, `set_lab_preference`, `get_lab_term_preference`, `set_lab_term_preference` | source=user_declared/unset and local updatedAt, not a faculty sourceUrl. | Local personal settings. Do not label them faculty approval or turn their write time into a Moodle check. test/preferences.test.js, test/lab-terms.test.js |
| `get_course_cache`, `clear_course_cache` | Local metadata/status only; record updatedAt/bytes/freshness when present. | Stored does not mean fresh. Local age is not a live source check; no content/path returned. test/course-cache.test.js, test/trust-evidence.test.js |
| `start_course_refresh`, `get_course_refresh`, `advance_course_refresh` | Local job updatedAt and aggregate counts/state, no faculty citation. | Complete means steps attempted; partial/failed counts remain visible. No invented evidence URLs. test/refresh-jobs.test.js |

## Answer examples

These are synthetic response patterns, not actual faculty results or promises
that an assistant will follow them. The preceding tools must support each claim.

- PDF hit: "Најдов објаснување во ‘Synthetic notes’, PDF страница 12. Извор:
  [материјалот](https://example.test/notes). Проверено: времето од checkedAt."
  Use an actual returned URL/page/check time, not this example link or literal label.
- No hits with partial scope: "Нема совпаѓања во прочитаниот текст. Дел од
  избраните материјали не се прочитани; не можам да потврдам дека темата ја нема."
- Declared exemption: "Лабораториите се зачувани локално како признаени според
  твојата изјава. Ова не е потврда од факултетот."
- Incomplete term: "Избраниот термин почнува во наведениот час. Крајниот час е
  непознат." Do not add a default duration or convert a poll label to weekly dates.
- Date without offset: show the published local date/time and say the timezone
  is unknown; do not manufacture an instant. A retrieval time is not a deadline.

## Where data goes

Faculty credentials come from the project-local .env or the process environment.
They are submitted by the browser adapter only to the checked HTTPS FINKI CAS
login form. Cookies/session state stay in the running browser context; the project
does not save them to disk. Stopping MCP closes that local browser context; it
does not log out separate browser sessions or revoke the faculty's server-side
session. No background monitoring or automatic credential retry loop is started.

The MCP tool interface does not return the configured username/password, cookies
or authorization headers. However, requested course text, PDFs, saved poll labels
and relevant local preferences are returned to your chosen client. If that client
uses a cloud model, it can send that tool output and conversation to its provider
under its settings/policies. Courses MCP cannot control provider retention or
other tools your assistant has permission to use. Do not assume an assistant with
general filesystem access is technically unable to read .env. Keep credentials
out of chat prompts, screenshots and issue attachments.

There is no project-hosted account/content collection service sending results to
the maintainer in this implementation. Explicitly sharing logs, a synced folder,
screenshots or repository files is a separate disclosure path. gitignore reduces
accidental Git tracking; it does not encrypt a file, limit OS access, or stop
OneDrive/other sync software from copying .env. Use a nonsynced checkout if needed.

## Local storage and cleanup

- .env remains in the checkout. Existing process environment values take precedence.
  Keep it private and never commit/share it. Guided setup preserves an existing file.
- Preferences are under the local app-data courses-mcp/lab-preferences directory.
  They store account-scoped attendance/term declarations, not faculty verification.
- Opt-in course-cache stores fingerprints and derived searchable excerpts/tokens.
  Those excerpts can contain private course text. Expired records remain on disk
  until explicitly deleted and cannot be served as fresh records.
- Refresh jobs store course/document IDs and progress under refresh-jobs, not
  source text, passwords or sessions. Progress can still be personal metadata.

These app-data directories are outside the clone, normally under LOCALAPPDATA on
Windows or XDG_DATA_HOME/the documented fallback elsewhere. Institution/username
hashing isolates namespaces; it is not encryption. Local OS access/ACLs and any
user-configured app-data syncing remain relevant. See [cache lifecycle](COURSE_CACHE.md)
and [refresh recovery](REFRESH_JOBS.md) for exact locations and bounds.

For normal cleanup, use explicit preference resets or clear_course_cache for an
enrolled selected course. Stop MCP before manually removing intended account-local
files, stale locks or revoked/corrupt job data. Do not delete a shared app-data
directory indiscriminately. Removing .env does not clear caches/preferences, and
removing a cache does not clear .env or browser/client/provider history. This
project cannot erase data already shared with an external AI client/provider.

## Verification and limits

Synthetic reader-to-index tests verify actual returned citations/check times,
exclude account chrome/form/header sentinels and check disposal. Timeout/network
and denied discovery tests retain safe errors without raw credentials, cookies,
authorization headers or local-path sentinels. Unsupported PDF and stale-cache
tests preserve uncertainty; local exemption tests retain user-declared provenance.
Actual stdio tests inject synthetic diagnostic secrets and verify they are absent
from errors/stderr while the next request remains usable. Existing reader suites
listed above cover additional layouts and failure paths.

These tests do not prove that all possible sensitive strings are removed from
arbitrary course content. Course text itself may be personal and is deliberately
returned when requested. Keep course content untrusted and do not follow embedded
instructions. Client output can still misrepresent evidence; independent review
of authorization/privacy/untrusted-content boundaries remains required in #48.
No live rejected-credential tests or faculty-private fixtures are needed here.
