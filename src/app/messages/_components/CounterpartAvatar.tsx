'use client';

import UserAvatar from '@/components/client/UserAvatar';
import type { MessageSummary } from '@/server/controller/message';

export function CounterpartAvatar({ message }: { message: MessageSummary }) {
    return <UserAvatar userId={message.counterpartUserId} />;
}
