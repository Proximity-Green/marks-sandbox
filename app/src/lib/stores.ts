import { writable } from 'svelte/store';

export interface OrgInfo {
	orgName: string;
	orgId: string;
	shortCode: string;
}

function createAuthStore() {
	const { subscribe, set, update } = writable<{
		authenticated: boolean;
		loading: boolean;
		org: OrgInfo | null;
	}>({
		authenticated: false,
		loading: true,
		org: null
	});

	return {
		subscribe,
		setAuthenticated(org: OrgInfo) {
			set({ authenticated: true, loading: false, org });
		},
		setUnauthenticated() {
			set({ authenticated: false, loading: false, org: null });
		},
		setLoading() {
			update((s) => ({ ...s, loading: true }));
		},
		logout() {
			if (typeof window !== 'undefined') {
				localStorage.removeItem('xero_session_token');
				localStorage.removeItem('xero_org_info');
			}
			set({ authenticated: false, loading: false, org: null });
		}
	};
}

export const auth = createAuthStore();

// Initialize auth from localStorage
export function initAuth() {
	if (typeof window === 'undefined') return;

	const token = localStorage.getItem('xero_session_token');
	const orgStr = localStorage.getItem('xero_org_info');

	if (token && orgStr) {
		try {
			const org = JSON.parse(orgStr) as OrgInfo;
			auth.setAuthenticated(org);
		} catch {
			auth.setUnauthenticated();
		}
	} else {
		auth.setUnauthenticated();
	}
}

// Admin fullscreen toggle
export const adminFullscreen = writable(false);

// Trigger to refresh recent activity sidebar
export const refreshActivity = writable(0);
export function triggerActivityRefresh() { refreshActivity.update(n => n + 1); }

// Open a record in form view
export const openRecordId = writable<string | null>(null);

// Save auth data to localStorage
export function saveAuth(token: string, org: OrgInfo) {
	localStorage.setItem('xero_session_token', token);
	localStorage.setItem('xero_org_info', JSON.stringify(org));
	auth.setAuthenticated(org);
}
