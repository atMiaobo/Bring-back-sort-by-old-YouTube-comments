(() => {
  'use strict';

  const STATE = {
    sortMode: null,
    commentObserver: null,
    resortTimer: null,
    lastContainer: null,
    loadingAll: false,
    stopLoading: false,
    statusEl: null,
    statusTimer: null,
    lastLoadContainer: null,
    loadCompletedFor: null,
    pageConfig: null,
    pageToken: null,
    pageConfigTs: 0,
    pageTokenTs: 0,
    pageRequestTs: 0,
    pageBridgeInjected: false,
  };

  const LOAD_SETTINGS = {
    mode: 'api',
    apiOrderMode: 'reverse',
    debug: true,
    fallbackToScroll: false,
    apiRetryMs: 500,
    apiRetryMax: 8,
    maxMs: 5 * 60 * 1000,
    maxComments: 10000,
    renderChunkSize: 200,
    renderYieldMs: 16,
    tokenYieldEvery: 1500,
    tokenScanMaxNodes: 15000,
    stableCycles: 4,
    waitMs: 800,
  };

  const STRINGS = {
    oldestLabel: 'Oldest',
    oldestSubtitle: 'Show oldest comments',
    topLabels: ['Top comments', 'Top'],
    newestLabels: ['Newest first', 'Newest'],
  };

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function setDebug(message) {
    if (!LOAD_SETTINGS.debug) {
      return;
    }

    let el = document.getElementById('yt-oldest-debug');
    if (!el) {
      el = document.createElement('div');
      el.id = 'yt-oldest-debug';
      document.body.appendChild(el);
    }

    el.textContent = message || '';
    el.style.display = message ? 'block' : 'none';
  }
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function ensurePageBridge() {
    if (STATE.pageBridgeInjected) {
      return;
    }
    STATE.pageBridgeInjected = true;
    window.addEventListener('message', onPageMessage);
  }

  function onPageMessage(event) {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== 'yt-oldest') {
      return;
    }

    if (data.type === 'config') {
      STATE.pageConfig = data.payload || null;
      STATE.pageConfigTs = Date.now();
      if (STATE.pageConfig && STATE.pageConfig.apiKey) {
        setDebug('API: config ok');
      }
      return;
    }

    if (data.type === 'token') {
      STATE.pageToken = data.payload || null;
      STATE.pageTokenTs = Date.now();
      if (STATE.pageToken) {
        setDebug('API: token ok');
      }
      return;
    }

    if (data.type === 'error') {
      setDebug('API: page error');
    }
  }

  function injectPageScript() {
    const script = document.createElement('script');
    script.textContent = `(${function () {
      try {
        function getConfig() {
          const ytcfg = window.ytcfg;
          if (ytcfg && typeof ytcfg.get === 'function') {
            return {
              apiKey: ytcfg.get('INNERTUBE_API_KEY'),
              context: ytcfg.get('INNERTUBE_CONTEXT'),
              clientName: ytcfg.get('INNERTUBE_CLIENT_NAME'),
              clientVersion: ytcfg.get('INNERTUBE_CLIENT_VERSION'),
              visitorData: ytcfg.get('VISITOR_DATA'),
              pageCl: ytcfg.get('PAGE_CL'),
              pageLabel: ytcfg.get('PAGE_BUILD_LABEL'),
              authUser: ytcfg.get('SESSION_INDEX'),
              origin: location.origin,
            };
          }
          const data = ytcfg && ytcfg.data_ ? ytcfg.data_ : null;
          if (data) {
            return {
              apiKey: data.INNERTUBE_API_KEY,
              context: data.INNERTUBE_CONTEXT,
              clientName: data.INNERTUBE_CLIENT_NAME,
              clientVersion: data.INNERTUBE_CLIENT_VERSION,
              visitorData: data.VISITOR_DATA,
              pageCl: data.PAGE_CL,
              pageLabel: data.PAGE_BUILD_LABEL,
              authUser: data.SESSION_INDEX,
              origin: location.origin,
            };
          }
          return null;
        }

        function getCommentSectionData() {
          const el = document.querySelector('ytd-comments');
          if (!el) {
            return null;
          }
          return el.data || (el.__data && el.__data.data) || el.__data || null;
        }

        function getContinuationTokenFromNode(node) {
          if (!node || typeof node !== 'object') {
            return null;
          }
          if (node.continuationEndpoint && node.continuationEndpoint.continuationCommand) {
            return node.continuationEndpoint.continuationCommand.token || null;
          }
          if (node.continuations && Array.isArray(node.continuations)) {
            for (let i = 0; i < node.continuations.length; i += 1) {
              const token = getContinuationTokenFromNode(node.continuations[i]);
              if (token) {
                return token;
              }
            }
          }
          if (node.nextContinuationData && node.nextContinuationData.continuation) {
            return node.nextContinuationData.continuation;
          }
          if (node.reloadContinuationData && node.reloadContinuationData.continuation) {
            return node.reloadContinuationData.continuation;
          }
          return null;
        }

        function findToken(root) {
          if (!root || typeof root !== 'object') {
            return null;
          }
          const queue = [root];
          const seen = new WeakSet();
          let seenCount = 0;
          const limit = 15000;
          while (queue.length) {
            const node = queue.shift();
            if (!node || typeof node !== 'object') {
              continue;
            }
            if (seen.has(node)) {
              continue;
            }
            seen.add(node);

            const token = getContinuationTokenFromNode(node);
            if (token) {
              return token;
            }

            seenCount += 1;
            if (seenCount > limit) {
              break;
            }

            if (Array.isArray(node)) {
              for (let i = 0; i < node.length; i += 1) {
                queue.push(node[i]);
              }
            } else {
              const values = Object.values(node);
              for (let i = 0; i < values.length; i += 1) {
                queue.push(values[i]);
              }
            }
          }
          return null;
        }

        const config = getConfig();
        const token = findToken(getCommentSectionData());

        window.postMessage({ source: 'yt-oldest', type: 'config', payload: config }, '*');
        window.postMessage({ source: 'yt-oldest', type: 'token', payload: token }, '*');
      } catch (err) {
        window.postMessage({
          source: 'yt-oldest',
          type: 'error',
          message: String((err && err.message) || err),
        }, '*');
      }
    }})();`;

    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  async function requestPageData() {
    ensurePageBridge();
    const now = Date.now();
    if (STATE.pageRequestTs && now - STATE.pageRequestTs < 250) {
      await wait(0);
      return;
    }
    STATE.pageRequestTs = now;
    injectPageScript();
    await wait(0);
  }

  function findSortMenuRenderer() {
    return (
      document.querySelector('ytd-comment-sort-menu-renderer') ||
      document.querySelector('ytd-comments-header-renderer #sort-menu') ||
      document.querySelector('ytd-comments-header-renderer yt-dropdown-menu')
    );
  }

  function attachSortMenuListener() {
    const renderer = findSortMenuRenderer();
    if (!renderer || renderer.dataset.oldestHooked === 'true') {
      return;
    }

    renderer.dataset.oldestHooked = 'true';
    renderer.addEventListener(
      'click',
      () => {
        setTimeout(() => {
          const listbox = findSortMenuListbox();
          if (listbox) {
            ensureOldestMenuItem(listbox);
            attachListboxListener(listbox);
          }
        }, 0);
      },
      true
    );
  }

  function findSortMenuListbox() {
    const dropdown = document.querySelector(
      'tp-yt-iron-dropdown[opened], tp-yt-iron-dropdown[aria-hidden="false"]'
    );
    if (dropdown) {
      const listbox = dropdown.querySelector('tp-yt-paper-listbox');
      if (listbox && isSortListbox(listbox)) {
        return listbox;
      }
    }

    const header = document.querySelector('ytd-comments-header-renderer');
    if (header) {
      const listbox = header.querySelector('tp-yt-paper-listbox#menu');
      if (listbox && isSortListbox(listbox)) {
        return listbox;
      }
    }

    const listboxes = Array.from(document.querySelectorAll('tp-yt-paper-listbox'));
    return listboxes.find(isSortListbox) || null;
  }

  function getMenuItemRoots(listbox) {
    if (!listbox) {
      return [];
    }

    const anchors = Array.from(listbox.querySelectorAll('a.yt-simple-endpoint'));
    if (anchors.length) {
      return anchors;
    }

    const renderers = Array.from(listbox.querySelectorAll('ytd-menu-service-item-renderer'));
    if (renderers.length) {
      return renderers;
    }

    return Array.from(listbox.querySelectorAll('tp-yt-paper-item'));
  }

  function getMenuItemLabel(root) {
    if (!root) {
      return '';
    }

    const labelEl =
      root.querySelector('yt-formatted-string') ||
      root.querySelector('.item') ||
      root.querySelector('#label');
    if (labelEl) {
      return normalizeText(labelEl.textContent);
    }

    return normalizeText(root.textContent);
  }

  function labelMatches(label, candidates) {
    const target = normalizeText(label).toLowerCase();
    return candidates.some((candidate) => target === candidate.toLowerCase());
  }

  function isSortListbox(listbox) {
    const labels = getMenuItemRoots(listbox)
      .map(getMenuItemLabel)
      .map((label) => label.toLowerCase());
    if (!labels.length) {
      return false;
    }

    const hasTop = STRINGS.topLabels.some((label) => labels.includes(label.toLowerCase()));
    const hasNewest = STRINGS.newestLabels.some((label) =>
      labels.includes(label.toLowerCase())
    );
    return hasTop && hasNewest;
  }

  function attachListboxListener(listbox) {
    if (listbox.dataset.oldestListened === 'true') {
      return;
    }

    listbox.dataset.oldestListened = 'true';
    listbox.addEventListener(
      'click',
      (event) => {
        const root = event.target.closest(
          'a.yt-simple-endpoint, ytd-menu-service-item-renderer, tp-yt-paper-item'
        );
        if (!root) {
          return;
        }

        const label = getMenuItemLabel(root);
        if (labelMatches(label, STRINGS.topLabels) || labelMatches(label, STRINGS.newestLabels)) {
          resetOldestMode();
        }
      },
      true
    );
  }

  function resetOldestMode() {
    STATE.sortMode = null;
    stopLoadingAll();
    restoreOriginalComments();
  }

  function ensureOldestMenuItem(listbox) {
    if (listbox.querySelector('[data-oldest-item="true"]')) {
      return;
    }

    const newestItem = findMenuItemByText(listbox, STRINGS.newestLabels);
    const roots = getMenuItemRoots(listbox);
    const template = newestItem || roots[0];
    if (!template) {
      return;
    }

    const item = template.cloneNode(true);
    tagMenuItem(item);
    clearSelectedState(item);
    removeServiceEndpoints(item);
    updateMenuItemText(item);

    const clickHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const clickedNewest = clickNewestOption(listbox);
      setSortModeOldest();
      markMenuSelected(listbox, item);
      closeOpenMenu();

      if (clickedNewest) {
        setTimeout(() => {
          const container = findCommentContainer();
          if (container) {
            loadAllComments(container);
          }
        }, 600);
      }
    };

    item.addEventListener('click', clickHandler, true);
    const innerItem = item.querySelector('tp-yt-paper-item');
    if (innerItem) {
      innerItem.addEventListener('click', clickHandler, true);
    }

    if (template.parentNode) {
      template.parentNode.insertBefore(item, template.nextSibling);
    } else {
      listbox.appendChild(item);
    }

    if (STATE.sortMode === 'oldest') {
      markMenuSelected(listbox, item);
    }
  }

  function tagMenuItem(item) {
    item.setAttribute('data-oldest-item', 'true');
    const paper = item.querySelector('tp-yt-paper-item');
    if (paper) {
      paper.setAttribute('data-oldest-item', 'true');
    }
  }

  function clearSelectedState(item) {
    item.removeAttribute('aria-selected');
    item.removeAttribute('data-selected');
    if (item.classList) {
      item.classList.remove('iron-selected');
    }
    const paper = item.querySelector('tp-yt-paper-item');
    if (paper) {
      paper.removeAttribute('data-selected');
    }
  }

  function removeServiceEndpoints(item) {
    item.removeAttribute('href');
    item.removeAttribute('data-command');
    item.removeAttribute('service-endpoint');

    const endpoints = item.querySelectorAll('[service-endpoint]');
    endpoints.forEach((el) => el.removeAttribute('service-endpoint'));

    const links = item.querySelectorAll('[href]');
    links.forEach((el) => el.removeAttribute('href'));
  }

  function updateMenuItemText(item) {
    const labelEl =
      item.querySelector('.item') ||
      item.querySelector('yt-formatted-string') ||
      item.querySelector('#label');
    if (labelEl) {
      labelEl.textContent = STRINGS.oldestLabel;
    }

    const subtitle = item.querySelector('#subtitle');
    if (subtitle) {
      subtitle.textContent = STRINGS.oldestSubtitle;
    }
  }

  function clickNewestOption(listbox) {
    const newestItem = findMenuItemByText(listbox, STRINGS.newestLabels);
    if (!newestItem) {
      return false;
    }

    newestItem.click();
    return true;
  }

  function findMenuItemByText(listbox, textCandidates) {
    const targets = Array.isArray(textCandidates) ? textCandidates : [textCandidates];
    const roots = getMenuItemRoots(listbox);
    return roots.find((root) => labelMatches(getMenuItemLabel(root), targets)) || null;
  }

  function markMenuSelected(listbox, item) {
    const roots = getMenuItemRoots(listbox);
    roots.forEach((root) => {
      const selected = root === item || root.contains(item);
      const tagName = root.tagName ? root.tagName.toLowerCase() : '';

      if (tagName === 'a') {
        if (selected) {
          root.classList.add('iron-selected');
          root.setAttribute('aria-selected', 'true');
          root.setAttribute('tabindex', '0');
        } else {
          root.classList.remove('iron-selected');
          root.setAttribute('aria-selected', 'false');
          root.setAttribute('tabindex', '-1');
        }
      } else if (tagName === 'ytd-menu-service-item-renderer') {
        if (selected) {
          root.setAttribute('aria-selected', 'true');
          root.setAttribute('data-selected', 'true');
        } else {
          root.removeAttribute('aria-selected');
          root.removeAttribute('data-selected');
        }
      }

      const paper = root.querySelector('tp-yt-paper-item');
      if (paper) {
        if (selected) {
          paper.setAttribute('data-selected', 'true');
        } else {
          paper.removeAttribute('data-selected');
        }
      }
    });
  }
  function closeOpenMenu() {
    const dropdown = document.querySelector(
      'tp-yt-iron-dropdown[opened], tp-yt-iron-dropdown[aria-hidden="false"]'
    );
    if (dropdown && typeof dropdown.close === 'function') {
      dropdown.close();
      return;
    }

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
      })
    );
  }

  function setSortModeOldest() {
    STATE.sortMode = 'oldest';
    setSortButtonLabel(STRINGS.oldestLabel);

    const container = findCommentContainer();
    if (container) {
      loadAllComments(container);
    }
  }

  function setSortButtonLabel(text) {
    const renderer = findSortMenuRenderer();
    if (!renderer) {
      return;
    }

    if (renderer.tagName && renderer.tagName.toLowerCase() === 'yt-dropdown-menu') {
      return;
    }

    const label = renderer.querySelector(
      '#label, yt-formatted-string#label, #icon-label, .dropdown-trigger yt-formatted-string, tp-yt-paper-button yt-formatted-string'
    );
    if (label) {
      label.textContent = text;
    }
  }

  function findCommentContainer() {
    const candidates = [
      'ytd-comments #contents #contents',
      'ytd-comments ytd-item-section-renderer #contents',
      'ytd-comments #contents',
    ];

    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (el && el.querySelector('ytd-comment-thread-renderer')) {
        return el;
      }
    }

    return null;
  }

  function observeCommentContainer(container) {
    if (STATE.commentObserver) {
      STATE.commentObserver.disconnect();
    }

    STATE.lastContainer = container;
    setDebug('API: start');
    STATE.commentObserver = new MutationObserver((mutations) => {
      if (STATE.sortMode !== 'oldest') {
        return;
      }

      let shouldResort = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes && mutation.addedNodes.length) {
          shouldResort = true;
          break;
        }
      }

      if (shouldResort) {
        scheduleResort(container);
      }
    });

    STATE.commentObserver.observe(container, { childList: true });
  }

  function scheduleResort(container) {
    if (!container) {
      return;
    }

    if (STATE.resortTimer) {
      clearTimeout(STATE.resortTimer);
    }

    STATE.resortTimer = setTimeout(() => {
      sortThreadsOldest(container);
    }, 300);
  }

  function sortThreadsOldest(container) {
    const children = Array.from(container.children);
    if (!children.length) {
      return;
    }

    const threads = [];
    const others = [];
    for (const child of children) {
      if (child.tagName && child.tagName.toLowerCase() === 'ytd-comment-thread-renderer') {
        threads.push(child);
      } else {
        others.push(child);
      }
    }

    if (!threads.length) {
      return;
    }

    const now = Date.now();
    threads.sort((a, b) => {
      const ta = getThreadTime(a, now);
      const tb = getThreadTime(b, now);
      return ta - tb;
    });

    const frag = document.createDocumentFragment();
    threads.forEach((thread) => frag.appendChild(thread));
    others.forEach((other) => frag.appendChild(other));
    container.appendChild(frag);
  }

  function getThreadTime(thread, now) {
    const timeText = getThreadTimeText(thread);
    const ts = parseTimeToEpoch(timeText, now);
    return ts === null ? Number.POSITIVE_INFINITY : ts;
  }

  function getThreadTimeText(thread) {
    const el = thread.querySelector(
      'a#published-time-text, #published-time-text a, #published-time-text'
    );
    if (!el) {
      return '';
    }
    return normalizeText(el.textContent);
  }

  function parseTimeToEpoch(text, now) {
    if (!text) {
      return null;
    }

    let cleaned = text.toLowerCase();
    cleaned = cleaned.replace(/\(.*?\)/g, ' ');
    cleaned = cleaned.replace(/•/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/^(streamed|premiered|live|uploaded|posted)\s+/, '');

    if (cleaned.includes('just now')) {
      return now;
    }
    if (cleaned.includes('moment')) {
      return now;
    }
    if (cleaned.includes('yesterday')) {
      return now - 24 * 60 * 60 * 1000;
    }

    const match = cleaned.match(
      /(\d+)\s*(second|sec|minute|min|hour|hr|day|week|wk|month|mo|year|yr)s?\s+ago/
    );
    if (!match) {
      return null;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const unitMs = unitToMs(unit);
    if (!unitMs) {
      return null;
    }

    return now - value * unitMs;
  }

  function unitToMs(unit) {
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    switch (unit) {
      case 'second':
      case 'sec':
        return 1000;
      case 'minute':
      case 'min':
        return minute;
      case 'hour':
      case 'hr':
        return hour;
      case 'day':
        return day;
      case 'week':
      case 'wk':
        return 7 * day;
      case 'month':
      case 'mo':
        return 30 * day;
      case 'year':
      case 'yr':
        return 365 * day;
      default:
        return 0;
    }
  }
  function loadAllComments(container) {
    if (LOAD_SETTINGS.mode === 'api') {
      void loadAllCommentsViaApi(container).then((ok) => {
        if (!ok && LOAD_SETTINGS.fallbackToScroll) {
          loadAllCommentsByScrolling(container);
        }
      });
      return;
    }

    loadAllCommentsByScrolling(container);
  }

  function ensureStatusEl() {
    if (STATE.statusEl && document.body.contains(STATE.statusEl)) {
      return STATE.statusEl;
    }

    const el = document.createElement('div');
    el.id = 'yt-oldest-status';
    el.innerHTML = '<span class="text"></span><button type="button">Stop</button>';

    const stopButton = el.querySelector('button');
    stopButton.addEventListener('click', () => {
      stopLoadingAll('Stopping...');
    });

    document.body.appendChild(el);
    STATE.statusEl = el;
    return el;
  }

  function setStatus(text, showStop) {
    const el = ensureStatusEl();
    const label = el.querySelector('.text');
    if (label) {
      label.textContent = text;
    }

    const button = el.querySelector('button');
    if (button) {
      button.style.display = showStop ? 'inline-block' : 'none';
    }

    el.style.display = 'flex';

    if (!showStop) {
      if (STATE.statusTimer) {
        clearTimeout(STATE.statusTimer);
      }
      STATE.statusTimer = setTimeout(() => {
        el.style.display = 'none';
      }, 2500);
    }
  }

  function stopLoadingAll(message) {
    if (!STATE.loadingAll) {
      return;
    }

    STATE.stopLoading = true;
    if (message) {
      setStatus(message, false);
    }
  }

  function loadAllCommentsByScrolling(container) {
    if (!container || STATE.loadingAll || STATE.loadCompletedFor === container) {
      return;
    }

    STATE.loadingAll = true;
    STATE.stopLoading = false;
    STATE.lastLoadContainer = container;
    setStatus('Loading comments by scrolling...', true);

    const start = Date.now();
    let lastCount = -1;
    let stable = 0;

    const loop = async () => {
      while (!STATE.stopLoading) {
        if (STATE.sortMode !== 'oldest') {
          STATE.stopLoading = true;
          break;
        }

        if (STATE.lastLoadContainer !== container) {
          break;
        }

        const count = container.querySelectorAll('ytd-comment-thread-renderer').length;
        if (count === lastCount) {
          stable += 1;
        } else {
          stable = 0;
        }
        lastCount = count;

        const didClick = clickContinuationButton(container);
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        await wait(LOAD_SETTINGS.waitMs);

        if (count >= LOAD_SETTINGS.maxComments) {
          break;
        }
        if (Date.now() - start > LOAD_SETTINGS.maxMs) {
          break;
        }
        if (stable >= LOAD_SETTINGS.stableCycles && !didClick) {
          break;
        }
      }

      STATE.loadingAll = false;
      STATE.loadCompletedFor = container;

      const finalCount = container.querySelectorAll('ytd-comment-thread-renderer').length;
      if (STATE.stopLoading) {
        setStatus(`Stopped at ${finalCount} comments. Sorting...`, false);
      } else {
        setStatus(`Loaded ${finalCount} comments. Sorting...`, false);
      }

      observeCommentContainer(container);
      scheduleResort(container);
    };

    void loop();
  }

  function clickContinuationButton(container) {
    const root = container.closest('ytd-comments') || document;
    const selectors = [
      'ytd-continuation-item-renderer #button',
      'ytd-continuation-item-renderer tp-yt-paper-button',
      'ytd-continuation-item-renderer button',
      'ytd-continuation-item-renderer a#more',
    ];

    for (const selector of selectors) {
      const button = root.querySelector(selector);
      if (button && !isDisabled(button)) {
        button.click();
        return true;
      }
    }

    return false;
  }

  function isDisabled(el) {
    return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
  }
  function getInnertubeConfig() {
    if (STATE.pageConfig && STATE.pageConfig.apiKey && STATE.pageConfig.context) {
      return {
        apiKey: STATE.pageConfig.apiKey,
        context: STATE.pageConfig.context,
        clientName: STATE.pageConfig.clientName,
        clientVersion: STATE.pageConfig.clientVersion,
        visitorData: STATE.pageConfig.visitorData,
        pageCl: STATE.pageConfig.pageCl,
        pageLabel: STATE.pageConfig.pageLabel,
        authUser: STATE.pageConfig.authUser,
        origin: STATE.pageConfig.origin,
      };
    }
    const ytcfg = window.ytcfg;
    if (ytcfg && typeof ytcfg.get === 'function') {
      return {
        apiKey: ytcfg.get('INNERTUBE_API_KEY'),
        context: ytcfg.get('INNERTUBE_CONTEXT'),
        clientName: ytcfg.get('INNERTUBE_CLIENT_NAME'),
        clientVersion: ytcfg.get('INNERTUBE_CLIENT_VERSION'),
        visitorData: ytcfg.get('VISITOR_DATA'),
        pageCl: ytcfg.get('PAGE_CL'),
        pageLabel: ytcfg.get('PAGE_BUILD_LABEL'),
        authUser: ytcfg.get('SESSION_INDEX'),
        origin: location.origin,
      };
    }

    const data = ytcfg && ytcfg.data_ ? ytcfg.data_ : null;
    if (data) {
      return {
        apiKey: data.INNERTUBE_API_KEY,
        context: data.INNERTUBE_CONTEXT,
        clientName: data.INNERTUBE_CLIENT_NAME,
        clientVersion: data.INNERTUBE_CLIENT_VERSION,
        visitorData: data.VISITOR_DATA,
        pageCl: data.PAGE_CL,
        pageLabel: data.PAGE_BUILD_LABEL,
        authUser: data.SESSION_INDEX,
        origin: location.origin,
      };
    }

    return null;
  }

  function getInitialContinuationToken() {
    const initial = window.ytInitialData;
    if (!initial) {
      return null;
    }

    const section = findObject(initial, (node) => node && node.commentSectionRenderer);
    if (section && section.commentSectionRenderer) {
      const token = findContinuationTokenDeep(section.commentSectionRenderer);
      if (token) {
        return token;
      }
    }

    return findContinuationTokenDeep(initial);
  }

  function getCommentSectionData() {
    const commentsEl = document.querySelector('ytd-comments');
    if (!commentsEl) {
      return null;
    }

    if (commentsEl.data) {
      return commentsEl.data;
    }

    if (commentsEl.__data && commentsEl.__data.data) {
      return commentsEl.__data.data;
    }

    return commentsEl.__data || null;
  }

  async function getInitialContinuationTokenAsync() {
    const sectionData = getCommentSectionData();
    if (!sectionData) {
      return null;
    }

    const directToken = await findContinuationTokenDeepAsync(sectionData);
    if (directToken) {
      return directToken;
    }

    const section = await findObjectAsync(
      sectionData,
      (node) => node && node.commentSectionRenderer,
      4000
    );
    if (section && section.commentSectionRenderer) {
      const token = await findContinuationTokenDeepAsync(
        section.commentSectionRenderer,
        8000
      );
      if (token) {
        return token;
      }
    }

    return null;
  }

  async function findObjectAsync(root, predicate, maxNodes) {
    const queue = [root];
    let seen = 0;
    const limit = maxNodes || LOAD_SETTINGS.tokenScanMaxNodes || 15000;
    const yieldEvery = LOAD_SETTINGS.tokenYieldEvery || 1500;

    for (let i = 0; i < queue.length; i += 1) {
      const node = queue[i];
      if (!node || typeof node !== 'object') {
        continue;
      }
      if (seenNodes.has(node)) {
        continue;
      }
      seenNodes.add(node);
      if (predicate(node)) {
        return node;
      }

    seen += 1;
      if (seen > limit) {
        break;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          queue.push(item);
        }
      } else {
        for (const value of Object.values(node)) {
          queue.push(value);
        }
      }

      if (seen % yieldEvery === 0) {
        await wait(0);
      }
    }

    return null;
  }

  async function findContinuationTokenDeepAsync(root, maxNodes) {
    const queue = [root];
    let seen = 0;
    const limit = maxNodes || LOAD_SETTINGS.tokenScanMaxNodes || 15000;
    const yieldEvery = LOAD_SETTINGS.tokenYieldEvery || 1500;

    for (let i = 0; i < queue.length; i += 1) {
      const node = queue[i];
      if (!node || typeof node !== 'object') {
        continue;
      }
      if (seenNodes.has(node)) {
        continue;
      }
      seenNodes.add(node);

      const direct = getContinuationTokenFromNode(node);
      if (direct) {
        return direct;
      }

      seen += 1;
      if (seen > limit) {
        break;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          queue.push(item);
        }
      } else {
        for (const value of Object.values(node)) {
          queue.push(value);
        }
      }

      if (seen % yieldEvery === 0) {
        await wait(0);
      }
    }

    return null;
  }
  async function getInitialContinuationTokenWithRetry() {
    const maxAttempts = LOAD_SETTINGS.apiRetryMax || 6;
    const waitMs = LOAD_SETTINGS.apiRetryMs || 400;
    for (let i = 0; i < maxAttempts; i += 1) {
      await requestPageData();
      if (STATE.pageToken) {
        return STATE.pageToken;
      }
      if (!document.querySelector('ytd-comments')) {
        await wait(waitMs);
        continue;
      }
      const token = await getInitialContinuationTokenAsync();
      if (token) {
        return token;
      }
      await wait(waitMs);
    }
    return null;
  }
  function findObject(root, predicate, maxNodes = 50000) {
    const queue = [root];
    let seen = 0;

    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') {
        continue;
      }
      if (seenNodes.has(node)) {
        continue;
      }
      seenNodes.add(node);
      if (predicate(node)) {
        return node;
      }

      seen += 1;
      if (seen > maxNodes) {
        break;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          queue.push(item);
        }
      } else {
        for (const value of Object.values(node)) {
          queue.push(value);
        }
      }
    }

    return null;
  }

  function findContinuationTokenDeep(root, maxNodes = 50000) {
    const queue = [root];
    let seen = 0;

    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') {
        continue;
      }
      if (seenNodes.has(node)) {
        continue;
      }
      seenNodes.add(node);

      const direct = getContinuationTokenFromNode(node);
      if (direct) {
        return direct;
      }

      seen += 1;
      if (seen > maxNodes) {
        break;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          queue.push(item);
        }
      } else {
        for (const value of Object.values(node)) {
          queue.push(value);
        }
      }
    }

    return null;
  }

  function getContinuationTokenFromNode(node) {
    if (!node || typeof node !== 'object') {
      return null;
    }

    if (node.continuationEndpoint && node.continuationEndpoint.continuationCommand) {
      return node.continuationEndpoint.continuationCommand.token || null;
    }

    if (node.continuations && Array.isArray(node.continuations)) {
      for (const entry of node.continuations) {
        const token = getContinuationTokenFromNode(entry);
        if (token) {
          return token;
        }
      }
    }

    if (node.nextContinuationData && node.nextContinuationData.continuation) {
      return node.nextContinuationData.continuation;
    }

    if (node.reloadContinuationData && node.reloadContinuationData.continuation) {
      return node.reloadContinuationData.continuation;
    }

    return null;
  }

  function buildApiHeaders(config) {
    const headers = {
      'content-type': 'application/json',
    };

    if (config.clientName !== undefined) {
      headers['x-youtube-client-name'] = String(config.clientName);
    }
    if (config.clientVersion) {
      headers['x-youtube-client-version'] = String(config.clientVersion);
    }
    if (config.visitorData) {
      headers['x-goog-visitor-id'] = String(config.visitorData);
    }
    if (config.pageCl) {
      headers['x-youtube-page-cl'] = String(config.pageCl);
    }
    if (config.pageLabel) {
      headers['x-youtube-page-label'] = String(config.pageLabel);
    }
    if (config.authUser !== undefined && config.authUser !== null) {
      headers['x-goog-authuser'] = String(config.authUser);
    }
    if (config.origin) {
      headers['x-origin'] = String(config.origin);
    }

    return headers;
  }

  async function fetchContinuation(config, token) {
    const url = `https://www.youtube.com/youtubei/v1/next?key=${config.apiKey}`;
    const body = {
      context: config.context,
      continuation: token,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: buildApiHeaders(config),
      body: JSON.stringify(body),
      credentials: 'include',
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  function getContinuationItems(response) {
    if (!response) {
      return [];
    }

    const endpoints = response.onResponseReceivedEndpoints ||
      response.onResponseReceivedActions ||
      response.onResponseReceivedCommands ||
      [];

    const items = [];
    endpoints.forEach((endpoint) => {
      const action =
        endpoint.appendContinuationItemsAction ||
        endpoint.reloadContinuationItemsCommand ||
        endpoint.appendContinuationItemsAction;
      if (action && Array.isArray(action.continuationItems)) {
        items.push(...action.continuationItems);
      }
    });

    return items;
  }

  function extractThreads(items) {
    const threads = [];
    items.forEach((item) => {
      if (item && item.commentThreadRenderer) {
        threads.push(item.commentThreadRenderer);
      }
    });
    return threads;
  }

  function extractNextContinuation(items) {
    for (const item of items) {
      if (item && item.continuationItemRenderer) {
        const token = getContinuationTokenFromNode(item.continuationItemRenderer);
        if (token) {
          return token;
        }
      }
    }
    return null;
  }

  function textFromRuns(runs) {
    if (!Array.isArray(runs)) {
      return '';
    }

    return runs
      .map((run) => {
        if (!run) {
          return '';
        }
        if (typeof run.text === 'string') {
          return run.text;
        }
        if (run.emoji && Array.isArray(run.emoji.shortcuts) && run.emoji.shortcuts[0]) {
          return run.emoji.shortcuts[0];
        }
        return '';
      })
      .join('');
  }

  function textFromObject(obj) {
    if (!obj) {
      return '';
    }
    if (typeof obj.simpleText === 'string') {
      return obj.simpleText;
    }
    if (Array.isArray(obj.runs)) {
      return textFromRuns(obj.runs);
    }
    return '';
  }

  function extractCommentData(thread) {
    if (!thread || !thread.comment || !thread.comment.commentRenderer) {
      return null;
    }

    const renderer = thread.comment.commentRenderer;
    const id = renderer.commentId || '';
    const author = textFromObject(renderer.authorText);
    const timeText = textFromObject(renderer.publishedTimeText);
    const contentText = textFromObject(renderer.contentText);
    const likeCount =
      typeof renderer.likeCount === 'number'
        ? String(renderer.likeCount)
        : textFromObject(renderer.voteCount);

    const thumbnails = renderer.authorThumbnail && renderer.authorThumbnail.thumbnails;
    const avatar = Array.isArray(thumbnails) && thumbnails.length
      ? thumbnails[thumbnails.length - 1].url
      : '';

    const timeValue = parseTimeToEpoch(timeText, Date.now());

    return {
      id,
      author,
      timeText,
      contentText,
      likeCount,
      avatar,
      timeValue: timeValue === null ? Number.POSITIVE_INFINITY : timeValue,
    };
  }

  async function loadAllCommentsViaApi(container) {
    if (!container || STATE.loadingAll || STATE.loadCompletedFor === container) {
      return false;
    }

    STATE.loadingAll = true;
    STATE.stopLoading = false;
    STATE.lastLoadContainer = container;
    STATE.lastContainer = container;
    setDebug('API: start');

    const abort = (message) => {
      STATE.loadingAll = false;
      if (message) {
        setStatus(message, false);
      }
      return false;
    };

    const config = getInnertubeConfig();
    if (!config || !config.apiKey || !config.context) {
      setDebug('API: missing config');
      return abort('API not ready. Open comments once and retry Oldest.');
    }

    setStatus('Initializing comments...', true);
    await wait(0);

    const initialToken = await getInitialContinuationTokenWithRetry();
    if (!initialToken) {
      setDebug('API: no token');
      return abort('Comments not initialized. Scroll to comments once, then retry Oldest.');
    }

    setStatus('Loading comments via API...', true);
    showApiLoadingState(container, 'Loading comments via API...');
    setDebug('API: fetching');

    const start = Date.now();
    let token = initialToken;
    let totalLoaded = 0;
    const comments = [];
    const seenIds = new Set();

    while (token && !STATE.stopLoading) {
      if (STATE.sortMode !== 'oldest') {
        STATE.stopLoading = true;
        break;
      }

      if (STATE.lastLoadContainer !== container) {
        break;
      }

      const response = await fetchContinuation(config, token);
      if (!response) {
        break;
      }

      const items = getContinuationItems(response);
      const threads = extractThreads(items);

      threads.forEach((thread) => {
        const data = extractCommentData(thread);
        if (!data) {
          return;
        }
        if (data.id && seenIds.has(data.id)) {
          return;
        }
        if (data.id) {
          seenIds.add(data.id);
        }
        comments.push(data);
      });

      totalLoaded = comments.length;
      setStatus(`Loaded ${totalLoaded} comments...`, true);
      showApiLoadingState(container, `Loaded ${totalLoaded} comments...`);

      token = extractNextContinuation(items);

      if (totalLoaded >= LOAD_SETTINGS.maxComments) {
        break;
      }
      if (Date.now() - start > LOAD_SETTINGS.maxMs) {
        break;
      }
    }

    STATE.loadCompletedFor = container;

    if (!comments.length) {
      STATE.loadingAll = false;
      restoreOriginalComments();
      setStatus('No comments found via API.', false);
      return false;
    }

    const orderMode = LOAD_SETTINGS.apiOrderMode || 'reverse';
    let orderingLabel = 'reverse';
    let validRatio = 0;

    if (orderMode === 'time') {
      const validCount = comments.reduce(
        (count, comment) => count + (Number.isFinite(comment.timeValue) ? 1 : 0),
        0
      );
      validRatio = comments.length ? validCount / comments.length : 0;

      if (validRatio < 0.5) {
        comments.reverse();
        orderingLabel = 'reverse-fallback';
      } else {
        comments.sort((a, b) => a.timeValue - b.timeValue);
        orderingLabel = 'time';
      }
    } else {
      comments.reverse();
      orderingLabel = 'reverse';
    }

    setStatus(`Rendering comments (${orderingLabel})...`, true);
    const firstTime = comments.length ? comments[0].timeText : '';
    const lastTime = comments.length ? comments[comments.length - 1].timeText : '';
    await renderApiComments(container, comments, {
      orderingLabel,
      validRatio,
      total: comments.length,
      firstTime,
      lastTime,
    });
    STATE.loadingAll = false;

    if (STATE.stopLoading) {
      setStatus(`Stopped at ${comments.length} comments. Showing results.`, false);
    } else {
      setStatus(`Loaded ${comments.length} comments. Showing results.`, false);
    }

    return true;
  }
  function buildApiHeader(meta) {
    const header = document.createElement('div');
    header.className = 'yt-oldest-header';

    const parts = [];
    if (meta && meta.orderingLabel) {
      parts.push(`Order: ${meta.orderingLabel}`);
    }
    if (meta && typeof meta.validRatio === 'number' && meta.validRatio > 0) {
      parts.push(`Parsed: ${Math.round(meta.validRatio * 100)}%`);
    }
    if (meta && typeof meta.total === 'number') {
      parts.push(`Total: ${meta.total}`);
    }

    header.textContent = parts.length
      ? `Oldest (API) — ${parts.join(' • ')}`
      : 'Oldest (API)';
    return header;
  }
  function showApiLoadingState(container, message) {
    const root = getCommentsRoot(container);
    if (!root) {
      return;
    }

    const list = ensureApiList(root);
    list.innerHTML = '';

    const loading = document.createElement('div');
    loading.className = 'yt-oldest-loading';
    loading.textContent = message;
    list.appendChild(loading);
  }

  async function renderApiComments(container, comments, meta) {
    const root = getCommentsRoot(container);
    if (!root) {
      return;
    }

    const list = ensureApiList(root);
    list.innerHTML = '';

    if (meta) {
      list.appendChild(buildApiHeader(meta));
    }

    const chunkSize = Math.max(1, LOAD_SETTINGS.renderChunkSize || 200);
    const yieldMs = LOAD_SETTINGS.renderYieldMs || 16;

    for (let i = 0; i < comments.length; i += chunkSize) {
      if (STATE.stopLoading || STATE.sortMode !== 'oldest') {
        break;
      }

      const frag = document.createDocumentFragment();
      const slice = comments.slice(i, i + chunkSize);
      slice.forEach((comment) => {
        frag.appendChild(buildCommentNode(comment));
      });
      list.appendChild(frag);

      setStatus(`Rendering ${Math.min(i + chunkSize, comments.length)} / ${comments.length}`, true);
      await wait(yieldMs);
    }
  }

  function getCommentsRoot(container) {
    return container.closest('ytd-comments') || document.querySelector('ytd-comments');
  }

  function ensureApiList(root) {
    hideOriginalComments(root);

    let list = root.querySelector('#yt-oldest-list');
    if (list) {
      return list;
    }

    list = document.createElement('div');
    list.id = 'yt-oldest-list';
    root.appendChild(list);
    return list;
  }

  function hideOriginalComments(root) {
    const contents = root.querySelector('#contents');
    if (contents) {
      contents.dataset.oldestHidden = 'true';
      contents.style.display = 'none';
    }
  }

  function restoreOriginalComments() {
    const root = document.querySelector('ytd-comments');
    if (!root) {
      return;
    }

    const list = root.querySelector('#yt-oldest-list');
    if (list) {
      list.remove();
    }

    const contents = root.querySelector('#contents');
    if (contents && contents.dataset.oldestHidden) {
      contents.style.display = '';
      delete contents.dataset.oldestHidden;
    }
  }

  function buildCommentNode(comment) {
    const wrapper = document.createElement('div');
    wrapper.className = 'yt-oldest-comment';

    if (comment.avatar) {
      const avatar = document.createElement('img');
      avatar.className = 'avatar';
      avatar.src = comment.avatar;
      avatar.alt = '';
      wrapper.appendChild(avatar);
    }

    const body = document.createElement('div');
    body.className = 'body';

    const meta = document.createElement('div');
    meta.className = 'meta';

    const author = document.createElement('span');
    author.className = 'author';
    author.textContent = comment.author || 'Unknown';

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = comment.timeText || '';

    meta.appendChild(author);
    if (comment.timeText) {
      meta.appendChild(time);
    }

    if (comment.likeCount) {
      const likes = document.createElement('span');
      likes.className = 'likes';
      likes.textContent = `${comment.likeCount} likes`;
      meta.appendChild(likes);
    }

    const content = document.createElement('div');
    content.className = 'text';
    content.textContent = comment.contentText || '';

    body.appendChild(meta);
    body.appendChild(content);
    wrapper.appendChild(body);

    return wrapper;
  }

  const rootObserver = new MutationObserver(() => {
    attachSortMenuListener();

    if (STATE.sortMode === 'oldest') {
      const container = findCommentContainer();
      if (container && container !== STATE.lastContainer) {
        STATE.loadCompletedFor = null;
        if (LOAD_SETTINGS.mode !== 'api') {
          observeCommentContainer(container);
          scheduleResort(container);
        }
        loadAllComments(container);
      }
    }
  });

  rootObserver.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('yt-navigate-finish', () => {
    attachSortMenuListener();

    if (STATE.sortMode === 'oldest') {
      const container = findCommentContainer();
      if (container) {
        STATE.loadCompletedFor = null;
        restoreOriginalComments();
        if (LOAD_SETTINGS.mode !== 'api') {
          observeCommentContainer(container);
          scheduleResort(container);
        }
        loadAllComments(container);
      }
    } else {
      restoreOriginalComments();
    }
  });

  attachSortMenuListener();
})();



















