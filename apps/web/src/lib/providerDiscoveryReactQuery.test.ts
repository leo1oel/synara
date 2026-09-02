// FILE: providerDiscoveryReactQuery.test.ts
// Purpose: Locks provider model discovery query semantics — retry policy,
//          stale-catalog preservation, and initial-vs-background pending (#103).
// Layer: Web data fetching tests

import type { NativeApi } from "@synara/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isInitialModelDiscoveryPending,
  providerModelsQueryOptions,
  providerSkillsQueryOptions,
  skillsCatalogQueryOptions,
} from "./providerDiscoveryReactQuery";
import * as nativeApi from "../nativeApi";

function mockListModels(listModels: ReturnType<typeof vi.fn>) {
  vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
    provider: { listModels },
  } as unknown as NativeApi);
  return listModels;
}

function installLatticeEmbedStorage() {
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn().mockReturnValue(
      JSON.stringify({
        workspaceRoot: "/Users/test/project",
        theme: "light",
        surface: "drawer",
        hostOrigin: "http://localhost:1420",
      }),
    ),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Lattice skill discovery", () => {
  it("keeps provider-native user skills in the embedded composer", async () => {
    installLatticeEmbedStorage();
    const result = {
      skills: [
        {
          name: "user-review",
          enabled: true,
          path: "/Users/test/.claude/skills/user-review/SKILL.md",
          scope: "claude",
        },
      ],
      source: "claude.native",
      cached: false,
    };
    const listSkills = vi.fn().mockResolvedValue(result);
    const listSkillsCatalog = vi.fn();
    vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
      provider: { listSkills, listSkillsCatalog },
    } as unknown as NativeApi);

    const options = providerSkillsQueryOptions({
      provider: "claudeAgent",
      cwd: "/Users/test/project",
    });
    const queryClient = new QueryClient();

    await expect(queryClient.fetchQuery(options)).resolves.toEqual(result);
    expect(listSkillsCatalog).not.toHaveBeenCalled();
  });

  it("keeps user and project skills in the embedded Settings catalog", async () => {
    installLatticeEmbedStorage();
    const result = {
      skills: [
        {
          name: "humanize-writing",
          enabled: true,
          path: "/Applications/Lattice/humanize-writing/SKILL.md",
          scope: "bundled",
        },
        {
          name: "user-review",
          enabled: true,
          path: "/Users/test/.claude/skills/user-review/SKILL.md",
          scope: "claude",
        },
        {
          name: "project-research",
          enabled: true,
          path: "/Users/test/project/.agents/skills/project-research/SKILL.md",
          scope: "project",
        },
      ],
      synaraSkillsDir: "/Users/test/Library/Application Support/Lattice/synara/skills",
    };
    const listSkillsCatalog = vi.fn().mockResolvedValue(result);
    vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
      provider: { listSkillsCatalog },
    } as unknown as NativeApi);

    const options = skillsCatalogQueryOptions({ cwd: "/Users/test/project" });
    const queryClient = new QueryClient();

    await expect(queryClient.fetchQuery(options)).resolves.toEqual(result);
    expect(listSkillsCatalog).toHaveBeenCalledWith({ cwd: "/Users/test/project" });
  });
});

describe("isInitialModelDiscoveryPending", () => {
  it("is pending only for the first fetch (loading or placeholder fetch)", () => {
    expect(
      isInitialModelDiscoveryPending({
        isLoading: true,
        isFetching: true,
        isPlaceholderData: true,
      }),
    ).toBe(true);
    expect(
      isInitialModelDiscoveryPending({
        isLoading: false,
        isFetching: true,
        isPlaceholderData: true,
      }),
    ).toBe(true);
    // Settled catalog + background refetch must not blank the picker (#103).
    expect(
      isInitialModelDiscoveryPending({
        isLoading: false,
        isFetching: true,
        isPlaceholderData: false,
      }),
    ).toBe(false);
    expect(
      isInitialModelDiscoveryPending({
        isLoading: false,
        isFetching: false,
        isPlaceholderData: false,
      }),
    ).toBe(false);
  });
});

describe("providerModelsQueryOptions", () => {
  it("fails fast for Cursor so a missing CLI settles instead of spinning (#103)", async () => {
    const listModels = mockListModels(
      vi.fn().mockRejectedValue(new Error("Cursor CLI is not installed or not on PATH")),
    );
    const options = providerModelsQueryOptions({ provider: "cursor", enabled: true });
    expect(options.retry).toBe(0);

    const queryClient = new QueryClient();
    await expect(queryClient.fetchQuery(options)).rejects.toThrow(
      "Cursor CLI is not installed or not on PATH",
    );
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(options.queryKey)?.status).toBe("error");
  });

  it("fails fast only for cursor and droid, and devin uses the standard on-demand policy", () => {
    expect(providerModelsQueryOptions({ provider: "codex" }).retry).toBe(3);
    expect(providerModelsQueryOptions({ provider: "devin" }).retry).toBe(3);
    expect(providerModelsQueryOptions({ provider: "devin" }).staleTime).toBe(30_000);
    expect(providerModelsQueryOptions({ provider: "droid" }).retry).toBe(0);
    expect(providerModelsQueryOptions({ provider: "droid" }).staleTime).toBe(5 * 60_000);
    expect(providerModelsQueryOptions({ provider: "cursor" }).retry).toBe(0);
    expect(providerModelsQueryOptions({ provider: "cursor" }).staleTime).toBe(30_000);
  });

  it("keeps Droid discovery cached for five minutes and ignores focus", () => {
    const options = providerModelsQueryOptions({ provider: "droid" });

    expect(options.staleTime).toBe(5 * 60_000);
    expect(options.refetchOnWindowFocus).toBe(false);
  });

  it("deduplicates concurrent catalog requests for the same provider key", async () => {
    const catalog = {
      models: [{ slug: "gpt-5.4", name: "GPT-5.4" }],
      source: "codex",
      cached: false,
    };
    const listModels = mockListModels(vi.fn().mockResolvedValue(catalog));
    const options = providerModelsQueryOptions({ provider: "codex", enabled: true });
    const queryClient = new QueryClient();

    await Promise.all([queryClient.fetchQuery(options), queryClient.fetchQuery(options)]);

    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it("surfaces real errors instead of masking them as empty catalogs", async () => {
    mockListModels(vi.fn().mockRejectedValue(new Error("discovery exploded")));
    const options = providerModelsQueryOptions({ provider: "cursor", enabled: true });

    const queryClient = new QueryClient();
    await expect(queryClient.fetchQuery(options)).rejects.toThrow("discovery exploded");
    expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
  });

  it("preserves the cached catalog when a background refetch fails", async () => {
    const catalog = {
      models: [{ slug: "auto", name: "Auto" }],
      source: "cursor.cli",
      cached: false,
    };
    const listModels = mockListModels(
      vi.fn().mockResolvedValueOnce(catalog).mockRejectedValue(new Error("cursor went away")),
    );
    const options = providerModelsQueryOptions({ provider: "cursor", enabled: true });

    const queryClient = new QueryClient();
    await expect(queryClient.fetchQuery(options)).resolves.toEqual(catalog);
    await queryClient.refetchQueries({ queryKey: options.queryKey });

    expect(listModels).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(options.queryKey)).toEqual(catalog);
  });

  it("returns successful catalogs unchanged", async () => {
    const catalog = {
      models: [{ slug: "gpt-5.4", name: "GPT-5.4" }],
      source: "codex",
      cached: false,
    };
    mockListModels(vi.fn().mockResolvedValue(catalog));
    const options = providerModelsQueryOptions({ provider: "codex", enabled: true });

    const queryClient = new QueryClient();
    await expect(queryClient.fetchQuery(options)).resolves.toEqual(catalog);
  });
});
