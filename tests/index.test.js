const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  setOutput,
  validateVersion,
  normalizeMarkdownBody,
  isMeaningfulBody,
  semverFromLabel,
  compareSemverDescending,
  compareFragmentEntries,
  collectVersionFragments,
  buildAggregatedChangelog,
  formatGitHubOutput,
} = require("../index.js");

test("validateVersion accepts and rejects expected values", () => {
  assert.doesNotThrow(() => validateVersion("1.2.3"));
  assert.throws(() => validateVersion("v1.2.3"));
});

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
  assert.equal(isMeaningfulBody(""), false);
  assert.equal(isMeaningfulBody("- _No unreleased changes yet._"), false);
  assert.equal(isMeaningfulBody("- feat: a real change"), true);
});

test("semverFromLabel parses prefixed files", () => {
  assert.deepEqual(semverFromLabel("v1.2.3.md", "v"), { major: 1, minor: 2, patch: 3 });
  assert.equal(semverFromLabel("invalid.md", "v"), null);
});

test("compareSemverDescending sorts latest first", () => {
  assert.ok(compareSemverDescending({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 9, patch: 9 }) < 0);
  assert.ok(compareSemverDescending({ major: 1, minor: 3, patch: 0 }, { major: 1, minor: 2, patch: 9 }) < 0);
  assert.ok(compareSemverDescending({ major: 1, minor: 2, patch: 9 }, { major: 1, minor: 2, patch: 1 }) < 0);
});

test("compareFragmentEntries covers parsed/unparsed sorting branches", () => {
  const parsedNew = { name: "v2.0.0.md", parsed: { major: 2, minor: 0, patch: 0 } };
  const parsedOld = { name: "v1.0.0.md", parsed: { major: 1, minor: 0, patch: 0 } };
  const unparsedA = { name: "alpha.md", parsed: null };
  const unparsedB = { name: "beta.md", parsed: null };

  assert.ok(compareFragmentEntries(parsedNew, parsedOld) < 0);
  assert.equal(compareFragmentEntries(parsedNew, unparsedA), -1);
  assert.equal(compareFragmentEntries(unparsedA, parsedNew), 1);
  assert.ok(compareFragmentEntries(unparsedA, unparsedB) < 0);
});

test("collectVersionFragments returns empty for missing dir", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-empty-"));
  const missing = path.join(tempDir, "does-not-exist");
  assert.deepEqual(collectVersionFragments(missing, "v"), []);
});

test("collectVersionFragments handles parsed and unparsed files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-fragments-"));
  fs.writeFileSync(path.join(tempDir, "v1.2.3.md"), "## v1.2.3\n\n- parsed\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "notes.md"), "## notes\n\n- unparsed\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "empty.md"), "\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "_header.md"), "# header\n", "utf8");

  const fragments = collectVersionFragments(tempDir, "v");
  assert.equal(fragments.length, 2);
  assert.equal(fragments[0].name, "v1.2.3.md");
  assert.equal(fragments[1].name, "notes.md");
});

test("buildAggregatedChangelog joins header and fragments", () => {
  const output = buildAggregatedChangelog("# Changelog", [
    { content: "## v1.0.0\n\n- init" },
    { content: "## v0.9.0\n\n- alpha" },
  ]);

  assert.equal(output, "# Changelog\n\n## v1.0.0\n\n- init\n\n## v0.9.0\n\n- alpha\n");
});

test("formatGitHubOutput keeps single-line values in key=value form", () => {
  assert.equal(formatGitHubOutput("has-changes", "true"), "has-changes=true\n");
});

test("formatGitHubOutput uses delimiter block for multiline values", () => {
  const output = formatGitHubOutput("release-body", "- feat: one\n- fix: two");

  assert.match(output, /^release-body<<__GITHUB_OUTPUT_DELIM__/);
  assert.match(output, /- feat: one\n- fix: two/);
  assert.match(output, /__GITHUB_OUTPUT_DELIM__\n$/);
});

test("formatGitHubOutput changes delimiter when value already contains default delimiter", () => {
  const input = "line one\n__GITHUB_OUTPUT_DELIM__\nline two";
  const output = formatGitHubOutput("release-body", input);

  assert.match(output, /^release-body<<__GITHUB_OUTPUT_DELIM___X/);
  assert.match(output, /line one/);
  assert.match(output, /line two/);
});

test("setOutput throws when GITHUB_OUTPUT is missing", () => {
  const previous = process.env.GITHUB_OUTPUT;
  delete process.env.GITHUB_OUTPUT;
  assert.throws(() => setOutput("foo", "bar"));
  if (typeof previous === "undefined") {
    delete process.env.GITHUB_OUTPUT;
  } else {
    process.env.GITHUB_OUTPUT = previous;
  }
});

test("CLI run writes multiline release-body output and changelog files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-"));
  const outputFile = path.join(tempDir, "github-output.txt");

  fs.writeFileSync(path.join(tempDir, "unreleased.md"), [
    "## Unreleased",
    "",
    "- feat: add endpoint",
    "- fix: handle edge case",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(outputFile, "", "utf8");

  execFileSync("node", ["index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      INPUT_VERSION: "1.2.3",
      INPUT_TAG_PREFIX: "v",
      INPUT_WORKING_DIRECTORY: tempDir,
      INPUT_CHANGELOG_DIR: ".changelog",
      INPUT_UNRELEASED_FILE: "unreleased.md",
      INPUT_CHANGELOG_FILE: "CHANGELOG.md",
      INPUT_HEADER_FILE: "_header.md",
      INPUT_DRY_RUN: "false",
      GITHUB_OUTPUT: outputFile,
    },
    encoding: "utf8",
  });

  const outputs = fs.readFileSync(outputFile, "utf8");
  assert.match(outputs, /has-changes=true/);
  assert.match(outputs, /release-body<<__GITHUB_OUTPUT_DELIM__/);
  assert.match(outputs, /- feat: add endpoint\n- fix: handle edge case/);

  const versionFragmentPath = path.join(tempDir, ".changelog", "v1.2.3.md");
  const changelogPath = path.join(tempDir, "CHANGELOG.md");
  assert.equal(fs.existsSync(versionFragmentPath), true);
  assert.equal(fs.existsSync(changelogPath), true);

  const versionFragment = fs.readFileSync(versionFragmentPath, "utf8");
  assert.match(versionFragment, /^## v1\.2\.3 - /);
  assert.match(versionFragment, /- feat: add endpoint/);

  const changelog = fs.readFileSync(changelogPath, "utf8");
  assert.match(changelog, /# Changelog/);
  assert.match(changelog, /## v1\.2\.3 - /);
});

test("CLI run keeps files untouched in dry-run mode", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-dry-"));
  const outputFile = path.join(tempDir, "github-output.txt");

  fs.writeFileSync(path.join(tempDir, "unreleased.md"), "## Unreleased\n\n- feat: dry run\n", "utf8");
  fs.writeFileSync(outputFile, "", "utf8");

  execFileSync("node", ["index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      INPUT_VERSION: "1.2.3",
      INPUT_TAG_PREFIX: "v",
      INPUT_WORKING_DIRECTORY: tempDir,
      INPUT_DRY_RUN: "true",
      GITHUB_OUTPUT: outputFile,
    },
    encoding: "utf8",
  });

  assert.equal(fs.existsSync(path.join(tempDir, ".changelog", "v1.2.3.md")), false);
  assert.equal(fs.existsSync(path.join(tempDir, "CHANGELOG.md")), false);

  const outputs = fs.readFileSync(outputFile, "utf8");
  assert.match(outputs, /has-changes=true/);
});

test("CLI run uses existing version fragment when unreleased has no changes", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-existing-"));
  const outputFile = path.join(tempDir, "github-output.txt");
  const changelogDir = path.join(tempDir, ".changelog");

  fs.mkdirSync(changelogDir, { recursive: true });
  fs.writeFileSync(path.join(changelogDir, "v1.2.3.md"), "## v1.2.3\n\n- existing note\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "unreleased.md"), "## Unreleased\n\n- _No unreleased changes yet._\n", "utf8");
  fs.writeFileSync(outputFile, "", "utf8");

  execFileSync("node", ["index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      INPUT_VERSION: "1.2.3",
      INPUT_TAG_PREFIX: "v",
      INPUT_WORKING_DIRECTORY: tempDir,
      INPUT_DRY_RUN: "false",
      GITHUB_OUTPUT: outputFile,
    },
    encoding: "utf8",
  });

  const outputs = fs.readFileSync(outputFile, "utf8");
  assert.match(outputs, /has-changes=false/);
  assert.match(outputs, /release-body<<__GITHUB_OUTPUT_DELIM__/);
  assert.match(outputs, /- existing note/);
});

test("CLI run fails with invalid version", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-invalid-"));
  const outputFile = path.join(tempDir, "github-output.txt");
  fs.writeFileSync(outputFile, "", "utf8");

  assert.throws(() => {
    execFileSync("node", ["index.js"], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        INPUT_VERSION: "invalid",
        INPUT_WORKING_DIRECTORY: tempDir,
        GITHUB_OUTPUT: outputFile,
      },
      encoding: "utf8",
      stdio: "pipe",
    });
  });
});

test("CLI run emits warning when changelog entry is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-missing-entry-"));
  const outputFile = path.join(tempDir, "github-output.txt");

  fs.writeFileSync(path.join(tempDir, "unreleased.md"), "## Unreleased\n", "utf8");
  fs.writeFileSync(outputFile, "", "utf8");

  const stdout = execFileSync("node", ["index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      INPUT_VERSION: "1.2.3",
      INPUT_TAG_PREFIX: "v",
      INPUT_WORKING_DIRECTORY: tempDir,
      INPUT_DRY_RUN: "true",
      GITHUB_OUTPUT: outputFile,
    },
    encoding: "utf8",
  });

  assert.match(stdout, /::warning::No changelog entry found for v1\.2\.3/);
});

test("CLI run fails when fail-on-missing-changelog is true", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-fail-missing-entry-"));
  const outputFile = path.join(tempDir, "github-output.txt");

  fs.writeFileSync(path.join(tempDir, "unreleased.md"), "## Unreleased\n", "utf8");
  fs.writeFileSync(outputFile, "", "utf8");

  assert.throws(() => {
    execFileSync("node", ["index.js"], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        INPUT_VERSION: "1.2.3",
        INPUT_TAG_PREFIX: "v",
        INPUT_WORKING_DIRECTORY: tempDir,
        INPUT_DRY_RUN: "false",
        INPUT_FAIL_ON_MISSING_CHANGELOG: "true",
        GITHUB_OUTPUT: outputFile,
      },
      encoding: "utf8",
      stdio: "pipe",
    });
  }, /No changelog entry found for v1\.2\.3/);
});
