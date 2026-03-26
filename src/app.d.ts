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
		[key: string]: string | undefined;
	};
}

export {};
