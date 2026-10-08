/**
 * The Obsidian implementation of the engine's `VaultAdapter`.
 *
 * Kept out of `main.ts` on purpose: the plugin class is the composition root and
 * should read as wiring, not as filesystem plumbing. Everything here is the
 * thin, host-specific half of the pair — `core/vault.ts` defines the interface
 * and a `MemoryVault` for tests, so the engine never sees Obsidian.
 */

import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import type { VaultAdapter } from "./core/vault";

export class ObsidianVaultAdapter implements VaultAdapter {
  constructor(private readonly app: App) {}

  async listMarkdownFiles(): Promise<string[]> {
    return this.app.vault.getMarkdownFiles().map((file) => file.path);
  }

  async read(path: string): Promise<string> {
    return this.app.vault.adapter.read(normalizePath(path));
  }

  async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(normalizePath(path));
  }

  async write(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    const folder = normalized.split("/").slice(0, -1).join("/");
    if (folder && !(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder).catch(() => undefined);
    }
    if (await this.app.vault.adapter.exists(normalized)) {
      await this.app.vault.adapter.write(normalized, content);
    } else {
      await this.app.vault.create(normalized, content);
    }
  }
}
