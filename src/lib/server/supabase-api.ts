import { env } from '$env/dynamic/private';
import type { SupabaseBackupResponse } from '$lib/types';

/**
 * Haal back-ups op van de Supabase Management API.
 */
export async function fetchBackups(): Promise<SupabaseBackupResponse> {
	const url = `${env.SUPABASE_API_URL || 'https://api.supabase.com'}/v1/projects/${env.SUPABASE_PROJECT_REF}/database/backups`;
	console.log(`[supabase-api] GET ${url}`);

	const res = await fetch(url, {
		headers: {
			Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`
		}
	});

	const body = await res.text();
	console.log(`[supabase-api] Status: ${res.status} ${res.statusText}`);
	console.log(`[supabase-api] Response body: ${body}`);

	if (!res.ok) {
		throw new Error(`Supabase API fout: ${res.status} ${res.statusText} — ${body}`);
	}

	return JSON.parse(body);
}
