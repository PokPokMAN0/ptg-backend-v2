// =============================================================================
// routes.js – Express route handlers (CRUD + Search + Image Upload)
// =============================================================================

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../db-connect-CRUD/db");
const axios = require("axios");
const {
  syncProduct,
  searchProducts,
  index,
} = require("../search-engine/meilisearch");

const rateLimit = require("express-rate-limit");
const {
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelPattern,
} = require("../lib/redis");

const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: {
    success: false,
    error: "Too many requests, please try again later.",
  },
});

// -------- Ensure catalog-media folder exists --------
const MEDIA_DIR = path.join(__dirname, "..", "catalog-media");
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// -------- API Key protection --------
const API_KEY = process.env.CATALOG_API_KEY;

function requireApiKey(req, res, next) {
  if (req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
}

// -------- Sharp image processor: resize to 500x500 square, compress --------
const sharp = require("sharp");

/**
 * Processes an uploaded image buffer into a 500x500 JPEG.
 * @param {Buffer} inputBuffer - raw uploaded file
 * @param {string} destPath    - full destination path on disk
 */
async function processImage(inputBuffer, destPath) {
  // Get original metadata to decide if PNG transparency should be preserved
  const metadata = await sharp(inputBuffer).metadata();

  let pipeline = sharp(inputBuffer)
    // Resize to cover the square, centred. If image is 4:3, it crops the top/bottom equally.
    .resize(500, 500, { fit: "cover", position: "centre" })
    // Always output JPEG for consistent sizing — lossy compression, good enough for catalog
    .jpeg({ quality: 80, progressive: true });

  await pipeline.toFile(destPath);
}

// -------- Auto-sync with Main Core --------
const MAIN_CORE_URL = process.env.MAIN_CORE_URL || "http://localhost:8080";
const CATALOG_API_KEY = process.env.CATALOG_API_KEY;

async function autoSync(catalogId, product) {
  try {
    await axios.post(
      `${MAIN_CORE_URL}/v1/admin/catalog-ref/auto-sync`,
      {
        catalog_id: catalogId,
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        category: product.category?.primary || product.category,
        retail_mrp: product.pricing?.retail_mrp || product.base_price,
      },
      { headers: { "x-api-key": CATALOG_API_KEY } },
    );
  } catch (err) {
    console.error("[auto-sync] Failed to sync with Main Core:", err.message);
  }
}

// -------- Multer configuration (memory storage for Sharp processing) --------
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const storage = multer.memoryStorage(); // ← Sharp needs the raw buffer

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPG, PNG and WEBP images are allowed."), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// -------- Helpers --------
function renameImageToProductId(productId, tempFilename) {
  if (!tempFilename) return null;
  const ext = path.extname(tempFilename);
  const newName = `${productId}${ext}`;
  const oldPath = path.join(MEDIA_DIR, tempFilename);
  const newPath = path.join(MEDIA_DIR, newName);
  fs.renameSync(oldPath, newPath);
  return `/catalog-media/${newName}`;
}

function deleteImageFile(productId) {
  if (!productId) return;
  const possibleExts = [".jpg", ".jpeg", ".png"];
  for (const ext of possibleExts) {
    const filePath = path.join(MEDIA_DIR, `${productId}${ext}`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return;
    }
  }
}

function setupRoutes(app) {
  // ── Enhanced Health Check ──
  app.get("/health", async (req, res) => {
    const checks = [];

    // MongoDB
    try {
      await db.getAllProducts(); // simplest DB call
      checks.push({ service: "MongoDB", status: "OK", detail: "Connected" });
    } catch (err) {
      checks.push({
        service: "MongoDB",
        status: "Critical Error",
        detail: err.message,
      });
    }

    // Meilisearch
    try {
      const stats = await index.getStats();
      checks.push({
        service: "Meilisearch",
        status: "OK",
        detail: `${stats.numberOfDocuments} docs`,
      });
    } catch (err) {
      checks.push({
        service: "Meilisearch",
        status: "Critical Error",
        detail: err.message,
      });
    }

    // Redis (if available — non‑critical)
    try {
      let redis;
      try {
        redis = require("./lib/redis");
      } catch {
        try {
          redis = require("../lib/redis");
        } catch {
          redis = null;
        }
      }
      if (redis) {
        await redis.cacheSet("health-check", "ok", 10);
        const val = await redis.cacheGet("health-check");
        if (val === "ok") {
          checks.push({ service: "Redis", status: "OK", detail: "Connected" });
        } else {
          checks.push({
            service: "Redis",
            status: "Minor Error",
            detail: "Read-back failed",
          });
        }
      } else {
        checks.push({
          service: "Redis",
          status: "Minor Error",
          detail: "Module not found — caching disabled",
        });
      }
    } catch (err) {
      checks.push({
        service: "Redis",
        status: "Minor Error",
        detail: err.message || "Unavailable",
      });
    }

    const hasCritical = checks.some((c) => c.status === "Critical Error");
    const hasMinor = checks.some((c) => c.status === "Minor Error");
    const overall = hasCritical
      ? "Critical Error"
      : hasMinor
        ? "Minor Error"
        : "OK";

    res.json({
      status: overall,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    });
  });
  // ========================================================================
  // CREATE – POST /api/products (multipart with optional image)
  // ========================================================================
  app.post(
    "/api/products",
    requireApiKey,
    upload.single("image"),
    async (req, res) => {
      try {
        let productData;
        if (req.body.data) {
          productData = JSON.parse(req.body.data);
        } else {
          productData = req.body;
        }
        const product = await db.createProduct(productData);
        // 4a. Process and save the uploaded image
        if (req.file) {
          const ext = ".jpg"; // always output JPEG after Sharp processing
          const filename = `${product._id.toString()}${ext}`;
          const destPath = path.join(MEDIA_DIR, filename);
          await processImage(req.file.buffer, destPath);
          product.media = product.media || {};
          product.media.primary_image_url = `/catalog-media/${filename}`;
          await product.save();
        }
        await syncProduct(product);

        // ✅ Auto-sync to Main Core (non‑blocking) – moved here
        autoSync(product._id.toString(), product).catch(() => {});

        await cacheDelPattern("search:*");

        res.status(201).json(product);
      } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        res.status(400).json({ error: err.message });
      }
    },
  );

  // ========================================================================
  // READ all – GET /api/products
  // ========================================================================
  app.get("/api/products", async (req, res) => {
    const products = await db.getAllProducts();
    res.json(products);
  });

  // ========================================================================
  // READ one – GET /api/products/:id
  // ========================================================================
  app.get("/api/products/:id", async (req, res) => {
    try {
      const cacheKey = `product:${req.params.id}`;
      const cached = await cacheGet(cacheKey);
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }

      const product = await db.getProductById(req.params.id);
      if (!product) return res.status(404).json({ error: "Not found" });

      await cacheSet(
        cacheKey,
        product.toObject ? product.toObject() : product,
        300,
      ); // 5 min TTL

      res.json(product);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ========================================================================
  // UPDATE – PUT /api/products/:id (multipart with optional image)
  // ========================================================================
  app.put(
    "/api/products/:id",
    requireApiKey,
    upload.single("image"),
    async (req, res) => {
      try {
        let productData;
        if (req.body.data) {
          productData = JSON.parse(req.body.data);
        } else {
          productData = req.body;
        }
        if (req.file) {
          deleteImageFile(req.params.id);
          const ext = ".jpg";
          const filename = `${req.params.id}${ext}`;
          const destPath = path.join(MEDIA_DIR, filename);
          await processImage(req.file.buffer, destPath);
          if (!productData.media) productData.media = {};
          productData.media.primary_image_url = `/catalog-media/${filename}`;
        }
        const product = await db.updateProduct(req.params.id, productData);
        if (!product) return res.status(404).json({ error: "Not found" });
        await syncProduct(product);

        // ✅ Auto-sync (already correct, but keep after sync)
        autoSync(req.params.id, product).catch(() => {});

        // Invalidate caches
        await cacheDel(`product:${req.params.id}`);
        await cacheDelPattern("search:*"); // clear all search caches

        res.json(product);
      } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        res.status(400).json({ error: err.message });
      }
    },
  );

  // ========================================================================
  // DELETE – DELETE /api/products/:id
  // ========================================================================
  app.delete("/api/products/:id", requireApiKey, async (req, res) => {
    const product = await db.deleteProduct(req.params.id);
    if (!product) return res.status(404).json({ error: "Not found" });

    deleteImageFile(req.params.id);
    await index.deleteDocument(product._id.toString());

    // ✅ Auto-sync after successful deletion (before sending response)
    autoSync(req.params.id, {
      name: "DELETED",
      brand: "",
      category: "",
      retail_mrp: 0,
      sku: "",
    }).catch(() => {});

    // Invalidate caches
    await cacheDel(`product:${req.params.id}`);
    await cacheDelPattern("search:*"); // clear all search caches

    res.json({ message: "Deleted" });
  });

  // ========================================================================
  // SEARCH – GET /api/search?q=...&limit=20&page=1&brand=Apple
  // ========================================================================
  app.get("/api/search", async (req, res) => {
    try {
      const { q = "", limit, page, ...filters } = req.query;

      // Build a deterministic cache key from the full query
      const cacheKey = `search:${JSON.stringify({ q, limit, page, filters })}`;
      const cached = await cacheGet(cacheKey);
      if (cached) {
        return res.json({ ...cached, cached: true });
      }

      const filterArray = [];
      for (const [key, value] of Object.entries(filters)) {
        filterArray.push(`${key} = "${value}"`);
      }
      filterArray.push("metadata.is_active = true");

      const resultLimit = parseInt(limit) || 20;
      const currentPage = parseInt(page) || 1;
      const offset = (currentPage - 1) * resultLimit;

      const results = await index.search(q, {
        filter: filterArray.join(" AND "),
        limit: resultLimit,
        offset,
      });

      const response = {
        query: q,
        page: currentPage,
        limit: resultLimit,
        totalHits: results.estimatedTotalHits,
        totalPages: Math.ceil(results.estimatedTotalHits / resultLimit),
        hits: results.hits,
      };

      await cacheSet(cacheKey, response, 120); // 2 min TTL for search

      res.json(response);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { setupRoutes };
