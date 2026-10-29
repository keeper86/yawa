import type { Acts, Lectures, Sources } from '@/types/db_schemas';
import { DomainFailure } from './domainError';

export const isActVisible = (act: { published_at: Date | null; owner_user_id: string }, viewerUserId: string) =>
    act.published_at !== null || act.owner_user_id === viewerUserId;

export const assertActVisible = (act: Acts, viewerUserId: string): Acts => {
    if (!isActVisible(act, viewerUserId)) {
        throw new DomainFailure('actNotFound', 'Act not found');
    }
    return act;
};

export const assertLectureOwner = (lecture: Lectures, viewerUserId: string): Lectures => {
    if (lecture.owner_user_id !== viewerUserId) {
        throw new DomainFailure('notOwner', 'Only the owner can change this');
    }
    return lecture;
};

export const assertLectureVisible = (lecture: Lectures, viewerUserId: string): Lectures => {
    if (lecture.published_at === null && lecture.owner_user_id !== viewerUserId) {
        throw new DomainFailure('lectureNotFound', 'Lecture not found');
    }
    return lecture;
};

export const assertSourceOwner = (source: Sources, viewerUserId: string): Sources => {
    if (source.owner_user_id !== null && source.owner_user_id !== viewerUserId) {
        throw new DomainFailure('sourceNotFound', 'Source not found');
    }
    return source;
};
