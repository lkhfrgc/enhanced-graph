/**
 * The only surface the graph engine has onto the filesystem.
 *
 * Keeping it this narrow is what lets the whole engine run head-less in unit
 * tests and in the browser harness against an in-memory vault.
 */
export interface VaultAdapter {
  /**
   * Name of the vault's configuration folder.
   *
   * Obsidian lets the user rename it, so it cannot be assumed to be
   * `.obsidian`; the engine uses this to skip the folder rather than parsing
   * the app's own files as notes.
   */
  configDir(): string;
  /** Vault-relative paths of every markdown file, using `/` separators. */
  listMarkdownFiles(): Promise<string[]>;
  /** Raw file content. Rejects when the file does not exist. */
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  /** Creates parent folders as needed. */
  write(path: string, content: string): Promise<void>;
  /**
   * File timestamps, when the host has them.
   *
   * Optional because the engine must keep working without them: a memory vault in a
   * test, or a future host with no stat, simply has no age-based insight rather than
   * a wrong one. A missing timestamp must read as *unknown*, never as *old* — an age
   * finding derived from an absent value would accuse every note in the vault.
   */
  stat?(path: string): Promise<{ readonly created: number; readonly modified: number }>;
}

/** In-memory adapter used by tests and the browser harness. */
export class MemoryVault implements VaultAdapter {
  private readonly files = new Map<string, string>();
  private readonly stamps = new Map<string, { created: number; modified: number }>();

  configDir(): string {
    return ".obsidian";
  }

  constructor(initial: Record<string, string> = {}, stamps: Record<string, { created: number; modified: number }> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(normalizeVaultPath(path), content);
    }
    for (const [path, stamp] of Object.entries(stamps)) {
      this.stamps.set(normalizeVaultPath(path), stamp);
    }
  }

  async listMarkdownFiles(): Promise<string[]> {
    return [...this.files.keys()].filter((path) => path.endsWith(".md")).sort();
  }

  async read(path: string): Promise<string> {
    const key = normalizeVaultPath(path);
    const content = this.files.get(key);
    if (content === undefined) throw new Error(`ENOENT: ${key}`);
    return content;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(normalizeVaultPath(path));
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(normalizeVaultPath(path), content);
  }

  async stat(path: string): Promise<{ created: number; modified: number }> {
    const key = normalizeVaultPath(path);
    const stamp = this.stamps.get(key);
    if (stamp === undefined) throw new Error(`ENOENT: ${key}`);
    return stamp;
  }
}

export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}
