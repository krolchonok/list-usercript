// ==UserScript==
// @name         Ozon Finance: force min sum
// @namespace    ozon-finance-force-min
// @match        https://finance.ozon.ru/*
// @run-at       document-start
// @author       ushastoe (krolchonok)
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const inputSelector = 'input[data-testid="money-input"]';
  const placeholderSelector = 'span[data-testid="obi-test-id-placeholder"]';

  function parseMin() {
    const el = document.querySelector(placeholderSelector);
    if (!el) return null;

    const text = (el.textContent || '').replace(/\u202F/g, ' ');
    const m = text.match(/от\s*([\d\s]+)/i);
    if (!m) return null;

    const num = Number(m[1].replace(/\s+/g, ''));
    return Number.isFinite(num) ? num : null;
  }

  function setValue(input, valueStr) {
    input.focus({ preventScroll: true });

    const proto = Object.getPrototypeOf(input);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = desc && desc.set;

    if (setter) setter.call(input, valueStr);
    else input.value = valueStr;

    try {
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: valueStr
      }));
    } catch {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
  }

  function apply() {
    const input = document.querySelector(inputSelector);
    if (!input) return false;

    const min = parseMin();
    if (!min) return false;

    setValue(input, String(min));
    return true;
  }

  function burstTries() {
    let n = 0;
    const t = setInterval(() => {
      n++;
      apply();
      if (n >= 20) clearInterval(t);
    }, 250);
  }

  const obs = new MutationObserver(() => apply());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', burstTries, { once: true });
  } else {
    burstTries();
  }
})();