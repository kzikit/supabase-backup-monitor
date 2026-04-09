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

	// Bouw een map van datum → status (meerdere backups per dag mogelijk, neem de beste)
	const backupStatusMap = $derived(new Map(
		(() => {
			const map = new Map<string, string>();
			// Sorteer zodat 'completed' wint over 'failed'
			for (const b of [...backups].reverse()) {
				const date = new Date(b.timestamp).toISOString().split('T')[0];
				const existing = map.get(date);
				if (!existing || b.status === 'completed') {
					map.set(date, b.status);
				}
			}
			return [...map.entries()];
		})()
	));

	type DayStatus = 'completed' | 'failed' | 'no-data';

	function getDayStatus(dateStr: string): DayStatus {
		const status = backupStatusMap.get(dateStr);
		if (status === undefined) return 'no-data';
		if (status === 'completed') return 'completed';
		return 'failed';
	}

	const statusColors: Record<DayStatus, string> = {
		completed: 'bg-success',
		failed: 'bg-error',
		'no-data': 'bg-base-content/10'
	};

	const statusLabels: Record<DayStatus, string> = {
		completed: 'Back-up OK',
		failed: 'Back-up mislukt',
		'no-data': 'Geen data'
	};

	// Kalendergrid: afgelopen 52 weken
	const weeks = $derived.by(() => {
		const today = new Date();
		const result: { date: string; status: DayStatus; isFuture: boolean }[][] = [];

		const start = new Date(today);
		start.setDate(start.getDate() - 52 * 7 - ((start.getDay() + 6) % 7));

		let current = new Date(start);
		let week: { date: string; status: DayStatus; isFuture: boolean }[] = [];

		while (current <= today || week.length > 0) {
			const dateStr = current.toISOString().split('T')[0];
			const isFuture = current > today;

			if (!isFuture) {
				week.push({ date: dateStr, status: getDayStatus(dateStr), isFuture: false });
			}

			if (current.getDay() === 0 || isFuture) {
				if (week.length > 0) {
					result.push(week);
					week = [];
				}
				if (isFuture) break;
			}

			current.setDate(current.getDate() + 1);
		}

		if (week.length > 0) result.push(week);
		return result;
	});

	const dayLabels = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];

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
	<h3 class="text-sm font-medium mb-3">Aangepaste backups naar Azure (afgelopen jaar)</h3>

	<div class="overflow-x-auto">
		<div class="inline-flex flex-col gap-[3px] min-w-max">
			<!-- Maandlabels -->
			<div class="flex gap-[3px] ml-8 mb-1">
				{#each monthLabels as { label, col }, i (col)}
					{@const nextCol = monthLabels[i + 1]?.col ?? weeks.length}
					<span class="text-xs text-base-content/50" style="width: {(nextCol - col) * 19}px">
						{label}
					</span>
				{/each}
			</div>

			<!-- Grid -->
			{#each dayLabels as label, dayIndex (label)}
				<div class="flex items-center gap-[3px]">
					<span class="text-xs text-base-content/50 w-6 text-right pr-1">
						{dayIndex % 2 === 0 ? label : ''}
					</span>
					{#each weeks as week, weekIndex (weekIndex)}
						{@const day = week[dayIndex]}
						{#if day}
							<div
								class="w-4 h-4 rounded-sm {statusColors[day.status]}"
								title="{day.date}: {statusLabels[day.status]}"
							></div>
						{:else}
							<div class="w-4 h-4"></div>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
	</div>

	<!-- Legenda -->
	<div class="flex flex-wrap items-center gap-4 mt-3 text-xs text-base-content/60">
		<div class="flex items-center gap-1">
			<div class="w-4 h-4 rounded-sm bg-success"></div>
			Back-up OK
		</div>
		<div class="flex items-center gap-1">
			<div class="w-4 h-4 rounded-sm bg-error"></div>
			Mislukt
		</div>
		<div class="flex items-center gap-1">
			<div class="w-4 h-4 rounded-sm bg-base-content/10"></div>
			Geen data
		</div>
	</div>
</div>
