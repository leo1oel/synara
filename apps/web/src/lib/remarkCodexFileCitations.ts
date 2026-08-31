// FILE: remarkCodexFileCitations.ts
// Purpose: Turn internal Codex file-citation directives in assistant output
//          into the same readable, openable file links as authored markdown.
// Layer: Web chat presentation logic
// Exports: createCodexFileCitationsRemarkPlugin

import { workspaceRelativePathOf } from "@synara/shared/path";

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
}

interface CodexFileCitation {
  path?: string;
  sheet?: string;
  range?: string;
  line?: number;
}

const CODEX_FILE_CITATION_PATTERN = /:codex-file-citation\{([^}]+)\}/g;
const SKIPPED_PARENT_TYPES = new Set([
  "link",
  "linkReference",
  "image",
  "imageReference",
  "definition",
]);

function parseCodexFileCitation(body: string): CodexFileCitation {
  const attributes: Record<string, string> = {};
  const attributePattern = /([a-zA-Z_][a-zA-Z0-9_-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(body)) !== null) {
    const key = match[1];
    if (key) attributes[key] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  const line = attributes.line ? Number(attributes.line) : undefined;
  return {
    path: attributes.path,
    sheet: attributes.sheet,
    range: attributes.range,
    line: line && Number.isFinite(line) ? line : undefined,
  };
}

function citationLinkNode(citation: CodexFileCitation, cwd?: string): MdastNode | null {
  const path = citation.path?.trim();
  if (!path) return null;
  const href = (cwd ? workspaceRelativePathOf(path, cwd) : null) ?? path.replace(/\\/g, "/");
  const baseName = href.split("/").at(-1) || href;
  const location = citation.sheet && citation.range
    ? `${citation.sheet}!${citation.range}`
    : citation.sheet ?? citation.range;
  const label = location
    ? `${baseName} • ${location}`
    : citation.line
      ? `${baseName}:L${citation.line}`
      : baseName;
  return {
    type: "link",
    url: href,
    children: [{ type: "text", value: label }],
  };
}

function splitCitationText(value: string, cwd?: string): MdastNode[] | null {
  CODEX_FILE_CITATION_PATTERN.lastIndex = 0;
  const replacements: MdastNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = CODEX_FILE_CITATION_PATTERN.exec(value)) !== null) {
    const raw = match[0];
    if (!raw) continue;
    if (match.index > cursor) {
      replacements.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    const link = citationLinkNode(parseCodexFileCitation(match[1] ?? ""), cwd);
    if (link) replacements.push(link);
    cursor = match.index + raw.length;
  }
  if (cursor === 0) return null;
  if (cursor < value.length) {
    replacements.push({ type: "text", value: value.slice(cursor) });
  }
  return replacements;
}

/** Internal citation metadata is useful to the agent transport but should not
 * leak into the transcript. Rewrite it after markdown parsing so paths with
 * spaces remain one citation and code samples stay literal. */
export function createCodexFileCitationsRemarkPlugin(cwd?: string) {
  const visitNode = (node: MdastNode): void => {
    if (!Array.isArray(node.children) || node.children.length === 0) return;
    const nextChildren: MdastNode[] = [];
    let changed = false;
    for (const child of node.children) {
      if (child.type === "text") {
        const replacements = splitCitationText(child.value ?? "", cwd);
        if (replacements) {
          nextChildren.push(...replacements);
          changed = true;
          continue;
        }
      } else if (!SKIPPED_PARENT_TYPES.has(child.type)) {
        visitNode(child);
      }
      nextChildren.push(child);
    }
    if (changed) node.children = nextChildren;
  };

  return () => (tree: unknown) => {
    visitNode(tree as MdastNode);
  };
}
