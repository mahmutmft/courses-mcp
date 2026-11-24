# Changelog

## Unreleased

- Adopt GNU GPL version 3 only (GPL-3.0-only), with project attribution, contribution terms and matching npm metadata.

- Add a dedicated unsupported-Moodle-layout issue form and fictional reporting guide, with privacy reminders and safe diagnostic fields.

- Exercise semester/group, weekly lab, calendar and saved-schedule workflows through the production MCP registration with synthetic SDK integration tests; document the supported scenarios and outstanding final-candidate live acceptance.

- Add explicit private semester/group timetable save, reuse and clear tools, retaining original verification times and freshly checking selected announcements without reopening course pages or polls.

- Add a read-only weekly/monthly lab calendar projection with stable event IDs, source evidence, cancelled/moved entries and explicit uncertainty.

- Resolve selected weekly timetable/news evidence into scoped scheduled/cancelled/unknown answers while preserving exemptions, freshness and undated homework.

- Clarify evidence/privacy for every tool category and ask clients to retain source citations, uncertainty and user-declared preference provenance.

- Keep same-group lab move collisions unresolved and require valid publication/update instants before applying structured changes.

- Bound the shared session queue to eight pending actions, skip cancelled queued work, and document all reader/composite resource limits.

- Lock public tool schemas/annotations with a reviewed stdio inventory and return TOOL_OUTPUT_LIMIT instead of emitting oversized JSON text.

- Add opt-in, account-scoped refresh jobs with one-course checkpoints, progress counts and explicit cancellation/resumption across restarts.

- Narrow cross-course search by explicit academic year/semester and report searched, excluded and unclassified course IDs.

- Validate reused search indexes against current source/page citations and excerpt-derived tokens; rebuild inconsistent snapshots from live evidence.

- Report local cache freshness explicitly and reject noncanonical cache timestamps; verify quota contention and interrupted-writer recovery.

- Add npm run setup for guided dependency/browser installation, local startup checks and copyable MCP client configuration without overwriting .env.

- Continue PDF resource reads with startPage and nextPage while preserving per-call limits and original page citations.

- Filter weekly lab candidates from an explicit local day through Sunday, preserving uncertainty and undated homework.

- Add a partial weekly overview of published lab candidates across selected courses.
- Inspect and clear a selected course cache through MCP with current enrollment checks.

- Allow cross-course search to explicitly rebuild its index with refresh=true.

- Read enrolled Moodle courses, materials, saved choices, assignment and quiz dates, and announcement posts.
- Expand supported lab timetable dates and retain evidence for explicit cancellations or moves.
- Report published coursework dates across selected courses.
- Report the package version in the MCP initialize response.

See docs/RELEASING.md for versioning and migration conventions.
