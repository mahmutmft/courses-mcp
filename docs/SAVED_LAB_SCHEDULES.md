# Confirmed schedule reuse

After explicitly confirming the course, semester and selected group, ask the
assistant to call save_lab_schedule with courseId, resourceId, forumId, weekStart
(a Monday), and scope: {academicYear: "2026/2027", semester: "winter", group: "A"}.
This performs fresh group resolution, timetable and announcement reads. Attendance
must already be explicitly declared attending. Incomplete/conflicting group or
unsupported timetable evidence is rejected. Unknown end times remain null.

Use get_saved_lab_schedule with the same courseId/scope and range {from, through}
of 1–31 inclusive dates. A valid snapshot survives server restarts. This path checks
current enrollment and local preferences, then reads the saved news-forum locator
with current course/module ownership checks. It does not reopen course pages,
polls or the timetable document. It is an explicit alternative to get_weekly_labs
and get_lab_calendar; those tools retain their existing live-discovery behavior.

Results retain verifiedAt from the timetable and changesCheckedAt from the current
news read; initialChangesCheckedAt is historical only. Supported cancellations and
moves apply to the stored original sessions. A failed/stale/partial announcement
check cannot certify changes. Overall answerState remains unknown: this operation
does not examine all homework, other forums or changes moving in from outside the
requested original date range. Empty results never prove no labs. Even valid stored
slots are candidates from a user-confirmed snapshot, not a fresh faculty check.

## Refresh and invalidation

Call save_lab_schedule again only on an explicit refresh/confirmation request.
Reads never extend validity. Snapshots expire seven days after verifiedAt, and
only project dates inside their explicitly recorded dates/effective period. A
future/unverifiable timestamp is expired. Changed local attendance/term settings
invalidate reuse, including changes made back to the old value with a new timestamp.
Different account, academic year, semester or group addresses a different record;
known conflicting course labels are rejected. Remote poll/timetable changes require
explicit refresh; they cannot be detected without rereading those sources.

Expired or selection_changed records return unknown without stored sessions.
Malformed/oversized records fail safely. Clear then re-save to recover corruption.
clear_saved_lab_schedule deletes only the explicit scope and preserves preferences,
other snapshots and Moodle. It can clear malformed regular files safely.

## Storage and cleanup

Versioned JSON lives in courses-mcp/saved-lab-schedules under the same OS app-data
parent used by lab preferences (LOCALAPPDATA on Windows; XDG_DATA_HOME or the local
share fallback elsewhere), outside the repository. Account and scope directory/file
components are hashes; course IDs remain in filenames. Records contain structured
slots, safe module URLs, provenance coordinates, verification times and a hash of
local selection settings. They contain no credentials, raw HTML/PDF text, raw poll
labels, participant lists or announcement bodies. This is not encryption.

Limits: 32 snapshots/account, 32 selected entries/snapshot, 64 KiB/file, seven-day
reuse. Atomic private-file replacement, account locks, symlink rejection and safe
errors reuse the preference storage implementation. Expiry does not automatically
delete files. Use clear_saved_lab_schedule for each obsolete scope; for complete
local removal, stop the server and remove only its saved-lab-schedules app-data
directory. No schema migration is currently supported; unsupported versions must
be cleared and explicitly recreated. No new dependency, SQLite or cloud sync.

Offline tests exercise real temporary JSON files, reconstructed storage/Moodle
instances, request counts and synthetic forum responses. They do not establish
live faculty compatibility or an independent security review.
