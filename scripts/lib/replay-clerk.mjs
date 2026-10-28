// The replay's Clerk memory, built from the Worker's own helpers so the gate's "no name raised twice" is measured the way the Worker works:
// the Clerk is told the names already shown tonight, and a name that matches one is not shown (or remembered) again.
import { clerkUser, CLERK_KNOWN_MAX } from '../../functions/_lib/assist/prompts.js';
import { isKnownName } from '../../functions/_lib/assist/editor.js';

/** The Clerk's turn: the names shown so far (newest last, at most CLERK_KNOWN_MAX), then the talk. */
export function clerkTurn(shown, stamp, talk) {
  return clerkUser({ known: shown.slice(-CLERK_KNOWN_MAX), stamp, talk });
}

/** The reply's names that are new against `shown`; they are pushed onto `shown` (what the Worker would have shown). */
export function takeFreshNames(json, shown) {
  const fresh = [];
  for (const n of (json && Array.isArray(json.new_names) ? json.new_names : [])) {
    if (typeof n === 'string' && n.trim() && !isKnownName(n, shown)) { fresh.push(n.trim()); shown.push(n.trim()); }
  }
  return fresh;
}
