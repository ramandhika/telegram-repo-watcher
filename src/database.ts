import sqlite3 from "sqlite3";
import { open } from "sqlite";

const DB_PATH = process.env.DATABASE_PATH || "./data/bot.db";

export async function initializeDatabase() {
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT DEFAULT 'master',
      last_commit_sha TEXT,
      UNIQUE(chat_id, owner, repo)
    );

    CREATE TABLE IF NOT EXISTS users (
      chat_id INTEGER PRIMARY KEY,
      github_username TEXT,
      github_token TEXT
    );
  `);

  console.log("Database initialized successfully.");
  return db;
}
