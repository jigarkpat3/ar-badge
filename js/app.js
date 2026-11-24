// app.js: tuning values, the start button, the framing screen, the hint,
// errors and the debug panel. MindAR does the tracking; camera.js fixes how it
// uses the camera; sync.js keeps the picture in step; components.js makes the
// photo follow the badge smoothly.

// ---------------------------------------------------------------------------
// TUNING: every knob in one place. Change a number, push, reload the phone.
// ---------------------------------------------------------------------------
const TUNING = {
  // MindAR's own smoothing (a "One Euro" filter on the raw pose).
  //   filterMinCF: smoothing when still. Lower = steadier but laggier. 0.001 = 1 Hz.
  //   filterBeta:  how fast smoothing switches off when moving. Higher = less lag.
  //   Round 4: beta 30 (was 10): smoothing switches off sooner when moving.
  mindar: {
    filterMinCF: 0.001,
    filterBeta: 30,
    warmupTolerance: 5,  // frames the badge must be seen before "found" (MindAR default 5)
    missTolerance: 5,    // frames the badge can be missed before "lost" (MindAR default 5)
  },

  // Our extra smoothing on top (components.js, follow-badge).
  follow: {
    // Round 4 (simulation with MindAR's real filter): vs round 3 about 35% less
    // shake when still and about half the trail on fast moves.
    restSmoothTime: 0.22,  // seconds; used when the badge is still (hides jitter)
    fastSmoothTime: 0,     // seconds; used when it moves (0 = no delay at all)
    restMotion: 0.008,     // below this much difference we count as "still"
    fastMotion: 0.025,     // above this we count as "moving fast"
                           // (both in badge widths for position, radians for angle)
    depthWeight: 0.3,      // count distance changes less (they're the noisiest)
    holdMs: 500,           // keep showing the photo this long after the badge is lost
    fadeInMs: 200,
    fadeOutMs: 250,
  },

  // The camera (camera.js).
  camera: {
    longSide: 1280,  // the feed size we ask for (the phone gives the closest it has)
    shortSide: 720,
    fps: 60,         // frames per second we ask for (fresher frames = less lag); 0 = don't ask
    fovDeg: 70,    // how wide the camera sees along its long side, in degrees.
                   // Measured about 71 from Jigar's iPhone recording. Try others
                   // without editing code: add ?fov=65 to the address.
  },

  // Show the camera frame the tracking used, so photo and picture move together
  // (sync.js). Compare with the old behaviour by adding ?sync=0 to the address.
  sync: true,

  // Framing screen (before the experience starts).
  framing: {
    steadyMs: 1500,  // the badge must be tracked this long without a break before
                     // "Start the experience" unlocks. This also gives both
                     // smoothing filters time to settle, so the first photo frame
                     // sits right on the badge instead of swinging in skewed.
  },

  cornerRadius: 0.032,     // badge corner radius as a fraction of its width (24px of 750px)
};

// Optional override from the address, e.g. ...?debug&fov=65
const urlParams = new URLSearchParams(location.search);
if (Number(urlParams.get('fov')) > 0) TUNING.camera.fovDeg = Number(urlParams.get('fov'));
if (urlParams.get('sync') === '0') TUNING.sync = false;

// ---------------------------------------------------------------------------
const sceneEl       = document.querySelector('a-scene');
const holderEl      = document.querySelector('#overlay-holder');
const startScreen   = document.querySelector('#start-screen');
const startButton   = document.querySelector('#start-button');
const loadingScreen = document.querySelector('#loading-screen');
const hint          = document.querySelector('#hint');
const errorScreen   = document.querySelector('#error-screen');
const errorText     = document.querySelector('#error-text');
const framing       = document.querySelector('#framing');
const framingStatus = document.querySelector('#framing-status');
const experienceButton = document.querySelector('#experience-button');
const badgeEl       = document.querySelector('#badge-target');
const follow        = () => holderEl.components['follow-badge'];

// Hand MindAR its settings (this runs before A-Frame builds the scene).
// autoStart:false = we start it from the tap. ui...:no = we use our own screens.
sceneEl.setAttribute('mindar-image', Object.assign({
  imageTargetSrc: './assets/targets.mind',
  autoStart: false, uiLoading: 'no', uiScanning: 'no', uiError: 'no',
}, TUNING.mindar));

// Small helpers to show/hide things using the "hidden" CSS class.
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

function showError(message) {
  [startScreen, loadingScreen, hint, framing].forEach(hide);
  errorText.textContent = message;
  show(errorScreen);
}

// 1. Enable the button once A-Frame has built the scene.
let arSystem, cameraSync = null;
function onSceneLoaded() {
  arSystem = sceneEl.systems['mindar-image-system'];
  useRealCameraFov(arSystem);   // camera.js: fixes the skew on tilted badges
  if (TUNING.sync) cameraSync = syncCameraView(arSystem);   // sync.js: fixes the lag
  startButton.disabled = false;
  startButton.textContent = 'Tap to start';
}
if (sceneEl.hasLoaded) onSceneLoaded();
else sceneEl.addEventListener('loaded', onSceneLoaded);

// 2. First tap: start the camera. iPhone Safari only allows the camera from a
//    real tap. (The video with sound starts on the SECOND tap, see step 4.)
startButton.addEventListener('click', () => {
  if (!window.isSecureContext) {   // camera needs https:// (or localhost)
    showError('This page needs to be opened with https:// for the camera to work.');
    return;
  }
  hide(startScreen);
  show(loadingScreen);   // dark cover until the camera view is sized (see arReady)
  startAR();
});

function startAR() {
  arSystem.start();   // asks for the camera, then starts tracking
  // If the camera changes its frame size later, re-check (see below).
  arSystem.video.addEventListener('resize', onCameraResize);
}

// MindAR reads the camera size once. If the camera later sends a different
// size, its tracking math no longer fits, so restart it (at most twice).
let arIsReady = false;
let restarts = 0;
function onCameraResize() {
  if (!arIsReady) return;   // arReady checks it anyway
  if (cameraSizeChanged(arSystem)) restartAR();
  else refitCameraView();
}
function restartAR() {
  if (restarts >= 2) return;
  restarts++;
  console.warn('Camera size changed, restarting AR');
  arIsReady = false;
  show(loadingScreen);
  lockFraming();
  updateHint();
  arSystem.stop();
  // Tell the badge entity it's lost, so no old position lingers (MindAR's own method).
  badgeEl.components['mindar-image-target'].updateWorldMatrix(null);
  startAR();
}

// A "resize" event makes MindAR re-fit its camera view and A-Frame its canvas.
function refitCameraView() {
  window.dispatchEvent(new Event('resize'));
}

// 3. MindAR events.
sceneEl.addEventListener('arReady', () => {
  if (cameraSizeChanged(arSystem) && restarts < 2) { restartAR(); return; }
  arIsReady = true;
  refitCameraView();
  // Wait two frames so the re-fit is on screen, then lift the cover.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    hide(loadingScreen);
    if (!experienceStarted) show(framing);   // step 3: line the badge up
    updateHint();
  }));
});

sceneEl.addEventListener('arError', () => {
  showError('We couldn\'t turn on your camera. Allow camera access for this site ' +
            '(in Safari: tap the "aA" button in the address bar, then Website Settings > Camera > Allow), ' +
            'then tap Try again.');
});

// 3. Framing screen. The outline turns green when MindAR finds the badge.
//    After TUNING.framing.steadyMs of tracking without a break, the button
//    unlocks. If the badge is lost first (or while waiting to be tapped), it
//    locks again and the wait starts over.
let experienceStarted = false;
let steadyTimer = null;
let foundAt = 0;   // when the current unbroken stretch of tracking began (for ?debug)

badgeEl.addEventListener('targetFound', () => {
  if (experienceStarted) return;
  framing.classList.add('found');
  framingStatus.textContent = 'Badge found, hold steady…';
  foundAt = performance.now();
  clearTimeout(steadyTimer);
  steadyTimer = setTimeout(() => {
    experienceButton.disabled = false;
    framingStatus.textContent = 'Ready!';
  }, TUNING.framing.steadyMs);
});
badgeEl.addEventListener('targetLost', () => { if (!experienceStarted) lockFraming(); });

function lockFraming() {
  clearTimeout(steadyTimer);
  foundAt = 0;
  framing.classList.remove('found');
  framingStatus.textContent = 'Looking for your badge…';
  experienceButton.disabled = true;
}

// 4. Second tap: start the experience. The photo has been following the
//    badge invisibly all along, so it fades in already in the right place.
//    Keep this handler synchronous: iPhone Safari only lets a video play WITH
//    SOUND if play() is called directly inside a tap.
experienceButton.addEventListener('click', () => {
  // Phase 2 (video) goes HERE, first thing, before anything async, e.g.
  //   const video = document.querySelector('#overlay-video');
  //   video.play();
  experienceStarted = true;
  clearTimeout(steadyTimer);
  hide(framing);
  follow().revealed = true;   // follow-badge fades the photo in
  updateSync();
  updateHint();
});

// 5. During the experience. If the badge is lost, the photo holds, fades and the
//    hint shows (all as before); we wait for the badge, no going back to framing.
// The hint follows the photo, not MindAR's raw found/lost events: it shows
// only once the photo has fully faded out, and hides as soon as it comes back.
function updateHint() {
  if (arIsReady && experienceStarted && follow().state === 'hidden') show(hint);
  else hide(hint);
}
holderEl.addEventListener('overlaystate', updateHint);

// The synced camera picture (sync.js) is used only while the photo is on
// screen. While framing there's no photo to line up, so the live view (newest
// frame, smoothest) is better there.
function updateSync() {
  if (cameraSync) cameraSync.setWanted(experienceStarted && follow().state !== 'hidden');
}
holderEl.addEventListener('overlaystate', updateSync);

// If the target file fails to load, MindAR doesn't fire arError, so catch it here.
window.addEventListener('unhandledrejection', (event) => {
  if (arIsReady) return;
  console.error('AR failed to start:', event.reason);
  showError('Something went wrong loading the AR experience. Check your connection and tap Try again.');
});

// 4. Debug panel: open the page with ?debug at the end of the address.
if (urlParams.has('debug')) {
  const panel = document.querySelector('#debug');
  const text = document.querySelector('#debug-text');
  show(panel);

  // Count frames and tracking updates; report the last second, 4 times a second.
  const frameTimes = [], trackTimes = [];
  const lastSecond = (list) => { const now = performance.now(); while (list.length && list[0] < now - 1000) list.shift(); return list.length; };
  const countFrame = () => { frameTimes.push(performance.now()); requestAnimationFrame(countFrame); };
  requestAnimationFrame(countFrame);
  badgeEl.addEventListener('targetUpdate', () => trackTimes.push(performance.now()));

  document.querySelector('#debug-seethrough').addEventListener('click', () => {
    follow().seeThrough = !follow().seeThrough;   // half-transparent photo, to check the fit
  });

  setInterval(() => {
    const v = arSystem && arSystem.video, c = arSystem && arSystem.controller;
    text.textContent = [
      `fps ${lastSecond(frameTimes)}  tracking ${lastSecond(trackTimes)}/s`,
      `state ${follow().state}  restarts ${restarts}`,
      experienceStarted ? 'phase experience'
        : `phase framing  steady ${foundAt ? Math.round(performance.now() - foundAt) : 0}/${TUNING.framing.steadyMs} ms`,
      `camera ${v ? v.videoWidth + 'x' + v.videoHeight : '-'} @${cameraReport.fps}fps  tries ${cameraReport.tries.join('>') || '-'}`,
      `input ${c ? c.inputWidth + 'x' + c.inputHeight : '-'}  fov ${TUNING.camera.fovDeg}`,
      cameraSync ? `sync ${cameraSync.stats.active ? 'on' : 'standby'}  analyse ${Math.round(cameraSync.stats.lastAnalyseMs)} ms` : 'sync off (?sync=0)',
      `screen ${innerWidth}x${innerHeight}  page ${document.body.clientWidth}x${document.body.clientHeight}`,
    ].join('\n');
  }, 250);
}
