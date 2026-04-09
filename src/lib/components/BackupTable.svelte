<script lang="ts">
	import type { SupabaseBackup } from '$lib/types';

	let { backups }: { backups: SupabaseBackup[] } = $props();

	// Retentievenster van Supabase: 7 dagen
	const RETENTION_DAYS = 7;
	const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

	function isExpired(insertedAt: Date | string): boolean {
		const date = new Date(insertedAt);
		return (Date.now() - date.getTime()) > RETENTION_MS;
	}
</script>

<div class="card border border-base-content/10 overflow-hidden">
	<div class="overflow-x-auto">
		<table class="table table-sm">
			<thead>
				<tr class="bg-base-200">
					<th>Datum</th>
					<th>Tijd</th>
					<th>Status</th>
					<th>Type</th>
					<th>Beschikbaarheid</th>
				</tr>
			</thead>
			<tbody>
				{#each backups as backup}
					{@const date = new Date(backup.inserted_at)}
					{@const expired = isExpired(backup.inserted_at)}
					<tr class="hover:bg-base-content/5 {expired ? 'opacity-50' : ''}">
						<td class="font-mono text-sm {expired ? 'line-through' : ''}">
							{date.toLocaleDateString('nl-NL', { dateStyle: 'medium' })}
						</td>
						<td class="font-mono text-sm text-base-content/60 {expired ? 'line-through' : ''}">
							{date.toLocaleTimeString('nl-NL', { timeStyle: 'short' })}
						</td>
						<td>
							{#if backup.status === 'COMPLETED'}
								<span class="badge badge-success badge-sm">Voltooid</span>
							{:else}
								<span class="badge badge-error badge-sm">{backup.status}</span>
							{/if}
						</td>
						<td class="text-sm text-base-content/60">
							{backup.is_physical_backup ? 'Fysiek' : 'Logisch'}
						</td>
						<td>
							{#if expired}
								<span class="badge badge-ghost badge-sm">Opgeschoond</span>
							{:else}
								<span class="badge badge-info badge-sm badge-outline">Beschikbaar</span>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="text-center text-base-content/50 py-8">
							Geen back-ups gevonden
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
