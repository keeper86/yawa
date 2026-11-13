import { useTRPC } from '@/lib/trpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

export function useDocuments() {
    const loggedIn = useSession().status === 'authenticated';
    const trpc = useTRPC();

    const { data, isLoading } = useQuery({
        ...trpc.listDocuments.queryOptions(),
        enabled: loggedIn,
    });

    return { documents: data?.documents ?? [], isLoading };
}

export function useUploadDocument() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    return useMutation(
        trpc.uploadDocument.mutationOptions({
            onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.listDocuments.queryKey() }),
        }),
    );
}

export function useDeleteDocument() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    return useMutation(
        trpc.deleteDocument.mutationOptions({
            onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.listDocuments.queryKey() }),
        }),
    );
}

export function useDeleteAllDocuments() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    return useMutation(
        trpc.deleteAllDocuments.mutationOptions({
            onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.listDocuments.queryKey() }),
        }),
    );
}
