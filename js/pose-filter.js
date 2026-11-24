// pose-filter.js: the one smoothing stage between MindAR and the overlay.
//
// Why: MindAR's raw badge pose is noisy (more so on a glossy badge under
// glare). Before round 14 it was smoothed twice: MindAR's own filter on the 16
// raw matrix numbers (each number with its own strength, so the rotation part
// stopped being a clean rotation: the overlay swayed, tilted and pulsed in
// size) and then follow-badge's two-speed glide, which snapped to catch up
// whenever the difference crossed its "moving" threshold. Now MindAR's filter
// is switched off (TUNING.mindar) and this runs once per new MindAR pose.
//
// It's a "One Euro" filter (Casiez et al. 2012): a smoothing whose strength
// depends on speed. Still = strong smoothing (cutoff minCutoff Hz), moving =
// almost none (cutoff rises by beta Hz per badge width/s or radian/s). The
// change is gradual, so there is no mode switch and no snap.
// It works on quantities that match what you see:
//   u, v  where the badge is on screen (x/depth, y/depth)
//   w     log of the distance (its size on screen)
//   q     its rotation (quaternion, smoothed with slerp)
// plus a check that drops a pose that suddenly jumps (a glare flip) for a
// frame or two.
//
// Plain script (no A-Frame needed) so the offline simulation can load it too.

var PoseFilter = (function () {
  const alphaFor = (cutoffHz, dt) => { const r = 2 * Math.PI * cutoffHz * dt; return r / (r + 1); };

  class PoseFilter {
    // THREE: the three.js namespace (AFRAME.THREE in the page). T: TUNING.filter
    constructor(THREE, T) {
      this.T = T;
      this.q = new THREE.Quaternion();    // smoothed rotation
      this.qIn = new THREE.Quaternion();
      this.qLast = new THREE.Quaternion();   // last accepted raw rotation
      this.wLast = 0;                        // last accepted raw log-distance
      this.p = [0, 0, 0];                 // smoothed u, v, w
      this.dp = [0, 0, 0];                // smoothed speeds of u, v, w (per second)
      this.dq = [0, 0, 0];                // smoothed turning speed (radians per second, as an axis x angle)
      this.qd = new THREE.Quaternion();
      this.scale = 1;
      this.t = null;
      this.rejected = 0;                  // poses dropped in a row
      this.stats = { poses: 0, dropped: 0 };   // for the ?debug panel and tests
    }

    reset() { this.t = null; this.rejected = 0; }

    // t: seconds. pos: Vector3 (camera space, badge in front means z < 0).
    // quat: Quaternion. scale: one number (MindAR's badge size, constant).
    // Writes the smoothed pose into outPos / outQuat. Returns false when the
    // pose was dropped as a jump.
    update(t, pos, quat, scale, outPos, outQuat) {
      const T = this.T;
      const z = Math.max(1e-6, -pos.z);
      const u = pos.x / z, v = pos.y / z, w = Math.log(z);
      const width = scale / z;            // badge width in u/v units
      this.qIn.copy(quat);

      if (this.t === null) {
        this.p = [u, v, w]; this.dp = [0, 0, 0]; this.dq = [0, 0, 0];
        this.q.copy(quat); this.scale = scale; this.t = t; this.rejected = 0;
        this.qLast.copy(quat); this.wLast = w;
      } else {
        const dt = Math.min(0.25, Math.max(1e-3, t - this.t));
        // Jump check: compared with the last accepted pose, a sudden turn or
        // size change bigger than the hand can do in one frame (allowing for
        // how fast it's already turning or moving). Dropped for up to
        // T.maxRejects poses in a row; if it persists it's real and accepted.
        const turnSpeed = Math.hypot(this.dq[0], this.dq[1], this.dq[2]);
        const jump = this.qLast.angleTo(this.qIn) > T.jumpDeg * Math.PI / 180 + 2 * dt * turnSpeed ||
                     Math.abs(w - this.wLast) > T.jumpScale + 2 * dt * Math.abs(this.dp[2]);
        this.stats.poses++;
        // A flip mostly breaks the tilt and distance; where the badge is on
        // screen stays right, so the position keeps following (no freeze).
        const drop = jump && this.rejected < T.maxRejects;
        if (drop) { this.rejected++; this.stats.dropped++; }
        else { this.rejected = 0; this.qLast.copy(this.qIn); this.wLast = w; }
        const turn = this.q.angleTo(this.qIn);

        // Position on screen (u, v share one cutoff so the path keeps its shape) and distance.
        const ad = alphaFor(T.dCutoff, dt);
        const raw = [u, v, w];
        for (let i = 0; i < (drop ? 2 : 3); i++) this.dp[i] += ad * ((raw[i] - this.p[i]) / dt - this.dp[i]);
        const speedUV = Math.hypot(this.dp[0], this.dp[1]) / width;          // badge widths per second
        // Catch-up: if the badge is further away from the overlay than the
        // tracking noise can explain, open the filter in proportion (smoothly,
        // so there's no snap). This covers quick back-and-forth moves that the
        // smoothed speed above underestimates.
        const gap = Math.hypot(u - this.p[0], v - this.p[1]) / width;          // badge widths
        const aUV = alphaFor(T.minCutoff + T.beta * speedUV + T.gapGain * Math.max(0, gap - T.gapFree), dt);
        const aW = alphaFor(T.minCutoffDepth + T.beta * Math.abs(this.dp[2]), dt);
        this.p[0] += aUV * (u - this.p[0]);
        this.p[1] += aUV * (v - this.p[1]);
        if (drop) { this.t = t; this.write(outPos, outQuat); return false; }
        this.p[2] += aW * (w - this.p[2]);

        // Rotation: turning speed as a vector (axis x angle per second), smoothed
        // like the position speeds, so random wobbles average out instead of
        // adding up (only a steady turn counts as turning).
        const d = this.qd.copy(this.q).invert().multiply(this.qIn);
        if (d.w < 0) { d.x = -d.x; d.y = -d.y; d.z = -d.z; d.w = -d.w; }
        const s = Math.sqrt(Math.max(0, 1 - d.w * d.w)), ang = 2 * Math.atan2(s, d.w), k = s > 1e-9 ? ang / s / dt : 2 / dt;
        const om = [d.x * k, d.y * k, d.z * k];
        for (let i = 0; i < 3; i++) this.dq[i] += ad * (om[i] - this.dq[i]);
        const aQ = alphaFor(T.minCutoffRot + T.betaRot * Math.hypot(this.dq[0], this.dq[1], this.dq[2]) +
                            T.gapGainRot * Math.max(0, turn - T.gapFreeRot * Math.PI / 180), dt);
        this.q.slerp(this.qIn, aQ);
        this.scale = scale;
        this.t = t;
      }
      this.write(outPos, outQuat);
      return true;
    }

    write(outPos, outQuat) {
      const z = Math.exp(this.p[2]);
      outPos.set(this.p[0] * z, this.p[1] * z, -z);
      outQuat.copy(this.q);
    }
  }
  return PoseFilter;
})();
if (typeof module !== 'undefined') module.exports = PoseFilter;
