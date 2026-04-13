<script lang="ts">
	// Na serialisatie door SvelteKit is timestamp een string
	interface AzureBackupRow {
		timestamp: string;
		status: string;
		duration_ms: number | null;
		tables_count: number | null;
		storage_files_count: number | null;
		manifest_blob: string | null;
		trigger_type: 'manual' | 'cron';
		cron_hour: number | null;
	}

	let { backups }: { backups: AzureBackupRow[] } = $props();

	// Scroll-container: initieel naar rechts scrollen zodat de meest recente
	// weken zichtbaar zijn
	let scrollContainer = $state<HTMLDivElement | null>(null);
	$effect(() => {
		if (scrollContainer) scrollContainer.scrollLeft = scrollContainer.scrollWidth;
	});

	// Aggregatie per dag. Cron en handmatig worden gescheiden geteld:
	// - cijfer in de cel = aantal GESLAAGDE cron-backups
	// - stippen boven het cijfer = aantal handmatige backups (status onafhankelijk)
	interface DayInfo {
		cronCompleted: number;
		cronFailed: number;
		manualTotal: number;
	}

	const backupDayMap = $derived(
		(() => {
			const map = new Map<string, DayInfo>();
			for (const b of backups) {
				const date = new Date(b.timestamp).toISOString().split('T')[0];
				const info = map.get(date) ?? { cronCompleted: 0, cronFailed: 0, manualTotal: 0 };
				if (b.trigger_type === 'cron') {
					if (b.status === 'completed') info.cronCompleted++;
					else info.cronFailed++;
				} else {
					info.manualTotal++;
				}
				map.set(date, info);
			}
			return map;
		})()
	);

	// Statussen:
	// - 'ok'      : minstens 1 geslaagde cron-backup (groene cel, toont aantal geslaagd)
	// - 'none'    : geen geslaagde cron-backup deze dag (rode cel met "0") —
	//               dagen met alleen handmatige backups vallen hier ook onder
	// - 'no-data' : helemaal geen gegevens voor deze dag (grijze cel)
	type DayStatus = 'ok' | 'none' | 'no-data';

	// Verwacht aantal geslaagde cron-backups per dag (6 = elke 4 uur)
	const EXPECTED_PER_DAY = 6;

	// Maximaal aantal stippen voordat we overschakelen op een diamantsymbool
	const MAX_DOTS = 3;

	function getDayStatus(dateStr: string): DayStatus {
		const info = backupDayMap.get(dateStr);
		if (!info) return 'no-data';
		if (info.cronCompleted >= 1) return 'ok';
		return 'none';
	}

	function getCronCount(dateStr: string): number {
		return backupDayMap.get(dateStr)?.cronCompleted ?? 0;
	}

	function getManualCount(dateStr: string): number {
		return backupDayMap.get(dateStr)?.manualTotal ?? 0;
	}

	// Render-vorm voor handmatige backups:
	// - 1..MAX_DOTS handmatig → evenveel '•'
	// - >MAX_DOTS → één diamant 🞙
	function manualMarker(n: number): string {
		if (n <= 0) return '';
		if (n > MAX_DOTS) return '🞙';
		return '•'.repeat(n);
	}

	const statusColors: Record<DayStatus, string> = {
		ok: 'bg-success',
		none: 'bg-error text-error-content',
		'no-data': 'bg-base-content/10'
	};

	// Stippen krijgen contrast met de celkleur
	function dotColorClass(status: DayStatus): string {
		if (status === 'ok') return 'text-black';
		if (status === 'none') return 'text-error-content';
		return 'text-base-content/70';
	}

	function dayTitle(dateStr: string): string {
		const info = backupDayMap.get(dateStr);
		if (!info) return `${dateStr}: Geen data`;
		const cronTotal = info.cronCompleted + info.cronFailed;
		const manualPart = info.manualTotal > 0 ? `, ${info.manualTotal} handmatig` : '';
		return `${dateStr}: ${info.cronCompleted}/${cronTotal} cron geslaagd${manualPart}`;
	}

	// Kleur van het getal in een groene cel:
	// - zwart als het verwachte aantal is gehaald
	// - oranje als het lager ligt dan verwacht
	function countTextClass(count: number, status: DayStatus): string {
		if (status !== 'ok') return '';
		return count >= EXPECTED_PER_DAY ? 'text-black' : 'text-orange-800';
	}

	// Kalendergrid: afgelopen 52 weken
	interface DayCell {
		date: string;
		status: DayStatus;
		count: number; // aantal geslaagde cron-backups
		manualCount: number; // aantal handmatige backups
	}

	const weeks = $derived.by(() => {
		const today = new Date();
		const result: DayCell[][] = [];

		const start = new Date(today);
		start.setDate(start.getDate() - 52 * 7 - ((start.getDay() + 6) % 7));

		let current = new Date(start);
		let week: DayCell[] = [];

		while (current <= today || week.length > 0) {
			const dateStr = current.toISOString().split('T')[0];
			const isFuture = current > today;

			if (!isFuture) {
				week.push({
					date: dateStr,
					status: getDayStatus(dateStr),
					count: getCronCount(dateStr),
					manualCount: getManualCount(dateStr)
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
								class="relative w-6 h-6 rounded-sm {statusColors[
									day.status
								]} flex items-center justify-center leading-none"
								title={dayTitle(day.date)}
							>
								{#if day.manualCount > 0}
									<span
										class="absolute top-[1px] left-1/2 -translate-x-1/2 text-[8px] leading-none tracking-tighter pointer-events-none {dotColorClass(
											day.status
										)}"
									>
										{manualMarker(day.manualCount)}
									</span>
								{/if}
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
			Cron: verwacht aantal gehaald (6)
		</div>
		<div class="flex items-center gap-1">
			<div class="w-6 h-6 rounded-sm bg-success flex items-center justify-center">
				<span class="text-[13px] font-bold text-orange-800">3</span>
			</div>
			Cron: minder dan 6 geslaagd
		</div>
		<div class="flex items-center gap-1">
			<div class="w-6 h-6 rounded-sm bg-error text-error-content flex items-center justify-center">
				<span class="text-[13px] font-bold">0</span>
			</div>
			Cron: geen geslaagde back-up
		</div>
		<div class="flex items-center gap-1">
			<div
				class="relative w-6 h-6 rounded-sm bg-success flex items-center justify-center leading-none"
			>
				<span
					class="absolute top-[1px] left-1/2 -translate-x-1/2 text-[8px] leading-none tracking-tighter text-black"
				>
					••
				</span>
				<span class="text-[13px] font-bold leading-none text-black">2</span>
			</div>
			• per handmatige backup (max {MAX_DOTS}, daarna 🞙)
		</div>
		<div class="flex items-center gap-1">
			<div class="w-6 h-6 rounded-sm bg-base-content/10"></div>
			Geen data
		</div>
	</div>
</div>
