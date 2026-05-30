// =============================================================================
// server.js – Entry point. Loads env, connects DB & search, starts Express.
// =============================================================================

require("dotenv").config();
const express = require("express");
const db = require("./db-connect-CRUD/db"); // ← updated
const {
  index,
  initSearch,
  syncProduct,
} = require("./search-engine/meilisearch"); // ← updated
const { setupRoutes } = require("./api-routes/routes"); // ← updated
const logger = require("./lib/logger");

const app = express();
app.use(express.json());
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");

app.use(helmet());
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || "Internal server error",
  });
});
const path = require("path");
app.use(
  "/catalog-media",
  express.static(path.join(__dirname, "catalog-media")),
);

async function start() {
  try {
    // 1. Connect to MongoDB
    await db.connectDB();

    // 2. Configure Meilisearch index
    await initSearch();
    // ── Startup reconciliation: sync any products missing from Meilisearch ──
    try {
      const Product = require("./db-blueprint/data-model");
      const allProducts = await Product.find({}, { _id: 1, name: 1 }).lean();
      let synced = 0;
      for (const p of allProducts) {
        try {
          await index.getDocument(p._id.toString());
        } catch {
          const fullProduct = await Product.findById(p._id);
          if (fullProduct) {
            await syncProduct(fullProduct);
            synced++;
            logger.info(`Reconciled: ${fullProduct.name} (${p._id})`);
          }
        }
      }
      if (synced > 0)
        logger.info(
          `Reconciliation complete. Synced ${synced} missing products.`,
        );
    } catch (err) {
      logger.warn("Reconciliation skipped: " + err.message);
    }

    // 3. Wire up routes (they use db & search internally)
    setupRoutes(app);

    // 4. Start listening
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
