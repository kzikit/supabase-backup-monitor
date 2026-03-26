import type { RequestHandler } from './$types';
import { checkBackups } from '$lib/server/cron';

export const GET: RequestHandler = async () => {
	try {
		const result = await checkBackups();
		return new Response(
			JSON.stringify({ ok: true, ...result }),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[api/check-backups] Fout:', message);
		return new Response(
			JSON.stringify({ ok: false, error: message }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
