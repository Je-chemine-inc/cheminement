import mongoose from "mongoose";
import { config } from "dotenv";

// Load environment variables
config({
  path: ".env",
  override: false,
});

const MONGODB_URI = process.env.MONGODB_URI!;

if (!MONGODB_URI) {
  throw new Error(
    "Please define the MONGODB_URI environment variable inside .env",
  );
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

const CONNECT_OPTS = {
  bufferCommands: false,
  serverSelectionTimeoutMS: 10_000,
  connectTimeoutMS: 10_000,
};

/** Transient network errors worth retrying on cold-start. */
function isRetryableError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return (
    e.message.includes("querySrv") ||
    e.message.includes("ECONNREFUSED") ||
    e.message.includes("ENOTFOUND") ||
    e.message.includes("EAI_AGAIN") ||
    e.message.includes("Server selection timed out") ||
    e.message.includes("getaddrinfo")
  );
}

async function connectWithRetry(retries = 3): Promise<typeof mongoose> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await mongoose.connect(MONGODB_URI, CONNECT_OPTS);
    } catch (e) {
      if (attempt < retries && isRetryableError(e)) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw e;
    }
  }
  // unreachable, but satisfies TypeScript
  throw new Error("MongoDB connect failed");
}

async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = connectWithRetry();
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectToDatabase;
