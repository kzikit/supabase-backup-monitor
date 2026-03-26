import type { Generated, Insertable, Selectable } from 'kysely';

// Database schema
export interface Database {
	supabase_backups: SupabaseBackupsTable;
	email_recipients: EmailRecipientsTable;
}

export interface SupabaseBackupsTable {
	inserted_at: string;
	is_physical_backup: boolean;
	status: string;
}

export interface EmailRecipientsTable {
	id: Generated<number>;
	name: string;
	email: string;
	created_at: Generated<string>;
}

export type SupabaseBackup = Selectable<SupabaseBackupsTable>;
export type NewSupabaseBackup = Insertable<SupabaseBackupsTable>;
export type EmailRecipient = Selectable<EmailRecipientsTable>;
export type NewEmailRecipient = Insertable<EmailRecipientsTable>;

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
