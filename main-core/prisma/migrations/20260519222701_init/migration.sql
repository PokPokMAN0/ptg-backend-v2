-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SALESMAN', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('AVAILABLE', 'SOLD', 'DEFECTIVE', 'RETURNED', 'RESERVED');

-- CreateEnum
CREATE TYPE "UnitCondition" AS ENUM ('NEW', 'OPEN_BOX', 'REFURBISHED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'MOBILE_BANKING', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "SaleSource" AS ENUM ('POS', 'WEB');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('SHIPPING', 'BILLING');

-- CreateEnum
CREATE TYPE "WarrantyStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CLAIMED', 'VOID');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "image_url" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "AddressType" NOT NULL DEFAULT 'SHIPPING',
    "label" TEXT,
    "recipient" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line_1" TEXT NOT NULL,
    "line_2" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "division" TEXT,
    "postal_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Bangladesh',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_table" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_refs" (
    "id" UUID NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "retail_mrp" DECIMAL(12,2) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "company_name" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_batches" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "total_cost" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_units" (
    "id" UUID NOT NULL,
    "catalog_ref_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "imei_1" TEXT,
    "imei_2" TEXT,
    "serial_number" TEXT,
    "mac_address" TEXT,
    "imei_1_hash" TEXT,
    "imei_2_hash" TEXT,
    "serial_hash" TEXT,
    "dealer_cost" DECIMAL(12,2) NOT NULL,
    "retail_mrp" DECIMAL(12,2) NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "UnitCondition" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "catalog_ref_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "catalog_ref_id" UUID NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "buyer_id" UUID,
    "salesman_id" UUID,
    "shipping_address_id" UUID,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_method" "PaymentMethod" NOT NULL,
    "source" "SaleSource" NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'PENDING',
    "customer_info" JSONB,
    "payment_reference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "inventory_unit_id" UUID NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sale_price" DECIMAL(12,2) NOT NULL,
    "dealer_cost" DECIMAL(12,2),
    "profit" DECIMAL(12,2),

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranties" (
    "id" UUID NOT NULL,
    "inventory_unit_id" UUID NOT NULL,
    "sale_item_id" UUID NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "warrantor" TEXT NOT NULL,
    "status" "WarrantyStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warranties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_target_table_target_id_idx" ON "audit_logs"("target_table", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_refs_catalog_id_key" ON "catalog_refs"("catalog_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_refs_sku_key" ON "catalog_refs"("sku");

-- CreateIndex
CREATE INDEX "catalog_refs_brand_idx" ON "catalog_refs"("brand");

-- CreateIndex
CREATE INDEX "catalog_refs_category_idx" ON "catalog_refs"("category");

-- CreateIndex
CREATE INDEX "catalog_refs_catalog_id_idx" ON "catalog_refs"("catalog_id");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE INDEX "inventory_batches_supplier_id_idx" ON "inventory_batches"("supplier_id");

-- CreateIndex
CREATE INDEX "inventory_batches_purchase_date_idx" ON "inventory_batches"("purchase_date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_batches_supplier_id_invoice_number_key" ON "inventory_batches"("supplier_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_units_imei_1_key" ON "inventory_units"("imei_1");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_units_imei_2_key" ON "inventory_units"("imei_2");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_units_serial_number_key" ON "inventory_units"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_units_imei_1_hash_key" ON "inventory_units"("imei_1_hash");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_units_imei_2_hash_key" ON "inventory_units"("imei_2_hash");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_units_serial_hash_key" ON "inventory_units"("serial_hash");

-- CreateIndex
CREATE INDEX "inventory_units_catalog_ref_id_idx" ON "inventory_units"("catalog_ref_id");

-- CreateIndex
CREATE INDEX "inventory_units_batch_id_idx" ON "inventory_units"("batch_id");

-- CreateIndex
CREATE INDEX "inventory_units_status_idx" ON "inventory_units"("status");

-- CreateIndex
CREATE INDEX "inventory_units_catalog_ref_id_status_idx" ON "inventory_units"("catalog_ref_id", "status");

-- CreateIndex
CREATE INDEX "inventory_units_imei_1_hash_idx" ON "inventory_units"("imei_1_hash");

-- CreateIndex
CREATE INDEX "inventory_units_imei_2_hash_idx" ON "inventory_units"("imei_2_hash");

-- CreateIndex
CREATE INDEX "inventory_units_serial_hash_idx" ON "inventory_units"("serial_hash");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_user_id_catalog_ref_id_key" ON "cart_items"("user_id", "catalog_ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_user_id_catalog_ref_id_key" ON "wishlist_items"("user_id", "catalog_ref_id");

-- CreateIndex
CREATE INDEX "sales_buyer_id_idx" ON "sales"("buyer_id");

-- CreateIndex
CREATE INDEX "sales_salesman_id_idx" ON "sales"("salesman_id");

-- CreateIndex
CREATE INDEX "sales_status_idx" ON "sales"("status");

-- CreateIndex
CREATE INDEX "sales_source_idx" ON "sales"("source");

-- CreateIndex
CREATE INDEX "sales_created_at_idx" ON "sales"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_inventory_unit_id_key" ON "sale_items"("inventory_unit_id");

-- CreateIndex
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "warranties_inventory_unit_id_key" ON "warranties"("inventory_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "warranties_sale_item_id_key" ON "warranties"("sale_item_id");

-- CreateIndex
CREATE INDEX "warranties_expires_at_idx" ON "warranties"("expires_at");

-- CreateIndex
CREATE INDEX "warranties_status_idx" ON "warranties"("status");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_catalog_ref_id_fkey" FOREIGN KEY ("catalog_ref_id") REFERENCES "catalog_refs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_catalog_ref_id_fkey" FOREIGN KEY ("catalog_ref_id") REFERENCES "catalog_refs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_catalog_ref_id_fkey" FOREIGN KEY ("catalog_ref_id") REFERENCES "catalog_refs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_salesman_id_fkey" FOREIGN KEY ("salesman_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_shipping_address_id_fkey" FOREIGN KEY ("shipping_address_id") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_inventory_unit_id_fkey" FOREIGN KEY ("inventory_unit_id") REFERENCES "inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_inventory_unit_id_fkey" FOREIGN KEY ("inventory_unit_id") REFERENCES "inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
