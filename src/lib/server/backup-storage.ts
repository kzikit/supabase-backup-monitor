import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import pg from 'pg';
import archiver from 'archiver';
import { uploadStream } from './azure-storage';

const { Pool } = pg;

// Zelfde concurrency als clone-scripts
const CONCURRENCY = 5;

// ============================================================================
// STORAGE REST API CLIENT
// ============================================================================

/**
 * Storage REST API client (patroon uit clone_supabase_storage.js:createStorageClient).
 * Gebruikt direct fetch() met service role key — geen @supabase/supabase-js nodig.
 */
function createStorageClient(projectRef: string, serviceRoleKey: string) {
	const baseUrl = `https://${projectRef}.supabase.co/storage/v1`;

	return {
		async listObjects(
			bucket: string,
			prefix = '',
			limit = 1000,
			offset = 0
		): Promise<Array<{ id: string | null; name: string; metadata?: { size?: number } }>> {
			const res = await fetch(`${baseUrl}/object/list/${bucket}`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${serviceRoleKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ prefix, limit, offset })
			});

			if (!res.ok) {
				throw new Error(`List objects mislukt: ${res.status} - ${await res.text()}`);
			}
			return res.json();
		},

		async getObject(
			bucket: string,
			key: string
		): Promise<{ buffer: Buffer; contentType: string }> {
			const res = await fetch(
				`${baseUrl}/object/${bucket}/${encodeURIComponent(key)}`,
				{
					headers: { Authorization: `Bearer ${serviceRoleKey}` }
				}
			);
			if (!res.ok) {
				throw new Error(`Get object mislukt: ${res.status} - ${await res.text()}`);
			}
			return {
				buffer: Buffer.from(await res.arrayBuffer()),
				contentType: res.headers.get('content-type') || 'application/octet-stream'
			};
		}
	};
}

// ============================================================================
// FILE LISTING
// ============================================================================

/**
 * Recursieve bestandslijst met paginatie (uit clone_supabase_storage.js:listAllObjects).
 * Mappen hebben id === null, bestanden hebben een id.
 */
async function listAllObjects(
	client: ReturnType<typeof createStorageClient>,
	bucket: string,
	prefix = ''
): Promise<Array<{ key: string; size: number }>> {
	const allObjects: Array<{ key: string; size: number }> = [];
	let offset = 0;
	const limit = 1000;

	while (true) {
		const items = await client.listObjects(bucket, prefix, limit, offset);
		if (!items?.length) break;

		for (const item of items) {
			if (item.id === null && item.name) {
				// Map — recursief verwerken (patroon uit clone-scripts)
				const folderPrefix = prefix ? `${prefix}/${item.name}` : item.name;
				const nested = await listAllObjects(client, bucket, folderPrefix);
				allObjects.push(...nested);
			} else if (item.name) {
				const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
				allObjects.push({ key: fullPath, size: item.metadata?.size || 0 });
			}
		}

		if (items.length < limit) break;
		offset += limit;
	}

	return allObjects;
}

// ============================================================================
// BUCKET METADATA
// ============================================================================

interface BucketRow {
	id: string;
	name: string;
	public: boolean;
	file_size_limit: number | null;
	allowed_mime_types: string[] | null;
}

/**
 * Haal bucket-definities op via SQL (uit clone_supabase_storage.js:getBucketsFromDatabase).
 */
async function getBucketsFromDb(dbUrl: string): Promise<BucketRow[]> {
	const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 10000 });
	try {
		const result = await pool.query(
			'SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id'
		);
		return result.rows;
	} finally {
		await pool.end();
	}
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

/** Extraheer project ref uit DB URL (uit shared.js:extractRefFromDbUrl). */
function extractRefFromDbUrl(dbUrl: string): string {
	const match = dbUrl.match(/db\.([^.]+)\.supabase\.co/);
	return match?.[1] ?? 'unknown';
}

/**
 * Backup alle storage buckets naar Azure Blob Storage als tar.gz.
 * Bestanden worden direct gestreamd — geen tussentijdse bestanden op disk.
 */
export async function backupStorage(
	timestamp: string,
	dbUrl: string,
	serviceRoleKey: string
): Promise<{ buckets: Array<{ id: string; public: boolean; files_count: number }>; totalFiles: number }> {
	const projectRef = extractRefFromDbUrl(dbUrl);
	const client = createStorageClient(projectRef, serviceRoleKey);
	const buckets = await getBucketsFromDb(dbUrl);

	if (!buckets.length) {
		console.log('[backup-storage] Geen buckets gevonden');
		return { buckets: [], totalFiles: 0 };
	}

	console.log(`[backup-storage] ${buckets.length} buckets gevonden: ${buckets.map((b) => b.id).join(', ')}`);

	const archive = archiver('tar', { gzip: true, gzipOptions: { level: 6 } });
	const blobPath = `storage/${timestamp}.tar.gz`;

	// Start upload terwijl archief wordt gevuld (streaming — geen disk I/O)
	const uploadPromise = uploadStream(blobPath, archive);

	const bucketStats: Array<{ id: string; public: boolean; files_count: number }> = [];

	for (const bucket of buckets) {
		let objects: Array<{ key: string; size: number }>;
		try {
			objects = await listAllObjects(client, bucket.id);
		} catch (err) {
			console.error(`[backup-storage] Listing mislukt voor bucket "${bucket.id}": ${err}`);
			bucketStats.push({ id: bucket.id, public: bucket.public, files_count: 0 });
			continue;
		}

		console.log(`[backup-storage] Bucket "${bucket.id}": ${objects.length} bestanden`);

		let filesCount = 0;

		// Download bestanden in batches van CONCURRENCY (patroon uit clone-scripts)
		for (let i = 0; i < objects.length; i += CONCURRENCY) {
			const batch = objects.slice(i, i + CONCURRENCY);
			const downloads = await Promise.all(
				batch.map(async (obj) => {
					try {
						const { buffer } = await client.getObject(bucket.id, obj.key);
						return { path: `${bucket.id}/${obj.key}`, buffer };
					} catch (err) {
						console.error(
							`[backup-storage] Download mislukt ${bucket.id}/${obj.key}: ${err}`
						);
						return null;
					}
				})
			);

			for (const dl of downloads) {
				if (dl) {
					archive.append(dl.buffer, { name: dl.path });
					filesCount++;
				}
			}
		}

		bucketStats.push({ id: bucket.id, public: bucket.public, files_count: filesCount });
	}

	archive.finalize();
	const totalSize = await uploadPromise;
	const totalFiles = bucketStats.reduce((s, b) => s + b.files_count, 0);

	console.log(
		`[backup-storage] Klaar: ${totalFiles} bestanden, ${(totalSize / 1024 / 1024).toFixed(2)} MB`
	);

	return { buckets: bucketStats, totalFiles };
}
