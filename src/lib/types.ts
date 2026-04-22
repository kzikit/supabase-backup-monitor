import type { Generated, Insertable, Selectable } from 'kysely';

// Database schema
export interface Database {
	supabase_backups: SupabaseBackupsTable;
	azure_backups: AzureBackupsTable;
	email_recipients: EmailRecipientsTable;
	app_settings: AppSettingsTable;
}

export interface AppSettingsTable {
	key: string;
	value: string;
}

export interface SupabaseBackupsTable {
	inserted_at: Date;
	is_physical_backup: boolean;
	status: string;
}

export interface EmailRecipientsTable {
	id: Generated<number>;
	name: string;
	email: string;
	created_at: Generated<Date>;
}

export interface AzureBackupsTable {
	timestamp: Date;
	status: string;
	duration_ms: number | null;
	tables_count: number | null;
	storage_files_count: number | null;
	manifest_blob: string | null;
	// Bron van de trigger:
	// - 'manual' → backup is handmatig gestart via UI
	// - 'cron'   → backup is automatisch gestart door de scheduler
	trigger_type: 'manual' | 'cron';
	// Uur in Europe/Amsterdam waarop de cron afging (0–23). NULL voor handmatige backups.
	cron_hour: number | null;
}

export type SupabaseBackup = Selectable<SupabaseBackupsTable>;
export type NewSupabaseBackup = Insertable<SupabaseBackupsTable>;
export type AzureBackup = Selectable<AzureBackupsTable>;
export type NewAzureBackup = Insertable<AzureBackupsTable>;
export type EmailRecipient = Selectable<EmailRecipientsTable>;
export type NewEmailRecipient = Insertable<EmailRecipientsTable>;

// Progress events voor SSE streaming bij handmatige backup
export interface BackupProgressEvent {
	phase: 'init' | 'database' | 'storage' | 'metadata' | 'manifest' | 'complete' | 'error';
	status: 'start' | 'done' | 'error';
	message: string;
	timestamp: string;
	data?: unknown;
}

// Redenen waarom een backup-waarschuwing wordt verstuurd
export type BackupAlertReason =
	| { type: 'api_error'; message: string }
	| { type: 'no_backup_today' }
	| { type: 'backup_not_completed'; status: string };

// Supabase API response
export interface SupabaseBackupResponse {
	region: string;
	pitr_enabled: boolean;
	walg_enabled: boolean;
	backups: SupabaseBackupEntry[];
	physical_backup_data: Record<string, unknown>;
}

export interface SupabaseBackupEntry {
	is_physical_backup: boolean;
	status: string;
	inserted_at: string;
}

// Trigger-bron van een Azure backup — bepaalt de bestandsnaam-prefix in blob storage.
// - 'manual' → blobs krijgen prefix `MANUAL-`
// - 'cron'   → blobs krijgen prefix `CRON{HH}-` (bv. `CRON06-`), waarbij HH het
//              uur in Europe/Amsterdam is op het moment dat de cron afgaat
export type BackupTrigger = { type: 'manual' } | { type: 'cron'; hour: number };

// Backup naar Azure Blob Storage
export interface BackupManifest {
	timestamp: string;
	duration_ms: number;
	supabase_project_ref: string;
	db: {
		schema_blob: string;
		data_blob: string;
		migrations_blob: string;
		tables: Array<{ name: string }>;
	};
	storage: {
		blob: string;
		buckets: Array<{ id: string; public: boolean; files_count: number }>;
		total_files: number;
	};
	metadata: {
		blob: string;
		storage_policies_count: number;
		realtime_tables_count: number;
		webhook_triggers_count: number;
		extensions: string[];
	};
	status: 'completed' | 'failed';
}

export interface BackupMetadata {
	timestamp: string;
	storage_policies: Array<{
		policyname: string;
		cmd: string;
		permissive: string;
		roles: string[];
		qual: string | null;
		with_check: string | null;
	}>;
	realtime_tables: Array<{ schemaname: string; tablename: string }>;
	webhook_triggers: Array<{
		trigger_name: string;
		table_name: string;
		schema_name: string;
		trigger_definition: string;
	}>;
	extensions: string[];
	tables: Array<{ name: string }>;
}
