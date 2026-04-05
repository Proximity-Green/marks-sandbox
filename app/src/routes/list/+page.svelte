<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores';
	import { listDocuments, downloadPdf } from '$lib/api';

	type TabType = 'invoices' | 'quotes' | 'purchaseorders';

	let activeTab: TabType = $state('invoices');
	let items: Array<Record<string, unknown>> = $state([]);
	let loading = $state(true);
	let error = $state('');
	let search = $state('');
	let sortCol: 'number' | 'contact' | 'date' | 'modified' | 'total' | 'status' = $state('modified');
	let sortDir: 'asc' | 'desc' = $state('desc');

	const tabs: Array<{ value: TabType; label: string }> = [
		{ value: 'invoices', label: 'Invoices' },
		{ value: 'quotes', label: 'Quotes' },
		{ value: 'purchaseorders', label: 'Purchase Orders' }
	];

	onMount(() => {
		loadDocuments();
	});

	async function loadDocuments() {
		loading = true;
		error = '';
		try {
			const result = await listDocuments(activeTab);
			items = result.items || [];
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load documents.';
			items = [];
		} finally {
			loading = false;
		}
	}

	function switchTab(tab: TabType) {
		activeTab = tab;
		search = '';
		loadDocuments();
	}

	function getDocNumber(item: Record<string, unknown>): string {
		return (
			(item.invoiceNumber as string) ||
			(item.quoteNumber as string) ||
			(item.purchaseOrderNumber as string) ||
			(item.number as string) ||
			'--'
		);
	}

	function getDocId(item: Record<string, unknown>): string {
		return (
			(item.invoiceID as string) ||
			(item.quoteID as string) ||
			(item.purchaseOrderID as string) ||
			(item.id as string) ||
			''
		);
	}

	function getContact(item: Record<string, unknown>): string {
		if (typeof item.contact === 'string') return item.contact || '--';
		const contact = item.contact as Record<string, unknown> | undefined;
		return (contact?.name as string) || '--';
	}

	function getDate(item: Record<string, unknown>): string {
		const dateStr = (item.date as string) || (item.dateString as string) || '';
		if (!dateStr) return '--';
		try {
			// Handle Xero date format /Date(timestamp)/
			const match = dateStr.match(/\/Date\((\d+)\+/);
			if (match) {
				return new Date(parseInt(match[1])).toLocaleDateString('en-ZA');
			}
			return new Date(dateStr).toLocaleDateString('en-ZA');
		} catch {
			return dateStr;
		}
	}

	function fmtAmount(n: number): string {
		const parts = n.toFixed(2).split('.');
		parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
		return parts.join(',');
	}

	function getTotal(item: Record<string, unknown>): string {
		const total = (item.total as number) ?? (item.subTotal as number) ?? 0;
		const currency = (item.currency as string) || (item.currencyCode as string) || 'ZAR';
		return `${currency} ${fmtAmount(total)}`;
	}

	function getUpdatedDate(item: Record<string, unknown>): string {
		const dateStr = (item.updatedDateUTC as string) || '';
		if (!dateStr) return '--';
		try {
			let d: Date;
			const match = dateStr.match(/\/Date\((\d+)[+)]/);
			if (match) d = new Date(parseInt(match[1]));
			else d = new Date(dateStr);
			if (isNaN(d.getTime())) return dateStr || '--';
			const datePart = d.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' });
			const timePart = d.toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false });
			return `${datePart} ${timePart}`;
		} catch { return dateStr; }
	}

	function getRawUpdatedDate(item: Record<string, unknown>): number {
		const dateStr = (item.updatedDateUTC as string) || '';
		if (!dateStr) return 0;
		const match = dateStr.match(/\/Date\((\d+)\+/);
		if (match) return parseInt(match[1]);
		return new Date(dateStr).getTime() || 0;
	}

	function getStatus(item: Record<string, unknown>): string {
		return ((item.status as string) || 'UNKNOWN').toUpperCase();
	}

	function getStatusClasses(status: string): string {
		const s = status.toUpperCase();
		if (['PAID', 'ACCEPTED', 'BILLED'].includes(s))
			return 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800';
		if (['DRAFT', 'PENDING'].includes(s))
			return 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700';
		if (['SENT', 'SUBMITTED', 'AUTHORISED'].includes(s))
			return 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800';
		if (['VOIDED', 'DELETED', 'DECLINED'].includes(s))
			return 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800';
		if (['OVERDUE'].includes(s))
			return 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800';
		return 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700';
	}

	function getRawDate(item: Record<string, unknown>): number {
		const dateStr = (item.date as string) || (item.dateString as string) || '';
		if (!dateStr) return 0;
		const match = dateStr.match(/\/Date\((\d+)\+/);
		if (match) return parseInt(match[1]);
		return new Date(dateStr).getTime() || 0;
	}

	function getRawTotal(item: Record<string, unknown>): number {
		return (item.total as number) ?? (item.subTotal as number) ?? 0;
	}

	function getSortValue(item: Record<string, unknown>, col: typeof sortCol): string | number {
		if (col === 'number') return getDocNumber(item).toLowerCase();
		if (col === 'contact') return getContact(item).toLowerCase();
		if (col === 'date') return getRawDate(item);
		if (col === 'modified') return getRawUpdatedDate(item);
		if (col === 'total') return getRawTotal(item);
		if (col === 'status') return getStatus(item);
		return '';
	}

	function toggleSort(col: typeof sortCol) {
		if (sortCol === col) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortCol = col;
			sortDir = col === 'date' || col === 'modified' || col === 'total' ? 'desc' : 'asc';
		}
	}

	let filteredItems = $derived.by(() => {
		let result = items;
		if (search.trim()) {
			const q = search.trim().toLowerCase();
			result = result.filter((item) =>
				getDocNumber(item).toLowerCase().includes(q) ||
				getContact(item).toLowerCase().includes(q) ||
				getDate(item).includes(q) ||
				getUpdatedDate(item).includes(q) ||
				getTotal(item).toLowerCase().includes(q) ||
				getStatus(item).toLowerCase().includes(q)
			);
		}
		return [...result].sort((a, b) => {
			const av = getSortValue(a, sortCol);
			const bv = getSortValue(b, sortCol);
			let cmp = 0;
			if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
			else cmp = String(av).localeCompare(String(bv));
			return sortDir === 'asc' ? cmp : -cmp;
		});
	});

	function openInXero(item: Record<string, unknown>) {
		const orgInfo = $auth.org;
		if (!orgInfo?.shortCode) return;
		const id = getDocId(item);
		const typeMap: Record<string, string> = {
			invoices: 'AccountsReceivable/View.aspx?InvoiceID=',
			quotes: 'Quotes/View.aspx?QuoteID=',
			purchaseorders: 'AccountsPayable/ViewPurchaseOrder.aspx?PurchaseOrderID='
		};
		const path = typeMap[activeTab] || '';
		window.open(
			`https://go.xero.com/organisationlogin/default.aspx?shortcode=${orgInfo.shortCode}&redirecturl=/${path}${id}`,
			'_blank'
		);
	}

	async function handleDownloadPdf(item: Record<string, unknown>) {
		try {
			const typeMap: Record<string, string> = { invoices: 'invoice', quotes: 'quote', purchaseorders: 'po' };
			const blob = await downloadPdf(typeMap[activeTab] || activeTab, getDocId(item));
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${getDocNumber(item)}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e: unknown) {
			alert(e instanceof Error ? e.message : 'Failed to download PDF.');
		}
	}
</script>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-1">Documents</h1>
			<p class="text-gray-500 dark:text-gray-400">View and manage your Xero documents.</p>
		</div>
		<a
			href="/create"
			class="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
		>
			<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
			</svg>
			New Document
		</a>
	</div>

	<!-- Tabs -->
	<div class="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit mb-6">
		{#each tabs as tab}
			<button
				onclick={() => switchTab(tab.value)}
				class="px-5 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer {activeTab === tab.value
					? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
					: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}"
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- Search -->
	<div class="mb-4">
		<div class="relative max-w-sm">
			<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
			<input
				type="text"
				bind:value={search}
				placeholder="Search by number, contact, status..."
				class="w-full pl-10 pr-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500"
			/>
		</div>
	</div>

	<!-- Table -->
	<div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
		{#if loading}
			<div class="flex flex-col items-center justify-center py-20 gap-3">
				<div class="w-8 h-8 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
				<p class="text-sm text-gray-500">Loading documents...</p>
			</div>
		{:else if error}
			<div class="flex flex-col items-center justify-center py-20 gap-3">
				<div class="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
					<svg class="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
					</svg>
				</div>
				<p class="text-sm text-red-600">{error}</p>
				<button onclick={loadDocuments} class="text-sm text-brand-600 hover:text-brand-700 font-medium cursor-pointer">
					Try again
				</button>
			</div>
		{:else if filteredItems.length === 0}
			<div class="flex flex-col items-center justify-center py-20 gap-3">
				<div class="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
					<svg class="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
					</svg>
				</div>
				<p class="text-sm text-gray-500">No documents found.</p>
				<a href="/create" class="text-sm text-brand-600 hover:text-brand-700 font-medium">
					Create your first document
				</a>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm min-w-[900px]">
					<thead>
						<tr class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide bg-gray-50/80 dark:bg-gray-800/80">
							{#each [
								{ col: 'number', label: 'Number', align: '' },
								{ col: 'contact', label: 'Contact', align: '' },
								{ col: 'date', label: 'Date', align: '' },
								{ col: 'modified', label: 'Modified', align: '' },
								{ col: 'total', label: 'Total', align: 'text-right' },
								{ col: 'status', label: 'Status', align: '' }
							] as header}
								<th
									class="px-5 py-3 {header.align} cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none transition-colors"
									onclick={() => toggleSort(header.col as typeof sortCol)}
								>
									<span class="inline-flex items-center gap-1">
										{header.label}
										{#if sortCol === header.col}
											<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
												{#if sortDir === 'asc'}
													<path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
												{:else}
													<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
												{/if}
											</svg>
										{/if}
									</span>
								</th>
							{/each}
							<th class="px-5 py-3 text-right">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100 dark:divide-gray-800">
						{#each filteredItems as item}
							<tr class="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
								<td class="px-5 py-3.5 font-medium text-gray-900 dark:text-white">{getDocNumber(item)}</td>
								<td class="px-5 py-3.5 text-gray-600 dark:text-gray-300">{getContact(item)}</td>
								<td class="px-5 py-3.5 text-gray-600 dark:text-gray-300">{getDate(item)}</td>
								<td class="px-5 py-3.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{getUpdatedDate(item)}</td>
								<td class="px-5 py-3.5 text-gray-900 dark:text-white font-medium text-right">{getTotal(item)}</td>
								<td class="px-5 py-3.5">
									<span class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium {getStatusClasses(getStatus(item))}">
										{getStatus(item)}
									</span>
								</td>
								<td class="px-5 py-3.5">
									<div class="flex items-center justify-end gap-1">
										<button
											onclick={() => openInXero(item)}
											class="p-1.5 text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors cursor-pointer"
											title="Open in Xero"
										>
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
											</svg>
										</button>
										<button
											onclick={() => handleDownloadPdf(item)}
											class="p-1.5 text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors cursor-pointer"
											title="Download PDF"
										>
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
											</svg>
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
