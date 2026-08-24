// ==UserScript==
// @name         네이버카페 후기 URL 자동 수집
// @namespace    https://github.com/wg052026
// @version      1.0.0
// @description  카페에 글을 올리면 그 주소를 우편함에 자동으로 담는다. Claude in Chrome 이 등록하면 옆에서 주워 담는 용도.
// @author       wg052026
// @match        https://cafe.naver.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/cafe-url-collector.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/cafe-url-collector.user.js
// ==/UserScript==

/* 왜 필요한가
   Claude in Chrome 이 카페에 후기를 등록해도 그 주소를 어디에 남길 방법이 없다.
   이 스크립트가 **글 상세 페이지가 열릴 때마다** 주소·제목을 읽어 우편함에 담는다.
   Claude in Chrome 과 서로 대화하지 않는다 — 글이 등록되면 상세 화면으로 넘어가고,
   그때 이 스크립트가 스스로 깨어난다.

   주의: Tampermonkey 는 브라우저마다 따로다. 웨일에 깔아 둔 것과 공유되지 않으므로
   토큰도 크롬에서 한 번 더 넣어야 한다. */

(function () {
    'use strict';

    const REPO = 'wg052026/kream-tools';          // Private
    const PATH = 'mailbox/cafe/후기링크.json';
    const K_TOKEN = 'gh_token';
    const CAFE = 'imagedd';                        // 후기 올리는 카페

    let box;
    function say(msg, color) {
        if (!box) {
            box = document.createElement('div');
            box.style.cssText =
                'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:400px;' +
                'padding:12px 16px;border-radius:8px;font:14px/1.6 "맑은 고딕",sans-serif;' +
                'color:#fff;background:#333;box-shadow:0 4px 16px rgba(0,0,0,.35);white-space:pre-line';
            document.body.appendChild(box);
        }
        box.style.background = color || '#333';
        box.textContent = msg;
    }

    function gh(method, path, body) {
        return new Promise(resolve => {
            const token = GM_getValue(K_TOKEN, '');
            if (!token) return resolve([0, '']);
            GM_xmlhttpRequest({
                method,
                url: `https://api.github.com/repos/${REPO}/contents/${encodeURI(path)}`,
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Accept': 'application/vnd.github+json',
                    'Content-Type': 'application/json'
                },
                data: body ? JSON.stringify(body) : undefined,
                onload: r => resolve([r.status, r.responseText]),
                onerror: () => resolve([0, ''])
            });
        });
    }
    const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    const unb64 = s => new TextDecoder().decode(
        Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));

    // ---------- 지금 화면이 '글 상세'인가 ----------
    // 주소 형태: https://cafe.naver.com/{카페ID}/{글번호}
    // 새 카페 UI는 /f-e/cafes/{숫자}/articles/{글번호} 로도 뜬다.
    function readArticle() {
        const u = location.href;
        let cafeId = null, no = null;

        let m = u.match(/cafe\.naver\.com\/([A-Za-z0-9_-]+)\/(\d+)/);
        if (m && m[1] !== 'f-e') { cafeId = m[1]; no = m[2]; }

        if (!no) {
            m = u.match(/\/f-e\/cafes\/\d+\/articles\/(\d+)/);
            if (m) { cafeId = CAFE; no = m[1]; }
        }
        if (!no) return null;

        // 제목 — 여러 UI를 다 훑는다
        const sel = ['.title_text', '.tit-box .title', 'h3.title_text',
                     '.ArticleTitle .title_text', 'h1', 'h2', 'h3'];
        let title = '';
        for (const s of sel) {
            const el = document.querySelector(s);
            const t = el && el.textContent.trim();
            if (t && t.length > 5) { title = t; break; }
        }
        // iframe 안에 들어 있는 옛 UI 대비
        if (!title) {
            try {
                const d = document.querySelector('#cafe_main')?.contentDocument;
                for (const s of sel) {
                    const t = d?.querySelector(s)?.textContent.trim();
                    if (t && t.length > 5) { title = t; break; }
                }
            } catch (e) {}
        }
        return { 주소: `https://cafe.naver.com/${cafeId}/${no}`, 글번호: no, 제목: title };
    }

    async function save(a, manual) {
        const [gs, gt] = await gh('GET', PATH);
        let sha = null, old = [];
        if (gs === 200) {
            try {
                const j = JSON.parse(gt);
                sha = j.sha;
                old = JSON.parse(unb64(j.content)).링크 || [];
            } catch (e) {}
        }
        if (!manual && old.some(x => x.글번호 === a.글번호)) return false;   // 이미 담음

        // 글번호를 열쇠로 덮어쓰기(누적)
        const map = new Map(old.map(x => [x.글번호, x]));
        map.set(a.글번호, { ...a, 수집시각: new Date().toISOString() });
        const merged = [...map.values()];

        const payload = {
            message: `카페 후기 링크 ${a.글번호} (누적 ${merged.length}) ${new Date().toLocaleString('ko-KR')}`,
            content: b64(JSON.stringify({
                갱신시각: new Date().toISOString(), 건수: merged.length, 링크: merged
            }, null, 2)),
            branch: 'main'
        };
        if (sha) payload.sha = sha;
        const [ps] = await gh('PUT', PATH, payload);
        if (ps === 200 || ps === 201) {
            say(`후기 링크를 담았습니다 (누적 ${merged.length})\n${a.제목 || '(제목 못 읽음)'}\n${a.주소}`, '#2a6');
            setTimeout(() => box && box.remove(), 6000);
            return true;
        }
        say(`담기 실패 (status=${ps})`, '#a33');
        return false;
    }

    async function run(manual) {
        if (!GM_getValue(K_TOKEN, '')) {
            if (manual) say('깃허브 토큰이 없습니다.\nTampermonkey 아이콘 > 깃허브 토큰 설정', '#a33');
            return;
        }
        const a = readArticle();
        if (!a) { if (manual) say('이 화면은 글 상세가 아닙니다.', '#555'); return; }
        const ok = await save(a, manual);
        if (!ok && manual) say('이미 담긴 글입니다.', '#555');
    }

    GM_registerMenuCommand('깃허브 토큰 설정', () => {
        const v = prompt('kream-tools 저장소에 쓸 수 있는 깃허브 토큰\n(이 브라우저에만 저장됩니다)',
                         GM_getValue(K_TOKEN, ''));
        if (v !== null) { GM_setValue(K_TOKEN, v.trim()); alert('저장했습니다.'); }
    });
    GM_registerMenuCommand('이 글 링크 담기', () => run(true));

    // 카페는 화면 전환이 잦아 주소가 바뀌면 다시 본다
    let last = '';
    setInterval(() => {
        if (location.href !== last) { last = location.href; setTimeout(() => run(false), 2500); }
    }, 1500);
    setTimeout(() => run(false), 2500);
})();
