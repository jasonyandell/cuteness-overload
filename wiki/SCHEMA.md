---
tags: [meta, schema, workflow]
updated: 2026-07-07
source-files: []
---

# Wiki Schema & Conventions

This file is the **operating manual** for the Cuteness Overload wiki. Any LLM
session that maintains these docs must read this first. The goal (Karpathy's
"LLM Wiki" pattern): a structured, interlinked markdown knowledge base that sits
on top of the immutable raw source (the repo code) so questions can be answered
**from the wiki** without re-reading code every time.

## The three layers

1. **Raw sources** — the actual repo (`src/`, `scripts/`, `DESIGN.md`,
   `BALANCE.md`, config). Immutable *from the wiki's perspective*: the wiki never
   edits code; it describes it. Code is the ground truth. When code and wiki
   disagree, code wins and the wiki is stale (fix the wiki).
2. **The wiki** — everything in `wiki/`. LLM-written markdown. This is the layer
   you build and maintain.
3. **The schema** — this file. The conventions + workflows that keep future
   sessions disciplined.

## Page conventions

Every content page starts with YAML frontmatter:

```yaml
---
tags: [sim, economy]          # freeform topic tags for grep/grouping
updated: 2026-07-07           # ISO date of last substantive edit
source-files:                 # repo files this page derives from
  - src/sim/constants.ts
  - src/sim/waves.ts
---
```

- **`source-files` is load-bearing.** It is the contract that makes LINT
  possible: to check a page for staleness, re-read exactly these files and diff
  the claims. If a page makes a claim about a file not listed, either add the
  file or move the claim.
- **`updated`** is bumped only on substantive content edits, not typo fixes.
- Prefer **extracted specifics** over prose: real numbers, formulas, file paths
  (`src/sim/engine.ts`), function names (`callWave`, `spawnEnemy`), constant
  names (`HP_GROWTH`). A good page lets you answer a balance/mechanics question
  without opening the source.

## Linking

- **Wikilinks** `[[page-name]]` (Obsidian style, no `.md`, no path) are the
  primary cross-reference. Use them liberally — every mechanic mentioned on one
  page that has its own page should link to it.
- A `[[link]]` to a page that does not exist yet is allowed; it marks a page
  worth creating. It is a TODO, not an error.
- Standard relative markdown links (`[DESIGN.md](../DESIGN.md)`) are used to
  point at **raw source** files, since those live outside `wiki/`.

## The two special files

- **[[index]]** (`wiki/index.md`) — the content catalog. Every page listed once,
  with a one-line summary, grouped by category. **Update it on every page
  add/rename/delete.** It is the table of contents a human or LLM scans first.
- **[[log]]** (`wiki/log.md`) — append-only chronological record. Never rewrite
  history; only append. Entries are grep-able:
  `## [YYYY-MM-DD] <op> | <short description>` where `<op>` is
  `genesis | ingest | query | lint | refactor`. Body: what changed, which pages
  touched, why.

## Workflows

Three operations every future session must support.

### INGEST — a source changed (new code, edited constants, new feature)

1. Identify which wiki pages list the changed file in `source-files`.
2. Update those pages to match the new code. Re-extract affected numbers/formulas.
3. Update cross-links if the change adds/removes a mechanic.
4. Update [[index]] if pages were added/removed/renamed.
5. Append a `## [date] ingest | ...` entry to [[log]] describing the change and
   the pages touched.

### QUERY — answer a human question

1. Answer from the wiki pages first. Follow wikilinks.
2. Only fall back to reading code if the wiki is insufficient (and if so, that's
   a signal the wiki has a gap).
3. **File valuable answers back.** If a question required real digging and the
   answer is reusable, write it into the most relevant page (or a new page), so
   the next session gets it for free. Append a `## [date] query | ...` log entry
   noting what was added.

### LINT — find drift & inconsistency

Run periodically or when asked. Check for:

- **Stale claims vs code**: for each page, re-read its `source-files` and verify
  the numbers/formulas/behaviors still match. Flag mismatches.
- **Contradictions between docs**: e.g. `DESIGN.md`/`BALANCE.md` vs current code,
  or two wiki pages disagreeing.
- **Orphan pages**: pages not linked from [[index]] or any other page.
- **Missing cross-links**: a mechanic named in prose that has its own page but
  isn't wikilinked.
- **Dead source-files**: a listed file that no longer exists or was renamed.

Record findings as a `## [date] lint | ...` log entry. Fix what you can; list
what needs human judgment. The current open lint findings live in [[lint]].

## House style

- Describe **behavior that will stay true**, not incidental detail. For fast-
  moving areas (the renderer/UI were mid-restyle at genesis), state the
  *direction* ("bold primary kid-friendly palette") rather than pinning exact hex
  values that churn. See [[rendering]] and [[ui-flow]] notes.
- When you cite a number, cite where it lives (`START_MONEY = 80` in
  `src/sim/constants.ts`) so LINT can find it.
- Keep [[index]] and [[log]] honest. They are the memory across sessions.
</content>
</invoke>
