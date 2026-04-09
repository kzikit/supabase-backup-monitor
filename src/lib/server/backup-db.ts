import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { execSync, spawn } from 'child_process';
import { createGzip } from 'zlib';
import { uploadStream } from './azure-storage';

/**
 * Valideer pg_dump versie (>= 15 vereist voor Supabase Postgres 15).
 * Patroon uit clone_supabase_tables.js:validatePgTools.
 */
function validatePgDump(): void {
	try {
		const output = execSync('pg_dump --version', { encoding: 'utf-8' });
		const match = output.match(/pg_dump \(PostgreSQL\) (\d+)/);
		if (!match || parseInt(match[1], 10) < 15) {
			throw new Error(`pg_dump >= 15 vereist, gevonden: ${output.trim()}`);
		}
		console.log(`[backup-db] ${output.trim()}`);
	} catch (err) {
		if (err instanceof Error && err.message.includes('pg_dump >= 15')) throw err;
		throw new Error('pg_dump niet gevonden — installeer postgresql-client');
	}
}

/**
 * Streamt pg_dump output → gzip → Azure Blob.
 *
 * Foutafhandeling gebaseerd op het streamDump-patroon uit clone_supabase_tables.js:
 * - EPIPE errors netjes afhandelen
 * - stderr verzamelen voor foutrapportage
 * - Exit code tracken
 */
function streamPgDumpToAzure(
	dbUrl: string,
	pgDumpArgs: string[],
	blobPath: string
): Promise<number> {
	return new Promise((resolve, reject) => {
		const pgDump = spawn('pg_dump', [...pgDumpArgs, dbUrl], {
			stdio: ['ignore', 'pipe', 'pipe']
		});

		const gzip = createGzip({ level: 6 });
		const stream = pgDump.stdout.pipe(gzip);

		let stderr = '';
		pgDump.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		// EPIPE afhandeling (patroon uit clone-scripts)
		pgDump.stdout.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code !== 'EPIPE') {
				console.error(`[backup-db] pg_dump stdout fout: ${err.message}`);
			}
		});

		pgDump.on('error', (err) => {
			reject(new Error(`pg_dump proces fout: ${err.message}`));
		});

		pgDump.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`pg_dump mislukt (code ${code}): ${stderr}`));
			}
		});

		uploadStream(blobPath, stream).then(resolve).catch(reject);
	});
}

/**
 * Maakt een volledige database-backup naar Azure Blob Storage.
 *
 * Drie gescheiden dumps (patroon uit clone_supabase_tables.js):
 * 1. Schema (DDL): tabellen, types, functies
 * 2. Data: INSERT statements met --rows-per-insert=1000
 * 3. Migrations: supabase_migrations.schema_migrations tabel
 */
export async function backupDatabase(
	timestamp: string,
	dbUrl: string
): Promise<{ schemaSize: number; dataSize: number; migrationsSize: number }> {
	validatePgDump();

	// 1. Schema dump (DDL) — --no-comments voorkomt encoding-problemen
	console.log('[backup-db] Schema dump starten...');
	const schemaSize = await streamPgDumpToAzure(
		dbUrl,
		['--schema=public', '--schema-only', '--no-owner', '--no-privileges', '--no-comments'],
		`db/${timestamp}-schema.sql.gz`
	);
	console.log(`[backup-db] Schema dump klaar: ${schemaSize} bytes`);

	// 2. Data dump — --rows-per-insert=1000 voor batch performance
	console.log('[backup-db] Data dump starten...');
	const dataSize = await streamPgDumpToAzure(
		dbUrl,
		[
			'--schema=public',
			'--data-only',
			'--no-owner',
			'--no-privileges',
			'--rows-per-insert=1000'
		],
		`db/${timestamp}-data.sql.gz`
	);
	console.log(`[backup-db] Data dump klaar: ${dataSize} bytes`);

	// 3. Migrations tabel (zoals clone_supabase_tables.js stap 4)
	console.log('[backup-db] Migrations dump starten...');
	const migrationsSize = await streamPgDumpToAzure(
		dbUrl,
		[
			'--table=supabase_migrations.schema_migrations',
			'--data-only',
			'--no-owner',
			'--no-privileges',
			'--rows-per-insert=1000'
		],
		`db/${timestamp}-migrations.sql.gz`
	);
	console.log(`[backup-db] Migrations dump klaar: ${migrationsSize} bytes`);

	return { schemaSize, dataSize, migrationsSize };
}
