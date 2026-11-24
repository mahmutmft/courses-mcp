# Report an unsupported Moodle layout

Use the [unsupported-layout issue form](https://github.com/mahmutmft/courses-mcp/issues/new?template=unsupported_layout.yml)
when an authorized course/activity page is readable in Moodle but its structure
cannot be read by an MCP tool. Existing bug, feature and task forms remain available.
For login/network problems, use the existing bug form with safe diagnostic codes.

The form asks for the tool name, content type, page language, package version or
commit, fixed diagnostic code, observed/expected behavior and generic reproduction
steps. Page language means Macedonian/English Moodle content, not the language in
which you ask your assistant questions. Use NONE when no diagnostic code is present.

## Prepare a safe public report

1. Copy only the tool name and a fixed uppercase diagnostic code, such as
   UNSUPPORTED_FORUM_POST_LAYOUT. Do not paste the full tool response or raw exception.
2. Describe the structure in your own words: for example, "the starter post's title
   is in a table above the body". Replace course-specific examples with invented
   text. Generic navigation is enough; real course names, IDs, URLs and raw poll
   selections are unnecessary. If mentioning a route, redact its IDs/query values.
3. State whether the tool returned partial, unsupported, empty or an error, and
   the read-only behavior expected. Missing text is not proof that no content exists.
4. Review every field and attachment before submitting. Public reports must contain
   no .env/config files, passwords, indices, names, grades, cookies, tokens, personal
   paths, screenshots, downloaded PDFs, raw HTML, browser logs or private faculty text.

The privacy checkbox is a reminder, not an automatic redaction filter. GitHub
still accepts text and attachments; the form cannot prevent someone from posting
sensitive content. If unsure, leave the detail out. Security findings should follow
[SECURITY.md](../SECURITY.md), without publishing sensitive exploit details.

## Fictional example

- Tool: get_announcements
- Content type: Announcement forum
- Page language: English
- Diagnostic: UNSUPPORTED_FORUM_POST_LAYOUT
- Observed: a fictional news post puts its title and body in a table rather than
  the supported header/content containers; the tool returns partial coverage.
- Expected: read the starter post with provenance or explain the unsupported layout.
- Steps: open a course's news activity, ask the tool to read it, observe the code.

No original faculty file or student record is needed. Maintainers can construct a
small synthetic HTML fixture reproducing that structure and test it offline.
Keep parser changes in focused issue-linked PRs. Do not request someone else's
credentials or access, and do not weaken ownership/redirect checks to read a page.

A report is not a guarantee of support. Image/scanned PDF OCR, quiz attempts,
submissions, grades and participant lists remain outside the current reader scope.
