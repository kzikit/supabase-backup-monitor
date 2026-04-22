import { env } from '$env/dynamic/private';
import pg from 'pg';
import { backupDatabase } from './backup-db';
import { backupStorage } from './backup-storage';
import { backupMetadata } from './backup-metadata';
import { uploadJson } from './azure-storage';
import { db } from './db';
import type { BackupManifest, BackupProgressEvent, BackupTrigger } from '$lib/types';

const { Pool } = pg;

type ProgressCallback = (event: BackupProgressEvent) => void;

/**
 * Bouwt de bestandsnaam-prefix op basis van de trigger-bron:
 * - manueel → `MANUAL-`
 * - cron    → `CRON{HH}-` (HH = 2-cijferig uur in Europe/Amsterdam, bv. `CRON06-`)
 */
function buildPrefix(trigger: BackupTrigger): string {
	if (trigger.type === 'manual') return 'MANUAL-';
	const hh = trigger.hour.toString().padStart(2, '0');
	return `CRON${hh}-`;
}

/** Extraheer project ref uit DB URL (uit shared.js:extractRefFromDbUrl). */
function extractRefFromDbUrl(dbUrl: string): string {
	const match = dbUrl.match(/db\.([^.]+)\.supabase\.co/);
	return match?.[1] ?? 'unknown';
}

/** Slaat het backup-resultaat op in de lokale database. */
async function saveToDb(
	manifest: BackupManifest,
	manifestBlob: string,
	trigger: BackupTrigger
): Promise<void> {
	const trigger_type = trigger.type;
	const cron_hour = trigger.type === 'cron' ? trigger.hour : null;
	await db
		.insertInto('azure_backups')
		.values({
			timestamp: new Date(manifest.timestamp),
			status: manifest.status,
			duration_ms: manifest.duration_ms,
			tables_count: manifest.db.tables.length,
			storage_files_count: manifest.storage.total_files,
			manifest_blob: manifestBlob,
			trigger_type,
			cron_hour
		})
		.onConflict((oc) => oc.column('timestamp').doUpdateSet({
			status: manifest.status,
			duration_ms: manifest.duration_ms,
			tables_count: manifest.db.tables.length,
			storage_files_count: manifest.storage.total_files,
			manifest_blob: manifestBlob,
			trigger_type,
			cron_hour
		}))
		.execute();
}

/**
 * Voert een volledige backup uit: database + storage + metadata parallel.
 * Schrijft een manifest naar Azure Blob Storage.
 *
 * De `trigger` bepaalt de bestandsnaam-prefix in blob storage zodat handmatig
 * getriggerde back-ups direct te onderscheiden zijn van cron-back-ups.
 */
export async function runBackup(trigger: BackupTrigger): Promise<BackupManifest> {
	return runBackupWithProgress(trigger);
}

/**
 * Voert een backup uit met optionele progress callback voor SSE streaming.
 */
export async function runBackupWithProgress(
	trigger: BackupTrigger,
	onProgress?: ProgressCallback
): Promise<BackupManifest> {
	const emit = (event: BackupProgressEvent) => onProgress?.(event);
	const now = () => new Date().toISOString();

	const timestamp = new Date().toISOString();
	const start = Date.now();
	const prefix = buildPrefix(trigger);

	if (!env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is niet ingesteld');
	if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is niet ingesteld');

	const dbUrl = env.SUPABASE_DB_URL;
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

	// Advisory lock voorkomt dat twee back-ups tegelijk draaien (cron × manueel,
	// of een backup die langer dan 4 uur duurt). De lock leeft op de Postgres-
	// sessie van `lockClient`; valt de TCP-verbinding weg (crash, OOM, deploy),
	// dan laat Postgres de lock automatisch los — geen stale state.
	const lockPool = new Pool({ connectionString: dbUrl, max: 1, connectionTimeoutMillis: 10000 });
	const lockClient = await lockPool.connect();
	try {
		const { rows } = await lockClient.query(
			`SELECT pg_try_advisory_lock(hashtext('supabase-backup-monitor')) AS got`
		);
		if (!rows[0].got) {
			throw new Error('Er draait al een backup — nieuwe trigger geweigerd');
		}

		emit({ phase: 'init', status: 'start', message: `Backup wordt gestart (${prefix.replace(/-$/, '')})...`, timestamp: now() });
		console.log(`[backup] Start backup ${prefix}${timestamp}`);

		// Alle drie parallel met progress tracking
		const dbPromise = (async () => {
			emit({ phase: 'database', status: 'start', message: 'Database backup gestart (schema, data, migraties)...', timestamp: now() });
			const result = await backupDatabase(timestamp, dbUrl, prefix);
			emit({ phase: 'database', status: 'done', message: 'Database backup voltooid', timestamp: now() });
			return result;
		})();

		const storagePromise = (async () => {
			emit({ phase: 'storage', status: 'start', message: 'Storage backup gestart (buckets → tar.gz)...', timestamp: now() });
			const result = await backupStorage(timestamp, dbUrl, serviceRoleKey, prefix);
			emit({ phase: 'storage', status: 'done', message: `Storage backup voltooid — ${result.totalFiles} bestanden`, timestamp: now() });
			return result;
		})();

		const metadataPromise = (async () => {
			emit({ phase: 'metadata', status: 'start', message: 'Metadata backup gestart (policies, realtime, webhooks, extensies)...', timestamp: now() });
			const result = await backupMetadata(timestamp, dbUrl, prefix);
			emit({ phase: 'metadata', status: 'done', message: `Metadata backup voltooid — ${result.tables.length} tabellen`, timestamp: now() });
			return result;
		})();

		const [, storageResult, metadata] = await Promise.all([
			dbPromise,
			storagePromise,
			metadataPromise
		]);

		emit({ phase: 'manifest', status: 'start', message: 'Manifest wordt naar Azure geüpload...', timestamp: now() });

		const manifestBlob = `manifests/${prefix}${timestamp}.json`;
		const manifest: BackupManifest = {
			timestamp,
			duration_ms: Date.now() - start,
			supabase_project_ref: extractRefFromDbUrl(dbUrl),
			db: {
				schema_blob: `db/${prefix}${timestamp}-schema.sql.gz`,
				data_blob: `db/${prefix}${timestamp}-data.sql.gz`,
				migrations_blob: `db/${prefix}${timestamp}-migrations.sql.gz`,
				tables: metadata.tables
			},
			storage: {
				blob: `storage/${prefix}${timestamp}.tar.gz`,
				buckets: storageResult.buckets,
				total_files: storageResult.totalFiles
			},
			metadata: {
				blob: `metadata/${prefix}${timestamp}.json`,
				storage_policies_count: metadata.storage_policies.length,
				realtime_tables_count: metadata.realtime_tables.length,
				webhook_triggers_count: metadata.webhook_triggers.length,
				extensions: metadata.extensions
			},
			status: 'completed'
		};

		await uploadJson(manifestBlob, manifest);
		emit({ phase: 'manifest', status: 'done', message: 'Manifest geüpload', timestamp: now() });

		// Resultaat opslaan in lokale database
		await saveToDb(manifest, manifestBlob, trigger);

		emit({
			phase: 'complete',
			status: 'done',
			message: `Backup voltooid in ${(manifest.duration_ms / 1000).toFixed(1)}s — ${manifest.db.tables.length} tabellen, ${manifest.storage.total_files} bestanden`,
			timestamp: now(),
			data: manifest
		});

		console.log(
			`[backup] Klaar in ${manifest.duration_ms}ms — ` +
				`${manifest.db.tables.length} tabellen, ` +
				`${manifest.storage.total_files} storage bestanden, ` +
				`${manifest.metadata.extensions.length} extensies`
		);

		return manifest;
	} finally {
		lockClient.release();
		await lockPool.end();
	}
}
