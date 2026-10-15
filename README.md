# Kio Shield — Clean & Ad-Free

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Userscript](https://img.shields.io/badge/Userscript-Tampermonkey%20%7C%20Violentmonkey-green.svg)](#installation)

**Kio Shield** is an advanced, lightweight userscript designed for [kio.ac](https://kio.ac). It completely eliminates third-party ads, closed-shadow sponsored banners, and recurring donation popups while bypassing anti-adblock detection and strictly safeguarding file download controls and password prompts.

---

## Key Features

- **Anti-Anti-Adblock Bypass**:
  - Virtualizes `Element.prototype.checkVisibility` and `HTMLElement.prototype.offsetParent` so internal site inspection routines (`W8`, `O8`, `N8`) always perceive ad slots as compliant.
  - Intercepts `IntersectionObserver` to simulate full visibility for ad boundaries without displaying them.
  - Pre-arms AdSense `<ins>` containers with `data-ad-status="filled"` to prevent timeout-triggered adblock penalties.
  - Defuses malicious `html-load.com` loader scripts and blocks fraudulent confirm/alert trap popups.

- **Clean Zero-Space Ad Elimination**:
  - Safely collapses ad slot containers to `0px` without invoking layout breakage or triggering site visibility warnings.
  - Automatically recovers and unlocks document scroll locks caused by Google Vignette full-screen ads.

- **Sponsor Banner & Closed Shadow DOM Neutralization**:
  - Monitors and captures fixed sponsor banners (`M8`) rendered within closed shadow roots, removing them without interfering with standard application DOM trees.

- **Patreon Donation Popup Auto-Dismissal**:
  - Silently closes recurring Patreon donation dialogs and suppresses lifespan meter badges (`Life 96%` / `수명 96%`).

- **Zero Interruption to Critical Controls**:
  - Fully isolates password-protected collection modals, download action buttons, and confirmation flows, ensuring smooth, uninterrupted file transfers.

---

## Installation

1. Install a userscript manager extension in your browser:
   - [Violentmonkey](https://violentmonkey.github.io/) (Recommended)
   - [Tampermonkey](https://www.tampermonkey.net/)
2. Open the userscript file:
   - Click to install [`Kio_Shield.user.js`](https://raw.githubusercontent.com/ProofPage/Kio-Shield/main/Kio_Shield.user.js).
3. Confirm the installation in your userscript manager.
4. Navigate to [kio.ac](https://kio.ac) and enjoy a clean, ad-free interface.

---

## Technical Details

| Target | Mechanism | Result |
| :--- | :--- | :--- |
| **Site Ad Slots (`s9`)** | Zero-dimension CSS + Property Virtualization | Ads hidden, zero detection |
| **Sponsor Banners (`M8`)** | `attachShadow` Hooking | Closed shadow hosts neutralized |
| **Adblock Warning (`k8`/`np`)** | Virtualized Visibility + Auto-Confirm | Modals suppressed or bypassed |
| **Donation Overlays** | Selective Query Matching & Synthetic Dismissal | Popups auto-closed safely |
| **Password Prompts** | Input Form Element Guarding | Kept 100% functional |

---

## License

This project is licensed under the [MIT License](LICENSE).
