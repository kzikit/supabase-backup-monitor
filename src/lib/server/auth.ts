import { env } from '$env/dynamic/private';

/**
 * Valideer basic auth credentials.
 * Retourneert true als de credentials kloppen.
 */
export function validateBasicAuth(authHeader: string | null): boolean {
	if (!authHeader || !authHeader.startsWith('Basic ')) {
		return false;
	}

	const encoded = authHeader.slice(6);
	const decoded = atob(encoded);
	const [user, pass] = decoded.split(':');

	return user === (env.BASIC_AUTH_USER || 'admin') && pass === (env.BASIC_AUTH_PASS || '');
}

/**
 * Maak een 401 response aan met WWW-Authenticate header.
 */
export function unauthorizedResponse(): Response {
	return new Response('Unauthorized', {
		status: 401,
		headers: {
			'WWW-Authenticate': 'Basic realm="Supabase Backup Monitor"'
		}
	});
}
