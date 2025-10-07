import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import db from "./db.js";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const API_BASE_URL = process.env.API_BASE_URL;
const GROUPS_STARTING_ID = Number(process.env.GROUPS_STARTING_ID) || 1;

const triggerWords = ["mobility", "low", "disability", "affordable", "design", "help", "disabled", "walk", "cheap"];

function getOrCreateUser({ name, student_id, group, member, consent }) {
  let user = db
    .prepare("SELECT * FROM users WHERE group_number=? AND member=?")
    .get(group, member);

  if (!user) {
    const result = db
      .prepare("INSERT INTO users (name, student_id, group_number, member, consent) VALUES (?, ?, ?, ?, ?)")
      .run(name, student_id, group, member, consent);
    user = { id: result.lastInsertRowid, name, student_id, group_number: group, member };
  } else if (consent && user.consent !== consent) {
    db.prepare("UPDATE users SET consent=? WHERE id=?").run(consent, user.id);
    user.consent = consent;
  }
  return user;
}

async function getNextMockResponse(user_id, seenIds = []) {
  // wait for 10 seconds to simulate thinking
  await new Promise(resolve => setTimeout(resolve, 10000));
  const seenSet = new Set(seenIds.map(Number));
  let nextId = Math.floor(Math.random() * 55) + 1;
  if (seenSet.size != 55) {
    nextId = getNextMockResponseId(seenSet);
  }
  const nextResponse = db.prepare("SELECT * FROM mock_responses WHERE id=?").get(nextId);
  return nextResponse;
}

function getNextMockResponseId(existingSet) {
  let num;
  do {
    num = Math.floor(Math.random() * 5) + 1;
  } while (existingSet.has(num));
  return num;
}

function saveMessage(user_id, role, content) {
  db.prepare("INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)").run(user_id, role, content);
}

function getChatHistory(user_id) {
  return db
    .prepare("SELECT role, content FROM messages WHERE user_id=? ORDER BY id ASC")
    .all(user_id);
}

app.get("/api/config", (req, res) => {
  res.json({
    GROUPS_STARTING_ID: Number(GROUPS_STARTING_ID) || 1
  });
});

app.post("/api/load-chat", (req, res) => {
  try {
    const { name, student_id, group, member, consent } = req.body;
    const user = getOrCreateUser({ name, student_id, group, member, consent });
    let history = getChatHistory(user.id);
    if (!history || history.length === 0) {
      history = [{ role: "assistant", content: "How can I assist you today?" }];
    }
    res.json({
      messages: history,
      name: user.name,
      student_id: user.student_id,
      group: user.group_number,
      member: user.member,
      consent: user.consent
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load chat history" });
  }
});

// (non-streaming) chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, temperature = 0.7, group, name, student_id, member } = req.body || {};
    const user = getOrCreateUser({ name, student_id, group, member });
    let context = getChatHistory(user.id);
    if (context.length === 0) {
      const lastMessage = messages.slice(-1);
      let triggerFound = false;
      if (lastMessage.length > 0) {
        const words = lastMessage[0].content.toLowerCase().split(/\W+/);
        triggerFound = words.some(word => triggerWords.includes(word));
      }
      if (!triggerFound) {
        res.json({ id: null, content: "❌ ERROR : Outside the scope of the task", raw: {} });
        return;
      }

    }

    context = context.concat(messages);
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages must be an array" });
    }

    // Save user messages
    for (const msg of messages.slice(-1)) {
      saveMessage(user.id, msg.role, msg.content);
    }

    // For groups within the specified range, use mock responses
    if (Number(group) >= GROUPS_STARTING_ID && Number(group) <= (GROUPS_STARTING_ID + 7)) {
      const { seen_mock_ids = [] } = req.body;
      const mockResponse = await getNextMockResponse(user.id, seen_mock_ids);
      if (!mockResponse) {
        res.json({ id: null, content: "No more responses available.", raw: {} });
        saveMessage(user.id, "assistant", "No more responses available.");
        return;
      }

      res.json({ id: mockResponse.id, content: mockResponse.message, raw: {} });
      saveMessage(user.id, "assistant", mockResponse.message);
      return;
    }

    let url = API_BASE_URL + "/v1/chat/completions";
    const oaiRes = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: context,
        temperature,
        stream: false
      })
    });

    if (!oaiRes.ok) {
      const errText = await oaiRes.text();
      return res.status(oaiRes.status).send(errText);
    }

    const data = await oaiRes.json();
    res.json({
      content: data?.choices?.[0]?.message?.content ?? "",
      raw: data
    });
    saveMessage(user.id, "assistant", data?.choices?.[0]?.message?.content ?? "");
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port: ${port}`);
});
