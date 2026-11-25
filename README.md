<h1 align="center">
    <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/flax-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/flax-logo.svg">
    <img alt="flax" src="assets/flax-logo.svg" width="200px">
    </picture>
</h1>

A deshittified, debloated, streamlined Axe DevTools alternative. It runs `axe-core`, then gives you the results. That's it.

<div align="center">
    <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/screenshot-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/screenshot-light.png">
    <img alt="flax" src="assets/screenshot-light.png" width="600px">
    </picture>
</div>

## Philosophy
- **Simple UI:** Everything in its right place. Two-column layout, mute colors, dark/light theme.
- **Minimal features:** No AI bloat. No required (or optional) login. No guided tests. No little golden locks everywhere.
- **Expert-friendly:** When you see the issue, you already know what causes it and how to fix it.

## Installation
### From your browser's extension store
*Coming soon, awaiting approval.*

### From a GitHub release

Download the latest version from the [Releases page](../../releases/latest).

#### Chrome, Brave, Edge and other Chromium-based browsers

1. Download `flax-x.y.z-chromium.zip` and unzip it.
2. Navigate to `chrome://extensions/`, `brave://extensions/` or `edge://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the unzipped folder (the one containing `manifest.json`).

#### Firefox

1. Download `flax-x.y.z-firefox.zip`.
2. Navigate to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select the downloaded `.zip` file.

> [!NOTE]
> Firefox removes temporary add-ons when the browser restarts. For a permanent install, use the Firefox Add-ons store version once it's available.


## Disclaimer
This project is independently developed and is not affiliated with, sponsored by, or endorsed by Deque Systems.

## Disclosure
The code of this extension was mosty written by AI, though I personally reviewed every single line (because of course it was not accessible). The UI/UX, the name, the logo and this readme are all human-generated.

## License
This project is licensed under the Apache License, Version 2.0 (Apache-2.0). See the [LICENSE](https://github.com/calanoix/flax/blob/main/LICENSE) file for details.