import { useTRPC } from '@/lib/trpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

export type ReviewAct = {
    id: string;
    conceptId: string;
    conceptTitle: string;
    templateKey: string;
    title: string;
    status: 'proposed' | 'accepted' | 'rejected';
    script: { steps: { role: string; text: string }[]; success: { criterion: string } };
};

export function useLectureActs(lectureId: string) {
    const trpc = useTRPC();

    return useQuery({
        ...trpc.act.list.queryOptions({ lectureId, conceptId: null, status: null, limit: 100 }),
        enabled: useSession().status === 'authenticated' && lectureId.length > 0,
    });
}

export function useActDetail(actId: string) {
    const trpc = useTRPC();

    return useQuery({
        ...trpc.act.get.queryOptions({ actId }),
        enabled: useSession().status === 'authenticated' && actId.length > 0,
    });
}

export function useReviewAct() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    return useMutation(
        trpc.act.review.mutationOptions({
            onSuccess: () => {
                void queryClient.invalidateQueries({ queryKey: trpc.act.pathKey() });
            },
        }),
    );
}
