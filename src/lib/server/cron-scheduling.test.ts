import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseBackupResponse, BackupAlertReason } from '$lib/types';

// Mock node-cron om te verifiëren dat taken correct worden gepland
const mockSchedule = vi.fn();
vi.mock('node-cron', () => ({
	default: {
		schedule: mockSchedule
	}
}));

// Mock $env/dynamic/private
vi.mock('$env/dynamic/private', () => ({
	env: {
		RESEND_API_KEY: 'test-key',
		DATABASE_URL: 'postgresql://localhost/test',
		EMAIL_FROM: 'test@test.com',
		SUPABASE_PROJECT_REF: 'test-ref',
		SUPABASE_ACCESS_TOKEN: 'test-token'
	}
}));

// Mock supabase-api
const mockFetchBackups = vi.fn<() => Promise<SupabaseBackupResponse>>();
vi.mock('./supabase-api', () => ({
	fetchBackups: (...args: unknown[]) => mockFetchBackups(...(args as []))
}));

// Mock email
const mockSendMissingAlert = vi.fn<(date: string, reason: BackupAlertReason) => Promise<void>>();
const mockSendSuccessAlert = vi.fn<(date: string) => Promise<void>>();
const mockIsSuccessEmailEnabled = vi.fn<() => Promise<boolean>>();
vi.mock('./email', () => ({
	sendMissingBackupAlert: (...args: unknown[]) =>
		mockSendMissingAlert(...(args as [string, BackupAlertReason])),
	sendSuccessBackupAlert: (...args: unknown[]) =>
		mockSendSuccessAlert(...(args as [string])),
	isSuccessEmailEnabled: () => mockIsSuccessEmailEnabled()
}));

// Mock db — chainable Kysely mock
function chainable() {
	const obj: Record<string, unknown> = {};
	const proxy: unknown = new Proxy(obj, {
		get: (_target, prop) => {
			if (prop === 'execute' || prop === 'executeTakeFirst') {
				return vi.fn().mockResolvedValue(undefined);
			}
			if (prop === 'onConflict') {
				return (cb: (oc: unknown) => unknown) => {
					cb(proxy);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('./db', () => ({
	db: {
		insertInto: () => chainable(),
		selectFrom: () => chainable()
	}
}));

// Importeer NA de mocks
const { startCronJob } = await import('./cron');

describe('startCronJob', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsSuccessEmailEnabled.mockResolvedValue(false);
	});

	it('plant twee cron-taken met correcte expressies en tijdzone', () => {
		startCronJob();

		expect(mockSchedule).toHaveBeenCalledTimes(2);

		// Ochtendcheck om 08:00 Europe/Amsterdam
		expect(mockSchedule).toHaveBeenCalledWith(
			'0 8 * * *',
			expect.any(Function),
			{ timezone: 'Europe/Amsterdam' }
		);

		// Avondcheck om 23:59 Europe/Amsterdam
		expect(mockSchedule).toHaveBeenCalledWith(
			'59 23 * * *',
			expect.any(Function),
			{ timezone: 'Europe/Amsterdam' }
		);
	});

	it('ochtend-callback roept checkBackups aan', async () => {
		mockFetchBackups.mockResolvedValue({
			region: 'eu-west-1',
			pitr_enabled: false,
			walg_enabled: true,
			backups: [],
			physical_backup_data: {}
		});

		startCronJob();

		// Haal de ochtend-callback op (eerste cron.schedule aanroep)
		const morningCallback = mockSchedule.mock.calls[0][1];
		await morningCallback();

		// checkBackups() moet fetchBackups hebben aangeroepen
		expect(mockFetchBackups).toHaveBeenCalled();
	});

	it('avond-callback roept checkBackups aan', async () => {
		mockFetchBackups.mockResolvedValue({
			region: 'eu-west-1',
			pitr_enabled: false,
			walg_enabled: true,
			backups: [],
			physical_backup_data: {}
		});

		startCronJob();

		// Haal de avond-callback op (tweede cron.schedule aanroep)
		const eveningCallback = mockSchedule.mock.calls[1][1];
		await eveningCallback();

		expect(mockFetchBackups).toHaveBeenCalled();
	});

	it('callback vangt fouten op zonder te crashen', async () => {
		mockFetchBackups.mockRejectedValue(new Error('Supabase API onbereikbaar'));

		startCronJob();

		const morningCallback = mockSchedule.mock.calls[0][1];

		// Moet NIET gooien — fouten worden intern afgevangen door try/catch
		await expect(morningCallback()).resolves.toBeUndefined();
	});

	it('callback stuurt alert bij API-fout', async () => {
		mockFetchBackups.mockRejectedValue(new Error('Supabase API fout: 500'));

		startCronJob();

		const morningCallback = mockSchedule.mock.calls[0][1];
		await morningCallback();

		// checkBackups vangt de fout en stuurt een alert
		expect(mockSendMissingAlert).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ type: 'api_error' })
		);
	});
});
