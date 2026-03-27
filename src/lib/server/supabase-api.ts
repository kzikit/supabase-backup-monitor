import { env } from '$env/dynamic/private';
import type { SupabaseBackupResponse } from '$lib/types';

/**
 * Haal back-ups op van de Supabase Management API.
 */
export async function fetchBackups(): Promise<SupabaseBackupResponse> {
	const res = await fetch(
		`${env.SUPABASE_API_URL || 'https://api.supabase.com'}/v1/projects/${env.SUPABASE_PROJECT_REF}/database/backups`,
		{
			headers: {
				Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`
			}
		}
	);

	if (!res.ok) {
		throw new Error(`Supabase API fout: ${res.status} ${res.statusText}`);
	}

	return res.json();
}
