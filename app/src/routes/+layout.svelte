<script lang="ts">
	import '../app.css';
	import { auth, initAuth, saveAuth } from '$lib/stores';
	import { getAuthStatus } from '$lib/api';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let { children } = $props();

	let dark = $state(false);

	onMount(async () => {
		initAuth();
		dark = localStorage.getItem('theme') === 'dark';
		applyTheme();

		// Re-fetch org info if it's missing or "Unknown Org"
		const token = localStorage.getItem('xero_session_token');
		const orgStr = localStorage.getItem('xero_org_info');
		if (token && orgStr) {
			try {
				const org = JSON.parse(orgStr);
				if (!org.orgName || org.orgName === 'Unknown Org') {
					const status = await getAuthStatus();
					if (status.authenticated && status.orgName) {
						saveAuth(token, { orgName: status.orgName, orgId: org.orgId || '', shortCode: status.shortCode || org.shortCode || '' });
					}
				}
			} catch { /* ignore */ }
		}
	});

	function applyTheme() {
		if (dark) {
			document.documentElement.classList.add('dark');
		} else {
			document.documentElement.classList.remove('dark');
		}
	}

	function toggleDark() {
		dark = !dark;
		localStorage.setItem('theme', dark ? 'dark' : 'light');
		applyTheme();
	}

	function handleLogout() {
		auth.logout();
		window.location.href = '/';
	}

	let currentPath = $derived($page.url.pathname);
	let isAuthenticated = $derived($auth.authenticated);
	let orgName = $derived($auth.org?.orgName ?? '');
	let isLoading = $derived($auth.loading);
</script>

<div class="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950 transition-colors">
	{#if !isLoading && isAuthenticated}
		<header class="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
			<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div class="flex items-center justify-between h-16">
					<div class="flex items-center gap-8">
						<a href="/" class="flex items-center gap-2.5">
							<div class="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
								<svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
							</div>
							<span class="text-lg font-semibold text-gray-900 dark:text-white">Xero Docs</span>
						</a>

						<nav class="flex items-center gap-1">
							<a
								href="/create"
								class="px-3.5 py-2 text-sm font-medium rounded-lg transition-colors {currentPath === '/create'
									? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
									: 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800'}"
							>
								Create
							</a>
							<a
								href="/list"
								class="px-3.5 py-2 text-sm font-medium rounded-lg transition-colors {currentPath === '/list'
									? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
									: 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800'}"
							>
								Documents
							</a>
						</nav>
					</div>

					<div class="flex items-center gap-3">
						<div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
							<div class="w-2 h-2 bg-green-500 rounded-full"></div>
							<span>{orgName}</span>
						</div>

						<!-- Dark mode toggle -->
						<button
							onclick={toggleDark}
							class="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors cursor-pointer"
							title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
						>
							{#if dark}
								<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
								</svg>
							{:else}
								<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
								</svg>
							{/if}
						</button>

						<button
							onclick={handleLogout}
							class="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
						>
							Disconnect
						</button>
					</div>
				</div>
			</div>
		</header>
	{/if}

	<main class="flex-1">
		{@render children()}
	</main>
</div>
