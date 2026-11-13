# Windows setup and recovery checklist

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

Clean checkout of 1e79af5aa2cb7c247ed94397ebe14d944af811c4 on Windows build 26300, PowerShell 7.6.9, Node 24.18.0 and npm 11.16.0. npm ci, browser installation command, syntax check and 158 offline test entries passed. Playwright launched Chromium 156.0.8078.4. The blank-template doctor exited with the expected setup message. The machine may have reused the existing Playwright browser cache. GUI MCP clients and live faculty login were outside this run. Revalidate the final v1 candidate and record its supported client matrix before release.
