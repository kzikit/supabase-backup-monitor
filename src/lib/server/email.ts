import { Resend } from 'resend';
import { env } from '$env/dynamic/private';
import { db } from './db';
import type { BackupAlertReason } from '$lib/types';

let resend: Resend;

function getResend() {
	if (!resend) {
		resend = new Resend(env.RESEND_API_KEY);
	}
	return resend;
}

/**
 * Controleer of de succes-e-mail instelling is ingeschakeld.
 */
export async function isSuccessEmailEnabled(): Promise<boolean> {
	const row = await db
		.selectFrom('app_settings')
		.select('value')
		.where('key', '=', 'email_on_success')
		.executeTakeFirst();
	return row?.value === 'true';
}

/**
 * Stuur een bevestiging naar alle geconfigureerde ontvangers
 * dat de back-up van vandaag succesvol is.
 */
export async function sendSuccessBackupAlert(date: string) {
	const recipients = await db
		.selectFrom('email_recipients')
		.selectAll()
		.execute();

	if (recipients.length === 0) {
		console.warn('[email] Geen ontvangers geconfigureerd, succesmelding overgeslagen');
		return;
	}

	const emailAddresses = recipients.map((r) => r.email);
	const from = env.EMAIL_FROM || 'Backup Monitor <noreply@swoep.nl>';

	try {
		await getResend().emails.send({
			from,
			to: emailAddresses,
			subject: `Supabase back-up gelukt: ${date}`,
			html: `
				<h2>Supabase Back-up Bevestiging</h2>
				<p>De back-up voor <strong>${date}</strong> is <strong>succesvol voltooid</strong>.</p>
				<hr />
				<p style="color: #666; font-size: 12px;">
					Dit bericht is automatisch verstuurd door de Supabase Backup Monitor.
				</p>
			`
		});
		console.log(`[email] Succesmelding verstuurd naar ${emailAddresses.length} ontvanger(s)`);
	} catch (err) {
		console.error('[email] Fout bij versturen succesmelding:', err);
	}
}

/**
 * Genereer een duidelijke uitleg op basis van de reden.
 */
function formatAlertReason(reason: BackupAlertReason): { subject: string; heading: string; explanation: string } {
	switch (reason.type) {
		case 'api_error':
			return {
				subject: 'Supabase API onbereikbaar',
				heading: 'Supabase API Fout',
				explanation: `
					<p>De Supabase Management API kon niet worden bereikt om de back-upstatus te controleren.</p>
					<p><strong>Foutmelding:</strong> ${reason.message}</p>
					<p><strong>Mogelijke oorzaken:</strong></p>
					<ul>
						<li>De Supabase API-server is tijdelijk onbeschikbaar (storing of onderhoud)</li>
						<li>Het API-toegangstoken is verlopen of ongeldig</li>
						<li>Er is een netwerkprobleem tussen de monitor en de Supabase API</li>
					</ul>
					<p><strong>Actie vereist:</strong> Controleer de <a href="https://status.supabase.com">Supabase Status pagina</a>
					en verifieer dat het API-token nog geldig is.</p>
				`
			};
		case 'no_backup_today':
			return {
				subject: 'Supabase back-up ontbreekt',
				heading: 'Geen Back-up Gevonden',
				explanation: `
					<p>De Supabase API is succesvol bevraagd, maar er is <strong>geen back-up gevonden voor vandaag</strong>.</p>
					<p><strong>Mogelijke oorzaken:</strong></p>
					<ul>
						<li>De geplande back-up is niet gestart</li>
						<li>Er is een configuratieprobleem in het Supabase-project</li>
					</ul>
					<p><strong>Actie vereist:</strong> Ga naar het
					<a href="https://supabase.com/dashboard">Supabase Dashboard</a> → Database → Backups
					en controleer of back-ups correct zijn ingesteld.</p>
				`
			};
		case 'backup_not_completed':
			return {
				subject: `Supabase back-up mislukt (status: ${reason.status})`,
				heading: 'Back-up Niet Voltooid',
				explanation: `
					<p>Er is een back-up gevonden voor vandaag, maar de status is
					<strong style="color: #dc2626;">${reason.status}</strong> in plaats van <strong style="color: #16a34a;">COMPLETED</strong>.</p>
					<p><strong>Mogelijke oorzaken:</strong></p>
					<ul>
						${reason.status === 'IN_PROGRESS' ? '<li>De back-up is nog bezig — als dit bericht laat op de dag komt, kan het zijn dat de back-up langer duurt dan verwacht</li>' : ''}
						${reason.status === 'FAILED' ? '<li>De back-up is mislukt door een interne fout bij Supabase</li>' : ''}
						<li>Er is een probleem met de database of opslagruimte</li>
					</ul>
					<p><strong>Actie vereist:</strong> Ga naar het
					<a href="https://supabase.com/dashboard">Supabase Dashboard</a> → Database → Backups
					en bekijk de details van de mislukte back-up.</p>
				`
			};
	}
}

/**
 * Stuur een waarschuwing naar alle geconfigureerde ontvangers
 * met een duidelijke uitleg van wat er mis is.
 */
export async function sendMissingBackupAlert(date: string, reason: BackupAlertReason) {
	const recipients = await db
		.selectFrom('email_recipients')
		.selectAll()
		.execute();

	if (recipients.length === 0) {
		console.warn('[email] Geen ontvangers geconfigureerd, waarschuwing overgeslagen');
		return;
	}

	const emailAddresses = recipients.map((r) => r.email);
	const from = env.EMAIL_FROM || 'Backup Monitor <noreply@swoep.nl>';
	const alert = formatAlertReason(reason);

	try {
		await getResend().emails.send({
			from,
			to: emailAddresses,
			subject: `⚠️ ${alert.subject}: ${date}`,
			html: `
				<h2>⚠️ ${alert.heading}</h2>
				<p style="background: #fef3c7; padding: 12px; border-left: 4px solid #f59e0b; margin: 16px 0;">
					<strong>Datum:</strong> ${date}
				</p>
				${alert.explanation}
				<hr />
				<p style="color: #666; font-size: 12px;">
					Dit bericht is automatisch verstuurd door de Supabase Backup Monitor.
				</p>
			`
		});
		console.log(`[email] Waarschuwing (${reason.type}) verstuurd naar ${emailAddresses.length} ontvanger(s)`);
	} catch (err) {
		console.error('[email] Fout bij versturen waarschuwing:', err);
	}
}
