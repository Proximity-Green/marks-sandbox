<script lang="ts">
	interface Option {
		value: string;
		label: string;
	}

	let {
		options = [],
		value = $bindable(''),
		placeholder = 'Select...',
	}: {
		options: Option[];
		value: string;
		placeholder?: string;
	} = $props();

	let open = $state(false);
	let search = $state('');
	let inputEl: HTMLInputElement | undefined = $state();
	let highlightIndex = $state(0);

	let filtered = $derived(
		search
			? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
			: options
	);

	let displayLabel = $derived(
		options.find(o => o.value === value)?.label || ''
	);

	function handleOpen() {
		open = true;
		search = '';
		highlightIndex = 0;
		setTimeout(() => inputEl?.focus(), 0);
	}

	function handleSelect(opt: Option) {
		value = opt.value;
		open = false;
		search = '';
	}

	function handleClear(e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		value = '';
		open = false;
		search = '';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlightIndex = Math.min(highlightIndex + 1, filtered.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightIndex = Math.max(highlightIndex - 1, 0);
		} else if (e.key === 'Enter' && filtered[highlightIndex]) {
			e.preventDefault();
			handleSelect(filtered[highlightIndex]);
		} else if (e.key === 'Escape') {
			open = false;
		}
	}

	function handleBlur(e: FocusEvent) {
		// Close dropdown when focus leaves the entire component
		const related = e.relatedTarget as HTMLElement | null;
		const container = (e.currentTarget as HTMLElement);
		if (related && container.contains(related)) return;
		// Small delay to allow click on option to register
		setTimeout(() => { open = false; search = ''; }, 150);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relative" onfocusout={handleBlur}>
	<!-- Trigger button -->
	{#if !open}
		<button
			type="button"
			onclick={handleOpen}
			class="w-full flex items-center justify-between gap-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-left bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent cursor-pointer transition-colors"
		>
			<span class="{value ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'} truncate">
				{displayLabel || placeholder}
			</span>
			<div class="flex items-center gap-1 shrink-0">
				{#if value}
					<span
						role="button"
						tabindex="-1"
						onclick={handleClear}
						onkeydown={(e) => { if (e.key === 'Enter') handleClear(e as any); }}
						class="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
						title="Clear"
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</span>
				{/if}
				<svg class="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
				</svg>
			</div>
		</button>
	{:else}
		<!-- Search input -->
		<input
			bind:this={inputEl}
			type="text"
			bind:value={search}
			onkeydown={handleKeydown}
			{placeholder}
			class="w-full px-3 py-2 border border-brand-400 dark:border-brand-500 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
		/>
	{/if}

	<!-- Dropdown -->
	{#if open}
		<div class="absolute z-50 mt-1 w-full min-w-[200px] max-h-48 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
			{#if filtered.length === 0}
				<div class="px-3 py-2 text-sm text-gray-400">No matches</div>
			{:else}
				{#each filtered as opt, idx}
					<button
						type="button"
						onclick={() => handleSelect(opt)}
						class="w-full px-3 py-2 text-sm text-left cursor-pointer transition-colors
							{opt.value === value ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 font-medium' : ''}
							{idx === highlightIndex ? 'bg-gray-100 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}
							text-gray-900 dark:text-white"
					>
						{opt.label}
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
