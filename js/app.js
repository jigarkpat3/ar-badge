// app.js: tuning values, the start button, the framing screen, the hint,
// errors and the debug panel. MindAR does the tracking; camera.js fixes how it
// uses the camera; sync.js keeps the picture in step; video.js plays the video;
// components.js makes the overlay ("photo" below = the video) follow the badge.

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
    // Video round 2: calmer when still (about half the shake of round 4 in the
    // simulation) with the same trail when moving. Small slow drifts can now
    // sit about 1% off before it catches up; the overscan below hides that.
    restSmoothTime: 0.4,   // seconds; used when the badge is still (hides jitter)
    fastSmoothTime: 0,     // seconds; used when it moves (0 = no delay at all)
    restMotion: 0.012,     // below this much difference we count as "still"
    fastMotion: 0.025,     // above this we count as "moving fast"
                           // (both in badge widths for position, radians for angle)
    depthWeight: 0.3,      // count distance changes less (they're the noisiest)
    holdMs: 500,           // keep showing the photo this long after the badge is lost
    fadeInMs: 200,
    fadeOutMs: 250,
  },

  // Live tips (coach.js). Each problem has an "on" and a lower "off" value so
  // the tip doesn't flicker on and off at the edge.
  coach: {
    moveOn: 1.0, moveOff: 0.5,         // "Hold steady": badge speed (widths or radians per second)
    slowRateOn: 12, slowRateOff: 20,   //   ...or (last) MindAR updating fewer times a second than this
    farOn: 0.30, farOff: 0.36,         // "Move closer": badge width as a share of the screen width
    closeOn: 0.95, closeOff: 0.88,     // "Move back a little"
    angleOn: 55, angleOff: 45,         // "Face the badge more directly": degrees from straight on
    glareLevel: 250,                   // a pixel is "blown out" at this brightness (0-255, all colors)
    glareOn: 0.03, glareOff: 0.015,    // "Tilt to avoid glare": biggest blown-out patch, share of the badge
    darkOn: 0.16, darkOff: 0.22,       // "Find better light": average picture brightness (0-1)
    notFoundMs: 4000,                  // framing: after this long without the badge, rotate these tips
    searchTips: ['Hold the badge flat', 'Fill the outline', 'Find good light'],
    searchTipMs: 3000,
    showAfterMs: 500,                  // a tip must be wanted this long before it shows (framing)
    showAfterMsExperience: 1000,       //   ...and during the experience (fewer interruptions)
    lostTipAfterMs: 400,               // "Point your camera at the badge": after the photo has fully faded
    minShowMs: 1500,                   // a shown tip stays at least this long
    clearAfterMs: 600,                 // a tip goes away once it's no longer wanted for this long
  },

  // Soft shadow under the overlay (components.js, soft-shadow). ?shadow=0 turns it off.
  shadow: {
    enabled: true,
    opacity: 0.35,       // darkness right under the badge
    blur: 0.05,          // how soft, in badge widths
    offsetDown: 0.02,    // shifted down a little (heavier toward the bottom edge), badge widths
    depth: 0.01,         // how far behind the overlay, badge widths (avoids flicker)
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
    minTrackRate: 25,  // MindAR updates per second needed before unlocking
    maxSpeed: 0.6,     // and the badge must be this calm (badge widths or radians per second)
    steadyMs: 1500,  // the badge must be tracked this long without a break before
                     // "Start the experience" unlocks. This also gives both
                     // smoothing filters time to settle, so the first photo frame
                     // sits right on the badge instead of swinging in skewed.
  },

  // The video on the badge (video.js).
  video: {
    restartAfterMs: 5000,  // if the badge was gone (photo fully faded) longer than
                           // this, the video starts over when it's found again;
                           // shorter breaks just resume where it paused
  },

  cornerRadius: 0.032,     // badge corner radius as a fraction of its width (24px of 750px)

  // The overlay's size and edge (components.js, rounded-corners).
  overlay: {
    overscan: 1.04,        // overlay is 4% bigger than the badge (2% each side), so the
                           // real badge edge never peeks out from under it
    edgeSoftness: 0.004,   // soft edge, as a fraction of the width (~3 screen px)
    alphaMapWidth: 1024,   // detail of the edge shape picture (pixels)
  },
};

// Optional override from the address, e.g. ...?debug&fov=65
const urlParams = new URLSearchParams(location.search);
if (Number(urlParams.get('fov')) > 0) TUNING.camera.fovDeg = Number(urlParams.get('fov'));
if (urlParams.get('sync') === '0') TUNING.sync = false;
if (urlParams.get('shadow') === '0') TUNING.shadow.enabled = false;

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
  overlayMedia.ready.then(() => {   // media.js: the live video or photo is chosen
    startButton.disabled = false;
    startButton.textContent = 'Tap to start';
  });
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
  overlayVideo.preload();   // video.js: start downloading the video during framing
  if (urlParams.has('debug')) runLog.start();   // runlog.js: first-20-seconds log, only with ?debug
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
  runLog.note('restart (camera size changed)');
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
    coach.refresh();
  }));
});

sceneEl.addEventListener('arError', () => {
  showError('We couldn\'t turn on your camera. Allow camera access for this site ' +
            '(in Safari: tap the "aA" button in the address bar, then Website Settings > Camera > Allow), ' +
            'then tap Try again.');
});

// 3. Framing screen. The outline turns green when MindAR finds the badge.
//    The button unlocks after TUNING.framing.steadyMs of tracking that is
//    unbroken AND healthy: MindAR updating at least minTrackRate times a
//    second and the badge not moving fast. If tracking is slow (e.g. the phone
//    is still warming up on the first run) the wait simply takes longer, so the
//    experience never starts while the tracking is still wobbly.
//    Losing the badge locks it again and the wait starts over.
let experienceStarted = false;
let healthySince = 0;   // start of the current healthy stretch (0 = not healthy)
let foundAt = 0;        // when the current unbroken stretch of tracking began

badgeEl.addEventListener('targetFound', () => {
  if (experienceStarted) return;
  framing.classList.add('found');
  foundAt = performance.now();
  coach.setFramingStatus('Badge found, hold steady…');
});
badgeEl.addEventListener('targetLost', () => { if (!experienceStarted) lockFraming(); });

function lockFraming() {
  healthySince = 0;
  foundAt = 0;
  framing.classList.remove('found');
  coach.setFramingStatus('Looking for your badge…');
  experienceButton.disabled = true;
}

setInterval(function checkReady() {
  if (experienceStarted || !foundAt) return;
  const F = TUNING.framing, m = coach.metrics, now = performance.now();
  const healthy = now - foundAt > 1000 ? (m.rate >= F.minTrackRate && m.speed < F.maxSpeed)
                                       : m.speed < F.maxSpeed;   // rate needs 1 s to count
  if (!healthy) {
    healthySince = 0;
    if (!experienceButton.disabled) { experienceButton.disabled = true; coach.setFramingStatus('Badge found, hold steady…'); }
    return;
  }
  if (!healthySince) healthySince = now;
  if (experienceButton.disabled && now - healthySince >= F.steadyMs) {
    experienceButton.disabled = false;
    coach.setFramingStatus('Ready!');
    runLog.note('unlocked');
  }
}, 100);

// 4. Second tap: start the experience. The photo has been following the
//    badge invisibly all along, so it fades in already in the right place.
//    Keep this handler synchronous: iPhone Safari only lets a video play WITH
//    SOUND if play() is called directly inside a tap.
experienceButton.addEventListener('click', () => {
  overlayVideo.startWithSound();   // video.js: video.muted = false; video.play(). Keep it first.
  experienceStarted = true;
  hide(framing);
  follow().revealed = true;   // follow-badge fades the photo in
  updateSync();
  coach.refresh();
  runLog.note('experience');
});

// 5. During the experience. If the badge is lost, the photo holds and fades,
//    then coach.js shows "Point your camera at the badge" (or a better tip);
//    we wait for the badge, no going back to framing.

// Pause the video when the photo has fully faded out, resume when it's back.
holderEl.addEventListener('overlaystate', () => overlayVideo.onOverlayState(follow().state));

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

  // "Log": the first-20-seconds log of this run and the previous one (runlog.js).
  const logBox = document.querySelector('#debug-log');
  document.querySelector('#debug-logbutton').addEventListener('click', () => {
    logBox.textContent = runLog.text();
    logBox.classList.toggle('hidden');
  });

  document.querySelector('#debug-seethrough').addEventListener('click', () => {
    follow().seeThrough = !follow().seeThrough;   // half-transparent photo, to check the fit
  });

  setInterval(() => {
    const v = arSystem && arSystem.video, c = arSystem && arSystem.controller;
    text.textContent = [
      `fps ${lastSecond(frameTimes)}  tracking ${lastSecond(trackTimes)}/s`,
      `state ${follow().state}  restarts ${restarts}`,
      experienceStarted ? 'phase experience'
        : `phase framing  found ${foundAt ? Math.round(performance.now() - foundAt) : 0} ms  healthy ${healthySince ? Math.round(performance.now() - healthySince) : 0}/${TUNING.framing.steadyMs} ms`,
      overlayVideo.debugText(),
      `tip "${coach.tip() || '-'}"`,
      (({ rate, speed, size, angle, light, glare, cutOff }) =>
        `rate ${rate} speed ${speed.toFixed(2)} size ${size.toFixed(2)}${cutOff ? ' CUT' : ''} angle ${angle.toFixed(0)} light ${light.toFixed(2)} glare ${(100 * glare).toFixed(0)}%`)(coach.metrics),
      `camera ${v ? v.videoWidth + 'x' + v.videoHeight : '-'} @${cameraReport.fps}fps  tries ${cameraReport.tries.join('>') || '-'}`,
      `input ${c ? c.inputWidth + 'x' + c.inputHeight : '-'}  fov ${TUNING.camera.fovDeg}`,
      cameraSync ? `sync ${cameraSync.stats.active ? 'on' : 'standby'}  analyse ${Math.round(cameraSync.stats.lastAnalyseMs)} ms` : 'sync off (?sync=0)',
      `screen ${innerWidth}x${innerHeight}  page ${document.body.clientWidth}x${document.body.clientHeight}`,
    ].join('\n');
  }, 250);
}
