<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/stores';

	import { invalidateAll } from '$app/navigation';

	let { children } = $props();

	const currentPath = $derived($page.url.pathname);

	let checking = $state(false);
	let checkResult = $state<'ok' | 'error' | null>(null);

	async function triggerCheck() {
		checking = true;
		checkResult = null;
		try {
			const res = await fetch('/api/check-backups');
			checkResult = res.ok ? 'ok' : 'error';
			if (res.ok) await invalidateAll();
		} catch {
			checkResult = 'error';
		} finally {
			checking = false;
			setTimeout(() => checkResult = null, 3000);
		}
	}

	const navItems = [
		{ href: '/', label: 'Dashboard', icon: 'chart' },
		{ href: '/settings', label: 'Instellingen', icon: 'cog' }
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Supabase Backup Monitor</title>
</svelte:head>

<div class="h-full flex flex-col bg-base-100">
	<!-- Header -->
	<header class="h-14 bg-base-300 border-b border-base-content/10 flex items-center px-4 gap-4 shrink-0">
		<a href="/" class="flex items-center gap-2 text-base-content hover:opacity-80">
			<svg class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
			</svg>
			<span class="font-semibold text-sm">Backup Monitor</span>
		</a>

		<nav class="flex gap-1 ml-4">
			{#each navItems as item}
				{@const isActive = currentPath === item.href || (item.href !== '/' && currentPath.startsWith(item.href))}
				<a
					href={item.href}
					class="px-3 py-1.5 rounded text-sm {isActive ? 'bg-base-content/10 font-medium' : 'hover:bg-base-content/5 text-base-content/70'}"
				>
					{item.label}
				</a>
			{/each}
		</nav>

		<div class="flex-1"></div>

		<button onclick={triggerCheck} disabled={checking} class="btn btn-sm btn-primary gap-1.5">
			{#if checking}
				<span class="loading loading-spinner loading-xs"></span>
				Bezig...
			{:else if checkResult === 'ok'}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
				</svg>
				Klaar
			{:else if checkResult === 'error'}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
				Fout
			{:else}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
				</svg>
				Check nu
			{/if}
		</button>
	</header>

	<!-- Main -->
	<main class="flex-1 overflow-auto">
		<div class="p-6 max-w-6xl mx-auto">
			{@render children()}
		</div>
	</main>
</div>
