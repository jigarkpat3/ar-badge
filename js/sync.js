// sync.js: show the camera picture the tracking actually used (the lag fix).
//
// Why the photo trailed the badge: MindAR's camera view (a <video>) always
// shows the NEWEST camera frame, but the photo's position comes from an OLDER
// frame, the one MindAR finished analysing. While the badge moves, that age
// gap (about 0.1 s on Jigar's iPhone) shows up as the photo trailing behind.
//
// The fix (what ARKit apps do too): show the older frame instead, so the
// picture and the photo always come from the same moment.
// MindAR 1.2.5 already copies each frame it analyses into a small canvas
// (controller.inputLoader.context.canvas, see src/image-target/input-loader.js),
// and reports "processDone" once that frame's position is out
// (controller.js, processVideo). At that moment we copy the canvas onto our own
// canvas that sits exactly over the live video. Both happen in the same step,
// so the picture and the photo update together.
//
// Turn it off with ?sync=0 in the address to compare.

function syncCameraView(arSystem) {
  const canvas = document.createElement('canvas');
  canvas.id = 'synced-camera';
  const paint = canvas.getContext('2d');
  const stats = { framesShown: 0, lastAnalyseMs: 0, active: false };
  let wanted = false;   // app.js turns this on while the photo is showing

  const originalResize = arSystem._resize;
  arSystem._resize = function () {
    const result = originalResize.apply(this, arguments);
    const c = this.controller;
    if (c && c.syncHookedFor !== c) { hookController(c, this.video); c.syncHookedFor = c; }
    placeOver(this.video);
    return result;
  };

  // Listen to this controller's "frame loaded" and "frame done" moments.
  function hookController(c, video) {
    const originalLoad = c.inputLoader.loadInput.bind(c.inputLoader);
    let loadedAt = 0;
    c.inputLoader.loadInput = (input) => { loadedAt = performance.now(); return originalLoad(input); };

    const originalOnUpdate = c.onUpdate;
    c.onUpdate = (data) => {
      if (originalOnUpdate) originalOnUpdate(data);
      if (data.type !== 'processDone') return;
      stats.lastAnalyseMs = performance.now() - loadedAt;
      // If tracking failed on this frame, MindAR keeps the photo at its last
      // good position, so keep showing the last good picture too.
      const lostThisFrame = c.trackingStates.some((s) => s.showing && !s.isTracking);
      if (!lostThisFrame) showFrame(c.inputLoader.context.canvas, video);
    };
  }

  function showFrame(frame, video) {
    // Only when the analysed frame is the same shape as the camera view
    // (MindAR rotates it if the phone turned; then we just show the live view).
    const sameShape = frame.width === video.videoWidth && frame.height === video.videoHeight;
    setActive(wanted && sameShape);
    if (!stats.active) return;
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width;
      canvas.height = frame.height;
    }
    paint.drawImage(frame, 0, 0);
    stats.framesShown++;
  }

  // Same position and size as MindAR's video, one layer above it.
  function placeOver(video) {
    if (canvas.parentNode !== video.parentNode) video.parentNode.insertBefore(canvas, video.nextSibling);
    canvas.style.cssText = video.style.cssText;
    canvas.style.zIndex = '-1';
    canvas.style.pointerEvents = 'none';
    canvas.style.visibility = stats.active ? 'visible' : 'hidden';
  }

  function setActive(on) {
    if (on === stats.active) return;
    stats.active = on;
    canvas.style.visibility = on ? 'visible' : 'hidden';
  }

  return {
    stats,
    // Show the synced picture only while the photo is on screen. While searching
    // for the badge the live view is smoother (searching is slower than tracking).
    setWanted(on) { wanted = on; if (!on) setActive(false); },
  };
}
