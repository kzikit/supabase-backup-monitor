import cron from 'node-cron';
import { fetchBackups } from './supabase-api';
import { sendMissingBackupAlert, sendSuccessBackupAlert, isSuccessEmailEnabled } from './email';
import { db } from './db';
import type { NewSupabaseBackup, BackupAlertReason } from '$lib/types';

/**
 * Start de dagelijkse cron job om 23:59 (Europe/Amsterdam).
 *
 * 1. Haal back-ups op van Supabase API
 * 2. Sla ze op in de database (bij conflicten niets doen)
 * 3. Controleer of er vandaag een succesvolle back-up is
 * 4. Zo niet, stuur een waarschuwing
 */
export function startCronJob() {
  console.log('[cron] Dagelijkse back-up check gepland om 23:59 Europe/Amsterdam');

  cron.schedule(
    '59 23 * * *',
    async () => {
      console.log('[cron] Back-up check gestart');
      try {
        await checkBackups();
      } catch (err) {
        console.error('[cron] Fout bij back-up check:', err);
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
  console.log(`[cron] ${backups.length} back-ups opgehaald van Supabase API: \n${JSON.stringify(backups, null, 2)}`);

  // 2. Sla op in database (bij conflicten niets doen)
  if (backups.length > 0) {
    const rows: NewSupabaseBackup[] = backups.map((b) => ({
      inserted_at: new Date(b.inserted_at),
      is_physical_backup: b.is_physical_backup,
      status: b.status
    }));

    for (const row of rows) {
      await db
        .insertInto('supabase_backups')
        .values(row)
        .onConflict((oc) => oc.column('inserted_at').doNothing())
        .execute();
    }
    console.log('[cron] Back-ups opgeslagen in database');
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
