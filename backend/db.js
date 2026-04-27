const mongoose = require("mongoose");

let isConnected = false;

/**
 * Atlas strings like host/?appName= have no database; use "roster" (must match your Atlas DB or create it).
 */
function normalizeMongoUri(uri) {
  if (!uri || typeof uri !== "string") return uri;
  if (/\.mongodb\.net\/\?/i.test(uri)) {
    return uri.replace(/\.mongodb\.net\/\?/i, ".mongodb.net/roster?");
  }
  return uri;
}

/**
 * Set MONGODB_URI in backend/.env (required for Atlas).
 * Atlas: mongodb+srv://USER:PASS@cluster.mongodb.net/roster?retryWrites=true&w=majority
 * Local: mongodb://127.0.0.1:27017/roster
 */
async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  const raw = process.env.MONGODB_URI;
  if (!raw) {
    console.error(
      "[db] MONGODB_URI is not set. Add it to backend/.env (see .env.example)"
    );
  }

  const uri = normalizeMongoUri(
    (raw || "mongodb://127.0.0.1:27017/roster").trim().replace(/^["']|["']$/g, "")
  );

  const opts = {
    serverSelectionTimeoutMS: 15_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: 10,
    retryWrites: true
  };

  if (process.env.MONGODB_DB_NAME) {
    opts.dbName = process.env.MONGODB_DB_NAME;
  }

  try {
    await mongoose.connect(uri, opts);
    isConnected = true;
    console.log("MongoDB connected.");
  } catch (err) {
    isConnected = false;
    console.error("\n━━ MongoDB connection failed ━━");
    console.error(err.message);
    console.error("\nTypical fixes:");
    console.error(
      "  • Atlas → Network Access: add your IP or 0.0.0.0/0 (dev only)"
    );
    console.error(
      "  • Confirm MONGODB_URI in backend/.env (user, password, cluster host)"
    );
    console.error(
      "  • Local MongoDB: install/start mongod, or use Atlas only\n"
    );
    throw err;
  }
}

mongoose.connection.on("disconnected", () => {
  isConnected = false;
});

mongoose.connection.on("error", err => {
  console.error("Mongo driver error:", err.message);
});

module.exports = connectDB;
