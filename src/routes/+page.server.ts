import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	const backups = await db
		.selectFrom('supabase_backups')
		.selectAll()
		.orderBy('inserted_at', 'desc')
		.execute();

	return { backups };
};
