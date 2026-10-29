import {
    embed as embedActs,
    get as getAct,
    list as listActs,
    publish as publishAct,
    review as reviewAct,
} from './controller/act';
import {
    get as getConcept,
    link,
    resolve as resolveConceptProcedure,
    search as searchConcepts,
    unlink,
} from './controller/concept';
import { health } from './controller/health';
import {
    create as createLecture,
    generate as generateActs,
    get as getLecture,
    latestJob,
    list as listLectures,
    plan as planLecture,
    publish as publishLectureProcedure,
    setActs,
    setScope,
    updateBrief,
} from './controller/lecture';
import { logs } from './controller/logs';
import {
    deleteMessage,
    deleteMessages,
    getMessage,
    getUnreadCount,
    listInbox,
    listRecipients,
    listSent,
    markAllRead,
    markRead,
    sendMessage,
} from './controller/message';
import { createPAT, deletePAT, listPATs, revokePAT } from './controller/pAccessToken';
import { addText, importWiki, list as listSources, remove as removeSource, searchWiki } from './controller/source';
import { getUser, getUserIdFromSession, getUsers, updateUser } from './controller/user';
import { trpcRoot } from './trpcRoot';

const messageRouter = trpcRoot.router({
    listRecipients: listRecipients(),
    listInbox: listInbox(),
    listSent: listSent(),
    getMessage: getMessage(),
    getUnreadCount: getUnreadCount(),
    sendMessage: sendMessage(),
    markRead: markRead(),
    markAllRead: markAllRead(),
    deleteMessage: deleteMessage(),
    deleteMessages: deleteMessages(),
});

const conceptRouter = trpcRoot.router({
    resolve: resolveConceptProcedure(),
    search: searchConcepts(),
    get: getConcept(),
    link: link(),
    unlink: unlink(),
});

const sourceRouter = trpcRoot.router({
    addText: addText(),
    importWiki: importWiki(),
    searchWiki: searchWiki(),
    list: listSources(),
    remove: removeSource(),
});

const actRouter = trpcRoot.router({
    list: listActs(),
    get: getAct(),
    review: reviewAct(),
    publish: publishAct(),
    embed: embedActs(),
});

const lectureRouter = trpcRoot.router({
    create: createLecture(),
    list: listLectures(),
    get: getLecture(),
    updateBrief: updateBrief(),
    setScope: setScope(),
    setActs: setActs(),
    publish: publishLectureProcedure(),
    plan: planLecture(),
    generate: generateActs(),
    latestJob: latestJob(),
});

const protectedAppRouter = trpcRoot.router({
    getUsers: getUsers(),
    getUser: getUser(),
    updateUser: updateUser(),
    message: messageRouter,
    concept: conceptRouter,
    source: sourceRouter,
    act: actRouter,
    lecture: lectureRouter,
    createPAT: createPAT(),
    listPATs: listPATs(),
    revokePAT: revokePAT(),
    deletePAT: deletePAT(),
});

export const publicAccessibleRouter = trpcRoot.router({
    logs: logs(),
    health: health(),
    getUserIdFromSession: getUserIdFromSession(),
});

export const appRouter = trpcRoot.mergeRouters(publicAccessibleRouter, protectedAppRouter);
export type AppRouter = typeof appRouter;
