<script lang="ts">
	import '../app.css';
	import { auth, initAuth } from '$lib/stores';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let { children } = $props();

	onMount(() => {
		initAuth();
	});

	function handleLogout() {
		auth.logout();
		window.location.href = '/';
	}

	let currentPath = $derived($page.url.pathname);
	let isAuthenticated = $derived($auth.authenticated);
	let orgName = $derived($auth.org?.orgName ?? '');
	let isLoading = $derived($auth.loading);
</script>

<div class="min-h-screen flex flex-col">
	{#if !isLoading && isAuthenticated}
		<header class="bg-white border-b border-gray-200 shadow-sm">
			<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div class="flex items-center justify-between h-16">
					<div class="flex items-center gap-8">
						<a href="/" class="flex items-center gap-2.5">
							<div class="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
								<svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
							</div>
							<span class="text-lg font-semibold text-gray-900">Xero Docs</span>
						</a>

						<nav class="flex items-center gap-1">
							<a
								href="/create"
								class="px-3.5 py-2 text-sm font-medium rounded-lg transition-colors {currentPath === '/create'
									? 'bg-brand-50 text-brand-700'
									: 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}"
							>
								Create
							</a>
							<a
								href="/list"
								class="px-3.5 py-2 text-sm font-medium rounded-lg transition-colors {currentPath === '/list'
									? 'bg-brand-50 text-brand-700'
									: 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}"
							>
								Documents
							</a>
						</nav>
					</div>

					<div class="flex items-center gap-4">
						<div class="flex items-center gap-2 text-sm text-gray-600">
							<div class="w-2 h-2 bg-green-500 rounded-full"></div>
							<span>{orgName}</span>
						</div>
						<button
							onclick={handleLogout}
							class="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
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
