// runlog.js: a small log of the first 20 seconds of a run (only with ?debug), to find out
// why a run was wobbly (Jigar saw it once, on his first try).
// It keeps this run and the one before in the
// phone's storage, to read afterwards:
// open the page with ?debug and tap "Log".
// Each second: tracking updates/s, frames/s, the slowest frame (ms), how much
// the overlay shook (average move per frame, % of badge width), camera size,
// how much of the video has downloaded. Plus events: camera tries, restarts,
// found/lost, unlock, experience, page hidden/shown.

const runLog = (function () {
  const KEY = 'arRunLog', SECONDS = 20;
  const lines = [];
  let t0 = 0, timer = null, sec = null, lastFrame = 0;
  const badgeEl = document.querySelector('#tracked-target');   // badge or card
  const holderEl = document.querySelector('#overlay-holder');
  const T3 = AFRAME.THREE, prevPos = new T3.Vector3(), prevQuat = new T3.Quaternion();
  let havePrev = false;

  const stamp = () => ((performance.now() - t0) / 1000).toFixed(1).padStart(4) + 's ';
  function note(text) {
    if (!t0 || performance.now() - t0 > SECONDS * 1000) return;
    lines.push(stamp() + text);
    save();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ when: new Date().toLocaleString(), lines })); } catch (e) { /* private mode */ }
  }

  function start() {
    if (t0) return;
    try {   // keep the previous run
      const last = localStorage.getItem(KEY);
      if (last) localStorage.setItem(KEY + 'Prev', last);
    } catch (e) { /* ignore */ }
    t0 = performance.now();
    lines.push(`start  ${navigator.userAgent.match(/OS [\d_]+/) || ''}  screen ${innerWidth}x${innerHeight}@${devicePixelRatio}`);
    sec = { frames: 0, updates: 0, slowest: 0, shake: 0, n: 0 };
    badgeEl.addEventListener('targetUpdate', () => sec && sec.updates++);
    badgeEl.addEventListener('targetFound', () => note('found'));
    badgeEl.addEventListener('targetLost', () => note('lost'));
    document.addEventListener('visibilitychange', () => note(document.hidden ? 'page hidden' : 'page shown'));
    document.querySelector('a-scene').addEventListener('arReady', () => {
      const v = arSystem.video;
      note(`arReady camera ${v.videoWidth}x${v.videoHeight} tries ${cameraReport.tries.join('>')} @${cameraReport.fps}fps`);
      v.addEventListener('resize', () => note(`camera resized to ${v.videoWidth}x${v.videoHeight}`));
    });
    requestAnimationFrame(frame);
    timer = setInterval(everySecond, 1000);
  }

  function frame(now) {
    if (!sec) return;
    sec.frames++;
    if (lastFrame) sec.slowest = Math.max(sec.slowest, now - lastFrame);
    lastFrame = now;
    // Shake: how much the overlay moved this frame while the badge was tracked.
    const o = holderEl.object3D;
    if (badgeEl.object3D.visible && o.scale.x > 0) {
      if (havePrev) { sec.shake += o.position.distanceTo(prevPos) / o.scale.x + o.quaternion.angleTo(prevQuat) * 0.67; sec.n++; }
      prevPos.copy(o.position); prevQuat.copy(o.quaternion); havePrev = true;
    } else havePrev = false;
    requestAnimationFrame(frame);
  }

  function everySecond() {
    const v = overlayVideo.video();   // the video of the target in view
    const buffered = v.buffered.length ? v.buffered.end(v.buffered.length - 1).toFixed(0) : 0;
    const cam = arSystem && arSystem.video ? arSystem.video.videoWidth + 'x' + arSystem.video.videoHeight : '-';
    const shake = sec.n ? (100 * sec.shake / sec.n).toFixed(2) + '%' : '-';
    note(`track ${sec.updates}/s fps ${sec.frames} slowest ${Math.round(sec.slowest)}ms shake ${shake} cam ${cam} video ${buffered}s`);
    sec = { frames: 0, updates: 0, slowest: 0, shake: 0, n: 0 };
    if (performance.now() - t0 > SECONDS * 1000) { clearInterval(timer); sec = null; }
  }

  function text() {
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
    const now = { when: 'this run', lines }, prev = read(KEY + 'Prev');
    return [now, prev].filter(Boolean).map((r) => `-- ${r.when} --\n` + r.lines.join('\n')).join('\n\n');
  }

  return { start, note, text };
})();
