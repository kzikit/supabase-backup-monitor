import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	const rows = await db
		.selectFrom('supabase_backups')
		.selectAll()
		.orderBy('inserted_at', 'desc')
		.execute();

	const backups = rows.map((b) => ({
		...b,
		inserted_at: b.inserted_at.toISOString()
	}));

	return { backups };
};
