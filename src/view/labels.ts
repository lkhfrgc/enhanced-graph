/**
 * How a page type is written in the panels.
 *
 * The rows are the types a vault declares, not the eleven the plugin knows, so a
 * label has three cases to cover: a canonical type gets the reader's own language,
 * anything else gets the user's words, and a declaration whose *analysis* type is
 * worth knowing says so.
 *
 * That last case is not hypothetical: a vault can declare both `type: concept` and
 * `type: 概念`, which are two rows that would otherwise read identically — same
 * label, different counts, different colours. Appending the normalised type says
 * both why they are separate rows and what they mean to the analysis.
 */

import { normalizePageType } from "../core/parse";
import { t } from "../i18n";
import { PAGE_TYPES, type PageType } from "../types";

/** Whether a declared type is one the plugin knows, and so has a translated name. */
export function isPageType(key: string): key is PageType {
  return (PAGE_TYPES as readonly string[]).includes(key);
}

/**
 * The label for a type row. `declared` is what the user wrote, which is what the row
 * shows when the plugin has no name for it.
 */
export function typeLabel(key: string, declared: string): string {
  if (isPageType(key)) return t(`type.${key}`);
  const normalised = normalizePageType(declared);
  return declared === normalised ? declared : `${declared} · ${normalised}`;
}
