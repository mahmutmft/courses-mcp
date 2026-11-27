# Windows setup verification — 2026-11-25

Related: #124. Tested source revision:
`998c715381e7a47fd5b947490be30d22f79917f1` (pre-v1, package 0.1.0).
This is observed compatibility evidence, not final release approval.

Environment: Windows build 26300, PowerShell 7.6.9, Node 24.18.0, npm 11.16.0.
Source was exported from tracked Git files into a fresh temporary directory with
spaces and a Cyrillic character. It initially contained neither node_modules nor
.env. No real faculty credentials, personal preferences or existing client settings
were copied or modified. Local app data was redirected to a temporary directory.

## Observed results

| Check | Result |
| --- | --- |
| Empty npm/browser caches, actual npm run setup | Dependencies installed and the Chromium-install step was reached. Browser download did not complete before the external harness's 330-second observation limit. Cold installation is **not verified**. This does not establish which component caused the stall or prove the setup command's own timeout behavior. |
| Separate bounded browser-download retry in another empty cache | Did not finish within 120 seconds; terminated by the diagnostic harness. No definitive diagnostic code was produced. A small independent CDN request succeeded, which does not prove the complete archive download works. |
| Recovery with existing npm/browser downloads | Actual npm run setup completed in **13.3 seconds**, reinstalled dependencies, launched Chromium, verified stdio discovery, created blank .env identical to .env.example, and printed parseable configuration pointing to this copy. This is a warm-cache result, not a cold-download speed claim. |
| Setup rerun with synthetic existing settings | Completed in **15.4 seconds**. .env and three isolated local state files remained byte-for-byte unchanged; the synthetic password was absent from captured output. State included actual attendance/term preference records and a synthetic cache sentinel; this is preservation evidence, not cache-format validation. |
| Official MCP SDK client 1.32.2 | Two separate real stdio server processes, started from an unrelated working directory, each discovered all **28 tools**, matching the reviewed inventory. Invalid arguments were rejected. Explicit blank credential overrides returned the expected configuration error before faculty login. Local settings/state remained unchanged. |
| Installed Codex app-server 0.171.0-alpha.13 | Two fresh app-server starts with an isolated CODEX_HOME/configuration initialized and discovered the exact **28-tool** inventory. No model turn, faculty login, credential copying or change to the user's Codex settings was needed. |
| Local regression checks | npm run check; npm test: **269 passed, one skipped** because this Windows account cannot create the tested symlink; npm audit: zero reported vulnerabilities; git diff --check. |

The Codex test used its locally generated app-server protocol schema, initialize /
initialized and mcpServerStatus/list with a named temporary stdio registration.
It verifies the installed Codex runtime's discovery, **not** desktop Settings
import, chat tool selection, Claude Desktop, a GUI restart or faculty compatibility.
SDK tests verify real protocol initialization, tool listing, validation and restart;
they are not natural-language/model evaluations.

## Procedure and remaining work

The documented student path has five explicit actions: install Node/npm, clone the
repository, run npm run setup, fill local .env, and review/import client configuration
then restart. These observations do not measure Node installation or GUI import.
The verification used synthetic state and automated client configuration in isolated
directories rather than editing the student's real environment.

Keep #124 open for a completed empty-cache installation and the final supported
GUI/client workflow on the actual v1 candidate. Investigate the observed Chromium
download stall before claiming the first-download path is verified. Do not disable
TLS validation, alter faculty credentials or infer a root cause from a timeout alone.
Repeat against the exact final candidate and record its client/version matrix.

Publish only these aggregate outcomes. Captured configuration contains personal
paths, and private diagnostic files may contain environment details; they are not
repository artifacts. No raw output, screenshots, credentials or student content
belong in this verification record.


## Follow-up: 2026-11-27

The setup verifier was strengthened to compare all 29 current tool schemas and
annotations and the server identity/version, rather than checking only for
`list_courses`. A real local Chromium launch and SDK stdio discovery passed
without faculty login. Eleven setup tests passed, including a real subprocess
timeout, nonzero exit, nonexistent executable, safe stage-specific recovery,
and rejected inventory/version/schema/annotation changes. Timeout timers are
cleared on process errors as well as exit.

This follow-up uses installed browser binaries. It does not resolve the cold
Chromium download result above or establish desktop GUI/client onboarding or
final release-candidate sign-off. Issue #124 remains open.

Follow-up validation: `npm run check`; `npm test` (280 passed, one Windows
symlink privilege skip); `npm audit` (zero vulnerabilities); `npm run
demo:check`; `npm run benchmark:retrieval` (31 synthetic cases passed);
`git diff --check`. No live faculty workflow was exercised.
