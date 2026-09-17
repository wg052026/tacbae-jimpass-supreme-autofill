// ==UserScript==
// @name         IPRoyal 주문 자동 설정 (1일·1개·미국·Standard)
// @namespace    wg052026
// @version      20260917.211927
// @description  IPRoyal ISP 주문 화면을 1 Day · 1 Proxy · United States · 수량 1 · Standard 로 맞춘다
// @match        https://dashboard.iproyal.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/iproyal-order-preset.user.js
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/iproyal-order-preset.user.js
// ==/UserScript==
(function () {
  'use strict';
  const VER = '20260917_211927';
  const PLAN = '1 Day (24 hours)';
  const COUNTRY = 'United States';
  const QTY = '1';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const onPage = () => /\/create-order/.test(location.pathname);
  const txt = e => (e.innerText || '').trim().replace(/\s+/g, ' ');

  // ── 상태창 ──
  let panel, logBox;
  function ui() {
    if (panel && document.body.contains(panel)) return;
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:16px;bottom:90px;z-index:99999;background:#111;color:#eee;border:1px solid #1ab;border-radius:8px;padding:8px 10px;font:12px sans-serif;width:230px';
    panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><b>주문 자동 설정</b><button style="background:#1ab;color:#fff;border:0;border-radius:4px;padding:2px 8px;cursor:pointer">다시 적용</button></div><div style="max-height:110px;overflow:auto;color:#9cd"></div><div style="color:#666;margin-top:4px">판 ' + VER + '</div>';
    logBox = panel.children[1];
    panel.querySelector('button').onclick = () => run(true);
    document.body.appendChild(panel);
  }
  function log(m) { ui(); const d = document.createElement('div'); d.textContent = m; logBox.appendChild(d); logBox.scrollTop = 1e6; console.log('[IPR자동]', m); }

  async function waitFor(fn, ms = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(200); }
    return null;
  }
  const btn = re => [...document.querySelectorAll('button')].find(b => re.test(txt(b)));
  const locBox = () => document.querySelector('[role=combobox][aria-labelledby]');

  function setInput(el, v) {
    if (el.value === v) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  let busy = false;
  async function run(manual) {
    if (busy || !onPage()) return;
    busy = true;
    try {
      ui();
      log(manual ? '다시 적용 시작' : '화면 확인 중');
      // 1) 기간
      const plan = await waitFor(() => btn(/^1 Day/));
      if (!plan) { log('기간 단추를 못 찾음'); return; }
      plan.click(); await sleep(700);
      log('기간: 1일');
      // 2) 1 Proxy
      const r1 = await waitFor(() => document.querySelector('input[name="bundle-quantity"][value="1"]'));
      if (r1) { if (!r1.checked) r1.closest('label').click(); await sleep(700); log('개수: 1개'); }
      else log('1개 칸을 못 찾음');
      // 3) 나라 칸이 없으면 하나만 만든다
      if (!locBox()) {
        const add = await waitFor(() => btn(/Add Country/));
        if (add) { add.click(); log('나라 칸 추가'); }
      }
      // 나라 칸이 여럿이면 첫 칸만 남기고 지운다
      for (let k = 0; k < 10; k++) {
        const xs = [...document.querySelectorAll('button[aria-label="Remove Country"]')];
        if (xs.length <= 1) break;
        xs[xs.length - 1].click(); log('남는 나라 칸 지움'); await sleep(500);
      }
      const cb = await waitFor(locBox);
      if (!cb) { log('나라 칸을 못 찾음'); return; }
      if (txt(cb) !== COUNTRY) {
        cb.click();
        const opt = await waitFor(() => [...document.querySelectorAll('[role=option]')]
          .find(o => (o.innerText || '').trim().split('\n')[0].trim() === COUNTRY), 6000);
        if (!opt) { log('미국을 목록에서 못 찾음'); return; }
        opt.click(); await sleep(700);
      }
      log('나라: ' + txt(locBox()));
      // 4) 수량 1 (나라 칸 옆 숫자칸들)
      const amt = [...document.querySelectorAll('input')].filter(i => !i.type || i.type === 'text' || i.type === 'number');
      amt.forEach(i => { if (/^\d+$/.test(i.value) && i.value !== QTY) setInput(i, QTY); });
      await sleep(500);
      log('수량: 1');
      // 5) 사기 점수 Standard
      const fs = await waitFor(() => document.querySelector('input[name="fraud-score-tier"][value="standard"]'), 6000);
      if (fs) { if (!fs.checked) fs.click(); await sleep(400); log(fs.checked ? '사기 점수: Standard · 끝' : 'Standard 선택 실패'); }
      else log('Standard 칸을 못 찾음');
    } catch (e) { log('오류: ' + e.message); }
    finally { busy = false; }
  }

  // 화면 안에서 주소만 바뀌는 경우도 잡는다
  let lastPath = '';
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (onPage()) run(false);
      else if (panel) { panel.remove(); panel = null; }
    }
  }, 500);
})();
