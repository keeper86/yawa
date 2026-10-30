export type WikiCandidate = {
    title: string;
    pageId: number;
    description: string | null;
    wikidataId: string | null;
};

export type WikiPageMeta = {
    title: string;
    pageId: number;
    lastRevId: number;
    url: string;
    description: string | null;
    wikidataId: string | null;
    isDisambiguation: boolean;
};

export type WikiSectionRef = {
    index: string;
    heading: string;
    anchor: string;
};

export type WikiClient = {
    siteRights: (language: string) => Promise<{ license: string; licenseUrl: string }>;
    search: (term: string, language: string) => Promise<WikiCandidate[]>;
    pageMeta: (title: string, language: string) => Promise<WikiPageMeta>;
    sections: (title: string, language: string) => Promise<WikiSectionRef[]>;
    sectionWikitext: (title: string, index: string, language: string) => Promise<string>;
};

export type WikiJsonFetch = (url: string) => Promise<unknown>;

type SearchResponse = {
    query?: { search?: { title: string; pageid: number; snippet?: string }[] };
};

type MetaPage = {
    title: string;
    pageid: number;
    lastrevid: number;
    fullurl: string;
    pageprops?: { 'wikibase_item'?: string; 'wikibase-shortdesc'?: string; 'disambiguation'?: string };
};

type MetaResponse = { query?: { redirects?: { from: string; to: string }[]; pages?: MetaPage[] } };

type TocResponse = {
    parse?: { tocdata?: { sections?: { index: string; line: string; anchor: string; tocLevel: number }[] } };
};

const host = (language: string) => `https://${language}.wikipedia.org/w/api.php`;

const describe = (page: MetaPage) => ({
    description: page.pageprops?.['wikibase-shortdesc'] ?? null,
    wikidataId: page.pageprops?.wikibase_item ?? null,
    isDisambiguation: 'disambiguation' in (page.pageprops ?? {}),
});

export const createWikiClient = (fetchJson: WikiJsonFetch): WikiClient => ({
    siteRights: async (language) => {
        const payload = (await fetchJson(
            `${host(language)}?action=query&meta=siteinfo&siprop=rightsinfo&format=json&formatversion=2`,
        )) as { query?: { rightsinfo?: { text: string; url: string } } };
        const rights = payload.query?.rightsinfo;
        if (!rights) {
            throw new Error('Wikipedia did not return licence information');
        }
        return { license: rights.text, licenseUrl: rights.url };
    },

    search: async (term, language) => {
        const payload = (await fetchJson(
            `${host(language)}?action=query&list=search&srsearch=${encodeURIComponent(term)}&srlimit=5&srnamespace=0&format=json&formatversion=2&maxlag=5`,
        )) as SearchResponse;

        return (payload.query?.search ?? []).map((entry) => ({
            title: entry.title,
            pageId: entry.pageid,
            description: null,
            wikidataId: null,
        }));
    },

    pageMeta: async (title, language) => {
        const payload = (await fetchJson(
            `${host(language)}?action=query&prop=info%7Cpageprops&inprop=url&redirects=1&titles=${encodeURIComponent(title)}&format=json&formatversion=2&maxlag=5`,
        )) as MetaResponse;

        const page = payload.query?.pages?.[0];
        if (!page) {
            throw new Error(`Wikipedia does not know the page ${title}`);
        }
        return {
            title: page.title,
            pageId: page.pageid,
            lastRevId: page.lastrevid,
            url: page.fullurl,
            ...describe(page),
        };
    },

    sections: async (title, language) => {
        const payload = (await fetchJson(
            `${host(language)}?action=parse&page=${encodeURIComponent(title)}&prop=tocdata&format=json&formatversion=2&maxlag=5`,
        )) as TocResponse;

        return (payload.parse?.tocdata?.sections ?? [])
            .filter((section) => section.tocLevel === 1)
            .map((section) => ({ index: section.index, heading: section.line, anchor: section.anchor }));
    },

    sectionWikitext: async (title, index, language) => {
        const payload = (await fetchJson(
            `${host(language)}?action=parse&page=${encodeURIComponent(title)}&section=${index}&prop=wikitext&format=json&formatversion=2&maxlag=5`,
        )) as { parse?: { wikitext?: string } };

        return payload.parse?.wikitext ?? '';
    },
});

export const WIKI_USER_AGENT = 'Yawa/0.1 (teaching corpus import; +https://github.com/keeper86/yawa)';

let cachedClient: WikiClient | null = null;

export const getWiki = (): WikiClient => {
    if (!cachedClient) {
        cachedClient = createWikiClient(createHttpWikiJsonFetch({ userAgent: WIKI_USER_AGENT }));
    }
    return cachedClient;
};

export const createHttpWikiJsonFetch = (options: { userAgent: string; pauseMs?: number }): WikiJsonFetch => {
    let queue: Promise<unknown> = Promise.resolve();
    const pauseMs = options.pauseMs ?? 50;

    return (url: string) => {
        const next = queue.then(async () => {
            const response = await fetch(url, {
                headers: { 'User-Agent': options.userAgent, 'Accept': 'application/json' },
            });
            if (!response.ok) {
                throw new Error(`Wikipedia responded with ${response.status}`);
            }
            const payload = await response.json();
            if (payload && typeof payload === 'object' && 'error' in payload) {
                throw new Error(`Wikipedia error: ${JSON.stringify((payload as { error: unknown }).error)}`);
            }
            await new Promise((resolve) => setTimeout(resolve, pauseMs));
            return payload;
        });
        queue = next.catch(() => undefined);
        return next;
    };
};
