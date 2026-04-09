import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseBackupResponse, BackupAlertReason } from '$lib/types';

// Mock $env/dynamic/private (vereist door db.ts en email.ts)
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
		selectFrom: () => chainable(),
		deleteFrom: () => chainable()
	}
}));

// Importeer NA de mocks
const { checkBackups } = await import('./cron');

// Hulpfunctie: maak een backup response
function makeResponse(backups: SupabaseBackupResponse['backups']): SupabaseBackupResponse {
	return {
		region: 'eu-west-1',
		pitr_enabled: false,
		walg_enabled: true,
		backups,
		physical_backup_data: {}
	};
}

const TODAY = new Date().toISOString().split('T')[0];

describe('checkBackups', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsSuccessEmailEnabled.mockResolvedValue(false);
	});

	// Scenario 2: Supabase API geeft een fout (bijv. 500)
	it('stuurt een api_error waarschuwing als de Supabase API faalt', async () => {
		expect.assertions(4);

		mockFetchBackups.mockRejectedValue(new Error('Supabase API fout: 500 Internal Server Error'));

		const result = await checkBackups();

		expect(result.todayOk).toBe(false);
		expect(result.backupsFound).toBe(0);
		expect(mockSendMissingAlert).toHaveBeenCalledWith(TODAY, {
			type: 'api_error',
			message: 'Supabase API fout: 500 Internal Server Error'
		});
		expect(mockSendSuccessAlert).not.toHaveBeenCalled();
	});

	// Scenario 3: API geeft backups terug, maar vandaag ontbreekt
	it('stuurt een no_backup_today waarschuwing als de backup van vandaag ontbreekt', async () => {
		expect.assertions(4);

		mockFetchBackups.mockResolvedValue(
			makeResponse([
				{
					inserted_at: '2025-01-01T03:00:00.000Z',
					is_physical_backup: false,
					status: 'COMPLETED'
				}
			])
		);

		const result = await checkBackups();

		expect(result.todayOk).toBe(false);
		expect(result.backupsFound).toBe(1);
		expect(mockSendMissingAlert).toHaveBeenCalledWith(TODAY, { type: 'no_backup_today' });
		expect(mockSendSuccessAlert).not.toHaveBeenCalled();
	});

	// Scenario 4a: Backup van vandaag bestaat, maar status is FAILED
	it('stuurt een backup_not_completed waarschuwing bij status FAILED', async () => {
		expect.assertions(4);

		mockFetchBackups.mockResolvedValue(
			makeResponse([
				{
					inserted_at: `${TODAY}T03:00:00.000Z`,
					is_physical_backup: false,
					status: 'FAILED'
				}
			])
		);

		const result = await checkBackups();

		expect(result.todayOk).toBe(false);
		expect(result.backupsFound).toBe(1);
		expect(mockSendMissingAlert).toHaveBeenCalledWith(TODAY, {
			type: 'backup_not_completed',
			status: 'FAILED'
		});
		expect(mockSendSuccessAlert).not.toHaveBeenCalled();
	});

	// Scenario 4b: Backup van vandaag met status IN_PROGRESS
	it('stuurt een backup_not_completed waarschuwing bij status IN_PROGRESS', async () => {
		expect.assertions(3);

		mockFetchBackups.mockResolvedValue(
			makeResponse([
				{
					inserted_at: `${TODAY}T03:00:00.000Z`,
					is_physical_backup: false,
					status: 'IN_PROGRESS'
				}
			])
		);

		const result = await checkBackups();

		expect(result.todayOk).toBe(false);
		expect(mockSendMissingAlert).toHaveBeenCalledWith(TODAY, {
			type: 'backup_not_completed',
			status: 'IN_PROGRESS'
		});
		expect(mockSendSuccessAlert).not.toHaveBeenCalled();
	});

	// Controle: succesvolle backup — geen waarschuwing
	it('stuurt geen waarschuwing als de backup van vandaag COMPLETED is', async () => {
		expect.assertions(4);

		mockFetchBackups.mockResolvedValue(
			makeResponse([
				{
					inserted_at: `${TODAY}T03:00:00.000Z`,
					is_physical_backup: false,
					status: 'COMPLETED'
				}
			])
		);

		const result = await checkBackups();

		expect(result.todayOk).toBe(true);
		expect(result.backupsFound).toBe(1);
		expect(mockSendMissingAlert).not.toHaveBeenCalled();
		expect(mockSendSuccessAlert).not.toHaveBeenCalled();
	});

	// Controle: succesmail wordt gestuurd als instelling aan staat
	it('stuurt een succesmail als email_on_success is ingeschakeld', async () => {
		expect.assertions(3);

		mockIsSuccessEmailEnabled.mockResolvedValue(true);
		mockFetchBackups.mockResolvedValue(
			makeResponse([
				{
					inserted_at: `${TODAY}T03:00:00.000Z`,
					is_physical_backup: false,
					status: 'COMPLETED'
				}
			])
		);

		const result = await checkBackups();

		expect(result.todayOk).toBe(true);
		expect(mockSendSuccessAlert).toHaveBeenCalledWith(TODAY);
		expect(mockSendMissingAlert).not.toHaveBeenCalled();
	});

	// Lege response van de API
	it('stuurt een no_backup_today waarschuwing bij een lege lijst', async () => {
		expect.assertions(4);

		mockFetchBackups.mockResolvedValue(makeResponse([]));

		const result = await checkBackups();

		expect(result.todayOk).toBe(false);
		expect(result.backupsFound).toBe(0);
		expect(mockSendMissingAlert).toHaveBeenCalledWith(TODAY, { type: 'no_backup_today' });
		expect(mockSendSuccessAlert).not.toHaveBeenCalled();
	});
});
