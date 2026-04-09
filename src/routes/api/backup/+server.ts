import { json } from '@sveltejs/kit';
import { runBackup } from '$lib/server/backup-orchestrator';

/**
 * Handmatige trigger voor een Azure backup.
 * POST /api/backup
 */
export async function POST() {
	try {
		const manifest = await runBackup();
		return json(manifest);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[api/backup] Backup mislukt:', message);
		return json({ error: message }, { status: 500 });
	}
}
