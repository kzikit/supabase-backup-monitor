/**
 * Admin endpoint voor het eenmalig back-fillen van Azure-backups en het
 * toevoegen van `MANUAL-` / `CRON{HH}-` prefixen aan legacy blobs.
 *
 * Basic auth geldt globaal via `src/hooks.server.ts`.
 *
 * Gebruik:
 *   POST /api/admin/backfill          → dry-run (alleen rapport, geen wijzigingen)
 *   POST /api/admin/backfill?apply=1  → wijzigingen doorvoeren
 */

import { BlobServiceClient } from '@azure/storage-blob';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { runBackfill } from '$lib/server/backup-backfill';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ url }) => {
	const apply = url.searchParams.get('apply') === '1' || url.searchParams.get('apply') === 'true';

	if (!env.AZURE_STORAGE_CONNECTION_STRING) error(500, 'AZURE_STORAGE_CONNECTION_STRING niet ingesteld');
	if (!env.AZURE_BLOB_CONTAINER) error(500, 'AZURE_BLOB_CONTAINER niet ingesteld');

	const service = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING);
	const container = service.getContainerClient(env.AZURE_BLOB_CONTAINER);

	const report = await runBackfill(container, env.AZURE_BLOB_CONTAINER, db, { apply });

	return json(report);
};
