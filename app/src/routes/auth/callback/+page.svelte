<script lang="ts">
	import { supabase, isEmailAllowed, signOut } from '$lib/supabase';
	import { sbUser } from '$lib/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let status = $state('Verifying your account...');
	let error = $state('');

	onMount(async () => {
		try {
			// Supabase processes the hash fragment automatically
			const { data: { session }, error: sessionError } = await supabase.auth.getSession();

			if (sessionError) {
				error = sessionError.message;
				return;
			}

			if (!session?.user) {
				error = 'No session found. Please try signing in again.';
				return;
			}

			const email = session.user.email;
			if (!email) {
				await signOut();
				error = 'Could not retrieve your email address.';
				return;
			}

			status = 'Checking access...';
			const allowed = await isEmailAllowed(email);

			if (!allowed) {
				await signOut();
				error = `Access denied. ${email} is not on the approved list.`;
				return;
			}

			sbUser.setUser(session.user);
			goto('/');
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'An unexpected error occurred';
		}
	});
</script>

<div class="min-h-screen flex items-center justify-center px-4">
	<div class="max-w-md w-full">
		<div class="bg-white dark:bg-gray-900 rounded-2xl shadow-lg shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800 p-8 text-center">
			{#if error}
				<div class="space-y-4">
					<div class="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto">
						<svg class="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</div>
					<p class="text-sm text-red-700 dark:text-red-400">{error}</p>
					<a
						href="/login"
						class="inline-block text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium"
					>
						Back to sign in
					</a>
				</div>
			{:else}
				<div class="space-y-3">
					<div class="w-8 h-8 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto"></div>
					<p class="text-sm text-gray-500 dark:text-gray-400">{status}</p>
				</div>
			{/if}
		</div>
	</div>
</div>
