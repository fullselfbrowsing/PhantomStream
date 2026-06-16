# PhantomStream Release Gates

This document records the release checks for the 0.x npm package. It is a
pre-publish checklist, not permission to publish.

## Required Local Gates

```bash
npm run package:check
npm publish --dry-run --access public
```

`package:check` runs the stable test suite, declaration generation, publint,
ATTW in ESM-only mode, dry-run pack, and a tarball install smoke. The smoke
installs the packed `.tgz` into a fresh temp project, imports every public
subpath, and runs `phantom-stream --help`.

## Publish Boundary

Real publishing is a human/authentication gate. Do not run
`npm publish --access public` unless the package owner has confirmed npm
access or trusted publishing is configured and has explicitly approved the
publish action for this workspace.

## Trusted Publishing

The preferred release path is GitHub Actions trusted publishing with OIDC and
provenance. The release workflow should use GitHub-hosted runners, read-only
repository permissions plus `id-token: write`, npm registry setup, and
`npm run package:check` before the publish command.
