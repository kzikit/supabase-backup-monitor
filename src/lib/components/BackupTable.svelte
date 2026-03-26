<script lang="ts">
	import type { SupabaseBackup } from '$lib/types';

	let { backups }: { backups: SupabaseBackup[] } = $props();
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
				</tr>
			</thead>
			<tbody>
				{#each backups as backup}
					{@const date = new Date(backup.inserted_at)}
					<tr class="hover:bg-base-content/5">
						<td class="font-mono text-sm">
							{date.toLocaleDateString('nl-NL', { dateStyle: 'medium' })}
						</td>
						<td class="font-mono text-sm text-base-content/60">
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
					</tr>
				{:else}
					<tr>
						<td colspan="4" class="text-center text-base-content/50 py-8">
							Geen back-ups gevonden
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
