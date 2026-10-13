# The rules wiki

A searchable copy of the rulebooks inside the app: Blades '68, Blades in the Dark and the table's own house rules. Open it
from **Rules** in the header, from Home, from the table page, or from the small **?** beside a rule on the sheets (downtime
activities, stress and trauma, clocks, heat, wanted level, stacks). It is part of the hosted build only; in the claude.ai
artifact the page says "Rules are available on the hosted app".

## Privacy: the text is not in git

This repository is public and the rulebooks are not ours to publish. So:

- The rules are **never committed**. They live only in the hosted D1 database (`rules` table, `migrations/0002_rules.sql`),
  put there by the GM from their own PC.
- `rules-src/` and `rules-private/` are in `.gitignore` as a safety net: if you keep a local copy of the markdown inside
  the repository folder, keep it there.
- `GET /api/export` (the backup) deliberately leaves the rules out, so a backup file that gets shared carries none of the
  text. After restoring a deployment, import the rules again.
- Only people signed in through Cloudflare Access can read `/api/rules`; only the GM can write.
- The page keeps the last corpus it loaded in the browser (IndexedDB, one copy per signed-in user) so search works offline.
  It is removed with the site data of that browser.
- The tests use made-up placeholder prose (`checks/runtime/fixtures/rules/`), never real rules text.

## Importing the rules (the GM)

1. On the PC that holds the rulebook notes, open the site in **Chrome or Edge** (folder upload needs it) and sign in as the GM.
2. Open **Rules**, then **Import rules**.
3. Choose the book (Blades '68 or Blades in the Dark) and pick its **folder**: the rulebook folder of the vault (the one
   whose files are `.md` notes). Do the other book the same way.
4. The page reads the `.md` files and shows a preview: files, entries, size, and whether it replaces something. Folders
   starting with a dot (`.obsidian`) and files that are not `.md` are ignored.
5. **Import**. It uploads in parts of about 300 KB with a progress line, then reloads the rules. Importing a book again
   **replaces** it (the page asks first); the other book is untouched.

How a note becomes entries: frontmatter is dropped (its `title` and `aliases` become extra search words); the note is split
at every `#` and `##` heading, and at `###` when the section is long; a note with no headings is one entry. Each entry keeps
its heading path ("Folder > Note > H1 > H2") for the breadcrumb and for search, and entries are ordered by file path and
then by position. A heading with nothing under it makes no entry. A section over about 36,000 characters is cut at blank
lines into "(part 2)" entries to fit the server's per-entry limit.

Obsidian syntax: `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]` link to the entry of that file name or title in the same
book (then the other books); one that finds nothing is plain text. `![[image.png]]` is dropped; `![[Note]]` becomes a link.
`> [!note] Title` callouts, tables, nested lists, task lists, `==highlights==` and `%%comments%%` work. Raw HTML in a note is
shown as text, never run; links are only made for `http`, `https` and relative addresses.

## House rules

The GM can write the table's own rulings in the app: **Rules > House rules > New house rule** (a title and Markdown, with a
preview). They are read by everyone and shown with the other books; if a house rule has the same title as a Blades '68 entry
it folds under it ("House rule").

## Reading

- **Search** is in the browser, over the whole corpus, so it also works offline. A title match ranks above a trail match above
  a body match; every word must match, or, when nothing matches them all, any word does. Results show highlighted snippets.
  Keys: `/` jumps to the box, Down moves into the results and up again, Esc clears.
- **Order**: a Blades '68 entry shows first. When another book has an entry with the same title it is folded beneath it
  ("In Blades in the Dark"), in search results and on the entry page.
- Routes: `#rules` (index and search), `#rules?q=<words>` (search filled in), `#rules/<book>/<slug>` (an entry; book is
  `b68`, `bitd` or `house`).

## Credit

The page footer carries the Blades in the Dark attribution required by its Creative Commons Attribution 3.0 licence and the
note that Blades '68 text is (c) Evil Hat Productions and here for this table's private use.

## API and code

See `HOSTING.md` (API) and `app/CONTRACT.md` (`window.claude.rules`). Server: `functions/api/rules/`, `functions/_lib/rules.js`
(limits). Page: `app/markdown.js` (the renderer and the importer's split), `app/rules.js`, `app/rules.css`. Checks:
`checks/api/rules.mjs` (`npm run check:api`), `checks/runtime/markdown.test.mjs` (`npm run check:runtime`),
`checks/runtime/rules.e2e.mjs` (`npm run check:rules`, port 8795).
