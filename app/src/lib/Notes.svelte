<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { sbUser } from '$lib/stores';
	import { get } from 'svelte/store';

	interface Note {
		id: string;
		content: string;
		mentions: string[];
		created_by: string;
		created_at: string;
	}

	interface AllowedUser {
		email: string;
		name: string | null;
	}

	let { entityType, entityId }: { entityType: string; entityId: string } = $props();

	let notes: Note[] = $state([]);
	let newNote = $state('');
	let loading = $state(true);
	let saving = $state(false);
	let users: AllowedUser[] = $state([]);
	let showMentions = $state(false);
	let mentionFilter = $state('');
	let mentionStart = $state(-1);
	let textareaEl: HTMLTextAreaElement | undefined = $state();

	let filteredUsers = $derived(
		mentionFilter
			? users.filter(
					(u) =>
						u.email.toLowerCase().includes(mentionFilter.toLowerCase()) ||
						(u.name && u.name.toLowerCase().includes(mentionFilter.toLowerCase()))
				)
			: users
	);

	function getUser(): string {
		const sbState = get(sbUser);
		if (sbState.user) {
			const meta = sbState.user.user_metadata;
			return meta?.full_name || meta?.name || sbState.user.email || 'unknown';
		}
		return 'unknown';
	}

	onMount(async () => {
		await loadNotes();
		// Load allowed users for @mentions
		const { data } = await supabase.from('allowed_users').select('email, name').order('name');
		if (data) users = data;
		loading = false;
	});

	// Reload when entity changes
	$effect(() => {
		if (entityId && entityType) {
			loadNotes();
		}
	});

	async function loadNotes() {
		const { data } = await supabase
			.from('notes')
			.select('*')
			.eq('entity_type', entityType)
			.eq('entity_id', entityId)
			.order('created_at', { ascending: false });
		if (data) notes = data;
	}

	async function addNote() {
		const content = newNote.trim();
		if (!content) return;

		// Extract @mentions
		const mentionRegex = /@(\S+)/g;
		const mentions: string[] = [];
		let match;
		while ((match = mentionRegex.exec(content)) !== null) {
			const mentioned = users.find(
				(u) => u.email === match![1] || u.name?.toLowerCase() === match![1].toLowerCase()
			);
			if (mentioned) mentions.push(mentioned.email);
		}

		saving = true;
		const { error } = await supabase.from('notes').insert({
			entity_type: entityType,
			entity_id: entityId,
			content,
			mentions,
			created_by: getUser()
		});

		if (!error) {
			newNote = '';
			await loadNotes();
		}
		saving = false;
	}

	async function deleteNote(id: string) {
		await supabase.from('notes').delete().eq('id', id);
		notes = notes.filter((n) => n.id !== id);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			if (showMentions && filteredUsers.length > 0) {
				selectMention(filteredUsers[0]);
			} else {
				addNote();
			}
		} else if (e.key === 'Escape' && showMentions) {
			showMentions = false;
		}
	}

	function handleInput() {
		const val = newNote;
		const cursorPos = textareaEl?.selectionStart ?? val.length;
		const textBeforeCursor = val.slice(0, cursorPos);
		const lastAt = textBeforeCursor.lastIndexOf('@');

		if (lastAt >= 0) {
			const afterAt = textBeforeCursor.slice(lastAt + 1);
			if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
				showMentions = true;
				mentionStart = lastAt;
				mentionFilter = afterAt;
				return;
			}
		}
		showMentions = false;
	}

	function selectMention(user: AllowedUser) {
		const before = newNote.slice(0, mentionStart);
		const cursorPos = textareaEl?.selectionStart ?? newNote.length;
		const after = newNote.slice(cursorPos);
		newNote = before + '@' + user.email + ' ' + after;
		showMentions = false;
		textareaEl?.focus();
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

	function renderContent(content: string): string {
		return content.replace(
			/@(\S+)/g,
			'<span class="text-brand-600 dark:text-brand-400 font-medium">@$1</span>'
		);
	}
</script>

<div class="space-y-3">
	<h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
		Notes {notes.length > 0 ? `(${notes.length})` : ''}
	</h4>

	<!-- Add note -->
	<div class="relative">
		<textarea
			bind:this={textareaEl}
			bind:value={newNote}
			oninput={handleInput}
			onkeydown={handleKeydown}
			placeholder="Add a note... Use @ to mention someone"
			rows="2"
			class="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
		></textarea>

		{#if showMentions && filteredUsers.length > 0}
			<div
				class="absolute left-0 bottom-full mb-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-40 overflow-y-auto"
			>
				{#each filteredUsers as user}
					<button
						type="button"
						onclick={() => selectMention(user)}
						class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2"
					>
						<span class="text-gray-900 dark:text-white">{user.name || user.email}</span>
						{#if user.name}
							<span class="text-gray-400 text-xs">{user.email}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		{#if newNote.trim()}
			<div class="flex justify-end mt-1">
				<button
					onclick={addNote}
					disabled={saving}
					class="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1 rounded-md cursor-pointer disabled:opacity-50"
				>
					{saving ? 'Saving...' : 'Add Note'}
				</button>
			</div>
		{/if}
	</div>

	<!-- Notes list -->
	{#if loading}
		<p class="text-xs text-gray-400">Loading...</p>
	{:else if notes.length === 0}
		<p class="text-xs text-gray-400 italic">No notes yet</p>
	{:else}
		<div class="space-y-2 max-h-60 overflow-y-auto">
			{#each notes as note (note.id)}
				<div
					class="group bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2 text-sm"
				>
					<div class="flex items-start justify-between gap-2">
						<p class="text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words flex-1">
							{@html renderContent(note.content)}
						</p>
						<button
							onclick={() => deleteNote(note.id)}
							class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 shrink-0 cursor-pointer transition-opacity"
							title="Delete note"
						>
							<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					<p class="text-xs text-gray-400 mt-1">
						{note.created_by} &middot; {timeAgo(note.created_at)}
					</p>
				</div>
			{/each}
		</div>
	{/if}
</div>
