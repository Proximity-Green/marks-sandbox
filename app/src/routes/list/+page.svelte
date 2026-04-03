<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores';
	import { goto } from '$app/navigation';
	import { listDocuments, downloadPdf } from '$lib/api';

	type TabType = 'invoices' | 'quotes' | 'purchaseorders';

	let activeTab: TabType = $state('invoices');
	let items: Array<Record<string, unknown>> = $state([]);
	let loading = $state(true);
	let error = $state('');

	const tabs: Array<{ value: TabType; label: string }> = [
		{ value: 'invoices', label: 'Invoices' },
		{ value: 'quotes', label: 'Quotes' },
		{ value: 'purchaseorders', label: 'Purchase Orders' }
	];

	onMount(() => {
		const unsub = auth.subscribe((state) => {
			if (!state.loading && !state.authenticated) {
				goto('/');
			}
		});

		loadDocuments();
		return unsub;
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

	function getTotal(item: Record<string, unknown>): string {
		const total = (item.total as number) ?? (item.subTotal as number) ?? 0;
		const currency = (item.currencyCode as string) || 'ZAR';
		return `${currency} ${total.toFixed(2)}`;
	}

	function getStatus(item: Record<string, unknown>): string {
		return ((item.status as string) || 'UNKNOWN').toUpperCase();
	}

	function getStatusClasses(status: string): string {
		const s = status.toUpperCase();
		if (['PAID', 'ACCEPTED', 'BILLED'].includes(s))
			return 'bg-green-50 text-green-700 border border-green-200';
		if (['DRAFT', 'PENDING'].includes(s))
			return 'bg-gray-50 text-gray-600 border border-gray-200';
		if (['SENT', 'SUBMITTED', 'AUTHORISED'].includes(s))
			return 'bg-blue-50 text-blue-700 border border-blue-200';
		if (['VOIDED', 'DELETED', 'DECLINED'].includes(s))
			return 'bg-red-50 text-red-600 border border-red-200';
		if (['OVERDUE'].includes(s))
			return 'bg-amber-50 text-amber-700 border border-amber-200';
		return 'bg-gray-50 text-gray-600 border border-gray-200';
	}

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
			const blob = await downloadPdf(activeTab, getDocId(item));
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
			<h1 class="text-2xl font-bold text-gray-900 mb-1">Documents</h1>
			<p class="text-gray-500">View and manage your Xero documents.</p>
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
	<div class="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6">
		{#each tabs as tab}
			<button
				onclick={() => switchTab(tab.value)}
				class="px-5 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer {activeTab === tab.value
					? 'bg-white text-gray-900 shadow-sm'
					: 'text-gray-600 hover:text-gray-900'}"
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- Table -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
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
		{:else if items.length === 0}
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
				<table class="w-full text-sm">
					<thead>
						<tr class="text-left text-xs font-medium text-gray-500 uppercase tracking-wide bg-gray-50/80">
							<th class="px-5 py-3">Number</th>
							<th class="px-5 py-3">Contact</th>
							<th class="px-5 py-3">Date</th>
							<th class="px-5 py-3 text-right">Total</th>
							<th class="px-5 py-3">Status</th>
							<th class="px-5 py-3 text-right">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100">
						{#each items as item}
							<tr class="hover:bg-gray-50/50 transition-colors">
								<td class="px-5 py-3.5 font-medium text-gray-900">{getDocNumber(item)}</td>
								<td class="px-5 py-3.5 text-gray-600">{getContact(item)}</td>
								<td class="px-5 py-3.5 text-gray-600">{getDate(item)}</td>
								<td class="px-5 py-3.5 text-gray-900 font-medium text-right">{getTotal(item)}</td>
								<td class="px-5 py-3.5">
									<span class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium {getStatusClasses(getStatus(item))}">
										{getStatus(item)}
									</span>
								</td>
								<td class="px-5 py-3.5">
									<div class="flex items-center justify-end gap-1">
										<button
											onclick={() => openInXero(item)}
											class="p-1.5 text-gray-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors cursor-pointer"
											title="Open in Xero"
										>
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
											</svg>
										</button>
										<button
											onclick={() => handleDownloadPdf(item)}
											class="p-1.5 text-gray-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors cursor-pointer"
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
