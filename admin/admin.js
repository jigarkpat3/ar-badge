// admin.js: the admin page. Log in with a GitHub token, see the library,
// upload, make live, rename, delete. Every change is one commit (github.js);
// GitHub Pages publishes it about a minute later, and we watch for that.

const SITE = 'https://jigarkpat3.github.io/ar-badge/';   // where the badge page is published
const TOKEN_KEY = 'arAdminToken';
const $ = (id) => document.getElementById(id);
const show = (el, on = true) => el.classList.toggle('hidden', !on);

let manifest = { items: [], live: null };
let busy = false;
const localThumbs = {};   // uploads from this visit, shown before the site has them

// ---------------------------------------------------------------- login ----
async function logIn(token, remember) {
  $('login-button').disabled = true;
  $('login-error').textContent = '';
  try {
    await github.logIn(token);
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token.trim());
    $('token').value = '';
    show($('login'), false); show($('app')); show($('logout'));
  } catch (e) {
    sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY);
    $('login-error').textContent = e.message;   // never includes the token
    show($('login')); show($('app'), false); show($('logout'), false);
  } finally {
    $('login-button').disabled = false;
  }
  if (!$('app').classList.contains('hidden')) {
    loadLibrary().catch((e) => status('Couldn’t load the library: ' + e.message, 'bad'));
  }
}
$('login-form').addEventListener('submit', (e) => { e.preventDefault(); logIn($('token').value, $('remember').checked); });
$('logout').addEventListener('click', () => {
  sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY);
  github.logOut();
  show($('app'), false); show($('logout'), false); show($('login'));
});
const saved = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
if (saved) logIn(saved, !!localStorage.getItem(TOKEN_KEY)); else show($('login'));

// -------------------------------------------------------------- library ----
async function loadLibrary() {
  manifest = await github.readManifest();
  renderLibrary();
}

function renderLibrary() {
  const list = $('library');
  list.textContent = '';
  if (!manifest.items.length) list.textContent = 'Nothing yet.';
  for (const item of manifest.items) {
    const isLive = item.id === manifest.live;
    const row = document.createElement('div'); row.className = 'item';
    const thumb = document.createElement('img'); thumb.className = 'thumb'; thumb.alt = '';
    thumb.src = localThumbs[item.id] || SITE + (item.poster || item.file);
    const f = item.focus || {};
    thumb.style.objectPosition = `${100 * (f.x ?? 0.5)}% ${100 * (f.y ?? 0.5)}%`;   // same crop as the badge
    thumb.onerror = () => { thumb.removeAttribute('src'); thumb.alt = 'publishing…'; };
    const meta = document.createElement('div'); meta.className = 'meta';
    const title = document.createElement('div'); title.className = 'title'; title.textContent = item.title || item.id;
    if (isLive) { const tag = document.createElement('span'); tag.className = 'live'; tag.textContent = 'LIVE'; title.append(tag); }
    const info = document.createElement('div'); info.className = 'info';
    info.textContent = [item.type === 'video' ? 'Video' : 'Photo', `${item.w}×${item.h}`,
      item.duration ? `${item.duration.toFixed(1)} s` : '', sizeText(item.sizeBytes),
      new Date(item.uploadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })].filter(Boolean).join(' · ');
    const buttons = document.createElement('div'); buttons.className = 'buttons';
    buttons.append(
      button('Make live', isLive, () => change(`Make "${item.title}" live`, (m) => { m.live = item.id; })),
      button('Rename', false, () => {
        const name = prompt('New title', item.title || '');
        if (name && name.trim()) change(`Rename "${item.title}"`, (m) => { find(m, item.id).title = name.trim().slice(0, 80); });
      }),
      button('Delete', isLive, () => {
        if (!confirm(`Delete "${item.title}"? This can’t be undone from here.`)) return;
        change(`Delete "${item.title}"`, (m) => {
          m.items = m.items.filter((i) => i.id !== item.id);
          // Only our own uploads in media/ are deleted. The built-in files in
          // assets/ stay (the badge page falls back to them).
          const paths = [...new Set([item.file, item.poster])].filter((p) => p && p.startsWith('media/'));
          return { files: paths.map((path) => ({ path, sha: null })) };
        });
      }, 'danger'),
    );
    if (isLive) buttons.lastChild.title = 'Make something else live first';
    meta.append(title, info, buttons);
    row.append(thumb, meta);
    list.append(row);
  }
}
function button(text, disabled, onClick, extraClass) {
  const b = document.createElement('button');
  b.className = 'small ' + (extraClass || ''); b.textContent = text;
  b.disabled = disabled || busy; b.addEventListener('click', onClick);
  return b;
}
const find = (m, id) => m.items.find((i) => i.id === id) || {};
const sizeText = (bytes) => bytes > 1e6 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';

// One change = one commit, then watch the site until it's published.
async function change(message, edit) {
  if (busy) return;
  setBusy(true);
  status('Saving…');
  try {
    const result = await github.commit(message, edit);
    manifest = result.manifest;
    renderLibrary();
    watchSite(result.manifest.rev);
  } catch (e) {
    status('Couldn’t save: ' + e.message, 'bad');
    await loadLibrary().catch(() => {});
  } finally {
    setBusy(false);
  }
}
function setBusy(on) { busy = on; $('upload').disabled = on; renderLibrary(); }

function status(text, kind) {
  const el = $('status');
  el.textContent = text; el.className = 'status' + (kind ? ' ' + kind : '');
}

// Poll the published manifest until it shows this change (checks every 5 s, up to 5 min).
let watchId = 0;
async function watchSite(rev) {
  const id = ++watchId, started = Date.now();
  status('Saved. Live in about a minute…');
  while (id === watchId && Date.now() - started < 5 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const live = await (await fetch(SITE + 'media/manifest.json?t=' + Date.now(), { cache: 'no-store' })).json();
      if ((live.rev || 0) >= rev) {
        if (id === watchId) { status('Live on the badge page now ✓', 'ok'); renderLibrary(); }
        return;
      }
      if (id === watchId) status(`Saved. Publishing… (${Math.round((Date.now() - started) / 1000)} s)`);
    } catch (e) { /* not there yet */ }
  }
  if (id === watchId) status('Saved, but the site hasn’t updated yet. It usually does within a few minutes.');
}

// --------------------------------------------------------------- upload ----
let picked = null;   // { kind, file, img | video, codec }

$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  picked = null; show($('preview'), false);
  if (!file) return;
  const kind = prepare.kind(file);
  if (!kind) { status('Pick a video (MP4/MOV) or a photo.', 'bad'); return; }
  status('Opening the file…');
  try {
    picked = { kind, file };
    if (kind === 'image') picked.img = await prepare.loadImage(file);
    else { picked.video = await prepare.loadVideo(file); picked.codec = await prepare.videoCodec(file); }
  } catch (e) { picked = null; status(e.message, 'bad'); return; }
  show($('status'), false);
  $('title').value = file.name.replace(/\.[^.]+$/, '').slice(0, 80);
  $('focus').value = 50;
  buildPreview();
  show($('preview'));
});

function pickedSize() {
  return picked.kind === 'image' ? [picked.img.naturalWidth, picked.img.naturalHeight] : [picked.video.videoWidth, picked.video.videoHeight];
}
const mode = () => document.querySelector('input[name=mode]:checked').value;

function buildPreview() {
  const [w, h] = pickedSize();
  const stage = $('stage');
  stage.querySelectorAll('img,video').forEach((el) => el.remove());
  const media = picked.kind === 'image' ? picked.img : picked.video;
  if (picked.video) { picked.video.controls = false; picked.video.loop = true; picked.video.play().catch(() => {}); }
  stage.prepend(media);
  const s = Math.min(320 / w, 320 / h);
  stage.style.width = Math.round(w * s) + 'px'; stage.style.height = Math.round(h * s) + 'px';
  show($('image-mode'), picked.kind === 'image');
  show($('focus-row'), Math.abs(w / h - 0.75) > 0.005);
  const mb = picked.file.size / 1048576;
  $('file-info').textContent = picked.kind === 'image'
    ? `${w}×${h} photo, ${mb.toFixed(1)} MB → saved as a 3:4 JPEG`
    : `${w}×${h} video, ${picked.video.duration.toFixed(1)} s, ${mb.toFixed(1)} MB, ${picked.codec}`;
  const warnings = picked.kind === 'video' ? prepare.videoWarnings(picked.file, picked.video, picked.codec) : [];
  $('warnings').innerHTML = '';
  warnings.forEach((text) => { const li = document.createElement('li'); li.textContent = text; $('warnings').append(li); });
  updateCrop();
}

// Move the dashed 3:4 window and redraw the "on the badge" result.
function updateCrop() {
  if (!picked) return;
  const [w, h] = pickedSize(), focus = $('focus').value / 100;
  const fit = picked.kind === 'image' && mode() === 'fit';
  show($('focus-row'), !fit && Math.abs(w / h - 0.75) > 0.005);
  const box = fit ? { x: 0, y: 0, w, h } : prepare.cropBox(w, h, focus);
  Object.assign($('window').style, { left: 100 * box.x / w + '%', top: 100 * box.y / h + '%', width: 100 * box.w / w + '%', height: 100 * box.h / h + '%' });
  const ctx = $('result').getContext('2d');
  if (picked.kind === 'image') ctx.drawImage(prepare.badgeCanvas(picked.img, mode(), focus), 0, 0, 150, 200);
  else ctx.drawImage(picked.video, box.x, box.y, box.w, box.h, 0, 0, 150, 200);
}
$('focus').addEventListener('input', updateCrop);
document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', updateCrop));
setInterval(() => { if (picked && picked.video && !document.hidden) updateCrop(); }, 200);   // video keeps moving

$('upload').addEventListener('click', async () => {
  if (!picked || busy) return;
  const title = $('title').value.trim() || picked.file.name;
  const [w, h] = pickedSize(), focus = $('focus').value / 100;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const id = `${picked.kind === 'video' ? 'video' : 'image'}-${stamp}-${Math.random().toString(36).slice(2, 5)}`;
  setBusy(true); show($('progress')); $('bar').style.width = '0';
  try {
    let item, uploads;
    status('Preparing…');
    if (picked.kind === 'image') {
      const canvas = prepare.badgeCanvas(picked.img, mode(), focus);
      const jpeg = await prepare.toJpeg(canvas, 0.85);
      item = { id, type: 'image', file: `media/${id}.jpg`, w: canvas.width, h: canvas.height, sizeBytes: jpeg.size };
      item.poster = item.file;
      uploads = [{ path: item.file, blob: jpeg }];
      localThumbs[id] = URL.createObjectURL(jpeg);
    } else {
      const poster = await prepare.posterFrom(picked.video);
      item = { id, type: 'video', file: `media/${id}.mp4`, poster: `media/${id}-poster.jpg`, w, h,
        sizeBytes: picked.file.size, duration: +picked.video.duration.toFixed(2) };
      if (Math.abs(w / h - 0.75) > 0.005) item.focus = w / h > 0.75 ? { x: focus } : { y: focus };
      uploads = [{ path: item.file, blob: picked.file }, { path: item.poster, blob: poster }];
      localThumbs[id] = URL.createObjectURL(poster);
    }
    Object.assign(item, { title, uploadedAt: new Date().toISOString() });

    // Upload each file as a blob (progress by bytes), then one commit.
    const total = uploads.reduce((n, u) => n + u.blob.size, 0);
    let done = 0;
    for (const u of uploads) {
      status(`Uploading ${sizeText(u.blob.size)}…`);
      const base64 = await prepare.toBase64(u.blob);
      u.sha = await github.uploadBlob(base64, (p) => { $('bar').style.width = (100 * (done + p * u.blob.size) / total).toFixed(1) + '%'; });
      done += u.blob.size;
    }
    $('bar').style.width = '100%';
    status('Saving…');
    const makeLive = $('make-live').checked;
    const result = await github.commit(`Add ${item.type} "${title}"`, (m) => {
      m.items = [item, ...(m.items || []).filter((i) => i.id !== id)];
      if (makeLive) m.live = id;
      return { files: uploads.map((u) => ({ path: u.path, sha: u.sha })) };
    });
    manifest = result.manifest;
    $('file').value = ''; picked = null; show($('preview'), false);
    setBusy(false);
    watchSite(result.manifest.rev);
  } catch (e) {
    status('Upload failed: ' + e.message, 'bad');
    setBusy(false);
  } finally {
    show($('progress'), false);
  }
});
