import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { env } from '$env/dynamic/private';
import type { Database } from '$lib/types';

const pool = new pg.Pool({
	connectionString: env.DATABASE_URL
});

export const db = new Kysely<Database>({
	dialect: new PostgresDialect({ pool })
});

/**
 * Voer migratie uit bij server startup.
 * Maakt tabellen aan als ze nog niet bestaan.
 */
export async function migrate() {
	await db.schema
		.createTable('supabase_backups')
		.ifNotExists()
		.addColumn('inserted_at', 'timestamptz', (col) => col.primaryKey())
		.addColumn('is_physical_backup', 'boolean', (col) => col.notNull())
		.addColumn('status', 'text', (col) => col.notNull())
		.execute();

	await db.schema
		.createTable('email_recipients')
		.ifNotExists()
		.addColumn('id', 'serial', (col) => col.primaryKey())
		.addColumn('name', 'text', (col) => col.notNull())
		.addColumn('email', 'text', (col) => col.notNull().unique())
		.addColumn('created_at', 'timestamptz', (col) => col.defaultTo('now()'))
		.execute();

	await db.schema
		.createTable('app_settings')
		.ifNotExists()
		.addColumn('key', 'text', (col) => col.primaryKey())
		.addColumn('value', 'text', (col) => col.notNull())
		.execute();

	await db.schema
		.createTable('azure_backups')
		.ifNotExists()
		.addColumn('timestamp', 'timestamptz', (col) => col.primaryKey())
		.addColumn('status', 'text', (col) => col.notNull())
		.addColumn('duration_ms', 'integer')
		.addColumn('tables_count', 'integer')
		.addColumn('storage_files_count', 'integer')
		.addColumn('manifest_blob', 'text')
		.addColumn('trigger_type', 'text', (col) => col.notNull().defaultTo('manual'))
		.addColumn('cron_hour', 'smallint')
		.execute();

	// Idempotente migratie: voor bestaande databases waar de azure_backups tabel
	// al bestond zonder deze kolommen. `IF NOT EXISTS` zorgt dat dit een no-op is
	// op verse databases (createTable hierboven heeft ze daar al toegevoegd).
	await sql`
		ALTER TABLE azure_backups
			ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'manual',
			ADD COLUMN IF NOT EXISTS cron_hour smallint
	`.execute(db);

	// Backfill bestaande rijen: lees trigger uit manifest_blob naam.
	// `manifests/CRON{HH}-...` → cron + uur, anders blijft default 'manual' staan.
	// We updaten alleen rijen die nog op de default 'manual' zitten zodat dit
	// idempotent en goedkoop is bij elke startup.
	await sql`
		UPDATE azure_backups
		SET trigger_type = 'cron',
		    cron_hour    = (substring(manifest_blob from '^manifests/CRON([0-9]{2})-'))::smallint
		WHERE manifest_blob ~ '^manifests/CRON[0-9]{2}-'
		  AND trigger_type = 'manual'
	`.execute(db);
}
