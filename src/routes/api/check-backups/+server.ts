import type { RequestHandler } from './$types';
import { checkBackups } from '$lib/server/cron';

export const GET: RequestHandler = async () => {
	await checkBackups();
	return new Response(JSON.stringify({ ok: true, message: 'Back-up check uitgevoerd' }), {
		headers: { 'Content-Type': 'application/json' }
	});
};
