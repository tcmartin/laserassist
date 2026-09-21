const { pathToFileURL } = require('url');

function installDisplayCapture({ session, desktopCapturer, getBarWindow, indexPath }) {
  const trustedUrl = pathToFileURL(indexPath).href;
  session.setDisplayMediaRequestHandler(async (request, callback) => {
    const win = getBarWindow();
    const isTrusted = () => win && !win.isDestroyed()
      && getBarWindow() === win
      && request.frame === win.webContents.mainFrame
      && request.frame?.url === trustedUrl
      && request.userGesture && request.audioRequested;
    if (!isTrusted()) { callback(null); return; }
    let sources;
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: { width: 0, height: 0 },
      });
    } catch (_) { callback(null); return; }
    if (!isTrusted() || !sources.length) { callback(null); return; }
    // Electron consumes this callback even when delivery throws. Never retry it.
    callback({ video: sources[0], audio: 'loopback' });
  });
}

module.exports = { installDisplayCapture };
