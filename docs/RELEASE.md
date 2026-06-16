# PhantomStream Release Gates

This document records the release checks for the 0.x npm package. It is a
pre-publish checklist, not permission to publish.

## Local Preflight

Run these from a clean checkout before cutting a release:

```bash
npm ci
npm run package:check
npm publish --dry-run --access public
```

`package:check` runs the full `npm test` suite, declaration generation,
publint, ATTW in ESM-only mode, dry-run pack, and a tarball install smoke. The
smoke installs the packed `.tgz` into a fresh temp project, imports every
public subpath, and runs `phantom-stream --help`.

## Trusted Publisher Setup

Preferred publishing uses npm trusted publishing through GitHub Actions OIDC.
Configure the npm package trusted publisher with these fields:

| Field | Value |
|---|---|
| Package | `@fullselfbrowsing/phantom-stream` |
| Owner | `fullselfbrowsing` |
| Repository | `PhantomStream` |
| Workflow filename | `publish.yml` |
| Workflow path | `.github/workflows/publish.yml` |
| Environment | `npm-publish` |

The workflow uses GitHub-hosted `ubuntu-latest`, grants `contents: read` and
`id-token: write`, configures the npm registry URL, runs
`npm run package:check`, and then runs `npm publish --access public`.

No `NPM_TOKEN` secret is required for the default trusted-publishing path.

## Publish Boundary

Real publishing is a human/authentication gate. Do not run
`npm publish --access public` unless the package owner has confirmed npm write
permission or trusted publishing is configured, account 2FA/trust requirements
are satisfied, and the user has explicitly approved the publish action for
this workspace.

## Staged Release Option

For review before public release:

1. Run local preflight and commit the resulting package files.
2. Open a draft GitHub release for the tag.
3. Protect the `npm-publish` environment with required reviewers.
4. Publish the GitHub release only after review; the workflow still runs
   `npm run package:check` before the final `npm publish --access public`.

If trusted publishing is not configured yet, stop after dry-run and configure
the npm trusted publisher before attempting the release workflow.
