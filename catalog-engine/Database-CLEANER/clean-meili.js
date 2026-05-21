// clean-meili.js — clear all documents from Meilisearch index
require('dotenv').config({ path: '../.env' });
const { Meilisearch } = require('meilisearch');

const client = new Meilisearch({
  host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
  apiKey: process.env.MEILISEARCH_MASTER_KEY,
});

client.index('products').deleteAllDocuments()
  .then(() => {
    console.log('✅ Meilisearch index cleared');
  })
  .catch(err => console.error(err));