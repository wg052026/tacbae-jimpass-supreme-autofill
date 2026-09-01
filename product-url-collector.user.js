// ==UserScript==
// @name         르플러스 상품주소 모으기
// @namespace    https://github.com/wg052026
// @version      1.2.0
// @description  구매처 상품 페이지에 들어가기만 하면 상품명·제품URL·이미지URL을 저절로 주워 우편함에 쌓는다. 짐패스 등록 엑셀의 H·I 열이 이것으로 채워진다.
// @author       wg052026
// @match        https://us.supreme.com/*
// @match        https://shop.supreme.com/*
// @match        https://kapital-webshop.jp/*
// @match        https://www.kapital-webshop.jp/*
// @match        https://kerouacokinawa.jp/*
// @match        https://www.kerouacokinawa.jp/*
// @match        https://ec.hystericglamour.jp/*
// @match        https://humanmade.jp/*
// @match        https://*.humanmade.jp/*
// @match        https://chromehearts.com/*
// @match        https://*.chromehearts.com/*
// @match        https://spacemoo.co.jp/*
// @match        https://*.spacemoo.co.jp/*
// @match        https://takefive.jp/*
// @match        https://*.takefive.jp/*
// @match        https://joopiter.com/*
// @match        https://*.joopiter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/product-url-collector.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/product-url-collector.user.js
// ==/UserScript==
//
// [왜 만들었나 · 2026-09-01]
// 짐패스 대량등록 엑셀은 **H(제품URL)·I(이미지URL)이 필수**다. 비우면
// 「2번째줄에 제품URL이(가) 입력되지 않았습니다」로 통째로 거절당한다(실측).
// 그런데 슈프림(us.supreme.com)도 캐피탈(kapital-webshop.jp)도
// **서버에서 부르면 403**이라 프로그램이 스스로 못 찾는다 — 진짜 브라우저로만 열린다.
// 그래서 **사장님이 물건을 사실 때 그 페이지에서 저절로 주소를 주워** 우편함에 쌓는다.
//
// [지킨 것 — 과거 실패 목록에서]
//  · Public 저장소이므로 **개인정보를 코드에 넣지 않는다**(여기엔 애초에 없다)
//  · 토큰은 `GM_setValue('gh_token')` 으로 **브라우저에만** 둔다
//  · 결과는 **덮어쓰지 않고 쌓는다**(상품명을 열쇠로 Map 합치기)
//  · 기존 파일을 고칠 때는 **`sha` 를 먼저 조회**해 함께 보낸다 · `branch:'main'`
//  · 한글이 있으므로 base64 는 TextEncoder/TextDecoder 를 거친다
//  · 진단은 webhook 이 아니라 **화면 상태창**으로 보여 준다
//  · `setInterval` 을 새로 걸기 전에 옛것을 반드시 지운다
//
(function () {
    'use strict';

    // [사장님 지시 2026-09-01 「내가 따로 해야하잔아」]
    // 깃허브를 거치면 **토큰을 손수 넣어야** 한다. 그 한 번도 없애려고,
    // 컴퓨터에서 도는 「메일지기」가 열어 둔 작은 창구로 **바로 보낸다.**
    // 창구가 안 열려 있을 때만 깃허브로 돌아간다(다른 컴퓨터에서 쓸 때를 위해).
    const 창구 = 'http://127.0.0.1:8731/';
    const REPO = 'wg052026/kream-tools';              // Private — 주소는 여기 안 적는다
    const PATH = 'mailbox/buy/상품주소.json';
    const K_TOKEN = 'gh_token';
    const K_BON = 'purl_본것';                        // 이미 올린 것(로컬)
    const K_AUTO = 'purl_자동';                       // 자동으로 주울까

    // ── 잔심부름 ────────────────────────────────────────────────
    const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    const unb64 = s => new TextDecoder().decode(
        Uint8Array.from(atob(String(s).replace(/\n/g, '')), c => c.charCodeAt(0)));

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

    // ── 화면 상태창 (오른쪽 아래 · 잠깐 떴다 사라진다) ──────────
    let 창;
    function 알림(글, 빛) {
        if (!창) {
            창 = document.createElement('div');
            창.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;'
                + 'background:#1e232b;color:#e8edf4;font:12px/1.6 "Malgun Gothic",sans-serif;'
                + 'padding:9px 13px;border-radius:7px;border:1px solid #39424e;'
                + 'box-shadow:0 6px 18px rgba(0,0,0,.35);max-width:330px;white-space:pre-line';
            document.body.appendChild(창);
        }
        창.style.borderColor = 빛 === 'ok' ? '#2e5240' : (빛 === 'no' ? '#7a3a3a' : '#39424e');
        창.textContent = '상품주소 모으기\n' + 글;
        창.style.display = 'block';
        clearTimeout(창._t);
        창._t = setTimeout(() => { 창.style.display = 'none'; }, 6000);
    }

    // ── 이 화면이 상품 페이지인가 ───────────────────────────────
    function 메타(p) {
        const el = document.querySelector(`meta[property="${p}"], meta[name="${p}"]`);
        return el ? (el.getAttribute('content') || '').trim() : '';
    }

    // [고침 v1.1.0 · 사장님 지시 「여기 들어가면 알아서 올라가게 해」]
    // 판정을 넓혔다. 예전에는 주소에 `/products/` 가 있거나 og:type 이 product 일
    // 때만 상품으로 봐서, 그 꼴이 아닌 가게에서는 자동으로 안 주웠다.
    function 상품인가() {
        if (/product/i.test(메타('og:type'))) return true;
        if (/\/(products?|item|items|goods|detail|dp|shop\/[^/]+\/[^/]+)\//i
            .test(location.pathname)) return true;
        // 위 둘이 아니어도 — **큰 사진 + 제목 + 값이 함께 있으면** 상품 화면으로 본다
        const 사진 = 메타('og:image');
        const 제목 = 메타('og:title') || (document.querySelector('h1')?.textContent || '');
        if (!사진 || !제목.trim()) return false;
        const 글 = document.body ? document.body.innerText.slice(0, 6000) : '';
        const 값있나 = /[¥￥$€₩]\s?[\d,]{3,}|[\d,]{4,}\s?(원|円|JPY|USD)/i.test(글);
        const 담기 = /장바구니|카트|담기|구매하기|바로구매|購入|カート|add to (cart|bag)|buy now/i
            .test(글);
        return 값있나 && 담기;
    }

    // ── 이 화면에서 주울 것 ─────────────────────────────────────
    function 줍기() {
        const 이름 = 메타('og:title') || (document.querySelector('h1')?.textContent || '')
            || document.title;
        let 사진 = 메타('og:image');
        if (!사진) {
            // og:image 가 없으면 화면에서 가장 큰 사진을 고른다
            let 크기 = 0;
            document.querySelectorAll('img').forEach(im => {
                const s = (im.naturalWidth || 0) * (im.naturalHeight || 0);
                if (s > 크기 && im.src && !/logo|icon|sprite/i.test(im.src)) {
                    크기 = s; 사진 = im.src;
                }
            });
        }
        if (사진 && 사진.startsWith('//')) 사진 = location.protocol + 사진;
        return {
            상품명: String(이름).replace(/\s+/g, ' ').trim().slice(0, 160),
            제품URL: location.href.split('?')[0].split('#')[0],
            이미지URL: (사진 || '').split('?')[0],
            집: location.hostname,
            때: new Date().toISOString()
        };
    }

    // ── 먼저 컴퓨터의 메일지기에게 바로 준다 (토큰이 필요 없다) ──
    function 창구로(줄) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'POST', url: 창구, timeout: 4000,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(줄),
                onload: r => {
                    try { resolve(JSON.parse(r.responseText)); }
                    catch (e) { resolve(null); }
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null)
            });
        });
    }

    // ── 우편함에 쌓는다 (덮어쓰지 않는다) ───────────────────────
    async function 올리기(줄) {
        const [gs, gt] = await gh('GET', PATH);
        let sha = null, 옛 = [];
        if (gs === 200) {
            try {
                const j = JSON.parse(gt);
                sha = j.sha;
                옛 = JSON.parse(unb64(j.content)).건 || [];
            } catch (e) { }
        } else if (gs === 0) {
            알림('깃허브 토큰이 없습니다.\n차림표 → 「깃허브 토큰 설정」', 'no');
            return 0;
        }
        const 표 = new Map(옛.map(x => [x.제품URL, x]));
        표.set(줄.제품URL, 줄);
        const 합 = [...표.values()];
        const 몸 = {
            message: `상품주소 ${줄.상품명.slice(0, 40)} (누적 ${합.length}) `
                + new Date().toLocaleString('ko-KR'),
            content: b64(JSON.stringify(
                { 갱신시각: new Date().toISOString(), 건수: 합.length, 건: 합 }, null, 1)),
            branch: 'main'
        };
        if (sha) 몸.sha = sha;
        const [ps] = await gh('PUT', PATH, 몸);
        return (ps === 200 || ps === 201) ? 합.length : 0;
    }

    // ── 한 번 하기 ──────────────────────────────────────────────
    let 도는중 = false;
    async function 한번(손으로) {
        if (도는중) return;
        if (!손으로 && !상품인가()) return;
        if (!손으로) 알림('상품 화면입니다 — 주소를 올립니다…');
        const 줄 = 줍기();
        if (!줄.상품명 || !줄.이미지URL) {
            if (손으로) 알림('이 화면에서 상품명·사진을 못 찾았습니다.', 'no');
            return;
        }
        const 본것 = GM_getValue(K_BON, []) || [];
        if (!손으로 && 본것.includes(줄.제품URL)) {
            알림('이미 올린 상품입니다.\n' + 줄.상품명.slice(0, 44), 'ok');
            return;
        }
        도는중 = true;
        알림('보내는 중…\n' + 줄.상품명.slice(0, 46));
        try {
            // ① 컴퓨터의 메일지기에게 바로 (토큰이 필요 없다)
            const 답 = await 창구로(줄);
            if (답 && 답.ok) {
                GM_setValue(K_BON, [...new Set([...본것, 줄.제품URL])].slice(-500));
                알림(`메일지기에 넣었습니다 (모두 ${답.모두}건)\n`
                    + 줄.상품명.slice(0, 44), 'ok');
                도는중 = false;
                return;
            }
            // ② 창구가 안 열려 있으면 깃허브로 (다른 컴퓨터에서 쓸 때)
            if (!GM_getValue(K_TOKEN, '')) {
                알림('메일지기가 안 켜져 있습니다.\n'
                    + '「1 메일지기」를 켜 두시면 저절로 들어갑니다.', 'no');
                도는중 = false;
                return;
            }
            const n = await 올리기(줄);
            if (n) {
                GM_setValue(K_BON, [...new Set([...본것, 줄.제품URL])].slice(-500));
                알림(`우편함에 올렸습니다 (모두 ${n}건)\n${줄.상품명.slice(0, 44)}`, 'ok');
            } else {
                알림('못 보냈습니다 — 메일지기도 깃허브도 안 됩니다.', 'no');
            }
        } catch (e) {
            알림('실패 — ' + String(e).slice(0, 70), 'no');
        }
        도는중 = false;
    }

    // ── 차림표 ──────────────────────────────────────────────────
    GM_registerMenuCommand('깃허브 토큰 설정', () => {
        const v = prompt('kream-tools 저장소에 쓸 수 있는 깃허브 토큰\n(브라우저에만 저장됩니다)',
            GM_getValue(K_TOKEN, ''));
        if (v !== null) { GM_setValue(K_TOKEN, v.trim()); alert('저장했습니다.'); }
    });
    GM_registerMenuCommand('이 상품 주소 지금 올리기', () => 한번(true));
    GM_registerMenuCommand(
        (GM_getValue(K_AUTO, true) ? '자동으로 줍기 : 켬' : '자동으로 줍기 : 끔'),
        () => {
            GM_setValue(K_AUTO, !GM_getValue(K_AUTO, true));
            alert('다음에 새로고침하면 바뀝니다.');
        });
    GM_registerMenuCommand('올린 기록 지우기', () => {
        GM_setValue(K_BON, []); alert('지웠습니다 — 같은 상품도 다시 올립니다.');
    });

    // ── 시작 ────────────────────────────────────────────────────
    // 화면이 늦게 그려지는 곳(슈프림은 Shopify)이 있어 조금 기다렸다 본다.
    // [과거 실패] setInterval 을 겹쳐 걸어 값이 왔다갔다 한 적이 있다 —
    // 여기서는 타이머를 하나만 두고 다 되면 스스로 끈다.
    let 시계 = null;
    let 마지막주소 = '';

    function 지켜보기() {
        if (!GM_getValue(K_AUTO, true)) return;
        if (시계) { clearInterval(시계); 시계 = null; }   // [과거 실패] 타이머를 겹쳐 걸지 않는다
        let 센것 = 0;
        시계 = setInterval(() => {
            센것 += 1;
            if (센것 > 30) { clearInterval(시계); 시계 = null; return; }   // 27초까지 기다린다
            if (상품인가()) {
                clearInterval(시계); 시계 = null;
                마지막주소 = location.href;
                한번(false);
            }
        }, 900);
    }

    // 요즘 쇼핑몰은 화면을 갈아 끼우기만 하고 새로 열지 않는다(주소만 바뀐다).
    // 그래서 **주소가 바뀌면 다시 본다.**
    setInterval(() => {
        if (location.href !== 마지막주소 && !도는중) {
            마지막주소 = location.href;
            지켜보기();
        }
    }, 1500);

    지켜보기();
})();
