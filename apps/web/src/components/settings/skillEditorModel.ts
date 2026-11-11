// FILE: skillEditorModel.ts
// Purpose: Small deterministic helpers for Lattice's in-app Skill editor.
// Layer: Settings UI logic

const MAX_SKILL_ID_LENGTH = 64;

export function skillIdFromDisplayName(displayName: string): string {
  const normalized = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SKILL_ID_LENGTH)
    .replace(/-+$/g, "");
  return normalized || "my-skill";
}

export function skillInstructionsFromMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "")
    .trim();
}
