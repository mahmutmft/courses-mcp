# Source-backed timetable extraction

get_lab_timetable(courseId, resourceId) reads one currently discovered supported Moodle HTML or text-PDF resource through the existing read_resource authorization/origin/response guards. It adds no fetch routes or persistence. It returns conservative normalized candidates for downstream scheduling, not confirmed personal attendance or expanded weekly occurrences. Choose a numeric resource module ID from get_course; arbitrary URLs and roster-based group inference are not supported. All groups in the supported source are returned; this tool does not overwrite or filter the user's private group preferences.

## Supported layouts

HTML tables must have one header row and only recognized, unique column names. English/Macedonian/Albanian aliases are supported for Group/Група/Grupi, Day/Ден/Dita, Time/Час/Ora, Start/Почеток/Fillimi, End/Крај/Mbarimi, Room/Просторија/Salla, Dates/Датуми/Datat, From/Од/Nga, Until/До/Deri, Timezone/Временска зона/Zona kohore, Recurrence/Повторување/Përsëritja and Anchor/Почетна недела/Data bazë. See src/timetables.js for the exact alias list. Merged cells, nested tables, unknown headers (including student names/indices), duplicate headers and mismatched cell counts are rejected with coverage warnings. Values are never inherited from neighboring rows or tables.

Text-PDF and plain HTML text support **one record per line**, using explicit key:value fields separated by pipes. Fields must all have recognized, unique labels. No table reconstruction from whitespace, unlabelled PDF columns, multi-line inheritance, scanned-page OCR, natural-language announcement interpretation or implicit faculty timezone is attempted.

Synthetic example of a dated record:

~~~text
Group: B | Day: Monday | Time: 10:00-11:30 | Room: 123 | Dates: 2026-11-09, 2026-11-23 | Timezone: Europe/Skopje
~~~

Synthetic example of a bounded weekly rule:

~~~text
Group: B | Day: Monday | Start: 10:00 | End: 11:30 | Room: 123 | From: 2026-10-01 | Until: 2026-12-31 | Timezone: Europe/Skopje | Recurrence: weekly
~~~

Dates accept calendar-valid YYYY-MM-DD or D.M.YYYY with all components present. Date lists use commas/semicolons (at most 32 dates per record); ranges are represented by separate From/Until fields, not guessed from shorthand. Times use 24-hour HH:mm with optional dash-separated end time. End time must follow start time within the same day; overnight/ambiguous/AM-PM layouts remain unresolved. Weekdays use exact supported MK/EN/SQ names. Room/group are bounded tokens; supported Cyrillic equivalents normalize consistently with private term preferences. Timezone must be an explicitly supplied supported IANA-style name or UTC; abbreviations such as CET are unresolved. No dates or teaching periods are inferred from the current date, publication time or semester name.

## Output and uncertainty

Each entry contains a stable ID, course/group, weekday, local start/end/room, timeZone, explicit dates or effectiveFrom/effectiveUntil, optional recurrence and anchorDate, status, warnings and sources. Sources include the original module URL, resolved HTML URL when available, checkedAt and table/row or PDF page/line positions. IDs exclude retrieval time; exact duplicate entries retain all evidence positions. Different values/versions are preserved; overlapping same-group slots are flagged without automatically picking the newer row or changing preferences. Missing fields remain null. The extractor returns no raw roster text, student names or index numbers from rejected tables/lines.

A complete entry is a **candidate**, not a confirmed scheduled obligation. Missing/conflicting values, unbounded periods, unspecified recurrence, mixed rule types, unknown timezone, inconsistent date/weekday or absent alternate-week anchor make it incomplete. A partial source also makes its entries incomplete. Source-reader warnings/coverage and extraction limits remain visible. Unsupported or empty results never mean no labs. Candidate status describes supported field extraction only; it does not establish source authority, cancellation coverage or the student's group applicability.

Weekly and alternating rules are recorded only when explicit. Alternating rules require an explicit anchor before being considered complete. No recurrence is expanded here: issue #32 supplies that next stage, while #33 handles announcements/exceptions and #34 the full cross-course weekly answer. Existing get_lab_schedule behavior is unchanged by this increment.

## Bounds and testing

Existing HTML/PDF reader limits apply first. The extractor inspects at most 10 tables, 100 data rows per table, 30 PDF pages, 60k text characters and 1,000 text lines per block; it retains at most 200 unique entries and inspects at most 1,000 candidate records. Output warnings identify limits rather than implying complete source coverage. Parsing is deterministic, bounded and uses no model/provider dependency. Supported extraction is tested with synthetic MK/EN/SQ tables, selected dates, bounded/alternating rules, overlapping versions, missing/invalid fields, merged cells, roster/injection-shaped data, partial/image-only sources and a real PDF-worker pipeline fixture. No private faculty schedules are committed.

Restart the MCP connection after updating to discover the new read-only tool. Faculty documents with unsupported layouts can still be read through read_resource; this extractor reports its narrower supported grammar explicitly.
