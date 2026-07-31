// FILE: skillsCatalog.test.ts
// Purpose: Verifies the unified cross-provider skills catalog discovery, dedup
//          precedence, merge with provider-native results, and toggle filtering.
// Layer: Server provider tests

import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
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
      readFile(path.join(synaraBaseDir, "skills", "paper-review", "references", "checklist.md"), "utf8"),
    ).resolves.toBe("# Checklist");

    const refreshed = await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    expect(refreshed.find((skill) => skill.name === "paper-review")?.scope).toBe("synara");
  });

  it("requires confirmation before replacing an existing shared skill", async () => {
    await writeSkill(path.join(synaraBaseDir, "skills", "paper-review"), "paper-review", "Original");
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
    await expect(readFile(path.join(synaraBaseDir, "skills", "paper-review", "SKILL.md"), "utf8")).resolves.toContain(
      "Original",
    );

    const replaced = await importSynaraSkill(synaraBaseDir, {
      folderName: "paper-review",
      files,
      overwrite: true,
    });
    expect(replaced.status).toBe("replaced");
    await expect(readFile(path.join(synaraBaseDir, "skills", "paper-review", "SKILL.md"), "utf8")).resolves.toContain(
      "Updated",
    );
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
    await writeSkill(path.join(bundledRoot, "humanize-writing"), "humanize-writing", "Included with Lattice");
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
    await expect(access(path.join(synaraBaseDir, "skills", "humanize-writing-copy"))).rejects.toThrow();
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
      created.detail.markdown.replace("---\n\n# Workflow", "disable-model-invocation: false\n---\n\n# Workflow"),
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
      readFile(path.join(synaraBaseDir, "skills", "research-taste-custom", "references", "taste.md"), "utf8"),
    ).resolves.toBe("# Taste");
    await expect(readFile(path.join(bundledSkillDir, "SKILL.md"), "utf8")).resolves.toContain("name: research-taste");
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
    await expect(access(path.join(synaraBaseDir, "skill-trash", removed.trashId, "SKILL.md"))).resolves.toBeUndefined();

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
    await writeSkill(path.join(synaraBaseDir, "skills", "research-taste"), "research-taste", "User copy");
    await writeSkill(path.join(homeDir, ".codex", "skills", "research-taste"), "research-taste", "Provider copy");
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

describe("discoverSkillsCatalog", () => {
  it("creates the Synara skills folder on first discovery", async () => {
    await discoverSkillsCatalog({ homeDir, synaraBaseDir });
    await expect(access(path.join(synaraBaseDir, "skills"))).resolves.toBeUndefined();
  });

  it("aggregates skills from synara and provider home folders with origin scopes", async () => {
    await writeSkill(path.join(synaraBaseDir, "skills", "portable"), "portable", "Synara skill");
    await writeSkill(path.join(homeDir, ".codex", "skills", "codex-only"), "codex-only", "Codex");
    await writeSkill(path.join(homeDir, ".claude", "skills", "claude-only"), "claude-only", "Claude");
    await writeSkill(path.join(homeDir, ".cursor", "skills", "cursor-only"), "cursor-only", "Cursor");
    await writeSkill(path.join(homeDir, ".grok", "skills", "grok-only"), "grok-only", "Grok");
    await writeSkill(path.join(homeDir, ".kilo", "skills", "kilo-only"), "kilo-only", "Kilo");
    await writeSkill(path.join(homeDir, ".config", "opencode", "skills", "opencode-only"), "opencode-only", "OpenCode");
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
    await writeSkill(path.join(root, "repo", ".synara", "skills", "repo-skill"), "repo-skill", "Project skill");

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
    expect(merged.find((skill) => skill.name.toLowerCase() === "shared")?.scope).toBe("codex-native");
    expect(merged.some((skill) => skill.name === "extra")).toBe(true);
  });
});

describe("filterDisabledSkills", () => {
  it("filters disabled skills case-insensitively", () => {
    const skills: ProviderSkillDescriptor[] = [
      { name: "Reviewer", path: "/tmp/a/SKILL.md", enabled: true },
      { name: "writer", path: "/tmp/b/SKILL.md", enabled: true },
    ];
    expect(filterDisabledSkills(skills, ["reviewer"]).map((skill) => skill.name)).toEqual(["writer"]);
    expect(filterDisabledSkills(skills, [])).toHaveLength(2);
  });
});
