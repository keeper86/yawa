export type RecipientCandidate = {
    userId: string;
    displayName: string | null;
    username: string | null;
};

export const recipientLabel = (recipient: RecipientCandidate): string =>
    recipient.displayName ?? recipient.username ?? recipient.userId;
