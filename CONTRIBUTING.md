# Contributing

Use Node 22.14+ and run `npm ci` then `npm run check`. Keep SDK 0.14.0 pinned until a compatibility upgrade is intentional. Changes to widgets must pass `validateWidgetContent` in English and French, including empty/error states and both layouts. Never add a write endpoint to the read-only client.

Write English Conventional Commits and PR titles: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`. Add `!` or a `BREAKING CHANGE:` footer for incompatible settings/device identifiers. Maintainers squash merge using the PR title. The release workflow groups changes and credits Git commit authors; preserve attribution when merging contributions.

Release procedures and distribution policy are documented in [the maintainer guide](docs/maintenance.md).
