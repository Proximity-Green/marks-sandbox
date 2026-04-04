<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import SearchSelect from '$lib/SearchSelect.svelte';
	import { adminFullscreen, triggerActivityRefresh, openRecordId } from '$lib/stores';

	interface Item {
		id: string;
		source: string;
		name: string;
		description: string;
		item_code: string;
		gl_code: string;
		gl_name: string;
		price: number;
		tax_percentage: number;
		tax_code: string;
		location_name: string;
		product_type: string;
		tracking_codes: string[];
		prorata: boolean;
		created_at: string;
	}

	let items: Item[] = $state([]);
	let totalCount = $state(0);
	let loading = $state(true);
	let loadTimeMs = $state(0);

	// Search & sort
	let search = $state('');
	let sortCol = $state('name');
	let sortAsc = $state(true);

	// Pagination
	let pageSize = $state(50);
	let currentPage = $state(0);
	let totalPages = $derived(Math.ceil(totalCount / pageSize));

	// Accounts for GL dropdown
	let accounts: Array<{ code: string; name: string }> = $state([]);

	// Track which records have change history
	let editedIds = $state(new Set<string>());

	async function fetchEditedIds() {
		const { data } = await supabase
			.from('change_log')
			.select('record_id')
			.eq('table_name', 'items');
		editedIds = new Set((data || []).map((r: any) => r.record_id));
	}

	// Editing
	let editingId: string | null = $state(null);
	let editRow: Partial<Item> = $state({});
	let saving = $state(false);
	let deleteConfirm: string | null = $state(null);

	// Form modal
	let showForm = $state(false);
	let formItem: Partial<Item> = $state({});
	let formIsNew = $state(false);
	let formFullscreen = $state(false);
	let formOriginal: Partial<Item> = $state({});

	// User identity for audit
	function getUser(): string {
		let user = localStorage.getItem('admin_user');
		if (!user) {
			user = prompt('Enter your name for the audit log:') || 'unknown';
			localStorage.setItem('admin_user', user);
		}
		return user;
	}

	interface ChangeEntry {
		id: string;
		action: string;
		changed_by: string;
		old_values: Record<string, any> | null;
		new_values: Record<string, any> | null;
		changed_at: string;
	}
	let changeLog: ChangeEntry[] = $state([]);
	let changeLogId: string | null = $state(null);
	let showChangeLog = $state(false);

	async function fetchChangeLog(recordId: string) {
		changeLogId = recordId;
		const { data } = await supabase
			.from('change_log')
			.select('id,action,changed_by,old_values,new_values,changed_at')
			.eq('table_name', 'items')
			.eq('record_id', recordId)
			.order('changed_at', { ascending: false });
		changeLog = (data as ChangeEntry[]) || [];
		showChangeLog = true;
	}

	let restoreConfirmId: string | null = $state(null);

	async function restoreVersion(entry: ChangeEntry) {
		if (!changeLogId || !entry.old_values) return;
		const { id, created_at, updated_at, ...restoreData } = entry.old_values as any;
		restoreData.updated_at = new Date().toISOString();

		// Get current values before restore
		const { data: current } = await supabase.from('items').select('*').eq('id', changeLogId).single();

		const { error } = await supabase.from('items').update(restoreData).eq('id', changeLogId);
		if (error) { alert('Restore failed: ' + error.message); return; }

		// Log as RESTORE action with full before/after
		await supabase.from('change_log').insert({
			table_name: 'items',
			record_id: changeLogId,
			action: 'RESTORE',
			changed_by: getUser(),
			old_values: current,
			new_values: entry.old_values,
		});
		editedIds.add(changeLogId);
		editedIds = new Set(editedIds);
		restoreConfirmId = null;
		triggerActivityRefresh();

		// Refresh the change log to show the RESTORE entry
		await fetchChangeLog(changeLogId);
		await fetchItems();
	}

	async function logChange(action: string, recordId: string, oldValues: any, newValues: any) {
		await supabase.from('change_log').insert({
			table_name: 'items',
			record_id: recordId,
			action,
			changed_by: getUser(),
			old_values: oldValues,
			new_values: newValues,
		});
		editedIds.add(recordId);
		editedIds = new Set(editedIds);
		triggerActivityRefresh();
	}

	const columns = [
		{ key: 'item_code', label: 'Code', sortable: true },
		{ key: 'name', label: 'Name', sortable: true },
		{ key: 'gl_code', label: 'GL', sortable: true },
		{ key: 'price', label: 'Price', align: 'text-right', sortable: true },
		{ key: 'location_name', label: 'Location', sortable: true },
		{ key: 'product_type', label: 'Type', sortable: true },
		{ key: 'tracking_codes', label: 'Tracking', sortable: false },
	];

	function fmt(n: number): string {
		return n?.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '';
	}

	let fetchInProgress = false;
	async function fetchItems() {
		if (fetchInProgress) return;
		fetchInProgress = true;
		loading = true;
		const start = performance.now();

		try {
			const s = search.trim();
			const searchFilter = s ? `name.ilike.%${s}%,item_code.ilike.%${s}%,gl_code.ilike.%${s}%,location_name.ilike.%${s}%,product_type.ilike.%${s}%` : '';

			// Count
			let countQuery = supabase.from('items').select('*', { count: 'exact', head: true });
			if (searchFilter) countQuery = countQuery.or(searchFilter);
			const { count } = await countQuery;
			totalCount = count ?? 0;

			// Fetch page
			let query = supabase
				.from('items')
				.select('*')
				.order(sortCol, { ascending: sortAsc, nullsFirst: false })
				.range(currentPage * pageSize, (currentPage + 1) * pageSize - 1);

			if (searchFilter) query = query.or(searchFilter);

			const { data, error } = await query;
			if (error) console.error('Fetch error:', error);
			items = (data as Item[]) || [];
		} catch (e) {
			console.error('Fetch failed:', e);
			items = [];
		} finally {
			loadTimeMs = Math.round(performance.now() - start);
			loading = false;
			fetchInProgress = false;
		}
	}

	onMount(() => {
		fetchItems();
		fetchEditedIds();
		supabase.from('accounts').select('code,name').order('code').then(({ data }) => {
			accounts = (data as Array<{ code: string; name: string }>) || [];
		});
	});

	// Watch for openRecordId from sidebar clicks
	$effect(() => {
		const id = $openRecordId;
		if (id) {
			openRecordId.set(null);
			supabase.from('items').select('*').eq('id', id).single().then(({ data }) => {
				if (data) openForm(data as Item);
			});
		}
	});

	function handleSort(col: string) {
		const colDef = columns.find(c => c.key === col);
		if (!colDef?.sortable) return;
		if (sortCol === col) {
			sortAsc = !sortAsc;
		} else {
			sortCol = col;
			sortAsc = true;
		}
		currentPage = 0;
		fetchItems();
	}

	let searchTimeout: ReturnType<typeof setTimeout>;
	function handleSearch(e: Event) {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			currentPage = 0;
			fetchItems();
		}, 300);
	}

	function goPage(p: number) {
		currentPage = p;
		fetchItems();
	}

	// CSV export
	function downloadCsv() {
		const headers = ['item_code','name','description','gl_code','gl_name','price','tax_percentage','tax_code','location_name','product_type','tracking_codes','source','prorata'];
		const csvRows = [headers.join(',')];
		for (const item of items) {
			csvRows.push(headers.map(h => {
				let v = (item as any)[h];
				if (v === null || v === undefined) return '';
				if (Array.isArray(v)) v = v.join('; ');
				v = String(v).replace(/"/g, '""');
				return `"${v}"`;
			}).join(','));
		}
		const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `items-${new Date().toISOString().split('T')[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function openInSheets() {
		downloadCsv(); // Download first, user can open in Sheets
	}

	// Inline edit
	let editOriginal: Partial<Item> = $state({});
	function startEdit(item: Item) {
		editingId = item.id;
		editRow = { ...item };
		editOriginal = { ...item };
	}

	function cancelEdit() {
		editingId = null;
		editRow = {};
	}

	async function saveEdit() {
		if (!editingId) return;
		saving = true;
		const { error } = await supabase
			.from('items')
			.update({
				name: editRow.name,
				item_code: editRow.item_code,
				gl_code: editRow.gl_code,
				price: editRow.price,
				location_name: editRow.location_name,
				product_type: editRow.product_type,
			})
			.eq('id', editingId);

		if (error) {
			alert('Save failed: ' + error.message);
		} else {
			await logChange('UPDATE', editingId!, editOriginal, editRow);
			editingId = null;
			editRow = {};
			await fetchItems();
		}
		saving = false;
	}

	async function deleteItem(id: string) {
		const item = items.find(i => i.id === id);
		const { error } = await supabase.from('items').delete().eq('id', id);
		if (error) {
			alert('Delete failed: ' + error.message);
		} else {
			await logChange('DELETE', id, item, null);
			deleteConfirm = null;
			await fetchItems();
		}
	}

	// Form view
	function openForm(item?: Item) {
		if (item) {
			formItem = { ...item };
			formOriginal = { ...item };
			formIsNew = false;
		} else {
			formItem = { source: 'manual', tax_percentage: 0.15, tax_code: 'OUTPUT3', prorata: false };
			formOriginal = {};
			formIsNew = true;
		}
		showForm = true;
	}

	async function saveForm() {
		saving = true;
		if (formIsNew) {
			const { data, error } = await supabase.from('items').insert(formItem).select('id');
			if (error) { alert('Create failed: ' + error.message); saving = false; return; }
			if (data?.[0]?.id) await logChange('INSERT', data[0].id, null, formItem);
		} else {
			const { id, created_at, updated_at, ...updates } = formItem as any;
			updates.updated_at = new Date().toISOString();
			const { error } = await supabase.from('items').update(updates).eq('id', id);
			if (error) { alert('Update failed: ' + error.message); saving = false; return; }
			await logChange('UPDATE', id, formOriginal, formItem);
		}
		showForm = false;
		saving = false;
		await fetchItems();
	}

	const formFields = [
		{ key: 'location_name', label: 'Location', type: 'text', wide: true },
		{ key: 'item_code', label: 'Item Code', type: 'text', required: true },
		{ key: 'name', label: 'Name', type: 'text', required: true },
		{ key: 'description', label: 'Description', type: 'text' },
		{ key: 'gl_code', label: 'Account', type: 'account_select' },
		{ key: 'gl_description', label: 'GL Description', type: 'text' },
		{ key: 'price', label: 'Price', type: 'number' },
		{ key: 'tax_percentage', label: 'Tax %', type: 'number' },
		{ key: 'tax_code', label: 'Tax Code', type: 'text' },
		{ key: 'product_type', label: 'Product Type', type: 'text' },
		{ key: 'source', label: 'Source', type: 'text' },
		{ key: 'admin_link', label: 'Admin Link', type: 'text', wide: true },
		{ key: 'tracking_codes', label: 'Tracking Codes (JSON)', type: 'text', wide: true },
		{ key: 'prorata', label: 'Pro-rata', type: 'checkbox' },
		{ key: 'custom_price', label: 'Custom Price', type: 'checkbox' },
		{ key: 'price_customisable', label: 'Price Customisable', type: 'checkbox' },
	];
</script>

<!-- Form Modal -->
{#if showForm}
	<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 {formFullscreen ? '' : 'p-4'}">
		<div class="bg-white dark:bg-gray-900 shadow-xl flex flex-col {formFullscreen ? 'w-full h-full' : 'rounded-2xl max-w-2xl w-full max-h-[85vh]'}">
			<div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
				<h3 class="text-lg font-semibold text-gray-900 dark:text-white">{formIsNew ? 'New Item' : `Edit: ${formItem.name}`}</h3>
				<div class="flex items-center gap-2">
					<button onclick={() => (formFullscreen = !formFullscreen)} class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer" title={formFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
						{#if formFullscreen}
							<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /></svg>
						{:else}
							<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
						{/if}
					</button>
					<button onclick={() => (showForm = false)} class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer">
						<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
					</button>
				</div>
			</div>
			<div class="overflow-y-auto flex-1 px-6 py-4">
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{#each formFields as field}
						<div class="{field.wide ? 'sm:col-span-2' : ''}">
							{#if field.type === 'checkbox'}
								<label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
									<input type="checkbox" bind:checked={(formItem as any)[field.key]} class="rounded border-gray-300 dark:border-gray-600" />
									{field.label}
								</label>
							{:else if field.type === 'account_select'}
								<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{field.label}</label>
								<SearchSelect
									value={(formItem as any).gl_code ?? ''}
									onchange={(v) => {
										(formItem as any).gl_code = v;
										const acct = accounts.find(a => a.code === v);
										if (acct) (formItem as any).gl_name = acct.name;
									}}
									options={accounts.map(a => ({ value: a.code, label: `${a.code} - ${a.name}` }))}
									placeholder="Search accounts..."
								/>
							{:else}
								<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{field.label}{field.required ? ' *' : ''}</label>
								<input
									type={field.type}
									value={(formItem as any)[field.key] ?? ''}
									oninput={(e) => {
										const v = (e.target as HTMLInputElement).value;
										(formItem as any)[field.key] = field.type === 'number' ? (v === '' ? null : Number(v)) : v;
									}}
									class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
								/>
							{/if}
						</div>
					{/each}
				</div>
			</div>
			<div class="flex justify-between items-center px-6 py-4 border-t border-gray-200 dark:border-gray-700">
				<div class="flex items-center gap-3">
					{#if !formIsNew && formItem.created_at}
						<span class="text-xs text-gray-400">Created: {new Date(formItem.created_at).toLocaleDateString()}</span>
					{/if}
					{#if !formIsNew && formItem.id}
						<button onclick={() => fetchChangeLog(formItem.id!)} class="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-500 cursor-pointer">
							<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
							History
						</button>
					{/if}
				</div>
				<div class="flex gap-3">
					<button onclick={() => (showForm = false)} class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg cursor-pointer">Cancel</button>
					<button onclick={saveForm} disabled={saving} class="px-4 py-2 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-lg disabled:opacity-50 cursor-pointer">
						{saving ? 'Saving...' : formIsNew ? 'Create' : 'Save'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Change Log Modal -->
{#if showChangeLog}
	<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
		<div class="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
			<div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
				<h3 class="text-lg font-semibold text-gray-900 dark:text-white">Change History</h3>
				<button onclick={() => (showChangeLog = false)} class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer">
					<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>
			<div class="overflow-y-auto flex-1 px-6 py-4">
				{#if changeLog.length === 0}
					<p class="text-sm text-gray-400 text-center py-8">No changes recorded</p>
				{:else}
					<div class="space-y-4">
						{#each changeLog as entry}
							<div class="border-l-2 pl-4 {entry.action === 'DELETE' ? 'border-red-400' : entry.action === 'INSERT' ? 'border-green-400' : entry.action === 'RESTORE' ? 'border-orange-400' : 'border-brand-400'}">
								<div class="flex items-center gap-2 mb-1">
									<span class="text-xs font-medium px-1.5 py-0.5 rounded {entry.action === 'DELETE' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : entry.action === 'INSERT' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : entry.action === 'RESTORE' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'}">{entry.action}</span>
									<span class="text-xs text-gray-500 dark:text-gray-400">{entry.changed_by}</span>
									<span class="text-xs text-gray-400">{new Date(entry.changed_at).toLocaleString()}</span>
									{#if entry.action === 'UPDATE' && entry.old_values}
										{#if restoreConfirmId === entry.id}
											<span class="ml-auto flex items-center gap-1">
												<span class="text-xs text-gray-400">Restore this version?</span>
												<button onclick={() => restoreVersion(entry)} class="px-2 py-0.5 text-xs text-white bg-orange-500 hover:bg-orange-600 rounded cursor-pointer">Yes</button>
												<button onclick={() => (restoreConfirmId = null)} class="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer">No</button>
											</span>
										{:else}
											<button onclick={() => (restoreConfirmId = entry.id)} class="text-xs text-orange-500 hover:text-orange-700 dark:hover:text-orange-400 cursor-pointer ml-auto">Restore</button>
										{/if}
									{/if}
								</div>
								{#if (entry.action === 'UPDATE' || entry.action === 'RESTORE') && entry.old_values && entry.new_values}
									<div class="space-y-1">
										{#each Object.keys(entry.new_values).filter(f => JSON.stringify(entry.new_values?.[f]) !== JSON.stringify(entry.old_values?.[f])) as field}
											<div class="text-xs">
												<span class="text-gray-500 dark:text-gray-400 font-medium">{field}:</span>
												<span class="text-red-500 line-through mr-1">{entry.old_values[field] ?? 'null'}</span>
												<span class="text-green-600 dark:text-green-400">{entry.new_values[field] ?? 'null'}</span>
											</div>
										{/each}
									</div>
								{:else if entry.action === 'INSERT' && entry.new_values}
									<div class="space-y-1">
										{#each Object.entries(entry.new_values).filter(([,v]) => v != null && v !== '' && v !== false) as [k, v]}
											<div class="text-xs">
												<span class="text-gray-500 dark:text-gray-400 font-medium">{k}:</span>
												<span class="text-green-600 dark:text-green-400">{typeof v === 'object' ? JSON.stringify(v) : v}</span>
											</div>
										{/each}
									</div>
								{:else if entry.action === 'DELETE' && entry.old_values}
									<div class="text-xs text-gray-500 dark:text-gray-400">Deleted: {(entry.old_values as any).name || (entry.old_values as any).item_code || 'record'}</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Header -->
<div class="flex items-center justify-between mb-4">
	<div>
		<h1 class="text-xl font-bold text-gray-900 dark:text-white">Items</h1>
		<p class="text-sm text-gray-500 dark:text-gray-400">
			{totalCount.toLocaleString()} records
			{#if !loading}
				<span class="text-gray-400 dark:text-gray-500">({loadTimeMs}ms)</span>
			{/if}
		</p>
	</div>
	<div class="flex items-center gap-2">
		<button onclick={() => openForm()} class="px-3 py-2 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-lg cursor-pointer">+ New</button>
		<button onclick={downloadCsv} class="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg cursor-pointer">CSV</button>
		<button onclick={() => adminFullscreen.update(v => !v)} class="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg cursor-pointer" title="Toggle fullscreen">
			<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
		</button>
	</div>
</div>

<!-- Search -->
<div class="mb-4 relative">
	<input
		type="text"
		bind:value={search}
		oninput={handleSearch}
		placeholder="Search items..."
		class="w-full px-3 py-2 pr-8 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-gray-400"
	/>
	{#if search}
		<button
			onclick={() => { search = ''; currentPage = 0; fetchItems(); }}
			class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
		>
			<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
		</button>
	{/if}
</div>

<!-- Table -->
<div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
	{#if loading}
		<div class="px-6 py-12 text-center text-gray-400">
			<div class="w-6 h-6 border-2 border-gray-300 dark:border-gray-600 border-t-brand-500 rounded-full animate-spin mx-auto mb-2"></div>
			Loading...
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
					<tr>
						{#each columns as col}
							<th
								class="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider select-none {col.align || ''} {col.sortable ? 'cursor-pointer hover:text-gray-700 dark:hover:text-gray-200' : ''}"
								onclick={() => handleSort(col.key)}
							>
								<span class="inline-flex items-center gap-1">
									{col.label}
									{#if sortCol === col.key}
										<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											{#if sortAsc}
												<path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
											{:else}
												<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
											{/if}
										</svg>
									{/if}
								</span>
							</th>
						{/each}
						<th class="px-3 py-2.5 w-24"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100 dark:divide-gray-800">
					{#each items as item (item.id)}
						{#if editingId === item.id}
							<!-- Inline edit row -->
							<tr class="bg-brand-50/30 dark:bg-brand-900/10">
								<td class="px-3 py-2"><input type="text" bind:value={editRow.item_code} class="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded" /></td>
								<td class="px-3 py-2"><input type="text" bind:value={editRow.name} class="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded" /></td>
								<td class="px-3 py-2"><input type="text" bind:value={editRow.gl_code} class="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded" /></td>
								<td class="px-3 py-2"><input type="number" bind:value={editRow.price} class="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded text-right" /></td>
								<td class="px-3 py-2"><input type="text" bind:value={editRow.location_name} class="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded" /></td>
								<td class="px-3 py-2"><input type="text" bind:value={editRow.product_type} class="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded" /></td>
								<td class="px-3 py-2 text-xs text-gray-400">{item.tracking_codes?.join(', ') || ''}</td>
								<td class="px-3 py-2">
									<div class="flex items-center gap-1">
										<button onclick={saveEdit} disabled={saving} class="px-2 py-1 text-xs text-white bg-green-600 hover:bg-green-700 rounded cursor-pointer disabled:opacity-50">{saving ? '...' : 'Save'}</button>
										<button onclick={cancelEdit} class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer">Cancel</button>
									</div>
								</td>
							</tr>
						{:else}
							<!-- Normal row -->
							<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
								<td class="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono text-xs">{item.item_code}</td>
								<td class="px-3 py-2 text-gray-900 dark:text-white font-medium">
									<button onclick={() => openForm(item)} class="hover:text-brand-600 dark:hover:text-brand-400 cursor-pointer text-left">{item.name}</button>
								</td>
								<td class="px-3 py-2 text-gray-500 dark:text-gray-400">{item.gl_code || ''}</td>
								<td class="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{item.price ? fmt(item.price) : ''}</td>
								<td class="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{item.location_name || ''}</td>
								<td class="px-3 py-2 text-gray-400 text-xs">{item.product_type || ''}</td>
								<td class="px-3 py-2 text-xs text-brand-500 dark:text-brand-400">{item.tracking_codes?.join(', ') || ''}</td>
								<td class="px-3 py-2">
									<div class="flex items-center gap-1">
										<button
											onclick={() => fetchChangeLog(item.id)}
											class="px-1 py-1 cursor-pointer transition-opacity {editedIds.has(item.id) ? 'text-brand-500 opacity-100' : 'text-gray-400 hover:text-brand-500 opacity-0 group-hover:opacity-100'}"
											title="Change history"
										>
											<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
										</button>
										<span class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
										<button onclick={() => startEdit(item)} class="px-2 py-1 text-xs text-gray-500 hover:text-brand-600 cursor-pointer">Edit</button>
										{#if deleteConfirm === item.id}
											<button onclick={() => deleteItem(item.id)} class="px-2 py-1 text-xs text-white bg-red-600 rounded cursor-pointer">Confirm</button>
											<button onclick={() => (deleteConfirm = null)} class="px-2 py-1 text-xs text-gray-500 cursor-pointer">No</button>
										{:else}
											<button onclick={() => (deleteConfirm = item.id)} class="px-2 py-1 text-xs text-gray-400 hover:text-red-500 cursor-pointer">Del</button>
										{/if}
									</span>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
		<div class="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
			<div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
				<span>Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, totalCount)} of {totalCount.toLocaleString()}</span>
				<select bind:value={pageSize} onchange={() => { currentPage = 0; fetchItems(); }} class="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded cursor-pointer">
					<option value={25}>25</option>
					<option value={50}>50</option>
					<option value={100}>100</option>
					<option value={250}>250</option>
				</select>
				<span class="text-xs">per page</span>
			</div>
			<div class="flex items-center gap-1">
				<button onclick={() => goPage(0)} disabled={currentPage === 0} class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-30 cursor-pointer">First</button>
				<button onclick={() => goPage(currentPage - 1)} disabled={currentPage === 0} class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-30 cursor-pointer">Prev</button>
				<span class="px-2 py-1 text-xs text-gray-700 dark:text-gray-300">{currentPage + 1} / {totalPages}</span>
				<button onclick={() => goPage(currentPage + 1)} disabled={currentPage >= totalPages - 1} class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-30 cursor-pointer">Next</button>
				<button onclick={() => goPage(totalPages - 1)} disabled={currentPage >= totalPages - 1} class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-30 cursor-pointer">Last</button>
			</div>
		</div>
	{/if}
</div>
