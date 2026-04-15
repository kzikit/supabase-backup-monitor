<script lang="ts">
	import BackupTable from '$lib/components/BackupTable.svelte';
	import BackupCalendar from '$lib/components/BackupCalendar.svelte';
	import AzureBackupTable from '$lib/components/AzureBackupTable.svelte';
	import AzureBackupCalendar from '$lib/components/AzureBackupCalendar.svelte';
	import BackupLogViewer from '$lib/components/BackupLogViewer.svelte';
	import type { BackupProgressEvent, SupabaseBackup } from '$lib/types';
	import type { PageData } from './$types';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	// SvelteKit serialiseert Date naar string; cast terug voor bestaande componenten
	type Serialized<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] };

	let { data }: { data: PageData } = $props();

	// Tab- en weergave-staat in URL zodat refresh / bladwijzer dezelfde view herstelt
	type Tab = 'beheerd' | 'aangepast';
	type View = 'table' | 'calendar';

	const activeTab = $derived<Tab>(
		page.url.searchParams.get('tab') === 'aangepast' ? 'aangepast' : 'beheerd'
	);
	// Weergave toggle (gedeeld tussen tabs)
	const view = $derived<View>(
		page.url.searchParams.get('view') === 'table' ? 'table' : 'calendar'
	);

	function setTab(t: Tab) {
		const url = new URL(page.url);
		url.searchParams.set('tab', t);
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function setView(v: View) {
		const url = new URL(page.url);
		url.searchParams.set('view', v);
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	// === Beheerd (Supabase) ===
	const latestBackup = $derived(data.backups[0]);
	const today = $derived(new Date().toISOString().split('T')[0]);
	const todayBackup = $derived(
		data.backups.find((b) => new Date(b.inserted_at).toISOString().split('T')[0] === today)
	);

	const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
	const latestBackupExpired = $derived(
		latestBackup ? Date.now() - new Date(latestBackup.inserted_at).getTime() > RETENTION_MS : false
	);

	type TodayStatus = 'completed' | 'failed' | 'no-backup';
	const todayStatus = $derived<TodayStatus>(
		todayBackup ? (todayBackup.status === 'COMPLETED' ? 'completed' : 'failed') : 'no-backup'
	);

	// Check nu (Supabase)
	let checking = $state(false);
	let checkResult = $state<'ok' | 'error' | null>(null);
	let checkError = $state<string | null>(null);

	async function triggerCheck() {
		checking = true;
		checkResult = null;
		checkError = null;
		try {
			const res = await fetch('/api/check-backups');
			const body = await res.json();
			checkResult = res.ok ? 'ok' : 'error';
			if (!res.ok) checkError = body.error || 'Onbekende fout';
			if (res.ok) await invalidateAll();
		} catch (err) {
			checkResult = 'error';
			checkError = err instanceof Error ? err.message : 'Netwerkfout';
		} finally {
			checking = false;
			setTimeout(() => {
				checkResult = null;
				checkError = null;
			}, 5000);
		}
	}

	// === Aangepast (Azure) ===
	const latestAzureBackup = $derived(data.azureBackups[0]);
	const todayAzureBackup = $derived(
		data.azureBackups.find(
			(b) => new Date(b.timestamp).toISOString().split('T')[0] === today
		)
	);

	const azureTodayStatus = $derived<TodayStatus>(
		todayAzureBackup
			? todayAzureBackup.status === 'completed'
				? 'completed'
				: 'failed'
			: 'no-backup'
	);

	// Trigger backup (Azure) met SSE
	let triggering = $state(false);
	let triggerEvents = $state<BackupProgressEvent[]>([]);
	let triggerResult = $state<'ok' | 'error' | null>(null);

	async function triggerAzureBackup() {
		triggering = true;
		triggerEvents = [];
		triggerResult = null;

		try {
			const res = await fetch('/api/backup', { method: 'POST' });
			const reader = res.body?.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			if (!reader) throw new Error('Geen stream beschikbaar');

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const event: BackupProgressEvent = JSON.parse(line.slice(6));
						triggerEvents = [...triggerEvents, event];

						if (event.phase === 'complete') triggerResult = 'ok';
						if (event.phase === 'error') triggerResult = 'error';
					}
				}
			}
		} catch (err) {
			triggerEvents = [
				...triggerEvents,
				{
					phase: 'error',
					status: 'error',
					message: err instanceof Error ? err.message : 'Onbekende fout',
					timestamp: new Date().toISOString()
				}
			];
			triggerResult = 'error';
		} finally {
			triggering = false;
			await invalidateAll();
		}
	}

	// === Backfill (Azure prefix-migratie) ===
	let backfillDialog = $state<HTMLDialogElement | null>(null);
	let backfillBusy = $state(false);
	let backfillReport = $state<unknown>(null);
	let backfillError = $state<string | null>(null);
	let backfillApplied = $state(false);

	async function runBackfill(apply: boolean) {
		backfillBusy = true;
		backfillError = null;
		try {
			const res = await fetch(`/api/admin/backfill${apply ? '?apply=1' : ''}`, {
				method: 'POST'
			});
			if (!res.ok) {
				backfillError = `HTTP ${res.status}: ${await res.text()}`;
				backfillReport = null;
				return;
			}
			backfillReport = await res.json();
			backfillApplied = apply;
			if (apply) await invalidateAll();
		} catch (err) {
			backfillError = err instanceof Error ? err.message : 'Netwerkfout';
		} finally {
			backfillBusy = false;
		}
	}

	function openBackfillDialog() {
		backfillReport = null;
		backfillError = null;
		backfillApplied = false;
		backfillDialog?.showModal();
		runBackfill(false);
	}
</script>

<div class="space-y-6">
	<!-- Header met tabs -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold">Back-up Dashboard</h1>
			<p class="text-base-content/60 text-sm mt-1">
				{#if activeTab === 'beheerd'}
					{data.backups.length} Supabase back-ups geregistreerd
				{:else}
					{data.azureBackups.length} Azure back-ups geregistreerd
				{/if}
			</p>
		</div>

		<!-- Weergave toggle -->
		<div class="flex gap-2">
			<button
				class="btn btn-sm {view === 'calendar' ? 'btn-active' : ''}"
				onclick={() => setView('calendar')}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
					/>
				</svg>
				Kalender
			</button>
			<button
				class="btn btn-sm {view === 'table' ? 'btn-active' : ''}"
				onclick={() => setView('table')}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
					/>
				</svg>
				Tabel
			</button>
		</div>
	</div>

	<!-- Tabs -->
	<div role="tablist" class="tabs tabs-bordered">
		<button
			role="tab"
			class="tab {activeTab === 'beheerd' ? 'tab-active' : ''}"
			onclick={() => setTab('beheerd')}
		>
			Beheerd
		</button>
		<button
			role="tab"
			class="tab {activeTab === 'aangepast' ? 'tab-active' : ''}"
			onclick={() => setTab('aangepast')}
		>
			Aangepast
		</button>
	</div>

	<!-- Tab: Beheerd (Supabase) -->
	{#if activeTab === 'beheerd'}
		<!-- Check nu knop (boven de status-samenvatting, onder het tabblad) -->
		<button
			onclick={triggerCheck}
			disabled={checking}
			class="btn btn-lg btn-block btn-primary gap-2"
		>
			{#if checking}
				<span class="loading loading-spinner loading-sm"></span>
				Bezig...
			{:else if checkResult === 'ok'}
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M5 13l4 4L19 7"
					/>
				</svg>
				Klaar
			{:else if checkResult === 'error'}
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
				Fout
			{:else}
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
				Check nu
			{/if}
		</button>
		{#if checkError}
			<div class="text-sm text-error">Check mislukt: {checkError}</div>
		{/if}

		<!-- Status samenvatting -->
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
			<div class="card border border-base-content/10 p-4">
				<div class="text-sm text-base-content/60">Status vandaag</div>
				<div class="mt-1 flex items-center gap-2">
					{#if todayStatus === 'completed'}
						<span class="badge badge-success gap-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M5 13l4 4L19 7"
								/>
							</svg>
							OK
						</span>
					{:else if todayStatus === 'failed'}
						<span class="badge badge-error gap-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 9v2m0 4h.01M12 3l9.66 16.5H2.34L12 3z"
								/>
							</svg>
							Mislukt
						</span>
					{:else}
						<span class="badge badge-warning gap-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 8v4m0 4h.01"
								/>
							</svg>
							Geen back-up
						</span>
					{/if}
				</div>
			</div>

			<div class="card border border-base-content/10 p-4">
				<div class="text-sm text-base-content/60">Laatste back-up</div>
				<div class="mt-1 text-sm font-medium">
					{#if latestBackup}
						{new Date(latestBackup.inserted_at).toLocaleString('nl-NL', {
							dateStyle: 'medium',
							timeStyle: 'short'
						})}
						{#if latestBackupExpired}
							<span class="badge badge-ghost badge-xs ml-1">Opgeschoond</span>
						{/if}
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
			<BackupCalendar backups={data.backups as unknown as SupabaseBackup[]} />
		{:else}
			<BackupTable backups={data.backups as unknown as SupabaseBackup[]} />
		{/if}

	<!-- Tab: Aangepast (Azure) -->
	{:else}
		<!-- Trigger knop (boven de status-samenvatting, onder het tabblad) -->
		<button
			onclick={triggerAzureBackup}
			disabled={triggering}
			class="btn btn-lg btn-block gap-2 {triggerResult === 'error' ? 'btn-error' : 'btn-primary'}"
		>
			{#if triggering}
				<span class="loading loading-spinner loading-sm"></span>
				Bezig...
			{:else if triggerResult === 'ok'}
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M5 13l4 4L19 7"
					/>
				</svg>
				Voltooid
			{:else if triggerResult === 'error'}
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
				Mislukt
			{:else}
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
					/>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				Trigger back-up nu
			{/if}
		</button>

		<!-- Backfill-knop (alleen zichtbaar wanneer ingeschakeld in Instellingen) -->
		{#if data.showBackfillButton}
			<button
				onclick={openBackfillDialog}
				disabled={backfillBusy}
				class="btn btn-lg btn-block gap-2 btn-warning"
			>
				{#if backfillBusy}
					<span class="loading loading-spinner loading-sm"></span>
					Bezig...
				{:else}
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z"
						/>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M8 12h8M12 8v8"
						/>
					</svg>
					Backfill (Azure prefix + DB)
				{/if}
			</button>
		{/if}

		<!-- Status samenvatting -->
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
			<div class="card border border-base-content/10 p-4">
				<div class="text-sm text-base-content/60">Status vandaag</div>
				<div class="mt-1 flex items-center gap-2">
					{#if azureTodayStatus === 'completed'}
						<span class="badge badge-success gap-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M5 13l4 4L19 7"
								/>
							</svg>
							OK
						</span>
					{:else if azureTodayStatus === 'failed'}
						<span class="badge badge-error gap-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 9v2m0 4h.01M12 3l9.66 16.5H2.34L12 3z"
								/>
							</svg>
							Mislukt
						</span>
					{:else}
						<span class="badge badge-warning gap-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 8v4m0 4h.01"
								/>
							</svg>
							Geen back-up
						</span>
					{/if}
				</div>
			</div>

			<div class="card border border-base-content/10 p-4">
				<div class="text-sm text-base-content/60">Laatste back-up</div>
				<div class="mt-1 text-sm font-medium">
					{#if latestAzureBackup}
						{new Date(latestAzureBackup.timestamp).toLocaleString('nl-NL', {
							dateStyle: 'medium',
							timeStyle: 'short'
						})}
					{:else}
						Geen data
					{/if}
				</div>
			</div>

			<div class="card border border-base-content/10 p-4">
				<div class="text-sm text-base-content/60">Totaal back-ups</div>
				<div class="mt-1 text-sm font-medium">{data.azureBackups.length}</div>
			</div>
		</div>

		<!-- Voortgangslogs -->
		{#if triggerEvents.length > 0}
			<BackupLogViewer events={triggerEvents} />
		{/if}

		<!-- Weergave -->
		{#if view === 'calendar'}
			<AzureBackupCalendar backups={data.azureBackups} />
		{:else}
			<AzureBackupTable backups={data.azureBackups} />
		{/if}
	{/if}
</div>

<!-- Backfill modal -->
<dialog bind:this={backfillDialog} class="modal">
	<div class="modal-box max-w-3xl">
		<h3 class="text-lg font-medium mb-2">Backfill — Azure prefix migratie</h3>
		<p class="text-sm text-base-content/60 mb-4">
			Hernoemt legacy Azure-blobs naar <code>MANUAL-</code>/<code>CRON{`{HH}`}-</code>,
			verwijdert mislukte back-ups (groepen zonder manifest), werkt
			<code>azure_backups.manifest_blob</code> bij, en voegt ontbrekende rijen toe vanuit
			bestaande manifests.
		</p>

		{#if backfillBusy}
			<div class="flex items-center gap-2 py-4">
				<span class="loading loading-spinner loading-md"></span>
				<span class="text-sm">Analyse / uitvoer bezig...</span>
			</div>
		{/if}

		{#if backfillError}
			<div class="alert alert-error text-sm">{backfillError}</div>
		{/if}

		{#if backfillReport && !backfillBusy}
			{@const r = backfillReport as {
				mode: string;
				container: string;
				blobsScanned: number;
				timestampGroups: number;
				renames: Array<{ timestamp: string; targetPrefix: string; reason: string }>;
				deletes: Array<{ timestamp: string; blobs: string[] }>;
				dbUpdates: Array<{ timestamp: string; oldManifestBlob: string; newManifestBlob: string }>;
				backfills: Array<{ timestamp: string; manifestBlob: string }>;
				warnings: string[];
				logs: string[];
			}}
			<div class="space-y-3 text-sm">
				<div class="flex flex-wrap gap-2">
					<span class="badge {r.mode === 'apply' ? 'badge-warning' : 'badge-info'}">{r.mode}</span>
					<span class="badge badge-ghost">container: {r.container}</span>
					<span class="badge badge-ghost">{r.blobsScanned} blobs</span>
					<span class="badge badge-ghost">{r.timestampGroups} groepen</span>
				</div>

				<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
					<div class="card border border-base-content/10 p-2">
						<div class="text-xs text-base-content/60">Renames</div>
						<div class="text-lg font-medium">{r.renames.length}</div>
					</div>
					<div class="card border border-base-content/10 p-2">
						<div class="text-xs text-base-content/60">Deletes</div>
						<div class="text-lg font-medium">{r.deletes.length}</div>
					</div>
					<div class="card border border-base-content/10 p-2">
						<div class="text-xs text-base-content/60">DB-updates</div>
						<div class="text-lg font-medium">{r.dbUpdates.length}</div>
					</div>
					<div class="card border border-base-content/10 p-2">
						<div class="text-xs text-base-content/60">Back-fills</div>
						<div class="text-lg font-medium">{r.backfills.length}</div>
					</div>
				</div>

				{#if r.warnings.length > 0}
					<div class="alert alert-warning text-xs">
						<ul class="list-disc list-inside">
							{#each r.warnings as w}
								<li>{w}</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if r.renames.length > 0}
					<details class="border border-base-content/10 rounded p-2">
						<summary class="text-xs font-medium cursor-pointer">Renames ({r.renames.length})</summary>
						<ul class="mt-2 text-xs font-mono space-y-1">
							{#each r.renames as rn}
								<li>{rn.timestamp} → {rn.targetPrefix} <span class="text-base-content/60">({rn.reason})</span></li>
							{/each}
						</ul>
					</details>
				{/if}

				{#if r.deletes.length > 0}
					<details class="border border-base-content/10 rounded p-2">
						<summary class="text-xs font-medium cursor-pointer">Deletes ({r.deletes.length})</summary>
						<ul class="mt-2 text-xs font-mono space-y-1">
							{#each r.deletes as d}
								<li>{d.timestamp} — {d.blobs.length} blobs</li>
							{/each}
						</ul>
					</details>
				{/if}

				{#if r.backfills.length > 0}
					<details class="border border-base-content/10 rounded p-2">
						<summary class="text-xs font-medium cursor-pointer">Back-fills ({r.backfills.length})</summary>
						<ul class="mt-2 text-xs font-mono space-y-1">
							{#each r.backfills as b}
								<li>{b.timestamp} — {b.manifestBlob}</li>
							{/each}
						</ul>
					</details>
				{/if}

				{#if backfillApplied}
					<div class="alert alert-success text-sm">
						Wijzigingen doorgevoerd. Logs: {r.logs.length} regels.
					</div>
				{/if}
			</div>
		{/if}

		<div class="modal-action">
			<button class="btn btn-ghost btn-sm" onclick={() => backfillDialog?.close()}>
				Sluiten
			</button>
			{#if backfillReport && !backfillBusy && !backfillApplied}
				<button class="btn btn-warning btn-sm" onclick={() => runBackfill(true)}>
					Doorvoeren (--apply)
				</button>
			{/if}
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button>Sluiten</button>
	</form>
</dialog>
