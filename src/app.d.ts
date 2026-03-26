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
	export const DATABASE_URL: string;
	export const SUPABASE_ACCESS_TOKEN: string;
	export const SUPABASE_PROJECT_REF: string;
	export const RESEND_API_KEY: string;
	export const EMAIL_FROM: string;
	export const BASIC_AUTH_USER: string;
	export const BASIC_AUTH_PASS: string;
}

export {};
