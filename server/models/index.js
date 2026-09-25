import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

const useSsl = process.env.DB_SSL === "true";

export const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: useSsl
    ? {
        rejectUnauthorized: false,
      }
    : false,
});

console.log(`Database pool configured. SSL: ${useSsl}`);