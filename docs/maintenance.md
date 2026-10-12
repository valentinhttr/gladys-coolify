# Maintainer guide

## Release policy

Use English Conventional Commits and PR titles. Breaking changes (`!` or a `BREAKING CHANGE:` footer) increment the major version, `feat` increments the minor version, and other changes increment the patch version. Preserve contributor attribution when merging.

Run **Actions → Release → Run workflow** on `main`. The workflow:

1. Runs formatting, lint and tests.
2. Computes the semantic version from commits since the previous version tag.
3. Updates `package.json`, `package-lock.json` and the integration manifest together.
4. Generates English release notes grouped by change type, including commit links and contributors.
5. Builds and publishes the `linux/amd64` and `linux/arm64` image.
6. Publishes the version commit, annotated tag and GitHub release with its manifest attached.

Do not manually bump versions or publish an additional release for a documentation-only adjustment unless requested. A failed image build must not produce a GitHub release. If release creation fails after the tag was pushed, publish the release for that existing tag instead of incrementing again.

## Published releases

Initial 1.0.0 stabilization is complete. Publish new semantic versions through the standard release workflow; preserve existing release tags and Git history. Use `mode: rebuild` only when explicitly requested for an existing release whose tag matches HEAD.

Every published image embeds the compact manifest as `io.gladysassistant.manifest`. Gladys can then refresh the developer-install manifest during a forced update even when the version stays unchanged. Verify the anonymous image digest, both architectures, image revision/manifest, attached manifest and tag source archive after publishing.

## Distribution

The GHCR package must be public and support anonymous pulls. Check package visibility after the first publication, then verify the manifest is accessible without registry credentials. Keep the manifest's image reference matched to its version.

Store indexing is controlled by the `gladys-assistant-integration` repository topic. Do not add it without the owner's explicit authorization. Git version tags and GitHub releases are independent of store discovery.

## Documentation

The README is for users: purpose, widgets, installation and connection setup. Release procedures, CI details and publication decisions belong here, not in the README. Keep user instructions in `docs/en.md` and `docs/fr.md` consistent. Technical API decisions belong in `docs/design.md`.

The integration is independently maintained. It uses the official Gladys SDK and public Coolify API. The manifest schema in `test/manifest.schema.json` comes from [GladysAssistant/integration-store](https://github.com/GladysAssistant/integration-store) under Apache-2.0; retain its license attribution.
