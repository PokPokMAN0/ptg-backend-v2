# 🏪 Prime Tech Gallery v2

_A production‑grade, dual‑service headless e‑commerce platform & POS system for mobile phone showrooms._

![Status](https://img.shields.io/badge/backend-complete-brightgreen)
![Frontend](https://img.shields.io/badge/frontend-to%20be%20done-orange)
![License](https://img.shields.io/badge/license-MIT-blue)
![Stack](https://img.shields.io/badge/stack-Fastify%20%7C%20Express%20%7C%20Prisma%207%20%7C%20PostgreSQL-blueviolet)

**Prime Tech Gallery v2** is a security‑first, fully headless backend split into two independent services:
- **Catalog Engine** – blazing‑fast public product catalog with typo‑tolerant search  
- **Main Core** – secure operational backend handling auth, encrypted inventory, atomic POS, and analytics

Together they power a complete mobile phone & accessories retail business.  
All exposed through a clean, documented REST API.

> 🚧 **The Next.js storefront (product catalog, cart, admin dashboard, POS UI) is currently under development.**

---

## 📊 Project Status

| Component               | Status        |
| ----------------------- | ------------- |
| Catalog Engine          | ✅ Complete   |
| Main Core Backend       | ✅ Complete   |
| Auth & RBAC             | ✅ Complete   |
| Encrypted Inventory     | ✅ Complete   |
| Product Catalog         | ✅ Complete   |
| Image Upload & Serving  | ✅ Complete   |
| POS Checkout            | ✅ Complete   |
| Admin Dashboard Reports | ✅ Complete   |
| **Frontend (Next.js)**  | 🚧 To Be Done |

---

## 🛠️ Tech Stack

### 🏪 Catalog Engine

| Technology      | Purpose                                |
| --------------- | -------------------------------------- |
| **Express**     | HTTP server                            |
| **MongoDB**     | Document store for product data        |
| **Mongoose**    | MongoDB ODM                            |
| **Meilisearch** | Typo‑tolerant full‑text search engine  |
| **Sharp**       | Image processing (auto‑resize, crop)   |
| **Multer**      | Multipart file uploads                 |

### 🧠 Main Core

| Technology               | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| **Fastify**              | Ultra‑fast HTTP server                        |
| **TypeScript**           | Type‑safe development                         |
| **Prisma 7**             | Next‑gen ORM with migrations                  |
| **PostgreSQL**           | ACID‑compliant relational database            |
| **@fastify/jwt**         | JWT authentication                            |
| **@fastify/swagger**     | Auto‑generated OpenAPI documentation          |
| **@fastify/rate-limit**  | Brute‑force & DDoS protection                 |
| **Argon2id**             | OWASP‑recommended password hashing            |
| **AES‑256‑GCM**          | IMEI / Serial encryption at rest              |
| **HMAC‑SHA256**          | Deterministic barcode hashing for fast lookup |
| **Resend**               | Email delivery (OTP verification, password reset) |
| **Zod**                  | Runtime input validation                      |
| **Vitest**               | Integration testing                           |

---

## 🏗️ Architecture
```
┌─────────────────────────────────────────────────────┐
│                   CLIENT LAYER                      │
│  ┌──────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │Web Storefront│  │ POS UI   │  │Admin Dashboard│  │
│  │ (Next.js)    │  │(Next.js) │  │ (Next.js)     │  │
│  └──────┬───────┘  └────┬─────┘  └──────┬────────┘  │
│         │               │               │           │
└─────────┼───────────────┼───────────────┼───────────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
         ┌────────────────▼────────────────┐
         │ API GATEWAY                     │
         │ Fastify + JWT + RBAC + Rate Lim │
         └────────────────┬────────────────┘
                          │
      ┌───────────────────┼───────────────────┐
      │                   │                   │
      ▼                   ▼                   ▼
   ┌───────────┐ ┌──────────────────┐ ┌─────────────┐
   │ Express   │ │ Fastify (Core)   │ │ Meilisearch │
   │ (Catalog) │ │                  │ │ (Search)    │
   └─────┬─────┘ └────────┬─────────┘ └──────┬──────┘
         │                │                  │
         ▼                ▼                  ▼
   ┌───────────┐ ┌──────────────────┐ ┌──────────────┐
   │ MongoDB   │ │ PostgreSQL       │ │ Meilisearch  │
   │ (Catalog) │ │ (Users,Sales,etc)│ │ (Index)      │
   └───────────┘ └──────────────────┘ └──────────────┘

The **Catalog Engine** owns the public product data.  
The **Main Core** owns all sensitive operational data.  
They are linked via `CatalogRef` – a lightweight
PostgreSQL table that caches product IDs, names, and
prices for fast SQL joins and reporting.

---
```

## 🔐 Security at Its Core

| Feature                   | Implementation                                  |
| ------------------------- | ----------------------------------------------- |
| **Password Hashing**      | Argon2id (64 MiB memory, 3 iterations)          |
| **Access Tokens**         | JWT (15‑min expiry)                             |
| **Refresh Tokens**        | Single‑use, stored as SHA‑256 hash              |
| **IMEI Encryption**       | AES‑256‑GCM with random IV per encryption       |
| **IMEI Lookup**           | HMAC‑SHA256 hash (indexable, constant‑time)     |
| **Role‑Based Access**     | `authenticate` + `requireRole` middleware       |
| **Audit Logging**         | All write actions & IMEI access tracked         |
| **Rate Limiting**         | Brute‑force & scrape protection                 |
| **SQL Injection**         | Prevented via Prisma parameterized queries      |
| **API Documentation**     | Auto‑generated Swagger UI at `/docs`            |
| **Structured Logging**    | Pino (Fastify) & pino (Express)                 |

---

## 📡 API Endpoints

### 🏪 Catalog Engine (`http://localhost:4000`)

| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `GET` | `/api/search?q=…&limit=…&page=…` | None | Typo‑tolerant product search |
| `GET` | `/api/products` | None | List all products |
| `GET` | `/api/products/:id` | None | Get single product |
| `POST` | `/api/products` | API‑Key | Create product (optional image) |
| `PUT` | `/api/products/:id` | API‑Key | Update product (optional image) |
| `DELETE` | `/api/products/:id` | API‑Key | Delete product |
| `GET` | `/catalog-media/:filename` | None | Serve product images |

### 🧠 Main Core (`http://localhost:8080`)

#### 🔐 Auth
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `POST` | `/v1/auth/register` | None | Register (unverified) |
| `POST` | `/v1/auth/login` | None | Login → JWT + refresh cookie |
| `POST` | `/v1/auth/refresh` | Cookie | Refresh access token |
| `POST` | `/v1/auth/logout` | Cookie | Revoke refresh token |
| `POST` | `/v1/auth/verify-email` | None | Verify email with OTP |
| `POST` | `/v1/auth/resend-verification-otp` | None | Resend verification OTP |
| `POST` | `/v1/auth/forgot-password` | None | Request password reset code |
| `POST` | `/v1/auth/reset-password` | None | Reset password with code |
| `GET` | `/v1/auth/me` | Bearer | Get current user profile |

#### 📦 Catalog Sync
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `POST` | `/v1/admin/catalog-ref/sync` | Admin | Manual sync from Catalog Engine |
| `POST` | `/v1/admin/catalog-ref/auto-sync` | API‑Key | Auto‑sync (called by Catalog Engine) |

#### 🏷️ Product Management (Admin)
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `PUT` | `/v1/admin/products/:catalog_id` | Admin | Update product (proxied to Catalog Engine) |
| `DELETE` | `/v1/admin/products/:catalog_id` | Admin | Soft‑delete product |

#### 🔒 Inventory Vault (Admin)
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `POST` | `/v1/admin/inventory` | Admin | Add stock (encrypted IMEIs) |
| `GET` | `/v1/admin/inventory` | Admin | List units (decrypted) |
| `GET` | `/v1/admin/inventory/:id` | Admin | Get single unit (decrypted) |
| `PUT` | `/v1/admin/inventory/:id` | Admin | Update unit (condition, notes, etc.) |
| `DELETE` | `/v1/admin/inventory/:id` | Admin | Delete unit |

#### 💰 Point of Sale (Admin/Salesman)
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `GET` | `/v1/pos/lookup?barcode=…` | Admin/Salesman | Verify barcode before sale |
| `GET` | `/v1/pos/search-inventory?q=…` | Admin/Salesman | Search catalog + show available IMEIs |
| `POST` | `/v1/pos/sales` | Admin/Salesman | Atomic sale + warranty |

#### 📊 Reports (Admin)
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `GET` | `/v1/admin/reports/dashboard?period=…` | Admin | Sales summary, top products, valuation |
| `GET` | `/v1/admin/reports/sales?period=…&limit=…&page=…` | Admin | Paginated sales list (decrypted IMEIs) |

#### 👥 User Management (Admin)
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `GET` | `/v1/admin/users` | Admin | List all users |
| `PUT` | `/v1/admin/users/:id/role` | SUPER_ADMIN | Change user role |
| `DELETE` | `/v1/admin/users/:id` | Admin | Delete user |
| `PUT` | `/v1/admin/users/:id/profile` | Admin | Update user profile |

#### 🛒 Customer
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `PUT` | `/v1/customer/account` | Customer | Update own profile |
| `PUT` | `/v1/customer/account/password` | Customer | Change password |
| `DELETE` | `/v1/customer/account` | Customer | Delete own account |
| `GET/POST/DELETE` | `/v1/customer/cart` | Customer | Cart management |
| `GET/POST/DELETE` | `/v1/customer/wishlist` | Customer | Wishlist management |
| `GET/POST/PUT/DELETE` | `/v1/customer/addresses` | Customer | Address management |
| `GET` | `/v1/customer/orders` | Customer | Order history |

#### 🏢 Supplier & Batch (Admin)
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `CRUD` | `/v1/admin/suppliers` | Admin | Supplier management |
| `POST/GET` | `/v1/admin/batches` | Admin | Batch management |

#### 🛡️ Warranty (Admin)
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `GET` | `/v1/admin/warranties` | Admin | List warranties |
| `PUT` | `/v1/admin/warranties/:id` | Admin | Update warranty status |

#### 🌐 Web Checkout
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `POST` | `/v1/checkout/web` | Customer | Place a web order |

#### ❤️ System
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| `GET` | `/health` | None | Server + database health |

---

## 🗄️ Database Schema Highlights

- **Users & Roles** – SUPER_ADMIN, ADMIN, SALESMAN, CUSTOMER with Argon2id hashed passwords
- **CatalogRef** – Lightweight sync bridge between MongoDB catalog and PostgreSQL
- **Inventory Vault** – Individual IMEI/Serial units encrypted with AES‑256‑GCM; HMAC hashes for barcode lookup
- **Sales & Sale Items** – Atomic transactions, per‑item profit tracking, walk‑in customer support
- **Suppliers & Batches** – Purchase tracking with invoices
- **Carts & Wishlists** – Persistent server‑side storage for authenticated customers
- **Warranties** – Automatic creation on sale, status tracking
- **Audit Logs** – Immutable record of all sensitive actions
- **OTP Codes** – Hashed one‑time codes for email verification and password reset

---

## 🚀 Getting Started

### Prerequisites

- Node.js ≥ 18
- MongoDB ≥ 7
- Meilisearch ≥ 1.11
- PostgreSQL ≥ 15
- Git

### 1. Clone & Install

```bash
git clone https://github.com/PokPokMAN0/ptg-backend-v2.git
cd ptg-backend-v2
```
# Configure Environment
### (catalog-engine/.env)
```
MONGODB_URI=mongodb://localhost:27017/catalog_db
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_MASTER_KEY=super-secret-key
CATALOG_API_KEY=shared-secret-key-change-me
MAIN_CORE_URL=http://localhost:8080
PORT=4000
```
### (main-core/.env)
```
DATABASE_URL="postgresql://postgres:1234@localhost:5432/prime_tech_gallery"
JWT_SECRET="your_jwt_secret"
IMEI_ENCRYPTION_KEY="64_char_hex_key"
HASH_SECRET="another_64_char_hex_key"
CATALOG_ENGINE_URL=http://localhost:4000
CATALOG_API_KEY=shared-secret-key-change-me
RESEND_API_KEY="your_resend_key"
EMAIL_FROM="Prime Tech Gallery <noreply@primetechgallery.com>"
PORT=8080
```
### Generate secure keys:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
# Setup Databases
```bash
# Catalog Engine (MongoDB) – no migration needed, Mongoose handles it

# Main Core (PostgreSQL)
cd main-core
npx prisma migrate deploy
npx prisma generate
```
# Start External Services
```bash
mongod --dbpath ./catalog-engine/mongodb-data
meilisearch --master-key=super-secret-key
```
# Start the Backend Services
```bash
# Terminal 1 – Catalog Engine
cd catalog-engine
node init.server.js

# Terminal 2 – Main Core
cd main-core
npm run dev
```
### The Catalog Engine runs on http://localhost:4000 and the Main Core on http://localhost:8080

# 🧪 Testing
```bash
cd main-core
npm test
```

# 📖 API Documentation
```
http://localhost:8080/docs
```

# 📁 Project Structure
```
ptg-backend-v2/
├── catalog-engine/          # Express + MongoDB + Meilisearch
│   ├── api-routes/          # Express route handlers
│   ├── db-blueprint/        # Mongoose schema
│   ├── db-connect-CRUD/     # Database operations
│   ├── search-engine/       # Meilisearch client & sync
│   ├── lib/                 # Logger
│   ├── init.server.js       # Bootstrap (starts MongoDB & Meilisearch)
│   └── main.js              # Express entry point
│
├── main-core/               # Fastify + PostgreSQL + Prisma
│   ├── src/
│   │   ├── server.ts        # Fastify entry point
│   │   ├── middleware/       # Auth, RBAC, validation
│   │   ├── routes/v1/       # All API routes
│   │   ├── services/        # Encryption, business logic
│   │   ├── lib/             # Logger, schema helpers
│   │   └── generated/       # Prisma client
│   ├── prisma/
│   │   └── schema.prisma    # Database schema
│   ├── tests/               # Integration tests
│   └── prisma.config.js
│
└── docker-compose.yml       # (Optional) One‑command startup
```

# Roadmap
## ✅ Backend (Completed)
Dual‑service architecture (Catalog Engine + Main Core)

JWT authentication with refresh token rotation

4‑tier RBAC (SUPER_ADMIN, ADMIN, SALESMAN, CUSTOMER)

AES‑256‑GCM IMEI encryption

HMAC‑SHA256 barcode lookup

JSONB flexible product specifications

Atomic POS checkout with profit & warranty

Image upload with auto‑resize (500×500)

Typo‑tolerant Meilisearch integration

Admin dashboard reports (flexible periods)

Immutable audit logging

Auto‑syncing between Catalog Engine and Main Core

OTP email verification & password reset

Swagger API documentation

Structured logging (Pino)

Integration tests (auth, inventory, POS)

## 🚧 Frontend (In Progress)Next.js storefront with product listing & filters

Product detail page with image gallery

User login & registration pages

Shopping cart (Zustand + server persistence)

Admin dashboard UI (inventory, users, reports)

POS barcode scanner interface

Fully responsive design (Tailwind CSS)

## 🔜 Future Ideas

Redis caching for hot queries

CDN integration (Cloudflare R2 / AWS S3)

Thermal receipt printing

Multi‑store inventory management

Mobile app (Kotlin)

Desktop POS client (C#)

# 👤 Author
Built with ❤️ by Sadnan Alam Tahmid
GitHub: @PokPokMAN0

“A beautiful backend is invisible; it just works. This one works, and it’s encrypted.” 🔒
