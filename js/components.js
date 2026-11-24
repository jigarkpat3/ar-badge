// components.js: the A-Frame components used in index.html.
//   follow-badge    keeps the photo on the tracked badge (smoothing in pose-filter.js)
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
    // The one smoothing stage (pose-filter.js, TUNING.filter). It runs once per
    // new MindAR pose; between poses the photo stays where it is.
    this.filter = new PoseFilter(AFRAME.THREE, TUNING.filter);
    this.lastMatrix = null;   // MindAR makes a new matrix object for every new pose

    // 'hidden' -> 'tracking' -> (badge lost) 'holding' -> 'fading' -> 'hidden'
    this.state = 'hidden';
    this.lastSeen = 0;      // time (ms) we last had a real badge position
    this.opacity = 0;       // 0 = invisible, 1 = fully visible
    this.seeThrough = false; // debug: show the photo at half opacity
    // false during the framing screen: the photo keeps following the badge
    // (so its smoothing settles) but stays invisible. app.js sets it to true
    // when "Start the experience" is tapped.
    this.revealed = false;
    this.el.object3D.visible = false;
  },

  tick: function (time, dtMs) {
    const T = TUNING.follow;
    const anchor = this.data.target.object3D;
    const me = this.el.object3D;

    if (anchor.visible) {
      // MindAR found the badge. Its anchor matrix holds the raw pose.
      if (anchor.matrix !== this.lastMatrix) {   // a new pose (not just a new screen frame)
        this.lastMatrix = anchor.matrix;
        anchor.matrix.decompose(this.rawPos, this.rawRot, this.rawScale);
        // One size for both directions keeps the photo's shape exactly 3:4.
        const size = (this.rawScale.x + this.rawScale.y) / 2;
        // Fresh start: jump straight to the badge (no gliding in from nowhere).
        // After a short dropout (holding), carry on smoothly from where it is.
        if (this.state === 'hidden') this.filter.reset();
        this.filter.update(time / 1000, this.rawPos, this.rawRot, size, me.position, me.quaternion);
        me.scale.setScalar(size);
      }
      this.setState('tracking');
      this.lastSeen = time;
    } else if (this.state !== 'hidden') {
      // Badge lost: keep the last pose for a moment, then fade out.
      this.setState((time - this.lastSeen < T.holdMs) ? 'holding' : 'fading');
    }

    // Fade: move opacity toward 1 (tracking/holding) or 0 (fading).
    const wantVisible = this.revealed && (this.state === 'tracking' || this.state === 'holding');
    const step = dtMs / (wantVisible ? T.fadeInMs : T.fadeOutMs);
    this.opacity = clamp01(this.opacity + (wantVisible ? step : -step));
    if (this.opacity === 0 && this.state === 'fading') this.setState('hidden');

    me.visible = this.opacity > 0;
    this.setOpacity(this.opacity * (this.seeThrough ? 0.5 : 1));
  },

  // Change state and tell the page (app.js shows the hint only when 'hidden').
  setState: function (state) {
    if (state === this.state) return;
    this.state = state;
    this.el.emit('overlaystate', { state: state });
  },

  setOpacity: function (value) {
    // Each part fades together; a part can have its own full strength
    // (material.userData.baseOpacity, e.g. the shadow is only 35% dark).
    this.el.object3D.traverse((obj) => {
      if (obj.material) obj.material.opacity = value * (obj.material.userData.baseOpacity ?? 1);
    });
  },
});

// The overlay's shape: a bit bigger than the badge (TUNING.overlay.overscan,
// so the real badge edge never peeks out) with rounded corners and a soft,
// slightly feathered edge.
//
// Why soft: on iPhones A-Frame turns off antialiasing, so a hard edge is drawn
// as pixel "stairs" that crawl when the overlay moves even a fraction of a
// pixel. Here the edge comes from an "alpha map" (a black-and-white picture:
// white = visible, black = see-through) that fades from 1 to 0 over a couple of
// screen pixels, and the plane's own border is fully see-through. The GPU
// blends that fade smoothly, so the edge stays smooth at any position.
// The map is drawn once at startup from the exact rounded-rectangle shape
// ("signed distance": how far each pixel is from the edge).
AFRAME.registerComponent('rounded-corners', {
  init: function () {
    const O = TUNING.overlay;
    const s = O.overscan;
    this.el.setAttribute('width', s);           // 1 = badge width
    this.el.setAttribute('height', s * 4 / 3);  // 3:4 like the badge

    // Work in plane units: the plane is 1 wide and 4/3 tall in the map.
    const w = O.alphaMapWidth, h = Math.round(w * 4 / 3);
    const soft = O.edgeSoftness;                 // width of the fade
    const hx = 0.5 - soft / 2, hy = 2 / 3 - soft / 2;   // half-size of the visible shape
    // Same corner as the badge, just grown outward by the overscan margin.
    const margin = hx - 0.5 / s;
    const r = TUNING.cornerRadius / s + margin;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let j = 0; j < h; j++) {
      const py = Math.abs((j + 0.5) / w - 2 / 3) - (hy - r);
      for (let i = 0; i < w; i++) {
        const px = Math.abs((i + 0.5) / w - 0.5) - (hx - r);
        // distance outside the rounded rectangle (negative = inside)
        const d = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - r;
        const t = Math.min(1, Math.max(0, 0.5 - d / soft));
        const v = Math.round(255 * t * t * (3 - 2 * t));   // smoothstep fade
        const k = (j * w + i) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Default CanvasTexture filtering = linear with mipmaps (smooth when big or small).
    this.alphaMap = new CanvasTexture(canvas);

    this.apply = this.apply.bind(this);
    this.el.addEventListener('object3dset', this.apply);  // when the mesh is (re)built
    this.el.addEventListener('materialtextureloaded', this.apply);  // poster -> video switch
    this.apply();
  },

  apply: function () {
    const mesh = this.el.getObject3D('mesh');
    if (!mesh) return;
    mesh.material.alphaMap = this.alphaMap;
    mesh.material.transparent = true;
    mesh.material.needsUpdate = true;
    mesh.renderOrder = 1;   // always drawn after (on top of) the shadow
    // Cut the picture to the badge's 3:4 shape (media.js). The alpha map has its
    // own repeat/offset in three r158, so this doesn't move the rounded corners.
    const map = mesh.material.map;
    if (map && map.image) {
      const img = map.image;
      const c = overlayMedia.crop(img.videoWidth || img.naturalWidth || img.width, img.videoHeight || img.naturalHeight || img.height);
      map.repeat.set(c.repeat[0], c.repeat[1]);
      map.offset.set(c.offset[0], c.offset[1]);
    }
  },
});

// A soft shadow under the overlay, so on a table it looks like it lies on the
// badge instead of being pasted on (the overscan hides the badge's own shadow).
// A plain black plane, a bit bigger than the badge, just behind the overlay,
// with a blurry rounded-rectangle alpha map, shifted a little down so it's
// heavier toward the bottom edge. It fades with the overlay (follow-badge).
// Turn off with ?shadow=0.
AFRAME.registerComponent('soft-shadow', {
  init: function () {
    const S = TUNING.shadow;
    if (!S.enabled) return;
    const THREE = AFRAME.THREE;
    const blur = S.blur;                     // in badge widths
    const pad = 3 * blur;                    // room for the fade around the badge
    const pw = 1 + 2 * pad, ph = 4 / 3 + 2 * pad;

    // Alpha map: 1 under the badge, fading to 0 over about 2 x blur outside it.
    const w = 256, h = Math.round(w * ph / pw);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const r = TUNING.cornerRadius;
    for (let j = 0; j < h; j++) {
      const py = Math.abs(((j + 0.5) / h - 0.5) * ph) - (2 / 3 - r);
      for (let i = 0; i < w; i++) {
        const px = Math.abs(((i + 0.5) / w - 0.5) * pw) - (0.5 - r);
        const d = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - r;
        const t = Math.min(1, Math.max(0, (d + blur * 0.5) / (blur * 2.5)));
        const v = Math.round(255 * (1 - t) * (1 - t));
        const k = (j * w + i) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      alphaMap: new THREE.CanvasTexture(canvas),
      transparent: true,
      opacity: 0,
      depthWrite: false,   // never hides anything; just darkens what's behind
    });
    material.userData.baseOpacity = S.opacity;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), material);
    mesh.position.set(0, -S.offsetDown, -S.depth);   // a bit down, a bit behind the overlay
    mesh.renderOrder = 0;
    this.el.setObject3D('mesh', mesh);
  },
});
