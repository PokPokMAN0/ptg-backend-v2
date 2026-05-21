// =============================================================================
// Mongoose Product Model — Catalog Engine (v2.0 Hardened)
//
// Part 1 : Fixed skeleton with strict typing, validation, and indexes.
// Part 2 : Dynamic specifications (Mixed) — requires explicit .markModified()
//          in update controllers for deep nested changes.
// =============================================================================

const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // -------- Part 1: Fixed, validated skeleton ---------------------------
    sku: {
      type: String,
      required: [true, "SKU is required"],
      unique: true,
      trim: true,
    },
    upc_ean: {
      type: String,
      default: "",
      trim: true,
    },
    brand: {
      type: String,
      required: [true, "Brand is required"],
      index: true, // ✨ exact‑filter query index
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    model_number: {
      type: String,
      default: "",
      trim: true,
    },
    slug: {
      type: String,
      unique: true, // ✨ no duplicate URL slugs
      sparse: true, // allows multiple empty '' values
      index: true, // ✨ fast lookup by slug
      trim: true,
    },

    category: {
      primary: {
        type: String,
        required: [true, "Primary category is required"],
        index: true, // ✨ exact filter on category.primary
        trim: true,
      },
      sub_category: {
        type: String,
        default: "",
        trim: true,
      },
      path: {
        type: String,
        default: "",
        trim: true,
      },
    },

    variant: {
      storage: {
        type: String,
        default: "",
        trim: true,
        index: true, // ✨ filter by storage variant
      },
      color: {
        name: {
          type: String,
          default: "",
          trim: true,
          index: true, // ✨ filter by color name
        },
        hex_code: {
          type: String,
          default: "",
          trim: true,
        },
      },
      region_spec: {
        type: String,
        default: "",
        trim: true,
      },
    },

    pricing: {
      currency: {
        type: String,
        default: "BDT",
        trim: true,
      },
      retail_mrp: {
        type: Number,
        required: [true, "Retail MRP is required"],
        min: [0, "MRP cannot be negative"], // 🔒 data integrity
      },
      current_sale_price: {
        type: Number,
        default: null,
        min: [0, "Sale price cannot be negative"], // 🔒 data integrity
      },
      is_on_sale: {
        type: Boolean,
        default: false,
      },
      discount: {
        amount: {
          type: Number,
          default: 0,
          min: [0, "Discount amount cannot be negative"],
        },
        percentage: {
          type: Number,
          default: 0,
          min: [0, "Discount percentage cannot be negative"],
          max: [100, "Discount percentage cannot exceed 100"],
        },
      },
    },

    inventory: {
      stock_status: {
        type: String,
        default: "OUT_OF_STOCK",
        enum: {
          values: ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "BACKORDER"],
          message: "Invalid stock status: {VALUE}",
        },
      },
      available_quantity: {
        type: Number,
        default: 0,
        min: [0, "Quantity cannot be negative"], // 🔒 data integrity
      },
      low_stock_threshold: {
        type: Number,
        default: 0,
        min: [0, "Threshold cannot be negative"],
      },
      allow_backorder: {
        type: Boolean,
        default: false,
      },
    },

    media: {
      primary_image_url: {
        type: String,
        default: "",
        trim: true,
      },
      gallery_images: [{ type: String }],
      video_url: {
        type: String,
        default: null,
      },
    },

    // =======================================================================
    // 🔴 IMPORTANT: Mongoose Mixed fields DO NOT auto‑detect deep changes.
    // =======================================================================
    // If an update modifies a nested property of `specifications`
    // (e.g. `specifications.display.size`), you MUST call:
    //
    //   doc.markModified('specifications');
    //
    // BEFORE calling `doc.save()`.  Otherwise the change will be silently lost.
    //
    // For Express update controllers using `findByIdAndUpdate`, use the
    // `$set` operator or a pre‑save hook to enforce this automatically.
    // =======================================================================
    specifications: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    metadata: {
      is_active: { type: Boolean, default: true },
      warranty_info: { type: String, default: "" }, // human-readable summary (old field)
      tags: [{ type: String }],

      // ── NEW: Product‑level warranty/guarantee defaults ──
      warranty_value: { type: Number, default: 0, min: 0 }, // warranty duration in DAYS (e.g., 365)
      guarantee_value: { type: Number, default: 0, min: 0 }, // guarantee period in DAYS (e.g., 30)
      warranty_for: [{ type: String }], // covered components (e.g., "Display")
    },
  },
  {
    timestamps: true, // createdAt / updatedAt automatically
  },
);

// ---------------------------------------------------------------------------
// 🔐 Pre‑save hook: logical consistency checks
// ---------------------------------------------------------------------------
// productSchema.pre('save', function (next) {
//   if (this.is_on_sale && (this.current_sale_price == null || this.current_sale_price >= this.retail_mrp)) {
//     return next(new Error('Product marked as on sale but current_sale_price is missing or not lower than retail_mrp.'));
//   }
//   next();
// });

// ---------------------------------------------------------------------------
// Indexes for common filter / sort patterns
// ---------------------------------------------------------------------------

// Sort by creation date (newest first)
productSchema.index({ createdAt: -1 });

// Full‑text index for native MongoDB search (secondary to Meilisearch)
productSchema.index({
  name: "text",
  brand: "text",
  "category.primary": "text",
});

module.exports = mongoose.model("Product", productSchema);
