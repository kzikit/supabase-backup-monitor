import { BlobServiceClient } from '@azure/storage-blob';
import { env } from '$env/dynamic/private';
import type { Readable } from 'stream';

const VALID_CONTAINERS = ['dev', 'staging', 'prod'] as const;

function getContainer(): string {
	const container = env.AZURE_BLOB_CONTAINER;
	if (!container) {
		throw new Error('AZURE_BLOB_CONTAINER is niet ingesteld (dev | staging | prod)');
	}
	if (!VALID_CONTAINERS.includes(container as (typeof VALID_CONTAINERS)[number])) {
		throw new Error(`AZURE_BLOB_CONTAINER moet een van ${VALID_CONTAINERS.join(', ')} zijn, kreeg: "${container}"`);
	}
	return container;
}

function getBlobClient() {
	if (!env.AZURE_STORAGE_CONNECTION_STRING) {
		throw new Error('AZURE_STORAGE_CONNECTION_STRING is niet ingesteld');
	}
	return BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING);
}

/**
 * Uploadt een readable stream naar Azure Blob Storage.
 * Retourneert de grootte in bytes van de geüploade blob.
 */
export async function uploadStream(blobPath: string, stream: Readable): Promise<number> {
	const container = getBlobClient().getContainerClient(getContainer());
	await container.createIfNotExists();
	const blob = container.getBlockBlobClient(blobPath);

	// 4 MB blokken, 4 parallelle uploads
	await blob.uploadStream(stream, 4 * 1024 * 1024, 4, {
		blobHTTPHeaders: { blobContentEncoding: 'gzip' }
	});

	const props = await blob.getProperties();
	return props.contentLength ?? 0;
}

/**
 * Uploadt een JSON-object als blob.
 */
export async function uploadJson(blobPath: string, data: unknown): Promise<void> {
	const container = getBlobClient().getContainerClient(getContainer());
	await container.createIfNotExists();
	const blob = container.getBlockBlobClient(blobPath);
	const content = JSON.stringify(data, null, 2);
	await blob.upload(content, content.length, {
		blobHTTPHeaders: { blobContentType: 'application/json' }
	});
}
