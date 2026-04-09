import { runBackupWithProgress } from '$lib/server/backup-orchestrator';
import type { BackupProgressEvent } from '$lib/types';

/**
 * Handmatige trigger voor een Azure backup met SSE progress streaming.
 * POST /api/backup
 */
export async function POST() {
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			function send(event: BackupProgressEvent) {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
			}

			try {
				await runBackupWithProgress(send);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error('[api/backup] Backup mislukt:', message);
				send({
					phase: 'error',
					status: 'error',
					message: `Backup mislukt: ${message}`,
					timestamp: new Date().toISOString()
				});
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
}
