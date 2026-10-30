import { useTRPC } from '@/lib/trpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

const useAuthed = () => useSession().status === 'authenticated';

export function useLectures(limit = 50) {
    const trpc = useTRPC();

    return useQuery({
        ...trpc.lecture.list.queryOptions({ limit }),
        enabled: useAuthed(),
    });
}

export function useLecture(lectureId: string) {
    const trpc = useTRPC();

    return useQuery({
        ...trpc.lecture.get.queryOptions({ lectureId }),
        enabled: useAuthed() && lectureId.length > 0,
    });
}

export function useLatestJob(lectureId: string) {
    const trpc = useTRPC();

    return useQuery({
        ...trpc.lecture.latestJob.queryOptions({ lectureId }),
        enabled: useAuthed() && lectureId.length > 0,
    });
}

export function useSources(lectureId: string) {
    const trpc = useTRPC();

    return useQuery({
        ...trpc.source.list.queryOptions({ lectureId }),
        enabled: useAuthed() && lectureId.length > 0,
    });
}

const useLectureInvalidation = () => {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    return () => {
        void queryClient.invalidateQueries({ queryKey: trpc.lecture.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.source.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.act.pathKey() });
    };
};

export function useCreateLecture() {
    const trpc = useTRPC();
    const invalidate = useLectureInvalidation();

    return useMutation(trpc.lecture.create.mutationOptions({ onSuccess: invalidate }));
}

export function useSaveBrief() {
    const trpc = useTRPC();
    const invalidate = useLectureInvalidation();

    return useMutation(trpc.lecture.updateBrief.mutationOptions({ onSuccess: invalidate }));
}

export function useSetScope() {
    const trpc = useTRPC();
    const invalidate = useLectureInvalidation();

    return useMutation(trpc.lecture.setScope.mutationOptions({ onSuccess: invalidate }));
}

export function usePublishLecture() {
    const trpc = useTRPC();
    const invalidate = useLectureInvalidation();

    return useMutation(trpc.lecture.publish.mutationOptions({ onSuccess: invalidate }));
}

export function useAddSource() {
    const trpc = useTRPC();
    const invalidate = useLectureInvalidation();

    return useMutation(trpc.source.addText.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveSource() {
    const trpc = useTRPC();
    const invalidate = useLectureInvalidation();

    return useMutation(trpc.source.remove.mutationOptions({ onSuccess: invalidate }));
}

export function useWikiSearch(term: string, language: string) {
    const trpc = useTRPC();

    return useQuery({
        ...trpc.source.searchWiki.queryOptions({ term, language }),
        enabled: useAuthed() && term.trim().length >= 2,
    });
}

export function useImportWiki() {
    const trpc = useTRPC();
    const invalidate = useLectureInvalidation();

    return useMutation(trpc.source.importWiki.mutationOptions({ onSuccess: invalidate }));
}

export function usePlanLecture() {
    const trpc = useTRPC();
    const invalidate = useLectureInvalidation();

    return useMutation(trpc.lecture.plan.mutationOptions({ onSuccess: invalidate }));
}

export function useGenerateActs() {
    const trpc = useTRPC();
    const invalidate = useLectureInvalidation();

    return useMutation(trpc.lecture.generate.mutationOptions({ onSuccess: invalidate }));
}

export function useResolveConcept() {
    const trpc = useTRPC();

    return useMutation(trpc.concept.resolve.mutationOptions());
}
