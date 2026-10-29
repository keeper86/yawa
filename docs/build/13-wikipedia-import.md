# 13 — Wikipedia import

Depends on: 02, 11. Blocks: 14, 18.

## Decision gate

- Is the MediaWiki API still reachable without an API key? Yes, but it requires a descriptive `User-Agent` and honours `maxlag`. Anonymous access is rate-limited, not forbidden.
- `action=parse&prop=sections` is **deprecated** — use `prop=tocdata` (verified against the live API in planning).
- `wbsearchentities` only matches exact labels: `"derivative mathematics"` returns nothing, `"derivative"` returns Q29175. Never resolve with context words appended.

## Deliverables

```
src/server/wiki/client.ts        searchArticles, articleMeta, sectionList, sectionWikitext, siteRights
src/server/wiki/wikitext.ts      minimal wikitext to plain text
src/server/wiki/import.ts        importArticle → source + sections
src/server/wiki/*.test.ts        tests against recorded fixtures
tests/fixtures/wiki/*.json
src/server/controller/source.ts  wiki.search, wiki.candidates, wiki.import
```

## Resolution flow

```
creator types a term
  └─ wiki.search(term, lang)        action=query&list=search&srlimit=5
      reject: pageprops.disambiguation, namespace != 0, no near-exact title
      return: title, pageid, shortDescription, wikibaseItem
  └─ creator clicks one
  └─ wiki.import(pageid, lang)      fetches, stores, returns sourceId
```

Candidate resolution is deterministic and cheap; no embeddings and no LLM. The creator's click is the curation, and it is the only effort the import asks for.

## Fetching an article

| Need                                                     | Call                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| licence for attribution                                  | `action=query&meta=siteinfo&siprop=rightsinfo`             |
| pageid, lastrevid, wikibase item, short description, URL | `action=query&prop=info\|pageprops&inprop=url&redirects=1` |
| section list                                             | `action=parse&page=<title>&prop=tocdata`                   |
| section text                                             | `action=parse&page=<title>&section=<index>&prop=wikitext`  |

Store `license` and `license_url` exactly as returned (currently `Creative Commons Attribution Share Alike 4.0`); never hardcode them. `source_revision` is `lastrevid`. `uri` is the `oldid` permalink, not the mutable article URL.

Section filtering: drop `References`, `External links`, `See also`, `Notes`, `Further reading`, and any section whose plain text is shorter than 200 characters. An import that keeps the reference list will generate acts about citation formatting.

## Dedupe and refresh

`external_id = '<lang>wiki:<pageid>'`.

- Re-importing the same `lastrevid` returns the existing source id and writes nothing.
- Re-importing a newer revision **replaces the sections**, which is refused while any `act_grounding` row points at the old sections (`ON DELETE RESTRICT` from chunk 05). In that case, import a new source row with `external_id = '<lang>wiki:<pageid>@<revid>'` and let the creator re-ground. Refusing silently is worse than duplicating the text.
- Wikipedia sources are shared (`owner_user_id IS NULL`), so two creators link the same article without downloading it twice.

## Rate limiting and politeness

One request at a time, `maxlag=5` on every call, a retrying fetch on `maxlag` and `429`, and a `User-Agent` naming the application and a contact address. An import of a 60 kB article is 20–40 requests; batch them sequentially with a 50 ms pause. Parallelising this is how an application gets blocked from the API.

## Tests

Record real responses once into `tests/fixtures/wiki/` (article with subsections, disambiguation page, redirect, article whose sections include a References block) and replay them by injecting a fetch stub. **No test hits Wikipedia.** The recorded fixtures are also the regression net for the wikitext stripper, which is the part most likely to break silently.

## Acceptance

- [x] Resolution rejects a disambiguation page and returns the canonical title for a redirect.
- [x] Importing the same revision twice creates one source and zero new sections.
- [x] A section list containing `References` produces no section for it.
- [x] `license`, `license_url`, `source_revision` and `uri` match the fixture exactly.
- [x] The stripper removes templates, refs, tables and headings from the fixture without losing prose.
- [x] No test performs a network request.

## State after execution

Files: `src/server/wiki/client.ts`, `src/server/wiki/wikitext.ts`, `src/server/wiki/import.ts`, `src/server/wiki/client.test.ts` (9 tests), `src/server/wiki/import.test.ts` (5 tests), `source.searchWiki` and `source.importWiki` procedures, fixtures in `tests/fixtures/wiki/`.

Fixtures were recorded once from the live API with a descriptive User-Agent, `maxlag=5`, one request at a time and a 50 ms pause: `rightsinfo.json`, `page-meta.json` (Trapezoidal rule, page 573452, revision 1378446929, `Q833293`), `tocdata.json` (17 sections), `section-2.json`, `redirect.json` (`Trapezoid rule` → `Trapezoidal rule`), `disambiguation.json` (`Derivative (disambiguation)`). Every test replays those files through an injected fetch, so the suite still touches no network.

Deviations from the plan:

- **Disambiguation is refused at import, not at search.** Wikipedia's search endpoint does not return page properties, so filtering at search would cost one extra request per candidate. The importer refuses with `sourceNotFound` and names the page, which is the point where it actually matters.
- **`prop=tocdata` returns `index` as a string.** It is passed through as a string rather than parsed to a number, because that is what `action=parse&section=` expects.
- **Only top-level sections are imported.** `section=2` already contains its subsections, so importing nested entries too would duplicate text.
- **A newer revision creates a second source** with `external_id` suffixed `@<revid>` instead of replacing sections that acts are grounded in.

The stripper keeps the LaTeX body of `<math>` blocks. For a numerics corpus a formula is content, and dropping it would leave sentences like "one can use the formula" with nothing following. Whether that survives the creation agent's judgement is chunk 14's problem, not the stripper's.

## Anti-goals

- No bulk import, no category crawling, no dumps.
- No images, tables, formulas beyond what the stripper keeps as text.
- No automatic grounding of acts. Importing a source never creates acts; that is chunk 14.
