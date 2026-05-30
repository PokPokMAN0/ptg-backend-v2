const Redis = require("ioredis");
const logger = require("./logger");

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 10) return null; // stop retrying after 10 failures
    return Math.min(times * 200, 2000); // exponential backoff
  },
});

redis.on("error", (err) => {
  logger.warn(
    "Redis connection error (caching will be skipped): " + err.message,
  );
});

// Helper: get cached value
async function cacheGet(key) {
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

// Helper: set cached value with TTL (default 5 minutes)
async function cacheSet(key, data, ttlSeconds = 300) {
  try {
    await redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  } catch (err) {
    // Caching failure should never break the app
    logger.warn("Redis set failed: " + err.message);
  }
}

// Helper: delete a single key
async function cacheDel(key) {
  try {
    await redis.del(key);
  } catch (err) {
    logger.warn("Redis del failed: " + err.message);
  }
}

// Helper: delete all keys matching a pattern (use sparingly)
async function cacheDelPattern(pattern) {
  try {
    const stream = redis.scanStream({ match: pattern, count: 100 });
    stream.on("data", (keys) => {
      if (keys.length) redis.del(keys);
    });
    stream.on("end", () => {});
  } catch (err) {
    logger.warn("Redis delPattern failed: " + err.message);
  }
}

module.exports = { cacheGet, cacheSet, cacheDel, cacheDelPattern };
