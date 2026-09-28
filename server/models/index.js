import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

const useSsl = process.env.DB_SSL === "true";

export const pool = new Pool({
  connectionString: process.env.DB_URL,

  connectionTimeoutMillis: 2000,

  ssl: useSsl
    ? {
        rejectUnauthorized: false,
      }
    : false,
});

pool.on("error", (error) => {
  console.error("[db] idle connection error", {
    code: error.code ?? "UNKNOWN",
  });
});

console.log(`Database pool configured. SSL: ${useSsl}`);