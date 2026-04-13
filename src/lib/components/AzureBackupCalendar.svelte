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

	// Scroll-container: initieel naar rechts scrollen zodat de meest recente
	// weken zichtbaar zijn
	let scrollContainer = $state<HTMLDivElement | null>(null);
	$effect(() => {
		if (scrollContainer) scrollContainer.scrollLeft = scrollContainer.scrollWidth;
	});

	// Bouw een map van datum → { status, count } (meerdere backups per dag)
	interface DayInfo {
		status: string;
		total: number;
		completed: number;
		failed: number;
	}

	const backupDayMap = $derived(
		(() => {
			const map = new Map<string, DayInfo>();
			for (const b of backups) {
				const date = new Date(b.timestamp).toISOString().split('T')[0];
				const existing = map.get(date);
				if (existing) {
					existing.total++;
					if (b.status === 'completed') existing.completed++;
					else existing.failed++;
					// Status is 'completed' als minstens 1 succesvol
					if (b.status === 'completed') existing.status = 'completed';
				} else {
					map.set(date, {
						status: b.status,
						total: 1,
						completed: b.status === 'completed' ? 1 : 0,
						failed: b.status === 'completed' ? 0 : 1
					});
				}
			}
			return map;
		})()
	);

	// Statussen:
	// - 'ok'      : minstens 1 geslaagde back-up (groene cel, toont aantal geslaagd)
	// - 'none'    : geen geslaagde back-up deze dag (rode cel met "0")
	// - 'no-data' : helemaal geen gegevens voor deze dag (grijze cel)
	type DayStatus = 'ok' | 'none' | 'no-data';

	// Verwacht aantal geslaagde back-ups per dag (6 = elke 4 uur)
	const EXPECTED_PER_DAY = 6;

	function getDayStatus(dateStr: string): DayStatus {
		const info = backupDayMap.get(dateStr);
		if (!info) return 'no-data';
		if (info.completed >= 1) return 'ok';
		return 'none';
	}

	function getDayCount(dateStr: string): number {
		// Toon het aantal GESLAAGDE back-ups in de cel
		return backupDayMap.get(dateStr)?.completed ?? 0;
	}

	const statusColors: Record<DayStatus, string> = {
		ok: 'bg-success',
		none: 'bg-error text-error-content',
		'no-data': 'bg-base-content/10'
	};

	function dayTitle(dateStr: string): string {
		const info = backupDayMap.get(dateStr);
		if (!info) return `${dateStr}: Geen data`;
		return `${dateStr}: ${info.completed}/${info.total} geslaagd`;
	}

	// Kleur van het getal in een groene cel:
	// - zwart als het verwachte aantal is gehaald
	// - oranje als het lager ligt dan verwacht
	function countTextClass(count: number, status: DayStatus): string {
		if (status !== 'ok') return '';
		return count >= EXPECTED_PER_DAY ? 'text-black' : 'text-warning';
	}

	// Kalendergrid: afgelopen 52 weken
	const weeks = $derived.by(() => {
		const today = new Date();
		const result: { date: string; status: DayStatus; count: number }[][] = [];

		const start = new Date(today);
		start.setDate(start.getDate() - 52 * 7 - ((start.getDay() + 6) % 7));

		let current = new Date(start);
		let week: { date: string; status: DayStatus; count: number }[] = [];

		while (current <= today || week.length > 0) {
			const dateStr = current.toISOString().split('T')[0];
			const isFuture = current > today;

			if (!isFuture) {
				week.push({
					date: dateStr,
					status: getDayStatus(dateStr),
					count: getDayCount(dateStr)
				});
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

	<div class="overflow-x-auto" bind:this={scrollContainer}>
		<div class="inline-flex flex-col gap-[3px] min-w-max">
			<!-- Maandlabels -->
			<div class="flex gap-[3px] ml-8 mb-1">
				{#each monthLabels as { label, col }, i (col)}
					{@const nextCol = monthLabels[i + 1]?.col ?? weeks.length}
					<span class="text-xs text-base-content/50" style="width: {(nextCol - col) * 27}px">
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
								class="w-6 h-6 rounded-sm {statusColors[day.status]} flex items-center justify-center"
								title={dayTitle(day.date)}
							>
								{#if day.status === 'ok'}
									<span
										class="text-[13px] font-bold leading-none {countTextClass(
											day.count,
											day.status
										)}"
									>
										{day.count}
									</span>
								{:else if day.status === 'none'}
									<span class="text-[13px] font-bold leading-none">0</span>
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
			<div class="w-6 h-6 rounded-sm bg-success flex items-center justify-center">
				<span class="text-[13px] font-bold text-black">6</span>
			</div>
			Verwacht aantal gehaald (6)
		</div>
		<div class="flex items-center gap-1">
			<div class="w-6 h-6 rounded-sm bg-success flex items-center justify-center">
				<span class="text-[13px] font-bold text-warning">3</span>
			</div>
			Minder dan 6 geslaagd
		</div>
		<div class="flex items-center gap-1">
			<div class="w-6 h-6 rounded-sm bg-error text-error-content flex items-center justify-center">
				<span class="text-[13px] font-bold">0</span>
			</div>
			Geen geslaagde back-up
		</div>
		<div class="flex items-center gap-1">
			<div class="w-6 h-6 rounded-sm bg-base-content/10"></div>
			Geen data
		</div>
	</div>
</div>
