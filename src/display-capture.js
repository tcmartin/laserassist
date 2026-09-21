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
    if (!isTrusted()) { callback({}); return; }
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: { width: 0, height: 0 },
      });
      if (!isTrusted() || !sources.length) { callback({}); return; }
      callback({ video: sources[0], audio: 'loopback' });
    } catch (_) { callback({}); }
  });
}

module.exports = { installDisplayCapture };
