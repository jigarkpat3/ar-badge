# AR Lab project: Event badge AR

## Goal
Point an iPhone at an event ID badge and have media appear locked onto it. Phase 1 is a photo, phase 2 is a video with sound.

## Platform and versions
- Web app in iPhone Safari, with no app install.
- MindAR image tracking 1.2.5 (mindar-image-aframe) plus A-Frame 1.5.0, loaded from a CDN with pinned versions.
- Exact URLs (jsDelivr): https://cdn.jsdelivr.net/npm/aframe@1.5.0/dist/aframe-v1.5.0.min.js (bundles three.js r158) and https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js. A-Frame 1.5.0 is the version the MindAR 1.2.5 docs pair it with, so no downgrade needed.
- A-Frame 1.5.0 gotcha: the VR button component is `xr-mode-ui` (older MindAR examples say `vr-mode-ui`, which does nothing in 1.5.0). Color is handled by `renderer="colorManagement: true"` (the `color-space` attribute in old examples doesn't exist in 1.5.0).
- Hosting: free HTTPS static hosting for testing (proposed: GitHub Pages under jigarkpat3). Needs Jigar's go-ahead before any repo or deploy.

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
  js/app.js         start, found/lost events, media control
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

## Next
- Feature 5 (hosting): turn on GitHub Pages for jigarkpat3/ar-badge so Jigar can open an HTTPS link on his iPhone. Waiting for Jigar's OK before enabling it.

## Open questions
- Weekly check-in: declined 2026-11-23.

## Assets
- assets/overlay.jpg: Jigar's own photo (sent 2026-11-23), the phase 1 overlay. Resized and compressed from 8.4 MB to 750x1000 (3:4), 136 KB.
- assets/badge-target.png: shared template target (750x1000, 3:4) made from Jigar's design export. Bleed/guide lines removed, slot hole and corners filled with background, per-person text (name, event line, role, city, number) blanked with a smooth gradient fill. Kept: top deity image, temple logo, three SĀCHU lines, divider, footer portraits/text. For reference only, not the live target (see Decisions). About 1,430 detection points and 23 + 18 tracking points, almost all on the logo, SĀCHU text, top image and footer.
- assets/badge.jpg: Jigar's own event badge (SĀCHU SĀCHU SĀCHU, North American Activities Meeting 2026), from his phone photo. Personal use. Perspective-corrected and cropped to 750x1000. Measured aspect H/W 1.335, saved at exactly 4:3 (1.3333).
- assets/targets.mind: compiled from badge.jpg with mind-ar 1.2.5's compiler (npm package, run in Node, .mind format v2). Must be loaded with mind-ar@1.2.5. About 1,900 detection points over 10 scales, 37 + 24 tracking points. Strongest on the logo, SĀCHU text and name. Weak on the plain black top band and the right side. Glossy badge, so watch for glare.
