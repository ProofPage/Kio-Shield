// ==UserScript==
// @name         Kio Shield — Clean & Ad-Free
// @namespace    https://github.com/ProofPage/Kio-Shield
// @version      3.0.1
// @description  Seamlessly blocks ads, sponsored banners, and donation popups on kio.ac without triggering anti-adblock detection or disrupting password and download controls.
// @author       Page
// @homepageURL  https://github.com/ProofPage/Kio-Shield
// @supportURL   https://github.com/ProofPage/Kio-Shield/issues
// @updateURL    https://raw.githubusercontent.com/ProofPage/Kio-Shield/main/Kio_Shield.user.js
// @downloadURL  https://raw.githubusercontent.com/ProofPage/Kio-Shield/main/Kio_Shield.user.js
// @match        https://kio.ac/*
// @run-at       document-start
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';
  const KEY = '__kioShieldV3';
  if (window[KEY]) return;
  Object.defineProperty(window, KEY, { value: true });

  const HIDDEN = 'data-kio-hidden-ad';
  const SPONSOR = 'data-kio-hidden-sponsor';
  const PASSING = 'data-kio-auto-confirming';
  const STYLE_ID = '__kioShieldCssV3';

  const DIALOG = '[data-dialog-content], [data-alert-dialog-content], [role="dialog"], [role="alertdialog"]';
  const AD_TITLE = /^(?:애드블록 감지됨|adblock detected|アドブロック가検出されました|检测到广告拦截|偵測到廣告阻擋器)[.!。\s]*$/i;
  const AD_TEXT = /애드\s*블록|ad\s*block|アドブロック|广告拦截|廣告阻擋/i;
  const CONFIRM = /^(?:\d+\s+)?(?:확인|ok|confirm|確認|确定|確定)(?:\s*\(?\d+\)?)?$/i;
  const DONATION_TITLE = /^(?:Kiosk를 도와주세요|Help us keep Kiosk running|Kioskを支援してください|资助Kiosk持续运行|資助以維持 Kiosk 服務)$/i;

  // Site s9() wrapper & ad identifiers
  const SLOT = 'div.flex.w-full.shrink-0.justify-center.outline-1.outline-border.outline-solid';
  const AD_SELECTOR = [
    'ins.adsbygoogle', '.google-auto-placed', '.internal-banner', SLOT,
    'iframe[data-google-container-id]', 'iframe[title="Advertisement"]',
    'iframe[src*="://googleads.g.doubleclick.net/"]',
    'iframe[src*="://tpc.googlesyndication.com/"]',
    'iframe[src*="://lib.wtg-ads.com/"]',
    'iframe[src*="://report.error-report.com/modal"]'
  ].join(',');

  const roots = new WeakSet();
  const adElements = new WeakSet();
  let observer;
  let timer = null;
  let running = true;
  let vignetteCleanup = false;

  // -------------------------------------------------------------------------
  // 1. Anti-Anti-Adblock Layer: Neutralize site inspection (W8, checkVisibility, offsetParent)
  // -------------------------------------------------------------------------

  function isAdElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (adElements.has(el)) return true;
    try {
      if (el.matches?.(AD_SELECTOR) || el.closest?.(SLOT)) {
        adElements.add(el);
        return true;
      }
    } catch {}
    return false;
  }

  // Hook Element.prototype.checkVisibility so W8() always sees ads as visible
  const origCheckVisibility = Element.prototype.checkVisibility;
  if (typeof origCheckVisibility === 'function') {
    Element.prototype.checkVisibility = function (...args) {
      if (isAdElement(this)) return true;
      return Reflect.apply(origCheckVisibility, this, args);
    };
    try {
      Object.defineProperty(Element.prototype.checkVisibility, 'toString', {
        value: () => 'function checkVisibility() { [native code] }',
        configurable: true
      });
    } catch {}
  }

  // Hook HTMLElement.prototype.offsetParent so O8() does not report offsetParent === null
  const offsetDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  if (offsetDesc?.get) {
    const origOffsetParent = offsetDesc.get;
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      ...offsetDesc,
      get: function () {
        const parent = origOffsetParent.call(this);
        if (!parent && isAdElement(this)) {
          return document.body || document.documentElement;
        }
        return parent;
      }
    });
  }

  // Hook IntersectionObserver so $8() always sees ratio >= 0.5
  const OrigIntersectionObserver = window.IntersectionObserver;
  if (typeof OrigIntersectionObserver === 'function') {
    const PatchedIntersectionObserver = function (callback, options) {
      const wrappedCallback = (entries, obs) => {
        const modifiedEntries = entries.map(entry => {
          if (isAdElement(entry.target)) {
            return new Proxy(entry, {
              get(target, prop) {
                if (prop === 'intersectionRatio') return 1;
                if (prop === 'isIntersecting') return true;
                return Reflect.get(target, prop);
              }
            });
          }
          return entry;
        });
        return callback(modifiedEntries, obs);
      };
      return new OrigIntersectionObserver(wrappedCallback, options);
    };
    PatchedIntersectionObserver.prototype = OrigIntersectionObserver.prototype;
    try {
      Object.defineProperty(PatchedIntersectionObserver, 'toString', {
        value: () => 'function IntersectionObserver() { [native code] }',
        configurable: true
      });
    } catch {}
    window.IntersectionObserver = PatchedIntersectionObserver;
  }

  // Neutralize confirm/alert traps used by anti-adblock loader (e.g. html-load.com)
  const origConfirm = window.confirm;
  if (typeof origConfirm === 'function') {
    window.confirm = function (msg) {
      if (typeof msg === 'string' && /problem loading the page|error-report\.com|vital api blocked/i.test(msg)) {
        return false;
      }
      return Reflect.apply(origConfirm, this, arguments);
    };
    try {
      Object.defineProperty(window.confirm, 'toString', {
        value: () => 'function confirm() { [native code] }',
        configurable: true
      });
    } catch {}
  }

  // -------------------------------------------------------------------------
  // 2. Script Interception & AdSense Pre-arming
  // -------------------------------------------------------------------------

  function adScript(src) {
    if (!src) return false;
    try {
      const u = new URL(src, location.href);
      return ((u.hostname === 'pagead2.googlesyndication.com' && u.pathname.startsWith('/pagead/')) ||
        u.hostname === 'lib.wtg-ads.com' ||
        (u.hostname === 'html-load.com' && u.pathname === '/loader.min.js'));
    } catch { return false; }
  }

  // Neutralize ad scripts: handle AdSense, WTG, and html-load.com safely
  function neutralize(node) {
    if (!node || typeof node.querySelectorAll !== 'function') return;

    // Pre-arm AdSense tags with data-ad-status="filled" so J8 timeout never triggers adblock detection
    const insNodes = node.nodeType === 1 && node.localName === 'ins' ? [node] :
      [...node.querySelectorAll('ins.adsbygoogle')];
    for (const ins of insNodes) {
      adElements.add(ins);
      if (!ins.hasAttribute('data-ad-status')) {
        ins.setAttribute('data-ad-status', 'filled');
      }
    }

    const scripts = node.nodeType === 1 && node.localName === 'script' ? [node] :
      [...node.querySelectorAll('script[src]')];
    for (const script of scripts) {
      const src = script.src || '';
      const isHtmlLoad = script.id === 'FAJzZDUKKBt' || src.includes('html-load.com');
      const isAdSense = src.includes('pagead2.googlesyndication.com');
      const isWtg = src.includes('lib.wtg-ads.com');

      if (!isHtmlLoad && !isAdSense && !isWtg) continue;
      if (script.dataset.kioBlockedScript) continue;
      script.dataset.kioBlockedScript = '1';
      script.type = 'application/x-kio-blocked';

      if (isHtmlLoad) {
        // html-load.com attaches malicious confirm() popups to both onload & onerror
        script.onload = null;
        script.onerror = null;
      } else if (isAdSense) {
        // Provide dummy adsbygoogle so J8 onload handler executes smoothly
        window.adsbygoogle = window.adsbygoogle || [];
        window.adsbygoogle.push = function () {};
        setTimeout(() => script.dispatchEvent(new Event('load')), 0);
      } else if (isWtg) {
        // WTG: Dispatching load avoids triggering onerror -> blocked = true
        setTimeout(() => script.dispatchEvent(new Event('load')), 0);
      }
    }
  }

  function wrapMethod(proto, name, prepare) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.configurable) return;
    const original = descriptor.value;
    Object.defineProperty(proto, name, {
      ...descriptor,
      value: function (...args) {
        try { prepare.call(this, args); } catch {}
        return Reflect.apply(original, this, args);
      }
    });
  }
  for (const name of ['appendChild', 'insertBefore', 'replaceChild']) {
    wrapMethod(Node.prototype, name, args => neutralize(args[0]));
  }
  for (const proto of [Element.prototype, Document.prototype, DocumentFragment.prototype]) {
    for (const name of ['append', 'prepend', 'replaceChildren']) {
      wrapMethod(proto, name, args => args.forEach(neutralize));
    }
  }

  // -------------------------------------------------------------------------
  // 3. Shadow DOM Inspector for M8() Sponsor Banner
  // -------------------------------------------------------------------------

  function inspectShadow(root) {
    if (!root || roots.has(root) || root.host?.localName !== 'div') return;
    roots.add(root);
    const check = () => {
      const css = [...root.querySelectorAll('style')].map(s => s.textContent).join('\n');
      if (/:host\s*\{/.test(css) && /position\s*:\s*fixed/.test(css) &&
          /z-index\s*:\s*9999/.test(css) && /pointer-events\s*:\s*none/.test(css) &&
          /overflow\s*:\s*hidden/.test(css) && /box-sizing\s*:\s*border-box/.test(css)) {
        hide(root.host, true);
        watch.disconnect();
        schedule();
      }
    };
    const watch = new MutationObserver(check);
    watch.observe(root, { childList: true, subtree: true, characterData: true });
    check();
    setTimeout(() => watch.disconnect(), 6000);
  }

  const shadowDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'attachShadow');
  if (shadowDescriptor?.configurable && typeof shadowDescriptor.value === 'function') {
    const original = shadowDescriptor.value;
    Object.defineProperty(Element.prototype, 'attachShadow', {
      ...shadowDescriptor,
      value: function (...args) {
        const root = Reflect.apply(original, this, args);
        try { inspectShadow(root); } catch {}
        return root;
      }
    });
  }

  // -------------------------------------------------------------------------
  // 4. Styling & Element Hiding
  // -------------------------------------------------------------------------

  function setStyle(element, property, value) {
    if (element.style.getPropertyValue(property) !== value ||
        element.style.getPropertyPriority(property) !== 'important') {
      element.style.setProperty(property, value, 'important');
    }
  }

  function hide(element, sponsor = false) {
    const attribute = sponsor ? SPONSOR : HIDDEN;
    if (!element.hasAttribute(attribute)) element.setAttribute(attribute, '');
    adElements.add(element);

    if (sponsor) {
      setStyle(element, 'visibility', 'hidden');
      setStyle(element, 'opacity', '0');
      setStyle(element, 'pointer-events', 'none');
    } else {
      // Collapse dimension safely to 0 without breaking offsetParent / visibility hooks
      setStyle(element, 'max-height', '0px');
      setStyle(element, 'height', '0px');
      setStyle(element, 'min-height', '0px');
      setStyle(element, 'overflow', 'hidden');
      setStyle(element, 'opacity', '0');
      setStyle(element, 'pointer-events', 'none');
      setStyle(element, 'margin', '0px');
      setStyle(element, 'padding', '0px');
      setStyle(element, 'border', 'none');
    }
  }

  function ensureCss() {
    if (!document.documentElement || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${HIDDEN}] {
        max-height: 0px !important;
        height: 0px !important;
        min-height: 0px !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
      }
      [${SPONSOR}] {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      [${PASSING}] {
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function visible(element) {
    if (!element.isConnected || element.hidden || element.getAttribute('data-state') === 'closed') return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  // -------------------------------------------------------------------------
  // 5. Modal & Notification Handlers (Anti-Adblock dialog & Donation popup)
  // -------------------------------------------------------------------------

  function handleDialogs() {
    for (const dialog of document.querySelectorAll(DIALOG)) {
      if (!visible(dialog)) continue;

      // Safety check: Never dismiss password modals, file confirmations, or input-bearing dialogs
      if (dialog.querySelector('input, textarea, select, [contenteditable="true"]')) continue;

      const heading = dialog.querySelector('[data-dialog-title], [data-alert-dialog-title], h1, h2, h3');
      const title = heading?.textContent.trim() || '';
      const text = dialog.textContent || '';

      if (!AD_TITLE.test(title) && !AD_TEXT.test(text)) continue;

      // Adblock dialog identified
      dialog.setAttribute(PASSING, '');

      const buttons = [...dialog.querySelectorAll('button')].filter(b => CONFIRM.test(b.textContent.trim()));
      for (const btn of buttons) {
        // Attempt immediate click if enabled, or un-disable and dispatch
        btn.disabled = false;
        for (const attr of ['disabled', 'aria-disabled', 'data-disabled']) {
          btn.removeAttribute(attr);
        }
        btn.click();
      }

      // Also trigger Enter key on dialog to activate Svelte submit binding
      dialog.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
    }

    // Dismiss adblock Sonner toasts
    for (const toast of document.querySelectorAll('[data-sonner-toast]')) {
      const title = toast.querySelector('[data-title]')?.textContent.trim() || '';
      if (AD_TITLE.test(title)) {
        const closeBtn = toast.querySelector('button[data-close-button]');
        if (closeBtn) closeBtn.click();
        else hide(toast);
      }
    }
  }

  function handleDonations() {
    // Hide lifespan meter tooltip button ("Life 96%" / "수명 96%")
    for (const trigger of document.querySelectorAll('button')) {
      if (/^(?:수명|Life)\s*\d+%$/i.test(trigger.textContent.trim())) {
        hide(trigger);
        setStyle(trigger, 'display', 'none');
      }
    }

    // Dismiss Patreon donation tooltips / popovers / dialogs
    for (const popup of document.querySelectorAll('[data-tooltip-content], [data-popover-content], [data-dialog-content]')) {
      if (!visible(popup) || popup.querySelector('input, textarea, select, [contenteditable="true"]')) continue;
      const labels = [...popup.querySelectorAll('h1, h2, h3, h4, p, div, span')]
        .filter(e => e.children.length === 0).map(e => e.textContent.trim());
      if (!labels.some(t => DONATION_TITLE.test(t)) || !popup.querySelector('a[href*="patreon.com/"]')) continue;

      const close = popup.querySelector('button.absolute.-top-4.-right-4, [data-dialog-close], [data-popover-close]');
      if (close && !close.disabled) close.click();
      hide(popup);
      setStyle(popup, 'display', 'none');
    }
  }

  function handleAds() {
    // Hide matched ad elements & containers
    for (const ad of document.querySelectorAll(AD_SELECTOR)) {
      if (ad.hasAttribute('data-vignette-loaded') && ad.getAttribute('aria-hidden') === 'false') {
        vignetteCleanup = true;
      }
      hide(ad);
    }

    for (const ad of document.querySelectorAll(`[${SPONSOR}]`)) {
      hide(ad, true);
    }

    // Detect late-injected closed shadow host containers
    for (const div of document.querySelectorAll('div[class]:empty')) {
      if (div.hasAttribute(SPONSOR)) continue;
      const s = getComputedStyle(div);
      if (s.position === 'fixed' && s.zIndex === '9999' && s.pointerEvents === 'none' &&
          s.overflow === 'hidden' && s.boxSizing === 'border-box' && !div.id) {
        hide(div, true);
      }
    }

    // Google vignette recovery
    if (location.hash === '#google_vignette') vignetteCleanup = true;
    if (!vignetteCleanup || [...document.querySelectorAll(DIALOG)].some(visible)) return;
    if (location.hash === '#google_vignette') {
      history.replaceState(history.state, '', location.pathname + location.search);
    }
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      if (el.getAttribute('aria-hidden') === 'true') el.removeAttribute('aria-hidden');
      for (const prop of ['overflow', 'overflow-x', 'overflow-y']) {
        if (/^(hidden|clip)$/.test(el.style.getPropertyValue(prop))) {
          el.style.removeProperty(prop);
        }
      }
    }
    vignetteCleanup = false;
  }

  // -------------------------------------------------------------------------
  // 6. Scheduling & Lifecycle
  // -------------------------------------------------------------------------

  function flush() {
    timer = null;
    if (!running) return;
    try {
      ensureCss();
      handleDialogs();
      handleDonations();
      handleAds();
    } catch {}
  }

  function schedule() {
    if (running && timer === null) {
      timer = setTimeout(flush, 60);
    }
  }

  function start() {
    running = true;
    observer ||= new MutationObserver(records => {
      let dialogChanged = false;
      for (const record of records) {
        const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (el?.closest?.(DIALOG)) {
          dialogChanged = true;
          break;
        }
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && (node.matches(DIALOG) || node.querySelector(DIALOG))) {
            dialogChanged = true;
            break;
          }
        }
        if (dialogChanged) break;
      }

      if (running && dialogChanged) {
        try {
          ensureCss();
          handleDialogs();
        } catch {}
      }
      schedule();
    });

    observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'disabled', 'aria-disabled', 'data-disabled',
        'data-state', 'style', 'class', 'aria-hidden',
        'data-vignette-loaded', 'src'
      ]
    });
    schedule();
  }

  window.addEventListener('pagehide', () => {
    running = false;
    observer?.disconnect();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  });
  window.addEventListener('pageshow', start);
  window.addEventListener('hashchange', schedule);
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
  start();
})();
