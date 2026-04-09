import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

/**
 * Healthcheck endpoint voor externe monitoring (bijv. UptimeRobot).
 * Retourneert altijd HTTP 200 zodat monitoring tools niet falen op de check zelf.
 */
export const GET: RequestHandler = async () => {
	try {
		// Haal de meest recente backup op
		const lastBackup = await db
			.selectFrom('supabase_backups')
			.select(['inserted_at', 'status'])
			.orderBy('inserted_at', 'desc')
			.limit(1)
			.executeTakeFirst();

		// Bepaal het begin van vandaag (UTC) om te checken of er vandaag een backup is
		const todayStart = new Date();
		todayStart.setUTCHours(0, 0, 0, 0);

		// Check of er vandaag een COMPLETED backup is
		const todayCompleted = await db
			.selectFrom('supabase_backups')
			.select('inserted_at')
			.where('status', '=', 'COMPLETED')
			.where('inserted_at', '>=', todayStart)
			.limit(1)
			.executeTakeFirst();

		const todayBackupOk = !!todayCompleted;

		// Bepaal de overall status
		let status: 'healthy' | 'unhealthy' | 'unknown';
		if (!lastBackup) {
			status = 'unknown';
		} else if (todayBackupOk) {
			status = 'healthy';
		} else {
			status = 'unhealthy';
		}

		return new Response(
			JSON.stringify({
				status,
				lastBackup: lastBackup
					? {
							timestamp: new Date(lastBackup.inserted_at).toISOString(),
							status: lastBackup.status
						}
					: null,
				todayBackupOk,
				timestamp: new Date().toISOString()
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch (err) {
		// Bij een database-fout toch 200 retourneren met unhealthy status
		const message = err instanceof Error ? err.message : String(err);
		console.error('[api/health] Database-fout:', message);

		return new Response(
			JSON.stringify({
				status: 'unhealthy',
				lastBackup: null,
				todayBackupOk: false,
				timestamp: new Date().toISOString(),
				error: message
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	}
};
