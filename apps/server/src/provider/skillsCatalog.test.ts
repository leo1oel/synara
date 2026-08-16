// FILE: skillsCatalog.test.ts
// Purpose: Verifies the unified cross-provider skills catalog discovery, dedup
//          precedence, merge with provider-native results, and toggle filtering.
// Layer: Server provider tests

import { mkdtempSync, rmSync } from "node:fs";
import { access, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ProviderSkillDescriptor } from "@synara/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSkillsCatalogCacheForTests,
  discoverSkillsCatalog,
  duplicateManagedSkill,
  filterDisabledSkills,
  importSynaraSkill,
  mergeSkillsIntoCatalog,
  parseSkillFrontmatter,
  readManagedSkill,
  removeManagedSkill,
  restoreManagedSkill,
  saveManagedSkill,
} from "./skillsCatalog.ts";
import { pathIsWithin } from "./claudePluginSkills.ts";

let root: string;
let homeDir: string;
let synaraBaseDir: string;

async function writeSkill(skillDir: string, name: string, description: string): Promise<void> {
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
name: ${name}
description: ${description}
---

# ${name}
`,
  );
}

function claudePluginInstallPath(marketplace: string, plugin: string, version: string): string {
  return path.join(homeDir, ".claude", "plugins", "cache", marketplace, plugin, version);
}

async function writeClaudePluginManifest(
  plugins: Record<string, ReadonlyArray<Record<string, unknown>> | unknown>,
): Promise<void> {
  const manifestPath = path.join(homeDir, ".claude", "plugins", "installed_plugins.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({ version: 2, plugins }, null, 2));
}

beforeEach(() => {
  clearSkillsCatalogCacheForTests();
  root = mkdtempSync(path.join(os.tmpdir(), "synara-skills-catalog-"));
  homeDir = path.join(root, "home");
  synaraBaseDir = path.join(homeDir, ".synara");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("parseSkillFrontmatter", () => {
  it("parses scalar Agent Skill metadata", () => {
    expect(
      parseSkillFrontmatter(`---
name: check-code
description: "Review recent code changes"
disable-model-invocation: true
---

# Check Code
`),
    ).toEqual({
      name: "check-code",
      description: "Review recent code changes",
      "disable-model-invocation": true,
    });
  });

  it("unescapes editor-generated quoted metadata", () => {
    expect(
      parseSkillFrontmatter(`---
name: "quote-check"
description: "Use when the user says \\"check this\\"."
---
`),
    ).toMatchObject({
      name: "quote-check",
      description: 'Use when the user says "check this".',
    });
  });

  it("parses folded and literal block descriptions", () => {
    expect(
      parseSkillFrontmatter(`---
name: create-skill
description: >-
  Create Cursor Agent Skills. Use when authoring a new skill or asking about
  SKILL.md structure.
notes: |-
  First line.
  Second line.
enabled: true
---
`),
    ).toMatchObject({
      name: "create-skill",
      description:
        "Create Cursor Agent Skills. Use when authoring a new skill or asking about SKILL.md structure.",
      notes: "First line.\nSecond line.",
      enabled: true,
    });
  });

  it("omits empty block descriptions instead of exposing the YAML marker", () => {
    expect(
      parseSkillFrontmatter(`---
name: no-description
description: >-
enabled: true
---
`),
    ).toEqual({ name: "no-description", enabled: true });
  });
});

describe("importSynaraSkill", () => {
  const encoded = (value: string) => Buffer.from(value).toString("base64");

  it("installs a complete skill folder and invalidates cached discovery", async () => {
    await discoverSkillsCatalog({ homeDir, synaraBaseDir });

    const result = await importSynaraSkill(synaraBaseDir, {
      folderName: "paper-review",
      files: [
        {
          relativePath: "SKILL.md",
          contentBase64: encoded(`---
name: paper-review
description: Review a research paper
---

# Paper review
`),
        },
        {
          relativePath: "references/checklist.md",
          contentBase64: encoded("# Checklist"),
        },
      ],
    });

    expect(result.status).toBe("imported");
    expect(result.skill?.name).toBe("paper-review");
    await expect(
      readFile(
        path.join(synaraBaseDir, "skills", "paper-review", "references", "checklist.md"),
        "utf8",
      ),
    ).resolves.toBe("# Checklist");

    const refreshed = await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    expect(refreshed.find((skill) => skill.name === "paper-review")?.scope).toBe("synara");
  });

  it("requires confirmation before replacing an existing shared skill", async () => {
    await writeSkill(
      path.join(synaraBaseDir, "skills", "paper-review"),
      "paper-review",
      "Original",
    );
    const files = [
      {
        relativePath: "SKILL.md",
        contentBase64: encoded(`---
name: paper-review
description: Updated
---
`),
      },
    ];

    const conflict = await importSynaraSkill(synaraBaseDir, {
      folderName: "paper-review",
      files,
    });
    expect(conflict.status).toBe("conflict");
    await expect(
      readFile(path.join(synaraBaseDir, "skills", "paper-review", "SKILL.md"), "utf8"),
    ).resolves.toContain("Original");

    const replaced = await importSynaraSkill(synaraBaseDir, {
      folderName: "paper-review",
      files,
      overwrite: true,
    });
    expect(replaced.status).toBe("replaced");
    await expect(
      readFile(path.join(synaraBaseDir, "skills", "paper-review", "SKILL.md"), "utf8"),
    ).resolves.toContain("Updated");
  });

  it("rejects paths that escape the selected skill folder", async () => {
    await expect(
      importSynaraSkill(synaraBaseDir, {
        folderName: "unsafe",
        files: [
          { relativePath: "SKILL.md", contentBase64: encoded("# Unsafe") },
          { relativePath: "../outside.txt", contentBase64: encoded("outside") },
        ],
      }),
    ).rejects.toThrow("invalid path");
    await expect(access(path.join(synaraBaseDir, "outside.txt"))).rejects.toThrow();
  });

  it("protects skills that are included with Lattice from replacement", async () => {
    const bundledRoot = path.join(root, "bundled-skills");
    await writeSkill(
      path.join(bundledRoot, "humanize-writing"),
      "humanize-writing",
      "Included with Lattice",
    );
    vi.stubEnv("SYNARA_BUNDLED_SKILLS_DIR", bundledRoot);

    await expect(
      importSynaraSkill(synaraBaseDir, {
        folderName: "humanize-writing-copy",
        files: [
          {
            relativePath: "SKILL.md",
            contentBase64: encoded(`---
name: humanize-writing
description: User copy
---
`),
          },
        ],
      }),
    ).rejects.toThrow("included with Lattice");
    await expect(
      access(path.join(synaraBaseDir, "skills", "humanize-writing-copy")),
    ).rejects.toThrow();
  });
});

describe("managed skills", () => {
  it("creates and edits a skill without requiring an external Markdown editor", async () => {
    const created = await saveManagedSkill(synaraBaseDir, {
      mode: "create",
      id: "literature-review",
      displayName: "Literature Review",
      description: "Review papers and check claims against primary sources.",
      instructions: "# Workflow\n\nRead the paper before summarizing it.",
    });

    expect(created.status).toBe("created");
    expect(created.detail.skill.interface?.displayName).toBe("Literature Review");
    expect(created.detail.markdown).toContain('name: "literature-review"');
    expect(created.detail.markdown).toContain("# Workflow");

    const skillDir = path.join(synaraBaseDir, "skills", "literature-review");
    await mkdir(path.join(skillDir, "references"), { recursive: true });
    await writeFile(path.join(skillDir, "references", "checks.md"), "# Checks");
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      created.detail.markdown.replace(
        "---\n\n# Workflow",
        "disable-model-invocation: false\n---\n\n# Workflow",
      ),
    );

    const updated = await saveManagedSkill(synaraBaseDir, {
      mode: "update",
      id: "literature-review",
      displayName: "Evidence Review",
      description: "Review evidence and identify unsupported claims.",
      instructions: "# Updated workflow\n\nCheck every citation.",
    });

    expect(updated.status).toBe("updated");
    expect(updated.detail.skill.name).toBe("literature-review");
    expect(updated.detail.skill.interface?.displayName).toBe("Evidence Review");
    expect(updated.detail.files).toContain("references/checks.md");
    expect(updated.detail.markdown).toContain("disable-model-invocation: false");
    expect(updated.detail.markdown).toContain("# Updated workflow");
  });

  it("duplicates a bundled skill and all of its resources into the user folder", async () => {
    const bundledRoot = path.join(root, "bundled-skills");
    const bundledSkillDir = path.join(bundledRoot, "research-taste");
    await writeSkill(bundledSkillDir, "research-taste", "Choose worthwhile research.");
    await mkdir(path.join(bundledSkillDir, "references"), { recursive: true });
    await writeFile(path.join(bundledSkillDir, "references", "taste.md"), "# Taste");
    vi.stubEnv("SYNARA_BUNDLED_SKILLS_DIR", bundledRoot);

    const copied = await duplicateManagedSkill(synaraBaseDir, {
      kind: "bundled",
      id: "research-taste",
    });

    expect(copied.detail.skill.management).toMatchObject({
      kind: "installed",
      id: "research-taste-custom",
      canDelete: true,
    });
    expect(copied.detail.skill.name).toBe("research-taste-custom");
    expect(copied.detail.files).toContain("references/taste.md");
    await expect(
      readFile(
        path.join(synaraBaseDir, "skills", "research-taste-custom", "references", "taste.md"),
        "utf8",
      ),
    ).resolves.toBe("# Taste");
    await expect(readFile(path.join(bundledSkillDir, "SKILL.md"), "utf8")).resolves.toContain(
      "name: research-taste",
    );
  });

  it("reads installed skill details, removes them recoverably, and restores them", async () => {
    const skillDir = path.join(synaraBaseDir, "skills", "paper-review");
    await writeSkill(skillDir, "paper-review", "Review a paper");
    await mkdir(path.join(skillDir, "references"), { recursive: true });
    await writeFile(path.join(skillDir, "references", "checklist.md"), "# Checklist");
    await symlink(path.join(root, "outside.md"), path.join(skillDir, "references", "outside.md"));

    const detail = await readManagedSkill(synaraBaseDir, {
      kind: "installed",
      id: "paper-review",
    });
    expect(detail.skill.management).toEqual({
      kind: "installed",
      id: "paper-review",
      canDelete: true,
    });
    expect(detail.files).toEqual(["SKILL.md", "references/checklist.md"]);
    expect(detail.markdown).toContain("# paper-review");

    const removed = await removeManagedSkill(synaraBaseDir, { id: "paper-review" });
    await expect(access(skillDir)).rejects.toThrow();
    await expect(
      access(path.join(synaraBaseDir, "skill-trash", removed.trashId, "SKILL.md")),
    ).resolves.toBeUndefined();

    const restored = await restoreManagedSkill(synaraBaseDir, {
      id: removed.id,
      trashId: removed.trashId,
    });
    expect(restored.skill.management?.kind).toBe("installed");
    await expect(access(path.join(skillDir, "SKILL.md"))).resolves.toBeUndefined();
  });

  it("discovers bundled skills ahead of user and provider copies", async () => {
    const bundledRoot = path.join(root, "bundled-skills");
    await writeSkill(path.join(bundledRoot, "research-taste"), "research-taste", "Bundled copy");
    await writeSkill(
      path.join(synaraBaseDir, "skills", "research-taste"),
      "research-taste",
      "User copy",
    );
    await writeSkill(
      path.join(homeDir, ".codex", "skills", "research-taste"),
      "research-taste",
      "Provider copy",
    );
    vi.stubEnv("SYNARA_BUNDLED_SKILLS_DIR", bundledRoot);

    const skills = await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    const researchTaste = skills.find((skill) => skill.name === "research-taste");
    expect(researchTaste?.scope).toBe("bundled");
    expect(researchTaste?.management).toEqual({
      kind: "bundled",
      id: "research-taste",
      canDelete: false,
    });
  });
});

describe("pathIsWithin", () => {
  it("rejects Windows paths on another drive while preserving same-drive containment", () => {
    expect(pathIsWithin("C:\\plugins", "C:\\plugins", path.win32)).toBe(true);
    expect(pathIsWithin("C:\\plugins", "C:\\plugins\\workflow-kit", path.win32)).toBe(true);
    expect(pathIsWithin("C:\\plugins", "C:\\other", path.win32)).toBe(false);
    expect(pathIsWithin("C:\\plugins", "D:\\plugins\\workflow-kit", path.win32)).toBe(false);
  });
});

describe("discoverSkillsCatalog", () => {
  it("creates the Synara skills folder on first discovery", async () => {
    await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    await expect(access(path.join(synaraBaseDir, "skills"))).resolves.toBeUndefined();
  });

  it("aggregates skills from synara and provider home folders with origin scopes", async () => {
    await writeSkill(path.join(synaraBaseDir, "skills", "portable"), "portable", "Synara skill");
    await writeSkill(path.join(homeDir, ".codex", "skills", "codex-only"), "codex-only", "Codex");
    await writeSkill(
      path.join(homeDir, ".claude", "skills", "claude-only"),
      "claude-only",
      "Claude",
    );
    await writeSkill(
      path.join(homeDir, ".cursor", "skills", "cursor-only"),
      "cursor-only",
      "Cursor",
    );
    await writeSkill(path.join(homeDir, ".grok", "skills", "grok-only"), "grok-only", "Grok");
    await writeSkill(path.join(homeDir, ".kilo", "skills", "kilo-only"), "kilo-only", "Kilo");
    await writeSkill(
      path.join(homeDir, ".config", "opencode", "skills", "opencode-only"),
      "opencode-only",
      "OpenCode",
    );
    await writeSkill(path.join(homeDir, ".pi", "agent", "skills", "pi-only"), "pi-only", "Pi");

    const skills = await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    const byName = new Map(skills.map((skill) => [skill.name, skill]));

    expect(byName.get("portable")?.scope).toBe("synara");
    expect(byName.get("codex-only")?.scope).toBe("codex");
    expect(byName.get("claude-only")?.scope).toBe("claude");
    expect(byName.get("cursor-only")?.scope).toBe("cursor");
    expect(byName.get("grok-only")?.scope).toBe("grok");
    expect(byName.get("kilo-only")?.scope).toBe("kilo");
    expect(byName.get("opencode-only")?.scope).toBe("opencode");
    expect(byName.get("pi-only")?.scope).toBe("pi");
  });

  it("hides provider-owned built-in skills while preserving user and project skills", async () => {
    await writeSkill(
      path.join(homeDir, ".codex", "skills", ".system", "skill-creator"),
      "codex-built-in",
      "Codex built-in",
    );
    await writeSkill(
      path.join(homeDir, ".codex", "skills", "user-review"),
      "codex-user",
      "Codex user skill",
    );
    await writeSkill(
      path.join(homeDir, ".cursor", "skills-cursor", "create-skill"),
      "cursor-built-in",
      "Cursor built-in",
    );
    await writeSkill(
      path.join(homeDir, ".cursor", "skills", "user-review"),
      "cursor-user",
      "Cursor user skill",
    );
    const cwd = path.join(root, "repo");
    await writeSkill(
      path.join(cwd, ".codex", "skills", ".system", "project-helper"),
      "project-system-name",
      "Project skill",
    );

    const skills = await discoverSkillsCatalog({ cwd, homeDir, synaraBaseDir });
    const names = skills.map((skill) => skill.name);

    expect(names).not.toContain("codex-built-in");
    expect(names).not.toContain("cursor-built-in");
    expect(names).toEqual(
      expect.arrayContaining(["codex-user", "cursor-user", "project-system-name"]),
    );
  });

  it("discovers only the registered Claude plugin version for Grok with its native namespace", async () => {
    const currentInstallPath = claudePluginInstallPath("skill-forge", "workflow-kit", "1.21.0");
    const staleInstallPath = claudePluginInstallPath("skill-forge", "workflow-kit", "1.20.0");
    await writeSkill(
      path.join(currentInstallPath, "skills", "feature-delivery"),
      "feature-delivery",
      "Deliver a feature",
    );
    await writeSkill(
      path.join(staleInstallPath, "skills", "stale-only"),
      "stale-only",
      "Old cache entry",
    );
    await writeClaudePluginManifest({
      "workflow-kit@skill-forge": [
        {
          scope: "user",
          installPath: currentInstallPath,
          version: "1.21.0",
        },
      ],
    });

    const skills = await discoverSkillsCatalog({
      homeDir,
      synaraBaseDir,
      provider: "grok",
    });

    expect(skills.find((skill) => skill.name === "workflow-kit:feature-delivery")).toMatchObject({
      scope: "claude",
      path: await realpath(path.join(currentInstallPath, "skills", "feature-delivery", "SKILL.md")),
    });
    expect(skills.some((skill) => skill.name.includes("stale-only"))).toBe(false);
  });

  it("dedupes duplicate Claude plugin registrations deterministically", async () => {
    const installPath = claudePluginInstallPath("skill-forge", "workflow-kit", "1.21.0");
    await writeSkill(
      path.join(installPath, "skills", "feature-delivery"),
      "feature-delivery",
      "Deliver a feature",
    );
    const install = { scope: "user", installPath, version: "1.21.0" };
    await writeClaudePluginManifest({
      "workflow-kit@skill-forge": [install, install],
    });

    const skills = await discoverSkillsCatalog({
      homeDir,
      synaraBaseDir,
      includeDuplicateOrigins: true,
    });

    expect(skills.filter((skill) => skill.name === "workflow-kit:feature-delivery")).toHaveLength(
      1,
    );
  });

  it("uses deterministic plugin-id precedence when namespaces and skill names collide", async () => {
    const alphaInstallPath = claudePluginInstallPath("alpha", "workflow-kit", "1.0.0");
    const zetaInstallPath = claudePluginInstallPath("zeta", "workflow-kit", "1.0.0");
    await Promise.all([
      writeSkill(
        path.join(alphaInstallPath, "skills", "feature-delivery"),
        "feature-delivery",
        "Alpha copy",
      ),
      writeSkill(
        path.join(zetaInstallPath, "skills", "feature-delivery"),
        "feature-delivery",
        "Zeta copy",
      ),
    ]);
    await writeClaudePluginManifest({
      "workflow-kit@zeta": [{ scope: "user", installPath: zetaInstallPath }],
      "workflow-kit@alpha": [{ scope: "user", installPath: alphaInstallPath }],
    });

    const skills = await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    const featureDelivery = skills.find((skill) => skill.name === "workflow-kit:feature-delivery");

    expect(featureDelivery?.description).toBe("Alpha copy");
    expect(featureDelivery?.path).toContain(path.join("cache", "alpha", "workflow-kit"));
  });

  it("includes user and matching project Claude plugins but excludes other projects", async () => {
    const cwd = path.join(root, "repo", "packages", "web");
    const otherProject = path.join(root, "other-repo");
    await Promise.all([mkdir(cwd, { recursive: true }), mkdir(otherProject, { recursive: true })]);
    const userInstallPath = claudePluginInstallPath("plugins", "user-tools", "1.0.0");
    const projectInstallPath = claudePluginInstallPath("plugins", "project-tools", "1.0.0");
    const otherInstallPath = claudePluginInstallPath("plugins", "other-tools", "1.0.0");
    await Promise.all([
      writeSkill(path.join(userInstallPath, "skills", "user-skill"), "user-skill", "User"),
      writeSkill(
        path.join(projectInstallPath, "skills", "project-skill"),
        "project-skill",
        "Project",
      ),
      writeSkill(path.join(otherInstallPath, "skills", "other-skill"), "other-skill", "Other"),
    ]);
    await writeClaudePluginManifest({
      "user-tools@plugins": [{ scope: "user", installPath: userInstallPath }],
      "project-tools@plugins": [
        { scope: "project", projectPath: path.join(root, "repo"), installPath: projectInstallPath },
      ],
      "other-tools@plugins": [
        { scope: "project", projectPath: otherProject, installPath: otherInstallPath },
      ],
    });

    const skills = await discoverSkillsCatalog({ cwd, homeDir, synaraBaseDir });
    expect(skills.map((skill) => skill.name)).toEqual(
      expect.arrayContaining(["user-tools:user-skill", "project-tools:project-skill"]),
    );
    expect(skills.some((skill) => skill.name === "other-tools:other-skill")).toBe(false);
  });

  it("uses one highest-precedence applicable install per Claude plugin ID", async () => {
    const cwd = path.join(root, "repo", "packages", "web");
    await mkdir(cwd, { recursive: true });
    const userInstallPath = claudePluginInstallPath("plugins", "workflow-kit", "1.0.0");
    const projectInstallPath = claudePluginInstallPath("plugins", "workflow-kit", "2.0.0");
    await Promise.all([
      writeSkill(path.join(userInstallPath, "skills", "user-only"), "user-only", "User copy only"),
      writeSkill(
        path.join(projectInstallPath, "skills", "project-only"),
        "project-only",
        "Project copy only",
      ),
    ]);
    await writeClaudePluginManifest({
      "workflow-kit@plugins": [
        { scope: "user", installPath: userInstallPath },
        {
          scope: "project",
          projectPath: path.join(root, "repo"),
          installPath: projectInstallPath,
        },
      ],
    });

    const skills = await discoverSkillsCatalog({ cwd, homeDir, synaraBaseDir });
    expect(skills.map((skill) => skill.name)).toContain("workflow-kit:project-only");
    expect(skills.map((skill) => skill.name)).not.toContain("workflow-kit:user-only");
  });

  it("ignores malformed registrations and install paths outside Claude's plugin cache", async () => {
    const validInstallPath = claudePluginInstallPath("plugins", "valid", "1.0.0");
    const outsideInstallPath = path.join(root, "outside-plugin");
    await writeSkill(path.join(validInstallPath, "skills", "valid-skill"), "valid-skill", "Valid");
    await writeSkill(
      path.join(outsideInstallPath, "skills", "outside-skill"),
      "outside-skill",
      "Outside",
    );
    await symlink(
      path.join(outsideInstallPath, "skills", "outside-skill"),
      path.join(validInstallPath, "skills", "linked-outside"),
      "dir",
    );
    await writeClaudePluginManifest({
      "valid@plugins": [{ scope: "user", installPath: validInstallPath }],
      "outside@plugins": [{ scope: "user", installPath: outsideInstallPath }],
      "relative@plugins": [{ scope: "user", installPath: "relative/plugin" }],
      "missing@plugins": [{ scope: "user", installPath: path.join(validInstallPath, "missing") }],
      malformed: [{ scope: "user", installPath: validInstallPath }],
      "wrong-shape@plugins": { scope: "user", installPath: validInstallPath },
    });

    const skills = await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    expect(skills.map((skill) => skill.name)).toContain("valid:valid-skill");
    expect(skills.some((skill) => skill.name.includes("outside-skill"))).toBe(false);
    expect(skills.filter((skill) => skill.name === "valid:valid-skill")).toHaveLength(1);
  });

  it("follows symlinked skill directories from provider homes", async () => {
    const realSkillDir = path.join(root, "linked-skills", "check-code");
    await writeSkill(realSkillDir, "check-code", "Linked Claude skill");
    await mkdir(path.join(homeDir, ".claude", "skills"), { recursive: true });
    await symlink(realSkillDir, path.join(homeDir, ".claude", "skills", "check-code"), "dir");

    const skills = await discoverSkillsCatalog({
      homeDir,
      synaraBaseDir,
      includeDuplicateOrigins: true,
    });

    const linkedSkill = skills.find((skill) => skill.name === "check-code");
    expect(linkedSkill?.scope).toBe("claude");
    expect(linkedSkill?.path).toContain(path.join(".claude", "skills", "check-code", "SKILL.md"));
  });

  it("can include duplicate skill names from different origins for settings", async () => {
    await writeSkill(path.join(homeDir, ".codex", "skills", "reviewer"), "reviewer", "Codex");
    await writeSkill(path.join(homeDir, ".claude", "skills", "reviewer"), "reviewer", "Claude");

    const defaultCatalog = await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    expect(defaultCatalog.filter((skill) => skill.name === "reviewer")).toHaveLength(1);
    expect(defaultCatalog.find((skill) => skill.name === "reviewer")?.scope).toBe("codex");

    const settingsCatalog = await discoverSkillsCatalog({
      homeDir,
      synaraBaseDir,
      includeDuplicateOrigins: true,
    });
    expect(settingsCatalog.filter((skill) => skill.name === "reviewer")).toHaveLength(2);
    expect(settingsCatalog.map((skill) => skill.scope).sort()).toEqual(["claude", "codex"]);
  });

  it("prefers the provider-native copy and falls back to Synara for that provider", async () => {
    await writeSkill(path.join(synaraBaseDir, "skills", "shared"), "shared", "Synara copy");
    await writeSkill(path.join(homeDir, ".codex", "skills", "shared"), "shared", "Codex copy");
    await writeSkill(path.join(synaraBaseDir, "skills", "only-synara"), "only-synara", "Fallback");

    const codexView = await discoverSkillsCatalog({ homeDir, synaraBaseDir, provider: "codex" });
    const codexShared = codexView.find((skill) => skill.name === "shared");
    expect(codexShared?.scope).toBe("codex");
    expect(codexShared?.path).toContain(path.join(".codex", "skills"));
    expect(codexView.some((skill) => skill.name === "only-synara")).toBe(true);

    // A provider without its own copy resolves the Synara fallback.
    const claudeView = await discoverSkillsCatalog({
      homeDir,
      synaraBaseDir,
      provider: "claudeAgent",
    });
    const claudeShared = claudeView.find((skill) => skill.name === "shared");
    expect(claudeShared?.scope).toBe("synara");
  });

  it("uses documented provider alias roots before Synara fallbacks", async () => {
    await writeSkill(path.join(synaraBaseDir, "skills", "shared"), "shared", "Synara copy");
    await writeSkill(path.join(homeDir, ".agents", "skills", "shared"), "shared", "Agents alias");
    const antigravityView = await discoverSkillsCatalog({
      homeDir,
      synaraBaseDir,
      provider: "antigravity",
    });

    expect(antigravityView.find((skill) => skill.name === "shared")?.scope).toBe("agents");
  });

  it("uses provider-native roots before shared aliases for Grok and Pi", async () => {
    await writeSkill(path.join(synaraBaseDir, "skills", "shared"), "shared", "Synara copy");
    await writeSkill(path.join(homeDir, ".agents", "skills", "shared"), "shared", "Agents alias");
    await writeSkill(path.join(homeDir, ".grok", "skills", "shared"), "shared", "Grok copy");
    await writeSkill(path.join(homeDir, ".pi", "agent", "skills", "shared"), "shared", "Pi copy");

    const grokView = await discoverSkillsCatalog({
      homeDir,
      synaraBaseDir,
      provider: "grok",
    });
    const piView = await discoverSkillsCatalog({
      homeDir,
      synaraBaseDir,
      provider: "pi",
    });

    expect(grokView.find((skill) => skill.name === "shared")?.scope).toBe("grok");
    expect(piView.find((skill) => skill.name === "shared")?.scope).toBe("pi");
  });

  it("discovers Pi direct markdown skills from Pi roots", async () => {
    const piRoot = path.join(homeDir, ".pi", "agent", "skills");
    await mkdir(piRoot, { recursive: true });
    await writeFile(
      path.join(piRoot, "direct-review.md"),
      `---
name: direct-review
description: Direct Pi markdown skill
---

# Direct Review
`,
    );

    const skills = await discoverSkillsCatalog({ homeDir, synaraBaseDir });

    const directSkill = skills.find((skill) => skill.name === "direct-review");
    expect(directSkill?.scope).toBe("pi");
    expect(directSkill?.path).toContain(path.join(".pi", "agent", "skills", "direct-review.md"));
  });

  it("serves cached results within the TTL and rescans on forceReload", async () => {
    await writeSkill(path.join(synaraBaseDir, "skills", "first"), "first", "First skill");

    const initial = await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    expect(initial.map((skill) => skill.name)).toEqual(["first"]);

    // A skill added after the first scan is invisible to the cached entry...
    await writeSkill(path.join(synaraBaseDir, "skills", "second"), "second", "Second skill");
    const cached = await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    expect(cached.map((skill) => skill.name)).toEqual(["first"]);

    // ...but forceReload bypasses the cache and refreshes it.
    const reloaded = await discoverSkillsCatalog({ homeDir, synaraBaseDir, forceReload: true });
    expect(reloaded.map((skill) => skill.name).sort()).toEqual(["first", "second"]);
  });

  it("includes project-level .synara skills when a cwd is provided", async () => {
    const cwd = path.join(root, "repo", "packages", "web");
    await mkdir(cwd, { recursive: true });
    await writeSkill(
      path.join(root, "repo", ".synara", "skills", "repo-skill"),
      "repo-skill",
      "Project skill",
    );

    const skills = await discoverSkillsCatalog({ cwd, homeDir, synaraBaseDir });
    expect(skills.find((skill) => skill.name === "repo-skill")?.scope).toBe("project");
  });

  it("keeps home origins when the cwd lives under the home dir", async () => {
    // The home dir is an ancestor of the cwd here, so home skill folders are
    // reachable as "project" roots too; they must keep their true origin.
    const cwd = path.join(homeDir, "projects", "app");
    await mkdir(cwd, { recursive: true });
    await writeSkill(path.join(homeDir, ".codex", "skills", "from-codex"), "from-codex", "Codex");
    await writeSkill(path.join(synaraBaseDir, "skills", "portable"), "portable", "Synara");

    const skills = await discoverSkillsCatalog({ cwd, homeDir, synaraBaseDir });

    const names = skills.map((skill) => skill.name);
    expect(names.filter((name) => name === "from-codex")).toHaveLength(1);
    expect(skills.find((skill) => skill.name === "from-codex")?.scope).toBe("codex");
    expect(skills.find((skill) => skill.name === "portable")?.scope).toBe("synara");
  });

  it("dedupes same-named skills within a root deterministically", async () => {
    await writeSkill(path.join(synaraBaseDir, "skills", "zeta"), "twin", "Copy in zeta");
    await writeSkill(path.join(synaraBaseDir, "skills", "alpha"), "twin", "Copy in alpha");

    const skills = await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    const twins = skills.filter((skill) => skill.name === "twin");
    expect(twins).toHaveLength(1);
    expect(twins[0]?.path).toContain(path.join("skills", "alpha"));
  });
});

describe("mergeSkillsIntoCatalog", () => {
  const descriptor = (name: string, scope: string): ProviderSkillDescriptor => ({
    name,
    path: `/tmp/${scope}/${name}/SKILL.md`,
    enabled: true,
    scope,
  });

  it("keeps provider-native entries and appends catalog-only entries", () => {
    const merged = mergeSkillsIntoCatalog({
      native: [descriptor("shared", "codex-native")],
      catalog: [descriptor("Shared", "synara"), descriptor("extra", "synara")],
    });
    expect(merged).toHaveLength(2);
    expect(merged.find((skill) => skill.name.toLowerCase() === "shared")?.scope).toBe(
      "codex-native",
    );
    expect(merged.some((skill) => skill.name === "extra")).toBe(true);
  });
});

describe("filterDisabledSkills", () => {
  it("filters disabled skills case-insensitively", () => {
    const skills: ProviderSkillDescriptor[] = [
      { name: "Reviewer", path: "/tmp/a/SKILL.md", enabled: true },
      { name: "writer", path: "/tmp/b/SKILL.md", enabled: true },
    ];
    expect(filterDisabledSkills(skills, ["reviewer"]).map((skill) => skill.name)).toEqual([
      "writer",
    ]);
    expect(filterDisabledSkills(skills, [])).toHaveLength(2);
  });
});
