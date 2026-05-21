// prisma.config.js – loads .env for the CLI, then exports Prisma 7 config
require("dotenv").config();

module.exports = {
  schema: "./prisma/schema.prisma",
  migrations: {
    path: "./prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
};
