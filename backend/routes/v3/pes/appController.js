// ============================================================
// PES Mini App Controller
// ============================================================
// Serves the Telegram Mini App HTML and provides data endpoints
// These endpoints are public (no JWT) for Telegram WebApp access
// ============================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStatus, getState } from '../../../services/pes/bridge.js';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PES_ROOT = join(__dirname, '../../../..', 'pes-core');
const MINIAPP_HTML = join(PES_ROOT, 'miniapp', 'index.html');
const DB_FILE = join(PES_ROOT, 'pes-data', 'bublik.db');

let _db = null;
function getDb() {
  if (_db) return _db;
  if (!existsSync(DB_FILE)) return null;
  try {
    _db = new Database(DB_FILE, { readonly: true, fileMustExist: true });
    _db.pragma('journal_mode = WAL');
    return _db;
  } catch { return null; }
}

export default function registerAppRoutes(router) {

  // ── Serve Mini App HTML ──
  router.get('/app', (req, res) => {
    try {
      if (!existsSync(MINIAPP_HTML)) {
        return res.status(404).send('Mini App not found');
      }
      const html = readFileSync(MINIAPP_HTML, 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(html);
    } catch (err) {
      res.status(500).send('Error loading Mini App');
    }
  });

  // ── Status (public) ──
  router.get('/app/status', (req, res) => {
    try {
      const status = getStatus();
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get status' });
    }
  });

  // ── Notes ──
  router.get('/app/notes', (req, res) => {
    const db = getDb();
    if (!db) return res.json([]);
    try {
      const notes = db.prepare(
        'SELECT id, text, tags, category, pinned, remind_at, created_at FROM owner_notes WHERE is_deleted = 0 ORDER BY pinned DESC, id DESC LIMIT 50'
      ).all();
      res.json(notes);
    } catch { res.json([]); }
  });

  // ── Reminders (pending only) ──
  router.get('/app/reminders', (req, res) => {
    const db = getDb();
    if (!db) return res.json([]);
    try {
      const reminders = db.prepare(
        'SELECT id, text, remind_at, created_at FROM reminders WHERE delivered = 0 ORDER BY remind_at ASC LIMIT 20'
      ).all();
      res.json(reminders);
    } catch { res.json([]); }
  });

  // ── Unlocks ──
  router.get('/app/unlocks', (req, res) => {
    const db = getDb();
    if (!db) return res.json([]);
    try {
      const unlocks = db.prepare(
        'SELECT feature, level_req, unlocked, unlocked_at, category FROM unlocks ORDER BY level_req ASC'
      ).all();
      res.json(unlocks);
    } catch { res.json([]); }
  });

  // ── Timeline (recent interactions) ──
  router.get('/app/timeline', (req, res) => {
    const db = getDb();
    if (!db) return res.json([]);
    try {
      const items = db.prepare(
        'SELECT id, timestamp, actor, action_type, emotion_before, emotion_after, xp_gained FROM interactions ORDER BY id DESC LIMIT 30'
      ).all();
      res.json(items);
    } catch { res.json([]); }
  });

  // ── Contacts ──
  router.get('/app/contacts', (req, res) => {
    const db = getDb();
    if (!db) return res.json([]);
    try {
      const contacts = db.prepare(
        'SELECT id, name, phone, email, birthday, relationship, notes, created_at FROM owner_contacts WHERE is_deleted = 0 ORDER BY name ASC LIMIT 50'
      ).all();
      res.json(contacts);
    } catch { res.json([]); }
  });

  // ── Files ──
  router.get('/app/files', (req, res) => {
    const db = getDb();
    if (!db) return res.json([]);
    try {
      const files = db.prepare(
        'SELECT id, file_type, file_name, description, tags, created_at FROM owner_files WHERE is_deleted = 0 ORDER BY id DESC LIMIT 50'
      ).all();
      res.json(files);
    } catch { res.json([]); }
  });

  // ── Search (notes + contacts + files) ──
  router.get('/app/search', (req, res) => {
    const db = getDb();
    const q = req.query.q;
    if (!db || !q) return res.json({ notes: [], contacts: [], files: [] });
    try {
      const like = `%${q}%`;
      const notes = db.prepare(
        'SELECT id, text, tags, category, pinned, created_at FROM owner_notes WHERE is_deleted = 0 AND text LIKE ? LIMIT 20'
      ).all(like);
      const contacts = db.prepare(
        'SELECT id, name, phone, email, relationship, notes FROM owner_contacts WHERE is_deleted = 0 AND (name LIKE ? OR phone LIKE ? OR notes LIKE ?) LIMIT 20'
      ).all(like, like, like);
      const files = db.prepare(
        'SELECT id, file_type, file_name, description FROM owner_files WHERE is_deleted = 0 AND (file_name LIKE ? OR description LIKE ?) LIMIT 20'
      ).all(like, like);
      res.json({ notes, contacts, files });
    } catch { res.json({ notes: [], contacts: [], files: [] }); }
  });

  // ── Action (pet/feed/play/talk) ──
  router.post('/app/action', (req, res) => {
    const { action } = req.body || {};
    if (!action) return res.status(400).json({ error: 'Missing action' });

    // Write action as CRM event for PES to consume
    try {
      const eventsFile = join(PES_ROOT, 'pes-data', 'crm-events.json');
      let events = [];
      if (existsSync(eventsFile)) {
        events = JSON.parse(readFileSync(eventsFile, 'utf8'));
      }

      const actionMap = {
        pet: { type: 'miniapp_pet', data: { action: 'pet', source: 'miniapp' } },
        feed: { type: 'miniapp_feed', data: { action: 'feed', source: 'miniapp' } },
        play: { type: 'miniapp_play', data: { action: 'play', source: 'miniapp' } },
        talk: { type: 'miniapp_talk', data: { action: 'talk', source: 'miniapp' } },
      };

      const mapped = actionMap[action];
      if (!mapped) return res.status(400).json({ error: 'Unknown action' });

      events.push({
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        type: mapped.type,
        data: mapped.data,
        timestamp: new Date().toISOString(),
        consumed: false,
      });

      if (events.length > 100) events = events.slice(-100);
      writeFileSync(eventsFile, JSON.stringify(events, null, 2));

      res.json({ ok: true, action });
    } catch (err) {
      res.status(500).json({ error: 'Action failed' });
    }
  });
}
