import type { Handle } from '@sveltejs/kit';
import { migrate } from '$lib/server/db';
import { startCronJob } from '$lib/server/cron';
import { validateBasicAuth, unauthorizedResponse } from '$lib/server/auth';

// Eenmalige initialisatie bij server startup
let initialized = false;

async function init() {
	if (initialized) return;
	initialized = true;

	console.log('[init] Database migratie uitvoeren...');
	await migrate();
	console.log('[init] Database migratie voltooid');

	startCronJob();
}

export const handle: Handle = async ({ event, resolve }) => {
	await init();

	// Sta de handmatige check endpoint toe zonder auth (wordt intern gebruikt)
	// Alle andere routes vereisen basic auth
	const authHeader = event.request.headers.get('authorization');

	if (!validateBasicAuth(authHeader)) {
		return unauthorizedResponse();
	}

	return resolve(event);
};
