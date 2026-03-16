#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_KEEP_A_CHANGELOG_HEADER = [
  "# Changelog",
  "",
  "All notable changes to this project will be documented in this file.",
  "",
  "The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),",
  "and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).",
  "",
].join("\n");

const DEFAULT_UNRELEASED_TEMPLATE = [
  "## Unreleased",
  "",
].join("\n");

function getInput(name, fallback = "") {
  const githubActionsKey = `INPUT_${name.toUpperCase().replace(/ /g, "_")}`;
  const legacyKey = `INPUT_${name.toUpperCase().replace(/[- ]/g, "_")}`;
  const value = process.env[githubActionsKey] ?? process.env[legacyKey] ?? fallback;
  return value.trim();
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    throw new Error("GITHUB_OUTPUT is not set");
  }

  fs.appendFileSync(outputFile, formatGitHubOutput(name, value), "utf8");
}

function formatGitHubOutput(name, value) {
  const stringValue = String(value ?? "");

  if (!stringValue.includes("\n") && !stringValue.includes("\r")) {
    return `${name}=${stringValue}\n`;
  }

  let delimiter = "__GITHUB_OUTPUT_DELIM__";
  while (stringValue.includes(delimiter)) {
    delimiter = `${delimiter}_X`;
  }

  return `${name}<<${delimiter}\n${stringValue}\n${delimiter}\n`;
}

function validateVersion(version) {
  if (!/^(\d+)\.(\d+)\.(\d+)$/.test(version)) {
    throw new Error(`Invalid version: ${version}. Expected semantic version like 1.2.3`);
  }
}

function semverFromLabel(label, prefix) {
  const normalized = label.replace(/\.md$/i, "");
  const withoutPrefix = prefix && normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  const match = withoutPrefix.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemverDescending(left, right) {
  if (left.major !== right.major) return right.major - left.major;
  if (left.minor !== right.minor) return right.minor - left.minor;
  return right.patch - left.patch;
}

function ensureDirectory(dirPath, dryRun) {
  if (dryRun) {
    return;
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function writeFileIfChanged(filePath, content, dryRun, updatedFiles) {
  const existing = readTextIfExists(filePath);
  if (existing === content) {
    return;
  }
  if (!dryRun) {
    fs.writeFileSync(filePath, content, "utf8");
  }
  updatedFiles.push(filePath);
}

function normalizeMarkdownBody(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && /^#{1,6}\s*unreleased\s*$/i.test(lines[0].trim())) {
    lines.shift();
    while (lines.length > 0 && lines[0].trim() === "") {
      lines.shift();
    }
  }
  return lines.join("\n").trim();
}

function isMeaningfulBody(content) {
  if (!content) {
    return false;
  }
  const simplified = content
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return simplified !== "- _no unreleased changes yet._";
}

function collectVersionFragments(changelogDir, tagPrefix) {
  if (!fs.existsSync(changelogDir)) {
    return [];
  }

  const entries = fs.readdirSync(changelogDir, { withFileTypes: true });
  const fragments = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .filter((name) => name !== "_header.md")
    .map((name) => {
      const absolutePath = path.join(changelogDir, name);
      return {
        name,
        absolutePath,
        content: fs.readFileSync(absolutePath, "utf8").trim(),
        parsed: semverFromLabel(name, tagPrefix),
      };
    })
    .filter((entry) => entry.content.length > 0);

  fragments.sort(compareFragmentEntries);

  return fragments;
}

function compareFragmentEntries(left, right) {
  if (left.parsed && right.parsed) {
    return compareSemverDescending(left.parsed, right.parsed);
  }
  if (left.parsed) return -1;
  if (right.parsed) return 1;
  return left.name.localeCompare(right.name);
}

function buildAggregatedChangelog(header, fragments) {
  const chunks = [header.trim()];

  for (const fragment of fragments) {
    chunks.push(fragment.content.trim());
  }

  return `${chunks.filter(Boolean).join("\n\n")}\n`;
}

function toRelative(absolutePath, baseDir) {
  const relative = path.relative(baseDir, absolutePath);
  return relative.split(path.sep).join("/");
}

function main() {
  const version = getInput("version", "");
  const tagPrefix = getInput("tag-prefix", "v");
  const workingDirectoryInput = getInput("working-directory", ".");
  const changelogDirInput = getInput("changelog-dir", ".changelog");
  const unreleasedFileInput = getInput("unreleased-file", "unreleased.md");
  const changelogFileInput = getInput("changelog-file", "CHANGELOG.md");
  const headerFileInput = getInput("header-file", "_header.md");
  const dryRun = getInput("dry-run", "false") === "true";
  const failOnMissingChangelog = getInput("fail-on-missing-changelog", "false") === "true";

  validateVersion(version);

  const cwd = path.resolve(process.cwd(), workingDirectoryInput);
  const changelogDir = path.resolve(cwd, changelogDirInput);
  const headerPath = path.join(changelogDir, headerFileInput);
  const changelogFilePath = path.resolve(cwd, changelogFileInput);
  const unreleasedPath = path.resolve(cwd, unreleasedFileInput);

  const tag = `${tagPrefix}${version}`;
  const versionFilePath = path.join(changelogDir, `${tag}.md`);

  const updatedFiles = [];

  ensureDirectory(changelogDir, dryRun);

  const existingHeader = readTextIfExists(headerPath);
  const header = existingHeader && existingHeader.trim().length > 0
    ? existingHeader
    : DEFAULT_KEEP_A_CHANGELOG_HEADER;
  writeFileIfChanged(headerPath, `${header.trim()}\n`, dryRun, updatedFiles);

  const unreleasedRaw = readTextIfExists(unreleasedPath) ?? DEFAULT_UNRELEASED_TEMPLATE;
  const normalizedBody = normalizeMarkdownBody(unreleasedRaw);
  const hasChanges = isMeaningfulBody(normalizedBody);

  let releaseBody = "";
  if (hasChanges) {
    const today = new Date().toISOString().slice(0, 10);
    const fragment = [`## ${tag} - ${today}`, "", normalizedBody.trim(), ""].join("\n");
    writeFileIfChanged(versionFilePath, fragment, dryRun, updatedFiles);
    releaseBody = normalizedBody.trim();
  } else {
    const existingVersionFragment = readTextIfExists(versionFilePath);
    if (existingVersionFragment) {
      releaseBody = existingVersionFragment.trim();
    }
  }

  const hasChangelogEntry = releaseBody.trim().length > 0;
  if (!hasChangelogEntry) {
    const warning = `No changelog entry found for ${tag}. Add unreleased notes before running this action.`;
    console.warn(warning);
    console.log(`::warning::${warning}`);

    if (!dryRun && failOnMissingChangelog) {
      throw new Error(`${warning} Set fail-on-missing-changelog to false to allow empty releases.`);
    }
  }

  writeFileIfChanged(unreleasedPath, DEFAULT_UNRELEASED_TEMPLATE, dryRun, updatedFiles);

  const fragments = collectVersionFragments(changelogDir, tagPrefix);
  const changelogOutput = buildAggregatedChangelog(header, fragments);
  writeFileIfChanged(changelogFilePath, changelogOutput, dryRun, updatedFiles);

  const uniqueUpdated = [...new Set(updatedFiles.map((filePath) => toRelative(filePath, cwd)))];
  const changelogPath = toRelative(versionFilePath, cwd);

  setOutput("changelog-path", changelogPath);
  setOutput("release-body", releaseBody);
  setOutput("updated-files", JSON.stringify(uniqueUpdated));
  setOutput("has-changes", String(hasChanges));

  console.log(`dry-run=${dryRun}`);
  console.log(`working-directory=${cwd}`);
  console.log(`tag=${tag}`);
  console.log(`has-changes=${hasChanges}`);
  console.log(`has-changelog-entry=${hasChangelogEntry}`);
  console.log(`fail-on-missing-changelog=${failOnMissingChangelog}`);
  console.log(`updated-files=${JSON.stringify(uniqueUpdated)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_KEEP_A_CHANGELOG_HEADER,
  DEFAULT_UNRELEASED_TEMPLATE,
  setOutput,
  validateVersion,
  semverFromLabel,
  compareSemverDescending,
  compareFragmentEntries,
  normalizeMarkdownBody,
  isMeaningfulBody,
  collectVersionFragments,
  buildAggregatedChangelog,
  formatGitHubOutput,
};
