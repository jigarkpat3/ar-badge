// app.js: the start button, the "point at the badge" hint, and error messages.
// MindAR itself does the tracking; this file only reacts to what it reports.

const sceneEl      = document.querySelector('a-scene');
const targetEl     = document.querySelector('#badge-target');
const startScreen  = document.querySelector('#start-screen');
const startButton  = document.querySelector('#start-button');
const hint         = document.querySelector('#hint');
const errorScreen  = document.querySelector('#error-screen');
const errorText    = document.querySelector('#error-text');

// Small helpers to show/hide things using the "hidden" CSS class.
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

function showError(message) {
  hide(startScreen);
  hide(hint);
  errorText.textContent = message;
  show(errorScreen);
}

// 1. Enable the button once A-Frame has finished building the scene.
//    (The MindAR system only exists after this point.)
function onSceneLoaded() {
  startButton.disabled = false;
  startButton.textContent = 'Tap to start';
}
if (sceneEl.hasLoaded) onSceneLoaded();
else sceneEl.addEventListener('loaded', onSceneLoaded);

// 2. The tap. Everything here runs inside the user's tap ("user gesture").
//    iPhone Safari only allows camera access and, later, video WITH SOUND
//    to start from a real tap like this, so keep this handler synchronous.
startButton.addEventListener('click', () => {
  // The camera only works on secure pages (https:// or localhost).
  if (!window.isSecureContext) {
    showError('This page needs to be opened with https:// for the camera to work.');
    return;
  }

  hide(startScreen);

  // Phase 2 (video): unlock the video here, in the same tap, e.g.
  //   const video = document.querySelector('#overlay-video');
  //   video.play().then(() => video.pause());

  // Start MindAR: it asks for the camera, then starts tracking.
  // (API from the MindAR docs: sceneEl.systems['mindar-image-system'].start())
  const arSystem = sceneEl.systems['mindar-image-system'];
  arSystem.start();
});

// 3. MindAR events.
// arReady: camera is on and tracking is running, so start showing the hint.
let arIsReady = false;
sceneEl.addEventListener('arReady', () => {
  arIsReady = true;
  show(hint);
});

// arError: usually the camera was blocked or isn't supported.
sceneEl.addEventListener('arError', () => {
  showError('We couldn\'t turn on your camera. Allow camera access for this site ' +
            '(in Safari: tap the "aA" button in the address bar, then Website Settings > Camera > Allow), ' +
            'then tap Try again.');
});

// targetFound / targetLost fire on the badge entity.
targetEl.addEventListener('targetFound', () => hide(hint));
targetEl.addEventListener('targetLost',  () => show(hint));

// If the target file fails to load, MindAR doesn't fire arError, so catch it here.
// (Only before arReady, so unrelated hiccups later don't cover the camera.)
window.addEventListener('unhandledrejection', (event) => {
  if (arIsReady) return;
  console.error('AR failed to start:', event.reason);
  showError('Something went wrong loading the AR experience. Check your connection and tap Try again.');
});
