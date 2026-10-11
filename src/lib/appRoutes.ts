import { type LucideIcon, FileText, Home, Mail, User } from 'lucide-react';
import type { Route } from 'nextjs-routes';
import type en from '../i18n/messages/en.json';

export type NavLabel = keyof typeof en.Nav;

export type RouteMetadata = {
    path: Exclude<Route['pathname'], `/api/${string}`>;
    label: NavLabel;
    icon?: LucideIcon;
    isPublic?: boolean;
    isMainNav?: boolean;
    isSecondaryNav?: boolean;
};

export const isRoute = (entry: unknown): entry is RouteMetadata => {
    return typeof entry === 'object' && entry !== null && 'path' in entry && 'label' in entry && !('root' in entry);
};

export const isRouteManifest = (entry: unknown): entry is RouteManifest => {
    return typeof entry === 'object' && entry !== null && 'root' in entry && isRoute(entry.root);
};

export interface RouteManifest {
    root: RouteMetadata;
    [key: string]: RouteMetadata | RouteManifest;
}

export type RouteManifestEntry = RouteMetadata | RouteManifest;

export const APP_ROUTES = {
    root: {
        path: '/',
        label: 'Home',
        icon: Home,
        isPublic: true,
    },
    account: {
        root: {
            path: '/account',
            label: 'Account',
            icon: User,
        },
    },
    messages: {
        path: '/messages',
        label: 'Messages',
        icon: Mail,
        isSecondaryNav: true,
    },
    imprint: {
        path: '/imprint',
        label: 'Imprint',
        icon: FileText,
        isPublic: true,
        isSecondaryNav: true,
    },
} as const satisfies RouteManifest;

const filterRoutes = (route: RouteManifestEntry, condition: (route: RouteMetadata) => boolean) => {
    const filteredRoutes: RouteMetadata[] = [];
    if (isRoute(route)) {
        if (condition(route)) {
            filteredRoutes.push(route);
        }
    } else {
        Object.values(route).forEach((child) => filteredRoutes.push(...filterRoutes(child, condition)));
    }
    return filteredRoutes;
};

let mainNavRoutes: RouteMetadata[] = [];
export function getMainNavRoutes(): RouteMetadata[] {
    if (mainNavRoutes.length > 0) {
        return mainNavRoutes;
    }
    mainNavRoutes = filterRoutes(APP_ROUTES, (route) => route.isMainNav === true);
    return mainNavRoutes;
}

let publicRoutes: string[] = [];
export const getPublicRoutes = () => {
    if (publicRoutes.length > 0) {
        return publicRoutes;
    }
    publicRoutes = filterRoutes(APP_ROUTES, (route) => route.isPublic === true).map((route) => route.path);
    return publicRoutes;
};

let protectedRoutes: RouteMetadata[] = [];
export function getProtectedRoutes(): RouteMetadata[] {
    if (protectedRoutes.length > 0) {
        return protectedRoutes;
    }
    protectedRoutes = filterRoutes(APP_ROUTES, (route) => route.isPublic !== true);
    return protectedRoutes;
}

let secondaryNavRoutes: RouteMetadata[] = [];
export function getSecondaryNavRoutes(): RouteMetadata[] {
    if (secondaryNavRoutes.length > 0) {
        return secondaryNavRoutes;
    }
    secondaryNavRoutes = filterRoutes(APP_ROUTES, (route) => route.isSecondaryNav === true);
    return secondaryNavRoutes;
}
