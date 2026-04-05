<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';

	interface ChangeEntry {
		id: string;
		table_name: string;
		record_id: string;
		action: string;
		changed_by: string;
		old_values: Record<string, any> | null;
		new_values: Record<string, any> | null;
		changed_at: string;
	}

	let entries: ChangeEntry[] = $state([]);
	let loading = $state(true);
	let search = $state('');
	let filterAction = $state('all');
	let filterTable = $state('all');
	let filterUser = $state('all');
	let pageSize = $state(50);
	let offset = $state(0);
	let total = $state(0);

	let actions: string[] = $state([]);
	let tables: string[] = $state([]);
	let users: string[] = $state([]);

	let filtered = $derived(() => {
		let result = entries;
		if (search) {
			const q = search.toLowerCase();
			result = result.filter(e =>
				getLabel(e).toLowerCase().includes(q) ||
				e.changed_by?.toLowerCase().includes(q) ||
				e.record_id?.toLowerCase().includes(q)
			);
		}
		return result;
	});

	const actionColors: Record<string, string> = {
		INSERT: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
		UPDATE: 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400',
		DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
		RESTORE: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
	};

	onMount(() => loadEntries());

	async function loadEntries() {
		loading = true;

		let query = supabase
			.from('change_log')
			.select('*', { count: 'exact' })
			.order('changed_at', { ascending: false })
			.range(offset, offset + pageSize - 1);

		if (filterAction !== 'all') query = query.eq('action', filterAction);
		if (filterTable !== 'all') query = query.eq('table_name', filterTable);
		if (filterUser !== 'all') query = query.eq('changed_by', filterUser);

		const { data, count } = await query;

		if (data) {
			entries = data;
			total = count || 0;
		}

		// Load filter options (once)
		if (actions.length === 0) {
			const { data: allData } = await supabase
				.from('change_log')
				.select('action, table_name, changed_by');
			if (allData) {
				actions = [...new Set(allData.map((d: any) => d.action))].sort();
				tables = [...new Set(allData.map((d: any) => d.table_name))].sort();
				users = [...new Set(allData.map((d: any) => d.changed_by).filter(Boolean))].sort();
			}
		}

		loading = false;
	}

	function getLabel(e: ChangeEntry): string {
		const vals = e.new_values || e.old_values;
		return vals?.name || vals?.item_code || vals?.code || vals?.doc_number || e.record_id?.slice(0, 8) || '-';
	}

	function getChangedFields(e: ChangeEntry): Array<{ field: string; old: string; new: string }> {
		if (!e.old_values || !e.new_values) return [];
		const fields: Array<{ field: string; old: string; new: string }> = [];
		for (const key of Object.keys(e.new_values)) {
			if (['id', 'created_at', 'updated_at'].includes(key)) continue;
			const oldVal = String(e.old_values[key] ?? '');
			const newVal = String(e.new_values[key] ?? '');
			if (oldVal !== newVal) {
				fields.push({ field: key, old: oldVal, new: newVal });
			}
		}
		return fields;
	}

	function timeAgo(date: string): string {
		const diff = Date.now() - new Date(date).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 30) return `${days}d ago`;
		return new Date(date).toLocaleDateString();
	}

	function applyFilters() {
		offset = 0;
		loadEntries();
	}

	function nextPage() {
		offset += pageSize;
		loadEntries();
	}

	function prevPage() {
		offset = Math.max(0, offset - pageSize);
		loadEntries();
	}

	let expandedId: string | null = $state(null);
</script>

<div>
	<div class="flex items-center justify-between mb-4">
		<div>
			<h2 class="text-xl font-semibold text-gray-900 dark:text-white">Change Log</h2>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				{total} total change{total !== 1 ? 's' : ''}
			</p>
		</div>
	</div>

	<!-- Filters -->
	<div class="flex flex-wrap items-center gap-3 mb-4">
		<input
			type="text"
			bind:value={search}
			placeholder="Search..."
			class="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 w-48"
		/>

		<select
			bind:value={filterAction}
			onchange={applyFilters}
			class="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg cursor-pointer"
		>
			<option value="all">All actions</option>
			{#each actions as a}
				<option value={a}>{a}</option>
			{/each}
		</select>

		<select
			bind:value={filterTable}
			onchange={applyFilters}
			class="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg cursor-pointer"
		>
			<option value="all">All tables</option>
			{#each tables as t}
				<option value={t}>{t}</option>
			{/each}
		</select>

		<select
			bind:value={filterUser}
			onchange={applyFilters}
			class="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg cursor-pointer"
		>
			<option value="all">All users</option>
			{#each users as u}
				<option value={u}>{u}</option>
			{/each}
		</select>

		{#if filterAction !== 'all' || filterTable !== 'all' || filterUser !== 'all'}
			<button
				onclick={() => { filterAction = 'all'; filterTable = 'all'; filterUser = 'all'; applyFilters(); }}
				class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
			>
				Clear filters
			</button>
		{/if}
	</div>

	<!-- Table -->
	{#if loading}
		<div class="flex justify-center py-12">
			<div class="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
		</div>
	{:else if filtered().length === 0}
		<p class="text-sm text-gray-400 text-center py-12">No changes found</p>
	{:else}
		<div class="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
			<table class="w-full">
				<thead>
					<tr class="border-b border-gray-100 dark:border-gray-800 text-left">
						<th class="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-24">Action</th>
						<th class="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Record</th>
						<th class="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Table</th>
						<th class="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">User</th>
						<th class="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">When</th>
					</tr>
				</thead>
				<tbody>
					{#each filtered() as entry (entry.id)}
						<tr
							class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer"
							onclick={() => { expandedId = expandedId === entry.id ? null : entry.id; }}
						>
							<td class="px-4 py-2.5">
								<span class="text-[11px] font-semibold px-2 py-0.5 rounded {actionColors[entry.action] || 'bg-gray-100 text-gray-600'}">
									{entry.action}
								</span>
							</td>
							<td class="px-4 py-2.5 text-sm text-gray-900 dark:text-white font-medium">
								{getLabel(entry)}
							</td>
							<td class="px-4 py-2.5">
								<span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
									{entry.table_name}
								</span>
							</td>
							<td class="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">
								{entry.changed_by || '-'}
							</td>
							<td class="px-4 py-2.5 text-sm text-gray-400" title={new Date(entry.changed_at).toLocaleString()}>
								{timeAgo(entry.changed_at)}
							</td>
						</tr>
						{#if expandedId === entry.id}
							<tr>
								<td colspan="5" class="px-4 py-3 bg-gray-50/50 dark:bg-gray-800/20">
									{#if entry.action === 'UPDATE' || entry.action === 'RESTORE'}
										{@const fields = getChangedFields(entry)}
										{#if fields.length > 0}
											<div class="space-y-1">
												{#each fields as f}
													<div class="text-xs">
														<span class="font-medium text-gray-500 dark:text-gray-400 w-28 inline-block">{f.field}:</span>
														<span class="text-red-400 line-through">{f.old || '(empty)'}</span>
														<span class="text-gray-400 mx-1">&rarr;</span>
														<span class="text-green-600 dark:text-green-400">{f.new || '(empty)'}</span>
													</div>
												{/each}
											</div>
										{:else}
											<p class="text-xs text-gray-400">No field changes recorded</p>
										{/if}
									{:else if entry.action === 'INSERT'}
										<div class="space-y-1">
											{#each Object.entries(entry.new_values || {}).filter(([k, v]) => v && !['id', 'created_at', 'updated_at'].includes(k)) as [key, val]}
												<div class="text-xs">
													<span class="font-medium text-gray-500 dark:text-gray-400 w-28 inline-block">{key}:</span>
													<span class="text-green-600 dark:text-green-400">{val}</span>
												</div>
											{/each}
										</div>
									{:else if entry.action === 'DELETE'}
										<p class="text-xs text-red-400">Deleted: {getLabel(entry)}</p>
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
		<div class="flex items-center justify-between mt-4 text-sm text-gray-500 dark:text-gray-400">
			<span>Showing {offset + 1}–{Math.min(offset + pageSize, total)} of {total}</span>
			<div class="flex gap-2">
				<button
					onclick={prevPage}
					disabled={offset === 0}
					class="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 cursor-pointer"
				>
					Prev
				</button>
				<button
					onclick={nextPage}
					disabled={offset + pageSize >= total}
					class="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 cursor-pointer"
				>
					Next
				</button>
			</div>
		</div>
	{/if}
</div>
