# Moodle reader budgets

| Operation | Request and processing limits |
| --- | --- |
| Enrolled courses | Up to 100 API pages of 100 courses. 30 seconds for pagination after dashboard authentication and up to 10 seconds and 2 MiB per API response. |
| Course sections | Up to 20 logical pages, batches of four, 30 seconds total for traversal, 4 MiB per HTML response, 200 sections and 1,000 resources. |
| Saved poll, assignment and quiz | Up to 15 seconds and 2 MiB per HTML read. Assignment and quiz descriptions are capped at 10,000 characters. |
| HTML resources | Up to 15 seconds, five hops and 2 MiB per response. Returned text is capped at 20,000 characters. |
| News forums | Up to 30 seconds, three index pages, ten discussions, 2 MiB per response and 8 MiB checked across the traversal. Up to 40,000 characters of starter-post text. |
| Folders | Up to 30 seconds, five pages, 2 MiB per HTML response, 6 MiB checked across traversal and 200 returned items. |
| Selected PDF | Up to 15 seconds for retrieval and 10 seconds for extraction. The worker accepts up to 10 MiB and extracts up to 30 pages and 60,000 characters. |

Composite tools also perform enrollment and discovery. The limits above
apply to their named stages. See [tool contracts](MCP-CONTRACTS.md) for
search and deadline selection and output limits.

The enrollment API counts streamed bytes before parsing. For Playwright
request readers, the processed-body ceilings apply after Playwright can
already have buffered the response. The PDF worker timeout bounds extraction
time and its V8 limits constrain the JavaScript heap. Native memory is
outside those heap limits.

When adding a reader, record its request count, redirects, elapsed time,
processed bytes and output bounds. Test cleanup with synthetic responses
and confirm that truncated or failed reads preserve their coverage status.
