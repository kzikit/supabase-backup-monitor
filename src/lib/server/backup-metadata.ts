import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import pg from 'pg';
import { uploadJson } from './azure-storage';
import type { BackupMetadata } from '$lib/types';

const { Pool } = pg;

/**
 * Exporteert Supabase-metadata naar Azure Blob Storage als JSON.
 *
 * SQL-queries direct overgenomen uit de clone-scripts:
 * - Storage RLS policies (clone_supabase_storage.js:cloneStoragePolicies)
 * - Realtime config (clone_supabase_tables.js:cloneRealtimeConfig)
 * - Webhook triggers (clone_supabase_tables.js:recreateWebhooks)
 * - Extensies (clone_supabase_tables.js:getInstalledExtensions)
 * - Tabel-overzicht met rijtellingen (clone_supabase_tables.js:listTables)
 */
export async function backupMetadata(
	timestamp: string,
	dbUrl: string
): Promise<BackupMetadata> {
	const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 10000 });

	try {
		const [policies, realtime, webhooks, extensions, tables] = await Promise.all([
			// Storage RLS policies (uit clone_supabase_storage.js:cloneStoragePolicies)
			pool.query(`
				SELECT
					pol.polname as policyname,
					CASE pol.polcmd
						WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
						WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL'
					END as cmd,
					CASE pol.polpermissive WHEN true THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END as permissive,
					ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)) as roles,
					pg_get_expr(pol.polqual, pol.polrelid) as qual,
					pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
				FROM pg_policy pol
				JOIN pg_class cls ON pol.polrelid = cls.oid
				JOIN pg_namespace nsp ON cls.relnamespace = nsp.oid
				WHERE nsp.nspname = 'storage' AND cls.relname = 'objects'
			`),

			// Realtime publicatie config (uit clone_supabase_tables.js:cloneRealtimeConfig)
			pool.query(`
				SELECT schemaname, tablename
				FROM pg_publication_tables
				WHERE pubname = 'supabase_realtime'
			`),

			// Webhook triggers (uit clone_supabase_tables.js:recreateWebhooks)
			pool.query(`
				SELECT
					tgname as trigger_name, relname as table_name,
					nspname as schema_name, pg_get_triggerdef(t.oid) as trigger_definition
				FROM pg_trigger t
				JOIN pg_class c ON t.tgrelid = c.oid
				JOIN pg_namespace n ON c.relnamespace = n.oid
				WHERE NOT tgisinternal AND pg_get_triggerdef(t.oid) LIKE '%http_request%'
			`),

			// Geïnstalleerde extensies (uit clone_supabase_tables.js:getInstalledExtensions)
			pool.query(`SELECT extname FROM pg_extension ORDER BY extname`),

			// Tabel-overzicht (uit clone_supabase_tables.js:listTables)
			pool.query(`
				SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
			`)
		]);

		// Rijtellingen ophalen per tabel (uit clone_supabase_tables.js:listTables)
		const tableStats: Array<{ name: string; row_count: number }> = [];
		for (const row of tables.rows) {
			try {
				const count = await pool.query(
					`SELECT COUNT(*) as count FROM public."${row.tablename}"`
				);
				tableStats.push({
					name: row.tablename,
					row_count: parseInt(count.rows[0].count)
				});
			} catch {
				tableStats.push({ name: row.tablename, row_count: -1 });
			}
		}

		const metadata: BackupMetadata = {
			timestamp,
			storage_policies: policies.rows,
			realtime_tables: realtime.rows,
			webhook_triggers: webhooks.rows,
			extensions: extensions.rows.map((r: { extname: string }) => r.extname),
			tables: tableStats
		};

		await uploadJson(`metadata/${timestamp}.json`, metadata);

		console.log(
			`[backup-metadata] Klaar: ${policies.rows.length} policies, ` +
				`${realtime.rows.length} realtime tabellen, ` +
				`${webhooks.rows.length} webhook triggers, ` +
				`${extensions.rows.length} extensies, ` +
				`${tableStats.length} tabellen`
		);

		return metadata;
	} finally {
		await pool.end();
	}
}
