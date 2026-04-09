import { env } from '$env/dynamic/private';
import { backupDatabase } from './backup-db';
import { backupStorage } from './backup-storage';
import { backupMetadata } from './backup-metadata';
import { uploadJson } from './azure-storage';
import type { BackupManifest } from '$lib/types';

/** Extraheer project ref uit DB URL (uit shared.js:extractRefFromDbUrl). */
function extractRefFromDbUrl(dbUrl: string): string {
	const match = dbUrl.match(/db\.([^.]+)\.supabase\.co/);
	return match?.[1] ?? 'unknown';
}

/**
 * Voert een volledige backup uit: database + storage + metadata parallel.
 * Schrijft een manifest naar Azure Blob Storage.
 */
export async function runBackup(): Promise<BackupManifest> {
	const timestamp = new Date().toISOString();
	const start = Date.now();

	if (!env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is niet ingesteld');
	if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is niet ingesteld');

	const dbUrl = env.SUPABASE_DB_URL;
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

	console.log(`[backup] Start backup ${timestamp}`);

	// Alle drie parallel: database, storage, metadata
	const [dbResult, storageResult, metadata] = await Promise.all([
		backupDatabase(timestamp, dbUrl),
		backupStorage(timestamp, dbUrl, serviceRoleKey),
		backupMetadata(timestamp, dbUrl)
	]);

	const manifest: BackupManifest = {
		timestamp,
		duration_ms: Date.now() - start,
		supabase_project_ref: extractRefFromDbUrl(dbUrl),
		db: {
			schema_blob: `db/${timestamp}-schema.sql.gz`,
			data_blob: `db/${timestamp}-data.sql.gz`,
			migrations_blob: `db/${timestamp}-migrations.sql.gz`,
			tables: metadata.tables
		},
		storage: {
			blob: `storage/${timestamp}.tar.gz`,
			buckets: storageResult.buckets,
			total_files: storageResult.totalFiles
		},
		metadata: {
			blob: `metadata/${timestamp}.json`,
			storage_policies_count: metadata.storage_policies.length,
			realtime_tables_count: metadata.realtime_tables.length,
			webhook_triggers_count: metadata.webhook_triggers.length,
			extensions: metadata.extensions
		},
		status: 'completed'
	};

	await uploadJson(`manifests/${timestamp}.json`, manifest);

	console.log(
		`[backup] Klaar in ${manifest.duration_ms}ms — ` +
			`${manifest.db.tables.length} tabellen, ` +
			`${manifest.storage.total_files} storage bestanden, ` +
			`${manifest.metadata.extensions.length} extensies`
	);

	return manifest;
}
