# Student quickstart

This guide describes features on the default branch. The package is pre-v1;
the [roadmap](ROADMAP.md) also includes future work. Moodle access is read-only.
Explicit personal preferences, optional search indexes and confirmed schedules
can be stored locally by their respective tools.

## Install and connect

1. Install Node.js 24+ with npm, open PowerShell, then:

   ```powershell
   git clone https://github.com/mahmutmft/courses-mcp.git
   Set-Location courses-mcp
   npm run setup
   ```

   Setup installs locked dependencies/Chromium, checks local startup and creates
   a blank `.env` only if missing. It does not sign in or change client settings.
   If a download stalls, use the [setup/recovery checklist](SETUP_CHECKLIST.md).
   First-download success is environment-dependent; no fixed setup time is promised.

2. Open this project's `.env` locally and fill `MOODLE_USERNAME` and
   `MOODLE_PASSWORD` with your normal faculty login. Keep
   `MOODLE_BASE_URL=https://courses.finki.ukim.mk`. Search caching is optional,
   disabled by default (`MOODLE_CACHE_SEARCH_INDEXES=0`). Do not overwrite an
   existing `.env` or paste its contents into chat/issues. Git ignores it, but
   cloud-sync software can still copy ignored files.

3. Review the configuration printed by setup and add its command/args to your
   compatible stdio MCP client. The printed `mcpServers` JSON works for clients
   accepting that format; other clients have their own settings format. See the
   [generic connection example](../README.md#connect-an-mcp-client). Generated
   personal paths belong on your machine, not in public reports.

4. Restart/reconnect the client and check that `list_courses` appears. Setup's
   local SDK check is separate from your actual client connection. Authentication
   starts on the first authorized read. Optional `npm run doctor` attempts one
   login and prints aggregate diagnostics; offline development needs no login.

The server finds `.env` relative to its installation, regardless of client working
directory. Client-supplied environment variables take precedence. After an update,
stop the connection, update the checkout, run `npm run setup`, then restart it to
discover new tools. Existing `.env` and local settings are preserved.

## Get a first result

Ask: **“Use FINKI MCP to list my enrolled courses. Include their source links.”**

Or: **„Користи FINKI MCP и прикажи ги моите запишани предмети со линкови до изворите.“**

Then choose a course and explicit academic year/semester. Course filters use name
labels, not today's date; unresolved classifications remain unknown. A missing
tool is a connection/discovery problem. A login timeout does not prove incorrect
credentials: use [login troubleshooting](../README.md#login-troubleshooting) before
another explicit attempt. Do not automatically keep retrying failed authentication.

## Example questions

Year, dates and search text below are examples, not a student's actual schedule.
Replace them with your selected course/semester/range. Preserve source links and unknowns.

| Goal | Macedonian | English |
| --- | --- | --- |
| Semester | „Прикажи ги предметите за зимскиот семестар 2026/2027 со изворни линкови.“ | “List my winter 2026/2027 courses with source links.” |
| Materials | „Во избраниот предмет пребарај ‘Example topic’. Прво покажи кои PDF документи ќе ги читаш; наведи страници и извори.“ | “Search the selected course for ‘Example topic’. Identify PDFs before reading them; cite pages and sources.” |
| Deadlines | „За избраните предмети прикажи рокови за задачи и квизови од 23 до 29 ноември 2026. Оддели ги од лабораториските термини.“ | “Show published assignment/quiz deadlines for selected courses from 23–29 November 2026, separately from lab attendance.” |
| Poll selection | „Прочитај го мојот избран термин од избраната анкета. Не менувај ништо. Ако крајниот час недостига, кажи дека е непознат.“ | “Read my saved selection in the chosen poll without changes; keep a missing end time unknown.” |
| Weekly labs/calendar | „За избраните предмети и распоред/објави прикажи лаборатории од 23 до 29 ноември 2026, со промени и неизвесност. Потоа прикажи календар.“ | “For selected courses and timetable/news sources, show labs for 23–29 November 2026, including changes and uncertainty, then show a calendar.” |

Course-page search does not read every linked file. Cross-course search may read
explicitly selected supported HTML/text-PDF resources. Scanned PDFs/OCR, arbitrary
attachments and unselected documents remain outside that search. For a long PDF,
follow `read_resource.nextPage`; partial/unread pages remain explicit even at the
end. See [tool contracts](MCP-CONTRACTS.md) for exact inputs and bounds.

## Interpret the answer

- `partial` means incomplete coverage/fields; `unsupported` means an unreadable
  format/layout. An empty result does not prove nothing exists.
- `unknown` means insufficient evidence. Weekly `confirmed-none` applies only
  within the explicitly checked applicable sources, not every faculty source.
- An exemption/group preference is your declaration, not faculty verification.
  Reading a poll never votes. A due/closing date is not a lab presentation time.
- Saved schedules are explicit, expire after seven days and check the selected
  news forum. They are not automatic semester-long memory or complete homework
  coverage. See [confirmed schedule reuse](SAVED_LAB_SCHEDULES.md).
- Source-check times, publication dates and local preference/cache write times
  differ. Do not replace missing timezones/end times with assumptions.

For unreadable layouts, use the [safe reporting guide](REPORTING_LAYOUTS.md).
Report generic structure and fixed codes, without private course text/screenshots.
Returned material goes to your configured AI client/provider; a local MCP server
does not make all assistant processing offline. See [evidence/privacy](TRUST_AND_PRIVACY.md).
To help improve the project, read [CONTRIBUTING.md](../CONTRIBUTING.md); offline
contributions need no faculty credentials.

Try the [synthetic demo conversation](DEMO.md) for a source-linked result and a partial-coverage explanation without faculty access.
