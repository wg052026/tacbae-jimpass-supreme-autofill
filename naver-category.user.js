// ==UserScript==
// @name         네이버쇼핑 카테고리 자동 조회
// @namespace    https://github.com/wg052026
// @version      1.0.1
// @description  우편함에 쌓인 검색어를 네이버쇼핑에서 조회해 카테고리 경로/코드를 되돌려준다. Claude가 상품 등록 엑셀에 쓴다.
// @author       wg052026
// @match        https://search.shopping.naver.com/*
// @match        https://msearch.shopping.naver.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/naver-category.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/naver-category.user.js
// ==/UserScript==

/* 왜 필요한가
   네이버쇼핑은 서버에서 접근하면 403/418로 막는다(스텔스 프록시·한국IP도 안 됨).
   스마트스토어 상품 페이지도 490. 그래서 Claude가 카테고리를 확인할 방법이 없어
   추정으로 넣다가 틀린 적이 있다(폴로를 니트>풀오버로 넣음).
   사장님 브라우저는 정상 접속되므로, 여기서 대신 조회해 우편함에 넣어 준다.

   개인정보 없음 — 검색어와 카테고리 코드만 오간다. 다만 토큰은 코드에 박지 않는다. */

(function () {
    'use strict';

    const REPO = 'wg052026/kream-tools';          // Private
    const REQ = 'mailbox/naver/요청.json';         // Claude가 넣는 검색어
    const RES = 'mailbox/naver/카테고리.json';     // 스크립트가 채우는 결과
    const K_TOKEN = 'gh_token';

    let box;
    function say(msg, color) {
        if (!box) {
            box = document.createElement('div');
            box.style.cssText =
                'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:420px;' +
                'padding:12px 16px;border-radius:8px;font:14px/1.6 "맑은 고딕",sans-serif;' +
                'color:#fff;background:#333;box-shadow:0 4px 16px rgba(0,0,0,.35);white-space:pre-line';
            document.body.appendChild(box);
        }
        box.style.background = color || '#333';
        box.textContent = msg;
    }

    // ---------- 깃허브 ----------
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

    // ---------- 네이버쇼핑 조회 ----------
    // 페이지 컨텍스트 fetch 라 쿠키·헤더가 그대로 붙어 차단되지 않는다.
    async function lookup(keyword) {
        const url = 'https://search.shopping.naver.com/api/search/all'
                  + `?query=${encodeURIComponent(keyword)}&pagingIndex=1&pagingSize=20`
                  + '&productSet=total&sort=rel';
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error('status=' + r.status);
        const j = await r.json();
        const list = (j?.shoppingResult?.products) || [];
        if (!list.length) return null;

        // 최상단부터 카테고리가 채워진 첫 상품을 쓴다
        for (const p of list) {
            if (!p.category1Name) continue;
            const path = [p.category1Name, p.category2Name, p.category3Name, p.category4Name]
                         .filter(Boolean);
            return {
                검색어: keyword,
                상품명: p.productTitle || p.productName || '',
                카테고리경로: path.join(' > '),
                카테고리코드: p.category4Id || p.category3Id || p.category2Id || p.category1Id || '',
                코드들: {
                    c1: p.category1Id || '', c2: p.category2Id || '',
                    c3: p.category3Id || '', c4: p.category4Id || ''
                },
                최저가: p.lowPrice || '',
                조회시각: new Date().toISOString()
            };
        }
        return null;
    }

    // ---------- 실행 ----------
    async function run(manual) {
        say('카테고리 조회기 v1.0.1 — 확인 중…', '#357');
        if (!GM_getValue(K_TOKEN, '')) {
            say('깃허브 토큰이 없습니다.\nTampermonkey 아이콘 > 깃허브 토큰 설정 에서 넣어 주세요.', '#a33');
            return;
        }
        const [st, txt] = await gh('GET', REQ);
        if (st !== 200) {
            say(`우편함을 못 읽었습니다 (status=${st})\n토큰 권한이나 파일 경로를 확인해 주세요.\n` +
                'mailbox/naver/요청.json', '#a33');
            return;
        }

        let req;
        try { req = JSON.parse(unb64(JSON.parse(txt).content)); }
        catch (e) { say('요청 파일을 못 읽었습니다', '#a33'); return; }

        const todo = (req.검색어 || []).filter(k => k && k.trim());
        if (!todo.length) {
            say('처리할 검색어가 없습니다 — 요청 우편함이 비어 있습니다.', '#555');
            setTimeout(() => box && box.remove(), 5000);
            return;
        }

        say(`카테고리 조회 시작 — ${todo.length}건`, '#357');
        const out = [];
        for (let i = 0; i < todo.length; i++) {
            const k = todo[i];
            say(`조회 중 ${i + 1}/${todo.length}\n${k}`, '#357');
            try {
                const r = await lookup(k);
                out.push(r || { 검색어: k, 결과: '검색 결과 없음' });
            } catch (e) {
                out.push({ 검색어: k, 결과: '조회 실패 — ' + e.message });
            }
            await new Promise(s => setTimeout(s, 1500));   // 과속 방지
        }

        // 결과 저장
        const [gs, gt] = await gh('GET', RES);
        let sha = null;
        if (gs === 200) { try { sha = JSON.parse(gt).sha; } catch (e) {} }
        const payload = {
            message: `네이버 카테고리 ${out.length}건 (${new Date().toLocaleString('ko-KR')})`,
            content: b64(JSON.stringify({
                갱신시각: new Date().toISOString(), 건수: out.length, 결과: out
            }, null, 2)),
            branch: 'main'
        };
        if (sha) payload.sha = sha;
        const [ps] = await gh('PUT', RES, payload);

        if (ps === 200 || ps === 201) {
            // 처리한 요청은 비워 둔다 (같은 걸 또 돌지 않게)
            const [rs, rt] = await gh('GET', REQ);
            if (rs === 200) {
                const j = JSON.parse(rt);
                await gh('PUT', REQ, {
                    message: '요청 처리 완료 — 비움',
                    content: b64(JSON.stringify({ 검색어: [], 처리시각: new Date().toISOString() }, null, 2)),
                    sha: j.sha, branch: 'main'
                });
            }
            say('올렸습니다 — ' + out.length + '건\n' +
                out.map(r => `· ${r.검색어}\n   ${r.카테고리경로 || r.결과} ${r.카테고리코드 || ''}`).join('\n'),
                '#2a6');
        } else {
            say(`결과 올리기 실패 (status=${ps})`, '#a33');
        }
    }

    GM_registerMenuCommand('깃허브 토큰 설정', () => {
        const v = prompt('kream-tools 저장소에 쓸 수 있는 깃허브 토큰\n(브라우저에만 저장됩니다)',
                         GM_getValue(K_TOKEN, ''));
        if (v !== null) { GM_setValue(K_TOKEN, v.trim()); alert('저장했습니다.'); }
    });
    GM_registerMenuCommand('지금 카테고리 조회', () => run(true));
    GM_registerMenuCommand('이 화면 상품 카테고리 보기', async () => {
        const k = prompt('검색어를 넣어 주세요');
        if (!k) return;
        try { const r = await lookup(k); say(JSON.stringify(r, null, 1), '#357'); }
        catch (e) { say('실패 — ' + e.message, '#a33'); }
    });

    setTimeout(() => run(false), 2000);
})();
