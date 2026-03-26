import { Kysely, PostgresDialect } from 'kysely';
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
}
