import { describe, expect, it } from "vitest";
import {
  markdownFilePathHref,
  resolveMarkdownFileLinkTarget,
  rewriteMarkdownFileUriHref,
} from "../markdown-links";

import {
  canOpenWorkspaceFileReference,
  resolveDockFileOpenTarget,
  resolveEmbeddedFileOpenTarget,
  resolveScratchPreviewFileOpenTarget,
  resolveWorkspaceDirectoryOpenTarget,
  resolveWorkspaceFileOpenTarget,
} from "./workspaceFileOpener";

describe("resolveWorkspaceDirectoryOpenTarget", () => {
  it.each([
    ["./docs/./guide/", "/Users/dev/project", "docs/guide"],
    ["docs/#L12C3", "/Users/dev/project", "docs"],
    ["C:\\Users\\Dev\\Projects", "c:/users/dev/projects/", ""],
    ["C:/", "c:\\", ""],
    ["//server/share/project/", "\\\\SERVER\\SHARE\\Project", ""],
    ["file://server/share/project/docs/", "\\\\SERVER\\SHARE\\Project", "docs"],
  ])("routes Markdown directory %s to its Explorer target", (href, cwd, expected) => {
    const target = resolveMarkdownFileLinkTarget(rewriteMarkdownFileUriHref(href) ?? href, cwd);
    expect(target).not.toBeNull();
    expect(resolveWorkspaceDirectoryOpenTarget(target!, cwd)).toBe(expected);
  });

  it("preserves encoded filename characters through file-URI directory links", () => {
    const cwd = "\\\\SERVER\\share\\project";
    const href = markdownFilePathHref("//server/share/project/space %20 #hash?/guide/");
    const target = resolveMarkdownFileLinkTarget(rewriteMarkdownFileUriHref(href)!, cwd);
    expect(resolveWorkspaceDirectoryOpenTarget(target!, cwd)).toBe("space %20 #hash?/guide");
  });

  it.each(["../outside/", "docs/../../outside/", "./docs/../outside/"])(
    "does not turn traversal in %s into a directory reveal",
    (href) => {
      const cwd = "/Users/dev/project";
      const target = resolveMarkdownFileLinkTarget(href, cwd);
      expect(target === null || resolveWorkspaceDirectoryOpenTarget(target, cwd) === null).toBe(
        true,
      );
    },
  );

  it("preserves POSIX case-sensitive containment and protocol-relative web links", () => {
    expect(
      resolveWorkspaceDirectoryOpenTarget("/Users/dev/Project/", "/Users/dev/project"),
    ).toBeNull();
    expect(
      resolveMarkdownFileLinkTarget("//example.com/docs/", "\\\\server\\share\\project"),
    ).toBeNull();
  });

  it("recognizes the POSIX workspace root", () => {
    expect(resolveWorkspaceDirectoryOpenTarget("/Users/dev/project/", "/Users/dev/project")).toBe(
      "",
    );
  });

  it("maps explicit in-workspace directory references to Explorer paths", () => {
    expect(resolveWorkspaceDirectoryOpenTarget("docs/", "/repo/app")).toBe("docs");
    expect(resolveWorkspaceDirectoryOpenTarget("C:\\Repo\\App\\Src\\", "c:/repo/app")).toBe("Src");
  });

  it("leaves file-shaped and out-of-workspace references to file opening", () => {
    expect(resolveWorkspaceDirectoryOpenTarget("README.md", "/repo/app")).toBeNull();
    expect(resolveWorkspaceDirectoryOpenTarget("/repo/app/src/page.tsx", "/repo/app")).toBeNull();
    expect(resolveWorkspaceDirectoryOpenTarget("/repo/other/", "/repo/app")).toBeNull();
  });
});

describe("resolveWorkspaceFileOpenTarget", () => {
  it("passes workspace-relative paths through unchanged", () => {
    expect(resolveWorkspaceFileOpenTarget("src/page.tsx", "/repo/app")).toBe("src/page.tsx");
    expect(resolveWorkspaceFileOpenTarget("README.md", null)).toBe("README.md");
  });

  it("strips :line and :line:col position suffixes", () => {
    expect(resolveWorkspaceFileOpenTarget("src/page.tsx:42", "/repo/app")).toBe("src/page.tsx");
    expect(resolveWorkspaceFileOpenTarget("src/page.tsx:42:7", "/repo/app")).toBe("src/page.tsx");
    expect(resolveWorkspaceFileOpenTarget("/repo/app/src/page.tsx:10:2", "/repo/app")).toBe(
      "src/page.tsx",
    );
  });

  it("maps Synara public asset URLs to their workspace files", () => {
    expect(
      resolveWorkspaceFileOpenTarget("/central-icons-reversed/magnifying-glass.svg", "/repo/app"),
    ).toBe("apps/web/public/central-icons-reversed/magnifying-glass.svg");
    expect(resolveWorkspaceFileOpenTarget("/central-icons-fill/search.svg:12", "/repo/app")).toBe(
      "apps/web/public/central-icons-fill/search.svg",
    );
  });

  it("returns null for paths outside the workspace", () => {
    expect(resolveWorkspaceFileOpenTarget("/elsewhere/file.ts", "/repo/app")).toBeNull();
    expect(resolveWorkspaceFileOpenTarget("/repo/app/file.ts", null)).toBeNull();
    expect(resolveWorkspaceFileOpenTarget("../outside.ts", "/repo/app")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(resolveWorkspaceFileOpenTarget("", "/repo/app")).toBeNull();
    expect(resolveWorkspaceFileOpenTarget("   ", "/repo/app")).toBeNull();
  });
});

describe("resolveScratchPreviewFileOpenTarget", () => {
  const scratchPdf = "/private/tmp/synara-codex-workspaces/thread-1/report.pdf";

  it("returns absolute scratch-workspace preview paths unchanged", () => {
    expect(resolveScratchPreviewFileOpenTarget(scratchPdf)).toBe(scratchPdf);
    expect(
      resolveScratchPreviewFileOpenTarget("/tmp/synara-codex-workspaces/thread-1/shot.png"),
    ).toBe("/tmp/synara-codex-workspaces/thread-1/shot.png");
  });

  it("returns null for scratch-workspace files without an in-app binary preview", () => {
    expect(
      resolveScratchPreviewFileOpenTarget("/tmp/synara-codex-workspaces/thread-1/notes.ts"),
    ).toBeNull();
  });

  it("returns null for absolute preview paths outside a scratch workspace", () => {
    expect(resolveScratchPreviewFileOpenTarget("/Users/dev/Documents/report.pdf")).toBeNull();
  });

  it("returns null for relative paths", () => {
    expect(resolveScratchPreviewFileOpenTarget("docs/report.pdf")).toBeNull();
    expect(
      resolveScratchPreviewFileOpenTarget("synara-codex-workspaces/thread-1/a.pdf"),
    ).toBeNull();
  });
});

describe("resolveDockFileOpenTarget", () => {
  const scratchPdf = "/private/tmp/synara-codex-workspaces/thread-1/report.pdf";

  it("opens scratch preview files even when no workspace is attached", () => {
    expect(resolveDockFileOpenTarget(scratchPdf, null)).toBe(scratchPdf);
  });

  it("does not treat workspace-relative paths as previewable without a workspace", () => {
    expect(resolveDockFileOpenTarget("docs/report.pdf", null)).toBeNull();
    expect(resolveDockFileOpenTarget("src/page.tsx", null)).toBeNull();
  });

  it("keeps workspace files relative when a workspace is attached", () => {
    expect(resolveDockFileOpenTarget("/repo/app/src/page.tsx:10", "/repo/app")).toBe(
      "src/page.tsx",
    );
    expect(resolveDockFileOpenTarget("src/page.tsx", "/repo/app")).toBe("src/page.tsx");
  });

  it("opens absolute local paths directly instead of falling back to the editor", () => {
    expect(resolveDockFileOpenTarget("/Users/dev/Downloads/report.txt:4", "/repo/app")).toBe(
      "/Users/dev/Downloads/report.txt",
    );
  });
});

describe("resolveEmbeddedFileOpenTarget", () => {
  it("hands workspace files to the host by their relative path", () => {
    expect(resolveEmbeddedFileOpenTarget("/repo/paper/main.tex:12", "/repo/paper")).toEqual({
      kind: "host",
      relativePath: "main.tex",
    });
    expect(resolveEmbeddedFileOpenTarget("figures/loss.png", "/repo/paper")).toEqual({
      kind: "host",
      relativePath: "figures/loss.png",
    });
  });

  it("previews an image outside the workspace in the image viewer", () => {
    expect(
      resolveEmbeddedFileOpenTarget("/var/folders/x/T/tmp.abc/p-1.png", "/repo/paper"),
    ).toEqual({ kind: "image", path: "/var/folders/x/T/tmp.abc/p-1.png" });
    expect(resolveEmbeddedFileOpenTarget("/tmp/render/q-2.png", null)).toEqual({
      kind: "image",
      path: "/tmp/render/q-2.png",
    });
  });

  it("offers no destination for other files outside the workspace", () => {
    expect(resolveEmbeddedFileOpenTarget("/var/folders/x/T/tmp.abc/main.log", "/repo/paper")).toBe(
      null,
    );
    expect(resolveEmbeddedFileOpenTarget("/var/folders/x/T/tmp.abc/main.pdf", "/repo/paper")).toBe(
      null,
    );
    expect(resolveEmbeddedFileOpenTarget("main.tex", null)).toBeNull();
  });
});

describe("canOpenWorkspaceFileReference", () => {
  it("treats an opener without a gate as able to open every reference", () => {
    expect(canOpenWorkspaceFileReference({ openFile: () => true }, "/tmp/a.log")).toBe(true);
    expect(canOpenWorkspaceFileReference(null, "/tmp/a.log")).toBe(true);
  });

  it("follows the opener's gate when it has one", () => {
    const opener = { openFile: () => true, canOpenFile: (path: string) => path.endsWith(".png") };
    expect(canOpenWorkspaceFileReference(opener, "/tmp/a.png")).toBe(true);
    expect(canOpenWorkspaceFileReference(opener, "/tmp/a.log")).toBe(false);
  });
});
