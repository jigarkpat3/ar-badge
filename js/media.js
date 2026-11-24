// media.js: which video or photo goes on the badge.
//
// The admin page (admin/) keeps a list in media/manifest.json and marks one
// item "live". On load we fetch that list (never from cache, so a change shows
// up on the next load) and use the live item. If the list is missing or broken,
// we fall back to the built-in video in assets/.
//
// Any shape of video or photo works: crop() works out how to cut it to the
// badge's 3:4 shape ("cover", like a phone wallpaper), around item.focus.
//
// That's the badge (TARGETS[0] in app.js). Other targets (the card) have their
// own fixed media in TARGETS[i].media; this file points their plane and
// <video> at it too.

const overlayMedia = (function () {
  const FALLBACK = { id: 'fallback', type: 'video', file: 'assets/overlay.mp4', poster: 'assets/overlay-poster.jpg' };
  let item = FALLBACK;

  async function loadManifest() {
    try {
      const timeout = AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined;   // slow network: don't wait forever
      const response = await fetch('media/manifest.json?t=' + Date.now(), { cache: 'no-store', signal: timeout });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const manifest = await response.json();
      const live = (manifest.items || []).find((i) => i.id === manifest.live);
      if (live && (live.type === 'video' || live.type === 'image') && live.file) item = live;
      else console.warn('media: no usable live item, using the built-in video');
    } catch (e) {
      console.warn('media: manifest not loaded, using the built-in video', e.message);
    }
    const scene = document.querySelector('a-scene');   // wait until A-Frame has built the plane
    if (!scene.hasLoaded) await new Promise((done) => scene.addEventListener('loaded', done, { once: true }));
    applyToPage();
    return item;
  }

  // Point each target's plane and <video> at its media (the badge: the live item).
  function applyToPage() {
    TARGETS.forEach((t, i) => {
      const it = itemFor(i);
      const plane = document.querySelector(t.plane);
      if (it.type === 'video') {
        const video = document.querySelector(t.video);
        video.poster = it.poster || '';
        video.src = it.file;
        if (it.poster) plane.setAttribute('material', 'src', it.poster);   // shown until the video plays
      } else {
        plane.setAttribute('material', 'src', it.file);
      }
    });
  }
  const itemFor = (i) => TARGETS[i].media || item;

  // Texture repeat/offset that shows a window of a (width x height) picture in
  // the target's shape (badge 3:4), as big as possible, centred on focus (0..1,
  // default the middle).
  function crop(width, height, target = 0) {
    const badge = 1 / TARGETS[target].aspect, aspect = width / height;   // width / height
    const focus = itemFor(target).focus || {};
    const fx = focus.x ?? 0.5, fy = focus.y ?? 0.5;
    if (!width || !height || Math.abs(aspect - badge) < 0.005) return { repeat: [1, 1], offset: [0, 0] };
    if (aspect > badge) {             // wider than the badge: cut the sides
      const r = badge / aspect;
      return { repeat: [r, 1], offset: [(1 - r) * fx, 0] };
    }
    const r = aspect / badge;         // taller: cut top and bottom
    return { repeat: [1, r], offset: [0, (1 - r) * (1 - fy)] };   // texture y goes up
  }

  return {
    ready: loadManifest(),
    isImage: (target = 0) => itemFor(target).type === 'image',
    item: (target = 0) => itemFor(target),
    crop,
  };
})();
