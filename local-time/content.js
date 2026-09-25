(() => {
  "use strict";

  const resolver = globalThis.LTResolver;
  const DEBUG = false;
  const CACHE_PREFIX = "lt-location-cache-v2:";
  const OVERRIDE_PREFIX = "lt-location-override-v2:";
  const LEGACY_CACHE_KEY = "lt-location-cache-v1";
  const LEGACY_OVERRIDES_KEY = "lt-location-overrides-v1";
  const COOLDOWN_KEY = "lt-lookup-cooldown-until-v1";
  const FOUND_TTL = 30 * 24 * 60 * 60 * 1000;
  const FAILED_TTL = 24 * 60 * 60 * 1000;
  const LOOKUP_TIMEOUT = 10 * 1000;
  const LOOKUP_COOLDOWN = 60 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 500;
  const PILL_CLASS = "lt-local-time-pill";
  const SHADOW_STYLE_ID = "lt-local-time-shadow-styles";
  const LOG = "[LocalTime]";
  const SHADOW_PILL_CSS = `
.lt-local-time-pill {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
  padding: 3px 9px;
  border: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.07);
  color: currentColor;
  font: 600 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  white-space: nowrap;
  cursor: pointer;
}
.lt-local-time-pill:hover { background: rgba(0, 0, 0, 0.12); }
.lt-local-time-pill:focus-visible { outline: 2px solid #0a66c2; outline-offset: 2px; }
.lt-local-time-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: #8c8c8c;
}
.lt-work .lt-local-time-dot { background: #198754; }
.lt-edge .lt-local-time-dot { background: #d97706; }
.lt-night .lt-local-time-dot { background: #7c3aed; }
.lt-loading .lt-local-time-dot,
.lt-unknown .lt-local-time-dot { background: #8c8c8c; }
@media (prefers-color-scheme: dark) {
  .lt-local-time-pill { background: rgba(255, 255, 255, 0.12); }
  .lt-local-time-pill:hover { background: rgba(255, 255, 255, 0.18); }
}`;

  const cache = new Map();
  const overrides = new Map();
  const lookups = new Map();
  const selfPersonIds = new Set();
  const selfNames = new Set();
  const observedDomRoots = new Set();
  const activeConversations = new Map();
  const personIdsByHeaderName = new Map();

  let renderSequence = 0;
  let lastScanSignature = null;
  let scanTimer = null;
  let refreshTimer = null;
  let shadowDiscoveryTimer = null;
  let observer = null;
  let observing = false;
  let stopped = false;
  let cooldownUntil = 0;
  let observedUrl = location.href;

  function debug(method, ...args) {
    if (DEBUG) console[method](...args);
  }

  function isInvalidContextError(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function runtimeError() {
    const error = chrome.runtime?.lastError;
    return error ? new Error(error.message || String(error)) : null;
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, (value) => {
          const error = runtimeError();
          if (error) reject(error);
          else resolve(value || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(value, () => {
          const error = runtimeError();
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageRemove(keys) {
    if (!keys.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.remove(keys, () => {
          const error = runtimeError();
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function keyFor(prefix, personId) {
    return `${prefix}${encodeURIComponent(personId)}`;
  }

  function personIdFromKey(key, prefix) {
    if (!key.startsWith(prefix)) return null;
    try {
      return decodeURIComponent(key.slice(prefix.length));
    } catch {
      return null;
    }
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function linkedInDomRoots() {
    const roots = [document];
    const interopShadowRoot = document.querySelector("#interop-outlet")?.shadowRoot;
    if (interopShadowRoot) roots.push(interopShadowRoot);
    return roots;
  }

  function queryAll(selector) {
    return linkedInDomRoots().flatMap((root) => [...root.querySelectorAll(selector)]);
  }

  function ensureShadowStyles(root) {
    if (!(root instanceof ShadowRoot) || root.querySelector(`#${SHADOW_STYLE_ID}`)) return;
    const style = document.createElement("style");
    style.id = SHADOW_STYLE_ID;
    style.textContent = SHADOW_PILL_CSS;
    root.prepend(style);
  }

  function observeLinkedInRoots() {
    if (!observer || !observing || !document.body) return false;
    const targets = linkedInDomRoots().map((root) => root === document ? document.body : root);
    const unchanged = targets.length === observedDomRoots.size
      && targets.every((target) => observedDomRoots.has(target));
    if (unchanged) return false;

    observer.disconnect();
    observedDomRoots.clear();
    for (const target of targets) {
      if (target instanceof ShadowRoot) ensureShadowStyles(target);
      observer.observe(target, { childList: true, subtree: true });
      observedDomRoots.add(target);
    }
    return true;
  }

  function clearShadowDiscoveryTimer() {
    if (!shadowDiscoveryTimer) return;
    clearInterval(shadowDiscoveryTimer);
    shadowDiscoveryTimer = null;
  }

  // LinkedIn attaches the #interop-outlet shadow root after its host is already
  // in the document. That attachment does not produce a light-DOM mutation, so
  // briefly poll for the root, then stop as soon as it can be observed.
  function syncShadowDiscoveryTimer() {
    if (stopped || !observing || document.hidden) {
      clearShadowDiscoveryTimer();
      return;
    }
    if (document.querySelector("#interop-outlet")?.shadowRoot) {
      clearShadowDiscoveryTimer();
      return;
    }
    if (shadowDiscoveryTimer) return;
    shadowDiscoveryTimer = setInterval(() => {
      if (stopped || !observing || document.hidden) {
        clearShadowDiscoveryTimer();
        return;
      }
      const rootsChanged = observeLinkedInRoots();
      if (rootsChanged) scheduleScan();
      if (document.querySelector("#interop-outlet")?.shadowRoot) clearShadowDiscoveryTimer();
    }, 500);
  }

  function personIdFromHref(href) {
    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return null;
      const match = url.pathname.match(/^\/in\/([^/]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function removePills(exceptPills) {
    const keep = exceptPills instanceof Set
      ? exceptPills
      : new Set(exceptPills ? [exceptPills] : []);
    queryAll(`.${PILL_CLASS}`).forEach((pill) => {
      if (!keep.has(pill)) pill.remove();
    });
  }

  function cancelLookupsExcept(personIds, reason) {
    const keep = personIds instanceof Set
      ? personIds
      : new Set(personIds ? [personIds] : []);
    for (const [lookupPersonId, lookup] of lookups) {
      if (!keep.has(lookupPersonId) && !lookup.controller.signal.aborted) {
        lookup.controller.abort(reason);
      }
    }
  }

  function cancelAllLookups(reason) {
    cancelLookupsExcept(null, reason);
  }

  function stopForInvalidContext() {
    if (stopped) return;
    stopped = true;
    observing = false;
    observer?.disconnect();
    observedDomRoots.clear();
    clearTimeout(scanTimer);
    clearInterval(refreshTimer);
    clearShadowDiscoveryTimer();
    scanTimer = null;
    refreshTimer = null;
    activeConversations.clear();
    cancelAllLookups("extension-context-invalidated");
    removePills();
  }

  function handleError(error, message = "Unexpected error.") {
    if (isInvalidContextError(error)) {
      stopForInvalidContext();
      return;
    }
    debug("warn", `${LOG} ${message}`, error);
  }

  function hasValidContext() {
    try {
      chrome.runtime.getManifest();
      return true;
    } catch (error) {
      handleError(error);
      return false;
    }
  }

  // DOMParser creates an inert document: scripts do not run and subresources are
  // not loaded. Only textContent and a fixed contact-link selector are read.
  function locationFromProfileHtml(html) {
    const profile = new DOMParser().parseFromString(html, "text/html");
    const contacts = profile.querySelectorAll('a[href$="/overlay/contact-info/"]');

    for (const contact of contacts) {
      const contactParagraph = contact.closest("p");
      const parent = contactParagraph?.parentElement;
      if (!parent) continue;

      let sibling = contactParagraph.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === "P") {
          const candidate = clean(sibling.textContent);
          if (candidate && candidate !== "·" && candidate.length <= 120) return candidate;
        }
        sibling = sibling.previousElementSibling;
      }
    }
    return null;
  }

  class LookupBlockedError extends Error {}

  function isAuthRedirect(response, requestedUrl) {
    if (!response.redirected || response.url === requestedUrl) return false;
    try {
      const finalUrl = new URL(response.url);
      if (finalUrl.origin !== location.origin) return true;
      return /^\/(?:login|uas|checkpoint|authwall|challenge)(?:\/|$)/i.test(finalUrl.pathname);
    } catch {
      return true;
    }
  }

  function beginLookupCooldown(reason) {
    const nextCooldown = Date.now() + LOOKUP_COOLDOWN;
    cooldownUntil = Math.max(cooldownUntil, nextCooldown);
    cancelAllLookups("lookup-cooldown");
    storageSet({ [COOLDOWN_KEY]: cooldownUntil }).catch((error) => {
      handleError(error, "Could not persist the profile-lookup cooldown.");
    });
    debug("warn", `${LOG} Pausing profile lookups for one hour.`, reason);
  }

  async function fetchLocation(personId, controller) {
    const requestedUrl = new URL(`/in/${encodeURIComponent(personId)}/`, location.origin).href;
    const timeout = setTimeout(() => controller.abort("timeout"), LOOKUP_TIMEOUT);
    try {
      const response = await fetch(requestedUrl, {
        credentials: "include",
        signal: controller.signal,
      });

      if (response.status === 403 || response.status === 429 || isAuthRedirect(response, requestedUrl)) {
        beginLookupCooldown({ status: response.status, finalUrl: response.url });
        throw new LookupBlockedError("LinkedIn blocked or redirected the profile lookup.");
      }
      if (!response.ok) throw new Error(`Profile fetch returned HTTP ${response.status}`);

      const html = await response.text();
      const found = locationFromProfileHtml(html);
      debug("info", `${LOG} profile fetch result`, { personId, status: response.status, location: found });
      return found;
    } finally {
      clearTimeout(timeout);
    }
  }

  function validCacheEntry(entry) {
    return entry && typeof entry === "object"
      && (typeof entry.location === "string" || entry.location === null)
      && Number.isFinite(entry.expiresAt);
  }

  function cachedLocation(personId) {
    const entry = cache.get(personId);
    if (!entry) return null;
    if (entry.expiresAt > Date.now()) return entry;
    cache.delete(personId);
    storageRemove([keyFor(CACHE_PREFIX, personId)]).catch((error) => {
      handleError(error, "Could not remove an expired cache entry.");
    });
    return null;
  }

  async function pruneCache() {
    const now = Date.now();
    const removals = [];
    for (const [personId, entry] of cache) {
      if (!validCacheEntry(entry) || entry.expiresAt <= now) {
        cache.delete(personId);
        removals.push(keyFor(CACHE_PREFIX, personId));
      }
    }

    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = [...cache.entries()]
        .sort(([, a], [, b]) => (a.storedAt || 0) - (b.storedAt || 0))
        .slice(0, cache.size - MAX_CACHE_ENTRIES);
      for (const [personId] of oldest) {
        cache.delete(personId);
        removals.push(keyFor(CACHE_PREFIX, personId));
      }
    }
    await storageRemove(removals);
  }

  async function storeCacheEntry(personId, locationName) {
    const entry = {
      personId,
      location: locationName,
      expiresAt: Date.now() + (locationName ? FOUND_TTL : FAILED_TTL),
      storedAt: Date.now(),
    };
    cache.set(personId, entry);
    try {
      await storageSet({ [keyFor(CACHE_PREFIX, personId)]: entry });
      await pruneCache();
    } catch (error) {
      handleError(error, "Could not persist a profile-location result.");
    }
  }

  async function locationFor(personId) {
    const manual = overrides.get(personId);
    if (manual) return { location: manual, manual: true };

    const current = cachedLocation(personId);
    if (current) return { location: current.location, manual: false };
    if (cooldownUntil > Date.now()) return { location: null, manual: false, blocked: true };
    if (lookups.has(personId)) return lookups.get(personId).promise;

    const controller = new AbortController();
    const promise = (async () => {
      let locationName = null;
      try {
        locationName = await fetchLocation(personId, controller);
        if (!locationName) {
          debug("warn", `${LOG} The fetched profile did not contain a location next to Contact info.`, { personId });
        }
      } catch (error) {
        if (error instanceof LookupBlockedError || controller.signal.reason === "lookup-cooldown") {
          return { location: null, manual: false, blocked: true };
        }
        if (controller.signal.aborted && controller.signal.reason !== "timeout") {
          return { location: null, manual: false, cancelled: true };
        }
        debug("warn", `${LOG} Profile lookup failed.`, { personId, error });
      }

      await storeCacheEntry(personId, locationName);
      return { location: locationName, manual: false };
    })().finally(() => lookups.delete(personId));

    lookups.set(personId, { controller, promise });
    return promise;
  }

  function zonedParts(timeZone, date = new Date()) {
    const parts = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(date).forEach(({ type, value }) => { parts[type] = value; });
    return parts;
  }

  function offsetMinutes(timeZone, date = new Date()) {
    const part = zonedParts(timeZone, date);
    const representedAsUtc = Date.UTC(
      Number(part.year),
      Number(part.month) - 1,
      Number(part.day),
      Number(part.hour),
      Number(part.minute),
      Number(part.second),
    );
    return Math.round((representedAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  }

  function differenceText(timeZone) {
    const difference = offsetMinutes(timeZone) - -new Date().getTimezoneOffset();
    if (difference === 0) return "same time as you";
    const absolute = Math.abs(difference);
    const hours = Math.floor(absolute / 60);
    const minutes = absolute % 60;
    const amount = [hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(" ");
    return `${amount} ${difference > 0 ? "ahead of" : "behind"} you`;
  }

  function timeText(timeZone) {
    return new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date());
  }

  function dayStatus(timeZone) {
    const part = zonedParts(timeZone);
    const hour = Number(part.hour);
    const weekend = part.weekday === "Sat" || part.weekday === "Sun";
    if (weekend) return { className: "edge", label: "Weekend" };
    if (hour >= 9 && hour < 18) return { className: "work", label: "Working hours" };
    if ((hour >= 6 && hour < 9) || (hour >= 18 && hour < 21)) {
      return { className: "edge", label: hour < 9 ? "Early morning" : "Evening" };
    }
    return { className: "night", label: "Late night" };
  }

  function viewFor(locationName, manual) {
    if (!locationName) {
      return { className: "unknown", text: "Set location", tooltip: "Location unavailable. Click to enter their city or time zone." };
    }

    const result = resolver.resolve(locationName);
    if (!result) {
      return { className: "unknown", text: "Set location", tooltip: `${locationName}\nTime zone not recognized. Click to correct it.` };
    }

    const source = manual ? " (set by you)" : "";
    if (result.tz) {
      const status = dayStatus(result.tz);
      const approximation = result.approximate ? "\napproximate" : "";
      return {
        className: status.className,
        text: timeText(result.tz),
        tooltip: `${locationName}${source}\n${result.tz}${approximation}\n${differenceText(result.tz)} · ${status.label}`,
      };
    }

    const zones = result.zones || [];
    const statuses = zones.map(dayStatus);
    const className = statuses.length && statuses.every((status) => status.className === statuses[0].className)
      ? statuses[0].className
      : "edge";
    const times = [...new Set(zones.map(timeText))];
    const details = zones.map((zone) => `${zone}: ${differenceText(zone)}`).join("\n");
    return {
      className,
      text: times.join("–"),
      tooltip: `${locationName}${source}\n${details}\nClick to enter a city for an exact time.`,
    };
  }

  function setPillView(pill, view) {
    const key = `${view.className}\n${view.text}\n${view.tooltip}`;
    if (pill.dataset.viewKey === key) return;
    pill.dataset.viewKey = key;
    pill.className = `${PILL_CLASS} lt-${view.className}`;
    pill.title = view.tooltip;
    pill.setAttribute("aria-label", `${view.text}. ${view.tooltip.replaceAll("\n", ". ")}`);
    const text = pill.querySelector(".lt-local-time-text");
    if (text.textContent !== view.text) text.textContent = view.text;
  }

  async function editLocation(personId) {
    const existing = overrides.get(personId) || cache.get(personId)?.location || "";
    const entered = window.prompt("Enter their city or IANA time zone (for example: Austin, Texas or Asia/Tokyo):", existing);
    if (entered === null) return;

    const locationName = clean(entered);
    if (!locationName || !resolver.resolve(locationName)) {
      window.alert("That location was not recognized. Try adding the state/country, or use a time zone such as Asia/Tokyo.");
      return;
    }

    const previous = overrides.get(personId);
    overrides.set(personId, locationName);
    scheduleScan();
    try {
      await storageSet({ [keyFor(OVERRIDE_PREFIX, personId)]: { personId, location: locationName } });
    } catch (error) {
      if (previous) overrides.set(personId, previous);
      else overrides.delete(personId);
      handleError(error, "Could not save the manual location.");
      if (!stopped) window.alert("The manual location could not be saved. Please reload the extension and try again.");
      scheduleScan();
    }
  }

  function ensurePill(anchor, container, personId) {
    const existingPills = [...container.querySelectorAll(`.${PILL_CLASS}`)];
    existingPills
      .filter((candidate) => candidate.dataset.personId !== personId)
      .forEach((candidate) => candidate.remove());
    let pill = existingPills
      .find((candidate) => candidate.dataset.personId === personId && candidate.isConnected);
    if (!pill) {
      pill = document.createElement("button");
      pill.type = "button";
      pill.className = `${PILL_CLASS} lt-loading`;
      pill.innerHTML = '<span class="lt-local-time-dot" aria-hidden="true"></span><span class="lt-local-time-text">…</span>';
      pill.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        editLocation(pill.dataset.personId);
      });
    }
    pill.dataset.personId = personId;
    if (anchor.nextElementSibling !== pill) anchor.insertAdjacentElement("afterend", pill);
    return pill;
  }

  function isVisible(element) {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function visibleConversationPane() {
    const panes = queryAll([
      ".scaffold-layout__detail.msg__detail",
      ".msg__detail",
      '[data-view-name="message-thread-detail"]',
    ].join(",")).filter((pane) => isVisible(pane)
      && [...pane.querySelectorAll(".msg-title-bar, .shared-title-bar")].some(isVisible));
    return panes.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return (bRect.width * bRect.height) - (aRect.width * aRect.height);
    })[0] || null;
  }

  const OVERLAY_ROOT_SELECTOR = [
    ".msg-overlay-conversation-bubble",
    ".msg-overlay-compose-bubble",
    ".msg-overlay-bubble",
    ".msg-convo-wrapper",
    '[data-view-name*="message-overlay"]',
    '[data-view-name*="conversation-bubble"]',
    '[role="dialog"][class*="msg-overlay"]',
  ].join(",");

  const MESSAGE_COMPOSER_SELECTOR = [
    ".msg-form__contenteditable",
    '[contenteditable="true"][data-placeholder*="message" i]',
    '[contenteditable="true"][aria-label*="message" i]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[placeholder*="message" i]',
    '[role="textbox"][aria-label*="message" i]',
  ].join(",");

  const OVERLAY_MUTATION_SELECTOR = [
    ".msg-overlay-container",
    ".msg-overlay-list-bubble",
    ".msg-overlay-conversation-bubble",
    ".msg-overlay-compose-bubble",
    ".msg-overlay-bubble",
    ".msg-convo-wrapper",
    '[data-view-name*="message-overlay"]',
    '[data-view-name*="conversation-bubble"]',
    '[class*="msg-overlay"]',
  ].join(",");

  function normalizedPersonName(value) {
    return clean(value)
      .replace(/^(?:view\s+)?(?:the\s+)?profile\s+(?:of\s+)?/i, "")
      .replace(/\s+(?:profile|photo)$/i, "")
      .toLocaleLowerCase();
  }

  function refreshSelfPersonIds(pane) {
    const navSelectors = [
      '.global-nav__me a[href*="/in/"]',
      'a.global-nav__primary-link-me[href*="/in/"]',
      '[data-view-name="nav-profile"] a[href*="/in/"]',
      '[data-test-id="nav-me"] a[href*="/in/"]',
      'a[data-test-global-nav-link="profile"][href*="/in/"]',
    ];
    queryAll(navSelectors.join(",")).forEach((link) => {
      const personId = personIdFromHref(link.href);
      if (personId) selfPersonIds.add(personId);
    });

    queryAll([
      ".global-nav__me-photo[alt]",
      '[data-view-name="nav-profile"] img[alt]',
      '[data-test-id="nav-me"] img[alt]',
    ].join(",")).forEach((element) => {
      const name = normalizedPersonName(element.getAttribute("alt"));
      if (name) selfNames.add(name);
    });

    if (!selfNames.size) return;
    pane.querySelectorAll('a[href*="/in/"]').forEach((link) => {
      const labels = [
        link.textContent,
        link.getAttribute("aria-label"),
        link.getAttribute("title"),
        link.querySelector("img[alt]")?.getAttribute("alt"),
      ].map(normalizedPersonName).filter(Boolean);
      if (!labels.some((label) => selfNames.has(label))) return;
      const personId = personIdFromHref(link.href);
      if (personId) selfPersonIds.add(personId);
    });
  }

  function pageConversation() {
    if (!isMessagingPage()) return null;
    const pane = visibleConversationPane();
    if (!pane) return null;
    refreshSelfPersonIds(pane);

    const header = [...pane.querySelectorAll(".msg-title-bar, .shared-title-bar")].find(isVisible);
    if (!header) return null;
    const links = [...header.querySelectorAll('a.msg-thread__link-to-profile[href*="/in/"]')].filter(isVisible);
    const signature = `page|${location.pathname}|${links.map((link) => link.href).join("|")}`;
    if (signature !== lastScanSignature) {
      lastScanSignature = signature;
      debug("info", `${LOG} header scan`, { path: location.pathname, headerProfileLinks: links.length });
    }
    if (links.length !== 1) return null;
    const personId = personIdFromHref(links[0].href);
    if (!personId || selfPersonIds.has(personId)) return null;
    return { anchor: links[0], container: pane, personId };
  }

  function profileIdsFromElement(root) {
    const ids = new Set();
    root.querySelectorAll('a[href*="/in/"]').forEach((link) => {
      const personId = personIdFromHref(link.href);
      if (personId && !selfPersonIds.has(personId)) ids.add(personId);
    });

    const urnElements = [root, ...root.querySelectorAll([
      "[data-entity-urn]",
      "[data-event-urn]",
      "[data-profile-urn]",
      "[data-participant-urn]",
      "[data-urn]",
    ].join(","))];
    for (const element of urnElements) {
      for (const attribute of element.attributes || []) {
        const matches = attribute.value.matchAll(/urn:li:(?:fsd_profile|profile):([A-Za-z0-9_-]+)/g);
        for (const match of matches) {
          if (!selfPersonIds.has(match[1])) ids.add(match[1]);
        }
      }
    }
    return [...ids];
  }

  function pageProfile() {
    const personId = personIdFromHref(location.href);
    if (!personId) return null;
    const nameElement = queryAll([
      "main h1",
      "main .text-heading-xlarge",
      '[data-view-name="profile-card"] h1',
    ].join(",")).find(isVisible);
    const name = normalizedPersonName(nameElement?.textContent);
    return name && !selfNames.has(name) ? { personId, name } : null;
  }

  function elementMatchesName(element, name) {
    const label = normalizedPersonName(element?.textContent);
    return Boolean(label && (label === name || label.startsWith(`${name} `)));
  }

  function overlayAnchor(root, header, profile) {
    const candidates = [...root.querySelectorAll([
      '[class*="msg-compose-form__recipient"]',
      '[data-view-name*="recipient"]',
      ".artdeco-pill",
      ".msg-overlay-bubble-header__title",
      ".msg-overlay-conversation-bubble__title",
      "header h2",
      "header h3",
      '[role="heading"]',
      "h2",
      "h3",
    ].join(","))].filter(isVisible);

    if (profile) {
      const matches = candidates.filter((element) => elementMatchesName(element, profile.name));
      if (matches.length) {
        return matches.sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return (aRect.width * aRect.height) - (bRect.width * bRect.height);
        })[0];
      }
    }

    const recipient = candidates.find((element) => /recipient|artdeco-pill/.test(element.className || ""));
    if (recipient) return recipient;
    return candidates.find((element) => !/^new message$/i.test(clean(element.textContent)))
      || [...header.querySelectorAll("h1, h2, h3, [role=heading], a, button")].find(isVisible)
      || header;
  }

  function profileNameElement(root, profile) {
    if (!profile) return null;
    return [...root.querySelectorAll([
      '[class*="recipient"]',
      '[class*="title"]',
      ".artdeco-pill",
      '[role="heading"]',
      "h1",
      "h2",
      "h3",
      "a",
      "button",
    ].join(","))].find((element) => isVisible(element) && elementMatchesName(element, profile.name)) || null;
  }

  function overlayHeaderName(header) {
    const title = [...header.querySelectorAll([
      ".msg-overlay-bubble-header__title",
      ".msg-overlay-conversation-bubble__title",
      '[class*="header__title"]',
      '[role="heading"]',
      "h1",
      "h2",
      "h3",
    ].join(","))].find((element) => isVisible(element) && clean(element.textContent));
    const profileLink = [...header.querySelectorAll('a[href*="/in/"]')]
      .find((element) => isVisible(element) && clean(element.textContent));
    return normalizedPersonName((title || profileLink)?.textContent);
  }

  function rememberPersonId(headerName, personId) {
    if (!headerName || !personId) return;
    const remembered = personIdsByHeaderName.get(headerName);
    if (remembered === undefined || remembered === personId) {
      personIdsByHeaderName.set(headerName, personId);
    } else {
      personIdsByHeaderName.set(headerName, null);
    }
  }

  function overlayRootForComposer(composer, profile) {
    const composerRect = composer.getBoundingClientRect();
    let fallback = null;
    for (let element = composer.parentElement; element && element !== document.body; element = element.parentElement) {
      if (!isVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 280 || rect.height < 180) continue;

      if (!fallback && (element.matches(OVERLAY_ROOT_SELECTOR) || element.matches('[role="dialog"]'))) {
        fallback = element;
      }

      const nameElement = profileNameElement(element, profile);
      if (nameElement && nameElement.getBoundingClientRect().top < composerRect.top) return element;

      const title = [...element.querySelectorAll("h1, h2, h3, [role=heading]")]
        .find((candidate) => isVisible(candidate) && candidate.getBoundingClientRect().top < composerRect.top);
      const overlayControl = [...element.querySelectorAll("button[aria-label], [role=button][aria-label]")]
        .some((control) => /close|dismiss|minimi[sz]e|collapse|expand/i.test(control.getAttribute("aria-label") || ""));
      if (title && overlayControl) return element;
    }
    return fallback;
  }

  function visibleMessageOverlays(profile) {
    const roots = new Set(queryAll(OVERLAY_ROOT_SELECTOR));
    queryAll(MESSAGE_COMPOSER_SELECTOR).forEach((composer) => {
      if (!isVisible(composer)) return;
      const root = overlayRootForComposer(composer, profile);
      if (root) roots.add(root);
    });

    return [...roots]
      .filter((root) => isVisible(root)
        && root.getBoundingClientRect().height > 40)
      .sort((a, b) => {
        const composerA = a.querySelector(MESSAGE_COMPOSER_SELECTOR) ? 1 : 0;
        const composerB = b.querySelector(MESSAGE_COMPOSER_SELECTOR) ? 1 : 0;
        if (composerA !== composerB) return composerB - composerA;
        const activeA = /is-active|active/.test(a.className) ? 1 : 0;
        const activeB = /is-active|active/.test(b.className) ? 1 : 0;
        if (activeA !== activeB) return activeB - activeA;
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return (bRect.width * bRect.height) - (aRect.width * aRect.height);
      });
  }

  function overlayConversations() {
    refreshSelfPersonIds(document);
    const profile = pageProfile();
    const conversations = [];
    const signatures = [];
    for (const root of visibleMessageOverlays(profile)) {
      refreshSelfPersonIds(root);
      const knownHeader = [...root.querySelectorAll([
        ".msg-overlay-bubble-header",
        ".msg-overlay-conversation-bubble__header",
        ".msg-overlay-compose-bubble__header",
        'header[class*="msg-overlay"]',
        "header",
      ].join(","))].find(isVisible);

      const ids = profileIdsFromElement(root);
      const headerIds = knownHeader ? profileIdsFromElement(knownHeader) : [];
      const matchedName = profileNameElement(root, profile);
      const matchesProfile = Boolean(matchedName);
      const headerName = overlayHeaderName(knownHeader || root);
      const previous = activeConversations.get(root);
      const previousPersonId = previous && (!headerName || previous.headerName === headerName)
        ? previous.personId
        : null;
      const rootPersonId = root.dataset.ltConversationName === headerName
        ? clean(root.dataset.ltPersonId)
        : null;
      const namedPersonId = personIdsByHeaderName.get(headerName) || null;
      const hasVisibleComposer = [...root.querySelectorAll(MESSAGE_COMPOSER_SELECTOR)].some(isVisible);
      if (headerIds.length > 1) continue;
      const confidentlyDetectedId = matchesProfile
        ? profile.personId
        : (headerIds.length === 1 ? headerIds[0] : null);
      const personId = confidentlyDetectedId
        || previousPersonId
        || rootPersonId
        || namedPersonId
        || (hasVisibleComposer && ids.length === 1 ? ids[0] : null);
      if (!personId || selfPersonIds.has(personId)) continue;
      root.dataset.ltPersonId = personId;
      root.dataset.ltConversationName = headerName;
      rememberPersonId(headerName, personId);

      const header = knownHeader || matchedName?.closest('header, [class*="header"]') || matchedName?.parentElement || root;
      const anchor = overlayAnchor(root, header, profile);
      if (!anchor || anchor === root) continue;
      const duplicate = conversations.some((conversation) => conversation.anchor === anchor
        || (conversation.personId === personId
          && (conversation.container.contains(root) || root.contains(conversation.container))));
      if (duplicate) continue;
      conversations.push({ anchor, container: root, personId, headerName });
      signatures.push(`${personId}|${clean(header.textContent).slice(0, 80)}`);
    }
    const signature = `overlays|${signatures.join("||")}`;
    if (signature !== lastScanSignature) {
      lastScanSignature = signature;
      debug("info", `${LOG} overlay scan`, { conversations: conversations.length });
    }
    return conversations;
  }

  function currentConversations() {
    const conversations = overlayConversations();
    const page = pageConversation();
    if (page && !conversations.some((conversation) => conversation.anchor === page.anchor
      || conversation.container === page.container)) {
      conversations.push(page);
    }
    return conversations;
  }

  function syncRefreshTimer(hasConversation) {
    if (hasConversation && !refreshTimer) refreshTimer = setInterval(refreshPills, 60 * 1000);
    if (!hasConversation && refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  async function renderConversation(conversation, token) {
    const { anchor, container, personId, headerName = "" } = conversation;
    const pill = ensurePill(anchor, container, personId);
    activeConversations.set(container, { anchor, container, personId, headerName, pill, token });

    const manual = overrides.get(personId);
    if (manual) {
      setPillView(pill, viewFor(manual, true));
      return;
    }
    const current = cachedLocation(personId);
    if (current) {
      setPillView(pill, viewFor(current.location, false));
      return;
    }
    if (cooldownUntil > Date.now()) {
      setPillView(pill, viewFor(null, false));
      return;
    }

    setPillView(pill, { className: "loading", text: "…", tooltip: "Looking up their LinkedIn profile location…" });
    const result = await locationFor(personId);
    const active = activeConversations.get(container);
    if (result.cancelled || active?.token !== token || active.personId !== personId
      || active.anchor !== anchor || active.pill !== pill || !pill.isConnected
      || !container.isConnected || !container.contains(pill)) return;
    setPillView(pill, viewFor(result.location, result.manual));
  }

  async function scan() {
    if (stopped || document.hidden) return;
    const conversations = currentConversations();
    syncRefreshTimer(conversations.length > 0);
    if (!conversations.length) {
      activeConversations.clear();
      cancelAllLookups("conversation-changed");
      removePills();
      return;
    }

    const visibleContainers = new Set(conversations.map(({ container }) => container));
    const visiblePersonIds = new Set(conversations.map(({ personId }) => personId));
    cancelLookupsExcept(visiblePersonIds, "conversation-changed");

    for (const [container, active] of activeConversations) {
      if (visibleContainers.has(container)) continue;
      active.pill.remove();
      activeConversations.delete(container);
    }

    const renders = conversations.map((conversation) => (
      renderConversation(conversation, ++renderSequence)
    ));
    const currentPills = new Set([...activeConversations.values()].map(({ pill }) => pill));
    removePills(currentPills);
    await Promise.all(renders);
  }

  function isMessagingPage() {
    return /^\/messaging(?:\/|$)/.test(location.pathname);
  }

  function scheduleScan() {
    if (stopped || !observing || document.hidden || scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (!hasValidContext()) return;
      scan().catch((error) => handleError(error));
    }, 150);
  }

  function refreshPills() {
    if (stopped || document.hidden || !hasValidContext()) return;
    let needsScan = activeConversations.size === 0;
    for (const { personId, pill, container } of activeConversations.values()) {
      if (!pill.isConnected || !container.isConnected || !container.contains(pill)) {
        needsScan = true;
        continue;
      }
      const manual = overrides.get(personId);
      const current = cachedLocation(personId);
      if (!manual && !current) {
        needsScan = true;
        continue;
      }
      setPillView(pill, viewFor(manual || current.location, Boolean(manual)));
    }
    if (needsScan) scheduleScan();
  }

  function suspendActivity(reason, removePill) {
    observing = false;
    observer?.disconnect();
    observedDomRoots.clear();
    clearTimeout(scanTimer);
    clearInterval(refreshTimer);
    clearShadowDiscoveryTimer();
    scanTimer = null;
    refreshTimer = null;
    activeConversations.clear();
    cancelAllLookups(reason);
    if (removePill) removePills();
  }

  function resumeActivity() {
    if (stopped || observing || document.hidden || !document.body) return;
    observing = true;
    observeLinkedInRoots();
    syncShadowDiscoveryTimer();
    scheduleScan();
  }

  function updateActivity() {
    if (stopped || !hasValidContext()) return;
    if (document.hidden) suspendActivity("tab-hidden", false);
    else {
      resumeActivity();
      scheduleScan();
    }
  }

  function onRouteChange() {
    if (stopped) return;
    observedUrl = location.href;
    activeConversations.clear();
    cancelAllLookups("conversation-changed");
    removePills();
    setTimeout(() => {
      updateActivity();
      scheduleScan();
    }, 0);
  }

  function mutationTouchesMessaging(record) {
    const elements = [record.target, ...record.addedNodes, ...record.removedNodes]
      .map((node) => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)
      .filter(Boolean);
    return elements.some((element) => element.matches?.(OVERLAY_MUTATION_SELECTOR)
      || element.closest?.(OVERLAY_MUTATION_SELECTOR)
      || element.querySelector?.(OVERLAY_MUTATION_SELECTOR)
      || element.matches?.(MESSAGE_COMPOSER_SELECTOR)
      || element.closest?.(MESSAGE_COMPOSER_SELECTOR)
      || element.querySelector?.(MESSAGE_COMPOSER_SELECTOR));
  }

  function cachePersonId(key, value) {
    return clean(value?.personId) || personIdFromKey(key, CACHE_PREFIX);
  }

  function overridePersonId(key, value) {
    return clean(value?.personId) || personIdFromKey(key, OVERRIDE_PREFIX);
  }

  function onStorageChanged(changes, area) {
    if (stopped || area !== "local") return;
    for (const [key, change] of Object.entries(changes)) {
      if (key.startsWith(CACHE_PREFIX)) {
        const personId = cachePersonId(key, change.newValue || change.oldValue);
        if (!personId) continue;
        if (validCacheEntry(change.newValue)) cache.set(personId, change.newValue);
        else cache.delete(personId);
      } else if (key.startsWith(OVERRIDE_PREFIX)) {
        const personId = overridePersonId(key, change.newValue || change.oldValue);
        if (!personId) continue;
        const locationName = clean(change.newValue?.location);
        if (locationName) overrides.set(personId, locationName);
        else overrides.delete(personId);
      } else if (key === COOLDOWN_KEY) {
        cooldownUntil = Number(change.newValue) || 0;
        if (cooldownUntil > Date.now()) cancelAllLookups("lookup-cooldown");
      }
    }
    scheduleScan();
  }

  async function loadStorage() {
    const stored = await storageGet(null);
    const writes = {};
    const removals = [LEGACY_CACHE_KEY, LEGACY_OVERRIDES_KEY];

    for (const [key, value] of Object.entries(stored)) {
      if (key.startsWith(CACHE_PREFIX) && validCacheEntry(value)) {
        const personId = cachePersonId(key, value);
        if (personId) cache.set(personId, value);
      } else if (key.startsWith(OVERRIDE_PREFIX)) {
        const personId = overridePersonId(key, value);
        const locationName = clean(value?.location);
        if (personId && locationName) overrides.set(personId, locationName);
      }
    }

    const legacyCache = stored[LEGACY_CACHE_KEY];
    if (legacyCache && typeof legacyCache === "object") {
      for (const [personId, entry] of Object.entries(legacyCache)) {
        if (!personId || cache.has(personId) || !validCacheEntry(entry)) continue;
        const migrated = { personId, ...entry, storedAt: entry.storedAt || Date.now() };
        cache.set(personId, migrated);
        writes[keyFor(CACHE_PREFIX, personId)] = migrated;
      }
    }

    const legacyOverrides = stored[LEGACY_OVERRIDES_KEY];
    if (legacyOverrides && typeof legacyOverrides === "object") {
      for (const [personId, value] of Object.entries(legacyOverrides)) {
        const locationName = clean(value);
        if (!personId || overrides.has(personId) || !locationName) continue;
        overrides.set(personId, locationName);
        writes[keyFor(OVERRIDE_PREFIX, personId)] = { personId, location: locationName };
      }
    }

    cooldownUntil = Number(stored[COOLDOWN_KEY]) || 0;
    if (cooldownUntil && cooldownUntil <= Date.now()) {
      cooldownUntil = 0;
      removals.push(COOLDOWN_KEY);
    }

    if (Object.keys(writes).length) await storageSet(writes);
    await pruneCache();
    await storageRemove(removals);
  }

  async function start() {
    if (!resolver?.resolve) {
      debug("error", `${LOG} tz-data.js did not load.`);
      return;
    }
    try {
      await loadStorage();
    } catch (error) {
      if (isInvalidContextError(error)) return stopForInvalidContext();
      debug("warn", `${LOG} Could not load saved data; continuing without it.`, error);
    }
    if (stopped) return;

    observer = new MutationObserver((records) => {
      const rootsChanged = observeLinkedInRoots();
      syncShadowDiscoveryTimer();
      const routeChanged = location.href !== observedUrl;
      if (routeChanged) onRouteChange();
      if (!rootsChanged && !routeChanged && !isMessagingPage() && !records.some(mutationTouchesMessaging)) return;
      let removedConversation = false;
      for (const [container, active] of activeConversations) {
        if (active.pill.isConnected && active.anchor.isConnected && container.isConnected
          && container.contains(active.pill)) continue;
        active.pill.remove();
        activeConversations.delete(container);
        removedConversation = true;
      }
      if (removedConversation) {
        const visiblePersonIds = new Set(
          [...activeConversations.values()].map(({ personId }) => personId),
        );
        cancelLookupsExcept(visiblePersonIds, "conversation-changed");
      }
      scheduleScan();
    });
    chrome.storage.onChanged.addListener(onStorageChanged);
    document.addEventListener("visibilitychange", updateActivity);
    window.addEventListener("popstate", onRouteChange);
    window.addEventListener("hashchange", onRouteChange);
    window.addEventListener("pageshow", onRouteChange);
    window.navigation?.addEventListener("navigate", onRouteChange);
    window.navigation?.addEventListener("navigatesuccess", updateActivity);
    updateActivity();
    debug("info", `${LOG} content script loaded`, { path: location.pathname });
  }

  start().catch((error) => handleError(error, "Failed to start."));
})();
