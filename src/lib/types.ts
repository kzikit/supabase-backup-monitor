import type { Generated, Insertable, Selectable } from 'kysely';

// Database schema
export interface Database {
	supabase_backups: SupabaseBackupsTable;
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

export type SupabaseBackup = Selectable<SupabaseBackupsTable>;
export type NewSupabaseBackup = Insertable<SupabaseBackupsTable>;
export type EmailRecipient = Selectable<EmailRecipientsTable>;
export type NewEmailRecipient = Insertable<EmailRecipientsTable>;

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

// Backup naar Azure Blob Storage
export interface BackupManifest {
	timestamp: string;
	duration_ms: number;
	supabase_project_ref: string;
	db: {
		schema_blob: string;
		data_blob: string;
		migrations_blob: string;
		tables: Array<{ name: string; row_count: number }>;
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
	tables: Array<{ name: string; row_count: number }>;
}
