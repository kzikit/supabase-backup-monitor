# Supabase Backup naar Azure Blob Storage — Implementatieplan

## Overzicht

Elke 4 uur wordt een volledige backup gemaakt van een Supabase-instantie (database + storage buckets + metadata) en gestreamd naar Azure Blob Storage account `sbbk`. Het proces is geoptimaliseerd voor snelheid door streaming, compressie en parallelle verwerking.

> Dit plan is gebaseerd op bewezen patronen uit de `supabase-clone` scripts (`clone_supabase_tables.js`, `clone_supabase_storage.js`, `shared.js`).

---

## 1. Architectuur

```
Supabase Instance
  ├── PostgreSQL
  │   ├── Schema (public)   ─── pg_dump --schema-only ─── gzip ─── stream ─── Azure Blob
  │   ├── Data (public)     ─── pg_dump --data-only   ─── gzip ─── stream ─── Azure Blob
  │   └── Migrations        ─── pg_dump --table=...   ─── gzip ─── stream ─── Azure Blob
  │
  ├── Metadata (via SQL)
  │   ├── Storage RLS policies   ─── pg_policy catalog ──┐
  │   ├── Realtime config        ─── pg_publication ─────├── JSON ── Azure Blob
  │   ├── Webhook triggers       ─── pg_trigger ─────────┤
  │   └── Extensions             ─── pg_extension ───────┘
  │
  └── Storage Buckets ── REST API ── parallel download ── tar+gzip stream ── Azure Blob
```

### Kernprincipes

- **Geen tussentijdse bestanden**: alles wordt gestreamd (pg_dump → gzip → Azure upload)
- **Parallelle verwerking**: database-dump en storage-backup draaien gelijktijdig
- **Compressie**: gzip (ingebouwd in Node.js, ~10:1 ratio voor SQL)
- **Idempotent**: dezelfde backup kan veilig opnieuw draaien zonder conflicten
- **Direct REST API**: geen zware Supabase JS client nodig voor storage (bewezen in clone-scripts)
- **Gescheiden dumps**: schema en data apart voor flexibele restore

---

## 2. Containerstructuur in Azure Blob Storage

```
sbbk (storage account)
└── dev | staging | prod (container, via AZURE_BLOB_CONTAINER)
    ├── db/
    │   ├── 2026-04-09T08:00:00Z-schema.sql.gz     # DDL: tabellen, types, functies
    │   ├── 2026-04-09T08:00:00Z-data.sql.gz        # INSERT statements
    │   ├── 2026-04-09T08:00:00Z-migrations.sql.gz  # supabase_migrations tabel
    │   └── ...
    ├── storage/
    │   ├── 2026-04-09T08:00:00Z.tar.gz             # alle bucket bestanden
    │   └── ...
    ├── metadata/
    │   ├── 2026-04-09T08:00:00Z.json               # policies, triggers, realtime, extensies
    │   └── ...
    └── manifests/
        ├── 2026-04-09T08:00:00Z.json               # overzicht van de hele backup-run
        └── ...
```

### Manifest (metadata per backup-run)

```json
{
  "timestamp": "2026-04-09T08:00:00Z",
  "duration_ms": 12340,
  "supabase_project_ref": "abc123",
  "db": {
    "schema_blob": "db/2026-04-09T08:00:00Z-schema.sql.gz",
    "data_blob": "db/2026-04-09T08:00:00Z-data.sql.gz",
    "migrations_blob": "db/2026-04-09T08:00:00Z-migrations.sql.gz",
    "schemas": ["public"],
    "tables": [
      { "name": "users", "row_count": 1523 },
      { "name": "messages", "row_count": 45201 }
    ]
  },
  "storage": {
    "blob": "storage/2026-04-09T08:00:00Z.tar.gz",
    "buckets": [
      { "id": "avatars", "public": true, "files_count": 523 },
      { "id": "documents", "public": false, "files_count": 1000 }
    ],
    "total_files": 1523
  },
  "metadata": {
    "blob": "metadata/2026-04-09T08:00:00Z.json",
    "storage_policies_count": 8,
    "realtime_tables_count": 5,
    "webhook_triggers_count": 3,
    "extensions": ["moddatetime", "uuid-ossp", "pgcrypto"]
  },
  "status": "completed"
}
```

---

## 3. Benodigde omgevingsvariabelen

| Variabele | Doel |
|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | Verbindingsstring voor storage account `sbbk` |
| `AZURE_BLOB_CONTAINER` | Blob container naam: `dev`, `staging` of `prod` |
| `SUPABASE_DB_URL` | Directe Postgres-verbindingsstring (niet de pooler) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-rol API-sleutel (voor storage bucket REST API) |

> `SUPABASE_DB_URL` wordt ook gebruikt om de project ref te extraheren (`db.{ref}.supabase.co`), net als in de clone-scripts. De bestaande variabelen `DATABASE_URL`, `SUPABASE_ACCESS_TOKEN` en `SUPABASE_PROJECT_REF` blijven in gebruik voor de monitoring-functionaliteit.

---

## 4. Nieuwe dependencies

```bash
pnpm add @azure/storage-blob archiver
pnpm add -D @types/archiver
```

| Package | Doel |
|---|---|
| `@azure/storage-blob` | Upload naar Azure Blob Storage met streaming |
| `archiver` | Tar+gzip stream voor storage bestanden |

> `@supabase/supabase-js` is **niet nodig** — de storage-backup gebruikt de Supabase Storage REST API direct met `fetch()`, net als de bewezen clone-scripts. Dit bespaart ~2MB aan dependencies en geeft meer controle.

---

## 5. Implementatieplan

### Stap 1: Azure Blob Storage client module

**Bestand**: `src/lib/server/azure-storage.ts`

```typescript
import { BlobServiceClient } from '@azure/storage-blob';
import type { Readable } from 'stream';

const CONTAINER = 'supabase-backups';

export function getBlobClient() {
  return BlobServiceClient.fromConnectionString(
    process.env.AZURE_STORAGE_CONNECTION_STRING!
  );
}

export async function uploadStream(blobPath: string, stream: Readable): Promise<number> {
  const container = getBlobClient().getContainerClient(CONTAINER);
  await container.createIfNotExists();
  const blob = container.getBlockBlobClient(blobPath);

  // 4 MB blokken, 4 parallelle uploads
  await blob.uploadStream(stream, 4 * 1024 * 1024, 4, {
    blobHTTPHeaders: { blobContentEncoding: 'gzip' },
  });

  // Haal werkelijke grootte op via properties
  const props = await blob.getProperties();
  return props.contentLength ?? 0;
}

export async function uploadJson(blobPath: string, data: unknown): Promise<void> {
  const container = getBlobClient().getContainerClient(CONTAINER);
  await container.createIfNotExists();
  const blob = container.getBlockBlobClient(blobPath);
  const content = JSON.stringify(data, null, 2);
  await blob.upload(content, content.length, {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
}
```

### Stap 2: Database backup module

**Bestand**: `src/lib/server/backup-db.ts`

Drie gescheiden dumps, net als de clone-scripts (schema apart, data apart, migrations apart):

```typescript
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first'); // Bewezen patroon uit clone-scripts

import { spawn } from 'child_process';
import { createGzip } from 'zlib';
import { uploadStream } from './azure-storage';

/** Valideer pg_dump versie (patroon uit clone_supabase_tables.js) */
function validatePgDump(): void {
  const { execSync } = require('child_process');
  const output = execSync('pg_dump --version', { encoding: 'utf-8' });
  const match = output.match(/pg_dump \(PostgreSQL\) (\d+)/);
  if (!match || parseInt(match[1], 10) < 15) {
    throw new Error(`pg_dump >= 15 vereist, gevonden: ${output.trim()}`);
  }
}

/**
 * Streamt pg_dump output → gzip → Azure Blob.
 * Foutafhandeling gebaseerd op het streamDump-patroon uit clone_supabase_tables.js:
 * - EPIPE errors netjes afhandelen
 * - stderr verzamelen voor foutrapportage
 * - Exit code tracked
 */
async function streamPgDumpToAzure(
  dbUrl: string,
  pgDumpArgs: string[],
  blobPath: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const pgDump = spawn('pg_dump', [...pgDumpArgs, dbUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
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
        console.error(`[backup] pg_dump stdout fout: ${err.message}`);
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

export async function backupDatabase(timestamp: string, dbUrl: string) {
  validatePgDump();

  // 1. Schema dump (DDL) — --no-comments voorkomt encoding-problemen (clone-scripts)
  const schemaSize = await streamPgDumpToAzure(dbUrl, [
    '--schema=public',
    '--schema-only',
    '--no-owner',
    '--no-privileges',
    '--no-comments',
  ], `db/${timestamp}-schema.sql.gz`);

  // 2. Data dump — --rows-per-insert=1000 voor batch performance (clone-scripts)
  const dataSize = await streamPgDumpToAzure(dbUrl, [
    '--schema=public',
    '--data-only',
    '--no-owner',
    '--no-privileges',
    '--rows-per-insert=1000',
  ], `db/${timestamp}-data.sql.gz`);

  // 3. Migrations tabel (zoals in clone_supabase_tables.js stap 4)
  const migrationsSize = await streamPgDumpToAzure(dbUrl, [
    '--table=supabase_migrations.schema_migrations',
    '--data-only',
    '--no-owner',
    '--no-privileges',
    '--rows-per-insert=1000',
  ], `db/${timestamp}-migrations.sql.gz`);

  return { schemaSize, dataSize, migrationsSize };
}
```

**Waarom gescheiden dumps (patroon uit clone-scripts)?**
- Schema apart → je kunt DDL restoren zonder data (handig voor lege kloon)
- Data apart met `--rows-per-insert=1000` → snellere restore dan standaard COPY
- Migrations apart → Supabase CLI compatibiliteit behouden

**Docker-aanpassing**: `postgresql17-client` toevoegen aan runtime stage.

### Stap 3: Supabase metadata backup module

**Bestand**: `src/lib/server/backup-metadata.ts`

SQL-queries direct overgenomen uit de clone-scripts:

```typescript
import { Pool } from 'pg';
import { uploadJson } from './azure-storage';

export async function backupMetadata(timestamp: string, dbUrl: string) {
  const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 10000 });

  try {
    const [policies, realtime, webhooks, extensions, tables] = await Promise.all([
      // Storage RLS policies (uit clone_supabase_storage.js:cloneStoragePolicies)
      pool.query(`
        SELECT
          pol.polname as policyname,
          CASE pol.polcmd
            WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
            WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL'
          END as cmd,
          CASE pol.polpermissive WHEN true THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END as permissive,
          ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)) as roles,
          pg_get_expr(pol.polqual, pol.polrelid) as qual,
          pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
        FROM pg_policy pol
        JOIN pg_class cls ON pol.polrelid = cls.oid
        JOIN pg_namespace nsp ON cls.relnamespace = nsp.oid
        WHERE nsp.nspname = 'storage' AND cls.relname = 'objects'
      `),

      // Realtime publicatie config (uit clone_supabase_tables.js:cloneRealtimeConfig)
      pool.query(`
        SELECT schemaname, tablename
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
      `),

      // Webhook triggers (uit clone_supabase_tables.js:recreateWebhooks)
      pool.query(`
        SELECT
          tgname as trigger_name, relname as table_name,
          nspname as schema_name, pg_get_triggerdef(t.oid) as trigger_definition
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE NOT tgisinternal AND pg_get_triggerdef(t.oid) LIKE '%http_request%'
      `),

      // Geinstalleerde extensies (uit clone_supabase_tables.js:getInstalledExtensions)
      pool.query(`SELECT extname FROM pg_extension ORDER BY extname`),

      // Tabel-overzicht met rijtellingen (uit clone_supabase_tables.js:listTables)
      pool.query(`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
      `),
    ]);

    // Rijtellingen ophalen per tabel
    const tableStats = [];
    for (const row of tables.rows) {
      try {
        const count = await pool.query(
          `SELECT COUNT(*) as count FROM public."${row.tablename}"`
        );
        tableStats.push({ name: row.tablename, row_count: parseInt(count.rows[0].count) });
      } catch {
        tableStats.push({ name: row.tablename, row_count: -1 });
      }
    }

    const metadata = {
      timestamp,
      storage_policies: policies.rows,
      realtime_tables: realtime.rows,
      webhook_triggers: webhooks.rows,
      extensions: extensions.rows.map((r) => r.extname),
      tables: tableStats,
    };

    await uploadJson(`metadata/${timestamp}.json`, metadata);

    return metadata;
  } finally {
    await pool.end();
  }
}
```

### Stap 4: Storage bucket backup module

**Bestand**: `src/lib/server/backup-storage.ts`

Direct REST API met `fetch()`, inclusief recursieve folder traversal — patroon 1:1 uit `clone_supabase_storage.js`:

```typescript
import archiver from 'archiver';
import { Pool } from 'pg';
import { uploadStream } from './azure-storage';

const CONCURRENCY = 5; // zelfde als clone-scripts

/**
 * Storage REST API client (patroon uit clone_supabase_storage.js:createStorageClient).
 * Gebruikt direct fetch() met service role key — geen @supabase/supabase-js nodig.
 */
function createStorageClient(projectRef: string, serviceRoleKey: string) {
  const baseUrl = `https://${projectRef}.supabase.co/storage/v1`;

  return {
    async listObjects(bucket: string, prefix = '', limit = 1000, offset = 0) {
      const res = await fetch(`${baseUrl}/object/list/${bucket}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefix, limit, offset }),
      });
      if (!res.ok) throw new Error(`List objects mislukt: ${res.status} - ${await res.text()}`);
      return res.json();
    },

    async getObject(bucket: string, key: string): Promise<{ buffer: Buffer; contentType: string }> {
      const res = await fetch(`${baseUrl}/object/${bucket}/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${serviceRoleKey}` },
      });
      if (!res.ok) throw new Error(`Get object mislukt: ${res.status} - ${await res.text()}`);
      return {
        buffer: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') || 'application/octet-stream',
      };
    },
  };
}

/**
 * Recursieve bestandslijst met paginatie (uit clone_supabase_storage.js:listAllObjects).
 * Mappen hebben id === null, bestanden hebben een id.
 */
async function listAllObjects(
  client: ReturnType<typeof createStorageClient>,
  bucket: string,
  prefix = '',
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

/** Haal bucket-definities op via SQL (uit clone_supabase_storage.js:getBucketsFromDatabase). */
async function getBucketsFromDb(dbUrl: string) {
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

/** Extraheer project ref uit DB URL (uit shared.js:extractRefFromDbUrl). */
function extractRefFromDbUrl(dbUrl: string): string {
  const match = dbUrl.match(/db\.([^.]+)\.supabase\.co/);
  return match?.[1] ?? 'unknown';
}

export async function backupStorage(timestamp: string, dbUrl: string, serviceRoleKey: string) {
  const projectRef = extractRefFromDbUrl(dbUrl);
  const client = createStorageClient(projectRef, serviceRoleKey);
  const buckets = await getBucketsFromDb(dbUrl);

  if (!buckets.length) return { buckets: [], totalFiles: 0 };

  const archive = archiver('tar', { gzip: true, gzipOptions: { level: 6 } });
  const blobPath = `storage/${timestamp}.tar.gz`;

  // Start upload terwijl archief wordt gevuld (streaming)
  const uploadPromise = uploadStream(blobPath, archive);

  const bucketStats = [];

  for (const bucket of buckets) {
    const objects = await listAllObjects(client, bucket.id);
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
            console.error(`[backup] Download mislukt ${bucket.id}/${obj.key}: ${err}`);
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

    bucketStats.push({
      id: bucket.id,
      public: bucket.public,
      files_count: filesCount,
    });
  }

  archive.finalize();
  await uploadPromise;

  return { buckets: bucketStats, totalFiles: bucketStats.reduce((s, b) => s + b.files_count, 0) };
}
```

### Stap 5: Backup orchestrator

**Bestand**: `src/lib/server/backup-orchestrator.ts`

```typescript
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { backupDatabase } from './backup-db';
import { backupStorage } from './backup-storage';
import { backupMetadata } from './backup-metadata';
import { uploadJson } from './azure-storage';

export async function runBackup(): Promise<BackupManifest> {
  const timestamp = new Date().toISOString();
  const start = Date.now();

  const dbUrl = process.env.SUPABASE_DB_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // Alle drie parallel: database, storage, metadata
  const [dbResult, storageResult, metadata] = await Promise.all([
    backupDatabase(timestamp, dbUrl),
    backupStorage(timestamp, dbUrl, serviceRoleKey),
    backupMetadata(timestamp, dbUrl),
  ]);

  const manifest = {
    timestamp,
    duration_ms: Date.now() - start,
    supabase_project_ref: dbUrl.match(/db\.([^.]+)\.supabase\.co/)?.[1] ?? 'unknown',
    db: {
      schema_blob: `db/${timestamp}-schema.sql.gz`,
      data_blob: `db/${timestamp}-data.sql.gz`,
      migrations_blob: `db/${timestamp}-migrations.sql.gz`,
      tables: metadata.tables,
    },
    storage: {
      blob: `storage/${timestamp}.tar.gz`,
      buckets: storageResult.buckets,
      total_files: storageResult.totalFiles,
    },
    metadata: {
      blob: `metadata/${timestamp}.json`,
      storage_policies_count: metadata.storage_policies.length,
      realtime_tables_count: metadata.realtime_tables.length,
      webhook_triggers_count: metadata.webhook_triggers.length,
      extensions: metadata.extensions,
    },
    status: 'completed' as const,
  };

  await uploadJson(`manifests/${timestamp}.json`, manifest);
  return manifest;
}
```

### Stap 6: Cron-schedule aanpassen

**Bestand**: `src/lib/server/cron.ts` (bestaand, uitbreiden)

```typescript
import cron from 'node-cron';
import { runBackup } from './backup-orchestrator';

// Bestaande monitoring checks behouden...

// Backup elke 4 uur: 02:00, 06:00, 10:00, 14:00, 18:00, 22:00
cron.schedule('0 2,6,10,14,18,22 * * *', async () => {
  console.log('[backup] Start backup...');
  try {
    const manifest = await runBackup();
    console.log(`[backup] Klaar in ${manifest.duration_ms}ms`);
  } catch (err) {
    console.error('[backup] Mislukt:', err);
    // E-mailnotificatie bij falen via bestaand Resend-systeem
  }
}, { timezone: 'Europe/Amsterdam' });
```

### Stap 7: API endpoint voor handmatige trigger

**Bestand**: `src/routes/api/backup/+server.ts`

```typescript
import { json } from '@sveltejs/kit';
import { runBackup } from '$lib/server/backup-orchestrator';

export async function POST() {
  const manifest = await runBackup();
  return json(manifest);
}
```

### Stap 8: Dockerfile aanpassen

```dockerfile
# In de runtime stage:
RUN apk add --no-cache postgresql17-client
```

Inclusief pg_dump versievalidatie bij opstarten (zoals in clone-scripts).

### Stap 9: Retentiebeleid

Azure Blob Storage lifecycle management:

| Regel | Actie |
|---|---|
| Backups ouder dan 7 dagen | Verplaats naar Cool tier |
| Backups ouder dan 30 dagen | Verplaats naar Archive tier |
| Backups ouder dan 90 dagen | Verwijder |

---

## 6. Patronen overgenomen uit clone-scripts

| Patroon | Bron | Toepassing in backup |
|---|---|---|
| Direct REST API voor storage | `clone_supabase_storage.js:createStorageClient` | Geen `@supabase/supabase-js` nodig |
| Bucket metadata via SQL | `clone_supabase_storage.js:getBucketsFromDatabase` | Volledige bucket-definities incl. `file_size_limit`, `allowed_mime_types` |
| Recursieve folder traversal | `clone_supabase_storage.js:listAllObjects` | `id === null` = map, anders bestand; paginatie met offset/limit 1000 |
| Batch concurrency (5x) | `clone_supabase_storage.js:CONFIG.concurrency` | `Promise.all` op slices van 5 |
| Storage RLS policies | `clone_supabase_storage.js:cloneStoragePolicies` | Volledige policy-definities via `pg_policy` catalog |
| `dns.setDefaultResultOrder('ipv4first')` | `clone_supabase_tables.js:4` | Voorkomt IPv6-verbindingsproblemen met Supabase |
| pg_dump versievalidatie | `clone_supabase_tables.js:checkPgVersion` | Minimaal versie 15 vereist |
| Gescheiden schema/data dump | `clone_supabase_tables.js:cloneSchema/clonePublicData` | `--schema-only` + `--data-only` apart |
| `--rows-per-insert=1000` | `clone_supabase_tables.js:clonePublicData` | Snellere batch-inserts bij restore |
| `--no-comments` | `clone_supabase_tables.js:cloneSchema` | Voorkomt encoding-problemen |
| EPIPE error handling | `clone_supabase_tables.js:streamDump` | Graceful afhandeling bij pipe-fouten |
| Realtime publicatie config | `clone_supabase_tables.js:cloneRealtimeConfig` | `pg_publication_tables` backup |
| Webhook trigger definities | `clone_supabase_tables.js:recreateWebhooks` | `pg_get_triggerdef()` voor volledige definities |
| Extensie-inventaris | `clone_supabase_tables.js:getInstalledExtensions` | `pg_extension` lijst opslaan |
| Migrations tabel | `clone_supabase_tables.js:cloneSchemaMigrationsTable` | `supabase_migrations.schema_migrations` apart dumpen |
| Project ref uit DB URL | `shared.js:extractRefFromDbUrl` | Regex: `db\.([^.]+)\.supabase\.co` |
| Tabel-inspectie met rijtellingen | `clone_supabase_tables.js:listTables` | Manifest verrijken met `COUNT(*)` per tabel |

---

## 7. Snelheidsoptimalisaties

| Techniek | Impact | Toelichting |
|---|---|---|
| Streaming upload (geen disk I/O) | Hoog | pg_dump → gzip → Azure Blob direct |
| gzip level 6 | Gemiddeld | Goede balans tussen compressie en CPU |
| Parallelle db + storage + metadata | Hoog | `Promise.all` op drie onafhankelijke taken |
| Batch storage downloads (5x) | Hoog | 5 gelijktijdige file transfers (bewezen in clone-scripts) |
| `--rows-per-insert=1000` | Gemiddeld | Significante verbetering bij restore |
| Azure 4MB block upload + 4 threads | Gemiddeld | SDK handelt multipart af |
| IPv4-first DNS | Laag | Vermijdt IPv6 fallback-vertraging |
| Gescheiden dumps (schema/data) | Gemiddeld | Parallel streamen mogelijk |

### Geschatte doorlooptijd

| Component | Klein project (100 MB) | Groot project (5 GB) |
|---|---|---|
| pg_dump schema + data + migrations | ~10s | ~3-5 min |
| Storage backup | ~5s (weinig bestanden) | ~10-20 min (veel bestanden) |
| Metadata export | ~1s | ~5s |
| **Totaal (parallel)** | **~15s** | **~5-20 min** |

---

## 8. Foutafhandeling en monitoring

- **EPIPE handling**: pipe-fouten graceful afvangen (bewezen in clone-scripts)
- **stderr collectie**: pg_dump stderr verzamelen voor diagnostiek
- **Retry**: bij Azure upload-fouten 1x opnieuw proberen met exponential backoff
- **Timeout**: maximaal 30 minuten per backup-run
- **Alerting**: bij mislukte backup een e-mail via het bestaande Resend-systeem
- **Logging**: gestructureerde logs met timestamp, duur en foutmelding
- **Health endpoint**: `/api/health` uitbreiden met laatste backup-timestamp en status

---

## 9. Beveiliging

- Azure connection string opslaan via SOPS (bestaande encryptie-setup)
- `SUPABASE_SERVICE_ROLE_KEY` en `SUPABASE_DB_URL` nooit in logs tonen
- Blob container heeft geen publieke toegang (standaard in Azure)
- Backups bevatten gevoelige data — versleuteling at-rest is standaard in Azure Storage

---

## 10. Restore-strategie

Dankzij de gescheiden dumps kan flexibel gerestored worden:

```bash
# Alleen schema restoren (leeg kloon)
gunzip -c db/timestamp-schema.sql.gz | psql $TARGET_DB_URL

# Alleen data restoren (na schema)
gunzip -c db/timestamp-data.sql.gz | psql $TARGET_DB_URL

# Migrations tabel restoren
gunzip -c db/timestamp-migrations.sql.gz | psql $TARGET_DB_URL

# Storage bestanden restoren
tar xzf storage/timestamp.tar.gz
# Per bucket uploaden via Storage REST API

# Metadata restoren (policies, realtime, webhooks)
# Parse metadata/timestamp.json en voer SQL uit (analoog aan clone-scripts)
```

---

## 11. Implementatievolgorde

1. **Dependencies installeren** (`@azure/storage-blob`, `archiver`)
2. **Azure Storage client module** (`azure-storage.ts`)
3. **Database backup module** (`backup-db.ts`) met gescheiden schema/data/migrations dumps
4. **Metadata backup module** (`backup-metadata.ts`) met policies, realtime, webhooks, extensies
5. **Storage bucket backup module** (`backup-storage.ts`) met direct REST API
6. **Orchestrator** (`backup-orchestrator.ts`) die alles parallel draait + manifest schrijft
7. **Cron-schedule** aanpassen naar elke 4 uur
8. **API endpoint** voor handmatige trigger
9. **Dockerfile** bijwerken met `postgresql17-client`
10. **Tests** schrijven voor elke module
11. **Dashboard** uitbreiden met backup-overzicht (optioneel)
12. **Retentiebeleid** configureren in Azure
