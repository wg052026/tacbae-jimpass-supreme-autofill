// ==UserScript==
// @name         르플러스 상품주소 모으기
// @namespace    https://github.com/wg052026
// @version      1.9.0
// @description  크림 탭을 하나 열어 두면 못 찾은 물건을 스스로 검색해 찾아 줍는다. 구매처 상품 페이지에서 주소·사진을 저절로 줍고, 결제를 마치면 그 화면의 주문번호와 묶어 보낸다. 며칠 뒤 오는 발송 메일과 주문번호로 이어져 짐패스 등록 엑셀의 H·I 열이 채워진다.
// @author       wg052026
// @match        https://kream.co.kr/*
// @match        https://*.kream.co.kr/*
// @match        https://us.supreme.com/*
// @match        https://shop.supreme.com/*
// @match        https://kapital-webshop.jp/*
// @match        https://*.kapital-webshop.jp/*
// @match        https://kapital.jp/*
// @match        https://*.kapital.jp/*
// @match        https://kapital-net.com/*
// @match        https://*.kapital-net.com/*
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
    const K_최근 = 'purl_최근본것';                    // 아직 주문번호가 안 붙은 상품들
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
                + 'box-shadow:0 6px 18px rgba(0,0,0,.35);max-width:360px;white-space:pre-line;'
                + 'user-select:text';
            document.body.appendChild(창);
        }
        창.style.borderColor = 빛 === 'ok' ? '#2e5240' : (빛 === 'no' ? '#7a3a3a' : '#39424e');
        창.textContent = '상품주소 모으기\n' + 글;
        창.style.display = 'block';
        clearTimeout(창._t);
        창._t = setTimeout(() => { 창.style.display = 'none'; },
                          글.split('\n').length > 4 ? 30000 : 6000);   // 진단은 오래 둔다
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
        // 크림 상품 화면 — 사장님이 값을 보실 때 이름·상품번호를 줍는다
        if (location.hostname.indexOf('kream') >= 0)
            return /\/products\/\d+/.test(location.pathname);
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

    // ── 상품명 고르기 ───────────────────────────────────────────
    // [고침 v1.3.0] 슈프림에서 `og:title` 이 **`Shop`** 으로 와서 상품명이
    // 「Shop」으로 들어갔다(실측 2026-09-02). 그래서 여러 곳을 차례로 본다.
    // [실측 2026-09-02] 캐피탈 웹샵은 h1 이 **`MEN'S`** 였다 — 상품명이 아니다.
    const 헛말 = /^(shop|home|store|products?|cart|search|menu|supreme|kapital|men'?s|women'?s|ladies|mens|womens|new|sale|item|detail|list)$/i;

    // 주소에 품번이 드러나는 가게 — 품번이 이름보다 확실하다
    //   캐피탈 웹샵 : /item/K2606LP226.html
    function 품번뽑기() {
        const m = location.pathname.match(/\/item\/([A-Za-z0-9\-_]{5,})\.html/i)
            || location.pathname.match(/\/(?:goods|detail|item)\/([A-Za-z0-9\-_]{6,})\/?$/i);
        return m ? m[1] : '';
    }

    function 쓸만한(x) {
        const t = String(x || '').replace(/\s+/g, ' ').trim();
        if (t.length < 4 || 헛말.test(t)) return '';
        return t;
    }

    function 상품명찾기() {
        // ① 상품 정보 표(JSON-LD) — Shopify 를 비롯해 대부분이 넣는다
        for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                let j = JSON.parse(el.textContent);
                const 상자 = Array.isArray(j) ? j : (j['@graph'] ? j['@graph'] : [j]);
                for (const o of 상자) {
                    if (o && /product/i.test(String(o['@type'] || '')) && o.name) {
                        const t = 쓸만한(o.name);
                        if (t) return t;
                    }
                }
            } catch (e) { }
        }
        // ② 화면의 큰 제목
        for (const h of document.querySelectorAll('h1, h2[class*=title], [class*=product-title], [class*=productName]')) {
            const t = 쓸만한(h.textContent);
            if (t) return t;
        }
        // ③ og:title
        const og = 쓸만한(메타('og:title'));
        if (og) return og;
        // ④ 창 제목에서 사이트 이름을 뗀다
        const ti = 쓸만한(String(document.title).split(/[|｜–—]/)[0]);
        if (ti) return ti;
        // ⑤ 마지막으로 사진 파일 이름에서 (예: J86_FW26_CrossTrackJacket_Black01.jpg)
        const im = 메타('og:image');
        if (im) {
            let n = im.split('/').pop().split('?')[0].replace(/\.(jpg|jpeg|png|webp|gif)$/i, '');
            n = n.replace(/^[A-Z0-9]{2,4}_/i, '').replace(/_/g, ' ')
                 .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s*\d+$/, '');
            const t = 쓸만한(n);
            if (t) return t;
        }
        return '';
    }

    // ── 그 상품의 사진을 **전부** 줍는다 (사장님 지시 2026-09-02) ──
    function 사진들모으기() {
        const 모음 = [];
        const 담기 = u => {
            if (!u) return;
            let x = String(u).trim();
            if (x.startsWith('//')) x = location.protocol + x;
            if (!/^https?:/i.test(x)) return;
            // [실패 2026-09-01] 쿼리를 통째로 떼면 쇼피파이 사진이 404 가 된다.
            // `?v=…` 는 그 파일을 가리키는 지문이라 남기고, 크기 지시만 뗀다.
            try {
                const U = new URL(x, location.href);
                const v = U.searchParams.get('v');
                U.search = v ? ('?v=' + v) : '';
                x = U.toString();
            } catch (e) { x = x.split('?')[0]; }
            if (/logo|icon|sprite|favicon|placeholder|blank|loading|badge/i.test(x)) return;
            if (모음.indexOf(x) < 0) 모음.push(x);
        };
        // ① 상품 정보표(JSON-LD)의 image — 대개 그 상품 사진이 다 들어 있다
        for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                let j = JSON.parse(el.textContent);
                const 상자 = Array.isArray(j) ? j : (j['@graph'] ? j['@graph'] : [j]);
                for (const o of 상자) {
                    if (!o || !/product/i.test(String(o['@type'] || ''))) continue;
                    const im = o.image;
                    if (typeof im === 'string') 담기(im);
                    else if (Array.isArray(im)) im.forEach(x =>
                        담기(typeof x === 'string' ? x : (x && x.url)));
                    else if (im && im.url) 담기(im.url);
                }
            } catch (e) { }
        }
        // ② 대표 사진
        담기(메타('og:image'));
        // ③ 화면에 있는 큰 사진들 — 같은 집에서 온 것만, 넓이 400 이상
        const 후보 = [];
        document.querySelectorAll('img').forEach(im => {
            const w = im.naturalWidth || im.width || 0;
            const h = im.naturalHeight || im.height || 0;
            let src = im.currentSrc || im.src || im.getAttribute('data-src') || '';
            if (!src || w < 400 || h < 400) return;
            후보.push([w * h, src]);
        });
        후보.sort((a, b) => b[0] - a[0]);
        후보.slice(0, 14).forEach(x => 담기(x[1]));
        return 모음.slice(0, 12);
    }

    // ── 사이즈표를 줍는다 (사장님 규칙 — 맨 끝 사진이 사이즈표) ──
    function 사이즈표줍기() {
        const 낱말 = /(size|chest|length|shoulder|sleeve|waist|width|hem|사이즈|어깨|가슴|총장|소매|허리|밑단)/i;
        let 좋은 = null, 좋은점 = 0;
        document.querySelectorAll('table').forEach(t => {
            const 줄들 = [...t.querySelectorAll('tr')];
            if (줄들.length < 2) return;
            const 글 = (t.innerText || '').slice(0, 400);
            let 점 = 0;
            const m = 글.match(new RegExp(낱말.source, 'gi'));
            if (m) 점 += m.length * 3;
            if (/\b(XS|S|M|L|XL|XXL)\b/.test(글)) 점 += 5;
            if (!점) return;
            점 += Math.min(줄들.length, 8);
            if (점 > 좋은점) { 좋은점 = 점; 좋은 = t; }
        });
        if (!좋은) return null;
        const 표 = [];
        for (const tr of 좋은.querySelectorAll('tr')) {
            const 칸 = [...tr.querySelectorAll('th,td')]
                .map(c => (c.innerText || '').replace(/\s+/g, ' ').trim());
            if (칸.length && 칸.some(x => x)) 표.push(칸.slice(0, 10));
        }
        return 표.length >= 2 ? 표.slice(0, 14) : null;
    }

    // ── 이 화면에서 주울 것 ─────────────────────────────────────
    function 줍기() {
        const 이름 = 상품명찾기();
        const 사진목록 = 사진들모으기();
        let 사진 = 사진목록[0] || 메타('og:image');
        if (사진 && 사진.startsWith('//')) 사진 = location.protocol + 사진;
        return {
            상품명: String(이름).replace(/\s+/g, ' ').trim().slice(0, 160),
            사진들: 사진목록,
            사이즈표: 사이즈표줍기(),
            크림pid: (location.hostname.indexOf('kream') >= 0
                ? (location.pathname.match(/\/products\/(\d+)/) || [])[1] || '' : ''),
            품번: 품번뽑기(),
            사진이름: (사진 || '').split('/').pop().split('?')[0],
            제품URL: location.href.split('?')[0].split('#')[0],
            이미지URL: 사진 || '',
            집: location.hostname,
            때: new Date().toISOString()
        };
    }

    // ── 주문 완료 화면인가 · 주문번호는 무엇인가 ────────────────
    //  [사장님 지적 2026-09-02] 「제품을 먼저 사고 그 뒤에 메일이 오는데
    //   메일을 보고 제품 주소를 찾는 건 안 되지.」 — 맞다. 순서가 반대다.
    //  주소는 **살 때** 쌓이고 메일은 **며칠 뒤** 온다. 둘을 잇는 열쇠는
    //  **주문번호**다 — 결제 완료 화면과 발송 메일에 같은 번호가 찍힌다.
    function 주문완료인가() {
        if (/thank|complete|success|finish|order[-_]?(done|ok|complete)/i
            .test(location.pathname + location.search)) return true;
        const 글 = (document.body ? document.body.innerText : '').slice(0, 4000);
        return /ご注文ありがとうございま|ご注文が完了|注文完了|thank you for your (order|purchase)|order (is )?confirmed|주문이? 완료/i
            .test(글);
    }

    function 주문번호찾기() {
        const 글 = document.body ? document.body.innerText : '';
        let m = 글.match(/注文番号[\s:：\]\[]*([0-9A-Za-z\-]{4,})/);
        if (m) return m[1];
        m = 글.match(/(?:order|confirmation)\s*(?:number|no\.?|#|번호)?\s*[:#]?\s*([0-9]{8,})/i);
        if (m) return m[1];
        m = 글.match(/주문\s*번호\s*[:#]?\s*([0-9A-Za-z\-]{6,})/);
        if (m) return m[1];
        m = location.pathname.match(/\/orders?\/([0-9A-Za-z\-]{6,})/i);
        if (m) return m[1];
        return '';
    }

    // ── 아직 주문번호가 안 붙은 상품들 (브라우저에만 쌓인다) ────
    function 담아두기(줄) {
        const 옛 = GM_getValue(K_최근, []) || [];
        const 표 = new Map(옛.map(x => [x.제품URL, x]));
        표.set(줄.제품URL, 줄);
        GM_setValue(K_최근, [...표.values()].slice(-30));
    }

    async function 주문묶기() {
        const 번호 = 주문번호찾기();
        if (!번호) return;
        const 옛 = GM_getValue(K_최근, []) || [];
        const 같은집 = 옛.filter(x => x.집 === location.hostname
            || location.hostname.indexOf(String(x.집 || '').replace(/^www\./, '')) >= 0
            || String(x.집 || '').indexOf(location.hostname.replace(/^www\./, '')) >= 0);
        if (!같은집.length) return;
        const 봉투 = GM_getValue('purl_묶은주문', []) || [];
        if (봉투.includes(번호)) return;               // 이미 묶어 보낸 주문
        알림(`주문 ${번호} 에 상품 ${같은집.length}건을 묶어 보냅니다…`);
        const 답 = await 창구로({ 주문번호: 번호, 집: location.hostname, 건: 같은집 });
        if (답 && 답.ok) {
            GM_setValue('purl_묶은주문', [...봉투, 번호].slice(-200));
            const 남 = 옛.filter(x => 같은집.indexOf(x) < 0);
            GM_setValue(K_최근, 남);
            알림(`주문 ${번호} · 상품 ${같은집.length}건을 메일지기에 넣었습니다.\n`
                + '며칠 뒤 오는 발송 메일과 이 번호로 이어집니다.', 'ok');
        } else {
            알림('메일지기가 안 켜져 있습니다 — 켜신 뒤 이 화면을 새로고침해 주십시오.', 'no');
        }
    }

    // ── 먼저 컴퓨터의 메일지기에게 바로 준다 (토큰이 필요 없다) ──
    // ── 크림 순찰 ───────────────────────────────────────────────
    //  [사장님 지적 2026-09-01] 「크림에 수많은 물건 중에 어떻게 잡지?」
    //  맞는 말씀이다. 사장님이 그 화면을 찾아 들어가실 리가 없다.
    //  그래서 **크림 탭 하나만 열려 있으면 이 스크립트가 스스로 돈다.**
    //   ① 메일지기에게 「다음에 뭘 찾을까요」 묻는다
    //   ② 품번으로 크림에서 검색한다 → 안 나오면 영문 상품명으로 한 번 더
    //   ③ 첫 결과로 들어가 줍는다 → 메일지기에 넣고 그 건을 목록에서 뺀다
    //   ④ 다음 건으로 넘어간다. 다 하면 조용히 멈춘다.
    const K_일 = 'purl_크림일';          // 지금 맡은 일
    const K_순찰 = 'purl_크림순찰';       // 순찰을 켤까
    const K_센것 = 'purl_크림센것';       // 이 판에 몇 건 했나
    const 크림인가 = () => location.hostname.indexOf('kream.co.kr') >= 0;
    const 크림상품인가 = () => /\/products\/\d+/.test(location.pathname);
    const 크림검색인가 = () => location.pathname.indexOf('/search') === 0;

    function 창구에서(길) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET', url: 창구 + 길, timeout: 4000,
                onload: r => {
                    try { resolve(JSON.parse(r.responseText)); }
                    catch (e) { resolve(null); }
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null)
            });
        });
    }

    function 검색으로(말) {
        location.href = 'https://kream.co.kr/search?keyword='
            + encodeURIComponent(String(말).trim());
    }

    // 검색 결과가 다 그려질 때까지 기다렸다 첫 상품 주소를 준다
    function 첫결과기다리기(최대초) {
        return new Promise(resolve => {
            const 끝 = Date.now() + (최대초 || 9) * 1000;
            const 시계 = setInterval(() => {
                const a = document.querySelector('a[href*="/products/"]');
                if (a && a.getAttribute('href')) {
                    clearInterval(시계);
                    resolve(new URL(a.getAttribute('href'), location.origin).href);
                    return;
                }
                // 「검색 결과가 없습니다」 같은 말이 뜨면 더 기다릴 것 없다
                const 글 = (document.body.innerText || '').slice(0, 2000);
                if (/검색\s*결과가?\s*없|결과를\s*찾을\s*수\s*없/.test(글)) {
                    clearInterval(시계); resolve(null); return;
                }
                if (Date.now() > 끝) { clearInterval(시계); resolve(null); }
            }, 700);
        });
    }

    async function 순찰() {
        if (!크림인가() || !GM_getValue(K_순찰, true)) return;
        if (GM_getValue(K_AUTO, true) === false) return;
        let 일 = GM_getValue(K_일, null);

        // ── 상품 화면에 들어와 있다 — 줍고 그 건을 끝낸다
        if (크림상품인가()) {
            const 줄 = 줍기();
            if (줄.상품명 && 줄.크림pid) {
                if (일 && 일.열쇠) 줄.열쇠 = 일.열쇠;
                // 크림 이름만 있고 품번이 비면, 찾던 품번을 그대로 붙여 준다
                if (일 && 일.품번 && !줄.품번) 줄.품번 = 일.품번;
                await 창구로(줄);
                알림('크림에서 찾았습니다\n' + 줄.상품명.slice(0, 44), 'ok');
            }
            GM_setValue(K_일, null);
            setTimeout(다음일, 2500);
            return;
        }

        // ── 검색 결과 화면 — 첫 물건으로 들어간다
        if (크림검색인가() && 일) {
            const 첫 = await 첫결과기다리기(9);
            if (첫) { location.href = 첫; return; }
            if (!일.영문으로했나 && 일.영문 && 일.영문 !== 일.품번) {
                일.영문으로했나 = true;              // 품번이 안 나왔다 — 이름으로 한 번 더
                GM_setValue(K_일, 일);
                검색으로(일.영문);
                return;
            }
            await 창구로({ 없더라: true, 열쇠: 일.열쇠 });   // 크림에 아직 없는 물건이다
            GM_setValue(K_일, null);
            setTimeout(다음일, 2000);
            return;
        }

        // ── 아무 크림 화면 — 맡은 일이 없으면 하나 받아 온다
        if (!일) { 다음일(); return; }
        검색으로(일.영문으로했나 ? 일.영문 : (일.품번 || 일.영문));
    }

    async function 다음일() {
        if (!크림인가() || !GM_getValue(K_순찰, true)) return;
        const 센것 = Number(GM_getValue(K_센것, 0) || 0);
        if (센것 >= 25) { return; }                 // 한 판에 25건까지만 (폭주 막기)
        const 답 = await 창구에서('찾을것');
        if (!답 || !답.ok || !답.일) return;         // 할 일이 없으면 조용히 멈춘다
        GM_setValue(K_센것, 센것 + 1);
        GM_setValue(K_일, 답.일);
        검색으로(답.일.품번 || 답.일.영문);
    }

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
        if (헛말.test(줄.상품명)) {
            // 이름을 못 읽어도 **품번이 있으면 보낸다** — 품번이 더 확실한 열쇠다
            if (줄.품번) {
                줄.상품명 = 줄.품번;
            } else {
                if (손으로) 알림('상품명을 못 읽었습니다 — 화면이 다 그려진 뒤 다시 눌러 주십시오.', 'no');
                return;
            }
        }
        const 본것 = GM_getValue(K_BON, []) || [];
        if (!손으로 && 본것.includes(줄.제품URL)) {
            알림('이미 올린 상품입니다.\n' + 줄.상품명.slice(0, 44), 'ok');
            return;
        }
        도는중 = true;
        담아두기(줄);              // 결제할 때 주문번호와 묶으려고 쌓아 둔다
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
    GM_registerMenuCommand('이 주문에 상품 묶기', () => 주문묶기());
    GM_registerMenuCommand('담아 둔 상품 보기', () => {
        const 옛 = GM_getValue(K_최근, []) || [];
        알림('아직 주문에 안 묶인 상품 ' + 옛.length + '건\n'
            + 옛.slice(-6).map(x => '· ' + String(x.상품명).slice(0, 34)).join('\n'), 'ok');
    });
    GM_registerMenuCommand(
        (GM_getValue(K_AUTO, true) ? '자동으로 줍기 : 켬' : '자동으로 줍기 : 끔'),
        () => {
            GM_setValue(K_AUTO, !GM_getValue(K_AUTO, true));
            alert('다음에 새로고침하면 바뀝니다.');
        });
    // [고침 v1.4.0] 안 잡히는 화면에서 **왜 안 잡히는지** 눈으로 보게 한다.
    GM_registerMenuCommand('이 화면 진단', () => {
        const 줄 = 줍기();
        const 글 = [
            '주소 : ' + location.hostname + location.pathname.slice(0, 46),
            'og:type  : ' + (메타('og:type') || '(없음)'),
            'og:title : ' + (메타('og:title') || '(없음)').slice(0, 40),
            'og:image : ' + (메타('og:image') ? '있음' : '(없음)'),
            'h1       : ' + ((document.querySelector('h1')?.textContent || '(없음)')
                .replace(/\s+/g, ' ').trim().slice(0, 40)),
            'JSON-LD  : ' + document.querySelectorAll('script[type="application/ld+json"]').length + '개',
            '─────────────',
            '상품 화면인가 : ' + (상품인가() ? '예' : '아니오'),
            '고른 이름 : ' + (줄.상품명 || '(못 찾음)').slice(0, 44),
            '주소 속 품번 : ' + (줄.품번 || '(없음)'),
            '주문 완료 화면 : ' + (주문완료인가() ? '예' : '아니오')
                + ' · 번호 ' + (주문번호찾기() || '(없음)'),
            '담아 둔 상품 : ' + ((GM_getValue(K_최근, []) || []).length) + '건',
            '고른 사진 : ' + (줄.이미지URL ? '있음' : '(없음)'),
        ].join('\n');
        알림(글, 상품인가() ? 'ok' : 'no');
        try { GM_setValue('purl_진단', 글); } catch (e) { }
        console.log('[상품주소 진단]\n' + 글);
    });
    GM_registerMenuCommand(
        GM_getValue(K_순찰, true) ? '크림 순찰 : 켬' : '크림 순찰 : 끔', () => {
            GM_setValue(K_순찰, !GM_getValue(K_순찰, true));
            GM_setValue(K_센것, 0);
            alert('크림 순찰을 ' + (GM_getValue(K_순찰, true) ? '켰습니다' : '껐습니다'));
        });
    GM_registerMenuCommand('크림 순찰 다시 시작', () => {
        GM_setValue(K_센것, 0); GM_setValue(K_일, null);
        alert('다시 셉니다 — 크림 화면을 새로 고치시면 이어서 돕니다.');
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
            if (주문완료인가() && 주문번호찾기()) {
                clearInterval(시계); 시계 = null;
                마지막주소 = location.href;
                주문묶기();
                return;
            }
            if (상품인가() && !크림인가()) {
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
    // 크림은 순찰이 맡는다 — 화면이 다 그려질 틈을 준다
    if (크림인가()) setTimeout(() => { 순찰(); }, 2500);
})();
