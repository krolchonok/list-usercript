// ==UserScript==
// @name         VK IM: Download message images
// @namespace    vk-im-download-msg-images
// @match        https://vk.com/im*
// @run-at       document-end
// @grant        GM_download
// ==/UserScript==

(function () {
  'use strict';

  const ITEM_CLASS = 'vk-im-download-msg-images';
  let lastMsgEl = null;
  const MESSAGE_ROOT_SELECTOR = '.ConvoHistory__messageWrapper, .ConvoHistory__messageBlock, .ConvoMessage, article, [data-id]';
  const MENU_SELECTOR = [
    'div[role="menu"]',
    '.ui_actions_menu',
    '._ui_menu',
    '.MessageActionsContent__menu',
    '.DropdownReforged__contentWrapper',
    '.RE_ContextMenu__contentWrapper',
    '.vkitDropdownActionSheet__content'
  ].join(', ');Ф
  const MENU_ITEM_SELECTOR = [
    '[role="menuitem"]',
    '.ui_actions_menu_item',
    '.vkitDropdownActionSheetItem__container--on3eb',
    'button',
    'a',
    'div'
  ].join(', ');
  const ICON_DOWNLOAD = '⬇';
  const ICON_PROGRESS = '⏳';
  const ICON_DONE = '✓';
  const ICON_ERROR = '⚠';
  let downloadState = { phase: 'idle', current: 0, total: 0, started: 0, error: '' };
  let isDownloading = false;
  let resetStateTimer = null;

  // 1) Запоминаем, для какого сообщения открыли меню
  function trackLastMessage() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.MessageActionsButton, .MessageActionsButtonContainer, [aria-haspopup="menu"], [aria-expanded]');
      if (btn) {
        lastMsgEl = btn.closest(MESSAGE_ROOT_SELECTOR) || null;
      } else {
        const msg = e.target.closest(MESSAGE_ROOT_SELECTOR);
        if (msg) lastMsgEl = msg;
      }
      // Некоторые меню открываются без добавления новых нод и без клика по кнопке действий.
      setTimeout(injectIntoVisibleMenus, 0);
    }, true);

    // на всякий случай: контекстное меню / long-press сценарии
    document.addEventListener('contextmenu', (e) => {
      const msg = e.target.closest(MESSAGE_ROOT_SELECTOR);
      if (msg) lastMsgEl = msg;
    }, true);
  }

  // 2) Ждём появление меню и инжектим пункт
  function waitForMenu() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') {
          const el = m.target;
          if (el instanceof HTMLElement && el.matches?.(MENU_SELECTOR)) {
            injectItem(el);
          }
        }

        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          const menu =
            (node.matches?.(MENU_SELECTOR) ? node : null) ||
            node.querySelector?.(MENU_SELECTOR);

          if (menu) injectItem(menu);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden']
    });
    injectIntoVisibleMenus();
    ensureStyles();
    // На случай ленивого рендера/перерисовки меню без мутаций childList.
    setInterval(injectIntoVisibleMenus, 1000);
  }

  function ensureStyles() {
    if (document.getElementById('vk-im-download-msg-images-style')) return;
    const style = document.createElement('style');
    style.id = 'vk-im-download-msg-images-style';
    style.textContent = `
      .${ITEM_CLASS} {
        display: flex !important;
        align-items: center;
        gap: 8px;
      }
      .${ITEM_CLASS} .vk-im-dl-icon {
        width: 16px;
        text-align: center;
        opacity: 0.9;
      }
      .${ITEM_CLASS}[data-busy="1"] {
        opacity: 0.85;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function injectIntoVisibleMenus() {
    document.querySelectorAll(MENU_SELECTOR).forEach(injectItem);
  }

  function injectItem(menu) {
    // Если это обёртка, попробуем найти внутренний контейнер меню.
    const effectiveMenu =
      menu.querySelector?.('.MessageActionsContent__menu, .vkitDropdownActionSheet__content, .ui_actions_menu, ._ui_menu') ||
      menu;

    const msgEl = getCurrentMessageContext();
    if (!msgEl || !hasPhotoAttachments(msgEl)) {
      effectiveMenu.querySelector('.' + ITEM_CLASS)?.remove();
      return;
    }

    if (effectiveMenu.querySelector('.' + ITEM_CLASS)) return;

    const anyItem = effectiveMenu.querySelector(MENU_ITEM_SELECTOR);

    if (!anyItem) return;

    const item = anyItem.cloneNode(true);
    item.classList.add(ITEM_CLASS);
    if (!item.classList.contains('ui_actions_menu_item')) {
      item.classList.add('ui_actions_menu_item');
    }

    // чистим содержимое и рисуем иконку + текст
    item.innerHTML = '<span class="vk-im-dl-icon"></span><span class="vk-im-dl-text"></span>';
    renderItemState(item);

    item.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (isDownloading) return;
      const msgEl = getCurrentMessageContext();
      if (!msgEl) {
        alert('Не удалось определить сообщение (lastMsgEl пустой)');
        return;
      }

      isDownloading = true;
      setDownloadState({ phase: 'progress', current: 0, total: 0, started: 0, error: '' });
      renderAllItemsState();
      try {
        const summary = await downloadImagesFromMessage(msgEl, ({ current, total, started }) => {
          setDownloadState({ phase: 'progress', current, total, started, error: '' });
          renderAllItemsState();
        });

        if (!summary.total) {
          setDownloadState({ phase: 'error', current: 0, total: 0, started: 0, error: 'Нет картинок' });
          scheduleResetState(1600);
        } else {
          setDownloadState({
            phase: 'done',
            current: summary.total,
            total: summary.total,
            started: summary.started,
            error: ''
          });
          scheduleResetState(1800);
        }
      } catch (err) {
        setDownloadState({ phase: 'error', current: 0, total: 0, started: 0, error: String(err || 'Ошибка') });
        scheduleResetState(2000);
      } finally {
        isDownloading = false;
        renderAllItemsState();
      }
    }, true);

    effectiveMenu.appendChild(item);
  }

  function setDownloadState(next) {
    downloadState = { ...downloadState, ...next };
  }

  function scheduleResetState(delayMs = 1800) {
    if (resetStateTimer) clearTimeout(resetStateTimer);
    resetStateTimer = setTimeout(() => {
      setDownloadState({ phase: 'idle', current: 0, total: 0, started: 0, error: '' });
      renderAllItemsState();
      resetStateTimer = null;
    }, delayMs);
  }

  function getCurrentMessageContext() {
    if (lastMsgEl && document.contains(lastMsgEl)) return lastMsgEl;
    return document.querySelector(
      '.ConvoHistory__messageBlock--withContextMenuActive .ConvoHistory__messageWrapper, ' +
      '.ConvoHistory__messageBlock--withContextMenuActive .ConvoMessage, ' +
      '.ConvoHistory__messageBlock--withContextMenuActive article'
    );
  }

  function collectPhotoAnchors(msgEl) {
    return Array.from(
      msgEl.querySelectorAll('a.AttachPhotos__link[href*="z=photo"], a[href*="z=photo"]')
    );
  }

  function hasPhotoAttachments(msgEl) {
    return collectPhotoAnchors(msgEl).length > 0;
  }

  function renderAllItemsState() {
    document.querySelectorAll('.' + ITEM_CLASS).forEach(renderItemState);
  }

  function renderItemState(item) {
    const iconEl = item.querySelector('.vk-im-dl-icon');
    const textEl = item.querySelector('.vk-im-dl-text');
    if (!iconEl || !textEl) return;

    if (downloadState.phase === 'progress') {
      iconEl.textContent = ICON_PROGRESS;
      if (downloadState.total > 0) {
        textEl.textContent = `Скачивание ${downloadState.current}/${downloadState.total}`;
      } else {
        textEl.textContent = 'Подготовка...';
      }
      item.setAttribute('data-busy', '1');
      return;
    }

    item.removeAttribute('data-busy');
    if (downloadState.phase === 'done') {
      iconEl.textContent = ICON_DONE;
      textEl.textContent = `Скачано ${downloadState.started}/${downloadState.total}`;
      return;
    }

    if (downloadState.phase === 'error') {
      iconEl.textContent = ICON_ERROR;
      textEl.textContent = downloadState.error || 'Ошибка скачивания';
      return;
    }

    iconEl.textContent = ICON_DOWNLOAD;
    textEl.textContent = 'Скачать вложения';
  }

  // 3) Скачивание
  async function downloadImagesFromMessage(msgEl, onProgress) {
    const anchors = collectPhotoAnchors(msgEl);

    if (!anchors.length) return { total: 0, started: 0 };

    // уникальные ссылки
    const hrefs = [...new Set(anchors.map(a => a.getAttribute('href')).filter(Boolean))]
      .map(h => new URL(h, location.origin).toString());

    let started = 0;
    onProgress?.({ current: 0, total: hrefs.length, started });

    for (let i = 0; i < hrefs.length; i++) {
      const photoPageUrl = hrefs[i];

      // пытаемся вытащить прямую ссылку на картинку со страницы фото (og:image)
      const directUrl = await tryGetOgImage(photoPageUrl)
        || tryGetThumbFromAnchor(anchors, photoPageUrl);

      if (directUrl) {
        GM_download({
          url: directUrl,
          name: `vk_msg_img_${Date.now()}_${i}.jpg`,
          saveAs: false
        });
        started++;
      }

      onProgress?.({ current: i + 1, total: hrefs.length, started });
    }

    return { total: hrefs.length, started };
  }

  async function tryGetOgImage(photoPageUrl) {
    try {
      const resp = await fetch(photoPageUrl, { credentials: 'include' });
      const html = await resp.text();

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const og = doc.querySelector('meta[property="og:image"]');
      const content = og?.getAttribute('content');

      return content ? new URL(content, location.origin).toString() : null;
    } catch {
      return null;
    }
  }

  function tryGetThumbFromAnchor(anchors, photoPageUrl) {
    // fallback: берём thumbnail img.src из сообщения
    const a = anchors.find(x => new URL(x.href, location.origin).toString() === photoPageUrl);
    const img = a?.querySelector('img');
    return img?.src || null;
  }

  trackLastMessage();
  waitForMenu();
})();
