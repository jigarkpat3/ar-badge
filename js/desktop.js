// desktop.js: on a computer, show "Open this on your phone" with a QR code of
// this page, plus a "Try anyway" link. Phones and tablets (iPad too) go
// straight to the start screen.

(function () {
  const ua = navigator.userAgent;
  const phoneOrTablet =
    /iPhone|iPad|iPod|Android|Mobile/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ||        // iPadOS says "Macintosh"
    (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820);   // other touch devices
  const triedAnyway = sessionStorage.getItem('arTryAnyway') === '1';
  if (phoneOrTablet || triedAnyway) return;

  const screenEl = document.querySelector('#desktop-screen');
  const pageUrl = location.origin + location.pathname;   // without ?debug etc.
  document.querySelector('#desktop-url').textContent = pageUrl.replace(/^https?:\/\//, '');
  screenEl.classList.remove('hidden');

  document.querySelector('#desktop-try').addEventListener('click', (event) => {
    event.preventDefault();
    sessionStorage.setItem('arTryAnyway', '1');   // for this tab only
    screenEl.classList.add('hidden');
  });

  // QR code: qrcode-generator 1.4.4 (kazuhikoarase), pinned and integrity-checked,
  // loaded only on computers. qrcode(0 = pick size, 'M' error correction).
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  script.integrity = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    const qr = qrcode(0, 'M');
    qr.addData(pageUrl);
    qr.make();
    document.querySelector('#desktop-qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4 });
  };
  document.head.appendChild(script);
})();
