# Student workflow acceptance matrix

This records the offline integration portion of [#125](https://github.com/mahmutmft/courses-mcp/issues/125).
It does not close the final-candidate live acceptance gate or independent review
[#48](https://github.com/mahmutmft/courses-mcp/issues/48).

Run `node --test test/student-workflows.test.js test/protocol.test.js` or `npm test`.
The workflow suite initializes an SDK client against the production tool
registration using the SDK's in-memory JSON-RPC transport. It calls tools through
Client.callTool, including argument validation, queue admission, result encoding
and safe errors. Production stdio startup and the same schema/annotation baseline
are checked separately by protocol.test.js. This is not a desktop GUI client test.

Synthetic enrollment/discovery, document-reader responses and authenticated GET
responses replace the faculty network boundary. Group resolution, choice/forum/
assignment/quiz parsing, weekly/calendar aggregation, private preference files and
saved schedule files use production code. Restart coverage reconstructs both MCP
server and Moodle/storage instances using the same temporary private directory.
It does not stop/start a desktop client or prove CAS compatibility. All temporary
settings are synthetic; no faculty credentials or private material are required.

| Scenario | Public MCP path | Required interpretation | Integration evidence |
| --- | --- | --- | --- |
| Semester selection and different groups | list_courses → get_choice_selection → set_lab_preference → get_weekly_labs | Explicit winter scope; course A and B retain their own group/time/source. Reading a poll does not write attendance. | discovery → semester → poll → preferences test |
| Recognized/exempt labs | set_lab_preference → get_weekly_labs | Explicit local exemption; skip course discovery, not faculty verification. | first workflow excludes exempt course from discovery |
| Unknown poll selection and mixed coverage | get_weekly_labs | Unknown is not absence; preserve another course's known candidates. | unknown selection/homework test |
| Dated and undated homework | get_lab_schedule / get_weekly_labs | Published supported title dates stay separate from undated homework. Undated homework prevents a complete absence claim. | homework/deadline workflow |
| Assignment/quiz dates | get_assignment / get_quiz | Published due/closing date is not a lab presentation. Never return submission forms. | homework/deadline workflow |
| Whole/remaining week | get_weekly_labs, fromDate | Include the entire selected day; retain a supported move from earlier that same week. | first and move workflows |
| Cancellation and calendar | get_weekly_labs → get_lab_calendar | Scoped confirmed-none requires complete applicable evidence and cancellation of every known selected slot. Keep cancelled calendar event/evidence. | cancellation workflow checks checksComplete |
| Move and conflicting updates | get_weekly_labs | Preserve original source, null unknown end time and conflicting proposals. Conflicts mean unknown. | cancellation/move/conflict workflow |
| Stale/failed/partial evidence | get_weekly_labs | No confirmed absence, no raw network error. | failure workflow |
| Instruction-shaped course text | get_announcements → get_lab_preference | Text remains evidence; it cannot invoke local writes. External assistant behavior is outside this test. | failure/untrusted-text workflow |
| Current authorization | get_weekly_labs after enrollment revocation | Deny before returning course evidence. | failure workflow |
| Explicit save and restart | save_lab_schedule → reconstructed server → get_saved_lab_schedule | Reuse structured slots without course/poll/document reads; retain original verifiedAt. | saved schedule workflow asserts discovery and document read counts |
| Failed refresh, expiry, changed group and clear | save/get_saved_lab_schedule, set_lab_term_preference, clear_saved_lab_schedule | Failed refresh preserves snapshot; stale news/expiry/changed selection stays unknown; clear is explicit and scoped. | saved schedule workflow |
| Skopje DST and New Year | get_lab_calendar | Keep civil start time/timezone; distinct stable dated event IDs. No inferred UTC instant. | DST/year-boundary workflow |

## Example questions

Use these only with explicit course IDs/source selections already discovered in
the user's authorized courses. The tests validate tool behavior, not natural-language
model understanding. The server does not automatically infer the current semester,
choose evidence sources or write preferences from a question.

- MK: „Прикажи ги предметите за зимскиот семестар 2026/2027.“
- EN: “List my courses for winter 2026/2027.”
- MK: „Прочитај го мојот избран термин од анкетата. Не менувај ништо.“
- EN: “Read my saved poll selection without changing it.”
- MK: „За овие предмети и извори, кои лаборатории ги имам од среда до недела? Прикажи ги и неизвесните податоци.“
- EN: “For these courses and sources, show labs from Wednesday through Sunday, including uncertainty.”
- MK: „Прикажи ги лабораториите во календар, вклучувајќи откажани и преместени термини.“
- EN: “Show the lab calendar, including cancelled and moved sessions.”
- MK: „Користи го претходно потврдениот распоред и провери нови објави. Кажи кога е последен пат потврден.“
- EN: “Reuse my confirmed timetable and check current announcements; show its original verification time.”

## Final-candidate live check: outstanding

On the actual v1 candidate, a consenting student should use their own local
configuration and a supported client to perform one bounded read-only check:
filtered enrollment, one known saved choice, one course/weekly overview, selected
supported timetable/news evidence and a short calendar range. Local preferences
and snapshot writes require separate explicit confirmation; do not change them
just to make a test pass. An unsupported live layout should be recorded as such,
not converted into a synthetic success or a complete schedule claim.

Record candidate SHA, OS/Node/client versions, scenario/status, aggregate counts
and non-sensitive limitations only. Never copy faculty content, names, course
rosters, raw poll labels, credentials, cookie values or personal filesystem paths
into the record. If the live check is unavailable, #125 remains open. A successful
offline suite is not a substitute for that check or independent security review.


## Live compatibility follow-up (2026-11-27)

An authorized bounded MCP check successfully read semester-filtered enrollment,
two saved choices, quiz metadata and a remaining-week overview. Unknown poll end
times, attendance settings, quiz timezone and undated homework stayed explicit.
No Moodle or local preference writes were performed. The installed connector
revision was not established, so this is not final-candidate acceptance.

A selected PDF was a student roster with term labels rather than a supported
standalone timetable. Roster pages are deliberately excluded from timetable
extraction and now report `TIMETABLE_ROSTER_UNSUPPORTED`. Weekly and calendar
results expose fixed `WEEKLY_TIMETABLE_UNSUPPORTED` and
`WEEKLY_TIMETABLE_ROSTER_UNSUPPORTED` reasons. They remain unknown/partial; poll
labels and roster rows cannot establish recurrence or a dated obligation.
Synthetic tests cover these paths without copying any private document data.

One calendar request returned `CALENDAR_REFRESH_UNAVAILABLE`; a subsequent weekly
request with the selected evidence succeeded with incomplete coverage. The
calendar interruption's cause is not established. Connection/access failures
still fail closed; there is no automatic login retry. Unsupported timetable
content alone is tested to return a partial calendar, rather than a refresh
failure. Independent quiz-view comparison and final-candidate checks remain open.
