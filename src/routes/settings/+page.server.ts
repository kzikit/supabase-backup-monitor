import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { env } from '$env/dynamic/private';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
	const recipients = await db
		.selectFrom('email_recipients')
		.selectAll()
		.orderBy('name', 'asc')
		.execute();

	const emailOnSuccessRow = await db
		.selectFrom('app_settings')
		.select('value')
		.where('key', '=', 'email_on_success')
		.executeTakeFirst();

	const showBackfillButtonRow = await db
		.selectFrom('app_settings')
		.select('value')
		.where('key', '=', 'show_backfill_button')
		.executeTakeFirst();

	return {
		recipients,
		emailOnSuccess: emailOnSuccessRow?.value === 'true',
		showBackfillButton: showBackfillButtonRow?.value === 'true'
	};
};

export const actions: Actions = {
	add: async ({ request }) => {
		const formData = await request.formData();
		const name = formData.get('name')?.toString().trim();
		const email = formData.get('email')?.toString().trim();

		if (!name || !email) {
			return fail(400, { error: 'Naam en e-mailadres zijn verplicht' });
		}

		try {
			await db
				.insertInto('email_recipients')
				.values({ name, email })
				.execute();
		} catch (err: unknown) {
			if (err instanceof Error && err.message.includes('unique')) {
				return fail(400, { error: 'Dit e-mailadres bestaat al' });
			}
			throw err;
		}

		return { success: true, action: 'add' };
	},

	toggleSuccessEmail: async ({ request }) => {
		const formData = await request.formData();
		const enabled = formData.get('enabled') === 'true';

		await db
			.insertInto('app_settings')
			.values({ key: 'email_on_success', value: String(enabled) })
			.onConflict((oc) => oc.column('key').doUpdateSet({ value: String(enabled) }))
			.execute();

		return { success: true };
	},

	toggleBackfillButton: async ({ request }) => {
		const formData = await request.formData();
		const enabled = formData.get('enabled') === 'true';
		const pincode = formData.get('pincode')?.toString() ?? '';

		// Bij inschakelen: pincode verplicht en moet overeenkomen met env
		if (enabled) {
			const expected = env.BACKFILL_PINCODE;
			if (!expected) {
				return fail(500, {
					error: 'BACKFILL_PINCODE is niet ingesteld op de server',
					action: 'toggleBackfillButton'
				});
			}
			if (pincode !== expected) {
				return fail(403, {
					error: 'Onjuiste pincode',
					action: 'toggleBackfillButton'
				});
			}
		}

		await db
			.insertInto('app_settings')
			.values({ key: 'show_backfill_button', value: String(enabled) })
			.onConflict((oc) => oc.column('key').doUpdateSet({ value: String(enabled) }))
			.execute();

		return { success: true, action: 'toggleBackfillButton' };
	},

	delete: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id) {
			return fail(400, { error: 'Ongeldig ID' });
		}

		await db
			.deleteFrom('email_recipients')
			.where('id', '=', id)
			.execute();

		return { success: true };
	}
};
