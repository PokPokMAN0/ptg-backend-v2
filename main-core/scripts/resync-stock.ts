import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { syncStockToCatalog } from "../src/business.rules";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

(async () => {
  // Get every distinct catalog_ref_id that has at least one AVAILABLE unit
  const refs = await prisma.catalogRef.findMany({
    include: {
      _count: {
        select: { inventory_units: { where: { status: "AVAILABLE" } } },
      },
    },
  });

  for (const ref of refs) {
    const available = ref._count.inventory_units;
    console.log(
      `Syncing ${ref.catalog_id} (${ref.name}): ${available} available`,
    );
    await syncStockToCatalog(ref.catalog_id, available);
  }

  console.log("Done.");
  await prisma.$disconnect();
})();
