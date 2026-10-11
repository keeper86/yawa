import { health } from './controller/health';
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

const protectedAppRouter = trpcRoot.router({
    getUsers: getUsers(),
    getUser: getUser(),
    updateUser: updateUser(),
    getUserIdFromSession: getUserIdFromSession(),
    message: messageRouter,
});

export const publicAccessibleRouter = trpcRoot.router({
    logs: logs(),
    health: health(),
});

export const appRouter = trpcRoot.mergeRouters(publicAccessibleRouter, protectedAppRouter);
export type AppRouter = typeof appRouter;
