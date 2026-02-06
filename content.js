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
  };

  const LOAD_SETTINGS = {
    maxMs: 5 * 60 * 1000,
    maxComments: 10000,
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

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    const hasNewest = STRINGS.newestLabels.some((label) => labels.includes(label.toLowerCase()));
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
          STATE.sortMode = null;
          stopLoadingAll('Stopped loading comments');
        }
      },
      true
    );
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
            scheduleResort(container);
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
    return (
      roots.find((root) => labelMatches(getMenuItemLabel(root), targets)) || null
    );
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
      observeCommentContainer(container);
      scheduleResort(container);
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
    const ts = parseRelativeTimeToEpoch(timeText, now);
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

  function parseRelativeTimeToEpoch(text, now) {
    if (!text) {
      return null;
    }

    let cleaned = text.toLowerCase();
    cleaned = cleaned.replace(/\(.*?\)/g, ' ');
    cleaned = cleaned.replace(/•/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    if (cleaned.includes('just now')) {
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

  function ensureStatusEl() {
    if (STATE.statusEl && document.body.contains(STATE.statusEl)) {
      return STATE.statusEl;
    }

    const el = document.createElement('div');
    el.id = 'yt-oldest-status';
    el.innerHTML =
      '<span class="text"></span>' +
      '<button type="button">Stop</button>';

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

  async function loadAllComments(container) {
    if (!container || STATE.loadingAll || STATE.loadCompletedFor === container) {
      return;
    }

    STATE.loadingAll = true;
    STATE.stopLoading = false;
    STATE.lastLoadContainer = container;
    setStatus('Loading all comments...', true);

    const start = Date.now();
    let lastCount = -1;
    let stable = 0;

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

    scheduleResort(container);
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

  const rootObserver = new MutationObserver(() => {
    attachSortMenuListener();

    if (STATE.sortMode === 'oldest') {
      const container = findCommentContainer();
      if (container && container !== STATE.lastContainer) {
        STATE.loadCompletedFor = null;
        observeCommentContainer(container);
        scheduleResort(container);
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
        observeCommentContainer(container);
        scheduleResort(container);
        loadAllComments(container);
      }
    }
  });

  attachSortMenuListener();
})();
