/* eslint-disable @typescript-eslint/no-require-imports */
// Quick test script to verify Azure Blob access using .env
// Usage: node scripts/test-azure-blob.js

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });
const { BlobServiceClient } = require('@azure/storage-blob');

async function main() {
  const conn = process.env.AZURE_BLOB_CONNECTION_STRING || '';
  const containerName = process.env.AZURE_BLOB_CONTAINER || 'uploads';
  console.log('AZURE_BLOB_CONNECTION_STRING present:', !!conn);
  console.log('AZURE_BLOB_CONTAINER:', containerName);
  if (!conn) {
    console.error('No AZURE_BLOB_CONNECTION_STRING in environment. Aborting.');
    process.exit(2);
  }

  try {
    const service = BlobServiceClient.fromConnectionString(conn);
    const container = service.getContainerClient(containerName);
    console.log('Checking container properties...');
    // Try to get properties (this will fail with 404 if not exists)
    try {
      const props = await container.getProperties();
      console.log('Container exists. properties:', {
        lastModified: props.lastModified,
        etag: props.etag,
        leaseStatus: props.leaseStatus,
      });
    } catch (err) {
      console.error('getProperties failed:', err && err.message ? err.message : err);
      console.log('Attempting to create container with createIfNotExists()...');
      const created = await container.createIfNotExists();
      console.log('createIfNotExists result:', created.succeeded ? 'created' : 'already existed');
      if (created._response && created._response.status) {
        console.log('HTTP status:', created._response.status);
      }
    }

    // Try uploading a tiny test blob to validate upload permission
    const testBlobName = `diagnostic-${Date.now()}.txt`;
    const block = container.getBlockBlobClient(testBlobName);
    const content = 'diagnostic test';
    try {
      await block.uploadData(Buffer.from(content), { blobHTTPHeaders: { blobContentType: 'text/plain' } });
      console.log('Uploaded test blob:', block.url);
      // cleanup: delete the test blob
      try {
        await block.deleteIfExists();
        console.log('Deleted test blob');
      } catch (e) {
        console.warn('Failed to delete test blob:', e && e.message ? e.message : e);
      }
      console.log('Azure connection and container access OK');
    } catch (err) {
      // Print detailed error information to help diagnose 404/403/other
      const full = {};
      for (const k of Object.getOwnPropertyNames(err)) full[k] = err[k];
      console.error('Upload failed, full error:', JSON.stringify(full, null, 2));
      throw err;
    }
  } catch (e) {
    console.error('Azure test failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();

