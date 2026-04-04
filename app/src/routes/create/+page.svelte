<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores';
	import { goto } from '$app/navigation';
	import {
		getCurrencies,
		getTracking,
		getAccounts,
		getItems,
		createDocument,
		downloadPdf,
		sendEmail,
		sendCustomEmail
	} from '$lib/api';
	import type { CatalogItem } from '$lib/api';
	import SearchSelect from '$lib/SearchSelect.svelte';

	// Types
	type DocType = 'invoice' | 'quote' | 'purchaseorder';

	interface Account {
		code: string;
		name: string;
		type: string;
	}

	interface LineItem {
		id: number;
		description: string;
		accountCode: string;
		tracking: Record<string, string>; // categoryId -> optionId
		quantity: number;
		unitPrice: number;
		_catalogItem?: string;    // transient: selected catalog item_code
	}

	interface TrackingCategory {
		id: string;
		name: string;
		options: Array<{ id: string; name: string }>;
	}

	// State
	let docType: DocType = $state('invoice');
	let contactName = $state('');
	let contactEmail = $state('');
	let docDate = $state(new Date().toISOString().split('T')[0]);
	let dueDate = $state('');
	let reference = $state('');
	let currency = $state('ZAR');
	let currencies: Array<{ code: string; description: string }> = $state([]);
	let trackingCategories: TrackingCategory[] = $state([]);
	let accounts: Account[] = $state([]);
	let catalogItems: CatalogItem[] = $state([]);

	// Get the selected tracking option name for a line item (used to filter catalog items)
	function getSelectedLocationCode(item: LineItem): string {
		for (const cat of trackingCategories) {
			const optId = item.tracking[cat.id];
			if (optId) {
				const opt = cat.options.find(o => o.id === optId);
				if (opt) return opt.name;
			}
		}
		return '';
	}

	// Filter catalog items by tracking code
	// Matches exact code OR base prefix (e.g. "KL-JV2" matches items with "KL")
	function itemsForLocation(trackingCode: string): CatalogItem[] {
		if (!trackingCode) return [];
		const base = trackingCode.split('-')[0]; // "KL-JV2" -> "KL"
		return catalogItems.filter(ci =>
			ci.tracking_codes?.some(tc => tc === trackingCode || tc === base || trackingCode === tc)
		);
	}
	let nextId = $state(2);

	let lineItems: LineItem[] = $state([
		{ id: 1, description: '', accountCode: '2000', tracking: {}, quantity: 1, unitPrice: 0 }
	]);

	let submitting = $state(false);
	let submitError = $state('');
	let createdDoc: Record<string, unknown> | null = $state(null);
	let createdDocType: DocType = $state('invoice');
	let actionLoading = $state('');
	let actionMessage = $state('');

	// Email modal
	let expandedLine: number | null = $state(null);
	let dragIndex: number | null = $state(null);
	let dragOverIndex: number | null = $state(null);
	let isDragging = $state(false);
	let showEmailModal = $state(false);
	let showItemModal = $state(false);
	let itemModalLocation = $state('');
	let itemModalLineIndex = $state(-1);
	let emailTo = $state('');
	let emailSubject = $state('');
	let emailBody = $state('');

	function fmt(n: number): string {
		return n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	// Totals - simple state updated on every change
	let subtotal = $state(0);
	let tax = $state(0);
	let total = $state(0);

	function recalc() {
		// Use setTimeout to ensure bind:value has updated first
		setTimeout(() => {
			let s = 0;
			for (const item of lineItems) {
				s += Number(item.quantity || 0) * Number(item.unitPrice || 0);
			}
			subtotal = s;
			tax = s * 0.15;
			total = s + s * 0.15;
		}, 0);
	}

	const RANDOM_NAMES = ['Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Ltd', 'Stark Industries', 'Wayne Enterprises', 'Oscorp', 'Cyberdyne Systems'];
	const RANDOM_ITEMS = ['Web Development', 'Consulting', 'Design Services', 'Server Hosting', 'SEO Audit', 'Logo Design', 'App Development', 'Data Migration', 'Training Workshop', 'Support Package'];

	function randomPick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
	function randomInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }

	function fillRandomData() {
		const name = randomPick(RANDOM_NAMES);
		const prefix = docType === 'invoice' ? 'INV' : docType === 'quote' ? 'QU' : 'PO';
		contactName = name;
		contactEmail = name.toLowerCase().replace(/\s+/g, '.') + '@example.com';
		reference = prefix + '-' + randomInt(1000, 9999);
		const numLines = randomInt(1, 4);
		const usedItems = new Set<string>();
		const newLines: LineItem[] = [];
		for (let i = 0; i < numLines; i++) {
			let desc: string;
			do { desc = randomPick(RANDOM_ITEMS); } while (usedItems.has(desc));
			usedItems.add(desc);
			const revenueAccounts = accounts.filter(a => a.type === 'REVENUE');
			const defaultCode = revenueAccounts.length > 0 ? randomPick(revenueAccounts).code : (accounts.length > 0 ? accounts[0].code : '2000');
			// Randomly assign tracking options
			const tracking: Record<string, string> = {};
			for (const cat of trackingCategories) {
				if (cat.options.length > 0 && Math.random() > 0.3) {
					tracking[cat.id] = randomPick(cat.options).id;
				}
			}
			newLines.push({ id: nextId++, description: desc, accountCode: defaultCode, tracking, quantity: randomInt(1, 10), unitPrice: randomInt(50, 500) });
		}
		lineItems = newLines;
		recalc();
	}

	function getTrackingLabels(tracking: Record<string, string>): string {
		const labels: string[] = [];
		for (const cat of trackingCategories) {
			const optId = tracking[cat.id];
			if (optId) {
				const opt = cat.options.find(o => o.id === optId);
				if (opt) labels.push(opt.name);
			}
		}
		return labels.join(', ');
	}

	let docTypeLabel = $derived(
		docType === 'invoice' ? 'Invoice' : docType === 'quote' ? 'Quote' : 'Purchase Order'
	);

	onMount(async () => {
		const unsub = auth.subscribe((state) => {
			if (!state.loading && !state.authenticated) {
				goto('/');
			}
		});

		// Set default due date to 30 days from now
		const due = new Date();
		due.setDate(due.getDate() + 30);
		dueDate = due.toISOString().split('T')[0];

		// Load form data independently so one failure doesn't block others
		getCurrencies().then(r => currencies = r.currencies || []).catch(e => console.error('Failed to load currencies:', e));
		getTracking().then(r => trackingCategories = r.categories || []).catch(e => console.error('Failed to load tracking:', e));
		getAccounts().then(r => accounts = r.accounts || []).catch(e => console.error('Failed to load accounts:', e));
		getItems().then(r => catalogItems = r).catch(e => console.error('Failed to load items:', e));

		return unsub;
	});

	function addLineItem() {
		const newId = nextId++;
		lineItems = [...lineItems, {
			id: newId,
			description: '',
			accountCode: '',
			tracking: {},
			quantity: 1,
			unitPrice: 0
		}];
		expandedLine = newId;
	}

	function removeLineItem(index: number) {
		if (lineItems.length > 1) {
			lineItems = lineItems.filter((_, i) => i !== index);
			recalc();
		}
	}

	function moveLineItem(index: number, direction: -1 | 1) {
		const newIndex = index + direction;
		if (newIndex < 0 || newIndex >= lineItems.length) return;
		const newItems = [...lineItems];
		[newItems[index], newItems[newIndex]] = [newItems[newIndex], newItems[index]];
		lineItems = newItems;
	}

	// Drag and drop
	function handleDragStart(e: DragEvent, index: number) {
		dragIndex = index;
		isDragging = true;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		}
	}

	function handleDragOver(e: DragEvent, index: number) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dragOverIndex = index;
	}

	function handleDrop(e: DragEvent, index: number) {
		e.preventDefault();
		if (dragIndex !== null && dragIndex !== index) {
			const newItems = [...lineItems];
			const [moved] = newItems.splice(dragIndex, 1);
			newItems.splice(index, 0, moved);
			lineItems = newItems;
		}
		dragIndex = null;
		dragOverIndex = null;
		isDragging = false;
	}

	function handleDragEnd() {
		dragIndex = null;
		dragOverIndex = null;
		isDragging = false;
	}

	async function handleSubmit() {
		if (!contactName.trim()) {
			submitError = 'Contact name is required.';
			return;
		}
		if (lineItems.every((li) => !li.description.trim())) {
			submitError = 'At least one line item with a description is required.';
			return;
		}

		submitting = true;
		submitError = '';

		const payload: Record<string, unknown> = {
			docType: docType === 'purchaseorder' ? 'po' : docType,
			contact: { name: contactName.trim(), email: contactEmail.trim() || undefined },
			date: docDate,
			dueDate: dueDate || undefined,
			reference: reference.trim() || undefined,
			currencyCode: currency,
			lineItems: lineItems
				.filter((li) => li.description.trim())
				.map((li) => {
					const item: Record<string, unknown> = {
						description: li.description.trim(),
						quantity: li.quantity,
						unitAmount: li.unitPrice,
						accountCode: li.accountCode.trim() || undefined
					};

					const trackingEntries = Object.entries(li.tracking || {}).filter(([, optId]) => optId);
					if (trackingEntries.length > 0) {
						item.tracking = trackingEntries.map(([catId, optId]) => ({ categoryId: catId, optionId: optId }));
					}

					return item;
				})
		};

		try {
			const result = await createDocument(payload);
			createdDoc = result;
			createdDocType = docType;
		} catch (e: unknown) {
			submitError = e instanceof Error ? e.message : 'Failed to create document.';
		} finally {
			submitting = false;
		}
	}

	function getDocId(): string {
		if (!createdDoc) return '';
		// The API may return different structures
		const doc = createdDoc as Record<string, unknown>;
		return (
			(doc.invoiceID as string) ||
			(doc.quoteID as string) ||
			(doc.purchaseOrderID as string) ||
			(doc.id as string) ||
			''
		);
	}

	function getDocNumber(): string {
		if (!createdDoc) return '';
		const doc = createdDoc as Record<string, unknown>;
		return (
			(doc.invoiceNumber as string) ||
			(doc.quoteNumber as string) ||
			(doc.purchaseOrderNumber as string) ||
			(doc.number as string) ||
			''
		);
	}

	function getXeroType(): string {
		if (createdDocType === 'invoice') return 'invoice';
		if (createdDocType === 'quote') return 'quote';
		return 'po';
	}

	async function handleDownloadPdf() {
		actionLoading = 'pdf';
		actionMessage = '';
		try {
			const blob = await downloadPdf(getXeroType(), getDocId());
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${docTypeLabel}-${getDocNumber() || getDocId()}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
			actionMessage = 'PDF downloaded successfully.';
		} catch (e: unknown) {
			actionMessage = e instanceof Error ? e.message : 'Failed to download PDF.';
		} finally {
			actionLoading = '';
		}
	}

	async function handleSendViaXero() {
		actionLoading = 'send';
		actionMessage = '';
		try {
			await sendEmail(getXeroType(), getDocId());
			actionMessage = 'Email sent via Xero successfully.';
		} catch (e: unknown) {
			actionMessage = e instanceof Error ? e.message : 'Failed to send email.';
		} finally {
			actionLoading = '';
		}
	}

	function openInXero() {
		const orgInfo = $auth.org;
		if (!orgInfo?.shortCode) return;
		const typeMap: Record<string, string> = {
			invoice: 'invoicing/view',
			quote: 'quotes/view',
			po: 'purchase-orders/edit'
		};
		const path = typeMap[getXeroType()] || 'invoicing/view';
		window.open(`https://go.xero.com/app/${orgInfo.shortCode}/${path}/${getDocId()}`, '_blank');
	}

	function openEmailModal() {
		emailTo = contactEmail;
		emailSubject = `${docTypeLabel} ${getDocNumber()} from ${$auth.org?.orgName || ''}`;
		emailBody = `Hi ${contactName},\n\nPlease find attached ${docTypeLabel.toLowerCase()} ${getDocNumber()}.\n\nKind regards`;
		showEmailModal = true;
	}

	async function handleSendCustomEmail() {
		actionLoading = 'email';
		actionMessage = '';
		try {
			await sendCustomEmail({
				type: getXeroType(),
				id: getDocId(),
				to: emailTo,
				subject: emailSubject,
				body: emailBody
			});
			showEmailModal = false;
			actionMessage = `Email sent to ${emailTo} successfully.`;
		} catch (e: unknown) {
			actionMessage = e instanceof Error ? e.message : 'Failed to send email.';
		} finally {
			actionLoading = '';
		}
	}

	function resetForm() {
		createdDoc = null;
		contactName = '';
		contactEmail = '';
		reference = '';
		lineItems = [{ id: nextId++, description: '', accountCode: '2000', tracking: {}, quantity: 1, unitPrice: 0 }];
		submitError = '';
		actionMessage = '';
	}
</script>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	{#if showEmailModal}
			<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
				<div class="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-lg w-full p-6">
					<div class="flex items-center justify-between mb-6">
						<h3 class="text-lg font-semibold text-gray-900 dark:text-white">Send PDF via Email</h3>
						<button onclick={() => (showEmailModal = false)} class="text-gray-400 hover:text-gray-600 cursor-pointer">
							<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>

					<div class="space-y-4">
						<div>
							<label for="email-to" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To</label>
							<input id="email-to" type="email" bind:value={emailTo} class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
						</div>
						<div>
							<label for="email-subject" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject</label>
							<input id="email-subject" type="text" bind:value={emailSubject} class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
						</div>
						<div>
							<label for="email-body" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Message</label>
							<textarea id="email-body" bind:value={emailBody} rows="5" class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"></textarea>
						</div>
					</div>

					<div class="flex justify-end gap-3 mt-6">
						<button onclick={() => (showEmailModal = false)} class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg cursor-pointer">
							Cancel
						</button>
						<button
							onclick={handleSendCustomEmail}
							disabled={actionLoading === 'email' || !emailTo}
							class="px-4 py-2 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-lg disabled:opacity-50 cursor-pointer"
						>
							{#if actionLoading === 'email'}
								Sending...
							{:else}
								Send Email
							{/if}
						</button>
					</div>
				</div>
			</div>
		{/if}
		{#if showItemModal}
			<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
				<div class="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col">
					<div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
						<h3 class="text-lg font-semibold text-gray-900 dark:text-white">Items — {itemModalLocation}</h3>
						<button onclick={() => (showItemModal = false)} class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer">
							<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					<div class="overflow-y-auto flex-1 px-6 py-4">
						<table class="w-full text-sm">
							<thead class="text-xs text-gray-500 dark:text-gray-400 uppercase border-b border-gray-200 dark:border-gray-700">
								<tr>
									<th class="text-left py-2 pr-3">Name</th>
									<th class="text-left py-2 pr-3">Code</th>
									<th class="text-left py-2 pr-3">GL</th>
									<th class="text-right py-2 pr-3">Price</th>
									<th class="text-left py-2">Type</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-gray-100 dark:divide-gray-800">
								{#each itemsForLocation(itemModalLocation) as ci}
									<tr
										class="hover:bg-brand-50 dark:hover:bg-brand-900/20 cursor-pointer transition-colors"
										onclick={() => {
											if (itemModalLineIndex >= 0 && itemModalLineIndex < lineItems.length) {
												const ln = lineItems[itemModalLineIndex];
												ln._catalogItem = ci.item_code;
												ln.description = ci.name;
												ln.accountCode = ci.gl_code || '';
												ln.unitPrice = ci.price || 0;
												lineItems = [...lineItems];
												recalc();
											}
											showItemModal = false;
										}}
									>
										<td class="py-2 pr-3 text-gray-900 dark:text-white font-medium">{ci.name}</td>
										<td class="py-2 pr-3 text-gray-500 dark:text-gray-400">{ci.item_code}</td>
										<td class="py-2 pr-3 text-gray-500 dark:text-gray-400">{ci.gl_code}</td>
										<td class="py-2 pr-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{ci.price ? fmt(ci.price) : '—'}</td>
										<td class="py-2 text-gray-400 text-xs">{ci.product_type || ''}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		{/if}
		<!-- Create form -->
		<div class="mb-6">
			<h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-1">Create Document</h1>
			<p class="text-gray-500 dark:text-gray-400">Fill in the details below to create a new document in Xero.</p>
		</div>

		<!-- Doc type tabs -->
		<div class="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit mb-8">
			{#each [
				{ value: 'invoice', label: 'Invoice' },
				{ value: 'quote', label: 'Quote' },
				{ value: 'purchaseorder', label: 'Purchase Order' }
			] as tab}
				<button
					onclick={() => (docType = tab.value as DocType)}
					class="px-5 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer {docType === tab.value
						? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
						: 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}"
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<!-- Action buttons -->
		<div class="flex flex-wrap items-center gap-2 mb-6">
			<button
				onclick={handleSubmit}
				disabled={submitting}
				class="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 shadow-sm cursor-pointer flex items-center gap-2"
			>
				{#if submitting}
					<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
					Creating...
				{:else}
					Create {docTypeLabel}
				{/if}
			</button>
			<button
				onclick={fillRandomData}
				type="button"
				class="px-4 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 font-medium rounded-lg transition-colors cursor-pointer text-sm"
			>
				Fill Test Data
			</button>
			{#if submitError}
				<div class="flex items-center text-red-600 text-sm">{submitError}</div>
			{/if}
			{#if createdDoc}
				<div class="flex items-center gap-1 ml-2 text-green-600 text-sm font-medium">
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
					{getDocNumber() ? `${docTypeLabel} #${getDocNumber()} created` : 'Created'}
				</div>
				<button onclick={handleDownloadPdf} disabled={actionLoading === 'pdf'} class="px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg cursor-pointer disabled:opacity-50">
					{actionLoading === 'pdf' ? '...' : 'PDF'}
				</button>
				<button onclick={openInXero} class="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg cursor-pointer">
					Open in Xero
				</button>
				<button onclick={openEmailModal} class="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg cursor-pointer">
					Email PDF
				</button>
				<button onclick={resetForm} class="px-4 py-2 bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 hover:bg-brand-200 dark:hover:bg-brand-900/50 text-sm font-medium rounded-lg cursor-pointer">
					+ New
				</button>
			{/if}
			{#if actionMessage}
				<div class="text-blue-600 text-sm">{actionMessage}</div>
			{/if}
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
			<!-- Left column: Details -->
			<div class="lg:col-span-1 space-y-6">
				<!-- Contact -->
				<div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-5">
					<h3 class="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">Contact</h3>
					<div class="space-y-3">
						<div>
							<label for="contact-name" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name <span class="text-red-500">*</span></label>
							<input
								id="contact-name"
								type="text"
								bind:value={contactName}
								placeholder="Contact or company name"
								class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500"
							/>
						</div>
						<div>
							<label for="contact-email" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
							<input
								id="contact-email"
								type="email"
								bind:value={contactEmail}
								placeholder="email@example.com"
								class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500"
							/>
						</div>
					</div>
				</div>

				<!-- Details -->
				<div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-5">
					<h3 class="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">Details</h3>
					<div class="space-y-3">
						<div>
							<label for="doc-date" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
							<input id="doc-date" type="date" bind:value={docDate} class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
						</div>
						<div>
							<label for="due-date" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Date</label>
							<input id="due-date" type="date" bind:value={dueDate} class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
						</div>
						<div>
							<label for="reference" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reference</label>
							<input
								id="reference"
								type="text"
								bind:value={reference}
								placeholder="Optional reference"
								class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500"
							/>
						</div>
						<div>
							<label for="currency" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Currency</label>
							<select id="currency" bind:value={currency} class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-800 dark:text-white">
								<option value="ZAR">ZAR - South African Rand</option>
								{#each currencies.filter((c) => c.code !== 'ZAR') as cur}
									<option value={cur.code}>{cur.code} - {cur.description}</option>
								{/each}
							</select>
						</div>
					</div>
				</div>



				</div>

			<!-- Right column: Line items -->
			<div class="lg:col-span-2">
				<div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800">
					<div class="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
						<h3 class="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">Line Items</h3>
						<button
							type="button"
							onclick={addLineItem}
							class="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 cursor-pointer"
						>
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
							</svg>
							Add Line
						</button>
					</div>

					<div class="divide-y divide-gray-100 dark:divide-gray-800">
						{#each lineItems as item, i (item.id)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="group {dragOverIndex === i && dragIndex !== i ? 'border-t-2 border-brand-500' : ''} {dragIndex === i ? 'opacity-40' : ''}"
								draggable="false"
								ondragover={(e) => handleDragOver(e, i)}
								ondrop={(e) => handleDrop(e, i)}
							>
								<!-- Summary row -->
								<div class="flex items-center">
									<!-- Drag handle + sort arrows -->
									<div class="flex items-center shrink-0 pl-1">
										<!-- Drag handle -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											draggable="true"
											ondragstart={(e) => handleDragStart(e, i)}
											ondragend={handleDragEnd}
											class="px-1 py-2 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 dark:hover:text-gray-400 touch-none"
											title="Drag to reorder"
										>
											<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
												<circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
												<circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
												<circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
											</svg>
										</div>
										<!-- Sort arrows -->
										<div class="flex flex-col shrink-0 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity">
											<button type="button" onclick={(e) => { e.stopPropagation(); moveLineItem(i, -1); }} disabled={i === 0} class="px-1 py-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 cursor-pointer" title="Move up">
												<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" /></svg>
											</button>
											<button type="button" onclick={(e) => { e.stopPropagation(); moveLineItem(i, 1); }} disabled={i === lineItems.length - 1} class="px-1 py-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 cursor-pointer" title="Move down">
												<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
											</button>
										</div>
									</div>
									<button
										type="button"
										class="flex-1 min-w-0 flex items-center gap-3 px-3 py-3 text-left hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer {expandedLine === item.id ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''}"
										onclick={() => { expandedLine = expandedLine === item.id ? null : item.id; }}
									>
										<span class="text-xs text-gray-400 w-5 shrink-0">{i + 1}</span>
										<svg class="w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform {expandedLine === item.id ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
										</svg>
										<span class="flex-1 text-sm text-gray-900 dark:text-white break-words whitespace-normal">{item.description || 'Untitled item'}</span>
										{#if item.accountCode}
											<span class="text-xs text-gray-400 shrink-0">{item.accountCode}</span>
										{/if}
										{#if getTrackingLabels(item.tracking || {})}
											<span class="text-xs text-brand-500 dark:text-brand-400 shrink-0">{getTrackingLabels(item.tracking || {})}</span>
										{/if}
										<span class="text-sm text-gray-500 dark:text-gray-400 tabular-nums w-12 text-right shrink-0">{item.quantity}</span>
										<span class="text-sm text-gray-500 dark:text-gray-400 tabular-nums w-20 text-right shrink-0">{fmt(Number(item.unitPrice))}</span>
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300 tabular-nums w-24 text-right shrink-0">{fmt(Number(item.quantity) * Number(item.unitPrice))}</span>
									</button>
									<button
										type="button"
										onclick={(e) => { e.stopPropagation(); removeLineItem(i); }}
										disabled={lineItems.length <= 1}
										class="px-2 shrink-0 text-gray-300 hover:text-red-500 disabled:opacity-20 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity cursor-pointer"
										title="Remove"
									>
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
										</svg>
									</button>
								</div>

								<!-- Expanded detail panel -->
								{#if expandedLine === item.id}
									<div class="px-5 py-4 bg-gray-50/80 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700">
										<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
											<!-- Location first -->
											{#each trackingCategories as cat}
												<div>
													<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{cat.name}</label>
													<SearchSelect
														value={item.tracking[cat.id] ?? ''}
														onchange={(v) => { item.tracking[cat.id] = v; item.tracking = { ...item.tracking }; }}
														options={cat.options.map(o => ({ value: o.id, label: o.name }))}
														placeholder="Search {cat.name.toLowerCase()}..."
													/>
												</div>
											{/each}
											<!-- Catalog Item (filtered by location) -->
											{#if catalogItems.length > 0}
												{@const locCode = getSelectedLocationCode(item)}
												<div>
													<label class="block text-xs font-medium text-brand-600 dark:text-brand-400 mb-1">Catalog Item</label>
													<div class="flex items-center gap-1">
														<div class="flex-1">
															<SearchSelect
																value={item._catalogItem ?? ''}
																onchange={(v) => {
																	item._catalogItem = v;
																	const found = catalogItems.find(ci => ci.item_code === v);
																	if (found) {
																		item.description = found.name;
																		item.accountCode = found.gl_code || '';
																		item.unitPrice = found.price || 0;
																		recalc();
																	}
																}}
																options={itemsForLocation(locCode).map(ci => ({ value: ci.item_code, label: `${ci.name} (${ci.gl_code})` }))}
																placeholder={locCode ? `Search items...` : 'Select location first'}
															/>
														</div>
														{#if locCode}
															<button
																type="button"
																onclick={() => { itemModalLocation = locCode; itemModalLineIndex = i; showItemModal = true; }}
																class="px-2 py-1.5 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 cursor-pointer"
															>Browse</button>
														{/if}
													</div>
												</div>
											{/if}
											<!-- Description -->
											<div class="sm:col-span-2">
												<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Description</label>
												<input
													type="text"
													bind:value={item.description}
													placeholder="Item description"
													class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-gray-400"
												/>
											</div>
											<div>
												<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Account</label>
												<SearchSelect
													bind:value={item.accountCode}
													options={accounts.map(a => ({ value: a.code, label: `${a.code} - ${a.name}` }))}
													placeholder="Search accounts..."
												/>
											</div>
											<div>
												<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Quantity</label>
												<input
													type="number"
													bind:value={item.quantity}
													oninput={recalc}
													min="0"
													step="1"
													class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
												/>
											</div>
											<div>
												<label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Unit Price</label>
												<input
													type="number"
													bind:value={item.unitPrice}
													oninput={recalc}
													min="0"
													step="0.01"
													class="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
												/>
											</div>
										</div>
										<div class="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
											<button type="button" onclick={() => moveLineItem(i, -1)} disabled={i === 0} class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-30 cursor-pointer">Move up</button>
											<button type="button" onclick={() => moveLineItem(i, 1)} disabled={i === lineItems.length - 1} class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-30 cursor-pointer">Move down</button>
											<button type="button" onclick={() => removeLineItem(i)} disabled={lineItems.length <= 1} class="px-2 py-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-30 cursor-pointer">Remove</button>
											<div class="flex-1"></div>
											<button type="button" onclick={() => { expandedLine = null; }} class="px-3 py-1 text-xs font-medium text-brand-600 hover:text-brand-700 cursor-pointer">Done</button>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>

					<!-- Add line -->
					<div class="px-5 py-3 border-t border-gray-100 dark:border-gray-800">
						<button type="button" onclick={addLineItem} class="flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 cursor-pointer">
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
							</svg>
							Add another line item
						</button>
					</div>

					<!-- Totals -->
					<div class="border-t border-gray-200 dark:border-gray-700 px-5 py-2">
						<div class="flex justify-end gap-4 text-sm">
							<span class="text-gray-500 dark:text-gray-400">Subtotal</span>
							<span class="text-gray-700 dark:text-gray-300 tabular-nums w-28 text-right">{currency} {fmt(subtotal)}</span>
						</div>
						<div class="flex justify-end gap-4 text-sm mt-1">
							<span class="text-gray-500 dark:text-gray-400">Tax (15%)</span>
							<span class="text-gray-700 dark:text-gray-300 tabular-nums w-28 text-right">{currency} {fmt(tax)}</span>
						</div>
					</div>
					<div class="border-t border-gray-200 dark:border-gray-700 px-5 py-3">
						<div class="flex justify-end gap-4">
							<span class="font-semibold text-gray-900 dark:text-white">Total</span>
							<span class="font-semibold text-gray-900 dark:text-white tabular-nums w-28 text-right">{currency} {fmt(total)}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
</div>
