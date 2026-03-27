import type { RequestHandler } from './$types';
import type { SupabaseBackupResponse } from '$lib/types';
import { env } from '$env/dynamic/private';

/**
 * Nep-endpoint dat de Supabase Management API simuleert.
 * Gedrag wisselt per minuut:
 *   minuut % 4 === 1 → succes (COMPLETED)
 *   minuut % 4 === 2 → HTTP 500
 *   minuut % 4 === 3 → backup van vandaag ontbreekt
 *   minuut % 4 === 0 → backup bestaat maar status is FAILED
 */
export const GET: RequestHandler = async ({ request }) => {
	// Bearer token verificatie, net als de echte Supabase API
	const authHeader = request.headers.get('authorization');
	if (authHeader !== `Bearer ${env.SUPABASE_ACCESS_TOKEN}`) {
		return new Response(JSON.stringify({ message: 'Invalid API key' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const now = new Date();
	const minute = now.getMinutes();
	const scenario = minute % 4;
	const today = now.toISOString().split('T')[0];
	const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];

	// Scenario 2: server error
	if (scenario === 2) {
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const base: SupabaseBackupResponse = {
		region: 'eu-west-1',
		pitr_enabled: false,
		walg_enabled: true,
		backups: [],
		physical_backup_data: {}
	};

	// Scenario 3: backup van vandaag ontbreekt (alleen gisteren)
	if (scenario === 3) {
		base.backups = [
			{
				inserted_at: `${yesterday}T03:00:22.000Z`,
				is_physical_backup: false,
				status: 'COMPLETED'
			}
		];
		return Response.json(base);
	}

	// Scenario 4: backup bestaat maar status is FAILED
	if (scenario === 0) {
		base.backups = [
			{
				inserted_at: `${today}T03:00:22.000Z`,
				is_physical_backup: false,
				status: 'FAILED'
			},
			{
				inserted_at: `${yesterday}T03:00:22.000Z`,
				is_physical_backup: false,
				status: 'COMPLETED'
			}
		];
		return Response.json(base);
	}

	// Scenario 1 (succes): backup van vandaag is COMPLETED
	base.backups = [
		{
			inserted_at: `${today}T03:00:22.000Z`,
			is_physical_backup: false,
			status: 'COMPLETED'
		},
		{
			inserted_at: `${yesterday}T03:00:22.000Z`,
			is_physical_backup: false,
			status: 'COMPLETED'
		}
	];
	return Response.json(base);
};
