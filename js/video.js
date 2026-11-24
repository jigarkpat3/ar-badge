// video.js: the video with sound on the badge (or on the card).
// (media.js picks the files. Each target in TARGETS (app.js) has its own <video>
// and plane; only the one in view plays. If a target shows a photo, its part
// of this is skipped.)
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
//  - That tap only unlocks the videos started inside it. So the tap starts
//    the video of the target in view and also starts-and-pauses the other
//    target's video, so either can play later when its target is found.

const overlayVideo = (function () {
  const soundButton = document.querySelector('#sound-button');
  const muteButton = document.querySelector('#mute-button');
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  // One entry per target: its <video>, its plane, when we paused it.
  const slots = TARGETS.map((t, i) => ({
    target: i,
    video: document.querySelector(t.video),
    plane: document.querySelector(t.plane),
    pausedAt: 0,      // when we paused because the target was lost (ms)
    loaded: false,    // load() called (download started)
  }));
  const hasVideo = (slot) => !overlayMedia.isImage(slot.target);
  let current = slots[0];  // the target in view (app.js calls switchTo)
  let started = false;     // has the experience tap happened?
  let muted = false;       // the sound choice, the same for every video

  // Until a video is really playing, its plane shows the poster image
  // (its first frame). Then switch the plane to the video itself.
  // A-Frame makes it a THREE.VideoTexture and, with colorManagement on, marks
  // it sRGB like the photo was (aframe 1.5.0: material utils -> applyColorCorrection).
  slots.forEach((slot) => slot.video.addEventListener('playing', () => {
    if (slot.plane.getAttribute('material').src !== slot.video) slot.plane.setAttribute('material', 'src', slot.video);
  }));

  function load(slot) {
    if (slot.loaded || !hasVideo(slot)) return;
    slot.loaded = true;
    slot.video.load();
  }

  // Called in the first tap ("Tap to start"): start downloading now, so it's
  // ready by the time the framing step is done. (iPhones only preload after a tap.)
  // The badge's video only; the card's starts when the card is first seen.
  function preload() {
    load(slots[0]);
  }

  // Called FIRST in the "Start the experience" tap. Must stay synchronous.
  function startWithSound() {
    started = true;
    muted = false;
    slots.forEach((slot) => {
      if (!hasVideo(slot)) return;
      slot.video.muted = false;
      const attempt = slot.video.play();   // no await before this line
      if (slot === current) {
        if (attempt) attempt.catch(playMutedAndOfferSound);
      } else {
        // Not in view: started only to unlock it for later, so stop it at once.
        if (attempt) attempt.catch(() => {});
        slot.video.pause();
      }
    });
    if (!hasVideo(current)) return;   // photo: no sound buttons
    updateMuteButton();
    show(muteButton);
  }

  // Sound was refused: play muted so the badge still comes alive, and show the button.
  function playMutedAndOfferSound() {
    if (!hasVideo(current)) return;
    setMuted(true);
    current.video.play().catch(() => {});
    show(soundButton);
  }

  function setMuted(value) {
    muted = value;
    slots.forEach((slot) => { slot.video.muted = value; });
    updateMuteButton();
  }

  soundButton.addEventListener('click', () => {   // a real tap, so sound is allowed
    setMuted(false);
    current.video.play().then(() => hide(soundButton), () => {});
  });

  muteButton.addEventListener('click', () => {
    setMuted(!muted);
    muteButton.classList.remove('pop');   // small "press" animation
    void muteButton.offsetWidth;          // (restart it if tapped quickly)
    muteButton.classList.add('pop');
    if (!muted) { hide(soundButton); current.video.play().catch(() => {}); }
  });
  function updateMuteButton() {
    muteButton.classList.toggle('muted', muted);   // CSS swaps the icon
    muteButton.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }

  // Another target came into view (app.js, on 'targetchange'): pause the old
  // one's video and make the new one current. It starts when its overlay
  // reaches 'tracking' (onOverlayState), from the start if it was away a while.
  function switchTo(index) {
    const next = slots[index];
    load(next);
    if (next === current) return;
    if (started && hasVideo(current) && !current.video.paused) {
      current.video.pause();
      current.pausedAt = performance.now();
    }
    current = next;
    if (!started) return;
    if (hasVideo(current)) { updateMuteButton(); show(muteButton); }
    else { hide(muteButton); hide(soundButton); }
  }

  // Follow the photo's state (follow-badge's 'overlaystate' event, see app.js):
  //   hidden (fully faded out after losing the badge) -> pause
  //   back to tracking                                -> resume, from the start
  //                                                      if it was gone a while
  function onOverlayState(state) {
    if (!started || !hasVideo(current)) return;
    const video = current.video;
    if (state === 'hidden') {
      if (!video.paused) { video.pause(); current.pausedAt = performance.now(); }
    } else if (state === 'tracking' && video.paused) {
      if (current.pausedAt && performance.now() - current.pausedAt > TUNING.video.restartAfterMs) video.currentTime = 0;
      resume();
    }
  }
  function resume() {
    video().muted = muted;
    const attempt = video().play();
    if (attempt) attempt.catch(playMutedAndOfferSound);
  }
  const video = () => current.video;

  // Coming back to the page (iPhone pauses media in the background):
  // resume if the photo is on screen.
  document.addEventListener('visibilitychange', () => {
    const state = document.querySelector('#overlay-holder').components['follow-badge'].state;
    if (started && hasVideo(current) && !document.hidden && state !== 'hidden' && video().paused) resume();
  });

  // One line for the ?debug panel.
  function debugText() {
    if (!hasVideo(current)) return `photo ${overlayMedia.item(current.target).file}`;
    const v = video(), t = v.currentTime.toFixed(1), d = (v.duration || 0).toFixed(0);
    return `video ${t}/${d}s ${v.paused ? 'paused' : 'playing'} ${v.muted ? 'muted' : 'sound'} ` +
           `rs ${v.readyState} ${v.videoWidth}x${v.videoHeight}`;
  }

  return { video, preload, startWithSound, switchTo, onOverlayState, debugText };
})();
