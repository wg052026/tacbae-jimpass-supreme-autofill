// ==UserScript==
// @name         짐패스 후기 올리기 도우미
// @namespace    leplus
// @version      0.2.9
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
  // 붙여넣기 신호만 보냅니다. 에디터가 받아 처리하면 끝, 안 받았을 때만 호출한 쪽에서 직접 넣습니다.
  function pasteText(el, text) {
    const sel = getSelection();
    if (!(sel.rangeCount && el.contains(sel.anchorNode))) el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }
  // 에디터가 자기 커서를 갱신하도록, 그 줄을 실제로 누른 것처럼 신호를 보냅니다.
  function clickLike(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.right - 2, clientY: r.top + r.height / 2 };
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(t, o));
    }
    document.dispatchEvent(new Event('selectionchange'));
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


  /* ---------- 사이트별 채우기 ---------- */
  async function fillMyCafe(r) {
    await fillTitle(r.title);
    const ed = editorEl();
    caretAtEnd(ed);
    pasteText(ed, r.body);
    await sleep(300);
    await fillTags(r.tags);
  }

  const editorText = () => (editorEl() ? editorEl().innerText : '');

  // 한 칸 채우기: 해당 줄 끝에 커서를 두고 붙여 넣은 뒤, 정말 그 자리에 들어갔는지 확인
  const flat = (t) => (t || '').replace(/\s+/g, ' ');
  async function putAfter(prefix, text, label, nextMarker) {
    const p = paraStarting(prefix);
    if (!p) throw new Error(label + ' 칸을 못 찾았습니다 (양식이 바뀌었는지 확인)');
    const target = p.closest('[contenteditable="true"]') || editorEl();
    const probe = flat(text).slice(0, 12);
    if (flat(document.body.innerText).includes(probe) && label !== '② 구매처' && label !== '① 신청서 번호')
      throw new Error(label + ': 이미 들어가 있습니다. 글쓰기 화면을 새로고침한 뒤 다시 누르세요');
    caretAtEnd(p);
    clickLike(p);
    caretAtEnd(p);
    pasteText(target, '\n' + text);
    await sleep(500);
    let seen = flat(document.body.innerText);
    if (!seen.includes(probe)) {          // 에디터가 신호를 안 받았으면 직접 넣기
      document.execCommand('insertText', false, '\n' + text);
      await sleep(400);
      seen = flat(document.body.innerText);
    }
    const at = seen.indexOf(probe);
    const mk = nextMarker ? seen.indexOf(nextMarker) : -1;
    console.log('[후기도우미]', label, '위치', at, '다음칸', mk);
    if (at < 0) throw new Error(label + ' 내용이 들어가지 않았습니다');
    if (mk >= 0 && at > mk) {
      document.execCommand('undo');
      throw new Error(label + ' 내용이 엉뚱한 자리(맨 아래)로 들어가 되돌렸습니다');
    }
  }

  // 유튜브 주소는 에디터의 「링크」 단추로 넣어야 미리보기 카드가 됩니다
  async function addYoutube(url) {
    const btn =
      document.querySelector('button.se-oglink-toolbar-button') ||
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '링크');
    if (!btn) throw new Error('링크 단추를 못 찾았습니다');
    btn.click();
    let input = null;
    for (let i = 0; i < 20 && !input; i++) {
      await sleep(250);
      input = document.querySelector('.se-popup input[type="text"], .se-popup-oglink input, input[placeholder*="URL"], input[placeholder*="링크"]');
    }
    if (!input) throw new Error('링크 입력 칸이 열리지 않았습니다');
    input.focus();
    setNative(input, url);
    await sleep(200);
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
    await sleep(600);
    const ok = [...document.querySelectorAll('.se-popup button, .se-popup-button')].find((b) => /확인|추가|등록/.test(b.textContent));
    if (ok) ok.click();
  }

  // 기존 양식을 지우고, 값이 채워진 양식 전체를 새로 넣습니다
  function jimForm(r) {
    return [
      '★ ★ ★ 카페 후기 양식 ★ ★ ★',
      '',
      '① 신청서 번호 (지오패스의 경우 주문번호를 작성) :',
      r.no,
      '',
      '② 구매 사이트(사이트명 or URL주소) :',
      shopOf(r.title),
      '',
      '③ 구매 상품 사진 ( ★ 총 5장 업로드 ★ )',
      '- 배송된 박스사진 1장 + 물품사진 4장 이상 또는 구매 물품 사진만 5장 이상',
      '- 포장지나 뽁뽁이 제거한 제품이 보이는 사진이어야합니다',
      '- 동일한 제품 촬영 컷은 해당 되지 않습니다.',
      '',
      '',
      '',
      '④ 후기글 (200자 이상 작성) :',
      r.body,
      '',
      '',
      '※ 배송 완료일을 꼭 체크하시고 후기글 작성해주세요. (배송 완료일로부터 한달이내 작성)',
      '      ex) 배송 완료일이 1월 1일일 경우 2월 1일 작성건은 해당되지 않음.',
      '※ 등록하신 후기는 짐패스 홈페이지에 노출 될 수 있으니 이 점 참고 부탁드립니다.',
    ].join('\n');
  }

  // 본문 전체 글자 (에디터 칸이 여러 개로 나뉘어 있어도 전체를 봅니다)
  const docText = () => {
    const c = document.querySelector('.se-content') || document.querySelector('.se-viewer') || document.body;
    return c.innerText || '';
  };
  const countForm = () => (docText().match(/카페 후기 양식/g) || []).length;

  // 본문 비우기: 에디터가 받아 주는 방법이 나올 때까지 차례로 시도하고, 어떤 방법이 먹혔는지 알려 줍니다
  const bodyEmpty = () => docText().replace(/\s+/g, '').length === 0;
  async function clearBody() {
    const ed = editorEl();
    if (!ed) throw new Error('본문 칸을 못 찾았습니다');
    const selAll = () => { ed.focus(); document.execCommand('selectAll'); };
    const key = (k, code, kc) => {
      for (const type of ['keydown', 'keyup']) {
        ed.dispatchEvent(new KeyboardEvent(type, { key: k, code, keyCode: kc, which: kc, bubbles: true, cancelable: true }));
      }
    };
    const methods = [
      ['지우기 명령', () => { selAll(); document.execCommand('delete'); }],
      ['입력 신호(삭제)', () => {
        selAll();
        ed.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
      }],
      ['오려내기 신호', () => {
        selAll();
        const dt = new DataTransfer();
        ed.dispatchEvent(new ClipboardEvent('cut', { clipboardData: dt, bubbles: true, cancelable: true }));
      }],
      ['지움 키', () => { selAll(); key('Backspace', 'Backspace', 8); }],
      ['삭제 키', () => { selAll(); key('Delete', 'Delete', 46); }],
      ['빈 글 덮어쓰기', () => { selAll(); pasteText(ed, ' '); }],
    ];
    for (const [name, run] of methods) {
      if (bodyEmpty() || countForm() === 0 && docText().trim().length < 3) return name === methods[0][0] ? '이미 비어 있음' : '이미 비어 있음';
      try { run(); } catch (e) { console.log('[후기도우미] 지우기 방법 오류', name, e); }
      await sleep(500);
      const left = docText().replace(/\s+/g, '').length;
      console.log('[후기도우미] 지우기 시도', name, '남은 글자', left);
      if (left < 3) return name;
    }
    throw new Error('본문을 자동으로 못 지웠습니다. 본문을 눌러 Ctrl+A, Delete 로 직접 지워 주세요');
  }

  async function fillJimCafe(r, report) {
    await fillTitle(r.title);
    const ed = editorEl();
    if (!ed) throw new Error('본문 칸을 못 찾았습니다');
    console.log('[후기도우미] 시작 전 양식 개수', countForm());

    if (!bodyEmpty()) {
      report('기존 양식 지우는 중…');
      const how = await clearBody();
      console.log('[후기도우미] 지운 방법', how);
    }
    report('양식 새로 넣는 중…');
    ed.focus();
    pasteText(ed, jimForm(r));
    await sleep(700);
    if (countForm() === 0) {
      document.execCommand('insertText', false, jimForm(r));
      await sleep(500);
    }
    console.log('[후기도우미] 넣은 뒤 양식 개수', countForm());
    if (countForm() !== 1 || !docText().includes(r.no)) throw new Error('양식이 제대로 들어가지 않았습니다 (개수 ' + countForm() + ')');
    report('유튜브 링크 넣는 중…');
    try { await addYoutube(r.youtube); }
    catch (e) { report('양식은 채웠습니다. 유튜브는 링크 단추로 직접: ' + r.youtube); throw new Error('유튜브 링크 자동 입력 실패: ' + e.message); }
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
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:999999;background:#fff;border:2px solid #03c75a;border-radius:8px;padding:10px;font:13px sans-serif;width:280px;box-shadow:0 2px 8px #0003';
    box.innerHTML = `
      <b>후기 도우미</b> <span id="lp-st" style="color:#666"></span><br>
      <button id="lp-get" style="width:100%;padding:6px;font-size:13px;cursor:pointer">최신 후기 받아오기</button>
      <select id="lp-sel" style="width:100%;margin:4px 0"></select>
      <button id="lp-clear" style="width:100%;margin-top:6px;padding:6px;font-size:13px;cursor:pointer">🗑 본문 지우기</button>
      <button id="lp-fill" style="width:100%;margin:6px 0 2px;padding:14px 0;font-size:17px;font-weight:bold;color:#fff;background:#03c75a;border:0;border-radius:6px;cursor:pointer">▶ 채우기</button>
      <div id="lp-msg" style="margin-top:4px;color:#c00"></div>`;
    document.body.appendChild(box);
    const $ = (id) => box.querySelector('#' + id);
    const msg = (s) => ($('lp-msg').textContent = s);

    const refresh = () => {
      const all = loadAll();
      $('lp-sel').innerHTML = all.map((r, i) => `<option value="${i}">${r.no} ${r.title.slice(-24)}</option>`).join('');
      $('lp-sel').value = GM_getValue('idx', 0);
      $('lp-st').textContent = all.length ? all.length + '건' : '(받아오기를 누르세요)';
    };
    refresh();
    const getLatest = async () => {
      try { msg('후기 목록 받는 중…'); await fetchReviews(); GM_setValue('idx', 0); refresh(); msg(''); }
      catch (err) { msg('실패: ' + err.message); }
    };
    $('lp-get').onclick = getLatest;
    getLatest();
    $('lp-sel').onchange = (e) => GM_setValue('idx', +e.target.value);
    $('lp-clear').onclick = async () => {
      try {
        if (m === 'jimsite') { const ed = unsafeWindow.tinymce && unsafeWindow.tinymce.activeEditor; if (ed) ed.setContent(''); return msg('본문을 지웠습니다'); }
        msg('지우는 중…');
        const how = await clearBody();
        msg('본문을 지웠습니다 (' + how + ')');
      } catch (err) { msg('실패: ' + err.message); console.error('[후기도우미]', err); }
    };
    $('lp-fill').onclick = async () => {
      const r = cur();
      if (!r) return msg('최신 후기 받아오기를 먼저 누르세요');
      try {
        msg('채우는 중…');
        if (m === 'mycafe') await fillMyCafe(r);
        if (m === 'jimcafe') {
          const board = document.body.innerText;
          if ((/미국 후기/.test(board) && /일본/.test(r.title)) || (/일본 후기/.test(board) && /미국/.test(r.title)))
            return msg('게시판 나라와 후기 나라가 다릅니다');
          await fillJimCafe(r, msg);
        }
        if (m === 'jimsite') await fillJimSite(r);
        msg('채움 완료. 사진을 끌어다 넣고, 등록은 직접 누르세요.');
      } catch (err) {
        msg('실패: ' + err.message);
        console.error('[후기도우미]', err);
      }
    };
  }

  rememberCafeUrl();
  // 화면이 나중에 바뀌는 사이트라 주기적으로 확인합니다
  setInterval(() => { rememberCafeUrl(); const m = mode(); if (m) panel(m); else { const p = document.getElementById('lp-panel'); if (p) p.remove(); } }, 1500);
})();
