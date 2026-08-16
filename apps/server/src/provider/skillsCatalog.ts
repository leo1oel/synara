// FILE: skillsCatalog.ts
// Purpose: Generic Agent Skill discovery primitives (frontmatter parsing, SKILL.md
//          walking) plus the unified cross-provider skills catalog backing Synara
//          portable skills. Aggregates `~/.synara/skills` with every provider-native
//          skills folder, deduping by name with provider-native copies winning for
//          the active provider.
// Layer: Server provider discovery helper
// Exports: parseSkillFrontmatter, collectSkillsFromRoots, discoverSkillsCatalog,
//          mergeSkillsIntoCatalog, filterDisabledSkills, ensureSynaraSkillsDir

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";

import type {
  ProviderDuplicateManagedSkillResult,
  ProviderImportSkillInput,
  ProviderImportSkillResult,
  ProviderKind,
  ProviderManagedSkillDetail,
  ProviderManagedSkillKind,
  ProviderRemoveManagedSkillResult,
  ProviderRestoreManagedSkillResult,
  ProviderSaveManagedSkillInput,
  ProviderSaveManagedSkillResult,
  ProviderSkillDescriptor,
} from "@synara/contracts";
import { discoverClaudePluginSkillRoots } from "./claudePluginSkills.ts";

type FrontmatterValue = string | boolean;

export interface SkillRoot {
  readonly path: string;
  readonly scope: string;
  readonly includeMarkdownFiles?: boolean;
  /** Provider-owned top-level folders that should not appear in the user catalog. */
  readonly excludedTopLevelDirectories?: ReadonlyArray<string>;
  readonly managedKind?: ProviderManagedSkillKind;
  /** Prefix used by plugin-provided skills whose native invocation is namespaced. */
  readonly namespace?: string;
  /** Provider-owned plugin caches should not traverse linked content outside the install. */
  readonly followSymlinks?: boolean;
}

// ── Frontmatter parsing ──────────────────────────────────────────────

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") {
        return parsed.trim();
      }
    } catch {
      // Fall back to removing quotes for non-JSON YAML scalar syntax.
    }
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseYamlScalar(value: string): FrontmatterValue {
  const unquoted = stripYamlQuotes(value);
  const normalized = unquoted.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return unquoted;
}

function parseYamlBlockScalar(
  lines: ReadonlyArray<string>,
  startIndex: number,
  parentIndent: number,
  style: ">" | "|",
): { readonly value: string; readonly nextIndex: number } {
  const blockLines: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? "";
    const indent = /^\s*/.exec(line)?.[0].length ?? 0;
    if (line.trim() && indent <= parentIndent) {
      break;
    }
    blockLines.push(line);
    nextIndex += 1;
  }

  const contentIndent = blockLines.reduce<number | null>((minimum, line) => {
    if (!line.trim()) return minimum;
    const indent = /^\s*/.exec(line)?.[0].length ?? 0;
    return minimum === null ? indent : Math.min(minimum, indent);
  }, null);
  if (contentIndent === null) {
    return { value: "", nextIndex };
  }

  const normalizedLines = blockLines.map((line) =>
    line.trim() ? line.slice(contentIndent) : "",
  );
  const literal = normalizedLines.join("\n").trim();
  return {
    value: style === ">" ? literal.replace(/([^\n])\n(?=[^\n])/g, "$1 ") : literal,
    nextIndex,
  };
}

// Parses the scalar frontmatter subset used by Agent Skills without pulling in YAML.
export function parseSkillFrontmatter(markdown: string): Record<string, FrontmatterValue> {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(normalized);
  if (!match) {
    return {};
  }

  const record: Record<string, FrontmatterValue> = {};
  const lines = (match[1] ?? "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    const blockMarker = /^([>|])[+-]?$/.exec(value);
    if (blockMarker) {
      const block = parseYamlBlockScalar(
        lines,
        index + 1,
        /^\s*/.exec(line)?.[0].length ?? 0,
        blockMarker[1] as ">" | "|",
      );
      index = block.nextIndex - 1;
      if (block.value) {
        record[key] = block.value;
      }
      continue;
    }
    if (!value) {
      continue;
    }
    record[key] = parseYamlScalar(value);
  }
  return record;
}

function readStringField(
  frontmatter: Record<string, FrontmatterValue>,
  keys: ReadonlyArray<string>,
): string | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readBooleanField(
  frontmatter: Record<string, FrontmatterValue>,
  keys: ReadonlyArray<string>,
): boolean | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

// ── Filesystem walking ───────────────────────────────────────────────

export function ancestorsFromDeepest(cwd: string): string[] {
  const resolved = nodePath.resolve(cwd);
  const ancestors: string[] = [];
  let current = resolved;
  while (true) {
    ancestors.push(current);
    const parent = nodePath.dirname(current);
    if (parent === current) {
      return ancestors;
    }
    current = parent;
  }
}

async function readdirOrEmpty(path: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await fs.readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isWalkableSkillDirectory(
  parentPath: string,
  dirent: import("node:fs").Dirent,
  followSymlinks: boolean,
): Promise<boolean> {
  if (dirent.isDirectory()) {
    return true;
  }
  if (!followSymlinks || !dirent.isSymbolicLink()) {
    return false;
  }
  try {
    return (await fs.stat(nodePath.join(parentPath, dirent.name))).isDirectory();
  } catch {
    return false;
  }
}

// Skills may be nested one namespace deep, e.g. `.cursor/skills/skills-sh/find-skills`.
// Subdirectories are visited concurrently but results are flattened in sorted name
// order so name-dedup always picks the same winner across runs. Provider skill
// folders may be symlinked, so directory checks intentionally follow symlinks.
async function isReadableMarkdownFile(
  parentPath: string,
  dirent: import("node:fs").Dirent,
): Promise<boolean> {
  if (!dirent.name.toLowerCase().endsWith(".md") || dirent.name.toLowerCase() === "skill.md") {
    return false;
  }
  if (dirent.isFile()) {
    return true;
  }
  if (!dirent.isSymbolicLink()) {
    return false;
  }
  try {
    return (await fs.stat(nodePath.join(parentPath, dirent.name))).isFile();
  } catch {
    return false;
  }
}

export async function collectSkillMarkdownPaths(
  rootPath: string,
  options?: {
    readonly includeMarkdownFiles?: boolean;
    readonly followSymlinks?: boolean;
    readonly excludedTopLevelDirectories?: ReadonlyArray<string>;
  },
): Promise<string[]> {
  async function visit(dir: string, depth: number): Promise<string[]> {
    const skillPath = nodePath.join(dir, "SKILL.md");
    try {
      const stat =
        options?.followSymlinks === false ? await fs.lstat(skillPath) : await fs.stat(skillPath);
      if (stat.isFile()) {
        return [skillPath];
      }
    } catch {
      // Keep walking; this directory may be a namespace rather than a skill.
    }

    if (depth >= 2) {
      return [];
    }

    const dirents = await readdirOrEmpty(dir);
    const directMarkdownFiles =
      depth === 0 && options?.includeMarkdownFiles
        ? (
            await Promise.all(
              dirents.map(async (dirent) => ({
                name: dirent.name,
                isMarkdownFile: await isReadableMarkdownFile(dir, dirent),
              })),
            )
          )
            .filter((entry) => entry.isMarkdownFile)
            .map((entry) => nodePath.join(dir, entry.name))
            .sort()
        : [];
    const subdirNames = (
      await Promise.all(
        dirents.map(async (dirent) => ({
          name: dirent.name,
          isDirectory: await isWalkableSkillDirectory(
            dir,
            dirent,
            options?.followSymlinks !== false,
          ),
        })),
      )
    )
      .filter(
        (entry) =>
          entry.isDirectory &&
          !(
            depth === 0 && options?.excludedTopLevelDirectories?.includes(entry.name)
          ),
      )
      .map((entry) => entry.name)
      .sort();
    const nested = await Promise.all(
      subdirNames.map((name) => visit(nodePath.join(dir, name), depth + 1)),
    );
    return [...directMarkdownFiles, ...nested.flat()];
  }

  return visit(rootPath, 0);
}

export async function readSkillDescriptor(input: {
  readonly skillPath: string;
  readonly scope: string;
  readonly namespace?: string;
}): Promise<ProviderSkillDescriptor | null> {
  let raw: string;
  try {
    raw = await fs.readFile(input.skillPath, "utf8");
  } catch {
    return null;
  }

  const frontmatter = parseSkillFrontmatter(raw);
  const skillFilename = nodePath.basename(input.skillPath);
  const fallbackName =
    skillFilename.toLowerCase() === "skill.md"
      ? nodePath.basename(nodePath.dirname(input.skillPath))
      : nodePath.basename(input.skillPath, nodePath.extname(input.skillPath));
  const unqualifiedName = readStringField(frontmatter, ["name"]) ?? fallbackName;
  const name =
    input.namespace && !unqualifiedName.includes(":")
      ? `${input.namespace}:${unqualifiedName}`
      : unqualifiedName;
  const description = readStringField(frontmatter, ["description"]);
  const displayName = readStringField(frontmatter, ["display-name", "displayName", "title"]);
  const shortDescription = readStringField(frontmatter, [
    "short-description",
    "shortDescription",
    "summary",
  ]);
  const disabled =
    readBooleanField(frontmatter, ["disable-model-invocation", "disableModelInvocation"]) === true;

  return {
    name,
    ...(description ? { description } : {}),
    path: input.skillPath,
    enabled: !disabled,
    scope: input.scope,
    ...(displayName || shortDescription
      ? {
          interface: {
            ...(displayName ? { displayName } : {}),
            ...(shortDescription ? { shortDescription } : {}),
          },
        }
      : {}),
  };
}

export function skillNameKey(name: string): string {
  return name.trim().toLowerCase();
}

async function collectSkillDescriptorsFromRoots(
  roots: ReadonlyArray<SkillRoot>,
): Promise<ProviderSkillDescriptor[]> {
  const skillsPerRoot = await Promise.all(
    roots.map(async (root) => {
      const skillPaths = await collectSkillMarkdownPaths(
        root.path,
        root.includeMarkdownFiles ||
          root.followSymlinks === false ||
          root.excludedTopLevelDirectories
          ? {
              ...(root.includeMarkdownFiles ? { includeMarkdownFiles: true } : {}),
              ...(root.followSymlinks === false ? { followSymlinks: false } : {}),
              ...(root.excludedTopLevelDirectories
                ? { excludedTopLevelDirectories: root.excludedTopLevelDirectories }
                : {}),
            }
          : undefined,
      );
      const descriptors = await Promise.all(
        skillPaths.map((skillPath) =>
          readSkillDescriptor({
            skillPath,
            scope: root.scope,
            ...(root.namespace ? { namespace: root.namespace } : {}),
          }),
        ),
      );
      return descriptors
        .filter((skill) => skill !== null)
        .map((skill) => {
          if (!root.managedKind) {
            return skill;
          }
          const relativeDirectory = nodePath.relative(root.path, nodePath.dirname(skill.path));
          const id = relativeDirectory.split(nodePath.sep)[0]?.trim();
          if (!id || id === "." || id === "..") {
            return skill;
          }
          return {
            ...skill,
            management: {
              kind: root.managedKind,
              id,
              canDelete: root.managedKind === "installed",
            },
          };
        });
    }),
  );
  return skillsPerRoot.flat();
}

// Scans all roots concurrently, then dedupes by name in root order so earlier
// roots keep precedence. Within a root, SKILL.md path order is preserved.
export async function collectSkillsFromRoots(
  roots: ReadonlyArray<SkillRoot>,
): Promise<ProviderSkillDescriptor[]> {
  const allSkills = await collectSkillDescriptorsFromRoots(roots);
  const byName = new Map<string, ProviderSkillDescriptor>();
  for (const skill of allSkills) {
    const key = skillNameKey(skill.name);
    if (!byName.has(key)) {
      byName.set(key, skill);
    }
  }
  return [...byName.values()];
}

// ── Unified cross-provider catalog ───────────────────────────────────

export interface SkillsCatalogDiscoveryInput {
  /** Optional workspace cwd; when present, project-level skill folders are included. */
  readonly cwd?: string | null;
  readonly homeDir: string;
  /** Synara base dir (usually `~/.synara`); skills live in `{base}/skills`. */
  readonly synaraBaseDir: string;
  /** Provider whose native copies should win when the same skill exists in several roots. */
  readonly provider?: ProviderKind | null;
  /** Settings needs every origin; composer/provider pickers keep one winner by name. */
  readonly includeDuplicateOrigins?: boolean;
  /** Bypass the short-lived discovery cache. */
  readonly forceReload?: boolean;
}

export interface SkillsCatalogRootInput extends SkillsCatalogDiscoveryInput {
  /** Native provider scans can opt out; the catalog itself always includes Synara. */
  readonly includeSynaraRoot?: boolean;
}

const HOME_ORIGIN_ORDER = [
  "bundled",
  "synara",
  "codex",
  "claude",
  "cursor",
  "grok",
  "factory",
  "kilo",
  "opencode",
  "pi",
  "agents",
] as const;
export type SkillsCatalogOrigin = (typeof HOME_ORIGIN_ORDER)[number] | "project";

// Composer skill pickers refetch aggressively (per keystroke, per provider); a
// short TTL absorbs that burst while still picking up new skill files quickly.
const SKILLS_CATALOG_CACHE_TTL_MS = 15_000;
const SKILLS_CATALOG_CACHE_MAX_ENTRIES = 64;

interface SkillsCatalogCacheEntry {
  readonly at: number;
  readonly skills: ReadonlyArray<ProviderSkillDescriptor>;
}

const skillsCatalogCache = new Map<string, SkillsCatalogCacheEntry>();
const skillsCatalogInflight = new Map<string, Promise<ReadonlyArray<ProviderSkillDescriptor>>>();
const ensuredSynaraSkillsDirs = new Set<string>();
let skillsCatalogGeneration = 0;

export function clearSkillsCatalogCacheForTests(): void {
  skillsCatalogGeneration = 0;
  skillsCatalogCache.clear();
  skillsCatalogInflight.clear();
  ensuredSynaraSkillsDirs.clear();
}

export function invalidateSkillsCatalogCache(): void {
  skillsCatalogGeneration += 1;
  skillsCatalogCache.clear();
  skillsCatalogInflight.clear();
}

export function synaraSkillsDir(synaraBaseDir: string): string {
  return nodePath.join(synaraBaseDir, "skills");
}

export function bundledSkillsDir(): string | null {
  const configured = process.env.SYNARA_BUNDLED_SKILLS_DIR?.trim();
  return configured ? nodePath.resolve(configured) : null;
}

// Creates the portable skills folder on first use so users have a drop-in target.
export async function ensureSynaraSkillsDir(synaraBaseDir: string): Promise<string> {
  const dir = synaraSkillsDir(synaraBaseDir);
  if (ensuredSynaraSkillsDirs.has(dir)) {
    return dir;
  }
  try {
    await fs.mkdir(dir, { recursive: true });
    ensuredSynaraSkillsDirs.add(dir);
  } catch {
    // Discovery still works without the folder; reads simply return nothing.
  }
  return dir;
}

const MAX_IMPORTED_SKILL_FILES = 512;
const MAX_IMPORTED_SKILL_FILE_BYTES = 4 * 1024 * 1024;
const MAX_IMPORTED_SKILL_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_MANAGED_SKILL_MARKDOWN_BYTES = 1024 * 1024;
const MAX_MANAGED_SKILL_FILES = 512;
const MAX_AGENT_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_DISPLAY_NAME_LENGTH = 100;
const MAX_SKILL_DESCRIPTION_LENGTH = 4_000;

function validateSkillFolderName(value: string): string {
  const folderName = value.trim();
  if (
    folderName.length === 0 ||
    folderName.length > 128 ||
    folderName === "." ||
    folderName === ".." ||
    folderName.includes("/") ||
    folderName.includes("\\") ||
    folderName.includes("\0")
  ) {
    throw new Error("The selected skill folder has an invalid name.");
  }
  return folderName;
}

function validateAgentSkillName(value: string): string {
  const name = value.trim();
  if (
    name.length === 0 ||
    name.length > MAX_AGENT_SKILL_NAME_LENGTH ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
  ) {
    throw new Error("Skill names must use lowercase letters, numbers, and single hyphens only.");
  }
  return name;
}

function normalizedSingleLine(value: string, label: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${label} is too long.`);
  }
  return normalized;
}

function skillShortDescription(description: string): string {
  const firstSentence = description.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? description;
  return firstSentence.length <= 160
    ? firstSentence
    : `${firstSentence.slice(0, 157).trimEnd()}...`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function skillMarkdownBody(markdown: string): string {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "").trim();
}

const EDITOR_MANAGED_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "display-name",
  "displayName",
  "title",
  "short-description",
  "shortDescription",
  "summary",
]);

function preservedSkillFrontmatterLines(markdown: string): string[] {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(normalized);
  if (!match) {
    return [];
  }
  return (match[1] ?? "").split("\n").filter((line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      return true;
    }
    return !EDITOR_MANAGED_FRONTMATTER_KEYS.has(line.slice(0, separatorIndex).trim());
  });
}

function buildEditedSkillMarkdown(input: {
  readonly originalMarkdown?: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly instructions: string;
}): string {
  const displayName = normalizedSingleLine(
    input.displayName,
    "Skill name",
    MAX_SKILL_DISPLAY_NAME_LENGTH,
  );
  const description = normalizedSingleLine(
    input.description,
    "Description",
    MAX_SKILL_DESCRIPTION_LENGTH,
  );
  const instructions = input.instructions.trim();
  if (!instructions) {
    throw new Error("Instructions are required.");
  }
  if (Buffer.byteLength(instructions, "utf8") > MAX_MANAGED_SKILL_MARKDOWN_BYTES) {
    throw new Error("The skill instructions are too large.");
  }
  const preserved = input.originalMarkdown
    ? preservedSkillFrontmatterLines(input.originalMarkdown)
    : [];
  const frontmatter = [
    `name: ${yamlString(input.name)}`,
    `display-name: ${yamlString(displayName)}`,
    `short-description: ${yamlString(skillShortDescription(description))}`,
    `description: ${yamlString(description)}`,
    ...preserved,
  ];
  return `---\n${frontmatter.join("\n")}\n---\n\n${instructions}\n`;
}

function managedSkillRoot(synaraBaseDir: string, kind: ProviderManagedSkillKind): string {
  if (kind === "installed") {
    return synaraSkillsDir(synaraBaseDir);
  }
  const root = bundledSkillsDir();
  if (!root) {
    throw new Error("Bundled skills are unavailable in this build.");
  }
  return root;
}

function managedSkillDescriptor(
  skill: ProviderSkillDescriptor,
  kind: ProviderManagedSkillKind,
  id: string,
): ProviderSkillDescriptor {
  return {
    ...skill,
    management: {
      kind,
      id,
      canDelete: kind === "installed",
    },
  };
}

function validateImportedRelativePath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    normalized.length === 0 ||
    normalized.length > 1_024 ||
    normalized.startsWith("/") ||
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === ".." || segment.includes("\0"),
    )
  ) {
    throw new Error(`The skill contains an invalid path: ${value}`);
  }
  return segments.join("/");
}

function decodeImportedFile(contentBase64: string, relativePath: string): Buffer {
  if (
    contentBase64.length > Math.ceil((MAX_IMPORTED_SKILL_FILE_BYTES * 4) / 3) + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)
  ) {
    throw new Error(`The skill file is invalid or too large: ${relativePath}`);
  }
  const content = Buffer.from(contentBase64, "base64");
  if (content.byteLength > MAX_IMPORTED_SKILL_FILE_BYTES) {
    throw new Error(`The skill file is too large: ${relativePath}`);
  }
  return content;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function bundledSkillNameKeys(): Promise<Set<string>> {
  const root = bundledSkillsDir();
  if (!root) {
    return new Set();
  }
  const skills = await collectSkillsFromRoots([{ path: root, scope: "bundled" }]);
  return new Set(skills.map((skill) => skillNameKey(skill.name)));
}

/**
 * Installs one browser-selected skill directory into Synara's shared skill root.
 * Files are staged first and the destination swap is atomic, so a failed upload
 * never leaves a half-written skill visible to provider discovery.
 */
export async function importSynaraSkill(
  synaraBaseDir: string,
  input: ProviderImportSkillInput,
): Promise<ProviderImportSkillResult> {
  const folderName = validateSkillFolderName(input.folderName);
  if (input.files.length === 0 || input.files.length > MAX_IMPORTED_SKILL_FILES) {
    throw new Error(`A skill must contain between 1 and ${MAX_IMPORTED_SKILL_FILES} files.`);
  }

  const files = input.files.map((file) => {
    const relativePath = validateImportedRelativePath(file.relativePath);
    return {
      relativePath,
      content: decodeImportedFile(file.contentBase64, relativePath),
    };
  });
  const distinctPaths = new Set(files.map((file) => file.relativePath.toLocaleLowerCase()));
  if (distinctPaths.size !== files.length) {
    throw new Error("The selected skill contains duplicate file paths.");
  }
  if (!files.some((file) => file.relativePath === "SKILL.md")) {
    throw new Error("Choose a skill folder containing a SKILL.md file.");
  }
  const totalBytes = files.reduce((total, file) => total + file.content.byteLength, 0);
  if (totalBytes > MAX_IMPORTED_SKILL_TOTAL_BYTES) {
    throw new Error("The selected skill is larger than the 16 MB import limit.");
  }

  const skillsRoot = await ensureSynaraSkillsDir(synaraBaseDir);
  const destination = nodePath.join(skillsRoot, folderName);
  const destinationExists = await pathExists(destination);
  if (destinationExists && input.overwrite !== true) {
    const skill = await readSkillDescriptor({
      skillPath: nodePath.join(destination, "SKILL.md"),
      scope: "synara",
    });
    return {
      status: "conflict",
      folderName,
      ...(skill ? { skill: managedSkillDescriptor(skill, "installed", folderName) } : {}),
    };
  }

  const stagingRoot = await fs.mkdtemp(nodePath.join(skillsRoot, ".skill-import-"));
  const stagedSkill = nodePath.join(stagingRoot, folderName);
  let backupPath: string | null = null;
  try {
    await fs.mkdir(stagedSkill, { recursive: true });
    await Promise.all(
      files.map(async (file) => {
        const target = nodePath.join(stagedSkill, ...file.relativePath.split("/"));
        await fs.mkdir(nodePath.dirname(target), { recursive: true });
        await fs.writeFile(target, file.content, { flag: "wx" });
      }),
    );

    const stagedDescriptor = await readSkillDescriptor({
      skillPath: nodePath.join(stagedSkill, "SKILL.md"),
      scope: "synara",
    });
    if (!stagedDescriptor) {
      throw new Error("The selected SKILL.md could not be read.");
    }
    if ((await bundledSkillNameKeys()).has(skillNameKey(stagedDescriptor.name))) {
      throw new Error(
        `${stagedDescriptor.name} is included with Lattice and does not need to be installed.`,
      );
    }

    if (destinationExists) {
      backupPath = nodePath.join(skillsRoot, `.${folderName}.backup-${randomUUID()}`);
      await fs.rename(destination, backupPath);
    }
    try {
      await fs.rename(stagedSkill, destination);
    } catch (error) {
      if (backupPath) {
        await fs.rename(backupPath, destination);
        backupPath = null;
      }
      throw error;
    }
    if (backupPath) {
      await fs.rm(backupPath, { recursive: true, force: true }).catch(() => undefined);
      backupPath = null;
    }

    invalidateSkillsCatalogCache();
    return {
      status: destinationExists ? "replaced" : "imported",
      folderName,
      skill: {
        ...managedSkillDescriptor(stagedDescriptor, "installed", folderName),
        path: nodePath.join(destination, "SKILL.md"),
      },
    };
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function listManagedSkillFiles(skillDirectory: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [""];
  while (pending.length > 0) {
    const relativeDirectory = pending.pop() ?? "";
    const directory = relativeDirectory
      ? nodePath.join(skillDirectory, ...relativeDirectory.split("/"))
      : skillDirectory;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        pending.push(relativePath);
        continue;
      }
      if (entry.isFile()) {
        files.push(relativePath);
        if (files.length > MAX_MANAGED_SKILL_FILES) {
          throw new Error(
            `This skill contains more than ${MAX_MANAGED_SKILL_FILES} files and cannot be previewed.`,
          );
        }
      }
    }
  }
  return files.toSorted();
}

export async function readManagedSkill(
  synaraBaseDir: string,
  input: {
    readonly kind: ProviderManagedSkillKind;
    readonly id: string;
  },
): Promise<ProviderManagedSkillDetail> {
  const id = validateSkillFolderName(input.id);
  const root = managedSkillRoot(synaraBaseDir, input.kind);
  const skillDirectory = nodePath.join(root, id);
  const skillPath = nodePath.join(skillDirectory, "SKILL.md");
  const descriptor = await readSkillDescriptor({
    skillPath,
    scope: input.kind === "bundled" ? "bundled" : "synara",
  });
  if (!descriptor) {
    throw new Error("The skill no longer exists or its SKILL.md is invalid.");
  }
  const stat = await fs.stat(skillPath);
  if (stat.size > MAX_MANAGED_SKILL_MARKDOWN_BYTES) {
    throw new Error("This SKILL.md is too large to preview.");
  }
  const [markdown, files] = await Promise.all([
    fs.readFile(skillPath, "utf8"),
    listManagedSkillFiles(skillDirectory),
  ]);
  return {
    skill: managedSkillDescriptor(descriptor, input.kind, id),
    markdown,
    files,
  };
}

async function replaceSkillMarkdown(skillPath: string, markdown: string): Promise<void> {
  const directory = nodePath.dirname(skillPath);
  const token = randomUUID();
  const stagedPath = nodePath.join(directory, `.SKILL.md.staged-${token}`);
  const backupPath = nodePath.join(directory, `.SKILL.md.backup-${token}`);
  await fs.writeFile(stagedPath, markdown, { flag: "wx" });
  let movedOriginal = false;
  try {
    await fs.rename(skillPath, backupPath);
    movedOriginal = true;
    try {
      await fs.rename(stagedPath, skillPath);
    } catch (error) {
      await fs.rename(backupPath, skillPath);
      movedOriginal = false;
      throw error;
    }
    movedOriginal = false;
    await fs.rm(backupPath, { force: true });
  } finally {
    await fs.rm(stagedPath, { force: true }).catch(() => undefined);
    if (movedOriginal) {
      await fs.rename(backupPath, skillPath).catch(() => undefined);
    }
  }
}

export async function saveManagedSkill(
  synaraBaseDir: string,
  input: ProviderSaveManagedSkillInput,
): Promise<ProviderSaveManagedSkillResult> {
  if (input.mode === "create") {
    const id = validateAgentSkillName(input.id);
    const markdown = buildEditedSkillMarkdown({
      name: id,
      displayName: input.displayName,
      description: input.description,
      instructions: input.instructions,
    });
    const result = await importSynaraSkill(synaraBaseDir, {
      folderName: id,
      files: [
        {
          relativePath: "SKILL.md",
          contentBase64: Buffer.from(markdown, "utf8").toString("base64"),
        },
      ],
    });
    if (result.status === "conflict") {
      throw new Error("A skill with this name already exists in your user folder.");
    }
    return {
      status: "created",
      detail: await readManagedSkill(synaraBaseDir, { kind: "installed", id }),
    };
  }

  const id = validateSkillFolderName(input.id);
  const detail = await readManagedSkill(synaraBaseDir, { kind: "installed", id });
  const markdown = buildEditedSkillMarkdown({
    originalMarkdown: detail.markdown,
    name: detail.skill.name,
    displayName: input.displayName,
    description: input.description,
    instructions: input.instructions,
  });
  await replaceSkillMarkdown(
    nodePath.join(synaraSkillsDir(synaraBaseDir), id, "SKILL.md"),
    markdown,
  );
  invalidateSkillsCatalogCache();
  return {
    status: "updated",
    detail: await readManagedSkill(synaraBaseDir, { kind: "installed", id }),
  };
}

function displayNameFromSkillName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function customSkillIdBase(id: string): string {
  const normalized = id
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = normalized || "custom-skill";
  const suffix = "-custom";
  return `${base.slice(0, MAX_AGENT_SKILL_NAME_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

async function availableCustomSkillId(synaraBaseDir: string, sourceId: string): Promise<string> {
  const skillsRoot = await ensureSynaraSkillsDir(synaraBaseDir);
  const base = customSkillIdBase(sourceId);
  if (!(await pathExists(nodePath.join(skillsRoot, base)))) {
    return base;
  }
  for (let index = 2; index <= 999; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, MAX_AGENT_SKILL_NAME_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!(await pathExists(nodePath.join(skillsRoot, candidate)))) {
      return candidate;
    }
  }
  throw new Error("Lattice could not choose a name for the editable copy.");
}

export async function duplicateManagedSkill(
  synaraBaseDir: string,
  input: {
    readonly kind: ProviderManagedSkillKind;
    readonly id: string;
  },
): Promise<ProviderDuplicateManagedSkillResult> {
  const sourceId = validateSkillFolderName(input.id);
  const sourceRoot = managedSkillRoot(synaraBaseDir, input.kind);
  const sourceDirectory = nodePath.join(sourceRoot, sourceId);
  const detail = await readManagedSkill(synaraBaseDir, input);
  const id = await availableCustomSkillId(synaraBaseDir, sourceId);
  const displayName =
    detail.skill.interface?.displayName ?? displayNameFromSkillName(detail.skill.name);
  const customDisplayName = `${displayName
    .slice(0, MAX_SKILL_DISPLAY_NAME_LENGTH - " Custom".length)
    .trimEnd()} Custom`;
  const description = detail.skill.description ?? `A customized copy of ${displayName}.`;
  const markdown = buildEditedSkillMarkdown({
    originalMarkdown: detail.markdown,
    name: id,
    displayName: customDisplayName,
    description,
    instructions: skillMarkdownBody(detail.markdown),
  });
  let totalBytes = 0;
  const files = await Promise.all(
    detail.files.map(async (relativePath) => {
      const content =
        relativePath === "SKILL.md"
          ? Buffer.from(markdown, "utf8")
          : await fs.readFile(nodePath.join(sourceDirectory, ...relativePath.split("/")));
      if (content.byteLength > MAX_IMPORTED_SKILL_FILE_BYTES) {
        throw new Error(`The skill file is too large to copy: ${relativePath}`);
      }
      totalBytes += content.byteLength;
      return {
        relativePath,
        contentBase64: content.toString("base64"),
      };
    }),
  );
  if (totalBytes > MAX_IMPORTED_SKILL_TOTAL_BYTES) {
    throw new Error("This skill is too large to copy into your user folder.");
  }
  const result = await importSynaraSkill(synaraBaseDir, {
    folderName: id,
    files,
  });
  if (result.status === "conflict") {
    throw new Error("Another skill copy was created at the same time. Try again.");
  }
  return {
    detail: await readManagedSkill(synaraBaseDir, { kind: "installed", id }),
  };
}

function skillTrashDir(synaraBaseDir: string): string {
  return nodePath.join(synaraBaseDir, "skill-trash");
}

function validateSkillTrashId(value: string): string {
  const trashId = value.trim();
  if (trashId.length === 0 || trashId.length > 160 || !/^[a-z0-9-]+$/i.test(trashId)) {
    throw new Error("The skill restore token is invalid.");
  }
  return trashId;
}

export async function removeManagedSkill(
  synaraBaseDir: string,
  input: { readonly id: string },
): Promise<ProviderRemoveManagedSkillResult> {
  const id = validateSkillFolderName(input.id);
  const skillsRoot = await ensureSynaraSkillsDir(synaraBaseDir);
  const skillDirectory = nodePath.join(skillsRoot, id);
  const descriptor = await readSkillDescriptor({
    skillPath: nodePath.join(skillDirectory, "SKILL.md"),
    scope: "synara",
  });
  if (!descriptor) {
    throw new Error("The installed skill no longer exists.");
  }
  const trashRoot = skillTrashDir(synaraBaseDir);
  await fs.mkdir(trashRoot, { recursive: true });
  const trashId = `${Date.now().toString(36)}-${randomUUID()}`;
  await fs.rename(skillDirectory, nodePath.join(trashRoot, trashId));
  invalidateSkillsCatalogCache();
  return { id, name: descriptor.name, trashId };
}

export async function restoreManagedSkill(
  synaraBaseDir: string,
  input: {
    readonly id: string;
    readonly trashId: string;
  },
): Promise<ProviderRestoreManagedSkillResult> {
  const id = validateSkillFolderName(input.id);
  const trashId = validateSkillTrashId(input.trashId);
  const skillsRoot = await ensureSynaraSkillsDir(synaraBaseDir);
  const destination = nodePath.join(skillsRoot, id);
  if (await pathExists(destination)) {
    throw new Error("A skill with this folder name is already installed.");
  }
  const trashedSkill = nodePath.join(skillTrashDir(synaraBaseDir), trashId);
  if (!(await pathExists(trashedSkill))) {
    throw new Error("This removed skill is no longer available to restore.");
  }
  await fs.rename(trashedSkill, destination);
  const descriptor = await readSkillDescriptor({
    skillPath: nodePath.join(destination, "SKILL.md"),
    scope: "synara",
  });
  if (!descriptor) {
    await fs.rename(destination, trashedSkill).catch(() => undefined);
    throw new Error("The restored skill has an invalid SKILL.md.");
  }
  invalidateSkillsCatalogCache();
  return {
    skill: managedSkillDescriptor(descriptor, "installed", id),
  };
}

type SkillsHomeOrigin = (typeof HOME_ORIGIN_ORDER)[number];

interface SkillOriginRootSpec {
  readonly homeRoots: (input: SkillsCatalogDiscoveryInput) => string[];
  readonly projectRootNames: readonly string[];
}

const SKILL_ORIGIN_ROOTS = {
  bundled: {
    homeRoots: () => {
      const root = bundledSkillsDir();
      return root ? [root] : [];
    },
    projectRootNames: [],
  },
  synara: {
    homeRoots: (input) => [synaraSkillsDir(input.synaraBaseDir)],
    projectRootNames: [".synara"],
  },
  codex: {
    // Keep Synara's existing Codex-local root. Official Codex discovery uses
    // `.agents/skills`, which is represented separately by the shared origin.
    homeRoots: (input) => [nodePath.join(input.homeDir, ".codex", "skills")],
    projectRootNames: [".codex"],
  },
  claude: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".claude", "skills")],
    projectRootNames: [".claude"],
  },
  cursor: {
    homeRoots: (input) => [
      nodePath.join(input.homeDir, ".cursor", "skills-cursor"),
      nodePath.join(input.homeDir, ".cursor", "skills"),
    ],
    projectRootNames: [".cursor"],
  },
  grok: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".grok", "skills")],
    projectRootNames: [".grok"],
  },
  factory: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".factory", "skills")],
    projectRootNames: [".factory"],
  },
  kilo: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".kilo", "skills")],
    projectRootNames: [".kilo"],
  },
  opencode: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".config", "opencode", "skills")],
    projectRootNames: [".opencode"],
  },
  pi: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".pi", "agent", "skills")],
    projectRootNames: [".pi"],
  },
  agents: {
    homeRoots: (input) => [nodePath.join(input.homeDir, ".agents", "skills")],
    projectRootNames: [".agents"],
  },
} as const satisfies Record<SkillsHomeOrigin, SkillOriginRootSpec>;

const PROVIDER_SKILL_ORIGIN_PREFERENCES = {
  codex: ["codex", "agents"],
  claudeAgent: ["claude"],
  cursor: ["cursor", "agents", "claude", "codex"],
  antigravity: ["agents"],
  grok: ["grok", "claude", "agents"],
  droid: ["factory", "agents", "claude", "codex"],
  kilo: ["kilo", "agents", "claude"],
  opencode: ["opencode", "claude", "agents"],
  pi: ["pi", "agents"],
} as const satisfies Partial<Record<ProviderKind, readonly SkillsHomeOrigin[]>>;

function homeRootsForOrigin(
  origin: SkillsHomeOrigin,
  input: SkillsCatalogDiscoveryInput,
): string[] {
  return SKILL_ORIGIN_ROOTS[origin].homeRoots(input);
}

function projectRootNamesForOrigin(origin: SkillsHomeOrigin): readonly string[] {
  return SKILL_ORIGIN_ROOTS[origin].projectRootNames;
}

// Native copies first so an agent keeps using its own skill, then Synara as the
// portable fallback, then the remaining provider homes for cross-provider reuse.
function preferredOriginsForProvider(
  provider: ProviderKind | null | undefined,
): ReadonlyArray<SkillsHomeOrigin> {
  return provider ? (PROVIDER_SKILL_ORIGIN_PREFERENCES[provider] ?? []) : [];
}

function orderedOriginsForProvider(
  provider: ProviderKind | null | undefined,
  includeSynaraRoot = true,
  includeRemainingOrigins = true,
): SkillsHomeOrigin[] {
  const preferred = preferredOriginsForProvider(provider);
  const ordered = [...preferred];
  if (includeSynaraRoot && !ordered.includes("bundled")) {
    ordered.push("bundled");
  }
  if (includeSynaraRoot && !ordered.includes("synara")) {
    ordered.push("synara");
  }
  if (!includeRemainingOrigins) {
    return ordered.filter(
      (origin) => includeSynaraRoot || (origin !== "bundled" && origin !== "synara"),
    );
  }
  for (const origin of HOME_ORIGIN_ORDER) {
    if (!includeSynaraRoot && (origin === "bundled" || origin === "synara")) {
      continue;
    }
    if (!ordered.includes(origin)) {
      ordered.push(origin);
    }
  }
  return ordered;
}

function rootsForOrderedOrigins(
  input: SkillsCatalogRootInput,
  orderedOrigins: ReadonlyArray<SkillsHomeOrigin>,
): SkillRoot[] {
  const homeRoots = orderedOrigins.flatMap((origin) =>
    homeRootsForOrigin(origin, input).map((path) => ({
      path,
      scope: origin,
      ...(origin === "bundled" ? { managedKind: "bundled" as const } : {}),
      ...(origin === "synara" ? { managedKind: "installed" as const } : {}),
      ...(origin === "pi" ? { includeMarkdownFiles: true } : {}),
    })),
  );
  const homeRootPaths = new Set(homeRoots.map((root) => nodePath.resolve(root.path)));

  const projectRoots: SkillRoot[] = [];
  const cwd = input.cwd?.trim();
  if (cwd) {
    for (const ancestor of ancestorsFromDeepest(cwd)) {
      const seenRootNames = new Set<string>();
      for (const origin of orderedOrigins) {
        for (const rootName of projectRootNamesForOrigin(origin)) {
          if (seenRootNames.has(rootName)) {
            continue;
          }
          seenRootNames.add(rootName);
          const rootPath = nodePath.join(ancestor, rootName, "skills");
          // A cwd under the home dir reaches the home skill folders as
          // "project ancestors"; skip them here so each folder is scanned once
          // and keeps its true origin scope. Precedence is unchanged because
          // project and home roots share the same origin ordering.
          if (homeRootPaths.has(nodePath.resolve(rootPath))) {
            continue;
          }
          projectRoots.push({
            path: rootPath,
            scope: "project",
            ...(origin === "pi" ? { includeMarkdownFiles: true } : {}),
          });
        }
      }
    }
  }

  return [...projectRoots, ...homeRoots];
}

export function skillsCatalogRoots(input: SkillsCatalogRootInput): SkillRoot[] {
  const roots = rootsForOrderedOrigins(
    input,
    orderedOriginsForProvider(input.provider, input.includeSynaraRoot !== false),
  );
  const cursorBuiltInRoot = nodePath.resolve(
    nodePath.join(input.homeDir, ".cursor", "skills-cursor"),
  );
  const codexUserRoot = nodePath.resolve(nodePath.join(input.homeDir, ".codex", "skills"));
  return roots
    .filter((root) => nodePath.resolve(root.path) !== cursorBuiltInRoot)
    .map((root) =>
      nodePath.resolve(root.path) === codexUserRoot
        ? { ...root, excludedTopLevelDirectories: [".system"] }
        : root,
    );
}

export function providerNativeSkillRoots(input: SkillsCatalogRootInput): SkillRoot[] {
  return rootsForOrderedOrigins(input, orderedOriginsForProvider(input.provider, false, false));
}

export async function discoverSkillsCatalog(
  input: SkillsCatalogDiscoveryInput,
): Promise<ProviderSkillDescriptor[]> {
  const cacheKey = [
    input.cwd?.trim() ?? "",
    input.provider ?? "",
    input.homeDir,
    input.synaraBaseDir,
    bundledSkillsDir() ?? "",
    input.includeDuplicateOrigins ? "all-origins" : "deduped",
  ].join("\u0000");

  if (!input.forceReload) {
    const entry = skillsCatalogCache.get(cacheKey);
    if (entry && Date.now() - entry.at <= SKILLS_CATALOG_CACHE_TTL_MS) {
      return [...entry.skills];
    }
  }

  const inflight = skillsCatalogInflight.get(cacheKey);
  if (inflight) {
    return [...(await inflight)];
  }

  const generation = skillsCatalogGeneration;
  const scan = (async () => {
    await ensureSynaraSkillsDir(input.synaraBaseDir);
    const roots = [
      ...skillsCatalogRoots(input),
      ...(await discoverClaudePluginSkillRoots({
        homeDir: input.homeDir,
        ...(input.cwd ? { cwd: input.cwd } : {}),
      })),
    ];
    const skills = input.includeDuplicateOrigins
      ? await collectSkillDescriptorsFromRoots(roots)
      : await collectSkillsFromRoots(roots);

    if (generation === skillsCatalogGeneration) {
      skillsCatalogCache.delete(cacheKey);
      skillsCatalogCache.set(cacheKey, { at: Date.now(), skills });
      while (skillsCatalogCache.size > SKILLS_CATALOG_CACHE_MAX_ENTRIES) {
        const oldestKey = skillsCatalogCache.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        skillsCatalogCache.delete(oldestKey);
      }
    }
    return skills;
  })();

  skillsCatalogInflight.set(cacheKey, scan);
  try {
    return [...(await scan)];
  } finally {
    if (skillsCatalogInflight.get(cacheKey) === scan) {
      skillsCatalogInflight.delete(cacheKey);
    }
  }
}

// Provider-native discovery results win on name conflicts; catalog entries fill the gaps.
export function mergeSkillsIntoCatalog(input: {
  readonly native: ReadonlyArray<ProviderSkillDescriptor>;
  readonly catalog: ReadonlyArray<ProviderSkillDescriptor>;
}): ProviderSkillDescriptor[] {
  const byName = new Map<string, ProviderSkillDescriptor>();
  for (const skill of [...input.native, ...input.catalog]) {
    const key = skillNameKey(skill.name);
    if (!byName.has(key)) {
      byName.set(key, skill);
    }
  }
  return [...byName.values()];
}

export function filterDisabledSkills(
  skills: ReadonlyArray<ProviderSkillDescriptor>,
  disabledNames: ReadonlyArray<string>,
): ProviderSkillDescriptor[] {
  if (disabledNames.length === 0) {
    return [...skills];
  }
  const disabled = new Set(disabledNames.map((name) => skillNameKey(name)));
  return skills.filter((skill) => !disabled.has(skillNameKey(skill.name)));
}
