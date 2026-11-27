# Explicit lab calendar export

First call get_lab_calendar with the courses, date range and selected evidence you
want to review. Then, only on an explicit export request, call export_lab_calendar
with the same scope and the chosen eventIds from that result. It rereads current
calendar evidence; IDs that disappeared or became conflicting are reported as
skipped. At most four courses, 1–31 inclusive dates and 100 distinct selected IDs.

The result contains private `content` (ICS text), `mediaType`, `suggestedFilename`,
`exportedCount`, `skipped` reasons, warnings and scope. Nothing is saved, uploaded,
subscribed or written to a calendar. The user chooses a local destination and
reviews any overwrite/import separately through their own client. Do not publish
real exports in issues, fixtures or commits. Returned ICS still passes through the
configured AI client/provider just like other tool responses; CLASS:PRIVATE is a
calendar label, not encryption or an access-control guarantee.

Example question: „Извези ги само термините што ги избрав од овој календар во ICS.
Не внесувај непознати или конфликтни термини и не зачувувај датотека без мој избор.“

English: “Export only the events I selected from this calendar as ICS. Skip unknown
or conflicting entries; let me choose where to save it.”

## Time and uncertainty policy

- A date, start, end and explicit supported timezone must all be known. Missing
  end times are skipped, never replaced with a default duration or zero-length event.
- Supported zones are Europe/Skopje and UTC, with export years 1970–9998. Conversion
  uses the runtime's Intl timezone database. UTC DTSTART/DTEND values carry Z;
  original civil time/zone remain in DESCRIPTION. No floating/default local times.
- Nonexistent spring-forward and ambiguous autumn repeated times are skipped.
  No offset is guessed. Reversed/overnight same-date ranges are skipped too.
- Conflicts/collisions and unsafe/missing citations are skipped even when
  includeUncertain=true. Unknown/stale event checks do not become fresh exports.
- By default uncertain events are skipped. Explicit includeUncertain=true permits
  otherwise valid dated entries as STATUS:TENTATIVE. An uncertain cancellation
  is always skipped. Source-backed confirmed cancellation stays STATUS:CANCELLED;
  supported moved events use the replacement slot and retain change source links.

`ready` means all selected entries were serialized, not exhaustive faculty coverage.
`partial` means some were skipped; `empty` returns content=null. Every skipped ID
has a reason. Unselected/omitted events and an empty export never prove no labs.
The existing calendar readers, enrollment/freshness checks and scopes remain in
effect. No new automatic login retry, persistence or broad source crawl is added.

## File semantics and limits

UID derives from the calendar's existing stable event ID. It stays the same when
that calendar preserves the original identity through a supported move/cancellation.
A newly identified or directly rewritten source slot may receive a different ID;
there is no persistent synchronization history or invented SEQUENCE counter.
DTSTAMP records export time, not a source modification. Original verification
time and safe source links remain in DESCRIPTION; one safe source is also in URL.

METHOD:PUBLISH contains no invitations, attendees, organizer, alarms or recurrence
rules. One dated event is emitted for each selected occurrence. Import/update and
cancelled-event behavior varies by calendar client: repeated imports may duplicate
events. Stable UIDs do not promise automatic Google/Outlook synchronization or deletion.

RFC 5545 TEXT values escape backslashes, commas, semicolons and newlines. Lines
use CRLF and fold at at most 75 UTF-8 octets without splitting code points.
Sources are restricted to safe canonical faculty course/activity routes with one
ID parameter, without tokens/actions. Maximum 16 distinct sources per event and
256 KiB of ICS text; the normal 1 MiB MCP output cap also applies. Narrow the
selection on ICS_OUTPUT_LIMIT. All bounds are checked without filesystem writes.

## Validation and dependency

`ical.js` 2.2.1 is a test-only devDependency used as an independent iCalendar parser
to verify actual output, rather than only checking serializer-shaped strings.
It is not imported by the server or the serializer; no runtime dependency was added.
Tests cover independent parsing, UTC/DST/year behavior, stable identity after
moves/cancellations, null/conflict/stale exclusions, tentative opt-in, malicious
TEXT/URL input, CRLF/UTF-8 folding, and the public SDK tool path.

Reference: [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545), especially sections
3.1 (content lines/folding), 3.3.5 (DATE-TIME) and 3.3.11 (TEXT). These tests do not
establish every calendar client's import behavior or live faculty compatibility.
