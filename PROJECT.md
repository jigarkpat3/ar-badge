# AR Lab project: Event badge AR

## Goal
Point an iPhone at an event ID badge and have media appear locked onto it. Phase 1 is a photo, phase 2 is a video with sound.

## Platform and versions
- Web app in iPhone Safari, with no app install.
- MindAR image tracking 1.2.5 (mindar-image-aframe) plus A-Frame 1.5.0, loaded from a CDN with pinned versions.
- Exact URLs (jsDelivr): https://cdn.jsdelivr.net/npm/aframe@1.5.0/dist/aframe-v1.5.0.min.js (bundles three.js r158) and https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js. A-Frame 1.5.0 is the version the MindAR 1.2.5 docs pair it with, so no downgrade needed.
- A-Frame 1.5.0 gotcha: the VR button component is `xr-mode-ui` (older MindAR examples say `vr-mode-ui`, which does nothing in 1.5.0). Color is handled by `renderer="colorManagement: true"` (the `color-space` attribute in old examples doesn't exist in 1.5.0).
- Hosting: GitHub Pages at https://jigarkpat3.github.io/ar-badge/ (see Hosting). Add ?debug to the address for the on-screen debug panel.

## About Jigar
- Has an iPhone, a Mac and a PC, all with cameras.
- Coded years ago and is out of practice, so explain new concepts once.
- Has a Cursor account for cloud agents. GitHub username: jigarkpat3.

## Decisions
- 2026-11-23: Web with MindAR instead of native, because it's the easiest path (no Xcode, no fees).
- 2026-11-23: First target is an event ID badge.
- 2026-11-23: Start with a photo overlay to learn tracking, then move to video. Keep the media swappable.
- 2026-11-23: The video will have sound, so the app has a "Tap to start" screen (iOS needs a tap before audio plays).
- 2026-11-23: Host for free so he can test by opening a link.
- 2026-11-23: Repo created at https://github.com/jigarkpat3/ar-badge (public, so free GitHub Pages works later). Pushed with the box's gh CLI, which is logged in as jigarkpat3. Cursor cloud agents are linked as jigarkpat, so they can't push to it unless jigarkpat is added as a collaborator.
- 2026-11-23: Tried a shared template target (assets/badge-target.png): Jigar's design export with the bleed/guide lines removed, the slot filled, and every per-person field blanked into the background gradient (name, event line, role, city, number), so one target could work for every badge. Not adopted for now. On Jigar's real photo it matched with 29 / 16 inliers (straight / rotated 25° at 0.8 scale) vs 49 / 31 for the photo-based target. A simulated photo of a different badge (Tej Patel's design composited onto the same table) gave 37 / 20 for the template target vs 31 / 18 for the photo target, so the photo target already carries over to other badges through the shared logo and SĀCHU text. MindAR needs only 6 inliers, so both work. The live assets/targets.mind stays photo-based. Re-test with a real photo of someone else's badge before switching. The compiled template target is in reference/targets-template.mind (not committed).
- 2026-11-23 (after Jigar's first iPhone test): Fit. The side overhang is not a size error. Checked: badge.jpg has no margin (its edges are the badge; at most a 3-4 px light rim on the right, under 0.5%), its 3:4 shape matches the measured 1.335. MindAR 1.2.5's aframe.js sizes the camera video with "cover" scaling and derives the 3D camera from the same numbers, so the overlay matches the badge to 0.3% in headless tests with portrait 480x640, landscape 640x480 and 720x1280 cameras on phone-sized screens. Causes of what he saw: (1) lag from the old filter (filterBeta 0.001 smoothed everything at ~1 Hz), so with side-to-side hand motion the photo trailed the badge and stuck out on one side, then the other; his recording shows the badge peeking out beside the photo; (2) the photo had square corners and the badge has rounded ones (about 24 px of 750), so the photo's corners stuck out past the badge. Fix: new smoothing (below) and rounded corners. No recompile. Unverified on iPhone: if the camera changes frame size after start, MindAR keeps the old size. The ?debug panel shows "camera" vs "input" sizes so we can check.
- 2026-11-23: Smoothing. MindAR's One Euro filter runs on the 16 raw matrix numbers with one beta for both rotation (values ~0-1) and position (values in hundreds), so no single beta suits both. Chosen: filterMinCF 0.001 (1 Hz at rest) and filterBeta 10 (rotation stays steady when still and catches up when tilting; position passes through mostly unfiltered). Our own follow-badge component (js/components.js) then smooths position/rotation/size each rendered frame with frame-rate-independent exponential smoothing that adapts to motion: 0.12 s smoothing time when still (difference under 0.6% of badge width / 0.34 deg), down to 0.01 s when moving (over 2.5%). Depth counts 0.3x when measuring motion because it's the noisiest. Offline simulation with MindAR's real filter code (30 fps tracking, assumed noise of ~1 px, depth 0.75%, 0.5 deg): still jitter 0.38 px/frame (old 0.44, MindAR default 3.13); error while sliding 1 badge width/s 6.1 px (old 18.7, unfiltered 6.0); while tilting 40 deg/s 3.9 px (old 14.0, unfiltered 3.4). warmupTolerance/missTolerance (both exist in 1.2.5, default 5 frames) left at 5. All values are in TUNING at the top of js/app.js.
- 2026-11-23: Dropouts and fades. follow-badge keeps the last pose for 500 ms after MindAR's targetLost, then fades out over 250 ms; fades in over 200 ms on found. If the badge comes back while it's being held, the photo glides from where it was instead of popping.
- 2026-11-23: Rounded corners come from an alpha map (a small canvas drawn at startup: white rounded rectangle on black), radius 0.032 of the badge width. The same thing will work on the video later. overlay.jpg stays a 136 KB JPG (a PNG with baked corners was 1.04 MB).
- 2026-11-23: Startup. Cause of the small box: MindAR adds its camera <video> to the page as soon as start() runs, with no size, so it shows at the default 300x150 in the top-left until its resize code runs after the camera and TensorFlow are ready; the page behind was white. Fix: a dark "Starting camera…" cover from the tap until arReady, then a forced resize and two frames' wait before lifting it. A video "resize" listener re-fits the view if the camera changes size. Note: don't put a background on <body>; it paints over MindAR's video (z-index -2).

## Plan (approved 2026-11-23)
Features in order:
1. Badge target: pick or make the badge image, then compile it to targets.mind with MindAR's online compiler.
2. Start screen: a "Tap to start" button that starts the camera.
3. Photo overlay: a photo appears on the badge, sized to match it.
4. Tracking polish: smoothing to cut jitter, plus a hint like "point at the badge" when tracking is lost.
5. Hosting: an HTTPS link he can open on his iPhone.
6. Video with sound: replace the photo with an MP4 that plays on the tap, pauses when the badge is lost, and resumes when it's found again.

Screens: start screen, then camera view with the overlay and a scanning hint.

Files:
```
ar-badge/
  index.html        page, start button, A-Frame scene
  js/app.js         TUNING values, start, found/lost events, debug panel, media control
  js/components.js  follow-badge (smoothing, hold, fade) and rounded-corners
  css/style.css     start screen and hint styling
  assets/
    targets.mind    compiled badge target
    badge.jpg       source image of the badge (for reference/printing)
    overlay.jpg     phase 1 photo
    overlay.mp4     phase 2 video (H.264, 720p)
```

## Reference (end goal)
- 2026-11-23: Jigar's sample video (reference/idea-video.mp4) shows a FIFA World Cup 2026 fan ID card: black, about credit-card size, gold logo, white text, a QR code. A video with sound covers the card exactly and stays locked to it, then sometimes grows into a large floating video in the middle of the screen and shrinks back. It has a "Continue to experience" button and no visible browser bar. Stretch goals: full-size video on the card plus a grow-out-of-the-card effect.

## Done
- Requirements gathered.
- Reference video reviewed.
- GitHub repo created with plan + skeleton.
- Feature 1 (badge target): badge photo flattened to assets/badge.jpg, compiled to assets/targets.mind with mind-ar 1.2.5 (2026-11-23).
- Features 2 + 3 (2026-11-23): index.html, js/app.js, css/style.css. "Tap to start" screen calls `sceneEl.systems['mindar-image-system'].start()` inside the tap (mindar-image autoStart: false, built-in MindAR UI off). Photo overlay is an a-plane 1 x 1.3333, flat shader, sRGB. Smoothing filterMinCF 0.001, filterBeta 0.001 (docs defaults are 0.001 / 1000; this is steadier with a bit more lag; retune in feature 4). Hint "Point your camera at the badge" shows after arReady and on targetLost, hides on targetFound. Friendly error screen for arError (camera blocked), non-HTTPS pages, and a failed target load. Tested headlessly in Chrome with a fake camera made from the badge photo: arReady, targetFound, targetLost, targetFound all fired, the photo lines up with the badge edges, colors are sRGB, no console errors (screenshots in reference/test-*.png, not committed).

- Feature 4 (tracking polish) and fit/startup fixes (2026-11-23): smoothing (MindAR filter + follow-badge), hold 500 ms through dropouts, fade in/out, rounded corners, dark startup cover, ?debug panel (fps, tracking rate, state, camera/input/screen sizes, See-through button). Headless: fit within 0.3%, found -> lost (held 491 ms, faded 234 ms) -> found again, no console errors.
- Feature 5 (hosting): GitHub Pages live (see Hosting).

## Next
- Jigar re-tests on the iPhone (normal link, then with ?debug): jitter when still, lag when tilting, the fit with See-through on, the startup with no box or white flash. Retune TUNING if needed.
- Then feature 6: video with sound.

## Open questions
- Weekly check-in: declined 2026-11-23.

## Assets
- assets/overlay.jpg: Jigar's own photo (sent 2026-11-23), the phase 1 overlay. Resized and compressed from 8.4 MB to 750x1000 (3:4), 136 KB.
- assets/badge-target.png: shared template target (750x1000, 3:4) made from Jigar's design export. Bleed/guide lines removed, slot hole and corners filled with background, per-person text (name, event line, role, city, number) blanked with a smooth gradient fill. Kept: top deity image, temple logo, three SĀCHU lines, divider, footer portraits/text. For reference only, not the live target (see Decisions). About 1,430 detection points and 23 + 18 tracking points, almost all on the logo, SĀCHU text, top image and footer.
- assets/badge.jpg: Jigar's own event badge (SĀCHU SĀCHU SĀCHU, North American Activities Meeting 2026), from his phone photo. Personal use. Perspective-corrected and cropped to 750x1000. Measured aspect H/W 1.335, saved at exactly 4:3 (1.3333).
- assets/targets.mind: compiled from badge.jpg with mind-ar 1.2.5's compiler (npm package, run in Node, .mind format v2). Must be loaded with mind-ar@1.2.5. About 1,900 detection points over 10 scales, 37 + 24 tracking points. Strongest on the logo, SĀCHU text and name. Weak on the plain black top band and the right side. Glossy badge, so watch for glare.

## Hosting
- 2026-11-23: GitHub Pages turned on (with Jigar's OK). It serves main / at https://jigarkpat3.github.io/ar-badge/ and HTTPS is enforced. Every push to main redeploys in about a minute.
