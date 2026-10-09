// ==UserScript==
// @name         짐패스 후기 올리기 도우미
// @namespace    leplus
// @version      0.5.3
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
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const MY_CAFE = '11298080';
  const JIM_CAFE = '29931376';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- 자세한 로그 (복사해서 보낼 수 있게 모아 둡니다) ---------- */
  const LOG = [];
  const t0 = Date.now();
  function log(...a) {
    const line = '+' + String(Date.now() - t0).padStart(6, ' ') + 'ms ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    LOG.push(line);
    if (LOG.length > 600) LOG.shift();
    console.log('[후기도우미]', line);
  }
  // 에디터가 어떤 신호를 받고 막는지 기록합니다
  let spyOn = false;
  const spyCount = {};
  ['keydown', 'beforeinput', 'input', 'paste', 'cut', 'drop'].forEach((type) =>
    document.addEventListener(type, (ev) => {
      if (!spyOn) return;
      const key = ev.type + ':' + (ev.key || ev.inputType || '');
      spyCount[key] = (spyCount[key] || 0) + 1;
      if (spyCount[key] > 3) return;
      const info = { type: ev.type, 진짜입력: ev.isTrusted, 대상: (ev.target && (ev.target.className || ev.target.tagName) || '').toString().slice(0, 30), key: ev.key, inputType: ev.inputType };
      setTimeout(() => log('신호', info, '막힘=' + ev.defaultPrevented), 0);
    }, true)
  );
  let mutCount = 0;
  try {
    new MutationObserver((m) => { mutCount += m.length; }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  } catch (e) {}


  /* ---------- 기본 양식을 받는 통신 내용을 채워진 양식으로 바꿔치기 ---------- */
  const FORM_URL = /\/editor\/menus\/\d+\/form|\/editor\/v2\/cafes\/\d+\/editor/;
  function paraText(p) { return (p.nodes || []).map((n) => n.value || '').join(''); }
  function setParaText(p, v) {
    if (!p.nodes || !p.nodes.length) return false;
    p.nodes[0].value = v;
    for (let k = 1; k < p.nodes.length; k++) p.nodes[k].value = '';
    return true;
  }
  function fillDoc(docStr, r) {
    const doc = JSON.parse(docStr);
    const shop = shopOf(r.title);
    const want = [
      ['① 신청서', r.no],
      ['② 구매 사이트', shop],
      ['(아래 후기를', r.body],
    ];
    let done = 0;
    for (const comp of doc.components || []) {
      if (comp['@ctype'] !== 'text' || !Array.isArray(comp.value)) continue;
      const ps = comp.value;
      for (let i = 0; i < ps.length; i++) {
        const txt = paraText(ps[i]).trim();
        for (const [prefix, val] of want) {
          if (!txt.startsWith(prefix)) continue;
          const nxt = ps[i + 1];
          if (nxt && paraText(nxt).trim() === '') setParaText(nxt, val);   // 라벨 아래 빈 줄에 값을 넣음
          else setParaText(ps[i], paraText(ps[i]) + ' ' + val);               // 빈 줄이 없으면 라벨 뒤에 붙임
          done++;
        }
      }
    }
    return { json: JSON.stringify(doc), done };
  }
  function fillPlain(content, r) {
    const shop = shopOf(r.title);
    return content
      .replace(/(① [^\n]*\n)\n/, (m, a) => a + r.no + '\n')
      .replace(/(② [^\n]*\n)\n/, (m, a) => a + shop + '\n')
      .replace(/(\(아래 후기를 작성해 주세요\)\n)\n/, (m, a) => a + r.body + '\n');
  }
  function transformForm(text) {
    try {
      if (!location.href.includes('/cafes/' + JIM_CAFE)) return text;
      const r = cur();
      if (!r) { log('양식 바꿔치기 건너뜀: 후기 목록 없음'); return text; }
      const mid = (location.href.match(/\/menus\/(\d+)/) || [])[1];
      if ((mid === '25' && /일본/.test(r.title)) || (mid === '26' && /미국/.test(r.title))) {
        log('양식 바꿔치기 건너뜀: 게시판 나라와 후기 나라가 다름', mid, r.title.slice(0, 20));
        return text;
      }
      const j = JSON.parse(text);
      const f = j.result && (j.result.articleForm || j.result.form);
      if (!f || !f.contentDocumentJson) return text;
      const res = fillDoc(f.contentDocumentJson, r);
      if (res.done < 3) { log('양식 바꿔치기 건너뜀: 자리를 3곳 못 찾음', res.done); return text; }
      f.contentDocumentJson = res.json;
      if (typeof f.content === 'string') f.content = fillPlain(f.content, r);
      log('양식 바꿔치기 완료', r.no, '자리', res.done);
      GM_setValue('lastApplied', r.no);
      return JSON.stringify(j);
    } catch (e) {
      log('양식 바꿔치기 실패', e.message);
      return text;
    }
  }

  /* ---------- 네트워크 기록: 기본 양식이 어디서 오는지 찾습니다 ---------- */
  const NET = [];
  function netNote(kind, url, status, text) {
    if (NET.length > 300) return;
    const hit = text && text.indexOf('카페 후기 양식') >= 0;
    const u = String(url).replace(/^https?:\/\/[^/]+/, '').slice(0, 140);
    if (!hit && /\.(js|css|png|jpg|gif|svg|woff2?)(\?|$)/.test(u)) return;
    if (hit) {
      const i = text.indexOf('신청서 번호');
      NET.push('   [양식 앞부분] ' + JSON.stringify(text.slice(0, 300)));
      NET.push('   [양식 둘레] ' + JSON.stringify(text.slice(Math.max(0, i - 250), i + 700)));
      const j = text.indexOf('후기를 작성해');
      NET.push('   [④ 둘레] ' + JSON.stringify(text.slice(Math.max(0, j - 200), j + 500)));
    }
    NET.push('+' + String(Date.now() - t0).padStart(6, ' ') + 'ms ' + kind + ' ' + status + ' ' + u + (text ? ' 길이' + text.length : '') + (hit ? '  ★양식 글이 들어 있음★' : ''));
  }
  try {
    const W = unsafeWindow;
    const of = W.fetch;
    W.fetch = function (...a) {
      const u = a[0] && a[0].url ? a[0].url : a[0];
      return of.apply(this, a).then((res) => {
        try { res.clone().text().then((t) => netNote('fetch', u, res.status, t)).catch(() => netNote('fetch', u, res.status, '')); } catch (e) {}
        return res;
      });
    };
    const oo = W.XMLHttpRequest.prototype.open;
    W.XMLHttpRequest.prototype.open = function (m, u) {
      this.__lpUrl = u;
      if (FORM_URL.test(String(u))) {
        const self = this;
        let cache = null;
        const rt = Object.getOwnPropertyDescriptor(W.XMLHttpRequest.prototype, 'responseText');
        const rs = Object.getOwnPropertyDescriptor(W.XMLHttpRequest.prototype, 'response');
        const get = () => {
          if (cache === null) cache = transformForm(rt.get.call(self));
          return cache;
        };
        try {
          Object.defineProperty(this, 'responseText', { configurable: true, get });
          Object.defineProperty(this, 'response', { configurable: true, get: () => (self.responseType === '' || self.responseType === 'text' ? get() : rs.get.call(self)) });
        } catch (e) { log('응답 바꿔치기 설치 실패', e.message); }
      }
      this.addEventListener('load', () => {
        let t = '';
        try { t = typeof this.responseText === 'string' ? this.responseText : ''; } catch (e) {}
        netNote('xhr', this.__lpUrl, this.status, t);
      });
      return oo.apply(this, arguments);
    };
  } catch (e) { LOG.push('네트워크 기록 설치 실패 ' + e.message); }

  const snap = (label) => {
    const c = document.querySelector('.se-content');
    const sel = getSelection();
    log(label, { 본문글자: c ? c.innerText.replace(/\s+/g, '').length : -1, 문단수: document.querySelectorAll('.se-text-paragraph').length, 선택글자: sel.toString().length, 활성: (document.activeElement && (document.activeElement.className || document.activeElement.tagName) || '').toString().slice(0, 30), 화면변경누적: mutCount });
  };

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
  const boardCountry = () => {
    const m = (location.href.match(/\/cafes\/29931376\/menus\/(\d+)/) || [])[1];
    return m === '25' ? '미국' : m === '26' ? '일본' : '';
  };
  // 사이트별 진행: my=1번 내 카페, jim=2·3번 짐패스 카페, site=4번 짐패스 사이트
  const siteKey = () =>
    location.hostname === 'www.jimpass.com' ? 'site' : location.href.includes('/cafes/' + JIM_CAFE) ? 'jim' : 'my';
  const jget = (k, d) => { try { return JSON.parse(GM_getValue(k, d)); } catch (e) { return JSON.parse(d); } };
  const doneList = (key) => jget('done_' + key, '[]');
  const markDone = (key, no) => {
    const d = doneList(key);
    if (!d.includes(no)) { d.push(no); GM_setValue('done_' + key, JSON.stringify(d)); }
    log('완료 기록', key, no);
  };
  const urlOf = (no) => jget('urls', '{}')[no] || '';
  // 이 사이트에서 아직 안 올린 후기를 고릅니다 (고른 후기가 맞으면 그것, 아니면 첫 번째)
  const cur = () => {
    const all = loadAll();
    const key = siteKey();
    const done = doneList(key);
    const c = boardCountry();
    const ok = (r) =>
      r && !done.includes(r.no) && (!c || r.title.includes(c)) && (key !== 'site' || doneList('my').includes(r.no));
    const sel = all[GM_getValue('idx', 0)];
    if (ok(sel)) return sel;
    return all.find(ok) || null;
  };
  const shopOf = (title) =>
    /슈프림/.test(title) ? '슈프림' : /캐피탈/.test(title) ? '캐피탈' : '';


  /* ---------- 깃허브에서 최신 후기 목록 받기 ---------- */
  const REVIEWS_API = 'https://api.github.com/repos/wg052026/tacbae-jimpass-supreme-autofill/contents/reviews.json?ref=main';
  const REVIEWS_RAW = 'https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/reviews.json';
  function getOnce(url, isApi) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(),
        headers: isApi ? { Accept: 'application/vnd.github+json' } : {},
        onload: (res) => {
          try {
            if (res.status !== 200) throw new Error('응답 ' + res.status + ' ' + String(res.responseText).slice(0, 80));
            let txt = res.responseText;
            if (isApi) {
              const j = JSON.parse(txt);
              const bin = atob(j.content.replace(/\n/g, ''));
              txt = new TextDecoder('utf-8').decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
            }
            resolve(JSON.parse(txt));
          } catch (e) { reject(e); }
        },
        onerror: () => reject(new Error('연결 실패')),
        ontimeout: () => reject(new Error('시간 초과')),
      });
    });
  }
  async function fetchReviews() {
    let list = null;
    const errs = [];
    for (const [url, api] of [[REVIEWS_API, true], [REVIEWS_RAW, false]]) {
      try { list = await getOnce(url, api); log('후기 목록 받음', api ? 'API' : 'RAW', list.length); break; }
      catch (e) { errs.push((api ? 'API ' : 'RAW ') + e.message); log('후기 목록 받기 실패', api ? 'API' : 'RAW', e.message); }
    }
    if (!list) throw new Error('후기 목록을 읽지 못했습니다 (' + errs.join(' / ') + ')');
    GM_setValue('reviews', JSON.stringify(list));
    return list;
  }

  try { if (location.hostname === 'cafe.naver.com') fetchReviews().catch(() => {}); } catch (e) {}

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
    GM_setValue('pending_my', r.no);
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


  // 진단: 에디터 구조와 선택 상태를 모아 복사합니다 (붙여넣어 보내 주세요)
  function diagnose() {
    const out = [];
    out.push('주소 ' + location.href.slice(0, 80) + ' / 최상단창 ' + (window === window.top));
    const ces = [...document.querySelectorAll('[contenteditable]')];
    out.push('편집칸 ' + ces.length + '개');
    ces.slice(0, 8).forEach((e, i) =>
      out.push(i + ') <' + e.tagName.toLowerCase() + ' class="' + String(e.className).slice(0, 60) + '" ce=' + e.getAttribute('contenteditable') + ' 글자=' + (e.innerText || '').replace(/\s+/g, '').length + ' 부모=' + (e.parentElement ? String(e.parentElement.className).slice(0, 40) : '') + '>'));
    out.push('iframe ' + document.querySelectorAll('iframe').length + '개 / .se-content ' + document.querySelectorAll('.se-content').length + '개 / .se-component ' + document.querySelectorAll('.se-component').length + '개 / .se-text-paragraph ' + document.querySelectorAll('.se-text-paragraph').length + '개');
    const ed = editorEl();
    if (ed) {
      ed.focus();
      document.execCommand('selectAll');
      const sel = getSelection();
      out.push('전체선택 글자수 ' + sel.toString().replace(/\s+/g, '').length + ' / 시작노드 ' + (sel.anchorNode && (sel.anchorNode.className || sel.anchorNode.nodeName)) + ' / 끝노드 ' + (sel.focusNode && (sel.focusNode.className || sel.focusNode.nodeName)));
      out.push('활성요소 ' + (document.activeElement && (document.activeElement.className || document.activeElement.tagName)));
      document.addEventListener('beforeinput', function h(ev) { out.push('beforeinput ' + ev.inputType + ' 취소됨=' + ev.defaultPrevented); document.removeEventListener('beforeinput', h, true); }, true);
      const before = (ed.innerText || '').length;
      document.execCommand('delete');
      out.push('지우기 명령 결과 ' + before + ' → ' + (ed.innerText || '').length);
    }
    return out.join('\n');
  }

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
    // 이 에디터는 글이 보이는 칸이 아니라 숨은 입력칸으로 키를 받아 처리합니다. 키 신호를 직접 보내 봅니다.
    const keyAt = (el, k, code, kc, mods = {}) => {
      for (const type of ['keydown', 'keyup']) {
        el.dispatchEvent(new KeyboardEvent(type, Object.assign({ key: k, code, keyCode: kc, which: kc, bubbles: true, cancelable: true, composed: true }, mods)));
      }
    };
    const targets = () => [...new Set([ed, document.activeElement, ed.parentElement].filter(Boolean))];
    const methods = [
      ['Ctrl+A 신호 후 지움 키 신호', () => {
        ed.focus();
        targets().forEach((t) => keyAt(t, 'a', 'KeyA', 65, { ctrlKey: true }));
        targets().forEach((t) => keyAt(t, 'Backspace', 'Backspace', 8));
      }],
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
      ['글자 덮어쓰기', () => { selAll(); document.execCommand('insertText', false, ' '); }],
      ['틀 바꾸기', () => { selAll(); document.execCommand('insertHTML', false, '<p><br></p>'); }],
    ];
    const logArr = [];
    logArr.push('처음 ' + docText().replace(/\s+/g, '').length + '자');
    snap('지우기 시작');
    spyOn = true;
    for (const [name, run] of methods) {
      if (bodyEmpty() || countForm() === 0 && docText().trim().length < 3) return name === methods[0][0] ? '이미 비어 있음' : '이미 비어 있음';
      try { await run(); } catch (e) { console.log('[후기도우미] 지우기 방법 오류', name, e); }
      await sleep(500);
      const left = docText().replace(/\s+/g, '').length;
      console.log('[후기도우미] 지우기 시도', name, '남은 글자', left);
      logArr.push(name + ' ' + left);
      snap('지우기 시도 ' + name);
      if (left < 3) { spyOn = false; log('지우기 성공', name); return name; }
    }
    const rest = docText().replace(/\s+/g, ' ').trim().slice(0, 30);
    spyOn = false;
    throw new Error('본문을 자동으로 못 지웠습니다 [' + logArr.join(' / ') + '] 남은 글: "' + rest + '" 본문을 눌러 Ctrl+A, Delete 로 직접 지워 주세요');
  }

  async function fillJimCafe(r, report) {
    GM_setValue('pending_jim', r.no);
    log('채우기 시작(짐패스 카페)', r.no);
    await fillTitle(r.title);
    if (GM_getValue('lastApplied', '') === r.no && docText().includes(r.no)) {
      // 기본 양식이 이미 채워진 채로 열렸습니다. 유튜브만 넣으면 됩니다.
      report('양식은 이미 채워져 있습니다. 유튜브 링크 넣는 중…');
      try { await addYoutube(r.youtube); }
      catch (e) { report('유튜브는 링크 단추로 직접: ' + r.youtube); throw new Error('유튜브 링크 자동 입력 실패: ' + e.message); }
      return;
    }
    if (Date.now() - GM_getValue('autofillAt', 0) > 60000) {
      // 이 화면은 다른 후기로 열렸습니다. 새로고침하면 고른 후기로 양식이 채워진 채 열립니다.
      report('고른 후기로 양식을 다시 받기 위해 새로고침합니다…');
      GM_setValue('autofillAt', Date.now());
      log('새로고침 후 자동 채우기 예약', r.no);
      await sleep(300);
      location.reload();
      return;
    }
    snap('제목 입력 뒤');
    const ed = editorEl();
    if (!ed) throw new Error('본문 칸을 못 찾았습니다');
    console.log('[후기도우미] 시작 전 양식 개수', countForm());

    if (!bodyEmpty()) {
      report('기존 양식 지우는 중…');
      try {
        const how = await clearBody();
        console.log('[후기도우미] 지운 방법', how);
      } catch (e) {
        // 자동으로 안 지워지면 사용자가 Ctrl+A, Delete 로 비울 때까지 기다렸다가 그대로 이어갑니다
        for (let i = 0; i < 120 && !bodyEmpty(); i++) {
          report('본문을 눌러 Ctrl+A → Delete 로 비워 주세요. 비우면 자동으로 이어집니다 (' + (120 - i) + ')');
          await sleep(500);
        }
        if (!bodyEmpty()) throw new Error('본문이 비워지지 않아 멈췄습니다');
      }
    }
    report('양식 새로 넣는 중…');
    snap('양식 넣기 전');
    spyOn = true;
    ed.focus();
    pasteText(ed, jimForm(r));
    await sleep(700);
    if (countForm() === 0) {
      document.execCommand('insertText', false, jimForm(r));
      await sleep(500);
    }
    snap('양식 넣은 뒤');
    spyOn = false;
    if (countForm() !== 1 || !docText().includes(r.no)) throw new Error('양식이 제대로 들어가지 않았습니다 (개수 ' + countForm() + ')');
    report('유튜브 링크 넣는 중…');
    try { await addYoutube(r.youtube); }
    catch (e) { report('양식은 채웠습니다. 유튜브는 링크 단추로 직접: ' + r.youtube); throw new Error('유튜브 링크 자동 입력 실패: ' + e.message); }
  }

  async function fillJimSite(r) {
    GM_setValue('pending_site', r.no);
    const t = document.querySelector('input[type="text"][name*="title"], input[type="text"]');
    if (!t) throw new Error('제목 칸을 못 찾았습니다');
    setNative(t, r.title);
    const url = urlOf(r.no);
    const html =
      (url ? `<p>카페 후기: <a href="${url}" target="_blank">${url}</a></p>` : '') +
      `<p>${r.body}</p><p>${r.youtube}</p>`;
    const ed = unsafeWindow.tinymce && unsafeWindow.tinymce.activeEditor;
    if (!ed) throw new Error('내용 칸(에디터)을 못 찾았습니다');
    ed.setContent(html);
  }

  /* ---------- 글 올린 뒤 주소 저장 (내 카페 글 보기 화면) ---------- */
  function toast(t) {
    try {
      const d = document.createElement('div');
      d.textContent = t;
      d.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:999999;background:#03c75a;color:#fff;font:bold 15px sans-serif;padding:14px 18px;border-radius:8px;box-shadow:0 2px 8px #0005';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 6000);
    } catch (e) {}
  }
  function rememberCafeUrl() {
    const isView = /\/articles\/\d+/.test(location.pathname) && !/write/.test(location.pathname);
    if (location.href.includes('/cafes/' + MY_CAFE) && isView) {
      const no = GM_getValue('pending_my', '');
      if (no) {
        const u = jget('urls', '{}');
        u[no] = location.origin + location.pathname;
        GM_setValue('urls', JSON.stringify(u));
        GM_setValue('lastCafeUrl', u[no]);
        markDone('my', no);
        GM_setValue('pending_my', '');
        toast('후기 도우미: ' + no + ' 글 주소를 저장했습니다 (1번 완료)');
      } else if (!window.__lpNoPend) {
        window.__lpNoPend = true;
        toast('후기 도우미: 이 글은 도우미로 채운 글이 아니라 저장하지 않았습니다');
      }
    }
    if (location.href.includes('/cafes/' + JIM_CAFE) && isView) {
      const no = GM_getValue('pending_jim', '');
      if (no) { markDone('jim', no); GM_setValue('pending_jim', ''); toast('후기 도우미: ' + no + ' 카페 등록 완료로 기록했습니다'); }
    }
    if (location.hostname === 'www.jimpass.com' && /\/article\/(view|list)\//.test(location.pathname)) {
      const no = GM_getValue('pending_site', '');
      if (no) { markDone('site', no); GM_setValue('pending_site', ''); }
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
    if (!document.body || document.getElementById('lp-panel')) return;
    const box = document.createElement('div');
    box.id = 'lp-panel';
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:999999;background:#fff;border:2px solid #03c75a;border-radius:8px;padding:10px;font:13px sans-serif;width:280px;box-shadow:0 2px 8px #0003';
    box.innerHTML = `
      <b>후기 도우미</b> <span id="lp-st" style="color:#666"></span><br>
      <button id="lp-get" style="width:100%;padding:6px;font-size:13px;cursor:pointer">최신 후기 받아오기</button>
      <input id="lp-sel" type="hidden"><div id="lp-list" style="max-height:200px;overflow:auto;border:1px solid #ccc;border-radius:4px;margin:4px 0"></div>
      <button id="lp-diag" style="width:100%;margin-top:6px;padding:4px;font-size:12px;cursor:pointer">📋 로그 복사</button>
      <button id="lp-clear" style="width:100%;margin-top:6px;padding:6px;font-size:13px;cursor:pointer">🗑 본문 지우기</button>
      <button id="lp-done" style="width:100%;margin:2px 0">✔ 이 후기 완료/취소 표시</button>
      <button id="lp-fill" style="width:100%;margin:6px 0 2px;padding:14px 0;font-size:17px;font-weight:bold;color:#fff;background:#03c75a;border:0;border-radius:6px;cursor:pointer">▶ 채우기</button>
      <div id="lp-msg" style="margin-top:4px;color:#c00"></div>`;
    document.body.appendChild(box);
    const $ = (id) => box.querySelector('#' + id);
    const msg = (s) => ($('lp-msg').textContent = s);

    const refresh = () => {
      const all = loadAll();
      const dn = doneList(siteKey());
      const c0 = cur();
      let pick = c0 ? all.indexOf(c0) : +GM_getValue('idx', 0);
      if ($('lp-sel').dataset.user === '1') pick = +$('lp-sel').value;
      $('lp-sel').value = pick;
      const c = boardCountry();
      $('lp-list').innerHTML = all.map((r, i) => {
        const d = dn.includes(r.no);
        const country = r.title.includes('일본') ? '일본' : r.title.includes('미국') ? '미국' : '';
        const off = (c && country && c !== country) || (siteKey() === 'site' && !doneList('my').includes(r.no));
        return `<label style="display:block;padding:4px 6px;border-bottom:1px solid #eee;cursor:pointer;${d ? 'color:#999;text-decoration:line-through;' : ''}${off && !d ? 'color:#bbb;' : ''}">
          <input type="radio" name="lp-pick" value="${i}" ${i === pick ? 'checked' : ''}> ${d ? '✔ ' : ''}${country} ${r.no} ${r.title.replace(/^.*이용 후기\s*/, '').slice(0, 22)}</label>`;
      }).join('') || '<div style="padding:6px;color:#999">후기가 없습니다</div>';
      $('lp-list').querySelectorAll('input[name=lp-pick]').forEach((el) => {
        el.onchange = () => { $('lp-sel').value = el.value; $('lp-sel').dataset.user = '1'; GM_setValue('idx', +el.value); };
      });
      $('lp-st').textContent = all.length ? '이 사이트 ' + all.filter((r) => dn.includes(r.no)).length + '/' + all.length + ' 완료' : '(받아오기를 누르세요)';
    };
    refresh();
    const getLatest = async () => {
      try { msg('후기 목록 받는 중…'); await fetchReviews(); GM_setValue('idx', 0); refresh(); msg(''); }
      catch (err) { msg('실패: ' + err.message); }
    };
    $('lp-get').onclick = getLatest;
    getLatest();
    $('lp-done').onclick = () => {
      const all = loadAll();
      const r = all[$('lp-sel').value];
      if (!r) return;
      const key = siteKey();
      const d = doneList(key);
      const nd = d.includes(r.no) ? d.filter((x) => x !== r.no) : d.concat(r.no);
      GM_setValue('done_' + key, JSON.stringify(nd));
      refresh();
      msg(r.no + (nd.includes(r.no) ? ' 완료로 표시' : ' 완료 표시 취소'));
    };
    $('lp-diag').onclick = async () => {
      const t = diagnose() + '\n\n=== 네트워크 ===\n' + NET.join('\n') + '\n\n=== 로그 ===\n' + LOG.join('\n');
      try { await navigator.clipboard.writeText(t); msg('진단 내용을 복사했습니다. 대화창에 붙여넣어 보내 주세요'); }
      catch (e) { msg('복사 실패. 아래 내용을 직접 복사하세요'); prompt('진단 내용', t); }
    };
    $('lp-clear').onclick = async () => {
      try {
        if (m === 'jimsite') { const ed = unsafeWindow.tinymce && unsafeWindow.tinymce.activeEditor; if (ed) ed.setContent(''); return msg('본문을 지웠습니다'); }
        msg('지우는 중…');
        const how = await clearBody();
        msg('본문을 지웠습니다 (' + how + ')');
      } catch (err) { msg('실패: ' + err.message); console.error('[후기도우미]', err); }
    };
    if (m === 'jimcafe' && Date.now() - GM_getValue('autofillAt', 0) < 40000) {
      setTimeout(() => { log('새로고침 뒤 자동 채우기 시작'); $('lp-fill').click(); }, 3500);
    }
    $('lp-fill').onclick = async () => {
      const r = cur();
      if (!r) return msg(loadAll().length ? '이 사이트에 올릴 후기가 더 없습니다 (모두 완료). 다시 올리려면 목록에서 줄을 체크하고 ✔ 완료/취소 단추를 누르세요' : '최신 후기 받아오기를 먼저 누르세요');
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
