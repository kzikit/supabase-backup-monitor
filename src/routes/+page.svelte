<script lang="ts">
	import BackupTable from '$lib/components/BackupTable.svelte';
	import BackupCalendar from '$lib/components/BackupCalendar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let view = $state<'table' | 'calendar'>('calendar');

	const latestBackup = $derived(data.backups[0]);
	const today = $derived(new Date().toISOString().split('T')[0]);
	const todayBackup = $derived(data.backups.find(b => b.inserted_at.split('T')[0] === today && b.status === 'COMPLETED'));
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold">Back-up Dashboard</h1>
			<p class="text-base-content/60 text-sm mt-1">
				{data.backups.length} back-ups geregistreerd
			</p>
		</div>

		<!-- Weergave toggle -->
		<div class="join">
			<button
				class="join-item btn btn-sm {view === 'calendar' ? 'btn-active' : ''}"
				onclick={() => view = 'calendar'}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
				</svg>
				Kalender
			</button>
			<button
				class="join-item btn btn-sm {view === 'table' ? 'btn-active' : ''}"
				onclick={() => view = 'table'}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
				</svg>
				Tabel
			</button>
		</div>
	</div>

	<!-- Status samenvatting -->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
		<div class="card border border-base-content/10 p-4">
			<div class="text-sm text-base-content/60">Status vandaag</div>
			<div class="mt-1 flex items-center gap-2">
				{#if todayBackup}
					<span class="badge badge-success gap-1">
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
						OK
					</span>
				{:else}
					<span class="badge badge-error gap-1">
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
						Ontbreekt
					</span>
				{/if}
			</div>
		</div>

		<div class="card border border-base-content/10 p-4">
			<div class="text-sm text-base-content/60">Laatste back-up</div>
			<div class="mt-1 text-sm font-medium">
				{#if latestBackup}
					{new Date(latestBackup.inserted_at).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })}
				{:else}
					Geen data
				{/if}
			</div>
		</div>

		<div class="card border border-base-content/10 p-4">
			<div class="text-sm text-base-content/60">Totaal back-ups</div>
			<div class="mt-1 text-sm font-medium">{data.backups.length}</div>
		</div>
	</div>

	<!-- Weergave -->
	{#if view === 'calendar'}
		<BackupCalendar backups={data.backups} />
	{:else}
		<BackupTable backups={data.backups} />
	{/if}
</div>
