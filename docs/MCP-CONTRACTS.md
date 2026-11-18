# MCP tool contracts

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
| list_courses | Optional academicYear and semester (winter or summer) | Enrolled courses, label classification and truncation |
| get_course_cache | courseId | Local cache size and write timestamp, with enrollment verification |
| clear_course_cache | courseId | Explicit local deletion of the selected course cache |
| get_course | courseId | Sections, discovered resources and traversal coverage |
| search_course | courseId, query, optional limit | Matches in visible section and activity text |
| search_courses | courseIds (1–4), query, optional limit (1–30), optional documents (up to 3 courseId/resourceId pairs) | Ranked live index snippets with source/page citations and per-course coverage |
| read_resource | courseId, resourceId | Supported HTML or page-cited PDF text |
| get_folder | courseId, folderId | Discovered folder contents and coverage |
| read_folder_file | courseId, folderId, fileId | Text of one discovered folder PDF |
| get_choice_selection | courseId, choiceId | Saved selection, explicit absence or unknown |
| get_announcements | courseId, forumId | Supported news starter posts and source timestamps |
| get_assignment | courseId, assignmentId | Description and published opening, due and cutoff fields |
| get_quiz | courseId, quizId | Description and published opening and closing fields |
| get_coursework_deadlines | courseIds, range | Published date fields across selected courses |
| get_lab_timetable | courseId, resourceId, optional occurrenceRange and announcementForumId | Timetable evidence, optional dated expansion and announcement changes |
| get_lab_schedule | courseId, weekStart | Dated candidates and term-linked homework for one course |
| get_lab_preference | courseId | Local attendance preference |
| set_lab_preference | courseId, attendance | Saves attending or exempt, or clears the record with unknown |
| get_lab_term_preference | courseId | Local group and term preference |
| set_lab_term_preference | courseId, term | Replaces the local term, or resets it with null |

IDs are positive safe integers. Activity IDs are Moodle course-module IDs from discovered resource URLs. Folder file IDs are opaque 24-character lowercase hexadecimal strings issued by get_folder. weekStart is an explicit Monday in YYYY-MM-DD format. Date ranges use inclusive from and through fields, with 1–31 days. announcementForumId requires occurrenceRange.

Successful calls return a JSON object encoded in a text content item. Validation and request failures use MCP isError with text. Expected reader errors may include an uppercase diagnostic code in the message. Codes and warnings are reader-specific. Unexpected exceptions use a generic message.

Where available, sourceUrl or per-item sources identify evidence. checkedAt records when the reader checked it. Published timestamps describe the source event. A null timezone or instant preserves uncertainty. partial means coverage or fields are incomplete. unsupported describes an unreadable layout or format. Consult each tool's coverage and warnings before treating an empty result as complete.

Search queries accept up to 200 characters and return at most 100 matches (default 30). Coursework deadline lookup accepts up to 10 course IDs and reads at most 24 activities. Other readers apply tool-specific page, text and traversal limits. See [README](../README.md), [folder contracts](FOLDERS.md) and [timetable contracts](TIMETABLES.md).

Tool annotations identify both preference setters as local writes. Invoke them only for an explicit request to save or reset a preference. Moodle access is read-only.

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
