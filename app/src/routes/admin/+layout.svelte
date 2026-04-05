<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { adminFullscreen, refreshActivity, openRecordId } from '$lib/stores';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabase';
	let { children } = $props();
	let currentPath = $derived($page.url.pathname);

	const tables = [
		{ name: 'Items', href: '/admin/items', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
		{ name: 'Accounts', href: '', icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z', soon: true },
		{ name: 'Contacts', href: '', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', soon: true },
		{ name: 'Documents', href: '', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', soon: true },
		{ name: 'Tracking', href: '', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z', soon: true },
		{ name: 'Notes', href: '/admin/notes', icon: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z' },
		{ name: 'Tags', href: '/admin/tags', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z' },
		{ name: 'Invite', href: '/admin/invite', icon: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z' },
	];

	interface RecentEntry {
		action: string;
		table_name: string;
		changed_by: string;
		changed_at: string;
		record_id: string;
		new_values: Record<string, any> | null;
		old_values: Record<string, any> | null;
	}

	let recentActivity: RecentEntry[] = $state([]);

	async function loadRecent() {
		const { data } = await supabase
			.from('change_log')
			.select('action,table_name,changed_by,changed_at,record_id,new_values,old_values')
			.order('changed_at', { ascending: false })
			.limit(15);
		recentActivity = (data as RecentEntry[]) || [];
	}

	onMount(() => { loadRecent(); });

	// Refresh when triggered by CRUD operations
	$effect(() => {
		$refreshActivity;
		loadRecent();
	});

	function recordLabel(entry: RecentEntry): string {
		const vals = entry.new_values || entry.old_values;
		return vals?.name || vals?.item_code || vals?.code || entry.record_id?.substring(0, 8) || '?';
	}

	function timeAgo(dateStr: string): string {
		const diff = Date.now() - new Date(dateStr).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		return `${Math.floor(hrs / 24)}d ago`;
	}

	// Draggable floating panel state
	let showFloatingActivity = $state(true);
	let floatX = $state(20);
	let floatY = $state(80);
	let dragging = $state(false);
	let dragOffsetX = 0;
	let dragOffsetY = 0;
	let floatCollapsed = $state(false);

	function startDrag(e: MouseEvent) {
		dragging = true;
		dragOffsetX = e.clientX - floatX;
		dragOffsetY = e.clientY - floatY;
		const onMove = (ev: MouseEvent) => {
			floatX = ev.clientX - dragOffsetX;
			floatY = ev.clientY - dragOffsetY;
		};
		const onUp = () => {
			dragging = false;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	const actionColors: Record<string, string> = {
		INSERT: 'text-green-500',
		UPDATE: 'text-brand-500',
		DELETE: 'text-red-500',
		RESTORE: 'text-orange-500',
	};
</script>

<div class="{$adminFullscreen ? 'fixed inset-0 z-40 bg-gray-50 dark:bg-gray-950 overflow-auto' : 'max-w-7xl mx-auto'} px-4 sm:px-6 lg:px-8 py-6">
	<div class="flex gap-6">
		<!-- Sidebar -->
		{#if !$adminFullscreen}
			<nav class="w-52 shrink-0">
				<div class="space-y-1 mb-6">
					{#each tables as t}
						{#if t.soon}
							<span
								class="flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg text-gray-300 dark:text-gray-600 cursor-default"
								title="Coming soon"
							>
								<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d={t.icon} />
								</svg>
								{t.name}
								<span class="text-[10px] ml-auto opacity-60">soon</span>
							</span>
						{:else}
							<a
								href={t.href}
								class="flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors {currentPath.startsWith(t.href)
									? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
									: 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800'}"
							>
								<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d={t.icon} />
								</svg>
								{t.name}
							</a>
						{/if}
					{/each}
				</div>

				<!-- Recent Activity -->
				{#if recentActivity.length > 0}
					<div class="border-t border-gray-200 dark:border-gray-800 pt-4">
						<h4 class="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 mb-2">Recent Activity</h4>
						<div class="space-y-0.5">
							{#each recentActivity as entry}
								<button
									onclick={() => { openRecordId.set(entry.record_id); goto(`/admin/${entry.table_name}`); }}
									class="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer group/entry relative"
								>
									<div class="flex items-center gap-1.5">
										<span class="{actionColors[entry.action] || 'text-gray-400'} font-medium text-[10px] uppercase">{entry.action}</span>
										<span class="text-gray-700 dark:text-gray-300 truncate flex-1">{recordLabel(entry)}</span>
									</div>
									<div class="text-[10px] text-gray-400 mt-0.5">
										{entry.changed_by} · {timeAgo(entry.changed_at)}
									</div>
									<!-- Hover tooltip with change details -->
									{#if (entry.action === 'UPDATE' || entry.action === 'RESTORE') && entry.old_values && entry.new_values}
										<div class="hidden group-hover/entry:block absolute left-full top-0 ml-2 z-50 bg-gray-900 dark:bg-gray-800 text-white rounded-lg shadow-xl p-3 min-w-[250px] max-w-[350px] border border-gray-700">
											{#each Object.keys(entry.new_values).filter(f => JSON.stringify(entry.new_values?.[f]) !== JSON.stringify(entry.old_values?.[f])) as field}
												<div class="text-[11px] mb-1">
													<span class="text-gray-400 font-medium">{field}:</span>
													<span class="text-red-400 line-through mr-1">{entry.old_values[field] ?? 'null'}</span>
													<span class="text-green-400">{entry.new_values[field] ?? 'null'}</span>
												</div>
											{/each}
										</div>
									{:else if entry.action === 'INSERT' && entry.new_values}
										<div class="hidden group-hover/entry:block absolute left-full top-0 ml-2 z-50 bg-gray-900 dark:bg-gray-800 text-white rounded-lg shadow-xl p-3 min-w-[250px] max-w-[350px] border border-gray-700">
											{#each Object.entries(entry.new_values).filter(([,v]) => v != null && v !== '' && v !== false) as [k, v]}
												<div class="text-[11px] mb-1">
													<span class="text-gray-400 font-medium">{k}:</span>
													<span class="text-green-400">{typeof v === 'object' ? JSON.stringify(v) : v}</span>
												</div>
											{/each}
										</div>
									{:else if entry.action === 'DELETE' && entry.old_values}
										<div class="hidden group-hover/entry:block absolute left-full top-0 ml-2 z-50 bg-gray-900 dark:bg-gray-800 text-white rounded-lg shadow-xl p-3 min-w-[250px] max-w-[350px] border border-gray-700">
											<div class="text-[11px] text-red-400">Deleted: {(entry.old_values as any).name || (entry.old_values as any).item_code}</div>
										</div>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</nav>
		{/if}

		<!-- Content -->
		<div class="flex-1 min-w-0">
			{@render children()}
		</div>
	</div>

	<!-- Floating Recent Activity panel in fullscreen -->
	{#if $adminFullscreen && showFloatingActivity && recentActivity.length > 0}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed z-50 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 {floatCollapsed ? 'w-48' : 'w-64'}"
			style="left: {floatX}px; top: {floatY}px;"
		>
			<!-- Drag handle / header -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 cursor-grab active:cursor-grabbing select-none"
				onmousedown={startDrag}
			>
				<span class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Recent Activity</span>
				<div class="flex items-center gap-1">
					<button onclick={() => (floatCollapsed = !floatCollapsed)} class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer p-0.5">
						<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							{#if floatCollapsed}
								<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
							{:else}
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
							{/if}
						</svg>
					</button>
					<button onclick={() => (showFloatingActivity = false)} class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer p-0.5">
						<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
					</button>
				</div>
			</div>
			{#if !floatCollapsed}
				<div class="p-2 max-h-[60vh] overflow-y-auto">
					{#each recentActivity as entry}
						<button
							onclick={() => { openRecordId.set(entry.record_id); goto(`/admin/${entry.table_name}`); }}
							class="w-full text-left px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
						>
							<div class="flex items-center gap-1">
								<span class="{actionColors[entry.action] || 'text-gray-400'} font-medium text-[10px] uppercase">{entry.action}</span>
								<span class="text-gray-700 dark:text-gray-300 truncate flex-1">{recordLabel(entry)}</span>
							</div>
							<div class="text-[10px] text-gray-400">{entry.changed_by} · {timeAgo(entry.changed_at)}</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Re-show button when floating panel is closed -->
	{#if $adminFullscreen && !showFloatingActivity}
		<button
			onclick={() => (showFloatingActivity = true)}
			class="fixed bottom-4 left-4 z-50 px-3 py-2 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg cursor-pointer text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
		>
			Recent Activity
		</button>
	{/if}
</div>
