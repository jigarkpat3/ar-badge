// coach.js: live tips in one glass pill, one message at a time.
//
// Every 100 ms we measure a few things (cheap), turn each into "is this a
// problem?" with two thresholds (one to switch on, a lower one to switch off,
// so it doesn't flicker), and show the most important problem:
//   During framing  -> in the status pill at the top (replacing "Looking for…")
//   During the experience -> in the hint pill at the bottom
// It also replaces the old "Point your camera at the badge" hint, so there is
// never more than one pill. Thresholds live in TUNING.coach (app.js).
// Uses app.js's arSystem, arIsReady, experienceStarted, follow() and activeTarget().
// ("badge" below means whichever target is in view: badge or card.)

const coach = (function () {
  const C = TUNING.coach;
  const T3 = AFRAME.THREE;
  const badgeEl = document.querySelector('#tracked-target');   // badge or card (components.js, active-target)
  const hintEl = document.querySelector('#hint');
  const framingStatus = document.querySelector('#framing-status');

  // Measured values (also shown in ?debug and saved in the run log).
  const lostTip = () => 'Point your camera at the ' + activeTarget().label;
  const isLostTip = (text) => text.startsWith('Point your camera at the ');   // any target's
  const m = { rate: 0, speed: 0, size: 0, cutOff: false, angle: 0, light: -1, glare: 0, lostMs: 0 };
  const on = {};               // which problems are currently "on" (with hysteresis)
  let framingDefault = framingStatus.textContent;     // app.js's status text when there's no tip
  let shown = '', shownAt = 0, candidate = '', candidateSince = 0;

  // --- Tracking rate: MindAR updates in the last second -------------------
  const updates = [];
  badgeEl.addEventListener('targetUpdate', () => updates.push(performance.now()));

  // --- Pose: speed, size on screen, cut off, angle (every frame) -----------
  const pos = new T3.Vector3(), quat = new T3.Quaternion(), scl = new T3.Vector3();
  const v = new T3.Vector3(), history = [];
  let lastTime = 0, hadPose = false, lostSince = performance.now(), foundSince = 0;
  let screenQuad = null;       // badge corners in CSS px, for the glare check

  function measurePose(now) {
    const anchor = badgeEl.object3D;
    const cam = document.querySelector('a-scene').camera;
    if (!anchor.visible || !cam) { hadPose = false; history.length = 0; screenQuad = null; m.speed = 0; foundSince = 0; return; }
    lostSince = now;
    if (!foundSince) foundSince = now;
    anchor.matrix.decompose(pos, quat, scl);
    // Speed: compare with where the badge was ~0.25 s ago (comparing
    // frame-to-frame would count the tiny tracking jitter as movement).
    history.push({ t: now, pos: pos.clone(), quat: quat.clone() });
    while (history.length > 2 && now - history[1].t >= 250) history.shift();
    const old = history[0], dt = (now - old.t) / 1000;
    if (hadPose && dt > 0.1) {
      // badge widths per second, or radians per second, whichever is bigger
      const speed = Math.max(pos.distanceTo(old.pos) / scl.x / dt, quat.angleTo(old.quat) * activeTarget().angleWeight / dt);
      // Peak-hold: jumps up at once, eases down over ~0.5 s, so a back-and-forth
      // sway reads as "moving" the whole time, not just at its fastest moments.
      m.speed = Math.max(speed, m.speed * Math.exp(-(now - lastTime) / 500));
    }
    hadPose = true; lastTime = now;

    // Where are the badge corners on screen?
    const hy = activeTarget().aspect / 2;   // the target's corners: 1 wide, aspect tall
    screenQuad = [[-0.5, hy], [0.5, hy], [0.5, -hy], [-0.5, -hy]].map(([x, y]) => {
      v.set(x, y, 0).applyMatrix4(anchor.matrixWorld).project(cam);
      return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
    });
    const xs = screenQuad.map((p) => p[0]), ys = screenQuad.map((p) => p[1]);
    m.size = (Math.max(...xs) - Math.min(...xs)) / innerWidth;   // share of the screen width
    const marginX = 0.02 * innerWidth, marginY = 0.02 * innerHeight;
    m.cutOff = Math.min(...xs) < -marginX || Math.max(...xs) > innerWidth + marginX ||
               Math.min(...ys) < -marginY || Math.max(...ys) > innerHeight + marginY;
    // Angle between the badge's face and the direction to the camera.
    v.set(0, 0, 1).applyQuaternion(quat);
    const toCam = pos.clone().negate().normalize();
    m.angle = Math.acos(Math.min(1, Math.abs(v.dot(toCam)))) * 180 / Math.PI;
  }

  // --- Light and glare: tiny copies of the camera picture, every 500 ms ----
  const small = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  function measurePicture() {
    const video = arSystem && arSystem.video;
    if (!video || !video.videoWidth) return;
    // Light: average brightness of a 32x32 copy (0 = black, 1 = white).
    small.canvas.width = 32; small.canvas.height = 32;
    small.drawImage(video, 0, 0, 32, 32);
    const d = small.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    m.light = sum / (d.length / 4) / 255;

    // Glare: the biggest patch of blown-out white inside the badge.
    m.glare = 0;
    if (!screenQuad) return;
    const box = videoBox(video, screenQuad);
    if (!box) return;
    const W = 32, H = 40;
    small.canvas.width = W; small.canvas.height = H;
    small.drawImage(video, box.x, box.y, box.w, box.h, 0, 0, W, H);
    const g = small.getImageData(0, 0, W, H).data;
    const white = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) white[i] = Math.min(g[i * 4], g[i * 4 + 1], g[i * 4 + 2]) >= C.glareLevel ? 1 : 0;
    m.glare = biggestPatch(white, W, H) / (W * H);
  }

  // The badge's bounding box in camera-picture pixels (the picture is shown
  // "cover"-scaled with MindAR's CSS left/top/width/height).
  function videoBox(video, quad) {
    const left = parseFloat(video.style.left) || 0, top = parseFloat(video.style.top) || 0;
    const k = video.videoWidth / (parseFloat(video.style.width) || innerWidth);
    const xs = quad.map((p) => (p[0] - left) * k), ys = quad.map((p) => (p[1] - top) * k);
    const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
    const w = Math.min(video.videoWidth, Math.max(...xs)) - x, h = Math.min(video.videoHeight, Math.max(...ys)) - y;
    return (w > 8 && h > 8) ? { x, y, w, h } : null;
  }

  // Size of the largest connected group of 1s (4-neighbour flood fill).
  function biggestPatch(grid, W, H) {
    let best = 0;
    const stack = [];
    for (let start = 0; start < grid.length; start++) {
      if (grid[start] !== 1) continue;
      let n = 0;
      grid[start] = 2; stack.push(start);
      while (stack.length) {
        const i = stack.pop(); n++;
        const x = i % W;
        for (const j of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) {
          if (j >= 0 && j < grid.length && grid[j] === 1) { grid[j] = 2; stack.push(j); }
        }
      }
      best = Math.max(best, n);
    }
    return best;
  }

  // --- Turn measurements into problems (with hysteresis) -------------------
  // problem(name, isOnNow, isOffNow): stays on until the "off" test passes.
  function problem(name, switchOn, switchOff) {
    if (on[name]) { if (switchOff) on[name] = false; }
    else if (switchOn) on[name] = true;
    return on[name];
  }

  function pickTip(now) {
    const phase = !arIsReady ? 'off' : experienceStarted ? 'experience' : 'framing';
    if (phase === 'off') return '';
    const tracking = badgeEl.object3D.visible;
    const dark = m.light >= 0 && problem('dark', m.light < C.darkOn, m.light > C.darkOff);

    if (tracking) {
      if (problem('moving', m.speed > C.moveOn, m.speed < C.moveOff)) return 'Hold steady';
      if (problem('cut', m.cutOff, !m.cutOff)) return 'Keep the whole ' + activeTarget().label + ' in view';
      if (dark) return 'Find better light';   // dim light also makes tracking slow and shaky
      if (problem('close', m.size > C.closeOn, m.size < C.closeOff)) return 'Move back a little';
      // A small badge gives a rough angle, so only judge the angle once it's big enough.
      if (problem('far', m.size < C.farOn, m.size > C.farOff)) return 'Move closer';
      if (problem('angle', m.angle > C.angleOn, m.angle < C.angleOff)) return 'Face the ' + activeTarget().label + ' more directly';
      if (problem('glare', m.glare > C.glareOn, m.glare < C.glareOff)) return 'Tilt to avoid glare';
      // Tracking slow for no visible reason: holding still helps it lock on.
      const rateKnown = now - foundSince > 1000;   // the rate needs a second of tracking to count
      if (problem('slow', rateKnown && m.rate < C.slowRateOn, !rateKnown || m.rate > C.slowRateOff)) return 'Hold steady';
      return '';
    }
    ['cut', 'moving', 'close', 'far', 'angle', 'glare', 'slow'].forEach((k) => { on[k] = false; });
    if (dark) return 'Find better light';
    if (phase === 'framing') {
      if (m.lostMs < C.notFoundMs) return '';
      const tips = C.searchTips;      // rotate through them
      return tips[Math.floor((m.lostMs - C.notFoundMs) / C.searchTipMs) % tips.length];
    }
    // Experience: once the photo has fully faded out, ask for the badge again.
    return follow().state === 'hidden' ? lostTip() : '';
  }

  // --- Show it, without flicker --------------------------------------------
  // A new tip must be wanted for a moment before it shows, and a shown tip
  // stays at least C.minShowMs.
  function update() {
    const now = performance.now();
    while (updates.length && updates[0] < now - 1000) updates.shift();
    m.rate = updates.length;
    m.lostMs = badgeEl.object3D.visible ? 0 : now - lostSince;
    const want = pickTip(now);
    if (want !== candidate) { candidate = want; candidateSince = now; }
    // The "point your camera" hint goes the moment the photo is back.
    if (isLostTip(shown) && !isLostTip(want) && follow().state !== 'hidden') {
      shown = ''; shownAt = 0; render(); return;
    }
    const waitMs = !want ? C.clearAfterMs
                 : want === lostTip() ? C.lostTipAfterMs
                 : experienceStarted ? C.showAfterMsExperience : C.showAfterMs;
    if (candidate !== shown && now - candidateSince >= waitMs && (now - shownAt >= C.minShowMs || !shown)) {
      shown = candidate; shownAt = now;
      render();
    }
  }

  function render() {
    if (experienceStarted || !arIsReady) {
      hintEl.textContent = shown;
      hintEl.classList.toggle('hidden', !shown || !arIsReady);
    } else {
      hintEl.classList.add('hidden');
      framingStatus.textContent = shown || framingDefault;
      framingStatus.classList.toggle('tip', !!shown);
    }
  }

  (function everyFrame() { measurePose(performance.now()); requestAnimationFrame(everyFrame); })();
  setInterval(update, 100);
  document.querySelector('#overlay-holder').addEventListener('overlaystate', update);   // react at once
  setInterval(measurePicture, 500);

  return {
    metrics: m,
    tip: () => shown,
    // app.js's own framing status ("Looking for…", "Ready!"); shown when no tip.
    setFramingStatus(text) { framingDefault = text; if (!shown) framingStatus.textContent = text; },
    refresh: render,
  };
})();
