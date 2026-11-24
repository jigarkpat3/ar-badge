// prepare.js: get a picked file ready for the badge, in the browser.
//  - Photos: cut to the badge's 3:4 shape (or fitted inside it), at most
//    1000 px tall, saved as JPEG (quality 0.85). Usually 100-300 KB.
//  - Videos: not re-encoded (too heavy for a browser). We check the type,
//    size, length and codec, take a poster frame (the first frame, shown until
//    the video plays), and save where to crop; the badge page crops the video
//    to 3:4 while it draws it (media.js).

const prepare = (function () {
  const LIMITS = {
    imageInputMB: 30,      // bigger photos are refused (phones make 2-8 MB)
    videoWarnMB: 40,       // above this: a warning (slow on mobile data, heavy for the browser to upload)
    videoMaxMB: 95,        // GitHub refuses files over 100 MB
    videoWarnSeconds: 120,
    videoWarnMbps: 4,      // about 2 Mbps is plenty for a badge-sized video
    imageLongSide: 1000,   // output 750 x 1000
    posterLongSide: 960,
  };
  const MB = 1024 * 1024;

  function kind(file) {
    if (/^image\//.test(file.type)) return 'image';
    if (/^video\//.test(file.type) || /\.(mp4|m4v|mov)$/i.test(file.name)) return 'video';
    return null;
  }

  // --- Photos ---------------------------------------------------------------
  async function loadImage(file) {
    if (file.size > LIMITS.imageInputMB * MB) throw new Error(`That photo is over ${LIMITS.imageInputMB} MB.`);
    const img = new Image();
    img.src = URL.createObjectURL(file);
    try { await img.decode(); } catch (e) { throw new Error('This browser can’t open that photo. Try a JPEG or PNG.'); }
    return img;   // browsers apply the photo's rotation (EXIF) when drawing
  }

  // Draw the photo onto a 3:4 canvas. mode 'crop' fills it (cutting the extra
  // around focus 0..1), 'fit' shows all of it on black.
  function badgeCanvas(img, mode, focus) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const outH = Math.min(LIMITS.imageLongSide, mode === 'crop' ? Math.min(h, w * 4 / 3) : Math.max(h, w * 4 / 3));
    const outW = Math.round(outH * 3 / 4);
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = Math.round(outH);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a0a';   // near-black bars (NC27 palette)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    if (mode === 'crop') {
      const c = cropBox(w, h, focus);
      ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
    } else {
      const s = Math.min(canvas.width / w, canvas.height / h);
      ctx.drawImage(img, (canvas.width - w * s) / 2, (canvas.height - h * s) / 2, w * s, h * s);
    }
    return canvas;
  }
  const toJpeg = (canvas, quality) => new Promise((done) => canvas.toBlob(done, 'image/jpeg', quality));

  // The 3:4 part of a w x h picture that's kept (in its pixels), around focus.
  function cropBox(w, h, focus = 0.5) {
    if (w / h > 3 / 4) { const cw = h * 3 / 4; return { x: (w - cw) * focus, y: 0, w: cw, h }; }
    const ch = w * 4 / 3; return { x: 0, y: (h - ch) * focus, w, h: ch };
  }

  // --- Videos ---------------------------------------------------------------
  async function loadVideo(file) {
    if (file.size > LIMITS.videoMaxMB * MB) throw new Error(`That video is ${(file.size / MB).toFixed(0)} MB; the limit is ${LIMITS.videoMaxMB} MB (GitHub refuses files over 100 MB). Shorten or compress it first.`);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    video.src = URL.createObjectURL(file);
    const ok = await waitFor(video, 'loadedmetadata', 10000);
    if (!ok || !video.videoWidth) throw new Error('This browser can’t play that video, so phones may not either. Export it as an MP4 (H.264), e.g. iPhone Settings › Camera › Formats › Most Compatible.');
    return video;
  }

  // Poster: the frame at 0.1 s, same shape as the video (the badge page crops both the same way).
  async function posterFrom(video) {
    video.currentTime = 0.1;
    if (!(await waitFor(video, 'seeked', 5000))) {   // some phones only decode after play()
      await video.play().catch(() => {}); await waitFor(video, 'timeupdate', 3000); video.pause();
    }
    const s = Math.min(1, LIMITS.posterLongSide / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * s); canvas.height = Math.round(video.videoHeight * s);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return toJpeg(canvas, 0.82);
  }

  // Which video codec? Read the MP4/MOV's top-level boxes to find "moov" (the
  // index), then look for the codec's 4-letter code in it. Cheap: no decoding.
  async function videoCodec(file) {
    let pos = 0;
    while (pos + 8 <= file.size) {
      const head = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
      let size = head.getUint32(0);
      const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
      if (size === 1) size = Number(head.getBigUint64(8));      // 64-bit size
      if (size === 0) size = file.size - pos;                    // to the end
      if (size < 8) return 'unknown';
      if (type === 'moov') {
        const text = new TextDecoder('latin1').decode(await file.slice(pos, pos + Math.min(size, 8 * MB)).arrayBuffer());
        if (/avc1|avc3/.test(text)) return 'H.264';
        if (/hvc1|hev1/.test(text)) return 'HEVC';
        if (/av01/.test(text)) return 'AV1';
        if (/vp09/.test(text)) return 'VP9';
        return 'unknown';
      }
      pos += size;
    }
    return 'unknown';
  }

  // Warnings shown before upload (not blocking).
  function videoWarnings(file, video, codec) {
    const warn = [];
    const mb = file.size / MB, mbps = file.size * 8 / 1e6 / (video.duration || 1);
    if (mb > LIMITS.videoWarnMB) warn.push(`${mb.toFixed(0)} MB is big: slow to load on mobile data and to upload. Under ${LIMITS.videoWarnMB} MB is better (about 15 MB per minute at 720p).`);
    if (video.duration > LIMITS.videoWarnSeconds) warn.push(`It’s ${Math.round(video.duration)} s long; shorter clips load faster.`);
    if (mbps > LIMITS.videoWarnMbps) warn.push(`High bitrate (${mbps.toFixed(1)} Mbps); about 2 Mbps is plenty for the badge.`);
    if (codec === 'HEVC') warn.push('HEVC (H.265) plays on iPhones but not on many Android phones. For everyone, export as H.264 (“Most Compatible”).');
    if (codec === 'unknown') warn.push('Couldn’t tell the video codec; H.264 MP4 is the safest.');
    return warn;
  }

  // --- Helpers --------------------------------------------------------------
  function waitFor(el, event, ms) {
    return new Promise((done) => {
      const timer = setTimeout(() => done(false), ms);
      el.addEventListener(event, () => { clearTimeout(timer); done(true); }, { once: true });
      el.addEventListener('error', () => { clearTimeout(timer); done(false); }, { once: true });
    });
  }
  // File/Blob -> base64 text (what the GitHub API wants).
  function toBase64(blob) {
    return new Promise((done, fail) => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result.slice(reader.result.indexOf(',') + 1));
      reader.onerror = () => fail(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  return { LIMITS, kind, loadImage, badgeCanvas, toJpeg, cropBox, loadVideo, posterFrom, videoCodec, videoWarnings, toBase64 };
})();
