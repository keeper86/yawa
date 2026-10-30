import { useTRPC } from '@/lib/trpc';
import { useMutation } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

export const useStartSession = () => {
    const trpc = useTRPC();

    return useMutation(trpc.tutor.start.mutationOptions());
};

export const useNextAct = () => {
    const trpc = useTRPC();

    return useMutation(trpc.tutor.next.mutationOptions());
};

export const useAnswerChoice = () => {
    const trpc = useTRPC();

    return useMutation(trpc.tutor.answerChoice.mutationOptions());
};

export const useAnswerOpen = () => {
    const trpc = useTRPC();

    return useMutation(trpc.tutor.answerOpen.mutationOptions());
};

export const useCloseSession = () => {
    const trpc = useTRPC();

    return useMutation(trpc.tutor.close.mutationOptions());
};

export const useTutorReady = () => useSession().status === 'authenticated';
