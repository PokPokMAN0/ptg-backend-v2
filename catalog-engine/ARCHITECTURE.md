# 🏪 Prime Tech Gallery — Catalog Engine Architecture

**A self‑contained, high‑performance product catalog microservice with instant, typo‑tolerant search.**

The Catalog Engine is the public face of your product data. It stores rich, structured catalog documents in MongoDB and indexes them in Meilisearch for lightning‑fast, forgiving search. A clean REST API exposes full CRUD for administrators and a powerful search endpoint for customers.

> **Status:** ✅ Production‑ready for development and staging.  
> **Integration:** Designed to be connected to the [Prime Tech Gallery Fastify backend](../prime-tech-monorepo/) and a Next.js storefront.

---

## 📊 Technology Stack

| Layer                | Technology                               | Why                                                     |
| -------------------- | ---------------------------------------- | ------------------------------------------------------- |
| **Runtime**          | Node.js (≥18)                            | Fast, event‑driven, massive ecosystem                   |
| **API Framework**    | Express.js                               | Minimalist, robust, industry standard                   |
| **Primary Database** | MongoDB (via Mongoose ODM)               | Document‑oriented, native JSON, flexible schema         |
| **Search Engine**    | Meilisearch (self‑hosted)                | Typo‑tolerant, instant, filterable, built‑in pagination |
| **Language**         | JavaScript (CommonJS)                    | No transpilation, zero config, runs directly            |
| **Environment**      | `dotenv`                                 | Loads secrets from `.env` file                          |
| **Launchers**        | Batch (`start.bat`) + Shell (`start.sh`) | One‑click start on any OS                               |

---

## 📁 Directory Structure

catalog-engine/
│
├── .env # Secrets (PORT, DB URI, Meilisearch master key)
├── package.json # Dependencies & scripts
├── package-lock.json
├── init.server.js # Bootstrap: checks deps, spawns services, runs main
├── main.js # Express server entry point
├── start.bat # Windows launcher (double‑click)
├── start.sh # Unix launcher (chmod +x && ./start.sh)
│
├── db-blueprint/ # Schema definition
│ └── data-model.js # Mongoose Product model (Part 1 + Part 2)
│
├── db-connect-CRUD/ # Database operations
│ └── db.js # MongoDB connection & all CRUD functions
│
├── api-routes/ # HTTP route definitions
│ └── routes.js # Express route handlers (CRUD + search)
│
├── search-engine/ # Meilisearch integration
│ └── meilisearch.js # Client, index config, sync helpers, search query
│
├── mongodb-data/ # MongoDB data files (auto‑created)
├── meilisearch-data/ # Meilisearch data files (auto‑created)
├── seed-catalog.js # Bulk seeder (120 diverse products)
└── node_modules/ # Installed packages

---

## 📝 File‑by‑File Breakdown

### `init.server.js` — The Bootstrapper

- **Entry point** for the whole engine.
- Checks if `node_modules` exists; if not, runs `npm install` automatically.
- Spawns `mongod` and `meilisearch` as child processes, each using a project‑local data directory (`mongodb-data/` and `meilisearch-data/`).
- Waits a few seconds for the services to be ready.
- Launches `main.js` to start the Express server.

### `main.js` — The Express Server

- Connects to MongoDB using the connection module.
- Configures the Meilisearch index (searchable & filterable attributes).
- Registers all API routes.
- Starts listening on the configured port (default `4000`).

### `db-blueprint/data-model.js` — The Product Schema

- Defines the Mongoose schema for the `Product` collection.
- **Part 1 (Fixed Skeleton):** Required, typed fields that every product must have — `name`, `brand`, `sku`, `category`, `pricing`, `inventory`, `media`, `metadata`.  
  These fields can only have their **values** changed, never their keys.
- **Part 2 (Dynamic Specifications):** The `specifications` field is a `Mixed` (schemaless) object. Administrators can create arbitrary clusters → fields → values, making it possible to store completely different attributes for phones, laptops, headphones, etc.

### `db-connect-CRUD/db.js` — Database Operations

- `connectDB()` — establishes the MongoDB connection.
- `createProduct()`, `getAllProducts()`, `getProductById()`, `updateProduct()`, `deleteProduct()` — standard Mongoose CRUD functions.

### `search-engine/meilisearch.js` — The Search Brain

- Creates a singleton Meilisearch client connected to `localhost:7700`.
- `configureIndex()` — sets which fields are searchable (full‑text) and which can be used for exact filtering.
- `flattenSpecs()` — converts the nested `specifications` object into a single searchable string (e.g., `Display:Size:6.9" | Display Size 6.9"`).
- `syncProduct()` — pushes a product into the Meilisearch index, stripping the `media` field and adding the flattened specs.
- `searchProducts()` — queries Meilisearch with optional full‑text search, exact filters, limit, and page number. Returns hits plus pagination metadata.

### `api-routes/routes.js` — The HTTP Layer

- `POST /api/products` — create a product (MongoDB → Meilisearch sync).
- `GET /api/products` — list all products from MongoDB.
- `GET /api/products/:id` — fetch a single product by ID.
- `PUT /api/products/:id` — update a product and re‑sync to Meilisearch.
- `DELETE /api/products/:id` — remove from both MongoDB and Meilisearch.
- `GET /api/search` — public search endpoint. Accepts `q` (full‑text), any number of exact filter parameters (e.g., `?brand=Apple&variant.color.name=Blue`), `limit`, and `page`.

### `start.bat` / `start.sh` — One‑Click Launchers

- Automatically change to the project directory and execute `node init.server.js`.
- No terminal navigation required — just double‑click (Windows) or run `./start.sh` (Unix).

---

## 🏛️ Design Principles

### 🔒 Reliability

- **Schema validation** via Mongoose — required fields, types, and unique indexes (e.g., `sku`).
- **Self‑healing boot** — missing `node_modules` are installed automatically.
- **Clear error messages** — if MongoDB or Meilisearch aren’t installed, the script tells you exactly what’s wrong instead of crashing silently.
- **Data consistency** — Meilisearch sync happens only after a successful MongoDB operation.

### ⚡ Efficiency

- **Dedicated search engine** — Meilisearch delivers results in <10ms, even with millions of products.
- **Pagination everywhere** — both database and search endpoints use `limit`/`offset` to avoid loading entire datasets into memory.
- **Lean indexing** — only searchable & filterable fields are sent to Meilisearch; the heavy `media` object is stripped.
- **Local data stores** — MongoDB and Meilisearch write to local disk, ensuring fast I/O in development and single‑server deployments.

### 🤝 User‑Friendliness

- **One‑click start** — `start.bat` and `start.sh` handle the entire boot sequence.
- **Intuitive REST API** — standard HTTP methods, JSON responses, predictable endpoints.
- **Typo‑tolerant search** — Meilisearch handles misspellings, partial matches, and word order automatically.
- **Filterable by any field** — simply add query parameters (`?brand=Samsung`).
- **Rich pagination metadata** — responses include `totalHits`, `totalPages`, `hasNextPage`, `hasPrevPage` so frontends can build complete navigation UIs.
- **Self‑contained** — all data lives inside the project folder, making backup, migration, and deletion trivial.

---

## 🔁 How It All Connects

### Startup Flow

start.bat / start.sh
│
▼
init.server.js
├─ [1] Ensure node_modules exist
├─ [2] Spawn mongod (data: ./mongodb-data/)
├─ [3] Spawn meilisearch (data: ./meilisearch-data/)
├─ [4] Wait for services to be ready
└─ [5] Require main.js

### Request Lifecycle (Example: `GET /api/search?q=iphone`)

Client
│
▼
routes.js → meilisearch.js.searchProducts()
│
▼
Meilisearch (localhost:7700)
│
▼
JSON response with hits + pagination

---

## 🧭 Future Integration

This catalog engine is designed to be connected to the **Prime Tech Gallery Fastify backend** and a **Next.js storefront**.

- **Admin product management** in the Fastify backend will call the catalog engine’s CRUD endpoints to keep the public catalog in sync.
- **Inventory updates** from the Fastify POS will push new stock counts to the catalog engine’s documents.
- **The Next.js storefront** will query the catalog engine’s search endpoint for browsing, filtering, and searching products.

All three components together form a complete, headless e‑commerce platform for your mobile showroom.

---

_Crafted with clarity and a touch of perfectionism — because a good system deserves a great map._
