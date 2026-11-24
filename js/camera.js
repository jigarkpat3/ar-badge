// camera.js: three fixes to how MindAR 1.2.5 uses the camera.
// (Checked against mind-ar 1.2.5's source: src/image-target/aframe.js and controller.js.)

// 1. A sharper camera feed.
//    MindAR asks for the camera with only { facingMode: 'environment' }, so the
//    iPhone hands back a small 480x640 feed. We add the size we'd like. "ideal"
//    means "this if you can, otherwise the closest you have", so it never fails.
//    Before handing the camera to MindAR we also wait until its frame size has
//    settled, because MindAR reads the size only once.
(function askForSharperCamera() {
  const media = navigator.mediaDevices;
  if (!media || !media.getUserMedia) return;   // no camera API (e.g. not https)
  const originalGetUserMedia = media.getUserMedia.bind(media);

  media.getUserMedia = async (constraints) => {
    if (constraints && typeof constraints.video === 'object') {
      constraints = Object.assign({}, constraints, {
        video: Object.assign({}, constraints.video, {
          width:  { ideal: TUNING.camera.width },
          height: { ideal: TUNING.camera.height },
        }),
      });
    }
    const stream = await originalGetUserMedia(constraints);
    await waitForSteadySize(stream);
    return stream;
  };
})();

// Play the stream in a hidden <video> until 3 frames in a row report the same size.
async function waitForSteadySize(stream) {
  const probe = document.createElement('video');
  probe.muted = true;
  probe.playsInline = true;
  probe.srcObject = stream;
  await probe.play().catch(() => {});
  let lastSize = '', sameCount = 0;
  for (let i = 0; i < 60 && sameCount < 3; i++) {
    await new Promise(requestAnimationFrame);
    const size = probe.videoWidth + 'x' + probe.videoHeight;
    sameCount = (probe.videoWidth && size === lastSize) ? sameCount + 1 : 0;
    lastSize = size;
  }
  probe.srcObject = null;   // the stream itself keeps running for MindAR
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
