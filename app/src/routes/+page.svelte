<script lang="ts">
	import { auth, initAuth, saveAuth } from '$lib/stores';
	import { getAuthConnectUrl, getAuthStatus } from '$lib/api';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let checking = $state(false);
	let error = $state('');

	onMount(async () => {
		// Check for callback token in URL hash
		const params = new URLSearchParams(window.location.search);
		const token = params.get('session') || params.get('token');

		if (token) {
			localStorage.setItem('xero_session_token', token);
			// Clean URL
			window.history.replaceState({}, '', '/');
			checking = true;
			try {
				const status = await getAuthStatus();
				if (status.authenticated && status.orgName) {
					saveAuth(token, {
						orgName: status.orgName,
						orgId: status.orgId ?? '',
						shortCode: status.shortCode ?? ''
					});
					goto('/create');
					return;
				}
			} catch (e) {
				error = 'Failed to verify connection. Please try again.';
			}
			checking = false;
		}

		// If already authenticated, redirect
		initAuth();
		const unsub = auth.subscribe((state) => {
			if (!state.loading && state.authenticated) {
				goto('/create');
			}
		});

		return unsub;
	});

	function connect() {
		window.location.href = getAuthConnectUrl();
	}
</script>

<div class="min-h-screen flex items-center justify-center px-4">
	<div class="max-w-md w-full">
		<div class="text-center mb-8">
			<div class="w-16 h-16 bg-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-brand-200">
				<svg class="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
			</div>
			<h1 class="text-3xl font-bold text-gray-900 mb-2">Xero Docs</h1>
			<p class="text-gray-500 text-lg">Create and manage invoices, quotes, and purchase orders</p>
		</div>

		<div class="bg-white rounded-2xl shadow-lg shadow-gray-200/50 border border-gray-100 p-8">
			{#if checking}
				<div class="flex flex-col items-center gap-3 py-4">
					<div class="w-8 h-8 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
					<p class="text-sm text-gray-500">Verifying connection...</p>
				</div>
			{:else}
				<div class="space-y-6">
					<div class="text-center">
						<h2 class="text-lg font-semibold text-gray-900 mb-1">Connect your Xero account</h2>
						<p class="text-sm text-gray-500">Sign in with Xero to start creating documents</p>
					</div>

					{#if error}
						<div class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
							{error}
						</div>
					{/if}

					<button
						onclick={connect}
						class="w-full flex items-center justify-center gap-3 bg-brand-600 hover:bg-brand-700 text-white font-medium py-3 px-4 rounded-xl transition-colors shadow-sm cursor-pointer"
					>
						<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
							<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
						</svg>
						Connect to Xero
					</button>

					<div class="flex items-center gap-3 pt-2">
						<div class="flex-1 border-t border-gray-100"></div>
						<span class="text-xs text-gray-400 uppercase tracking-wide">Features</span>
						<div class="flex-1 border-t border-gray-100"></div>
					</div>

					<ul class="space-y-3 text-sm text-gray-600">
						<li class="flex items-start gap-2.5">
							<svg class="w-5 h-5 text-brand-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
							Create invoices, quotes, and purchase orders
						</li>
						<li class="flex items-start gap-2.5">
							<svg class="w-5 h-5 text-brand-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
							Download PDFs and send emails directly
						</li>
						<li class="flex items-start gap-2.5">
							<svg class="w-5 h-5 text-brand-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
							View and manage all your documents in one place
						</li>
					</ul>
				</div>
			{/if}
		</div>

		<p class="text-center text-xs text-gray-400 mt-6">
			Securely connects to your Xero organisation via OAuth 2.0
		</p>
	</div>
</div>
