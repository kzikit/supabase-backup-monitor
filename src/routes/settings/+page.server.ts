import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
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

	return {
		recipients,
		emailOnSuccess: emailOnSuccessRow?.value === 'true'
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
