<script lang="ts">
	import type { BackupProgressEvent } from '$lib/types';

	let { events }: { events: BackupProgressEvent[] } = $props();

	// Auto-scroll naar beneden bij nieuwe events
	function autoscroll(node: HTMLDivElement) {
		$effect(() => {
			if (events.length) {
				node.scrollTop = node.scrollHeight;
			}
		});
	}

	const phaseIcons: Record<string, string> = {
		init: '▶',
		database: '🗄',
		storage: '📦',
		metadata: '📋',
		manifest: '📝',
		complete: '✓',
		error: '✗'
	};

	function formatTime(ts: string): string {
		return new Date(ts).toLocaleTimeString('nl-NL', { timeStyle: 'medium' });
	}

	function statusColor(event: BackupProgressEvent): string {
		if (event.status === 'error') return 'text-error';
		if (event.status === 'done' && event.phase === 'complete') return 'text-success font-semibold';
		if (event.status === 'done') return 'text-success';
		return 'text-base-content/70';
	}
</script>

<div
	use:autoscroll
	class="bg-base-300 rounded-lg border border-base-content/10 font-mono text-xs overflow-y-auto max-h-64 p-3 space-y-0.5"
>
	{#each events as event (event.timestamp + event.phase)}
		<div class="flex gap-2 {statusColor(event)}">
			<span class="text-base-content/40 shrink-0">{formatTime(event.timestamp)}</span>
			<span class="shrink-0 w-4 text-center">{phaseIcons[event.phase] ?? '·'}</span>
			<span>{event.message}</span>
			{#if event.status === 'start'}
				<span class="loading loading-dots loading-xs ml-1"></span>
			{/if}
		</div>
	{:else}
		<div class="text-base-content/40 italic">Wachten op start...</div>
	{/each}
</div>
