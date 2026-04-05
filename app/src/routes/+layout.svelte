<script lang="ts">
	import '../app.css';
	import { auth, initAuth, saveAuth, sbUser } from '$lib/stores';
	import { supabase, isEmailAllowed, signOut } from '$lib/supabase';
	import { getAuthConnectUrl, getAuthStatus, syncRefData } from '$lib/api';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	let { children } = $props();

	let dark = $state(false);

	// Public routes that don't require Supabase auth
	const publicPaths = ['/login', '/auth/callback'];

	onMount(async () => {
		dark = localStorage.getItem('theme') === 'dark';
		applyTheme();

		// Initialize Supabase auth listener
		const { data: { session } } = await supabase.auth.getSession();
		if (session?.user) {
			const allowed = await isEmailAllowed(session.user.email!);
			if (allowed) {
				sbUser.setUser(session.user);
			} else {
				await signOut();
				sbUser.setUser(null);
			}
		} else {
			sbUser.setUser(null);
			// Redirect to login if not on a public route
			const path = window.location.pathname;
			if (!publicPaths.some(p => path.startsWith(p))) {
				goto('/login');
			}
		}

		// Listen for auth state changes
		const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
			if (session?.user) {
				const allowed = await isEmailAllowed(session.user.email!);
				if (allowed) {
					sbUser.setUser(session.user);
				} else {
					await signOut();
					sbUser.setUser(null);
				}
			} else {
				sbUser.setUser(null);
			}
		});

		// Initialize Xero auth
		initAuth();

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

		return () => subscription.unsubscribe();
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

	async function handleLogout() {
		auth.logout();
		await signOut();
		sbUser.setUser(null);
		goto('/login');
	}

	let currentPath = $derived($page.url.pathname);
	let isPublicRoute = $derived(publicPaths.some(p => currentPath.startsWith(p)));
	let sbState = $derived($sbUser);
	let isAuthenticated = $derived($auth.authenticated);
	let orgName = $derived($auth.org?.orgName ?? '');
	let userEmail = $derived(sbState.user?.email ?? '');
	let isLoading = $derived($auth.loading);
	let syncing = $state(false);
	let syncMessage = $state('');

	// Redirect to /login if not authenticated with Supabase (and not on a public route)
	$effect(() => {
		if (!sbState.loading && !sbState.user && !isPublicRoute) {
			goto('/login');
		}
	});

	async function handleSync() {
		syncing = true;
		syncMessage = '';
		try {
			const result = await syncRefData();
			syncMessage = `Synced ${result.accounts} accounts, ${result.categories} categories, ${result.options} options`;
			// Clear local cache so next load picks up fresh Supabase data
			localStorage.removeItem('xero_accounts');
			localStorage.removeItem('xero_tracking');
		} catch (e: unknown) {
			syncMessage = e instanceof Error ? e.message : 'Sync failed';
		} finally {
			syncing = false;
		}
	}
</script>

<div class="min-h-screen flex flex-col bg-[#faf7f0] dark:bg-[#18180f] transition-colors">
	{#if sbState.loading && !isPublicRoute}
		<div class="flex-1 flex items-center justify-center">
			<div class="w-8 h-8 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
		</div>
	{:else if !sbState.user && !isPublicRoute}
		<!-- Will redirect to /login via $effect -->
	{:else if sbState.user}
		<header class="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
			<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div class="flex items-center justify-between h-16">
					<div class="flex items-center gap-8">
						<a href="/admin" class="flex items-center gap-2.5">
							<div class="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center shadow-sm shadow-brand-300">
								<div class="w-3 h-3 rounded-full bg-brand-300 animate-pulse"></div>
							</div>
							<span class="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">Proximity Green</span>
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
							<a
								href="/admin"
								class="px-3.5 py-2 text-sm font-medium rounded-lg transition-colors {currentPath.startsWith('/admin')
									? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
									: 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800'}"
							>
								Admin
							</a>
						</nav>
					</div>

					<div class="flex items-center gap-3">
						{#if isAuthenticated}
							<div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
								<div class="w-2 h-2 bg-green-500 rounded-full"></div>
								<span>{orgName}</span>
							</div>

							<!-- Sync ref data -->
							<button
								onclick={handleSync}
								disabled={syncing}
								class="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors cursor-pointer disabled:opacity-50"
								title="Sync accounts & tracking from Xero"
							>
								<svg class="w-5 h-5 {syncing ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
								</svg>
							</button>
							{#if syncMessage}
								<span class="text-xs text-green-600 dark:text-green-400 select-text cursor-text">{syncMessage}</span>
								<button onclick={() => { syncMessage = ''; }} class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer p-0.5" title="Dismiss">
									<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
								</button>
							{/if}
						{:else}
							<button
								onclick={() => { window.location.href = getAuthConnectUrl(); }}
								class="flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 px-3 py-1.5 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors cursor-pointer"
							>
								<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
									<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
								</svg>
								Connect Xero
							</button>
						{/if}

						<span class="text-sm text-gray-400 dark:text-gray-500">{userEmail}</span>

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
							Sign out
						</button>
					</div>
				</div>
			</div>
		</header>

		<main class="flex-1">
			{@render children()}
		</main>
	{:else}
		<main class="flex-1">
			{@render children()}
		</main>
	{/if}
</div>
