// =============================================================================
// search.js – Meilisearch client, index configuration, sync and search helpers.
// =============================================================================

const { Meilisearch } = require("meilisearch");
const axios = require("axios");

// -------- Meilisearch client singleton --------
const client = new Meilisearch({
  host: process.env.MEILISEARCH_HOST || "http://localhost:7700",
  apiKey: process.env.MEILISEARCH_MASTER_KEY,
});

const index = client.index("products");

// -------- configureIndex – set searchable & filterable attributes --------
async function configureIndex() {
  // Fields that can be searched with full‑text
  await index.updateSearchableAttributes([
    "id", // <-- already there from previous fix
    "sku",
    "upc_ean",
    "brand",
    "name",
    "model_number",
    "slug",
    "category.primary",
    "category.sub_category",
    "category.path",
    "variant.storage",
    "variant.color.name",
    "variant.color.hex_code",
    "specifications_flat",
    "metadata.tags",
  ]);

  // ✅ ADD THIS ENTIRE BLOCK RIGHT HERE
  await index.updateFilterableAttributes([
    "id", // <-- the missing piece
    "brand",
    "category.primary",
    "variant.color.name",
    "variant.storage",
    "pricing.retail_mrp",
    "inventory.stock_status",
    "metadata.is_active",
  ]);
}

// -------- flattenSpecs – convert dynamic specs object to searchable text --------
function flattenSpecs(specs) {
  if (!specs || typeof specs !== "object") return "";
  const parts = [];
  for (const [cluster, fields] of Object.entries(specs)) {
    if (typeof fields !== "object") continue;
    for (const [field, value] of Object.entries(fields)) {
      if (value != null) {
        parts.push(`${cluster}:${field}:${value}`);
        parts.push(`${cluster} ${field} ${value}`);
      }
    }
  }
  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// syncProduct – push a product into Meilisearch and wait until it’s indexed
// ---------------------------------------------------------------------------
async function syncProduct(product) {
  const obj = product.toObject ? product.toObject() : product;
  delete obj.media;
  obj.specifications_flat = flattenSpecs(obj.specifications);

  // Use the MongoDB _id as the string primary key, then remove _id
  obj.id = obj._id ? obj._id.toString() : obj.id;
  delete obj._id; // <-- prevents primary key conflict

  const task = await index.addDocuments([obj]);

  // Poll REST API until indexing finishes
  const baseUrl = process.env.MEILISEARCH_HOST || "http://localhost:7700";
  const headers = {
    Authorization: `Bearer ${process.env.MEILISEARCH_MASTER_KEY}`,
  };
  let taskStatus;

  do {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { data } = await axios.get(`${baseUrl}/tasks/${task.taskUid}`, {
      headers,
    });
    taskStatus = data.status;
    if (data.status === "failed") {
      throw new Error(`Meilisearch sync failed: ${JSON.stringify(data.error)}`);
    }
  } while (taskStatus !== "succeeded");
}

// -------- searchProducts – query Meilisearch with filters and pagination --------
async function searchProducts(query, options = {}) {
  const { q = "", limit = 20, page = 1, filters = {} } = options;

  const filterArray = [];
  for (const [key, value] of Object.entries(filters)) {
    filterArray.push(`${key} = "${value}"`);
  }
  filterArray.push("metadata.is_active = true");

  const offset = (page - 1) * limit;

  const results = await index.search(q, {
    filter: filterArray.join(" AND "),
    limit,
    offset,
  });

  return {
    query: q,
    page,
    limit,
    totalHits: results.estimatedTotalHits,
    totalPages: Math.ceil(results.estimatedTotalHits / limit),
    hits: results.hits,
  };
}

// -------- initSearch – run once at startup to configure the index --------
async function initSearch() {
  await configureIndex();
  console.log("Meilisearch index configured");
}

module.exports = {
  initSearch,
  syncProduct,
  searchProducts,
  index, // <-- added, so routes can call index.deleteDocument()
};
