/**
 * Gedeelde core voor het backfill/renaming-proces van Azure-backups.
 *
 * Wordt aangeroepen door:
 * - `scripts/backfill-azure-prefix.ts` (CLI tegen lokale DB)
 * - `src/routes/api/admin/backfill/+server.ts` (HTTP endpoint tegen deployed DB)
 *
 * Logica:
 * - Legacy blobs zonder prefix krijgen `MANUAL-` of `CRON{HH}-` op basis van
 *   een ±1 min venster rond cron-slots in Europe/Amsterdam.
 * - Groepen zonder manifest JSON worden beschouwd als mislukte back-ups en
 *   volledig **verwijderd**.
 * - Manifest JSONs worden met bijgewerkte interne paden opnieuw geüpload.
 * - Back-fill van `azure_backups` alleen voor manifests die in Azure bestaan.
 */

import type { ContainerClient } from '@azure/storage-blob';
import type { Kysely } from 'kysely';
import type { Database } from '$lib/types';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const CRON_HOURS = [2, 6, 10, 14, 18, 22]; // Europe/Amsterdam
const CRON_WINDOW_MIN = 1;
const FOLDERS = ['db', 'storage', 'metadata', 'manifests'] as const;
type Folder = (typeof FOLDERS)[number];

const ISO_RE = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/;
const PREFIX_RE = /^(MANUAL-|CRON\d{2}-)/;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BlobInfo {
	name: string;
	folder: Folder;
	filename: string;
	prefix: string | null;
	timestamp: string;
	suffix: string;
}

export interface RenamePlan {
	timestamp: string;
	targetPrefix: string;
	reason: string;
	oldToNew: Array<[string, string]>; // geordend, niet Map (serialiseerbaar naar JSON)
}

export interface DeletePlan {
	timestamp: string;
	reason: string;
	blobs: string[];
}

export interface DbUpdate {
	timestamp: string;
	oldManifestBlob: string;
	newManifestBlob: string;
}

export interface Backfill {
	timestamp: string;
	manifestBlob: string;
}

export interface BackfillReport {
	mode: 'dry-run' | 'apply';
	container: string;
	blobsScanned: number;
	timestampGroups: number;
	renames: RenamePlan[];
	deletes: DeletePlan[];
	dbUpdates: DbUpdate[];
	backfills: Backfill[];
	warnings: string[];
	logs: string[];
}

interface BackupManifest {
	timestamp: string;
	duration_ms?: number;
	status?: string;
	db?: {
		schema_blob?: string;
		data_blob?: string;
		migrations_blob?: string;
		tables?: Array<{ name: string; row_count?: number }>;
	};
	storage?: { blob?: string; total_files?: number };
	metadata?: { blob?: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function classifyPrefix(timestampISO: string): { prefix: string; reason: string } {
	const date = new Date(timestampISO);
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/Amsterdam',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(date);
	const hh = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
	const mm = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
	const total = hh * 60 + mm;

	for (const ch of CRON_HOURS) {
		const target = ch * 60;
		const abs = Math.abs(total - target);
		const diff = Math.min(abs, 1440 - abs);
		if (diff <= CRON_WINDOW_MIN) {
			const pad = ch.toString().padStart(2, '0');
			return {
				prefix: `CRON${pad}-`,
				reason: `Amsterdam ${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')} ligt binnen ${CRON_WINDOW_MIN} min van cron-slot ${pad}:00`
			};
		}
	}
	return {
		prefix: 'MANUAL-',
		reason: `Amsterdam ${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')} ligt niet bij een cron-slot`
	};
}

function parseBlob(name: string): BlobInfo | null {
	const slash = name.indexOf('/');
	if (slash < 0) return null;
	const folder = name.slice(0, slash) as Folder;
	if (!FOLDERS.includes(folder)) return null;

	const filename = name.slice(slash + 1);
	const prefixMatch = filename.match(PREFIX_RE);
	const prefix = prefixMatch ? prefixMatch[1] : null;
	const afterPrefix = prefix ? filename.slice(prefix.length) : filename;

	const tsMatch = afterPrefix.match(ISO_RE);
	if (!tsMatch || tsMatch.index !== 0) return null;

	const timestamp = tsMatch[1];
	const suffix = afterPrefix.slice(timestamp.length);
	return { name, folder, filename, prefix, timestamp, suffix };
}

function buildNewName(blob: BlobInfo, prefix: string): string {
	return `${blob.folder}/${prefix}${blob.timestamp}${blob.suffix}`;
}

/**
 * Leid trigger-info af uit de manifest-blobnaam.
 * - `manifests/CRON{HH}-...` → cron + uur
 * - alles anders (bv. `manifests/MANUAL-...`) → manual
 */
function triggerFromManifestBlob(manifestBlob: string): {
	trigger_type: 'manual' | 'cron';
	cron_hour: number | null;
} {
	const m = manifestBlob.match(/^manifests\/CRON(\d{2})-/);
	if (m) return { trigger_type: 'cron', cron_hour: parseInt(m[1], 10) };
	return { trigger_type: 'manual', cron_hour: null };
}

/** Download + upload om de blob te 'hernoemen' (Azure heeft geen native rename). */
async function copyBlob(
	container: ContainerClient,
	oldPath: string,
	newPath: string
): Promise<void> {
	const src = container.getBlockBlobClient(oldPath);
	const dst = container.getBlockBlobClient(newPath);
	const props = await src.getProperties();
	const buf = await src.downloadToBuffer();
	await dst.upload(buf, buf.length, {
		blobHTTPHeaders: {
			blobContentType: props.contentType,
			blobContentEncoding: props.contentEncoding
		}
	});
}

function rewritePathInManifest(
	oldPath: string | undefined,
	lookup: Map<string, string>
): string | undefined {
	if (!oldPath) return oldPath;
	return lookup.get(oldPath) ?? oldPath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function runBackfill(
	container: ContainerClient,
	containerName: string,
	db: Kysely<Database>,
	options: { apply: boolean }
): Promise<BackfillReport> {
	const report: BackfillReport = {
		mode: options.apply ? 'apply' : 'dry-run',
		container: containerName,
		blobsScanned: 0,
		timestampGroups: 0,
		renames: [],
		deletes: [],
		dbUpdates: [],
		backfills: [],
		warnings: [],
		logs: []
	};
	const log = (msg: string) => report.logs.push(msg);
	const warn = (msg: string) => report.warnings.push(msg);

	// 1. Alle blobs listen
	const blobs: BlobInfo[] = [];
	for await (const b of container.listBlobsFlat()) {
		const info = parseBlob(b.name);
		if (info) blobs.push(info);
	}
	report.blobsScanned = blobs.length;

	// 2. Groeperen per timestamp
	const groups = new Map<string, BlobInfo[]>();
	for (const b of blobs) {
		const list = groups.get(b.timestamp) ?? [];
		list.push(b);
		groups.set(b.timestamp, list);
	}
	report.timestampGroups = groups.size;

	// 3. Plan opbouwen: rename, delete, of skip (al correct)
	for (const [ts, items] of groups) {
		const prefixes = new Set(items.map((i) => i.prefix));
		if (prefixes.size > 1) {
			warn(
				`${ts}: inconsistente prefixen (${[...prefixes].map((p) => p ?? '<geen>').join(', ')}) — overslaan`
			);
			continue;
		}
		const [current] = prefixes;
		if (current !== null) continue; // al geprefixeerd

		// Heeft deze groep een manifest? Zo niet → mislukte backup, verwijderen
		const hasManifest = items.some((b) => b.folder === 'manifests');
		if (!hasManifest) {
			report.deletes.push({
				timestamp: ts,
				reason: 'geen manifest JSON aanwezig — mislukte backup',
				blobs: items.map((b) => b.name)
			});
			continue;
		}

		const { prefix, reason } = classifyPrefix(ts);
		const oldToNew: Array<[string, string]> = items.map((b) => [b.name, buildNewName(b, prefix)]);
		report.renames.push({ timestamp: ts, targetPrefix: prefix, reason, oldToNew });
	}

	// 4. DB-rijen zonder prefix in manifest_blob
	const badDbRows = await db
		.selectFrom('azure_backups')
		.select(['timestamp', 'manifest_blob'])
		.where('manifest_blob', 'is not', null)
		.where('manifest_blob', 'not like', 'manifests/MANUAL-%')
		.where('manifest_blob', 'not like', 'manifests/CRON%')
		.execute();

	// Map oldManifest → rename, voor snelle lookup
	const renameByOldManifest = new Map<string, RenamePlan>();
	for (const r of report.renames) {
		for (const [oldPath] of r.oldToNew) {
			if (oldPath.startsWith('manifests/')) renameByOldManifest.set(oldPath, r);
		}
	}

	for (const row of badDbRows) {
		if (!row.manifest_blob) continue;
		const rename = renameByOldManifest.get(row.manifest_blob);
		if (!rename) {
			warn(`DB-rij ${row.timestamp.toISOString()}: manifest_blob "${row.manifest_blob}" heeft geen overeenkomstige Azure rename-plan — overslaan`);
			continue;
		}
		const newManifest = rename.oldToNew.find(([o]) => o === row.manifest_blob)![1];
		report.dbUpdates.push({
			timestamp: row.timestamp.toISOString(),
			oldManifestBlob: row.manifest_blob,
			newManifestBlob: newManifest
		});
	}

	// 5. Back-fill kandidaten (manifests zonder DB-rij)
	const manifestBlobs = blobs.filter((b) => b.folder === 'manifests');
	const dbTimestamps = await db.selectFrom('azure_backups').select('timestamp').execute();
	const dbTsSet = new Set(dbTimestamps.map((r) => r.timestamp.toISOString()));
	for (const m of manifestBlobs) {
		if (dbTsSet.has(m.timestamp)) continue;
		// Gebruik de nieuwe naam indien deze gaat worden hernoemd
		const rename = report.renames.find((r) => r.timestamp === m.timestamp);
		const manifestBlob = rename
			? rename.oldToNew.find(([o]) => o === m.name)![1]
			: m.name;
		report.backfills.push({ timestamp: m.timestamp, manifestBlob });
	}

	log(
		`Scan: ${report.blobsScanned} blobs, ${report.timestampGroups} groepen → ` +
			`${report.renames.length} rename, ${report.deletes.length} delete, ` +
			`${report.dbUpdates.length} DB-update, ${report.backfills.length} back-fill`
	);

	if (!options.apply) return report;

	// ═════════════════════════════════════════════════════════════════════════
	// APPLY
	// ═════════════════════════════════════════════════════════════════════════

	// 6. Renames uitvoeren
	for (const r of report.renames) {
		const lookup = new Map<string, string>(r.oldToNew);
		const manifestEntry = r.oldToNew.find(([o]) => o.startsWith('manifests/'));

		// 6a. Manifest: download, paden herschrijven, uploaden naar nieuwe naam
		if (manifestEntry) {
			const [oldManifest, newManifest] = manifestEntry;
			const buf = await container.getBlockBlobClient(oldManifest).downloadToBuffer();
			const json: BackupManifest = JSON.parse(buf.toString('utf-8'));
			if (json.db) {
				json.db.schema_blob = rewritePathInManifest(json.db.schema_blob, lookup);
				json.db.data_blob = rewritePathInManifest(json.db.data_blob, lookup);
				json.db.migrations_blob = rewritePathInManifest(json.db.migrations_blob, lookup);
			}
			if (json.storage) json.storage.blob = rewritePathInManifest(json.storage.blob, lookup);
			if (json.metadata) json.metadata.blob = rewritePathInManifest(json.metadata.blob, lookup);
			const content = JSON.stringify(json, null, 2);
			await container.getBlockBlobClient(newManifest).upload(content, content.length, {
				blobHTTPHeaders: { blobContentType: 'application/json' }
			});
			log(`manifest herschreven: ${newManifest}`);
		}

		// 6b. Overige blobs kopiëren
		for (const [oldPath, newPath] of r.oldToNew) {
			if (oldPath === manifestEntry?.[0]) continue;
			await copyBlob(container, oldPath, newPath);
			log(`gekopieerd: ${newPath}`);
		}

		// 6c. Verifieer dat alle nieuwe blobs bestaan
		for (const [, newPath] of r.oldToNew) {
			const exists = await container.getBlockBlobClient(newPath).exists();
			if (!exists) {
				throw new Error(`Verify mislukt: ${newPath} bestaat niet — STOP voor delete`);
			}
		}

		// 6d. Oude blobs verwijderen
		for (const [oldPath] of r.oldToNew) {
			await container.getBlockBlobClient(oldPath).delete();
			log(`verwijderd: ${oldPath}`);
		}
	}

	// 7. Deletes uitvoeren (mislukte backups)
	for (const d of report.deletes) {
		log(`mislukte backup ${d.timestamp}: ${d.blobs.length} blobs verwijderen`);
		for (const blobPath of d.blobs) {
			await container.getBlockBlobClient(blobPath).delete();
			log(`verwijderd: ${blobPath}`);
		}
	}

	// 8. DB manifest_blob updates (incl. trigger_type/cron_hour afgeleid uit nieuwe naam)
	for (const u of report.dbUpdates) {
		const { trigger_type, cron_hour } = triggerFromManifestBlob(u.newManifestBlob);
		await db
			.updateTable('azure_backups')
			.set({ manifest_blob: u.newManifestBlob, trigger_type, cron_hour })
			.where('timestamp', '=', new Date(u.timestamp))
			.execute();
		log(`DB update: ${u.timestamp} → ${u.newManifestBlob}`);
	}

	// 9. Back-fill ontbrekende rijen
	for (const b of report.backfills) {
		const buf = await container.getBlockBlobClient(b.manifestBlob).downloadToBuffer();
		const json: BackupManifest = JSON.parse(buf.toString('utf-8'));
		const { trigger_type, cron_hour } = triggerFromManifestBlob(b.manifestBlob);
		await db
			.insertInto('azure_backups')
			.values({
				timestamp: new Date(json.timestamp),
				status: json.status ?? 'completed',
				duration_ms: json.duration_ms ?? null,
				tables_count: json.db?.tables?.length ?? null,
				storage_files_count: json.storage?.total_files ?? null,
				manifest_blob: b.manifestBlob,
				trigger_type,
				cron_hour
			})
			.onConflict((oc) => oc.column('timestamp').doNothing())
			.execute();
		log(`back-fill: ${b.timestamp}`);
	}

	return report;
}
