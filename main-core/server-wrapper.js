// server-wrapper.js – loads ts-node, then starts the real TypeScript server
require("ts-node/register");
require("./src/server.ts");
