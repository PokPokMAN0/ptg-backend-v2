-- DropForeignKey
ALTER TABLE "inventory_units" DROP CONSTRAINT "inventory_units_batch_id_fkey";

-- AlterTable
ALTER TABLE "inventory_units" ALTER COLUMN "batch_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
