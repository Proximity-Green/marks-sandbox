<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { sbUser } from '$lib/stores';
	import { get } from 'svelte/store';

	interface Tag {
		id: string;
		name: string;
		color: string;
	}

	let { entityType, entityId }: { entityType: string; entityId: string } = $props();

	let assignedTags: Tag[] = $state([]);
	let allTags: Tag[] = $state([]);
	let showPicker = $state(false);
	let newTagName = $state('');
	let newTagColor = $state('#3b82f6');
	let loading = $state(true);

	const colors = [
		'#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
		'#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6'
	];

	let availableTags = $derived(
		allTags.filter((t) => !assignedTags.some((a) => a.id === t.id))
	);

	let filteredAvailable = $derived(
		newTagName
			? availableTags.filter((t) => t.name.toLowerCase().includes(newTagName.toLowerCase()))
			: availableTags
	);

	let showCreate = $derived(
		newTagName.trim() &&
			!allTags.some((t) => t.name.toLowerCase() === newTagName.trim().toLowerCase())
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
		await Promise.all([loadAssigned(), loadAllTags()]);
		loading = false;
	});

	$effect(() => {
		if (entityId && entityType) {
			loadAssigned();
		}
	});

	async function loadAssigned() {
		const { data } = await supabase
			.from('entity_tags')
			.select('tag_id, tags(id, name, color)')
			.eq('entity_type', entityType)
			.eq('entity_id', entityId);
		if (data) {
			assignedTags = data.map((d: any) => d.tags).filter(Boolean);
		}
	}

	async function loadAllTags() {
		const { data } = await supabase.from('tags').select('*').order('name');
		if (data) allTags = data;
	}

	async function assignTag(tag: Tag) {
		const { error } = await supabase.from('entity_tags').insert({
			entity_type: entityType,
			entity_id: entityId,
			tag_id: tag.id,
			created_by: getUser()
		});
		if (!error) {
			assignedTags = [...assignedTags, tag];
		}
	}

	async function removeTag(tagId: string) {
		await supabase
			.from('entity_tags')
			.delete()
			.eq('entity_type', entityType)
			.eq('entity_id', entityId)
			.eq('tag_id', tagId);
		assignedTags = assignedTags.filter((t) => t.id !== tagId);
	}

	async function createAndAssign() {
		const name = newTagName.trim();
		if (!name) return;

		const { data, error } = await supabase
			.from('tags')
			.insert({ name, color: newTagColor, created_by: getUser() })
			.select()
			.single();

		if (data && !error) {
			allTags = [...allTags, data];
			await assignTag(data);
			newTagName = '';
		}
	}

	async function deleteTag(tag: Tag) {
		await supabase.from('tags').delete().eq('id', tag.id);
		allTags = allTags.filter((t) => t.id !== tag.id);
		assignedTags = assignedTags.filter((t) => t.id !== tag.id);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (showCreate) {
				createAndAssign();
			} else if (filteredAvailable.length > 0) {
				assignTag(filteredAvailable[0]);
				newTagName = '';
			}
		} else if (e.key === 'Escape') {
			showPicker = false;
		}
	}
</script>

<div class="space-y-2">
	<h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
		Tags
	</h4>

	<!-- Assigned tags -->
	<div class="flex flex-wrap gap-1.5">
		{#each assignedTags as tag (tag.id)}
			<span
				class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full text-white"
				style="background-color: {tag.color}"
			>
				{tag.name}
				<button
					onclick={() => removeTag(tag.id)}
					class="hover:bg-white/20 rounded-full p-0.5 cursor-pointer"
					title="Remove tag"
				>
					<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</span>
		{/each}

		<button
			onclick={() => { showPicker = !showPicker; }}
			class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-0.5 rounded-full border border-dashed border-gray-300 dark:border-gray-600 hover:border-gray-400 cursor-pointer transition-colors"
		>
			<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
			</svg>
			Add tag
		</button>
	</div>

	<!-- Tag picker -->
	{#if showPicker}
		<div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 space-y-2">
			<input
				type="text"
				bind:value={newTagName}
				onkeydown={handleKeydown}
				placeholder="Search or create tag..."
				class="w-full text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
			/>

			{#if filteredAvailable.length > 0}
				<div class="max-h-32 overflow-y-auto space-y-0.5">
					{#each filteredAvailable as tag (tag.id)}
						<div class="flex items-center justify-between group">
							<button
								onclick={() => { assignTag(tag); newTagName = ''; }}
								class="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer flex-1"
							>
								<span class="w-3 h-3 rounded-full shrink-0" style="background-color: {tag.color}"></span>
								<span class="text-gray-700 dark:text-gray-200">{tag.name}</span>
							</button>
							<button
								onclick={() => deleteTag(tag)}
								class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1 cursor-pointer"
								title="Delete tag permanently"
							>
								<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
								</svg>
							</button>
						</div>
					{/each}
				</div>
			{/if}

			{#if showCreate}
				<div class="border-t border-gray-100 dark:border-gray-700 pt-2 space-y-2">
					<div class="flex items-center gap-2">
						<span class="text-xs text-gray-500">Create:</span>
						<span
							class="text-xs font-medium px-2 py-0.5 rounded-full text-white"
							style="background-color: {newTagColor}"
						>
							{newTagName.trim()}
						</span>
					</div>
					<div class="flex gap-1">
						{#each colors as c}
							<button
								onclick={() => { newTagColor = c; }}
								class="w-5 h-5 rounded-full cursor-pointer ring-offset-1 {newTagColor === c ? 'ring-2 ring-gray-400' : ''}"
								style="background-color: {c}"
							></button>
						{/each}
					</div>
					<button
						onclick={createAndAssign}
						class="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1 rounded-md cursor-pointer w-full"
					>
						Create & add
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
