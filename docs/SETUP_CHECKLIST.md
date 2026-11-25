# Windows setup and recovery checklist

## Guided setup

After installing Node.js 24+ and cloning this repository, run `npm run setup` from
the clone. No npm dependencies need to be installed first. The entry point uses
only Node built-ins until dependencies are installed. It runs locked dependency
installation and Chromium installation, launches Chromium, and checks actual MCP
initialization/tool discovery without faculty login. It creates a blank .env
exclusively if missing, then prints correctly escaped JSON with absolute command
and entry-point paths. Review/copy it into a compatible stdio MCP client. Other
clients may use different settings formats; use the printed command and args.

Compared with the manual path below, dependency/browser/configuration preparation
is one command. Entering local credentials and connecting/restarting the client
remain explicit steps. A generated configuration contains local paths; do not
post it publicly. The check does not verify a GUI client or faculty access.

The guided path is chosen instead of silently editing client-specific settings
or shipping a new installer. It adds no dependencies, retains the manual path,
and requires no paid API key. It does not install Node/npm themselves.
Dependency installation prefers the existing npm download cache and skips the
automatic audit/funding requests; release/contributor validation still runs
`npm audit` separately. Package-lock integrity checks remain enabled.

Stop running MCP processes before rerunning setup (npm ci replaces dependencies).
Reruns retain .env and never touch private preferences/cache. Steps show progress
and have a five-minute subprocess timeout. Child output is suppressed because
diagnostics can contain private environment details. If interrupted or a download
fails, fix connectivity/disk space and rerun; no automatic repeated login occurs.
Use the manual commands below for troubleshooting locally; inspect their logs for
secrets before sharing. Linux may require OS browser libraries installed by the
system administrator; only recorded platform/client checks establish support.

## Manual setup and contributor checks

From a fresh checkout in PowerShell, use Node.js 24 or later.

~~~powershell
node --version
npm --version
npm ci
npm run check
npm test
npm run browser:install
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
~~~

Contributors can run the syntax checks and offline tests with the template unfilled. For live use, fill MOODLE_USERNAME and MOODLE_PASSWORD in the local .env. Keep the file private. The server reads it relative to its entry point. Values inherited from the client environment take precedence.

## Connect and upgrade

Use the [stdio configuration in the README](../README.md#connect-an-mcp-client). Set the command to Node 24 or later and the argument to the absolute path of src/index.js. If the client cannot find Node, use the absolute node.exe path. Restart the connection and check that list_courses appears in the tool list.

For an upgrade, stop the connection, update the checkout, run npm ci and npm run browser:install, then restart and refresh the tool list. Keep the existing .env. Follow the [release guide](RELEASING.md) for exact tags and rollback.

## Recover

- Startup failure or missing tools. Verify the client's Node version and entry point, then reconnect. Run npm test for a local stdio handshake and tool discovery check.
- LOGIN_BROWSER_MISSING. Run npm run browser:install from the checkout, then restart. Run the install under the Windows user that runs the client.
- Network failure or timeout. Check that the faculty sites open in your browser. Restart the MCP connection before retrying.
- Rejected credentials or an interactive challenge. Verify your account through the official faculty login before trying again. See the README login diagnostics for the specific code.
- For an opt-in live check, run npm run doctor. It attempts one sign-in and prints aggregate diagnostics. With an empty template it exits with setup instructions.
- To clear saved attendance, set the course preference to unknown. To clear the saved group or term, set the term preference to null. To remove the entire local store manually, stop the client and back up or remove the intended account data under %LOCALAPPDATA%/courses-mcp/lab-preferences. Delete the checkout's .env separately if removing credentials from that checkout.

## Verification record

The [2026-11-25 verification](SETUP_VERIFICATION_2026_11_25.md) records current
Windows setup/rerun results and exact tool discovery through real SDK and installed
Codex app-server clients. Warm-cache recovery and state preservation passed;
empty-browser-cache downloads did not finish within the observation limits.
Cold installation, GUI import/chat and final-candidate sign-off remain outstanding.

Guided setup implementation 81485d9f12f1de183259c53957de02ae4083c790 was
tested on 2026-11-19 from a fresh temporary copy with no node_modules or .env:
Windows build 26300, Node 24.18.0, npm 11.16.0. The final guided command completed
in 30.6 seconds, installed dependencies, reused available npm/Playwright caches,
launched Chromium and initialized the actual stdio server/listed its tools. This
is a warm-cache observation, not a cold-download benchmark or speed guarantee.
A real rerun completed in 17.0 seconds, preserving a synthetic .env byte for byte
and without printing its sentinel password. All 201 offline tests passed; syntax
checks, retrieval benchmark, npm audit (zero findings) and git diff checks passed.
The guided path replaces three preparation commands with one; Node installation,
clone, credential entry and client configuration remain explicit. GUI client
import/tool use, live faculty login, cold-cache setup and the final v1 candidate
matrix still require verification. These checks do not establish other OS support.

Clean checkout of 1e79af5aa2cb7c247ed94397ebe14d944af811c4 on Windows build 26300, PowerShell 7.6.9, Node 24.18.0 and npm 11.16.0. npm ci, browser installation command, syntax check and 158 offline test entries passed. Playwright launched Chromium 156.0.8078.4. The blank-template doctor exited with the expected setup message. The machine may have reused the existing Playwright browser cache. GUI MCP clients and live faculty login were outside this run. Revalidate the final v1 candidate and record its supported client matrix before release.
