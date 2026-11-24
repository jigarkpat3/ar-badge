// components.js: two small A-Frame components used in index.html.
//   follow-badge    makes the photo glide smoothly after the tracked badge
//   rounded-corners rounds the photo's corners to match the badge
// Their tuning numbers live in TUNING at the top of app.js.

const { Vector3, Quaternion, CanvasTexture } = AFRAME.THREE;

// Clamp a number into the 0..1 range.
const clamp01 = (x) => Math.min(1, Math.max(0, x));

AFRAME.registerComponent('follow-badge', {
  schema: {
    target: { type: 'selector' },  // the MindAR anchor entity (#badge-target)
  },

  init: function () {
    // Where MindAR says the badge is this frame (position, rotation, size).
    this.rawPos = new Vector3();
    this.rawRot = new Quaternion();
    this.rawScale = new Vector3();
    this.delta = new Vector3();

    // 'hidden' -> 'tracking' -> (badge lost) 'holding' -> 'fading' -> 'hidden'
    this.state = 'hidden';
    this.lastSeen = 0;      // time (ms) we last had a real badge position
    this.opacity = 0;       // 0 = invisible, 1 = fully visible
    this.seeThrough = false; // debug: show the photo at half opacity
    this.el.object3D.visible = false;
  },

  tick: function (time, dtMs) {
    const T = TUNING.follow;
    const anchor = this.data.target.object3D;
    const me = this.el.object3D;
    const dt = Math.min(dtMs, 100) / 1000;  // seconds since last frame (capped)

    if (anchor.visible) {
      // MindAR found the badge. Its anchor matrix holds the raw pose.
      anchor.matrix.decompose(this.rawPos, this.rawRot, this.rawScale);
      // Keep the photo's shape exactly 3:4: one size for both directions.
      // (MindAR's filter can leave slightly different x/y sizes while moving.)
      this.rawScale.setScalar((this.rawScale.x + this.rawScale.y) / 2);

      if (this.state === 'hidden') {
        // Fresh start: jump straight to the badge (no gliding in from nowhere).
        me.position.copy(this.rawPos);
        me.quaternion.copy(this.rawRot);
        me.scale.copy(this.rawScale);
      } else {
        this.glideToward(dt, T);
      }
      this.setState('tracking');
      this.lastSeen = time;
    } else if (this.state !== 'hidden') {
      // Badge lost: keep the last pose for a moment, then fade out.
      this.setState((time - this.lastSeen < T.holdMs) ? 'holding' : 'fading');
    }

    // Fade: move opacity toward 1 (tracking/holding) or 0 (fading).
    const wantVisible = this.state === 'tracking' || this.state === 'holding';
    const step = dtMs / (wantVisible ? T.fadeInMs : T.fadeOutMs);
    this.opacity = clamp01(this.opacity + (wantVisible ? step : -step));
    if (this.opacity === 0 && this.state === 'fading') this.setState('hidden');

    me.visible = this.opacity > 0;
    this.setOpacity(this.opacity * (this.seeThrough ? 0.5 : 1));
  },

  // Adaptive smoothing: tiny differences (hand held still, jitter) are
  // smoothed heavily; big differences (badge moving) are followed quickly.
  glideToward: function (dt, T) {
    const me = this.el.object3D;
    const badgeWidth = this.rawScale.x;  // 1 badge width in scene units (same for y, see tick)

    // How far off are we? Position error in badge widths (depth counts less,
    // because MindAR's distance estimate is the noisiest part) and angle in radians.
    this.delta.subVectors(this.rawPos, me.position);
    const posErr = Math.hypot(this.delta.x, this.delta.y, this.delta.z * T.depthWeight) / badgeWidth;
    const angErr = me.quaternion.angleTo(this.rawRot);
    const motion = Math.max(posErr, angErr);

    // 0 = at rest, 1 = moving fast. Pick a smoothing time in between.
    const k = clamp01((motion - T.restMotion) / (T.fastMotion - T.restMotion));
    const smoothTime = T.restSmoothTime + (T.fastSmoothTime - T.restSmoothTime) * k;

    // Exponential smoothing that behaves the same at 30 or 60 frames per second.
    const a = 1 - Math.exp(-dt / smoothTime);
    me.position.lerp(this.rawPos, a);
    me.quaternion.slerp(this.rawRot, a);
    me.scale.lerp(this.rawScale, a);
  },

  // Change state and tell the page (app.js shows the hint only when 'hidden').
  setState: function (state) {
    if (state === this.state) return;
    this.state = state;
    this.el.emit('overlaystate', { state: state });
  },

  setOpacity: function (value) {
    this.el.object3D.traverse((obj) => {
      if (obj.material) obj.material.opacity = value;
    });
  },
});

// Rounds the corners of a plane with an "alpha map": a small black-and-white
// picture where white = visible and black = see-through. It works for a photo
// now and will work the same for a video later.
AFRAME.registerComponent('rounded-corners', {
  init: function () {
    const w = 512, h = Math.round(512 * 4 / 3);   // same 3:4 shape as the badge
    const r = TUNING.cornerRadius * w;            // corner radius in canvas pixels
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.beginPath();                 // a rectangle with rounded corners
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.fill();
    this.alphaMap = new CanvasTexture(canvas);

    this.apply = this.apply.bind(this);
    this.el.addEventListener('object3dset', this.apply);  // when the mesh is (re)built
    this.apply();
  },

  apply: function () {
    const mesh = this.el.getObject3D('mesh');
    if (!mesh) return;
    mesh.material.alphaMap = this.alphaMap;
    mesh.material.transparent = true;
    mesh.material.needsUpdate = true;
  },
});
