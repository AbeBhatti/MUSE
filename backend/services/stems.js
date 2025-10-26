// backend/services/stems.js
const path = require('path');
const { spawn } = require('child_process');

/**
 * Runs the Demucs-based song splitter Python script and returns a map of stem
 * names to file paths.
 * @param {string} inputPath - absolute path to the uploaded audio file
 * @param {string} outputDir - absolute directory where stems should be written
 * @returns {Promise<Record<string, string>>}
 */
function separateStems(inputPath, outputDir) {
  const scriptPath = path.join(__dirname, '..', '..', 'audio-midi', 'songSplitter.py');
  const pythonCmd = process.env.PYTHON_CMD || 'python3';
  const args = [scriptPath, inputPath, outputDir];

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(pythonCmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      reject(err);
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || stdout || 'Stem separation failed'));
      }
      try {
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const parsed = JSON.parse(lastLine);
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Unable to parse stem output: ${err.message}`));
      }
    });
  });
}

module.exports = { separateStems };
