# Resumable local index refresh

Set MOODLE_CACHE_SEARCH_INDEXES=1 locally and restart the MCP client. These tools
perform explicit local writes; they never write to Moodle or poll in the background.

1. start_course_refresh(courseIds, documents?) creates one account-scoped job with
   1–4 explicit enrolled IDs and up to three selected HTML/PDF resource IDs. It
   records the selection but does not fetch course documents yet.
2. get_course_refresh returns aggregate state and counts after current enrollment
   checks: ready, cancelled, complete or empty, with processed/refreshed/partial/
   failed/pending counts and safe warnings. No course text, names or local paths
   are returned by these tools.
3. advance_course_refresh(action=next) processes one pending course through the
   existing forced search-index rebuild, then atomically checkpoints progress.
   Repeat explicitly while ready. action=cancel pauses between steps without
   discarding progress. action=resume continues a cancelled job with one step.

A ready job must finish or be cancelled before starting a replacement. Starting
after cancellation explicitly replaces the previous selection/checkpoint. A complete
job is a record of attempted work: partial/failed counts remain visible. Start a
new job to retry failed work; a repeated advance after completion does no work.
REFRESH_PARTIAL_STEPS and REFRESH_FAILED_STEPS disclose incomplete outcomes.

Each advance has one-course/three-selected-document bounds and inherits current
discovery/download/parser limits. It has no new hard whole-call wall-clock bound.
Cancellation is between calls, not a mid-download interrupt; shared MCP operations
remain serialized. The existing readers determine changed/deleted/denied-source
coverage and discard outdated snapshots when current evidence is incomplete.
Cache write failures count as partial, never a successfully persisted refresh.
No unselected resources are crawled. This rebuilds a course snapshot, not a
per-document delta download or an expansion of search's PDF page scope.

Schema-v1 checkpoints store only numeric selection IDs, per-course result states
and a timestamp outside the clone under courses-mcp/refresh-jobs, isolated by the
institution/account hash. The existing private storage enforces bounded records,
directory/link guards, exclusive account locks and atomic file replacement. No
credentials, sessions, source text or raw exception messages are persisted. Status
and each action recheck access; a revoked account cannot expose the old progress.

A normal restart resumes the next unprocessed course. A crash before checkpoint
commit may repeat the in-flight course; snapshot replacement and stable chunk IDs
avoid duplicate indexed chunks. A crash holding the lock can leave .account.lock:
stop all MCP processes before manually removing only that account's stale job lock.
Never automatically steal a lock. Corrupt checkpoints require manual removal and
recreation after stopping the server. Revoked jobs can be removed locally while
stopped, since tool-based status/cancel require current access. These files contain
local metadata and are not encrypted. Refresh jobs do not change lab preferences.

Tests use private temporary directories and synthetic readers to cover normal
restart, cancellation/resume, failed/partial source results, concurrent advances,
revocation/account switching, corrupt state and stale locks. Existing search/cache
tests cover changed/deleted evidence, stable replacement and real interrupted-writer
behavior. Live faculty compatibility is not established by these offline tests.
