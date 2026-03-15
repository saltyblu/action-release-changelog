# action-release-changelog

GitHub Action that moves unreleased notes into a versioned changelog fragment and rebuilds `CHANGELOG.md`.

## Inputs

- `version` (required)
  - Semantic version without prefix, e.g. `1.2.3`.
- `tag-prefix` (optional, default: `v`)
  - Prefix used for changelog version labels and fragment files.
- `working-directory` (optional, default: `.`)
  - Directory where changelog files are managed.
- `changelog-dir` (optional, default: `.changelog`)
  - Directory containing versioned changelog fragments.
- `unreleased-file` (optional, default: `unreleased.md`)
  - Markdown file with upcoming release notes.
- `changelog-file` (optional, default: `CHANGELOG.md`)
  - Aggregated changelog output file.
- `header-file` (optional, default: `_header.md`)
  - Header template file inside `changelog-dir`.
- `dry-run` (optional, default: `false`)
  - If `true`, computes outputs without writing files.

## Outputs

- `changelog-path`: path to versioned changelog fragment
- `release-body`: release body markdown for the new version
- `updated-files`: JSON array with changed files
- `has-changes`: `true` if unreleased notes contained real entries

## Behavior

1. Ensures changelog directory and Keep a Changelog style header exist.
2. Reads `unreleased.md`, strips `Unreleased` heading, writes version fragment `.changelog/<tag>.md`.
3. Resets `unreleased.md` to default template.
4. Rebuilds `CHANGELOG.md` from header + all version fragments.

## Example

```yaml
- name: Build changelog
  id: changelog
  uses: saltyblu/action-release-changelog@v1
  with:
    version: "1.2.3"
    tag-prefix: "v"
    working-directory: "app"
```

## Unit tests

```bash
node --test
```
