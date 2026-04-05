<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';

	interface Note {
		id: string;
		entity_type: string;
		entity_id: string;
		content: string;
		mentions: string[];
		created_by: string;
		created_at: string;
	}

	let notes: Note[] = $state([]);
	let loading = $state(true);
	let search = $state('');
	let filterType = $state('all');
	let filterMention = $state('');
	let entityTypes: string[] = $state([]);
	let mentionedUsers: string[] = $state([]);

	let filtered = $derived(() => {
		let result = notes;
		if (filterType !== 'all') {
			result = result.filter((n) => n.entity_type === filterType);
		}
		if (filterMention) {
			result = result.filter((n) => n.mentions?.includes(filterMention));
		}
		if (search) {
			const q = search.toLowerCase();
			result = result.filter(
				(n) =>
					n.content.toLowerCase().includes(q) ||
					n.created_by.toLowerCase().includes(q) ||
					n.entity_id.toLowerCase().includes(q)
			);
		}
		return result;
	});

	onMount(async () => {
		await loadNotes();
		loading = false;
	});

	async function loadNotes() {
		const { data } = await supabase
			.from('notes')
			.select('*')
			.order('created_at', { ascending: false })
			.limit(500);
		if (data) {
			notes = data;
			entityTypes = [...new Set(data.map((n: Note) => n.entity_type))];
			const allMentions = data.flatMap((n: Note) => n.mentions || []);
			mentionedUsers = [...new Set(allMentions)].sort();
		}
	}

	async function deleteNote(id: string) {
		await supabase.from('notes').delete().eq('id', id);
		notes = notes.filter((n) => n.id !== id);
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

<div>
	<div class="flex items-center justify-between mb-4">
		<div>
			<h2 class="text-xl font-semibold text-gray-900 dark:text-white">Notes</h2>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				{filtered().length} note{filtered().length !== 1 ? 's' : ''}
			</p>
		</div>
	</div>

	<!-- Filters -->
	<div class="flex flex-wrap items-center gap-3 mb-4">
		<input
			type="text"
			bind:value={search}
			placeholder="Search notes..."
			class="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-64"
		/>

		<select
			bind:value={filterType}
			class="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
		>
			<option value="all">All types</option>
			{#each entityTypes as t}
				<option value={t}>{t}</option>
			{/each}
		</select>

		{#if mentionedUsers.length > 0}
			<select
				bind:value={filterMention}
				class="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
			>
				<option value="">All mentions</option>
				{#each mentionedUsers as u}
					<option value={u}>@{u}</option>
				{/each}
			</select>
		{/if}

		{#if search || filterType !== 'all' || filterMention}
			<button
				onclick={() => { search = ''; filterType = 'all'; filterMention = ''; }}
				class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
			>
				Clear filters
			</button>
		{/if}
	</div>

	<!-- Notes list -->
	{#if loading}
		<div class="flex justify-center py-12">
			<div class="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
		</div>
	{:else if filtered().length === 0}
		<p class="text-sm text-gray-400 text-center py-12">No notes found</p>
	{:else}
		<div class="space-y-2">
			{#each filtered() as note (note.id)}
				<div class="group bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg px-4 py-3">
					<div class="flex items-start justify-between gap-3">
						<div class="flex-1 min-w-0">
							<p class="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
								{@html renderContent(note.content)}
							</p>
							<div class="flex items-center gap-3 mt-2 text-xs text-gray-400">
								<span class="font-medium text-gray-500 dark:text-gray-400">{note.created_by}</span>
								<span>{timeAgo(note.created_at)}</span>
								<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
									{note.entity_type}
								</span>
								<span class="font-mono text-gray-400 truncate max-w-[120px]" title={note.entity_id}>
									{note.entity_id.slice(0, 8)}...
								</span>
								{#if note.mentions?.length > 0}
									<span class="text-brand-500">
										{note.mentions.length} mention{note.mentions.length > 1 ? 's' : ''}
									</span>
								{/if}
							</div>
						</div>
						<button
							onclick={() => deleteNote(note.id)}
							class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 shrink-0 cursor-pointer transition-opacity p-1"
							title="Delete note"
						>
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
							</svg>
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
