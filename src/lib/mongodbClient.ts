import { MongoClient } from "mongodb";

if (!process.env.MONGODB_URI) {
  throw new Error("Please add your Mongo URI to .env.local");
}

const uri = process.env.MONGODB_URI!;
const options = {
  serverSelectionTimeoutMS: 10_000,
  connectTimeoutMS: 10_000,
};

function isDnsError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return (
    e.message.includes("querySrv") ||
    e.message.includes("ECONNREFUSED") ||
    e.message.includes("ENOTFOUND") ||
    e.message.includes("EAI_AGAIN")
  );
}

async function connectWithRetry(client: MongoClient, retries = 3): Promise<MongoClient> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await client.connect();
    } catch (e) {
      if (attempt < retries && isDnsError(e)) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw e;
    }
  }
  throw new Error("MongoClient connect failed");
}

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  const globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>;
  };

  if (!globalWithMongo._mongoClientPromise) {
    const client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = connectWithRetry(client);
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  const client = new MongoClient(uri, options);
  clientPromise = connectWithRetry(client);
}

export default clientPromise;
