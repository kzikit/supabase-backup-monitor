<script lang="ts">
	// Na serialisatie door SvelteKit is timestamp een string
	interface AzureBackupRow {
		timestamp: string;
		status: string;
		duration_ms: number | null;
		tables_count: number | null;
		storage_files_count: number | null;
		manifest_blob: string | null;
	}

	let { backups }: { backups: AzureBackupRow[] } = $props();
</script>

<div class="card border border-base-content/10 overflow-hidden">
	<div class="overflow-x-auto">
		<table class="table table-sm">
			<thead>
				<tr class="bg-base-200">
					<th>Datum</th>
					<th>Tijd</th>
					<th>Status</th>
					<th>Duur</th>
					<th>Tabellen</th>
					<th>Bestanden</th>
				</tr>
			</thead>
			<tbody>
				{#each backups as backup (backup.timestamp)}
					{@const date = new Date(backup.timestamp)}
					<tr class="hover:bg-base-content/5">
						<td class="font-mono text-sm">
							{date.toLocaleDateString('nl-NL', { dateStyle: 'medium' })}
						</td>
						<td class="font-mono text-sm text-base-content/60">
							{date.toLocaleTimeString('nl-NL', { timeStyle: 'short' })}
						</td>
						<td>
							{#if backup.status === 'completed'}
								<span class="badge badge-success badge-sm">Voltooid</span>
							{:else}
								<span class="badge badge-error badge-sm">{backup.status}</span>
							{/if}
						</td>
						<td class="text-sm text-base-content/60">
							{#if backup.duration_ms}
								{(backup.duration_ms / 1000).toFixed(1)}s
							{:else}
								—
							{/if}
						</td>
						<td class="text-sm text-base-content/60">
							{backup.tables_count ?? '—'}
						</td>
						<td class="text-sm text-base-content/60">
							{backup.storage_files_count ?? '—'}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="text-center text-base-content/50 py-8">
							Geen back-ups gevonden
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
