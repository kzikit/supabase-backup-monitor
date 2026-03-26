import { SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } from '$env/dynamic/private';
import type { SupabaseBackupResponse } from '$lib/types';

/**
 * Haal back-ups op van de Supabase Management API.
 */
export async function fetchBackups(): Promise<SupabaseBackupResponse> {
	const res = await fetch(
		`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/backups`,
		{
			headers: {
				Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`
			}
		}
	);

	if (!res.ok) {
		throw new Error(`Supabase API fout: ${res.status} ${res.statusText}`);
	}

	return res.json();
}
