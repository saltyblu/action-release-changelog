const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeMarkdownBody,
  isMeaningfulBody,
  semverFromLabel,
  compareSemverDescending,
  buildAggregatedChangelog,
} = require("../index.js");

test("normalizeMarkdownBody strips Unreleased heading", () => {
  const input = [
    "## Unreleased",
    "",
    "- feat: first",
    "- fix: second",
  ].join("\n");

  assert.equal(normalizeMarkdownBody(input), "- feat: first\n- fix: second");
});

test("isMeaningfulBody detects placeholder", () => {
  assert.equal(isMeaningfulBody("- _No unreleased changes yet._"), false);
  assert.equal(isMeaningfulBody("- feat: a real change"), true);
});

test("semverFromLabel parses prefixed files", () => {
  assert.deepEqual(semverFromLabel("v1.2.3.md", "v"), { major: 1, minor: 2, patch: 3 });
  assert.equal(semverFromLabel("invalid.md", "v"), null);
});

test("compareSemverDescending sorts latest first", () => {
  const a = { major: 1, minor: 2, patch: 0 };
  const b = { major: 1, minor: 1, patch: 9 };
  assert.ok(compareSemverDescending(a, b) < 0);
});

test("buildAggregatedChangelog joins header and fragments", () => {
  const output = buildAggregatedChangelog("# Changelog", [
    { content: "## v1.0.0\n\n- init" },
    { content: "## v0.9.0\n\n- alpha" },
  ]);

  assert.equal(output, "# Changelog\n\n## v1.0.0\n\n- init\n\n## v0.9.0\n\n- alpha\n");
});
