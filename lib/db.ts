import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL nije postavljen u .env.local');
}

// Serverless-optimised Pool:
//   max: 1      — avoid connection exhaustion on Vercel (each invocation is isolated)
//   idleTimeoutMillis: 10_000  — close idle connections quickly
//   connectionTimeoutMillis: 5_000 — fail fast if DB unreachable (don't hang)
export const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});
