// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module '$env/dynamic/private' {
	export const env: {
		DATABASE_URL: string;
		SUPABASE_ACCESS_TOKEN: string;
		SUPABASE_PROJECT_REF: string;
		RESEND_API_KEY: string;
		EMAIL_FROM: string;
		BASIC_AUTH_USER: string;
		BASIC_AUTH_PASS: string;
		AZURE_STORAGE_CONNECTION_STRING: string;
		AZURE_BLOB_CONTAINER: string;
		SUPABASE_DB_URL: string;
		SUPABASE_SERVICE_ROLE_KEY: string;
		[key: string]: string | undefined;
	};
}

export {};
