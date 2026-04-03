<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores';
	import { goto } from '$app/navigation';
	import {
		getCurrencies,
		getTracking,
		getAccounts,
		createDocument,
		downloadPdf,
		sendEmail,
		sendCustomEmail
	} from '$lib/api';

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
		trackingCategoryId: string;
		trackingOptionId: string;
		quantity: number;
		unitPrice: number;
	}

	interface TrackingCategory {
		trackingCategoryID: string;
		name: string;
		options: Array<{ trackingOptionID: string; name: string }>;
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
	let nextId = $state(2);

	let lineItems: LineItem[] = $state([
		{ id: 1, description: '', accountCode: '', trackingCategoryId: '', trackingOptionId: '', quantity: 1, unitPrice: 0 }
	]);

	let submitting = $state(false);
	let submitError = $state('');
	let createdDoc: Record<string, unknown> | null = $state(null);
	let createdDocType: DocType = $state('invoice');
	let actionLoading = $state('');
	let actionMessage = $state('');

	// Email modal
	let showEmailModal = $state(false);
	let emailTo = $state('');
	let emailSubject = $state('');
	let emailBody = $state('');

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
			newLines.push({ id: nextId++, description: desc, accountCode: docType === 'invoice' ? '200' : '', trackingCategoryId: '', trackingOptionId: '', quantity: randomInt(1, 10), unitPrice: randomInt(50, 500) });
		}
		lineItems = newLines;
		recalc();
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

		// Load currencies and tracking
		try {
			const [currRes, trackRes] = await Promise.all([getCurrencies(), getTracking()]);
			currencies = currRes.currencies || [];
			trackingCategories = trackRes.tracking || [];
		} catch (e) {
			console.error('Failed to load form data:', e);
		}

		return unsub;
	});

	function addLineItem() {
		lineItems = [...lineItems, {
			id: nextId++,
			description: '',
			accountCode: '',
			trackingCategoryId: '',
			trackingOptionId: '',
			quantity: 1,
			unitPrice: 0
		}];
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

					if (li.trackingCategoryId && li.trackingOptionId) {
						item.tracking = [{ categoryId: li.trackingCategoryId, optionId: li.trackingOptionId }];
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
		lineItems = [{ id: nextId++, description: '', accountCode: '', tracking: {}, quantity: 1, unitPrice: 0 }];
		submitError = '';
		actionMessage = '';
	}
</script>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
	{#if createdDoc}
		<!-- Success state -->
		<div class="max-w-2xl mx-auto">
			<div class="bg-white rounded-2xl shadow-lg shadow-gray-200/50 border border-gray-100 p-8 text-center">
				<div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
					<svg class="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
					</svg>
				</div>

				<h2 class="text-2xl font-bold text-gray-900 mb-1">{docTypeLabel} Created</h2>
				<p class="text-gray-500 mb-8">
					{#if getDocNumber()}
						{docTypeLabel} #{getDocNumber()} has been created successfully.
					{:else}
						Your {docTypeLabel.toLowerCase()} has been created successfully.
					{/if}
				</p>

				<div class="grid grid-cols-2 gap-3 mb-6">
					<button
						onclick={handleDownloadPdf}
						disabled={actionLoading === 'pdf'}
						class="flex items-center justify-center gap-2 px-4 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50 cursor-pointer"
					>
						{#if actionLoading === 'pdf'}
							<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
						{:else}
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
							</svg>
						{/if}
						Download PDF
					</button>

					<button
						onclick={openInXero}
						class="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl font-medium transition-colors cursor-pointer"
					>
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
						</svg>
						View in Xero
					</button>

					<button
						onclick={handleSendViaXero}
						disabled={actionLoading === 'send'}
						class="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl font-medium transition-colors disabled:opacity-50 cursor-pointer"
					>
						{#if actionLoading === 'send'}
							<div class="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
						{:else}
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
							</svg>
						{/if}
						Send via Xero
					</button>

					<button
						onclick={openEmailModal}
						class="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl font-medium transition-colors cursor-pointer"
					>
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
						</svg>
						Email PDF
					</button>
				</div>

				{#if actionMessage}
					<div class="bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg p-3 mb-4">
						{actionMessage}
					</div>
				{/if}

				<button
					onclick={resetForm}
					class="text-brand-600 hover:text-brand-700 font-medium text-sm cursor-pointer"
				>
					Create another {docTypeLabel.toLowerCase()}
				</button>
			</div>
		</div>

		<!-- Email modal -->
		{#if showEmailModal}
			<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
				<div class="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
					<div class="flex items-center justify-between mb-6">
						<h3 class="text-lg font-semibold text-gray-900">Send PDF via Email</h3>
						<button onclick={() => (showEmailModal = false)} class="text-gray-400 hover:text-gray-600 cursor-pointer">
							<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>

					<div class="space-y-4">
						<div>
							<label for="email-to" class="block text-sm font-medium text-gray-700 mb-1">To</label>
							<input id="email-to" type="email" bind:value={emailTo} class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
						</div>
						<div>
							<label for="email-subject" class="block text-sm font-medium text-gray-700 mb-1">Subject</label>
							<input id="email-subject" type="text" bind:value={emailSubject} class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
						</div>
						<div>
							<label for="email-body" class="block text-sm font-medium text-gray-700 mb-1">Message</label>
							<textarea id="email-body" bind:value={emailBody} rows="5" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"></textarea>
						</div>
					</div>

					<div class="flex justify-end gap-3 mt-6">
						<button onclick={() => (showEmailModal = false)} class="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg cursor-pointer">
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
	{:else}
		<!-- Create form -->
		<div class="mb-6">
			<h1 class="text-2xl font-bold text-gray-900 mb-1">Create Document</h1>
			<p class="text-gray-500">Fill in the details below to create a new document in Xero.</p>
		</div>

		<!-- Doc type tabs -->
		<div class="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-8">
			{#each [
				{ value: 'invoice', label: 'Invoice' },
				{ value: 'quote', label: 'Quote' },
				{ value: 'purchaseorder', label: 'Purchase Order' }
			] as tab}
				<button
					onclick={() => (docType = tab.value as DocType)}
					class="px-5 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer {docType === tab.value
						? 'bg-white text-gray-900 shadow-sm'
						: 'text-gray-600 hover:text-gray-900'}"
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<!-- Action buttons -->
		<div class="flex gap-3 mb-6">
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
				class="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium rounded-lg transition-colors cursor-pointer text-sm"
			>
				Fill Test Data
			</button>
			{#if submitError}
				<div class="flex items-center text-red-600 text-sm">{submitError}</div>
			{/if}
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
			<!-- Left column: Details -->
			<div class="lg:col-span-1 space-y-6">
				<!-- Contact -->
				<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
					<h3 class="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Contact</h3>
					<div class="space-y-3">
						<div>
							<label for="contact-name" class="block text-sm font-medium text-gray-700 mb-1">Name <span class="text-red-500">*</span></label>
							<input
								id="contact-name"
								type="text"
								bind:value={contactName}
								placeholder="Contact or company name"
								class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-gray-400"
							/>
						</div>
						<div>
							<label for="contact-email" class="block text-sm font-medium text-gray-700 mb-1">Email</label>
							<input
								id="contact-email"
								type="email"
								bind:value={contactEmail}
								placeholder="email@example.com"
								class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-gray-400"
							/>
						</div>
					</div>
				</div>

				<!-- Details -->
				<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
					<h3 class="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Details</h3>
					<div class="space-y-3">
						<div>
							<label for="doc-date" class="block text-sm font-medium text-gray-700 mb-1">Date</label>
							<input id="doc-date" type="date" bind:value={docDate} class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
						</div>
						<div>
							<label for="due-date" class="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
							<input id="due-date" type="date" bind:value={dueDate} class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
						</div>
						<div>
							<label for="reference" class="block text-sm font-medium text-gray-700 mb-1">Reference</label>
							<input
								id="reference"
								type="text"
								bind:value={reference}
								placeholder="Optional reference"
								class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder:text-gray-400"
							/>
						</div>
						<div>
							<label for="currency" class="block text-sm font-medium text-gray-700 mb-1">Currency</label>
							<select id="currency" bind:value={currency} class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white">
								<option value="ZAR">ZAR - South African Rand</option>
								{#each currencies.filter((c) => c.code !== 'ZAR') as cur}
									<option value={cur.code}>{cur.code} - {cur.description}</option>
								{/each}
							</select>
						</div>
					</div>
				</div>

				<!-- Totals -->
				<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
					<h3 class="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Totals</h3>
					<div class="space-y-2 text-sm">
						<div class="flex justify-between text-gray-600">
							<span>Subtotal</span>
							<span>{currency} {subtotal.toFixed(2)}</span>
						</div>
						<div class="flex justify-between text-gray-600">
							<span>Tax (15%)</span>
							<span>{currency} {tax.toFixed(2)}</span>
						</div>
						<div class="border-t border-gray-100 pt-2 mt-2">
							<div class="flex justify-between font-semibold text-gray-900 text-base">
								<span>Total</span>
								<span>{currency} {total.toFixed(2)}</span>
							</div>
						</div>
					</div>
				</div>


				</div>

			<!-- Right column: Line items -->
			<div class="lg:col-span-2">
				<div class="bg-white rounded-xl shadow-sm border border-gray-200">
					<div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
						<h3 class="text-sm font-semibold text-gray-900 uppercase tracking-wide">Line Items</h3>
						<button
							onclick={addLineItem}
							class="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 cursor-pointer"
						>
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
							</svg>
							Add Line
						</button>
					</div>

					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
									<th class="px-4 py-3 w-10">#</th>
									<th class="px-4 py-3">Description</th>
									<th class="px-4 py-3 w-24">Account</th>
									{#each trackingCategories as cat}
										<th class="px-4 py-3 w-32">{cat.name}</th>
									{/each}
									<th class="px-4 py-3 w-20 text-right">Qty</th>
									<th class="px-4 py-3 w-28 text-right">Unit Price</th>
									<th class="px-4 py-3 w-28 text-right">Amount</th>
									<th class="px-4 py-3 w-24"></th>
								</tr>
							</thead>
							<tbody class="divide-y divide-gray-50">
								{#each lineItems as item, i (item.id)}
									<tr class="group hover:bg-gray-50/50">
										<td class="px-4 py-2 text-gray-400 text-xs">{i + 1}</td>
										<td class="px-4 py-2">
											<input
												type="text"
												bind:value={item.description}
												placeholder="Item description"
												class="w-full px-2 py-1.5 border border-transparent hover:border-gray-200 focus:border-brand-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-gray-300"
											/>
										</td>
										<td class="px-4 py-2">
											<input
												type="text"
												bind:value={item.accountCode}
												placeholder="Code"
												class="w-full px-2 py-1.5 border border-transparent hover:border-gray-200 focus:border-brand-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-gray-300"
											/>
										</td>
										{#each trackingCategories as cat}
											<td class="px-4 py-2">
												<select
													bind:value={item.tracking[cat.name]}
													class="w-full px-2 py-1.5 border border-transparent hover:border-gray-200 focus:border-brand-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 bg-transparent"
												>
													<option value="">--</option>
													{#each cat.options as opt}
														<option value={opt.name}>{opt.name}</option>
													{/each}
												</select>
											</td>
										{/each}
										<td class="px-4 py-2">
											<input
												type="number"
												bind:value={item.quantity}
												oninput={recalc}
												min="0"
												step="1"
												class="w-full px-2 py-1.5 border border-transparent hover:border-gray-200 focus:border-brand-300 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-brand-500"
											/>
										</td>
										<td class="px-4 py-2">
											<input
												type="number"
												bind:value={item.unitPrice}
												oninput={recalc}
												min="0"
												step="0.01"
												class="w-full px-2 py-1.5 border border-transparent hover:border-gray-200 focus:border-brand-300 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-brand-500"
											/>
										</td>
										<td class="px-4 py-2 text-right font-medium text-gray-700">
											{(Number(item.quantity) * Number(item.unitPrice)).toFixed(2)}
										</td>
										<td class="px-4 py-2">
											<div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
												<button
													onclick={() => moveLineItem(i, -1)}
													disabled={i === 0}
													class="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 cursor-pointer"
													title="Move up"
												>
													<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
														<path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
													</svg>
												</button>
												<button
													onclick={() => moveLineItem(i, 1)}
													disabled={i === lineItems.length - 1}
													class="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 cursor-pointer"
													title="Move down"
												>
													<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
														<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
													</svg>
												</button>
												<button
													onclick={() => removeLineItem(i)}
													disabled={lineItems.length <= 1}
													class="p-1 text-gray-400 hover:text-red-500 disabled:opacity-30 cursor-pointer"
													title="Remove"
												>
													<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
														<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
													</svg>
												</button>
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<div class="px-5 py-3 border-t border-gray-100">
						<button
							onclick={addLineItem}
							class="flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 cursor-pointer"
						>
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
							</svg>
							Add another line item
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
