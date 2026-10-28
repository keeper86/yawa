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

- [ ] Resolution rejects a disambiguation page and returns the canonical title for a redirect.
- [ ] Importing the same revision twice creates one source and zero new sections.
- [ ] A section list containing `References` produces no section for it.
- [ ] `license`, `license_url`, `source_revision` and `uri` match the fixture exactly.
- [ ] The stripper removes templates, refs, tables and headings from the fixture without losing prose.
- [ ] No test performs a network request.

## Anti-goals

- No bulk import, no category crawling, no dumps.
- No images, tables, formulas beyond what the stripper keeps as text.
- No automatic grounding of acts. Importing a source never creates acts; that is chunk 14.
