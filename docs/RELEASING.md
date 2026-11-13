# Release workflow

Use package.json as the version source. npm also records the version in package-lock.json. The MCP server reads package.json directly. Update both npm files with npm version <version> --no-git-tag-version on the release PR branch.

For stable releases, use patch versions for compatible fixes, minor versions for compatible features, and major versions for breaking changes to documented tool contracts. Document renamed tools or fields, configuration changes, local data migrations, and rollback steps in the changelog. Move reviewed Unreleased entries under the release version and date.

## Review checklist

- Verify the required gates in roadmap issue [#28](https://github.com/mahmutmft/courses-mcp/issues/28), including retrieval benchmarks, supported client and Windows validation, and independent security review.
- Record the full candidate commit SHA and intended vX.Y.Z tag. Verify that the package, lockfile and MCP initialize versions agree.
- Verify all required GitHub checks on the candidate commit. Record the supported OS and client matrix and get maintainer approval for the exact commit, tag and release notes.
- Publish the approved GitHub release only after explicit maintainer authorization.

## Install an exact release

Use PowerShell and Node.js 24 or later. Replace the placeholders with values from the approved GitHub release.

~~~powershell
git clone --branch vX.Y.Z --single-branch https://github.com/mahmutmft/courses-mcp.git courses-mcp-vX.Y.Z
Set-Location courses-mcp-vX.Y.Z
git rev-parse HEAD
~~~

Compare the output with the published commit SHA before running:

~~~powershell
npm ci
npm run check
npm test
npm run browser:install
Copy-Item .env.example .env
~~~

Fill .env locally and point the client to the absolute src/index.js path in this checkout. Restart the client and run npm run doctor for an optional live check.

For rollback, keep the previous release checkout and its local .env, restore the client's previous entry point and restart it. Review changelog migration notes before reusing local state across versions. Keep a private backup of that state if the release changes its format.
