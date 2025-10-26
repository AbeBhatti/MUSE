// backend/routes/stems.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { parseFile } = require('music-metadata');
const { separateStems } = require('../services/stems');

const router = express.Router();

const AUDIO_ROOT = path.join(__dirname, '..', '..', 'audio-midi');
const STEM_ROOT = path.join(AUDIO_ROOT, 'stems');
const STEM_UPLOAD_ROOT = path.join(STEM_ROOT, 'uploads');

fs.mkdirSync(STEM_ROOT, { recursive: true });
fs.mkdirSync(STEM_UPLOAD_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STEM_UPLOAD_ROOT),
  filename: (_req, file, cb) => {
    const base = file.originalname || `upload_${Date.now()}`;
    cb(null, base.replace(/\s+/g, '_'));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 35 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) return cb(null, true);
    if (file.originalname?.toLowerCase().endsWith('.mp3')) return cb(null, true);
    return cb(new Error('Unsupported file type'));
  }
});

/**
 * Simple heuristic to map stem filenames to DAW instrument lanes.
 * @param {string} stemName
 * @returns {"drums"|"bass"|"synth"|"piano"|"vocals"|"transcribed"}
 */
function mapStemToInstrument(stemName) {
  const name = stemName.toLowerCase();
  if (name.includes('drum') || name.includes('perc') || name.includes('beat')) return 'drums';
  if (name.includes('kick') || name.includes('snare') || name.includes('hat')) return 'drums';
  if (name.includes('bass') || name.includes('low')) return 'bass';
  if (name.includes('vocal') || name.includes('vox') || name.includes('voice')) return 'vocals';
  if (name.includes('piano') || name.includes('keys')) return 'piano';
  if (name.includes('synth') || name.includes('pad')) return 'synth';
  return 'transcribed';
}

/**
 * POST /stems/upload
 * Accepts an MP3/WAV file, runs Demucs separation, and returns metadata about the stems.
 */
router.post('/upload', upload.single('file'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const tempFilePath = path.join(STEM_UPLOAD_ROOT, req.file.filename);
  const jobId = uuidv4();
  const jobDir = path.join(STEM_ROOT, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const stemMap = await separateStems(tempFilePath, jobDir);
    const stems = [];

    for (const [stemName, stemPath] of Object.entries(stemMap)) {
      if (!fs.existsSync(stemPath)) continue;

      const metadata = await parseFile(stemPath).catch(() => null);
      const durationSeconds = metadata?.format?.duration || 0;
      const instrument = mapStemToInstrument(stemName);
      const fileName = path.basename(stemPath);

      stems.push({
        id: `${jobId}-${stemName}`,
        stemName,
        instrument,
        displayName: `${stemName.charAt(0).toUpperCase()}${stemName.slice(1)}`,
        fileName,
        url: `${req.baseUrl}/${jobId}/${encodeURIComponent(fileName)}`,
        durationSeconds,
        sizeBytes: fs.statSync(stemPath).size
      });
    }

    if (!stems.length) {
      throw new Error('No stems produced. Please try a different audio file.');
    }

    res.json({ jobId, stems });
  } catch (err) {
    try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
    next(err);
  } finally {
    try { fs.unlinkSync(tempFilePath); } catch {}
  }
});

/**
 * GET /stems/:jobId/:file - serve generated stem files.
 */
router.get('/:jobId/:file', (req, res) => {
  const { jobId, file } = req.params;
  const resolvedDir = path.resolve(STEM_ROOT, jobId);
  const filePath = path.resolve(resolvedDir, file);
  if (!filePath.startsWith(resolvedDir)) {
    return res.status(400).json({ error: 'Invalid file path' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Stem not found' });
  }
  return res.sendFile(filePath);
});

module.exports = router;
