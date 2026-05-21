// =============================================================================
// db.js – MongoDB connection and all product CRUD operations.
// =============================================================================

const mongoose = require('mongoose');
const Product = require('../db-blueprint/data-model');   // ← path

// ---------------------------------------------------------------------------
// connectDB – establish a connection to MongoDB
// ---------------------------------------------------------------------------
async function connectDB() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
}

// ---------------------------------------------------------------------------
// createProduct – insert a new product document
// ---------------------------------------------------------------------------
async function createProduct(data) {
  return await Product.create(data);
}

// ---------------------------------------------------------------------------
// getAllProducts – return all products
// ---------------------------------------------------------------------------
async function getAllProducts() {
  return await Product.find();
}

// ---------------------------------------------------------------------------
// getProductById – return a single product by its ID
// ---------------------------------------------------------------------------
async function getProductById(id) {
  return await Product.findById(id);
}

// ---------------------------------------------------------------------------
// updateProduct – update a product and return the new version
// ---------------------------------------------------------------------------
async function updateProduct(id, data) {
  return await Product.findByIdAndUpdate(id, data, { new: true });
}

// ---------------------------------------------------------------------------
// deleteProduct – remove a product from the database
// ---------------------------------------------------------------------------
async function deleteProduct(id) {
  return await Product.findByIdAndDelete(id);
}

module.exports = {
  connectDB,
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};