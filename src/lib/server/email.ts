import { Resend } from 'resend';
import { RESEND_API_KEY, EMAIL_FROM } from '$env/dynamic/private';
import { db } from './db';

let resend: Resend;

function getResend() {
	if (!resend) {
		resend = new Resend(RESEND_API_KEY);
	}
	return resend;
}

/**
 * Stuur een waarschuwing naar alle geconfigureerde ontvangers
 * dat er vandaag geen back-up is gemaakt.
 */
export async function sendMissingBackupAlert(date: string) {
	const recipients = await db
		.selectFrom('email_recipients')
		.selectAll()
		.execute();

	if (recipients.length === 0) {
		console.warn('[email] Geen ontvangers geconfigureerd, waarschuwing overgeslagen');
		return;
	}

	const emailAddresses = recipients.map((r) => r.email);
	const from = EMAIL_FROM || 'Backup Monitor <noreply@swoep.nl>';

	try {
		await getResend().emails.send({
			from,
			to: emailAddresses,
			subject: `⚠️ Supabase back-up ontbreekt: ${date}`,
			html: `
				<h2>Supabase Back-up Waarschuwing</h2>
				<p>Er is <strong>geen succesvolle back-up</strong> gevonden voor <strong>${date}</strong>.</p>
				<p>Controleer de Supabase dashboard en onderneem actie indien nodig.</p>
				<hr />
				<p style="color: #666; font-size: 12px;">
					Dit bericht is automatisch verstuurd door de Supabase Backup Monitor.
				</p>
			`
		});
		console.log(`[email] Waarschuwing verstuurd naar ${emailAddresses.length} ontvanger(s)`);
	} catch (err) {
		console.error('[email] Fout bij versturen waarschuwing:', err);
	}
}
