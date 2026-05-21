// clean-db.js — wipe all products from MongoDB
require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const Product = require('../db-blueprint/data-model');

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    await Product.deleteMany({});
    console.log('✅ All products deleted from MongoDB');
    mongoose.disconnect();
  })
  .catch(err => console.error(err));