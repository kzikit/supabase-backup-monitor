<script lang="ts">
	import type { SupabaseBackup } from '$lib/types';

	let { backups }: { backups: SupabaseBackup[] } = $props();

	// Bouw een set van datums met succesvolle back-ups
	const backupDates = $derived(new Set(
		backups
			.filter((b) => b.status === 'COMPLETED')
			.map((b) => b.inserted_at.split('T')[0])
	));

	// Bereken het kalendergrid: afgelopen 52 weken + huidige week
	const weeks = $derived.by(() => {
		const today = new Date();
		const result: { date: string; hasBackup: boolean; isFuture: boolean }[][] = [];

		// Start 52 weken geleden op maandag
		const start = new Date(today);
		start.setDate(start.getDate() - (52 * 7) - ((start.getDay() + 6) % 7));

		let current = new Date(start);
		let week: { date: string; hasBackup: boolean; isFuture: boolean }[] = [];

		while (current <= today || week.length > 0) {
			const dateStr = current.toISOString().split('T')[0];
			const isFuture = current > today;

			if (!isFuture) {
				week.push({
					date: dateStr,
					hasBackup: backupDates.has(dateStr),
					isFuture: false
				});
			}

			// Nieuwe week op maandag
			if (current.getDay() === 0 || isFuture) {
				if (week.length > 0) {
					result.push(week);
					week = [];
				}
				if (isFuture) break;
			}

			current.setDate(current.getDate() + 1);
		}

		if (week.length > 0) {
			result.push(week);
		}

		return result;
	});

	const dayLabels = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];

	// Maandlabels berekenen
	const monthLabels = $derived.by(() => {
		const labels: { label: string; col: number }[] = [];
		let lastMonth = -1;

		for (let i = 0; i < weeks.length; i++) {
			const firstDay = weeks[i][0];
			if (firstDay) {
				const month = new Date(firstDay.date).getMonth();
				if (month !== lastMonth) {
					labels.push({
						label: new Date(firstDay.date).toLocaleString('nl-NL', { month: 'short' }),
						col: i
					});
					lastMonth = month;
				}
			}
		}

		return labels;
	});
</script>

<div class="card border border-base-content/10 p-4">
	<h3 class="text-sm font-medium mb-3">Back-up activiteit (afgelopen jaar)</h3>

	<div class="overflow-x-auto">
		<div class="inline-flex flex-col gap-0.5 min-w-max">
			<!-- Maandlabels -->
			<div class="flex gap-0.5 ml-8 mb-1">
				{#each monthLabels as { label, col }, i}
					{@const nextCol = monthLabels[i + 1]?.col ?? weeks.length}
					<span
						class="text-xs text-base-content/50"
						style="width: {(nextCol - col) * 13}px"
					>
						{label}
					</span>
				{/each}
			</div>

			<!-- Grid -->
			{#each dayLabels as label, dayIndex}
				<div class="flex items-center gap-0.5">
					<span class="text-xs text-base-content/50 w-6 text-right pr-1">
						{dayIndex % 2 === 0 ? label : ''}
					</span>
					{#each weeks as week}
						{@const day = week[dayIndex]}
						{#if day}
							<div
								class="w-[11px] h-[11px] rounded-sm {day.hasBackup ? 'bg-success' : 'bg-error/30'}"
								title="{day.date}: {day.hasBackup ? 'Back-up OK' : 'Geen back-up'}"
							></div>
						{:else}
							<div class="w-[11px] h-[11px]"></div>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
	</div>

	<!-- Legenda -->
	<div class="flex items-center gap-3 mt-3 text-xs text-base-content/60">
		<div class="flex items-center gap-1">
			<div class="w-[11px] h-[11px] rounded-sm bg-success"></div>
			Back-up OK
		</div>
		<div class="flex items-center gap-1">
			<div class="w-[11px] h-[11px] rounded-sm bg-error/30"></div>
			Geen back-up
		</div>
	</div>
</div>
