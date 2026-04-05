<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { sbUser } from '$lib/stores';
	import { inviteUser } from '$lib/api';
	import { get } from 'svelte/store';

	interface AllowedUser {
		id: string;
		email: string;
		name: string | null;
		created_at: string;
	}

	let users: AllowedUser[] = $state([]);
	let email = $state('');
	let sending = $state(false);
	let message = $state('');
	let messageType: 'success' | 'error' = $state('success');
	let loading = $state(true);

	function getUser(): string {
		const sbState = get(sbUser);
		if (sbState.user) {
			const meta = sbState.user.user_metadata;
			return meta?.full_name || meta?.name || sbState.user.email || 'unknown';
		}
		return 'unknown';
	}

	onMount(async () => {
		await loadUsers();
		loading = false;
	});

	async function loadUsers() {
		const { data } = await supabase
			.from('allowed_users')
			.select('*')
			.order('created_at', { ascending: false });
		if (data) users = data;
	}

	function isGoogleEmail(email: string): boolean {
		const domain = email.split('@')[1]?.toLowerCase();
		if (!domain) return false;
		// Gmail is always Google. For workspace, we can't fully verify,
		// but we allow any domain since Google Workspace uses custom domains.
		// The auth flow itself will reject non-Google accounts.
		return true;
	}

	async function handleInvite() {
		const trimmed = email.trim().toLowerCase();
		if (!trimmed || !trimmed.includes('@')) {
			message = 'Please enter a valid email address';
			messageType = 'error';
			return;
		}

		if (!isGoogleEmail(trimmed)) {
			message = 'Please use a Gmail or Google Workspace email';
			messageType = 'error';
			return;
		}

		if (users.some(u => u.email === trimmed)) {
			message = 'This user already has access';
			messageType = 'error';
			return;
		}

		sending = true;
		message = '';

		try {
			await inviteUser(trimmed, getUser());
			message = `Invite sent to ${trimmed}`;
			messageType = 'success';
			email = '';
			await loadUsers();
		} catch (e: unknown) {
			const err = e as any;
			message = err?.message || err?.error || 'Failed to send invite';
			messageType = 'error';
		} finally {
			sending = false;
		}
	}

	async function removeUser(id: string, userEmail: string) {
		// Don't allow removing yourself
		const sbState = get(sbUser);
		if (sbState.user?.email === userEmail) {
			message = "You can't remove yourself";
			messageType = 'error';
			return;
		}

		await supabase.from('allowed_users').delete().eq('id', id);
		users = users.filter(u => u.id !== id);
	}

	function timeAgo(date: string): string {
		const diff = Date.now() - new Date(date).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleInvite();
		}
	}
</script>

<div>
	<div class="mb-6">
		<h2 class="text-xl font-semibold text-gray-900 dark:text-white">Invite People</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
			Invite users with a Gmail or Google Workspace account
		</p>
	</div>

	<!-- Invite form -->
	<div class="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg px-4 py-4 mb-6">
		<div class="flex items-center gap-3">
			<div class="relative flex-1">
				<input
					type="email"
					bind:value={email}
					onkeydown={handleKeydown}
					placeholder="name@gmail.com or name@company.com"
					class="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
				/>
			</div>
			<button
				onclick={handleInvite}
				disabled={sending || !email.trim()}
				class="px-4 py-2 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-lg cursor-pointer disabled:opacity-40 flex items-center gap-2"
			>
				{#if sending}
					<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
					Sending...
				{:else}
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
					</svg>
					Send Invite
				{/if}
			</button>
		</div>

		{#if message}
			<p class="mt-2 text-sm {messageType === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
				{message}
			</p>
		{/if}

		<p class="mt-2 text-xs text-gray-400">
			They'll receive an email with a link to sign in. Only Google accounts can authenticate.
		</p>
	</div>

	<!-- Current users -->
	<h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
		Authorised Users ({users.length})
	</h3>

	{#if loading}
		<div class="flex justify-center py-8">
			<div class="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
		</div>
	{:else}
		<div class="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
			{#each users as user (user.id)}
				<div class="flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-gray-800/50 last:border-0 group">
					<div>
						<p class="text-sm font-medium text-gray-900 dark:text-white">{user.email}</p>
						<p class="text-xs text-gray-400">Added {timeAgo(user.created_at)}</p>
					</div>
					<button
						onclick={() => removeUser(user.id, user.email)}
						class="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 cursor-pointer transition-opacity px-2 py-1"
					>
						Remove
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
