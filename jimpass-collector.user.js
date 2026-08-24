// ==UserScript==
// @name         짐패스 신청서 자동 수집
// @namespace    https://github.com/wg052026
// @version      1.0.0
// @description  짐패스 마이페이지를 열면 신청서 목록을 읽어 kream-tools(Private) 우편함에 올린다. 새 신청서만 올린다.
// @author       wg052026
// @match        https://www.jimpass.com/mypage/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/jimpass-collector.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/jimpass-collector.user.js
// ==/UserScript==

/* 개인정보 분리 원칙(기존 규약)
   - 이 파일은 Public 저장소에 올라간다. 수취인·송장번호 같은 개인정보를 코드에 절대 넣지 않는다.
   - 깃허브 토큰도 코드에 박지 않고 GM_setValue 로 브라우저에만 둔다.
   - 긁은 자료는 Private 저장소(kream-tools)로만 보낸다.                                   */

(function () {
    'use strict';

    const REPO = 'wg052026/kream-tools';        // Private
    const PATH = 'mailbox/jimpass/신청서.json';
    const K_TOKEN = 'jimpass_gh_token';
    const K_SEEN = 'jimpass_seen';

    // ---------- 화면 표시 (사장님이 캡처를 번거로워하시므로 화면에 직접 알린다) ----------
    let box;
    function say(msg, color) {
        if (!box) {
            box = document.createElement('div');
            box.style.cssText =
                'position:fixed;right:16px;bottom:16px;z-index:999999;max-width:360px;' +
                'padding:12px 16px;border-radius:8px;font:14px/1.5 "맑은 고딕",sans-serif;' +
                'color:#fff;background:#333;box-shadow:0 4px 16px rgba(0,0,0,.3);white-space:pre-line';
            document.body.appendChild(box);
        }
        box.style.background = color || '#333';
        box.textContent = msg;
    }

    // ---------- 신청서 목록 파싱 ----------
    function parse() {
        const out = [];
        document.querySelectorAll('.form-no').forEach(head => {
            const h = head.innerText;
            const no = (h.match(/신청서번호\s*:\s*(\S+)/) || [, ''])[1].trim();
            if (!no) return;

            // 이 헤더가 속한 카드(주문번호가 보이는 상위 요소)를 찾는다
            let card = head;
            for (let i = 0; i < 8 && card.parentElement; i++) {
                card = card.parentElement;
                if (card.innerText.includes('주문번호')) break;
            }
            const t = card.innerText;
            const g = re => (t.match(re) || [, ''])[1].trim();

            out.push({
                신청서번호: no,
                수취인: (h.match(/수취인\s*:\s*(\S+)/) || [, ''])[1].trim(),
                송장번호: (h.match(/송장번호\s*:\s*(\S+)/) || [, ''])[1].trim(),
                아이템번호: g(/아이템번호\s*:\s*(\S+)/),
                분류: g(/(패션[^\n]*)/),
                영문상품명: g(/^([A-Z][A-Z0-9 .\-\/]{8,})$/m),
                주문번호: g(/주문번호\s*:\s*([^,\n]+)/),
                트래킹넘버: g(/트래킹넘버\s*:\s*([^,\n]+)/),
                브랜드: g(/브랜드\/셀러\s*:\s*([^,\n]+)/),
                색상: g(/색상\s*:\s*([^,\n]+)/),
                사이즈: g(/사이즈\s*:\s*([^,\n]+)/),
                신청일: g(/신청일\s*:\s*([^\/\n]+)/),
                발송일: g(/발송일\s*:\s*([^\/\n]+)/),
                수량: g(/수량\s*:\s*([^\/\n]+)/),
                단가: g(/단가\s*:\s*([^\/\n]+)/)
            });
        });
        return out;
    }

    // ---------- 깃허브 ----------
    function gh(method, path, body, cb) {
        const token = GM_getValue(K_TOKEN, '');
        if (!token) { say('깃허브 토큰이 없습니다.\nTampermonkey 메뉴 > 깃허브 토큰 설정', '#a33'); return; }
        GM_xmlhttpRequest({
            method,
            url: `https://api.github.com/repos/${REPO}/contents/${encodeURI(path)}`,
            headers: {
                'Authorization': 'Bearer ' + token,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json'
            },
            data: body ? JSON.stringify(body) : undefined,
            onload: r => cb(r.status, r.responseText),
            onerror: () => cb(0, '')
        });
    }

    function b64(str) {
        return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
    }
    function unb64(s) {
        return new TextDecoder().decode(
            Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
    }

    function upload(rows, allMode) {
        say(`신청서 ${rows.length}건 — 우편함에 올리는 중…`, '#357');
        gh('GET', PATH, null, (st, txt) => {
            let sha = null, old = [];
            if (st === 200) {
                try {
                    const j = JSON.parse(txt);
                    sha = j.sha;
                    old = JSON.parse(unb64(j.content)).신청서 || [];
                } catch (e) { /* 깨져 있으면 새로 쓴다 */ }
            }
            // 신청서번호 기준으로 합치기(같은 번호는 새 것으로 갱신)
            const map = new Map(old.map(x => [x.신청서번호, x]));
            rows.forEach(r => map.set(r.신청서번호, r));
            const merged = [...map.values()];

            const payload = {
                message: `짐패스 신청서 ${rows.length}건 (${new Date().toLocaleString('ko-KR')})`,
                content: b64(JSON.stringify({
                    갱신시각: new Date().toISOString(),
                    건수: merged.length,
                    신청서: merged
                }, null, 2)),
                branch: 'main'
            };
            if (sha) payload.sha = sha;

            gh('PUT', PATH, payload, (st2, txt2) => {
                if (st2 === 200 || st2 === 201) {
                    const seen = GM_getValue(K_SEEN, []);
                    rows.forEach(r => { if (!seen.includes(r.신청서번호)) seen.push(r.신청서번호); });
                    GM_setValue(K_SEEN, seen);
                    say(`올렸습니다 — 새 신청서 ${rows.length}건\n(우편함 누적 ${merged.length}건)\n` +
                        rows.map(r => `· ${r.신청서번호} ${r.색상 || ''} ${r.사이즈 || ''}`).join('\n'),
                        '#2a6');
                    setTimeout(() => box && box.remove(), 8000);
                } else {
                    say(`올리기 실패 (status=${st2})\n${String(txt2).slice(0, 200)}`, '#a33');
                }
            });
        });
    }

    // ---------- 실행 ----------
    function run(allMode) {
        const rows = parse();
        if (!rows.length) { if (allMode) say('이 화면에 신청서가 없습니다.', '#a33'); return; }
        const seen = GM_getValue(K_SEEN, []);
        const targets = allMode ? rows : rows.filter(r => !seen.includes(r.신청서번호));
        if (!targets.length) {
            say(`새 신청서 없음 (화면 ${rows.length}건, 전부 이미 올림)`, '#555');
            setTimeout(() => box && box.remove(), 4000);
            return;
        }
        upload(targets, allMode);
    }

    GM_registerMenuCommand('깃허브 토큰 설정', () => {
        const cur = GM_getValue(K_TOKEN, '');
        const v = prompt('kream-tools 저장소에 쓸 수 있는 깃허브 토큰을 넣어 주세요.\n(브라우저에만 저장됩니다)', cur);
        if (v !== null) { GM_setValue(K_TOKEN, v.trim()); alert('저장했습니다.'); }
    });
    GM_registerMenuCommand('지금 전부 다시 올리기', () => run(true));
    GM_registerMenuCommand('올린 기록 초기화', () => {
        GM_setValue(K_SEEN, []); alert('초기화했습니다. 다음 방문 때 전부 다시 올립니다.');
    });

    // 목록이 늦게 그려지는 경우가 있어 조금 기다렸다 실행
    setTimeout(() => run(false), 1500);
})();
