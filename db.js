import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const MOCK_FILE = path.resolve("mock_responses.txt");
const dbPath = process.env.DATABASE_FILE || 'chat_history_ex5.db';

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  student_id TEXT NOT NULL,
  group_number TEXT NOT NULL,
  member TEXT NOT NULL,
  consent TEXT NOT NULL,
  UNIQUE(group_number, member)
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS mock_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL
)
`).run();

if (fs.existsSync(MOCK_FILE)) {
    const lines = fs.readFileSync(MOCK_FILE, "utf-8")
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const existingCount = db.prepare("SELECT COUNT(*) as count FROM mock_responses").get().count;
    if (existingCount === 0 && lines.length > 0) {
        const insert = db.prepare("INSERT INTO mock_responses (message) VALUES (?)");
        const insertMany = db.transaction((responses) => {
            for (const msg of responses) insert.run(msg);
        });
        insertMany(lines);
        console.log(`Loaded ${lines.length} mock responses from file.`);
    } else {
        console.log("Mock responses table already populated.");
    }
} else {
    console.warn("No mock_responses.txt file found.");
}

export default db;