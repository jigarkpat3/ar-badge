// github.js: the few GitHub REST API calls the admin page needs.
// The repo itself is the storage: every change is one commit on main, and
// GitHub Pages republishes the site about a minute later.
// Docs: https://docs.github.com/en/rest (API version 2022-11-28).
//
// The token is only ever sent to api.github.com in the Authorization header.
// It is never printed or saved anywhere except the browser storage the user picked.

const github = (function () {
  const API = 'https://api.github.com';
  const REPO = 'jigarkpat3/ar-badge';
  const BRANCH = 'main';
  const MANIFEST = 'media/manifest.json';
  let token = '';

  function headers(extra) {
    return Object.assign({
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
    }, extra);
  }

  // One API call. Throws an Error with .status on failure.
  async function call(method, path, body) {
    const response = await fetch(API + path, {
      method, cache: 'no-store',
      headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      let message = response.statusText;
      try { message = (await response.json()).message || message; } catch (e) { /* not JSON */ }
      const error = new Error(`GitHub ${response.status}: ${message}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  // Check a token: it must see the repo, and be allowed to write to it.
  // Writing test: create an empty blob. That needs Contents: write, and
  // changes nothing (a blob no commit uses is just ignored).
  async function logIn(newToken) {
    token = newToken.trim();
    try {
      const repo = await call('GET', `/repos/${REPO}`);
      if (!repo.permissions || !repo.permissions.push) throw Object.assign(new Error('no push'), { status: 403 });
      await call('POST', `/repos/${REPO}/git/blobs`, { content: '', encoding: 'utf-8' });
    } catch (e) {
      token = '';
      if (e.status === 401) throw new Error('That token isn’t valid (wrong, expired or revoked).');
      if (e.status === 404) throw new Error(`That token can’t see ${REPO}. Give it access to this repository.`);
      if (e.status === 403) throw new Error('That token can read but not write. Set Contents to “Read and write”.');
      throw new Error('Couldn’t reach GitHub: ' + e.message);
    }
  }
  function logOut() { token = ''; }

  // Upload one file's content (base64) as a blob. Uses XMLHttpRequest because
  // fetch() can't report upload progress. onProgress(0..1).
  function uploadBlob(base64, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}/repos/${REPO}/git/blobs`);
      const h = headers({ 'Content-Type': 'application/json' });
      Object.keys(h).forEach((k) => xhr.setRequestHeader(k, h[k]));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        if (xhr.status === 201) resolve(JSON.parse(xhr.responseText).sha);
        else reject(new Error(`GitHub ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
      };
      xhr.onerror = () => reject(new Error('Network error while uploading'));
      xhr.send(JSON.stringify({ content: base64, encoding: 'base64' }));
    });
  }

  // Read the manifest as it is in the newest commit (or an empty one).
  async function readManifest(ref = BRANCH) {
    try {
      const file = await call('GET', `/repos/${REPO}/contents/${MANIFEST}?ref=${ref}`);
      const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      if (e.status === 404) return { version: 1, rev: 0, live: null, items: [] };
      throw e;
    }
  }

  // Make one commit on main. change(manifest) edits the manifest it is given
  // (the newest one) and returns { files: [{ path, sha }] }, where sha is an
  // uploaded blob, or null to delete that file. If someone else committed in
  // between, it starts again from the newest commit (up to 3 times).
  async function commit(message, change) {
    for (let attempt = 1; ; attempt++) {
      const head = (await call('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`)).object.sha;
      const baseTree = (await call('GET', `/repos/${REPO}/git/commits/${head}`)).tree.sha;
      const manifest = await readManifest(head);
      const { files = [] } = change(manifest) || {};
      manifest.rev = (manifest.rev || 0) + 1;
      manifest.updatedAt = new Date().toISOString();
      const manifestSha = (await call('POST', `/repos/${REPO}/git/blobs`,
        { content: JSON.stringify(manifest, null, 2) + '\n', encoding: 'utf-8' })).sha;
      const tree = await call('POST', `/repos/${REPO}/git/trees`, {
        base_tree: baseTree,
        tree: [...files, { path: MANIFEST, sha: manifestSha }].map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: f.sha })),
      });
      const newCommit = await call('POST', `/repos/${REPO}/git/commits`, { message, tree: tree.sha, parents: [head] });
      try {
        await call('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: newCommit.sha, force: false });
        return { commit: newCommit.sha, manifest };
      } catch (e) {
        if (e.status !== 422 || attempt >= 3) throw e;   // 422 = main moved on; try again
      }
    }
  }

  return { REPO, logIn, logOut, uploadBlob, readManifest, commit };
})();
