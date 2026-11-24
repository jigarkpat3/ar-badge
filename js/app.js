// app.js: tuning values, the start button, the hint, errors and the debug panel.
// MindAR does the tracking; components.js makes the photo follow it smoothly.

// ---------------------------------------------------------------------------
// TUNING: every knob in one place. Change a number, push, reload the phone.
// ---------------------------------------------------------------------------
const TUNING = {
  // MindAR's own smoothing (a "One Euro" filter on the raw pose).
  //   filterMinCF: smoothing when still. Lower = steadier but laggier. 0.001 = 1 Hz.
  //   filterBeta:  how fast smoothing switches off when moving. Higher = less lag.
  mindar: {
    filterMinCF: 0.001,
    filterBeta: 10,
    warmupTolerance: 5,  // frames the badge must be seen before "found" (MindAR default 5)
    missTolerance: 5,    // frames the badge can be missed before "lost" (MindAR default 5)
  },

  // Our extra smoothing on top (components.js, follow-badge).
  follow: {
    restSmoothTime: 0.12,  // seconds; used when the badge is still (hides jitter)
    fastSmoothTime: 0.01,  // seconds; used when it moves (keeps up, little lag)
    restMotion: 0.006,     // below this much difference we count as "still"
    fastMotion: 0.025,     // above this we count as "moving fast"
                           // (both in badge widths for position, radians for angle)
    depthWeight: 0.3,      // count distance changes less (they're the noisiest)
    holdMs: 500,           // keep showing the photo this long after the badge is lost
    fadeInMs: 200,
    fadeOutMs: 250,
  },

  cornerRadius: 0.032,     // badge corner radius as a fraction of its width (24px of 750px)
};

// ---------------------------------------------------------------------------
const sceneEl       = document.querySelector('a-scene');
const targetEl      = document.querySelector('#badge-target');
const startScreen   = document.querySelector('#start-screen');
const startButton   = document.querySelector('#start-button');
const loadingScreen = document.querySelector('#loading-screen');
const hint          = document.querySelector('#hint');
const errorScreen   = document.querySelector('#error-screen');
const errorText     = document.querySelector('#error-text');

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
  [startScreen, loadingScreen, hint].forEach(hide);
  errorText.textContent = message;
  show(errorScreen);
}

// 1. Enable the button once A-Frame has built the scene.
function onSceneLoaded() {
  startButton.disabled = false;
  startButton.textContent = 'Tap to start';
}
if (sceneEl.hasLoaded) onSceneLoaded();
else sceneEl.addEventListener('loaded', onSceneLoaded);

// 2. The tap. iPhone Safari only allows the camera and, later, video WITH
//    SOUND to start from a real tap, so keep this handler synchronous.
startButton.addEventListener('click', () => {
  if (!window.isSecureContext) {   // camera needs https:// (or localhost)
    showError('This page needs to be opened with https:// for the camera to work.');
    return;
  }
  hide(startScreen);
  show(loadingScreen);   // dark cover until the camera view is sized (see arReady)

  // Phase 2 (video): unlock the video here, in the same tap, e.g.
  //   const video = document.querySelector('#overlay-video');
  //   video.play().then(() => video.pause());

  const arSystem = sceneEl.systems['mindar-image-system'];
  arSystem.start();   // asks for the camera, then starts tracking

  // MindAR sizes its camera <video> only once. If the phone changes the
  // camera's frame size later, ask everything to re-fit the screen.
  arSystem.video.addEventListener('resize', refitCameraView);
});

// A "resize" event makes MindAR re-fit its camera view and A-Frame its canvas.
function refitCameraView() {
  window.dispatchEvent(new Event('resize'));
}

// 3. MindAR events.
let arIsReady = false;
sceneEl.addEventListener('arReady', () => {
  arIsReady = true;
  refitCameraView();
  // Wait two frames so the re-fit is on screen, then lift the cover.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    hide(loadingScreen);
    if (!targetEl.object3D.visible) show(hint);
  }));
});

sceneEl.addEventListener('arError', () => {
  showError('We couldn\'t turn on your camera. Allow camera access for this site ' +
            '(in Safari: tap the "aA" button in the address bar, then Website Settings > Camera > Allow), ' +
            'then tap Try again.');
});

targetEl.addEventListener('targetFound', () => hide(hint));
targetEl.addEventListener('targetLost',  () => show(hint));

// If the target file fails to load, MindAR doesn't fire arError, so catch it here.
window.addEventListener('unhandledrejection', (event) => {
  if (arIsReady) return;
  console.error('AR failed to start:', event.reason);
  showError('Something went wrong loading the AR experience. Check your connection and tap Try again.');
});

// 4. Debug panel: open the page with ?debug at the end of the address.
if (new URLSearchParams(location.search).has('debug')) {
  const panel = document.querySelector('#debug');
  const text = document.querySelector('#debug-text');
  const follow = () => document.querySelector('#overlay-holder').components['follow-badge'];
  show(panel);

  let frames = 0, trackUpdates = 0;
  const countFrame = () => { frames++; requestAnimationFrame(countFrame); };
  requestAnimationFrame(countFrame);
  targetEl.addEventListener('targetUpdate', () => trackUpdates++);  // one per tracked camera frame

  document.querySelector('#debug-seethrough').addEventListener('click', () => {
    follow().seeThrough = !follow().seeThrough;   // half-transparent photo, to check the fit
  });

  setInterval(() => {
    const ar = sceneEl.systems['mindar-image-system'];
    const v = ar.video, c = ar.controller;
    text.textContent = [
      `fps ${frames}  tracking ${trackUpdates}/s`,
      `state ${follow().state}`,
      `camera ${v ? v.videoWidth + 'x' + v.videoHeight : '-'}  input ${c ? c.inputWidth + 'x' + c.inputHeight : '-'}`,
      `screen ${innerWidth}x${innerHeight}  page ${document.body.clientWidth}x${document.body.clientHeight}`,
    ].join('\n');
    frames = 0; trackUpdates = 0;
  }, 1000);
}
