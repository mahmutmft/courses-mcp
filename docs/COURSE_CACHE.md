# Private course cache

CourseCache is an internal storage component for future indexing and search.
An integrating caller must explicitly enable it and provide an authorization
callback that checks the current account and course access before each read, write, inspect and delete operation. Only an explicit true grants access. A failed authorization check returns a fixed error without upstream details.
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
Both are internal operations. After Moodle access is revoked, the account owner can stop the server and remove the local record manually. Stop the server before manually recovering stale
locks or removing malformed files. Future schema changes require an explicit
migration or deletion and rebuild.
