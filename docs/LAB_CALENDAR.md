# Read-only lab calendar

get_lab_calendar(courseIds, range, evidence?) projects existing weekly evidence
for an inclusive range of 1–31 civil dates. Use seven dates for a weekly view or
the actual first/last day for a month. It returns data usable by a client without
a website, external calendar account, event write or ICS export.

~~~json
{
  "courseIds": [42],
  "range": { "from": "2026-11-01", "through": "2026-11-30" },
  "evidence": [{ "courseId": 42, "resourceId": 7, "forumId": 8 }]
}
~~~

IDs above are synthetic. Enrollment and discovered timetable/forum checks follow
[weekly lab contracts](WEEKLY_LABS.md). Evidence is optional, with at most one pair
per selected course and at most four courses. Omitting it does not invent certainty
or automatically discover/read every document.

## Projection

Events retain stable account-independent course/session IDs, local date/start/end,
timeZone, room, group, source references and checkedAt. Missing end/timezone values
remain null; no default duration or UTC instant is invented. viewTimezone identifies
the Europe/Skopje query context, not a replacement for a missing event timezone.

Moved entries use the replacement date/time and retain original evidence. Cancelled
entries remain visible on their original date and are not active obligations.
Uncertain/conflicting entries are flagged; source change proposals and contradictory
end times remain available. Only entries whose effective date is in the requested
range are included. A move out of range is outside this view; it is not erased from
the underlying weekly evidence. Moves from originals outside the processed weeks
remain outside automatic resolution.

Repeated snapshots of one stable session merge their citations rather than becoming
duplicate events. A title candidate matched to a resolved session does not produce
a second event. Inconsistent snapshots retain proposals with conflict status rather
than silently choosing the newest view. Same-start-time events can carry collidesWith
IDs; cancelled events are excluded from this check. This is a same-start collision
indicator, not a complete interval-overlap or travel-time detector.

Per-week course answer states/warnings are retained. Source and schedule freshness
are checked again when returning the calendar, including empty/cancelled views.
Stale data or any uncertain event/week makes status partial. read means the selected
projection was read, not that it covers all faculty sources or proves no labs.

## Bounds, authorization and failures

A 31-day range covers at most six Monday–Sunday weeks, including boundary weeks.
Weekly schedule reads retain their existing limits. Selected timetable/news pairs
are shared only in memory within this single calendar request, with original check
times, and fetched at most once per pair. Nothing is persisted by this tool. A new
calendar call reads again; saved semester reuse remains a separate feature.

Current enrollment is checked before work, during weekly reads and again before
returning evidence. A lost selected enrollment withholds the result. A failed week
or unavailable source stops further week reads; the adapter returns the fixed
CALENDAR_REFRESH_UNAVAILABLE error rather than automatically retrying logins or
returning previously collected private data. Supported partial/unknown evidence
can still produce a partial view. Individual readers/workers retain their limits;
there is no hard new whole-month deadline. The shared queue and 1 MiB success-text
limit still apply. Narrow the range/courses if the output is too large.

## Validation

Synthetic tests cover weekly/monthly ranges, six-week month boundaries, preserved
null end times/timezones, stable refresh IDs, duplicated title/session evidence,
moved and cancelled entries, repeated conflicting snapshots, same-start collisions,
DST/year boundaries, stale evidence at return time, fail-stop reads, request-local
source sharing and final enrollment revocation. Actual stdio tests verify tool
discovery, read-only annotation and invalid range/scope rejection before login.
No live faculty compatibility or external calendar synchronization is claimed.

After reviewing event IDs, an explicit [ICS export](LAB_ICS.md) can serialize eligible selected events without saving files or changing an external calendar.
