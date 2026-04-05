<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { sbUser } from '$lib/stores';
	import { get } from 'svelte/store';

	import { goto } from '$app/navigation';
	import { openRecordId } from '$lib/stores';

	interface EntityDetail {
		entity_type: string;
		entity_id: string;
		label: string;
	}

	interface Tag {
		id: string;
		name: string;
		color: string;
		created_by: string | null;
		created_at: string;
		usage_count?: number;
		entities?: Array<{ entity_type: string; entity_id: string }>;
	}

	const colors = [
		'#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
		'#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6'
	];

	let tags: Tag[] = $state([]);
	let loading = $state(true);
	let search = $state('');
	let newName = $state('');
	let newColor = $state('#3b82f6');
	let editingId: string | null = $state(null);
	let editName = $state('');
	let editColor = $state('');
	let confirmDeleteId: string | null = $state(null);
	let expandedId: string | null = $state(null);
	let expandedEntities: EntityDetail[] = $state([]);
	let expandLoading = $state(false);

	let filtered = $derived(
		search
			? tags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
			: tags
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
		await loadTags();
		loading = false;
	});

	async function loadTags() {
		// Load tags with usage counts
		const { data: tagsData } = await supabase.from('tags').select('*').order('name');
		const { data: entityTagsData } = await supabase.from('entity_tags').select('tag_id, entity_type, entity_id');

		if (tagsData) {
			tags = tagsData.map((t: Tag) => {
				const entities = (entityTagsData || []).filter((et: any) => et.tag_id === t.id);
				return {
					...t,
					usage_count: entities.length,
					entities: entities.map((et: any) => ({ entity_type: et.entity_type, entity_id: et.entity_id }))
				};
			});
		}
	}

	async function createTag() {
		const name = newName.trim();
		if (!name) return;

		const { error } = await supabase.from('tags').insert({
			name,
			color: newColor,
			created_by: getUser()
		});

		if (!error) {
			newName = '';
			newColor = '#3b82f6';
			await loadTags();
		}
	}

	async function startEdit(tag: Tag) {
		editingId = tag.id;
		editName = tag.name;
		editColor = tag.color;
	}

	async function saveEdit() {
		if (!editingId || !editName.trim()) return;

		await supabase
			.from('tags')
			.update({ name: editName.trim(), color: editColor })
			.eq('id', editingId);

		editingId = null;
		await loadTags();
	}

	async function deleteTag(id: string) {
		await supabase.from('tags').delete().eq('id', id);
		confirmDeleteId = null;
		tags = tags.filter((t) => t.id !== id);
	}

	async function toggleExpand(tag: Tag) {
		if (expandedId === tag.id) {
			expandedId = null;
			expandedEntities = [];
			return;
		}

		expandedId = tag.id;
		expandLoading = true;
		expandedEntities = [];

		const entities = tag.entities || [];
		const details: EntityDetail[] = [];

		// Group by entity_type for batch lookups
		const byType: Record<string, string[]> = {};
		for (const e of entities) {
			if (!byType[e.entity_type]) byType[e.entity_type] = [];
			byType[e.entity_type].push(e.entity_id);
		}

		// Lookup names for each type
		for (const [type, ids] of Object.entries(byType)) {
			const table = type === 'item' ? 'items' : type === 'document' ? 'documents' : type === 'contact' ? 'contacts' : type + 's';
			const nameCol = type === 'item' ? 'name' : type === 'document' ? 'doc_number' : type === 'contact' ? 'name' : 'name';

			const { data } = await supabase
				.from(table)
				.select(`id, ${nameCol}`)
				.in('id', ids);

			if (data) {
				for (const row of data) {
					details.push({
						entity_type: type,
						entity_id: row.id,
						label: (row as any)[nameCol] || row.id.slice(0, 8)
					});
				}
			}

			// Add any IDs not found in DB
			for (const id of ids) {
				if (!details.some((d) => d.entity_id === id)) {
					details.push({ entity_type: type, entity_id: id, label: id.slice(0, 8) + '...' });
				}
			}
		}

		expandedEntities = details;
		expandLoading = false;
	}

	function navigateToEntity(entity: EntityDetail) {
		const routes: Record<string, string> = {
			item: '/admin/items',
			document: '/admin/documents',
			contact: '/admin/contacts'
		};
		const route = routes[entity.entity_type] || '/admin/items';
		openRecordId.set(entity.entity_id);
		goto(route);
	}

	function handleCreateKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			createTag();
		}
	}

	function handleEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveEdit();
		} else if (e.key === 'Escape') {
			editingId = null;
		}
	}
</script>

<div>
	<div class="flex items-center justify-between mb-4">
		<div>
			<h2 class="text-xl font-semibold text-gray-900 dark:text-white">Tags</h2>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				{tags.length} tag{tags.length !== 1 ? 's' : ''}
			</p>
		</div>
	</div>

	<!-- Create new tag -->
	<div class="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg px-4 py-3 mb-4">
		<div class="flex items-center gap-3">
			<input
				type="text"
				bind:value={newName}
				onkeydown={handleCreateKeydown}
				placeholder="New tag name..."
				class="flex-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
			/>
			<div class="flex gap-1">
				{#each colors as c}
					<button
						onclick={() => { newColor = c; }}
						class="w-5 h-5 rounded-full cursor-pointer ring-offset-1 {newColor === c ? 'ring-2 ring-gray-400' : ''} hover:scale-110 transition-transform"
						style="background-color: {c}"
					></button>
				{/each}
			</div>
			<button
				onclick={createTag}
				disabled={!newName.trim()}
				class="px-3 py-1.5 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-lg cursor-pointer disabled:opacity-30"
			>
				Create
			</button>
		</div>
		{#if newName.trim()}
			<div class="mt-2">
				<span class="text-xs text-gray-400">Preview: </span>
				<span
					class="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full text-white"
					style="background-color: {newColor}"
				>
					{newName.trim()}
				</span>
			</div>
		{/if}
	</div>

	<!-- Search -->
	{#if tags.length > 5}
		<div class="mb-4">
			<input
				type="text"
				bind:value={search}
				placeholder="Search tags..."
				class="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-64"
			/>
		</div>
	{/if}

	<!-- Tags list -->
	{#if loading}
		<div class="flex justify-center py-12">
			<div class="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
		</div>
	{:else if filtered.length === 0}
		<p class="text-sm text-gray-400 text-center py-12">
			{search ? 'No tags match your search' : 'No tags created yet'}
		</p>
	{:else}
		<div class="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
			<table class="w-full">
				<thead>
					<tr class="border-b border-gray-100 dark:border-gray-800 text-left">
						<th class="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Tag</th>
						<th class="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Used on</th>
						<th class="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Created by</th>
						<th class="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-24"></th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as tag (tag.id)}
						<tr class="border-b border-gray-50 dark:border-gray-800/50 group hover:bg-gray-50 dark:hover:bg-gray-800/30">
							<td class="px-4 py-2.5">
								{#if editingId === tag.id}
									<div class="flex items-center gap-2">
										<input
											type="text"
											bind:value={editName}
											onkeydown={handleEditKeydown}
											class="px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded focus:outline-none focus:ring-1 focus:ring-brand-500 w-32"
										/>
										<div class="flex gap-0.5">
											{#each colors as c}
												<button
													onclick={() => { editColor = c; }}
													class="w-4 h-4 rounded-full cursor-pointer {editColor === c ? 'ring-2 ring-gray-400 ring-offset-1' : ''}"
													style="background-color: {c}"
												></button>
											{/each}
										</div>
									</div>
								{:else}
									<span
										class="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full text-white"
										style="background-color: {tag.color}"
									>
										{tag.name}
									</span>
								{/if}
							</td>
							<td class="px-4 py-2.5">
								{#if (tag.usage_count || 0) > 0}
									<button
										onclick={() => toggleExpand(tag)}
										class="flex items-center gap-1.5 text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 cursor-pointer"
									>
										<svg class="w-3.5 h-3.5 transition-transform {expandedId === tag.id ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
										</svg>
										{tag.usage_count} {tag.usage_count === 1 ? 'entity' : 'entities'}
										<span class="flex gap-1">
											{#each [...new Set(tag.entities?.map((e: {entity_type: string}) => e.entity_type) || [])] as type}
												<span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
													{type}
												</span>
											{/each}
										</span>
									</button>
								{:else}
									<span class="text-sm text-gray-400">0 entities</span>
								{/if}
							</td>
							<td class="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">
								{tag.created_by || '-'}
							</td>
							<td class="px-4 py-2.5">
								<div class="flex items-center justify-end gap-1">
									{#if editingId === tag.id}
										<button
											onclick={saveEdit}
											class="text-xs text-brand-600 hover:text-brand-700 font-medium cursor-pointer px-2 py-1"
										>
											Save
										</button>
										<button
											onclick={() => { editingId = null; }}
											class="text-xs text-gray-400 hover:text-gray-600 cursor-pointer px-2 py-1"
										>
											Cancel
										</button>
									{:else if confirmDeleteId === tag.id}
										<span class="text-xs text-red-500 mr-1">Delete?</span>
										<button
											onclick={() => deleteTag(tag.id)}
											class="text-xs text-red-600 hover:text-red-700 font-medium cursor-pointer px-2 py-1"
										>
											Yes
										</button>
										<button
											onclick={() => { confirmDeleteId = null; }}
											class="text-xs text-gray-400 hover:text-gray-600 cursor-pointer px-2 py-1"
										>
											No
										</button>
									{:else}
										<button
											onclick={() => startEdit(tag)}
											class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-brand-500 cursor-pointer p-1 transition-opacity"
											title="Edit tag"
										>
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
											</svg>
										</button>
										<button
											onclick={() => { confirmDeleteId = tag.id; }}
											class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 cursor-pointer p-1 transition-opacity"
											title="Delete tag"
										>
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
											</svg>
										</button>
									{/if}
								</div>
							</td>
						</tr>
						{#if expandedId === tag.id}
							<tr>
								<td colspan="4" class="px-4 py-3 bg-gray-50/50 dark:bg-gray-800/20">
									{#if expandLoading}
										<div class="flex items-center gap-2 text-sm text-gray-400 py-2">
											<div class="w-4 h-4 border-2 border-gray-200 border-t-brand-500 rounded-full animate-spin"></div>
											Loading...
										</div>
									{:else if expandedEntities.length === 0}
										<p class="text-sm text-gray-400 py-1">No entities found</p>
									{:else}
										<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
											{#each expandedEntities as entity}
												<button
													onclick={() => navigateToEntity(entity)}
													class="flex items-center gap-2 text-sm text-left px-3 py-2 rounded-lg hover:bg-white dark:hover:bg-gray-800 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 cursor-pointer transition-colors group"
												>
													<span class="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0">
														{entity.entity_type}
													</span>
													<span class="text-gray-700 dark:text-gray-300 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400">
														{entity.label}
													</span>
													<svg class="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 group-hover:text-brand-400 shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
														<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
													</svg>
												</button>
											{/each}
										</div>
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
