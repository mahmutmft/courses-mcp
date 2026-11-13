# Private course cache

CourseCache is an internal storage component for future indexing and search.
An integrating caller must explicitly enable it and provide an authorization
callback that checks the current account and course access on each read and write.
Only pass supported, sanitized course text and its derived index.

The store uses the OS application data directory beside lab preferences, under
courses-mcp/course-cache. The institution and username determine the account
namespace. Local filesystem permissions protect the records. Credentials and
cookies are outside the record contract.

Schema v1 stores one JSON record per course with content and index together.
Writes use an exclusive lock and atomic replacement. Records above 1 MiB or with
unsupported schema fail validation. Reads treat records aged seven days or more
as misses. Expiry does not remove files from disk.

Inspect returns size and timestamp. Delete removes the content and index together.
Both are internal operations. Stop the server before manually recovering stale
locks or removing malformed files. Future schema changes require an explicit
migration or deletion and rebuild.
