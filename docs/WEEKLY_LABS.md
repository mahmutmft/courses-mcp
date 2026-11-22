# Weekly labs from selected evidence

get_weekly_labs keeps its required explicit courseIds (1–4) and Monday weekStart.
fromDate still selects that whole local Europe/Skopje day through Sunday. Select
semester/year via list_courses first; the weekly tool does not guess a semester.

Optional evidence contains at most one pair per selected course:

~~~json
{
  "courseIds": [42],
  "weekStart": "2026-11-16",
  "fromDate": "2026-11-18",
  "evidence": [{ "courseId": 42, "resourceId": 7, "forumId": 8 }]
}
~~~

IDs above are synthetic. Choose the discovered timetable resource and same-course
news forum using get_course. The adapter reuses authorized get_lab_timetable and
get_announcements readers, never arbitrary URLs or roster inference. Each pair
is read sequentially, at most one timetable and forum per selected course; existing
reader/worker/output bounds apply. There is no new whole-call wall-clock deadline.
Invalid/unselected/duplicate evidence pairs fail before tool authentication.

## Personal selection and answer states

Local exemptions are applied first and skip timetable/forum reads for that course.
They remain user-declared, not faculty confirmation. Other courses need the group
resolved by the existing saved-choice/manual-term precedence; conflicts or missing
groups remain unknown. Never save an attending/group preference implicitly just
to make a query produce a definite answer.

Legacy status and its partial/exempt behavior are retained for existing clients.
The additive per-course and aggregate answerState field distinguishes:

- scheduled: candidates in the selected scope passed the checks below.
- confirmed-none: all known in-range slots in that selected evidence were explicitly
  cancelled, no active candidate remains, and all checks passed. This is not a
  claim about other resources, forums, staff messages or unselected courses.
- unknown: missing/unchecked/partial/stale/conflicting evidence or empty discovery.
- exempt: local user-declared exemption. It is not inferred from no hits.

For a definite scoped answer, the user must have declared attending, a group must
be resolved, the selected timetable and news read must be complete in their
supported formats, expansion/change resolution must have no unresolved evidence,
and the existing course/homework evidence must not introduce uncertainty. Schedule,
timetable and forum checks must be no older than five minutes and not in the
future, including a final freshness check after all courses finish. These thresholds
describe tool evidence age, not a promise that staff will not change the schedule.

Foreign/unknown timetable timezones, undated homework, unresolved dates/groups,
conflicting end times and unavailable readers prevent a definite answer. Missing
replacement end times remain null. An empty remaining-week result without explicit
cancellation evidence stays unknown, even if a weekly row was read successfully.

## Recurrence, changes and provenance

The existing bounded recurrence resolver expands the original Monday–Sunday week,
then supported announcement cancellations/moves are applied and projected into
the selected fromDate–Sunday range. A Tuesday original moved to Thursday is still
shown when asking from Wednesday. Moves whose originals are outside the original
week remain outside this resolver; the scope explicitly discloses that limitation.

Only the resolved student's group is projected. Original IDs and source locations
survive, moved candidates carry changeEvidence, and cancelled/conflicting sessions
remain in per-course evidence.sessions for review. Matchable title candidates are
reconciled conservatively with selected timetable slots; unmatched title evidence
prevents a definite answer. Conflicting known end times preserve both proposals.
Sources are not silently replaced by the newest timestamp.

Per-course evidence records timetable/news URLs, check times, checksComplete,
sessions, warnings and its selected-source scope. checksComplete describes those
checks, not exhaustive faculty coverage. Dated candidates are sorted separately
from termLinkedHomework. The top-level answer remains unknown if any selected
nonexempt course is unknown; individual known results stay visible.

Without evidence pairs, the existing title/homework overview still works and
remains unknown/partial (or explicitly exempt). No automatic document crawl,
background polling, preference writes or new persistence is introduced.

## Validation

Synthetic tests cover current recurrence, explicit cancellation-only absence,
moves into a remaining-week range, stale/failed/partial readers, mixed exemptions
and unknown courses, group/attendance uncertainty, conflicting changes/end times,
null end times, DST/year boundaries, duplicate input limits, safe failure retention
and evidence becoming stale during later course reads. Adapter tests exercise the
current authorized readers; stdio tests verify input validation and the additive
schema inventory. No private faculty material is committed. Final live student
workflow verification remains #125, and independent security review remains #48.
