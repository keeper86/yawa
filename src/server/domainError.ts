import { TRPCError } from '@trpc/server';

export const DOMAIN_ERROR_CODES = [
    'unexpected',
    'notLoggedIn',
    'userNotFound',
    'messageNotFound',
    'recipientNotFound',
    'cannotMessageSelf',
    'messageRateLimited',
    'patRateLimited',
    'invalidAvatarData',
    'avatarPngOnly',
    'conceptNotFound',
    'sourceNotFound',
    'actNotFound',
    'lectureNotFound',
    'notOwner',
    'relationCycle',
    'invalidBrief',
    'lectureNotPublishable',
    'sourceInUse',
    'publicationRefused',
    'aiUnavailable',
    'aiInvalidResponse',
    'embeddingDimensionMismatch',
    'planIncomplete',
    'creationJobActive',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export type DomainErrorParams = Record<string, string | number>;

export type DomainErrorPacket = {
    code: DomainErrorCode;
    params: DomainErrorParams;
};

const CODE_BY_MESSAGE: Record<string, DomainErrorCode> = {
    'You must be logged in to access this resource or provide a valid PAT.': 'notLoggedIn',
    'User not found': 'userNotFound',
    'Message not found': 'messageNotFound',
    'Recipient not found': 'recipientNotFound',
    'Cannot send a message to yourself': 'cannotMessageSelf',
    'Too many messages sent. Please wait a moment before trying again.': 'messageRateLimited',
    'Too many requests from this PAT, please try again later': 'patRateLimited',
    'Invalid base64 image data': 'invalidAvatarData',
    'Only PNG images are supported for avatar': 'avatarPngOnly',
};

export const domainCodeForMessage = (message: string): DomainErrorCode | null => CODE_BY_MESSAGE[message] ?? null;

export const domainError = (
    code: TRPCError['code'],
    domain: DomainErrorCode,
    message: string,
    params: DomainErrorParams = {},
): TRPCError => new TRPCError({ code, message, cause: { domainError: { code: domain, params } } });

export const domainErrorFromPacket = (packet: DomainErrorPacket): TRPCError =>
    new TRPCError({ code: 'BAD_REQUEST', message: packet.code, cause: { domainError: packet } });

export class DomainFailure extends Error {
    readonly domainCode: DomainErrorCode;
    readonly params: DomainErrorParams;

    constructor(domainCode: DomainErrorCode, message: string, params: DomainErrorParams = {}) {
        super(message);
        this.name = 'DomainFailure';
        this.domainCode = domainCode;
        this.params = params;
    }
}
