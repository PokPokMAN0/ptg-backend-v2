const path = require("path");

module.exports = {
  apps: [
    {
      name: "main-core",
      script: "src/server.ts",
      interpreter: path.resolve(__dirname, "node_modules", ".bin", "ts-node"),
      watch: false,
      env: {
        NODE_ENV: "development",
        TS_NODE_PROJECT: "./tsconfig.json",
      },
    },
  ],
};
