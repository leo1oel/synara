import { describe, expect, it } from "vitest";
import {
  isValidGitHubRemoteUrl,
  isValidGitHubRepositoryCreateName,
  suggestGitHubRepositoryName,
} from "./GitRepositorySetup.logic";

describe("GitRepositorySetup logic", () => {
  it("suggests a GitHub-safe name from macOS and Windows paths", () => {
    expect(suggestGitHubRepositoryName("/Users/leonardo/Native VLM")).toBe("Native-VLM");
    expect(suggestGitHubRepositoryName("C:\\Research\\paper_writer")).toBe("paper_writer");
  });

  it("falls back when the folder has no usable repository characters", () => {
    expect(suggestGitHubRepositoryName("/Users/leonardo/研究")).toBe("new-repository");
  });

  it("accepts repository names and optional owner prefixes", () => {
    expect(isValidGitHubRepositoryCreateName("research-writer")).toBe(true);
    expect(isValidGitHubRepositoryCreateName("leonardo/research-writer")).toBe(true);
    expect(isValidGitHubRepositoryCreateName("bad name")).toBe(false);
    expect(isValidGitHubRepositoryCreateName("owner/repo/extra")).toBe(false);
  });

  it("accepts supported GitHub HTTPS and SSH remotes only", () => {
    expect(isValidGitHubRemoteUrl("https://github.com/example/research-writer.git")).toBe(true);
    expect(isValidGitHubRemoteUrl("git@github.com:example/research-writer.git")).toBe(true);
    expect(isValidGitHubRemoteUrl("https://gitlab.com/example/research-writer.git")).toBe(false);
  });
});
