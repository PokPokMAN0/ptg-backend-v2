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
  // ── Health Check ──
  app.get("/health", async (req, res) => {
    try {
      await db.getAllProducts(); // simplest DB call
      const searchOk = await index
        .getStats()
        .then(() => true)
        .catch(() => false);
      res.json({
        status: "ok",
        db: "connected",
        search: searchOk ? "connected" : "disconnected",
      });
    } catch (err) {
      res
        .status(500)
        .json({ status: "error", db: "disconnected", search: "unknown" });
    }
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
    const product = await db.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: "Not found" });
    res.json(product);
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

    res.json({ message: "Deleted" });
  });

  // ========================================================================
  // SEARCH – GET /api/search?q=...&limit=20&page=1&brand=Apple
  // ========================================================================
  app.get("/api/search", searchLimiter, async (req, res) => {
    const { q = "", limit, page, ...filters } = req.query;

    // If the query looks like a MongoDB ObjectId (24 hex chars), search by exact id
    const isObjectId = /^[a-fA-F0-9]{24}$/.test(q);

    try {
      let result;
      if (isObjectId) {
        // Direct ID lookup via filter – instant and precise
        result = await searchProducts("", {
          limit: parseInt(limit) || 20,
          page: parseInt(page) || 1,
          filters: { ...filters, id: q },
        });
      } else {
        // Normal full‑text search
        result = await searchProducts(q, {
          limit: parseInt(limit) || 20,
          page: parseInt(page) || 1,
          filters,
        });
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { setupRoutes };
