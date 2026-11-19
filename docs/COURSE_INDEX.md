# Bounded lexical index

## Search selection

search_courses keeps courseIds required (1–4 enrolled IDs). Optional academicYear
(consecutive YYYY/YYYY) and semester (winter/summer) intersect those explicit IDs
using the same naming rules as list_courses. They never select other enrollments
or infer the current term from the date. Without filters, every requested ID is
searched as before, including courses with unclassified names.

The additive selection object reports requestedCourseIds, searchedCourseIds,
filteredOutCourseIds, unclassifiedCourseIds, filters and classificationSource.
filteredOutCourseIds includes unresolved IDs; unclassifiedCourseIds is that
uncertain subset. Only known matching IDs are fetched. Any unresolved selected
labels make aggregate coverage partial; empty hits then mean unknown. If all
requested IDs are known nonmatches, the empty selected scope returns read/no_match,
not a statement about courses outside those IDs. No page is fetched in either
empty-scope case. A requested document outside the filtered scope fails explicitly.
Enrollment is checked before filtering, so a filter cannot bypass course access.

Example: courseIds=[42,43], academicYear=2026/2027, semester=winter searches only
the matching winter course among those two IDs. Returned checkedAt values describe
current source checks; indexReused does not imply stale permission reuse. Limits,
ranking, selected-document coverage and the existing search_course tool are unchanged.

buildCourseIndex consumes one authorized course discovery and explicitly supplied
reader results. It does not fetch content, determine enrollment, or crawl files.
search_courses supplies up to four selected courses and three selected HTML/PDF
resources after live enrollment/discovery checks. Unselected documents and folder
files remain outside that tool's current search scope. This module can process
reader-shaped evidence independently; it is not a full-course PDF search service.

Index version 1 identifies this extraction/chunk/token contract. It retains course
identity, source status/name/check time and chunks with stable SHA-256 identities,
source URL, original PDF page number (null for course/HTML text), excerpt and tokens.
HTML table content uses the authorized reader's linear text, not table geometry.
Repeated source URLs and repeated PDF page references are not indexed twice;
invalid page references and bounded omissions produce warnings/partial coverage.

Limits are 32 sources, 96 chunks, 1,000 Unicode code points per chunk and a bounded
192,000-code-unit input prefix per text block. The decoder accepts at most 1 MiB.
Unicode NFKC/lowercase tokenization supports MK/EN text and other Unicode words;
there is no translation, stemming or automatic diacritic removal. Oversized tokens
are skipped instead of becoming fragment matches. A cut incomplete final word is
removed from both excerpt and tokens. Ranking counts unique query-term matches;
ties use stable IDs. This is lexical ranking, not BM25 or semantic search.

Cached decoding checks version, course ID, known fields, unique source/chunk IDs,
bounded excerpts, valid pages and exact token/excerpt consistency. The search
adapter additionally supplies currently authorized source URLs and observed
source/page pairs. An unsupported source cannot contribute a chunk. Invalid
cached indexes produce CACHE_INDEX_INVALID and rebuild from current evidence;
the stored fingerprint alone does not bypass validation. This does not provide
cryptographic authenticity or eliminate the need for current access checks.

Synthetic tests cover MK/EN table text, composed Unicode, PDF pages, duplicate
and unsupported sources, source/chunk/text/token limits, stable reconstruction,
invalid cached tokens/URLs/pages and the live-reader-to-cache fallback path.
Account isolation and revocation are exercised by cache/search tests. Parser and
retrieval benchmarks remain synthetic and do not establish every faculty layout.
