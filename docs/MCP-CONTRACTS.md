# MCP tool contracts

The server uses stdio. Restart the client connection after updating the checkout so it initializes the new server and refreshes its tool list. The initialization version comes from package.json. See [release workflow](RELEASING.md) for compatibility and migrations.

| Tool | Inputs | Result |
| --- | --- | --- |
| list_courses | Optional academicYear and semester (winter or summer) | Enrolled courses, label classification and truncation |
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
