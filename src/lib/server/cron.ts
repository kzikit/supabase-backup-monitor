import cron from 'node-cron';
import { fetchBackups } from './supabase-api';
import { sendMissingBackupAlert, sendSuccessBackupAlert, isSuccessEmailEnabled } from './email';
import { db } from './db';
import { runBackup } from './backup-orchestrator';
import type { NewSupabaseBackup, BackupAlertReason } from '$lib/types';

/**
 * Start de cron jobs voor back-up checks.
 *
 * - 08:00: Ochtendcheck — Supabase draait backups rond 06:00
 * - 23:59: Avondcheck — eindcontrole van de dag
 *
 * 1. Haal back-ups op van Supabase API
 * 2. Sla ze op in de database (bij conflicten niets doen)
 * 3. Controleer of er vandaag een succesvolle back-up is
 * 4. Zo niet, stuur een waarschuwing
 */
export function startCronJob() {
  console.log('[cron] Back-up checks gepland: 08:00 en 23:59 Europe/Amsterdam');
  console.log('[cron] Azure backup gepland: elke 4 uur (02:00, 06:00, 10:00, 14:00, 18:00, 22:00)');

  // Azure backup elke 4 uur
  cron.schedule(
    '0 2,6,10,14,18,22 * * *',
    async () => {
      console.log('[cron] Azure backup gestart');
      try {
        const manifest = await runBackup();
        console.log(`[cron] Azure backup klaar in ${manifest.duration_ms}ms`);
      } catch (err) {
        console.error('[cron] Azure backup mislukt:', err);
      }
    },
    { timezone: 'Europe/Amsterdam' }
  );

  // Ochtendcheck — Supabase draait backups rond 06:00
  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log('[cron] Ochtend back-up check gestart');
      try {
        await checkBackups();
      } catch (err) {
        console.error('[cron] Fout bij ochtend back-up check:', err);
      }
    },
    { timezone: 'Europe/Amsterdam' }
  );

  // Avondcheck — eindcontrole van de dag
  cron.schedule(
    '59 23 * * *',
    async () => {
      console.log('[cron] Avond back-up check gestart');
      try {
        await checkBackups();
      } catch (err) {
        console.error('[cron] Fout bij avond back-up check:', err);
      }
    },
    { timezone: 'Europe/Amsterdam' }
  );
}

/**
 * Voer de back-up check uit. Kan ook handmatig getriggerd worden.
 */
export async function checkBackups(): Promise<{ backupsFound: number; todayOk: boolean }> {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // 1. Haal back-ups op — bij API-fouten direct een waarschuwing sturen
  let response;
  try {
    response = await fetchBackups();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cron] Supabase API fout: ${message}`);
    const reason: BackupAlertReason = { type: 'api_error', message };
    await sendMissingBackupAlert(todayStr, reason);
    return { backupsFound: 0, todayOk: false };
  }

  const backups = response.backups;
  console.log(`[cron] ${backups.length} back-ups opgehaald van Supabase API (walg=${response.walg_enabled}, pitr=${response.pitr_enabled})`);
  console.log(`[cron] backups: ${JSON.stringify(backups, null, 2)}`);

  // 2. Sync naar database: per dag alle bestaande records verwijderen en
  //    vervangen door wat de API teruggeeft. Dagen die niet in de API
  //    response zitten worden niet aangeraakt (historische data blijft bewaard).
  if (backups.length > 0) {
    const rows: NewSupabaseBackup[] = backups.map((b) => ({
      inserted_at: new Date(b.inserted_at),
      is_physical_backup: b.is_physical_backup,
      status: b.status
    }));

    // Unieke dagen in de API-response
    const days = [...new Set(rows.map((r) => r.inserted_at.toISOString().split('T')[0]))];

    for (const day of days) {
      const dayStart = new Date(`${day}T00:00:00.000Z`);
      const dayEnd = new Date(`${day}T23:59:59.999Z`);

      // Verwijder alle lokale records voor deze dag
      await db
        .deleteFrom('supabase_backups')
        .where('inserted_at', '>=', dayStart)
        .where('inserted_at', '<=', dayEnd)
        .execute();
    }

    // Insert verse records van de API
    for (const row of rows) {
      await db
        .insertInto('supabase_backups')
        .values(row)
        .execute();
    }
    console.log(`[cron] Back-ups opgeslagen in database (${days.join(', ')} vernieuwd)`);
  }

  // 3. Controleer of er vandaag een succesvolle back-up is
  const todayBackups = backups.filter((b) => String(b.inserted_at).split('T')[0] === todayStr);
  const completedBackup = todayBackups.find((b) => b.status === 'COMPLETED');

  // 4. Stuur e-mail op basis van resultaat
  if (!completedBackup) {
    let reason: BackupAlertReason;
    if (todayBackups.length === 0) {
      reason = { type: 'no_backup_today' };
      console.warn(`[cron] Geen back-up gevonden voor ${todayStr}`);
    } else {
      reason = { type: 'backup_not_completed', status: todayBackups[0].status };
      console.warn(`[cron] Back-up van ${todayStr} heeft status: ${todayBackups[0].status}`);
    }
    await sendMissingBackupAlert(todayStr, reason);
  } else {
    console.log(`[cron] Back-up van vandaag (${todayStr}) OK`);
    if (await isSuccessEmailEnabled()) {
      await sendSuccessBackupAlert(todayStr);
    }
  }

  return { backupsFound: backups.length, todayOk: !!completedBackup };
}
