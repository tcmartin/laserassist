const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const { BrowserWindow, app } = require('electron');

// Model directory - use userData for packaged apps
const MODEL_DIR = app.isPackaged 
  ? path.join(app.getPath('userData'), 'models')
  : path.join(__dirname, 'models');

// Available LLM model tiers
const LLM_MODELS = {
  high: {
    tier: 'high',
    name: 'Gemma 3 4B IT Q4_0',
    filename: 'gemma-3-4b-it-Q4_0.gguf',
    url: 'https://huggingface.co/unsloth/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_0.gguf'
  },
  low: {
    tier: 'low',
    name: 'Gemma 3 1B IT Q4_0',
    filename: 'gemma-3-1b-it-Q4_0.gguf',
    url: 'https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_0.gguf'
  }
};

// Heuristic hardware-based tier detection (can be overridden by caller)
function detectHardwareTier() {
  try {
    const totalMemGB = os.totalmem() / (1024 ** 3);
    const cores = os.cpus()?.length || 4;
    const isMacArm = process.platform === 'darwin' && process.arch === 'arm64';

    // Prefer high tier on capable machines
    if (isMacArm && totalMemGB >= 12) return 'high';
    if (totalMemGB >= 16 && cores >= 8) return 'high';

    return 'low';
  } catch (_) {
    return 'low';
  }
}

function getModelInfo(preferredTier) {
  const tier = preferredTier || detectHardwareTier();
  return LLM_MODELS[tier] || LLM_MODELS.low;
}

function modelExists(preferredTier) {
  const info = getModelInfo(preferredTier);
  const modelPath = path.join(MODEL_DIR, info.filename);
  return fs.existsSync(modelPath);
}

// Download model with progress reporting to renderer
function downloadModel(preferredTier) {
  const modelInfo = getModelInfo(preferredTier);
  const MODEL_PATH = path.join(MODEL_DIR, modelInfo.filename);
  return new Promise((resolve, reject) => {
    // Ensure directory exists
    if (!fs.existsSync(MODEL_DIR)) {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
    }

    // Send initial status to all windows
    const sendStatus = (status) => {
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('model-status', status);
      });
    };

    sendStatus({
      state: 'downloading',
      progress: 0,
      message: `Starting model download (${modelInfo.name})...`,
      tier: modelInfo.tier,
      filename: modelInfo.filename
    });

    // Create write stream
    const file = fs.createWriteStream(MODEL_PATH);

    // Function to handle HTTP requests with redirect support
    const makeRequest = (url) => {
      sendStatus({
        state: 'downloading',
        progress: 0,
        message: `Connecting to ${url}...`,
        tier: modelInfo.tier
      });

      // Determine protocol
      const protocol = url.startsWith('https:') ? https : http;

      protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          sendStatus({
            state: 'downloading',
            progress: 0,
            message: `Following redirect to ${redirectUrl}...`,
            tier: modelInfo.tier
          });
          makeRequest(redirectUrl);
          return;
        }

        // Handle errors
        if (response.statusCode !== 200) {
          fs.unlink(MODEL_PATH, () => {});
          sendStatus({
            state: 'error',
            message: `Failed to download: Server returned ${response.statusCode}`
          });
          reject(new Error(`Server returned ${response.statusCode}`));
          return;
        }

        // Get file size for progress calculation
        const totalBytes = parseInt(response.headers['content-length'] || '0');
        let downloadedBytes = 0;
        let lastReportTime = Date.now();

        // Report initial size
        sendStatus({
          state: 'downloading',
          progress: 0,
          totalSize: (totalBytes / 1024 / 1024).toFixed(2),
          message: `Download started, file size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
          tier: modelInfo.tier
        });

        // Handle data chunks and report progress
        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          
          // Report progress every 500ms to avoid UI flooding
          const now = Date.now();
          if (now - lastReportTime > 500) {
            const progress = totalBytes ? (downloadedBytes / totalBytes) : 0;
            sendStatus({
              state: 'downloading',
              progress: progress,
              downloaded: (downloadedBytes / 1024 / 1024).toFixed(2),
              totalSize: (totalBytes / 1024 / 1024).toFixed(2),
              message: `Downloading ${modelInfo.name}: ${Math.round(progress * 100)}%`,
              tier: modelInfo.tier
            });
            lastReportTime = now;
          }
        });

        // Pipe response to file
        response.pipe(file);
        
        // Handle completion
        file.on('finish', () => {
          file.close();
          sendStatus({
            state: 'completed',
            progress: 1,
            message: `Model download complete: ${modelInfo.name}`,
            tier: modelInfo.tier
          });
          resolve();
        });

        // Handle file errors
        file.on('error', (err) => {
          fs.unlink(MODEL_PATH, () => {});
          sendStatus({
            state: 'error',
            message: `File error: ${err.message}`
          });
          reject(err);
        });
      }).on('error', (err) => {
        fs.unlink(MODEL_PATH, () => {});
        sendStatus({
          state: 'error',
          message: `Network error: ${err.message}`
        });
        reject(err);
      });
    };

    // Start the download process
    makeRequest(modelInfo.url);
  });
}

module.exports = {
  modelExists,
  downloadModel,
  getModelInfo,
  detectHardwareTier,
  MODEL_DIR
};
