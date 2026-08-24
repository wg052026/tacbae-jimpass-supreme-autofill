// ==UserScript==
// @name         네이버쇼핑 카테고리 자동 조회
// @namespace    https://github.com/wg052026
// @version      1.4.0
// @description  우편함에 쌓인 검색어를 네이버쇼핑에서 조회해 카테고리 경로/코드를 되돌려준다. Claude가 상품 등록 엑셀에 쓴다.
// @author       wg052026
// @match        https://shopping.naver.com/*
// @match        https://search.shopping.naver.com/*
// @match        https://msearch.shopping.naver.com/*
// @match        https://m.shopping.naver.com/*
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
    // [v1.3.0] 내부 API를 fetch 하면 418(봇 판정)이 난다 — 브라우저 안에서 불러도 막힌다.
    // 그래서 **검색 페이지로 실제 이동**해서, 페이지가 스스로 그려 넣은 __NEXT_DATA__ 에서
    // 카테고리를 꺼낸다. 사람이 검색한 것과 똑같은 요청이라 막히지 않는다.
    function pickFromPage() {
        // ① __NEXT_DATA__ (가장 확실)
        const el = document.getElementById('__NEXT_DATA__');
        if (el) {
            try {
                const j = JSON.parse(el.textContent);
                // [v1.4.0] 예전엔 "카테고리가 있는 첫 상품"을 집었는데, 그게 검색어와
                // 다른 상품이라 엉뚱한 카테고리를 가져온 적이 있다(폴로 → 니트>풀오버).
                // **검색어 단어가 가장 많이 겹치는 상품**을 고른다.
                const cands = [];
                const stack = [j];
                while (stack.length) {
                    const o = stack.pop();
                    if (!o || typeof o !== 'object') continue;
                    if (o.category1Name && (o.productTitle || o.productName)) cands.push(o);
                    for (const k in o) stack.push(o[k]);
                }
                if (cands.length) {
                    const q = (new URLSearchParams(location.search).get('query') || '')
                              .replace(/[^가-힣A-Za-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 1);
                    const score = o => {
                        const t = String(o.productTitle || o.productName || '')
                                  .replace(/<[^>]+>/g, '').toLowerCase();
                        return q.reduce((n, w) => n + (t.includes(w.toLowerCase()) ? 1 : 0), 0);
                    };
                    cands.sort((a, b) => score(b) - score(a));
                    const best = cands[0];
                    best._매칭점수 = `${score(best)}/${q.length}`;
                    return best;
                }
            } catch (e) {}
        }
        // ② 화면의 카테고리 경로 표시(있으면)
        const crumb = [...document.querySelectorAll('a')]
            .filter(a => /\/category\//.test(a.getAttribute('href') || ''))
            .map(a => a.textContent.trim()).filter(Boolean);
        if (crumb.length) return { _crumb: crumb };
        return null;
    }

    function shape(keyword, p) {
        if (!p) return { 검색어: keyword, 결과: '검색 결과에서 카테고리를 못 찾음' };
        if (p._crumb) {
            return { 검색어: keyword, 카테고리경로: p._crumb.join(' > '),
                     카테고리코드: '', 조회시각: new Date().toISOString(),
                     비고: '화면 표시에서 읽음 — 코드는 마스터 파일에서 대조 필요' };
        }
        const path = [p.category1Name, p.category2Name, p.category3Name, p.category4Name].filter(Boolean);
        return {
            검색어: keyword,
            상품명: p.productTitle || p.productName || '',
            카테고리경로: path.join(' > '),
            카테고리코드: p.category4Id || p.category3Id || p.category2Id || p.category1Id || '',
            코드들: { c1: p.category1Id || '', c2: p.category2Id || '',
                     c3: p.category3Id || '', c4: p.category4Id || '' },
            최저가: p.lowPrice || '',
            검색어일치: p._매칭점수 || '',
            조회시각: new Date().toISOString()
        };
    }

    // ---------- 실행 ----------
    const K_STATE = 'naver_cat_state';   // {todo:[], done:[], idx:0}

    async function loadReq() {
        const [st, txt] = await gh('GET', REQ);
        if (st !== 200) return null;
        try { return JSON.parse(unb64(JSON.parse(txt).content)); } catch (e) { return null; }
    }

    async function saveResult(out) {
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
            const [rs, rt] = await gh('GET', REQ);
            if (rs === 200) {
                await gh('PUT', REQ, {
                    message: '요청 처리 완료 — 비움',
                    content: b64(JSON.stringify({ 검색어: [], 처리시각: new Date().toISOString() }, null, 2)),
                    sha: JSON.parse(rt).sha, branch: 'main'
                });
            }
        }
        return ps;
    }

    function goSearch(keyword) {
        location.href = 'https://search.shopping.naver.com/search/all?query='
                      + encodeURIComponent(keyword);
    }

    // 검색 결과 페이지에서 돌 때: 지금 검색어의 결과를 읽고 다음으로 넘어간다
    async function step() {
        const stt = GM_getValue(K_STATE, null);
        if (!stt || stt.idx >= stt.todo.length) return false;

        const keyword = stt.todo[stt.idx];
        const cur = new URLSearchParams(location.search).get('query') || '';
        if (cur !== keyword) { goSearch(keyword); return true; }

        say(`읽는 중 ${stt.idx + 1}/${stt.todo.length}\n${keyword}`, '#357');
        // 목록이 늦게 그려질 수 있어 몇 번 다시 본다
        let p = null;
        for (let t = 0; t < 12 && !p; t++) {
            p = pickFromPage();
            if (!p) await new Promise(s => setTimeout(s, 800));
        }
        stt.done.push(shape(keyword, p));
        stt.idx += 1;
        GM_setValue(K_STATE, stt);

        if (stt.idx < stt.todo.length) {
            say(`${stt.idx}/${stt.todo.length} 완료 — 다음으로…`, '#357');
            setTimeout(() => goSearch(stt.todo[stt.idx]), 1500);
        } else {
            say('전부 읽었습니다 — 우편함에 올리는 중…', '#357');
            const ps = await saveResult(stt.done);
            GM_setValue(K_STATE, null);
            if (ps === 200 || ps === 201) {
                say('올렸습니다 — ' + stt.done.length + '건\n' +
                    stt.done.map(r => `· ${r.검색어}\n   ${r.카테고리경로 || r.결과} ${r.카테고리코드 || ''}`).join('\n'),
                    '#2a6');
            } else {
                say(`결과 올리기 실패 (status=${ps})`, '#a33');
            }
        }
        return true;
    }

    async function run(manual) {
        say('카테고리 조회기 v1.4.0 — 확인 중…', '#357');
        if (!GM_getValue(K_TOKEN, '')) {
            say('깃허브 토큰이 없습니다.\nTampermonkey 아이콘 > 깃허브 토큰 설정 에서 넣어 주세요.', '#a33');
            return;
        }
        if (await step()) return;                     // 진행 중인 작업이 있으면 이어서

        const req = await loadReq();
        if (!req) { say('우편함을 못 읽었습니다 — 토큰 권한을 확인해 주세요.', '#a33'); return; }
        const todo = (req.검색어 || []).filter(k => k && k.trim());
        if (!todo.length) {
            say('처리할 검색어가 없습니다 — 요청 우편함이 비어 있습니다.', '#555');
            setTimeout(() => box && box.remove(), 5000);
            return;
        }
        GM_setValue(K_STATE, { todo, done: [], idx: 0 });
        say(`카테고리 조회 시작 — ${todo.length}건\n검색 페이지를 차례로 엽니다…`, '#357');
        setTimeout(() => goSearch(todo[0]), 1500);
    }

    GM_registerMenuCommand('깃허브 토큰 설정', () => {
        const v = prompt('kream-tools 저장소에 쓸 수 있는 깃허브 토큰\n(브라우저에만 저장됩니다)',
                         GM_getValue(K_TOKEN, ''));
        if (v !== null) { GM_setValue(K_TOKEN, v.trim()); alert('저장했습니다.'); }
    });
    GM_registerMenuCommand('지금 카테고리 조회', () => run(true));
    GM_registerMenuCommand('이 화면에서 카테고리 읽기', () => {
        say(JSON.stringify(shape(new URLSearchParams(location.search).get('query') || '(현재화면)',
                                 pickFromPage()), null, 1), '#357');
    });
    GM_registerMenuCommand('진행 상태 초기화', () => {
        GM_setValue(K_STATE, null); alert('초기화했습니다.');
    });

    // [v1.2.0] CORS — 검색 API는 search.shopping.naver.com 것이라 다른 도메인에서 부르면
    // "Failed to fetch"가 난다(v1.1.0 실측). 같은 도메인이 아니면 그쪽으로 옮겨서 실행한다.
    const ON_SEARCH = location.hostname === 'search.shopping.naver.com';

    async function boot() {
        if (ON_SEARCH) { run(false); return; }
        if (!GM_getValue(K_TOKEN, '')) return;             // 토큰 없으면 조용히 넘어감
        const [st, txt] = await gh('GET', REQ);
        if (st !== 200) return;
        let n = 0;
        try { n = (JSON.parse(unb64(JSON.parse(txt).content)).검색어 || []).length; } catch (e) {}
        if (!n) return;
        say(`조회할 것 ${n}건이 있습니다.\n검색 페이지로 옮겨서 처리합니다…`, '#357');
        setTimeout(() => {
            location.href = 'https://search.shopping.naver.com/search/all?query=' +
                            encodeURIComponent('카테고리조회');
        }, 1500);
    }

    setTimeout(boot, 2000);
})();
