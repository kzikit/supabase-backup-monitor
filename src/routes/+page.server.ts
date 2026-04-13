import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	const [supabaseRows, azureRows, showBackfillRow] = await Promise.all([
		db
			.selectFrom('supabase_backups')
			.selectAll()
			.orderBy('inserted_at', 'desc')
			.execute(),
		db
			.selectFrom('azure_backups')
			.selectAll()
			.orderBy('timestamp', 'desc')
			.execute(),
		db
			.selectFrom('app_settings')
			.select('value')
			.where('key', '=', 'show_backfill_button')
			.executeTakeFirst()
	]);

	const backups = supabaseRows.map((b) => ({
		...b,
		inserted_at: new Date(b.inserted_at as unknown as string).toISOString()
	}));

	const azureBackups = azureRows.map((b) => ({
		...b,
		timestamp: new Date(b.timestamp as unknown as string).toISOString()
	}));

	return {
		backups,
		azureBackups,
		showBackfillButton: showBackfillRow?.value === 'true'
	};
};
