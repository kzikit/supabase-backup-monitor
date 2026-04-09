<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/stores';

	let { children } = $props();

	const currentPath = $derived($page.url.pathname);

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

	</header>

	<!-- Main -->
	<main class="flex-1 overflow-auto">
		<div class="p-6 max-w-6xl mx-auto">
			{@render children()}
		</div>
	</main>
</div>
