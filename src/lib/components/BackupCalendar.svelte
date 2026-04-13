<script lang="ts">
	import type { SupabaseBackup } from '$lib/types';

	let { backups }: { backups: SupabaseBackup[] } = $props();

	// Scroll-container: initieel naar rechts scrollen zodat de meest recente
	// weken zichtbaar zijn
	let scrollContainer = $state<HTMLDivElement | null>(null);
	$effect(() => {
		if (scrollContainer) scrollContainer.scrollLeft = scrollContainer.scrollWidth;
	});

	// Bouw een map van datum → status
	const backupStatusMap = $derived(new Map(
		backups.map((b) => {
			const date = new Date(b.inserted_at).toISOString().split('T')[0];
			return [date, b.status] as const;
		})
	));

	type DayStatus = 'completed' | 'failed' | 'no-data' | 'no-backup' | 'expired';

	// Retentievenster van Supabase: 7 dagen
	const RETENTION_DAYS = 7;

	function isExpired(dateStr: string): boolean {
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		return diffMs > RETENTION_DAYS * 24 * 60 * 60 * 1000;
	}

	function getDayStatus(dateStr: string): DayStatus {
		const status = backupStatusMap.get(dateStr);
		if (status === undefined) return 'no-data';
		if (status === 'COMPLETED') {
			// Voltooide backups ouder dan 7 dagen zijn opgeschoond
			return isExpired(dateStr) ? 'expired' : 'completed';
		}
		return 'failed';
	}

	const statusColors: Record<DayStatus, string> = {
		'completed': 'bg-success',
		'expired': 'bg-success/30',
		'failed': 'bg-error',
		'no-data': 'bg-base-content/10',
		'no-backup': 'bg-warning/40'
	};

	const statusLabels: Record<DayStatus, string> = {
		'completed': 'Back-up OK',
		'expired': 'Opgeschoond (>7 dagen)',
		'failed': 'Back-up mislukt',
		'no-data': 'Geen data',
		'no-backup': 'Geen back-up'
	};

	// Bereken het kalendergrid: afgelopen 52 weken + huidige week
	const weeks = $derived.by(() => {
		const today = new Date();
		const result: { date: string; status: DayStatus; isFuture: boolean }[][] = [];

		// Start 52 weken geleden op maandag
		const start = new Date(today);
		start.setDate(start.getDate() - (52 * 7) - ((start.getDay() + 6) % 7));

		let current = new Date(start);
		let week: { date: string; status: DayStatus; isFuture: boolean }[] = [];

		while (current <= today || week.length > 0) {
			const dateStr = current.toISOString().split('T')[0];
			const isFuture = current > today;

			if (!isFuture) {
				week.push({
					date: dateStr,
					status: getDayStatus(dateStr),
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
	<h3 class="text-sm font-medium mb-3">Supabase beheerde backups (afgelopen jaar)</h3>

	<div class="overflow-x-auto" bind:this={scrollContainer}>
		<div class="inline-flex flex-col gap-[3px] min-w-max">
			<!-- Maandlabels -->
			<div class="flex gap-[3px] ml-8 mb-1">
				{#each monthLabels as { label, col }, i}
					{@const nextCol = monthLabels[i + 1]?.col ?? weeks.length}
					<span
						class="text-xs text-base-content/50"
						style="width: {(nextCol - col) * 27}px"
					>
						{label}
					</span>
				{/each}
			</div>

			<!-- Grid -->
			{#each dayLabels as label, dayIndex}
				<div class="flex items-center gap-[3px]">
					<span class="text-xs text-base-content/50 w-6 text-right pr-1">
						{dayIndex % 2 === 0 ? label : ''}
					</span>
					{#each weeks as week}
						{@const day = week[dayIndex]}
						{#if day}
							<div
								class="w-6 h-6 rounded-sm {statusColors[day.status]} relative overflow-hidden"
								title="{day.date}: {statusLabels[day.status]}"
							>
								{#if day.status === 'expired'}
									<!-- Diagonale streep als indicator voor opgeschoonde backup -->
									<div class="absolute inset-0 flex items-center justify-center">
										<div class="w-[141%] h-[1.5px] bg-base-content/30 rotate-45"></div>
									</div>
								{/if}
							</div>
						{:else}
							<div class="w-6 h-6"></div>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
	</div>

	<!-- Legenda -->
	<div class="flex flex-wrap items-center gap-4 mt-3 text-xs text-base-content/60">
		<div class="flex items-center gap-1">
			<div class="w-6 h-6 rounded-sm bg-success"></div>
			Back-up OK
		</div>
		<div class="flex items-center gap-1">
			<div class="w-6 h-6 rounded-sm bg-success/30 relative overflow-hidden">
				<div class="absolute inset-0 flex items-center justify-center">
					<div class="w-[141%] h-[1.5px] bg-base-content/30 rotate-45"></div>
				</div>
			</div>
			Opgeschoond
		</div>
		<div class="flex items-center gap-1">
			<div class="w-6 h-6 rounded-sm bg-error"></div>
			Mislukt
		</div>
		<div class="flex items-center gap-1">
			<div class="w-6 h-6 rounded-sm bg-warning/40"></div>
			Geen back-up
		</div>
		<div class="flex items-center gap-1">
			<div class="w-6 h-6 rounded-sm bg-base-content/10"></div>
			Geen data
		</div>
	</div>
</div>
