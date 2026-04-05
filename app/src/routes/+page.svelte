<script lang="ts">
	import { auth, initAuth, saveAuth } from '$lib/stores';
	import { getAuthStatus } from '$lib/api';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(async () => {
		// Check for Xero callback token in URL
		const params = new URLSearchParams(window.location.search);
		const token = params.get('session') || params.get('token');

		if (token) {
			localStorage.setItem('xero_session_token', token);
			window.history.replaceState({}, '', '/');
			try {
				const status = await getAuthStatus();
				if (status.authenticated) {
					saveAuth(token, {
						orgName: status.orgName || 'Unknown Org',
						orgId: status.orgId ?? '',
						shortCode: status.shortCode ?? ''
					});
				}
			} catch (e) {
				console.error('[Auth] Error verifying session:', e);
			}
		} else {
			initAuth();
		}

		goto('/admin');
	});
</script>

<div class="flex-1 flex items-center justify-center">
	<div class="w-8 h-8 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
</div>
