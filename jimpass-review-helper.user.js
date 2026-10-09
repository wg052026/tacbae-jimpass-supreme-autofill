// ==UserScript==
// @name         짐패스 후기 올리기 도우미
// @namespace    leplus
// @version      0.2.0
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/jimpass-review-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/jimpass-review-helper.user.js
// @description  후기 txt 를 읽어 내 카페 / 짐패스 카페(미국·일본) / 짐패스 사이트 후기 글쓰기 화면에 채워 줍니다. 등록 단추는 직접 누릅니다.
// @match        https://cafe.naver.com/*
// @match        https://www.jimpass.com/article/config/code/review/mode/write*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const MY_CAFE = '11298080';
  const JIM_CAFE = '29931376';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- 후기 txt 읽기 ---------- */
  // 한 건: [제목, 신청서번호, 본문, 유튜브, 해시태그줄, 글자수줄] (빈 줄은 건너뜀)
  function parseReviews(txt) {
    return txt
      .split(/━{3,}/)
      .map((blk) => blk.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
      .filter((l) => l.length >= 5)
      .map((l) => ({
        title: l[0],
        no: l[1],
        body: l[2],
        youtube: l[3],
        tags: (l[4].match(/#[^\s#]+/g) || []).map((t) => t.replace('#', '')),
      }));
  }
  const loadAll = () => { try { return JSON.parse(GM_getValue('reviews', '[]')); } catch (e) { return []; } };
  const cur = () => loadAll()[GM_getValue('idx', 0)];
  const shopOf = (title) =>
    /슈프림/.test(title) ? '슈프림' : /캐피탈/.test(title) ? '캐피탈' : '';


  /* ---------- 깃허브에서 최신 후기 목록 받기 ---------- */
  const REVIEWS_API = 'https://api.github.com/repos/wg052026/tacbae-jimpass-supreme-autofill/contents/reviews.json?ref=main';
  function fetchReviews() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: REVIEWS_API + '&t=' + Date.now(),
        headers: { Accept: 'application/vnd.github+json' },
        onload: (res) => {
          try {
            const j = JSON.parse(res.responseText);
            const bin = atob(j.content.replace(/\n/g, ''));
            const txt = new TextDecoder('utf-8').decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
            const list = JSON.parse(txt);
            GM_setValue('reviews', JSON.stringify(list));
            resolve(list);
          } catch (e) { reject(new Error('후기 목록을 읽지 못했습니다')); }
        },
        onerror: () => reject(new Error('깃허브에 연결하지 못했습니다')),
      });
    });
  }

  /* ---------- 글자 넣기 도구 ---------- */
  function setNative(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function pasteText(el, text) {
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const ok = el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    // 붙여넣기가 받아들여지지 않았으면 직접 넣기
    if (ok) document.execCommand('insertText', false, text);
  }
  function caretAtEnd(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  const editorEl = () => document.querySelector('.se-content [contenteditable="true"]') || document.querySelector('[contenteditable="true"]');
  const paraStarting = (prefix) =>
    [...document.querySelectorAll('.se-text-paragraph')].find((p) => p.textContent.trim().startsWith(prefix));

  async function fillTitle(title) {
    const t = document.querySelector('textarea[placeholder*="제목"], input[placeholder*="제목"]');
    if (!t) throw new Error('제목 칸을 못 찾았습니다');
    t.focus();
    setNative(t, title);
  }

  async function fillTags(tags) {
    const box = document.querySelector('input[placeholder*="태그"]');
    if (!box) throw new Error('태그 칸을 못 찾았습니다');
    for (const tag of tags) {
      box.focus();
      setNative(box, tag);
      await sleep(150);
      for (const type of ['keydown', 'keypress', 'keyup']) {
        box.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
      await sleep(250);
    }
  }

  /* ---------- 사진: 끌어다 놓기 시도 ---------- */
  function dropFiles(files) {
    const ed = editorEl();
    if (!ed) throw new Error('본문 칸을 못 찾았습니다');
    const dt = new DataTransfer();
    [...files].sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true })).forEach((f) => dt.items.add(f));
    ed.focus();
    for (const type of ['dragenter', 'dragover', 'drop']) {
      ed.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }
  }

  /* ---------- 사이트별 채우기 ---------- */
  async function fillMyCafe(r) {
    await fillTitle(r.title);
    const ed = editorEl();
    caretAtEnd(ed);
    pasteText(ed, r.body);
    await sleep(300);
    await fillTags(r.tags);
  }

  async function fillJimCafe(r) {
    await fillTitle(r.title);
    // 아래쪽 칸부터 채워야 위치가 밀리지 않습니다
    const p4 = paraStarting('(아래 후기를');
    if (!p4) throw new Error('④ 칸을 못 찾았습니다 (양식이 바뀌었는지 확인)');
    caretAtEnd(p4);
    document.execCommand('insertParagraph');
    pasteText(editorEl(), r.body + '\n' + r.youtube);
    await sleep(300);

    const p2 = paraStarting('② 구매 사이트');
    if (p2) { caretAtEnd(p2); document.execCommand('insertParagraph'); pasteText(editorEl(), shopOf(r.title)); }
    await sleep(200);
    const p1 = paraStarting('① 신청서');
    if (p1) { caretAtEnd(p1); document.execCommand('insertParagraph'); pasteText(editorEl(), r.no); }
    await sleep(200);

    // ③ 사진은 마지막 안내줄 끝에 커서를 둡니다
    const p3 = paraStarting('- 동일한 제품');
    if (p3) caretAtEnd(p3);
    await fillTags(r.tags);
  }

  async function fillJimSite(r) {
    const t = document.querySelector('input[type="text"][name*="title"], input[type="text"]');
    if (!t) throw new Error('제목 칸을 못 찾았습니다');
    setNative(t, r.title);
    const url = GM_getValue('lastCafeUrl', '');
    const html =
      (url ? `<p>카페 후기: <a href="${url}" target="_blank">${url}</a></p>` : '') +
      `<p>${r.body}</p><p>${r.youtube}</p>`;
    const ed = unsafeWindow.tinymce && unsafeWindow.tinymce.activeEditor;
    if (!ed) throw new Error('내용 칸(에디터)을 못 찾았습니다');
    ed.setContent(html);
  }

  /* ---------- 글 올린 뒤 주소 저장 (내 카페 글 보기 화면) ---------- */
  function rememberCafeUrl() {
    if (location.href.includes('/cafes/' + MY_CAFE) && /\/articles\/\d+/.test(location.pathname) && !/write/.test(location.pathname)) {
      GM_setValue('lastCafeUrl', location.origin + location.pathname);
    }
  }

  /* ---------- 화면 패널 ---------- */
  function mode() {
    if (location.hostname === 'www.jimpass.com') return 'jimsite';
    // 카페 글쓰기 화면: 제목 칸이 있으면 글쓰기 화면으로 봅니다 (주소 모양이 달라도 됨)
    const hasTitle = document.querySelector('textarea[placeholder*="제목"], input[placeholder*="제목"]');
    if (!hasTitle) return '';
    if (location.href.includes('/cafes/' + JIM_CAFE) || document.body.innerText.includes('카페 후기 양식')) return 'jimcafe';
    return 'mycafe';
  }

  function panel(m) {
    if (document.getElementById('lp-panel')) return;
    const box = document.createElement('div');
    box.id = 'lp-panel';
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:999999;background:#fff;border:2px solid #03c75a;border-radius:8px;padding:10px;font:13px sans-serif;width:260px;box-shadow:0 2px 8px #0003';
    box.innerHTML = `
      <b>후기 도우미</b> <span id="lp-st" style="color:#666"></span><br>
      <button id="lp-get" style="width:100%">최신 후기 받아오기</button>
      <input id="lp-txt" type="file" accept=".txt" title="txt 직접 고르기(예비)"><br>
      <select id="lp-sel" style="width:100%;margin:4px 0"></select>
      <button id="lp-fill" style="width:100%;margin:2px 0">제목·본문·태그 채우기</button>
      ${m === 'jimsite' ? '' : '<div style="margin-top:4px">사진(여러 장 선택)<input id="lp-pic" type="file" accept="image/*" multiple></div>'}
      <div id="lp-msg" style="margin-top:4px;color:#c00"></div>`;
    document.body.appendChild(box);
    const $ = (id) => box.querySelector('#' + id);
    const msg = (s) => ($('lp-msg').textContent = s);

    const refresh = () => {
      const all = loadAll();
      $('lp-sel').innerHTML = all.map((r, i) => `<option value="${i}">${r.no} ${r.title.slice(-24)}</option>`).join('');
      $('lp-sel').value = GM_getValue('idx', 0);
      $('lp-st').textContent = all.length ? all.length + '건' : '(txt 를 고르세요)';
    };
    refresh();
    const getLatest = async () => {
      try { msg('후기 목록 받는 중…'); await fetchReviews(); GM_setValue('idx', 0); refresh(); msg(''); }
      catch (err) { msg('실패: ' + err.message); }
    };
    $('lp-get').onclick = getLatest;
    getLatest();
    $('lp-txt').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const list = parseReviews(await f.text());
      GM_setValue('reviews', JSON.stringify(list));
      GM_setValue('idx', 0);
      refresh();
    };
    $('lp-sel').onchange = (e) => GM_setValue('idx', +e.target.value);
    $('lp-fill').onclick = async () => {
      const r = cur();
      if (!r) return msg('후기 txt 를 먼저 고르세요');
      try {
        msg('채우는 중…');
        if (m === 'mycafe') await fillMyCafe(r);
        if (m === 'jimcafe') {
          const board = document.body.innerText;
          if ((/미국 후기/.test(board) && /일본/.test(r.title)) || (/일본 후기/.test(board) && /미국/.test(r.title)))
            return msg('게시판 나라와 후기 나라가 다릅니다');
          await fillJimCafe(r);
        }
        if (m === 'jimsite') await fillJimSite(r);
        msg('채움 완료. 사진을 확인하고 등록은 직접 누르세요.');
      } catch (err) {
        msg('실패: ' + err.message);
        console.error('[후기도우미]', err);
      }
    };
    const pic = box.querySelector('#lp-pic');
    if (pic) pic.onchange = (e) => {
      try { dropFiles(e.target.files); msg('사진을 끌어놓기로 넣어 봤습니다. 안 들어갔으면 에디터의 사진 단추를 쓰세요.'); }
      catch (err) { msg('실패: ' + err.message); }
    };
  }

  rememberCafeUrl();
  // 화면이 나중에 바뀌는 사이트라 주기적으로 확인합니다
  setInterval(() => { rememberCafeUrl(); const m = mode(); if (m) panel(m); else { const p = document.getElementById('lp-panel'); if (p) p.remove(); } }, 1500);
})();
