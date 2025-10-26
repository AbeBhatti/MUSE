// backend/routes/midi.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { transcribeAudio } = require('../services/transcribe');

const router = express.Router();

// Directories
const AUDIO_MIDI_ROOT = path.join(__dirname, '..', '..', 'audio-midi');
const UPLOAD_DIR = path.join(AUDIO_MIDI_ROOT, 'temp_uploads');
const OUTPUT_DIR = path.join(AUDIO_MIDI_ROOT, 'temp_output');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Multer setup with limits and filter
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, file.originalname || `upload_${Date.now()}`)
});

const audioMimes = new Set([
  'audio/mpeg', // mp3
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/flac',
  'audio/ogg',
  'audio/m4a',
  'audio/x-m4a',
]);

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 1 }, // 25MB
  fileFilter: (_req, file, cb) => {
    if (audioMimes.has(file.mimetype)) return cb(null, true);
    return cb(new Error('Unsupported file type'));
  }
});

// POST /upload — audio to MIDI
router.post('/upload', rateLimit, upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const finalPath = path.join(UPLOAD_DIR, req.file.filename);
  try {
    const result = await transcribeAudio(finalPath, OUTPUT_DIR, req.body || {});
    try { fs.unlinkSync(finalPath); } catch {}
    return res.json(result);
  } catch (e) {
    try { fs.unlinkSync(finalPath); } catch {}
    return next(e);
  }
});

// GET /midi/:filename — serve generated MIDI
router.get('/midi/:filename', (req, res) => {
  const p = path.join(OUTPUT_DIR, req.params.filename);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
  return res.sendFile(p);
});

module.exports = router;
// Simple in-memory rate limiter per IP (10 requests/min)
const rateMap = new Map();
function rateLimit(req, res, next) {
  const key = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 10;
  const entry = rateMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  rateMap.set(key, entry);
  if (entry.count > limit) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  return next();
}
