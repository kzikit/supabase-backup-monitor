import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
	const recipients = await db
		.selectFrom('email_recipients')
		.selectAll()
		.orderBy('name', 'asc')
		.execute();

	return { recipients };
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
