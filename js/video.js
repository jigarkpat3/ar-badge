// video.js: the video with sound on the badge.
// (media.js picks the file. If the live item is a photo, all of this is skipped.)
//
// iPhone rules this file follows (WebKit's video policy for iOS):
//  - A video may play WITH SOUND only if play() is called directly inside a
//    tap. So startWithSound() is called first thing in the "Start the
//    experience" tap handler (app.js), with nothing async before it.
//  - Once a video element has been started by a tap, the page may pause and
//    resume that same element later without a new tap. We rely on that to
//    pause when the badge is lost and resume when it's found. If the phone
//    refuses anyway, we show the "Tap for sound" button.
//  - A MUTED inline video may always play. So if sound is refused, the video
//    still plays muted and "Tap for sound" turns the sound on.

const overlayVideo = (function () {
  const video = document.querySelector('#overlay-video');
  const plane = document.querySelector('#overlay');
  const soundButton = document.querySelector('#sound-button');
  const muteButton = document.querySelector('#mute-button');
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  let started = false;     // has the experience tap happened?
  let pausedAt = 0;        // when we paused because the badge was lost (ms)

  // Until the video is really playing, the plane shows the poster image
  // (its first frame). Then switch the plane to the video itself.
  // A-Frame makes it a THREE.VideoTexture and, with colorManagement on, marks
  // it sRGB like the photo was (aframe 1.5.0: material utils -> applyColorCorrection).
  video.addEventListener('playing', () => {
    if (plane.getAttribute('material').src !== video) plane.setAttribute('material', 'src', video);
  });

  // Called in the first tap ("Tap to start"): start downloading now, so it's
  // ready by the time the framing step is done. (iPhones only preload after a tap.)
  function preload() {
    if (overlayMedia.isImage()) return;   // photo on the badge: nothing to download
    video.load();
  }

  // Called FIRST in the "Start the experience" tap. Must stay synchronous.
  function startWithSound() {
    if (overlayMedia.isImage()) return;   // photo: no video, no sound buttons
    started = true;
    video.muted = false;
    const attempt = video.play();   // no await before this line
    updateMuteButton();
    show(muteButton);
    if (attempt) attempt.catch(playMutedAndOfferSound);
  }

  // Sound was refused: play muted so the badge still comes alive, and show the button.
  function playMutedAndOfferSound() {
    video.muted = true;
    updateMuteButton();
    video.play().catch(() => {});
    show(soundButton);
  }

  soundButton.addEventListener('click', () => {   // a real tap, so sound is allowed
    video.muted = false;
    video.play().then(() => hide(soundButton), () => {});
    updateMuteButton();
  });

  muteButton.addEventListener('click', () => {
    video.muted = !video.muted;
    muteButton.classList.remove('pop');   // small "press" animation
    void muteButton.offsetWidth;          // (restart it if tapped quickly)
    muteButton.classList.add('pop');
    if (!video.muted) { hide(soundButton); video.play().catch(() => {}); }
    updateMuteButton();
  });
  function updateMuteButton() {
    muteButton.classList.toggle('muted', video.muted);   // CSS swaps the icon
    muteButton.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
  }

  // Follow the photo's state (follow-badge's 'overlaystate' event, see app.js):
  //   hidden (fully faded out after losing the badge) -> pause
  //   back to tracking                                -> resume, from the start
  //                                                      if it was gone a while
  function onOverlayState(state) {
    if (!started) return;
    if (state === 'hidden') {
      video.pause();
      pausedAt = performance.now();
    } else if (state === 'tracking' && video.paused) {
      if (pausedAt && performance.now() - pausedAt > TUNING.video.restartAfterMs) video.currentTime = 0;
      resume();
    }
  }
  function resume() {
    const attempt = video.play();
    if (attempt) attempt.catch(playMutedAndOfferSound);
  }

  // Coming back to the page (iPhone pauses media in the background):
  // resume if the photo is on screen.
  document.addEventListener('visibilitychange', () => {
    const state = document.querySelector('#overlay-holder').components['follow-badge'].state;
    if (started && !document.hidden && state !== 'hidden' && video.paused) resume();
  });

  // One line for the ?debug panel.
  function debugText() {
    if (overlayMedia.isImage()) return `photo ${overlayMedia.item().file}`;
    const t = video.currentTime.toFixed(1), d = (video.duration || 0).toFixed(0);
    return `video ${t}/${d}s ${video.paused ? 'paused' : 'playing'} ${video.muted ? 'muted' : 'sound'} ` +
           `rs ${video.readyState} ${video.videoWidth}x${video.videoHeight}`;
  }

  return { video, preload, startWithSound, onOverlayState, debugText };
})();
