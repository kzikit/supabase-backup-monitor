# Supabase Backup Monitor

Een SvelteKit-webapplicatie die Supabase database-backups monitort. De app haalt de back-upstatus op via de Supabase Management API, slaat records op in een PostgreSQL-database en stuurt e-mailmeldingen via Resend wanneer dagelijkse back-ups ontbreken.

## Vereisten

- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/) (wordt geactiveerd via `corepack enable`)
- Een PostgreSQL-database
- Een [Supabase](https://supabase.com/) project met Management API-toegang
- Een [Resend](https://resend.com/) account voor e-mailnotificaties

## Omgevingsvariabelen

Maak een `.env`-bestand aan in de root van het project:

```env
# Verplicht
DATABASE_URL=postgresql://user:password@localhost:5432/backup_monitor
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx
SUPABASE_PROJECT_REF=your-project-ref
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx

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

## Projectstructuur

```
src/lib/server/
├── auth.ts          - HTTP Basic Authentication middleware
├── cron.ts          - Dagelijkse back-up check (23:59 Europe/Amsterdam)
├── db.ts            - PostgreSQL-verbinding en schemamigratie (Kysely)
├── email.ts         - E-mailmeldingen via Resend
└── supabase-api.ts  - Supabase Management API client
```
