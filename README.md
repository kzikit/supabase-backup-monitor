# Supabase Backup Monitor

Een SvelteKit-webapplicatie die Supabase database-backups monitort en automatisch backups maakt naar Azure Blob Storage. De app haalt de back-upstatus op via de Supabase Management API, slaat records op in een PostgreSQL-database, stuurt e-mailmeldingen via Resend wanneer dagelijkse back-ups ontbreken, en maakt elke 4 uur een volledige backup (database + storage buckets + metadata) naar Azure.

## Vereisten

- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/) (wordt geactiveerd via `corepack enable`)
- Een PostgreSQL-database
- Een [Supabase](https://supabase.com/) project met Management API-toegang
- Een [Resend](https://resend.com/) account voor e-mailnotificaties
- Een [Azure Storage](https://azure.microsoft.com/en-us/products/storage/blobs) account voor backups (account: `sbbk`)
- `pg_dump` (PostgreSQL 17 client tools) beschikbaar in PATH

## Omgevingsvariabelen

Maak een `.env`-bestand aan in de root van het project:

```env
# Verplicht
DATABASE_URL=postgresql://user:password@localhost:5432/backup_monitor
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx
SUPABASE_PROJECT_REF=your-project-ref
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx

# Azure backup (verplicht voor backup-functionaliteit)
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=sbbk;...
AZURE_BLOB_CONTAINER=dev                              # dev | staging | prod
SUPABASE_DB_URL=postgresql://postgres:PASSWORD@db.abc123.supabase.co:5432/postgres
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...

# Optioneel
EMAIL_FROM="Backup Monitor <noreply@example.com>"   # standaard: "Backup Monitor <noreply@swoep.nl>"
BASIC_AUTH_USER=admin                                 # standaard: "admin"
BASIC_AUTH_PASS=geheim                                # standaard: "" (leeg)
```

| Variabele | Verplicht | Omschrijving |
|---|---|---|
| `DATABASE_URL` | Ja | PostgreSQL connection string voor de applicatiedatabase |
| `SUPABASE_ACCESS_TOKEN` | Ja | Bearer token voor de Supabase Management API |
| `SUPABASE_PROJECT_REF` | Ja | Project-referentie uit het Supabase dashboard |
| `RESEND_API_KEY` | Ja | API-key van Resend voor e-mailverzending |
| `EMAIL_FROM` | Nee | Afzenderadres voor e-mailmeldingen |
| `BASIC_AUTH_USER` | Nee | Gebruikersnaam voor HTTP Basic Auth |
| `BASIC_AUTH_PASS` | Nee | Wachtwoord voor HTTP Basic Auth |
| `AZURE_STORAGE_CONNECTION_STRING` | Ja* | Azure Blob Storage connection string (account `sbbk`) |
| `AZURE_BLOB_CONTAINER` | Ja* | Blob container naam: `dev`, `staging` of `prod` |
| `SUPABASE_DB_URL` | Ja* | Directe Postgres-verbindingsstring van de Supabase-instantie |
| `SUPABASE_SERVICE_ROLE_KEY` | Ja* | Service-rol API-sleutel voor storage bucket toegang |

\* Verplicht voor de Azure backup-functionaliteit. De monitoring-functionaliteit werkt zonder deze variabelen.

## Lokaal draaien

In je lokale postgresql, moet je de backup_monitor db creeren:

```bash
psql 'postgres://postgres:pass@localhost:5433' <<EOF
SELECT 'CREATE DATABASE backup_monitor'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'backup_monitor')\gexec
EOF
```

Of met docker:

```bash
docker exec postgres psql -U postgres -c "CREATE DATABASE backup_monitor;"
```

```sh
# Installeer dependencies
pnpm install

# Start de development server
pnpm dev
```

De app is dan beschikbaar op `http://localhost:5173`. Log in met de Basic Auth-credentials die je hebt ingesteld.

## Bouwen en draaien als productie

```sh
pnpm build
node build
```

De productie-server draait standaard op poort 3000.

## Docker

```sh
docker build -t supabase-backup-monitor .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e SUPABASE_ACCESS_TOKEN=sbp_... \
  -e SUPABASE_PROJECT_REF=... \
  -e RESEND_API_KEY=re_... \
  supabase-backup-monitor
```

## Testen

```sh
pnpm test
```

## Azure Backup

Elke 4 uur (02:00, 06:00, 10:00, 14:00, 18:00, 22:00 Europe/Amsterdam) wordt automatisch een volledige backup gemaakt naar Azure Blob Storage:

- **Database**: schema (DDL), data en migrations als gescheiden `pg_dump` streams, gecomprimeerd met gzip
- **Storage buckets**: alle bestanden als tar.gz archief
- **Metadata**: RLS policies, realtime config, webhook triggers, extensies en tabelstatistieken als JSON

Alles wordt direct gestreamd naar Azure — er worden geen tussentijdse bestanden op disk aangemaakt.

### Handmatige trigger

```bash
curl -X POST http://localhost:3000/api/backup
```

### Blobstructuur

```
sbbk / {dev|staging|prod} /
├── db/           - schema.sql.gz, data.sql.gz, migrations.sql.gz per timestamp
├── storage/      - tar.gz per timestamp met alle bucket bestanden
├── metadata/     - JSON per timestamp met policies, triggers, extensies
└── manifests/    - JSON overzicht per backup-run
```

Zie [docs/backup-plan-azure.md](docs/backup-plan-azure.md) voor het volledige implementatieplan.

## Projectstructuur

```
src/lib/server/
├── auth.ts                - HTTP Basic Authentication middleware
├── azure-storage.ts       - Azure Blob Storage client (uploadStream, uploadJson)
├── backup-db.ts           - Database backup: pg_dump → gzip → Azure stream
├── backup-metadata.ts     - Metadata export: policies, realtime, webhooks, extensies
├── backup-orchestrator.ts - Coördineert db + storage + metadata parallel
├── backup-storage.ts      - Storage bucket backup: REST API → tar+gzip → Azure stream
├── cron.ts                - Cron jobs: monitoring (08:00, 23:59) + backup (elke 4 uur)
├── db.ts                  - PostgreSQL-verbinding en schemamigratie (Kysely)
├── email.ts               - E-mailmeldingen via Resend
└── supabase-api.ts        - Supabase Management API client
```
