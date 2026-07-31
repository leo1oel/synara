// FILE: skillImport.ts
// Purpose: Normalizes a browser-selected Agent Skill directory and encodes its
//          files for the provider.importSkill RPC.
// Layer: Web skill import helper

import type { ProviderSkillImportFile } from "@synara/contracts";

const MAX_SKILL_FILES = 512;
const MAX_SKILL_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SKILL_TOTAL_BYTES = 16 * 1024 * 1024;

export interface BrowserSkillFile {
  readonly name: string;
  readonly size: number;
  readonly webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface PreparedSkillSelection {
  readonly folderName: string;
  readonly files: ReadonlyArray<{
    readonly relativePath: string;
    readonly file: BrowserSkillFile;
  }>;
}

function normalizedSelectionPath(file: BrowserSkillFile): string {
  return (file.webkitRelativePath?.trim() || file.name.trim()).replaceAll("\\", "/");
}

function startsWithSegments(value: ReadonlyArray<string>, prefix: ReadonlyArray<string>): boolean {
  return prefix.every((segment, index) => value[index] === segment);
}

export function prepareSkillSelection(selectedFiles: ReadonlyArray<BrowserSkillFile>): PreparedSkillSelection {
  if (selectedFiles.length === 0) {
    throw new Error("Choose a skill folder containing a SKILL.md file.");
  }
  if (selectedFiles.length > MAX_SKILL_FILES) {
    throw new Error(`A skill can contain at most ${MAX_SKILL_FILES} files.`);
  }

  const selected = selectedFiles.map((file) => {
    const path = normalizedSelectionPath(file);
    const segments = path.split("/").filter(Boolean);
    return { file, segments };
  });
  const skillFiles = selected.filter(({ segments }) => segments.at(-1) === "SKILL.md");
  if (skillFiles.length === 0) {
    throw new Error("Choose a skill folder containing a SKILL.md file.");
  }
  if (skillFiles.length > 1) {
    throw new Error("Choose one skill folder at a time.");
  }

  const skillRoot = skillFiles[0]!.segments.slice(0, -1);
  const folderName = skillRoot.at(-1)?.trim();
  if (!folderName) {
    throw new Error("The selected skill folder does not have a usable name.");
  }

  let totalBytes = 0;
  const files = selected
    .filter(({ segments }) => startsWithSegments(segments, skillRoot))
    .map(({ file, segments }) => {
      const relativePath = segments.slice(skillRoot.length).join("/");
      if (!relativePath) {
        throw new Error("The selected skill contains an invalid file path.");
      }
      if (file.size > MAX_SKILL_FILE_BYTES) {
        throw new Error(`The skill file is larger than 4 MB: ${relativePath}`);
      }
      totalBytes += file.size;
      return { relativePath, file };
    })
    .toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));

  if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
    throw new Error("The selected skill is larger than the 16 MB import limit.");
  }
  return { folderName, files };
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length);
    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index]!);
    }
  }
  return btoa(binary);
}

export async function encodeSkillSelection(selection: PreparedSkillSelection): Promise<ProviderSkillImportFile[]> {
  return Promise.all(
    selection.files.map(async ({ relativePath, file }) => ({
      relativePath,
      contentBase64: bytesToBase64(await file.arrayBuffer()),
    })),
  );
}
