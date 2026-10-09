/**
 * The workspace rule, in one place.
 *
 * A workspace is a folder to read plus folders to leave out of it, and both are
 * stored as the user typed them — `notes`, `notes/`, `/notes/` are the same folder
 * to a reader. The rule is used twice: the builder applies it while reading the
 * vault, and the built-in graph's filter applies it to the nodes Obsidian's own
 * graph engine hands over. Two copies of "is this path in the workspace?" would
 * drift, and the symptom would be a built-in graph showing notes the standalone
 * one had already dropped.
 */

/** `archive/old/` and `/archive/old` are the same folder to a reader. */
export function folderKey(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

/**
 * True when `path` is `folder` itself or something inside it.
 *
 * On the folder BOUNDARY, so `notes` does not cover `notes-archive/a.md`. The empty
 * folder is the vault root, which everything is under.
 */
export function isUnder(path: string, folder: string): boolean {
  if (folder === "") return true;
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * Whether a note is read at all: inside the workspace root, and not inside any
 * excluded subtree. An empty root with no exclusions is the whole vault.
 */
export function isInWorkspace(
  path: string,
  folder: string,
  excluded: readonly string[] = [],
): boolean {
  if (!isUnder(path, folderKey(folder))) return false;
  return !excluded.some((prefix) => {
    const key = folderKey(prefix);
    return key !== "" && isUnder(path, key);
  });
}
