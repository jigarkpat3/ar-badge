// camera.js: three fixes to how MindAR 1.2.5 uses the camera.
// (Checked against mind-ar 1.2.5's source: src/image-target/aframe.js and controller.js.)

// 1. A sharper (and faster) camera feed.
//    MindAR asks for the camera with only { facingMode: 'environment' }, so the
//    iPhone hands back a small 480x640 feed. We add the size we'd like, as
//    "ideal" (= closest you have, never fails).
//    Round 4 finding: on Jigar's iPhone, asking 1280x720 while holding the phone
//    upright still gave 480x640. That's what the browser's "closest match" rule
//    gives when it compares our numbers to the camera's sizes turned upright
//    (480x640 is "closer" to 1280x720 than 720x1280 is). Different iOS versions
//    compare differently, so we no longer guess: we ask for the size the way the
//    screen is held, check what came back, and if it's still small we ask once
//    more with the numbers swapped. Whatever is best wins; nothing can get worse.
//    Then we ask for 60 frames a second (fresher frames = less lag), and keep
//    it only if the size didn't drop.
//    Before handing the camera to MindAR we wait until the frame size has
//    settled, because MindAR reads the size only once.
const cameraReport = { tries: [], fps: '-' };   // shown in the ?debug panel

(function askForSharperCamera() {
  const media = navigator.mediaDevices;
  if (!media || !media.getUserMedia) return;   // no camera API (e.g. not https)
  const originalGetUserMedia = media.getUserMedia.bind(media);

  media.getUserMedia = async (constraints) => {
    if (!constraints || typeof constraints.video !== 'object') return originalGetUserMedia(constraints);
    const C = TUNING.camera;
    const upright = innerHeight > innerWidth;
    // Size as the screen is held (upright: narrow and tall).
    const held    = upright ? { width: { ideal: C.shortSide }, height: { ideal: C.longSide } }
                            : { width: { ideal: C.longSide }, height: { ideal: C.shortSide } };
    const swapped = { width: held.height, height: held.width };
    let best = Object.assign({}, constraints.video, held);

    const stream = await originalGetUserMedia(Object.assign({}, constraints, { video: best }));
    const track = stream.getVideoTracks()[0];
    const probe = startProbe(stream);
    let size = await steadySize(probe);
    cameraReport.tries.push(sizeText(size));

    // Still small? Ask again with the numbers the other way round.
    if (longSide(size) < 0.9 * C.longSide && track && track.applyConstraints) {
      const attempt = Object.assign({}, constraints.video, swapped);
      const result = await tryConstraints(track, probe, attempt, best, size, cameraReport);
      if (result.kept) { best = attempt; size = result.size; }
    }
    // More frames per second, if it doesn't cost us size.
    if (C.fps && track && track.applyConstraints) {
      const attempt = Object.assign({}, best, { frameRate: { ideal: C.fps } });
      await tryConstraints(track, probe, attempt, best, size, cameraReport);
    }
    if (track && track.getSettings) cameraReport.fps = Math.round(track.getSettings().frameRate || 0) || '-';
    probe.srcObject = null;   // the stream itself keeps running for MindAR
    return stream;
  };
})();

const longSide = (size) => Math.max(size.w, size.h);
const sizeText = (size) => size.w + 'x' + size.h;

// Apply new camera settings; keep them only if the frame didn't get smaller.
async function tryConstraints(track, probe, attempt, previous, sizeBefore, report) {
  try {
    await track.applyConstraints(attempt);
  } catch (e) {
    report.tries.push('refused');
    return { kept: false, size: sizeBefore };
  }
  const size = await steadySize(probe);
  report.tries.push(sizeText(size));
  if (longSide(size) >= longSide(sizeBefore)) return { kept: true, size };
  await track.applyConstraints(previous).catch(() => {});   // undo
  return { kept: false, size: await steadySize(probe) };
}

// A hidden, muted <video> that plays the stream so we can read its frame size.
function startProbe(stream) {
  const probe = document.createElement('video');
  probe.muted = true;
  probe.playsInline = true;
  probe.srcObject = stream;
  probe.play().catch(() => {});
  return probe;
}

// Wait (up to ~1 s) until 3 frames in a row report the same size.
async function steadySize(probe) {
  let lastSize = '', sameCount = 0;
  for (let i = 0; i < 60 && sameCount < 3; i++) {
    await new Promise(requestAnimationFrame);
    const size = probe.videoWidth + 'x' + probe.videoHeight;
    sameCount = (probe.videoWidth && size === lastSize) ? sameCount + 1 : 0;
    lastSize = size;
  }
  return { w: probe.videoWidth, h: probe.videoHeight };
}

// 2. The real camera field of view (the cause of the "skewed" photo).
//    MindAR assumes every camera sees 45 degrees along the frame's height
//    (controller.js: fovy = 45). Phone cameras see much wider (about 70 degrees
//    along the long side), so on a tilted badge MindAR's 3D guess has the wrong
//    perspective and the photo looks skewed. Right after MindAR creates its
//    controller, and before it loads the badge target, its _resize() runs; we
//    swap in the real camera numbers there.
function useRealCameraFov(arSystem) {
  const originalResize = arSystem._resize;
  arSystem._resize = function () {
    const c = this.controller;
    if (c && c.fovFixedFor !== c) {
      const w = c.inputWidth, h = c.inputHeight;
      const longSide = Math.max(w, h);
      const fov = TUNING.camera.fovDeg * Math.PI / 180;   // along the long side
      const f = (longSide / 2) / Math.tan(fov / 2);       // focal length in pixels
      // Same layout MindAR builds in controller.js, just with the real focal length.
      c.projectionTransform = [[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]];
      c.projectionMatrix = c._glProjectionMatrix({
        projectionTransform: c.projectionTransform, width: w, height: h, near: 10, far: 100000,
      });
      c.fovFixedFor = c;
    }
    return originalResize.apply(this, arguments);
  };
}

// 3. Does the camera still send the frame size MindAR started with?
//    If not, its tracking math is off and it needs a restart (see app.js).
function cameraSizeChanged(arSystem) {
  const v = arSystem.video, c = arSystem.controller;
  return !!(v && c && v.videoWidth && (v.videoWidth !== c.inputWidth || v.videoHeight !== c.inputHeight));
}
