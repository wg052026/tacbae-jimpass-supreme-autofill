// ==UserScript==
// @name         로지아이 택배예약 자동입력
// @namespace    https://github.com/wg052026/tacbae-jimpass-supreme-autofill
// @version      1.7.0
// @description  로지아이(logii.com) 편의점 택배예약 — 메인에서 받는사람 화면까지 자동, 보낼 곳을 박스로 만들어 두고 골라 넣기, 여러 건 한 번에, 물품·대형박스 자동
// @author       wg052026
// @match        https://www.logii.com/
// @match        https://www.logii.com/Main.pm*
// @match        https://www.logii.com/Reservation/Reserve.pm*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.github.com
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/logii-autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/logii-autofill.user.js
// ==/UserScript==
(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────
  // 실측(2026-08-29 · 사장님 크롬에서 직접 확인)
  //   메인 → 편의점 선택 → GoNext() 한 번이면 받는사람 화면(보내는사람은 저절로 넘어간다).
  //   폼 RegiForm · 받는사람 칸에 **id 가 없다 — name 으로 잡는다**
  //     r_name · r_mobile(화면에 보이는 통 칸) · r_mobile1/2/3(숨은 칸)
  //     r_zipcode1(앞3) · r_zipcode2(뒤2) · r_addr1 · r_addr2 · r_isl_div
  //     물품 comm_p_code_name · p_pric · 박스 bs_{S,A,B,C,D}_{줄번호} · p_amt_C
  //   **물품가액은 「만원 단위」다** — 화면의 「30만원」 단추를 누르면 p_pric 에 30 이 들어간다.
  //   **여러 건**은 addRecipient() 로 줄을 늘린다. 늘어난 줄은 같은 name 의 다음 index.
  //   대형박스 = C (무게 20kg / 크기 160cm 이하)
  //   우편번호 검색은 **못 찾는 도로명이 있다**(목동중앙남로) — 그래서 주소를 그대로 적어 둔다.
  //
  // 사장님 지시(2026-08-29) — 칸을 늘어놓지 말고 **보낼 곳을 박스로 만들어 두고 골라 넣는다.**
  // 개인정보는 코드에 넣지 않는다(저장소가 Public). 전부 GM_setValue 로 이 브라우저에만 둔다.
  // ─────────────────────────────────────────────────────────────

  // ── 저장소에서 「보낼 것」을 받아 온다 ──────────────────────────
  // [사장님 지시 2026-08-29] **박스는 클로드가 만들어 두고 사장님은 누르기만.**
  // 받는사람 주소는 **Private 저장소**에만 둔다 — 이 스크립트가 있는 공개 저장소에는
  // 아무것도 안 적는다. 토큰은 브라우저에만 저장한다(네이버 카테고리 스크립트와 같은 길).
  const 저장소 = "wg052026/kream-tools";
  const 목록길 = "mailbox/logii/보낼것.json";
  const TOKEN_KEY = "gh_token";

  const CFG_KEY = "logii_cfg";
  const cfg = Object.assign({ 자동진행: true, 택배사: "eleven", 박스: [] },
                            GM_getValue(CFG_KEY, {}) || {});
  if (!Array.isArray(cfg.박스)) cfg.박스 = [];
  const 저장 = () => GM_setValue(CFG_KEY, cfg);

  const 물품 = { 만원상한: 30, 박스칸: "C" };

  // 솔드아웃은 늘 같은 곳 — 지워도 다시 살아난다
  const 솔드아웃 = {
    붙박이: true, 라벨: "솔드아웃 검수센터",
    이름: "솔드아웃", 전화: "070-5117-5114", 우편: "07983",
    주소: "서울특별시 양천구  목동동로 363(목동)",   // 시군구와 도로명 사이 공백 두 칸
    상세: "솔드아웃", 물품명: "", 물품가액: "",
  };
  let 저장소박스 = [];
  function 박스들() {
    const 쓴 = new Set(cfg.쓴것 || []);
    const 밖 = 저장소박스.filter((b) => !쓴.has(b.라벨));
    const 남 = (cfg.박스 || []).filter((b) => !b.붙박이);
    return [솔드아웃].concat(밖, 남);
  }

  function 토큰() { return GM_getValue(TOKEN_KEY, "") || ""; }
  async function 저장소에서받기() {
    const tok = 토큰();
    if (!tok) return { 오류: "토큰이 없습니다 — Tampermonkey 메뉴에서 넣어 주십시오" };
    const url = "https://api.github.com/repos/" + 저장소 + "/contents/" +
                encodeURIComponent(목록길).replace(/%2F/g, "/");
    try {
      const r = await fetch(url, {
        headers: { Authorization: "Bearer " + tok, Accept: "application/vnd.github.raw" },
      });
      if (!r.ok) return { 오류: "저장소를 못 읽었습니다 (" + r.status + ")" };
      const j = JSON.parse(await r.text());
      return { 목: (j && j.보낼것) || [], 때: (j && j.갱신시각) || "" };
    } catch (e) {
      return { 오류: "저장소를 못 읽었습니다: " + e.message };
    }
  }

  // [사장님 지시 2026-08-29] **적용해서 끝까지 가면 알아서 지운다.**
  // 「다음단계」를 누른 것을 끝까지 간 것으로 본다. 솔드아웃(붙박이)은 안 지운다.
  // 잘못 지워졌을 때를 위해 `지운것` 에 열 개까지 남겨 둔다.
  let 이번에적용 = [];
  function 다음단추감시() {
    if (window.__logii_next_hooked) return;
    window.__logii_next_hooked = true;
    document.addEventListener("click", (e) => {
      const el = e.target && e.target.closest ? e.target.closest("[onclick],button,a") : null;
      if (!el) return;
      const oc = (el.getAttribute && el.getAttribute("onclick")) || "";
      const 글 = (el.innerText || "").trim();
      if (!/GoNext/.test(oc) && 글 !== "다음단계") return;
      if (!이번에적용.length) return;
      const 지울것 = 이번에적용.slice();
      이번에적용 = [];
      cfg.지운것 = (지울것.map((b) => b)).concat(cfg.지운것 || []).slice(0, 10);
      cfg.박스 = (cfg.박스 || []).filter((b) => !지울것.includes(b));
      // 저장소에서 받아 온 것은 여기서 못 지우니 **쓴 것으로 적어 두고 감춘다**
      cfg.쓴것 = (cfg.쓴것 || []).concat(지울것.map((b) => b.라벨).filter(Boolean)).slice(-50);
      저장();
      setTimeout(() => { try { 그리기(); } catch (x) {} }, 300);
    }, true);
  }

  // ── 약관 팝업 : 「다음단계」 뒤에 뜨는 것을 대신 눌러 준다 ──────
  // [사장님 지시 2026-08-29] 전체 약관 동의와 확인까지 눌러 달라 하셨다.
  // 실측 — 팝업 #comm_agree_div · 전체동의 #termsServiceAgreeAll
  //        (낱개는 termsServiceAgree1~4) · 확인 A#click_agree_ahref
  // 타이머는 **한 번만** 건다(예전에 setInterval 을 겹쳐 걸어 값이 왔다갔다 한 적이 있다).
  function 약관감시() {
    if (window.__logii_terms) return;
    window.__logii_terms = setInterval(() => {
      try {
        const 팝 = document.getElementById("comm_agree_div");
        if (!팝) return;
        // [사고 2026-08-29] 처음에 `offsetParent` 로 「떠 있나」를 봤는데
        // 이 팝업은 **`position: fixed`** 라 offsetParent 가 **늘 null** 이다.
        // 그래서 떠 있어도 언제나 건너뛰었다. → **display 로 본다.**
        const 보임 = getComputedStyle(팝).display !== "none" &&
                     팝.getBoundingClientRect().width > 0;
        if (!보임) return;
        const 전체 = document.getElementById("termsServiceAgreeAll");
        if (전체 && !전체.checked) {
          전체.click();
          if (!전체.checked) {                     // 꾸민 체크박스면 라벨을 눌러야 한다
            const 라 = document.querySelector('label[for="termsServiceAgreeAll"]');
            if (라) 라.click();
          }
          if (!전체.checked) {                     // 그래도 안 되면 값으로 넣고 알린다
            전체.checked = true;
            전체.dispatchEvent(new Event("click", { bubbles: true }));
            전체.dispatchEvent(new Event("change", { bubbles: true }));
          }
          return;                                  // 한 바퀴 쉬고 확인을 누른다
        }
        // [사장님 지시 2026-08-29] **체크만 하고 확인은 누르지 않는다.**
        // 확인 단추가 곧 다음 화면으로 넘어가는 단추라, 눌러 버리면 사장님이
        // 내용을 못 보신 채 한 칸 더 가 버린다.
        if (!window.__logii_terms_said) {
          window.__logii_terms_said = true;
          알림("전체 약관에 체크했습니다 — 확인은 눌러 주십시오", "#8d8");
        }
      } catch (e) {}
    }, 500);
  }

  let 상태줄 = null;
  function 알림(msg, 색) {
    if (상태줄) { 상태줄.textContent = msg; 상태줄.style.color = 색 || "#9ad"; }
    try { console.log("[로지아이 자동입력]", msg); } catch (e) {}
  }

  // ── 값 넣기 ─────────────────────────────────────────────────────
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const d = Object.getOwnPropertyDescriptor(proto, "value");
    if (d && d.set) d.set.call(el, value); else el.value = value;
  }
  function 넣기(name, value, idx) {
    const el = document.getElementsByName(name)[idx || 0];
    if (!el) return false;
    setNativeValue(el, value == null ? "" : String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function 고르기(name, value, idx) {
    const el = document.getElementsByName(name)[idx || 0];
    if (!el) return false;
    if (![...el.options].some((o) => o.value === value)) el.appendChild(new Option(value, value));
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  const 페이지 = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const 받는사람화면 = () => !!document.getElementsByName("r_name").length;
  const 편의점화면 = () =>
    !!document.getElementsByName("many_comp_code").length && !받는사람화면();
  const 메인화면 = () => {
    const p = location.pathname || "";
    return (p === "/" || /^\/Main\.pm/i.test(p)) && !편의점화면() && !받는사람화면();
  };
  const 예약주소 = "/Reservation/Reserve.pm?select_service=delv_24&sub_comp_code=";

  // ── 자동 진행 ───────────────────────────────────────────────────
  function 메인자동() {
    if (!cfg.자동진행) { 알림("자동 진행이 꺼져 있습니다 — 메뉴에서 켤 수 있습니다"); return; }
    알림("택배예약으로 갑니다…");
    location.href = 예약주소;
  }
  function 편의점자동() {
    if (!cfg.자동진행) { 알림("자동 진행이 꺼져 있습니다 — 메뉴에서 켤 수 있습니다"); return; }
    const 카드 = [...document.querySelectorAll("[onclick]")].find(
      (e) => /click_comp_code_select/.test(e.getAttribute("onclick") || "") &&
             /세븐일레븐 편의점/.test(e.innerText || ""));
    if (!카드) { 알림("세븐일레븐 카드를 못 찾았습니다", "#f88"); return; }
    try {
      카드.click();
      if ((document.getElementsByName("many_comp_code")[0] || {}).value !== cfg.택배사) {
        알림("택배사가 안 골라졌습니다", "#f88"); return;
      }
      알림("다음단계로 갑니다…");
      if (typeof 페이지.GoNext === "function") 페이지.GoNext();
      else 알림("GoNext 를 못 찾았습니다 — 손으로 눌러 주십시오", "#f88");
    } catch (e) { 알림("멈췄습니다: " + e.message, "#f88"); }
  }

  // ── 붙여넣은 글에서 갈라내기 ────────────────────────────────────
  function 갈라내기(글) {
    const t = String(글 || "").replace(/ /g, " ").trim();
    const 전화 = (t.match(/0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/) || [""])[0]
                   .replace(/[\s.]/g, "-").replace(/-+/g, "-");
    const 우편 = (t.match(/\(?\b(\d{5})\b\)?/) || [, ""])[1];
    let 기본 = "", 상세 = "";
    if (우편) {
      let 뒤 = t.slice(t.indexOf(우편) + 우편.length).replace(/^\s*\)\s*/, "").trim();
      뒤 = 뒤.split("\n")[0].trim();
      const g = 뒤.match(/^(.*?\([^)]*\))\s*(.*)$/);
      if (g) { 기본 = g[1].trim(); 상세 = g[2].trim(); } else { 기본 = 뒤; }
    }
    let 이름 = "";
    for (const 줄 of t.split("\n").map((s) => s.trim()).filter(Boolean)) {
      if (/\d{5}/.test(줄) || /0\d{1,2}[-\s]?\d{3,4}/.test(줄)) continue;
      if (/주소|배송|정보|요청|원$|번호/.test(줄)) continue;
      if (줄.length <= 12) { 이름 = 줄; break; }
    }
    return { 이름, 전화, 우편, 주소: 기본, 상세 };
  }

  // ── 물품가액 : **만원 단위** ────────────────────────────────────
  function 만원으로(v) {
    let n = parseInt(String(v).replace(/[^0-9]/g, ""), 10);
    if (!n) return "";
    if (n >= 1000) n = Math.ceil(n / 10000);   // 원으로 적으셨으면 만원으로 올린다
    if (n > 물품.만원상한) n = 물품.만원상한;   // 최대 30만원
    if (n < 1) n = 1;
    return String(n);
  }

  // ── 주소는 **팝업으로 골라야** 로지아이가 받아 준다 ─────────────
  // [사장님 지적 2026-08-29] 「배송주소를 여기서 검색해서 입력하지 않으면 안 되는 것 같음」
  // 실측 — 같은 검색을 예약 화면에서 몰래 물어보면 **빈손**이 오는 주소가 있다
  //        (목동중앙남로). 팝업 창 안에서 물어보면 제대로 나온다.
  // → 팝업을 열고 **검색어까지 넣어** 드린다. 사장님은 결과 한 줄만 누르시면 된다.
  function 검색어만들기(주소) {
    const t = String(주소 || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    const w = t.split(" ").filter(Boolean);
    return w.length >= 2 ? w.slice(-2).join(" ") : t;      // 도로명 + 번지
  }
  function 주소팝업(x, i) {
    const 창 = window.open(
      "/Reservation/PopReserveZipRoadCvsNet.pm?fname=RegiForm&gbn=R&comp_code=" +
      encodeURIComponent(cfg.택배사) + "&sub_comp_code=",
      "logii_zip", "width=780,height=660,scrollbars=yes");
    if (!창) { 알림("주소 창이 막혔습니다 — 팝업 허용을 켜 주십시오", "#f88"); return; }
    const 검 = 검색어만들기(x.주소);
    let n = 0, 넣음 = false;
    const t = setInterval(() => {
      n += 1;
      try {
        if (창.closed) {
          clearInterval(t);
          // 팝업이 채우고 닫힌 뒤에 **상세주소**를 넣는다(팝업은 상세를 안 채운다)
          if (x.상세) 넣기("r_addr2", x.상세, i);
          알림("주소가 들어갔습니다 — 물품과 약관을 보시고 다음단계로", "#8d8");
          return;
        }
        const f = 창.document && 창.document.boardForm;
        if (f && !넣음) {
          넣음 = true;
          f.search_word.value = 검;
          f.submit();
        }
      } catch (e) {}
      if (n > 240) clearInterval(t);
    }, 250);
    알림("주소 창에서 「" + 검 + "」 를 찾았습니다 — 맞는 줄을 눌러 주십시오");
  }

  function 빈줄찾기() {
    const 들 = document.getElementsByName("r_name");
    for (let i = 0; i < 들.length; i++) if (!들[i].value.trim()) return i;
    return 들.length ? 들.length - 1 : 0;
  }

  // ── 채우기 ──────────────────────────────────────────────────────
  function 채우기(x, i) {
    넣기("r_name", x.이름 || "", i);
    const 번 = String(x.전화 || "").replace(/[^0-9]/g, "");
    if (번) {
      넣기("r_mobile", x.전화, i);           // 화면에 보이는 통 칸
      const a = 번.startsWith("02") ? 2 : 3;
      고르기("r_mobile1", 번.slice(0, a), i);
      넣기("r_mobile2", 번.slice(a, 번.length - 4), i);
      넣기("r_mobile3", 번.slice(-4), i);
    }
    const 우 = String(x.우편 || "").replace(/[^0-9]/g, "");
    if (우.length === 5) { 넣기("r_zipcode1", 우.slice(0, 3), i); 넣기("r_zipcode2", 우.slice(3), i); }
    넣기("r_addr1", x.주소 || "", i);
    넣기("r_addr2", x.상세 || "", i);
    if (x.물품명) 넣기("comm_p_code_name", x.물품명, i);
    const 만 = 만원으로(x.물품가액);
    if (만) 넣기("p_pric", 만, i);
    const 박스 = document.getElementById("bs_" + 물품.박스칸 + "_" + i);
    if (박스 && !박스.checked) { try { 박스.click(); } catch (e) {} }
    넣기("p_amt_" + 물품.박스칸, "1", i);
    return 만;
  }

  // ── 화면 ────────────────────────────────────────────────────────
  let 판 = null;
  const 입력틀 =
    "width:100%;box-sizing:border-box;background:#0b0c0e;color:#eee;border:1px solid #3a3a3a;" +
    "border-radius:5px;padding:6px 7px;font-size:12px;";
  function 틀() {
    if (판) return 판;
    판 = document.createElement("div");
    판.id = "logii-af";
    판.style.cssText =
      // [사장님 지시 2026-08-29] 오른쪽 위는 「다음단계」를 가렸고 왼쪽 아래는 잘 안 보인다.
      // **오른쪽 아래**로 둔다.
      "position:fixed;bottom:14px;right:14px;z-index:999999;width:300px;background:#16181c;" +
      "color:#e8e8e8;border:1px solid #333;border-radius:10px;padding:12px;max-height:92vh;" +
      "overflow-y:auto;font-family:'맑은 고딕',sans-serif;font-size:12px;" +
      "box-shadow:0 8px 26px rgba(0,0,0,.5);";
    document.body.appendChild(판);
    return 판;
  }
  function 단추(글, 색, fn, 폭) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = 글;
    b.style.cssText = "background:" + 색 + ";color:#fff;border:none;border-radius:5px;" +
      "padding:6px 9px;cursor:pointer;font-size:11px;flex:" + (폭 || "0 0 auto") + ";";
    b.onclick = fn; return b;
  }

  function 그리기() {
    const p = 틀(); p.innerHTML = "";
    const t = document.createElement("div");
    t.textContent = "로지아이 자동입력 v1.7.0";
    t.style.cssText = "font-size:13px;font-weight:700;margin-bottom:8px;color:#fff;";
    p.appendChild(t);
    상태줄 = document.createElement("div");
    상태줄.style.cssText = "font-size:11px;color:#9ad;min-height:15px;margin-bottom:8px;";
    p.appendChild(상태줄);

    if (!받는사람화면()) {
      const m = document.createElement("div");
      m.style.cssText = "font-size:11px;color:#999;";
      m.textContent = 메인화면() ? "택배예약을 시작해 받는사람 화면까지 갑니다."
                                 : "받는사람 화면에서 자동입력 칸이 열립니다.";
      p.appendChild(m); return;
    }

    // ── 보낼 곳 박스들 ──
    박스들().forEach((b, n) => {
      const card = document.createElement("div");
      card.style.cssText =
        "background:#1f2329;border:1px solid #383e47;border-radius:8px;padding:8px 9px;margin-bottom:7px;";
      const 제목 = document.createElement("div");
      제목.textContent = b.라벨 || ((b.이름 || "") + (b.물품명 ? " · " + b.물품명 : ""));
      제목.style.cssText = "font-size:12px;font-weight:700;color:#fff;margin-bottom:3px;";
      const 밑 = document.createElement("div");
      밑.textContent = (b.우편 ? "(" + b.우편 + ") " : "") + (b.주소 || "").slice(0, 30);
      밑.style.cssText = "font-size:10px;color:#8b93a0;margin-bottom:7px;line-height:1.4;";
      const 줄 = document.createElement("div");
      줄.style.cssText = "display:flex;gap:6px;";
      줄.appendChild(단추("적용", "#2f7d3c", () => {
        const i = 빈줄찾기();
        const 만 = 채우기(b, i);
        주소팝업(b, i);        // 주소는 팝업으로 골라야 로지아이가 받아 준다
        if (!b.붙박이 && !이번에적용.includes(b)) 이번에적용.push(b);
        알림(`${i + 1}번째 받는 분에 넣었습니다` + (만 ? ` · 물품가액 ${만}만원` : "") +
             (b.붙박이 ? "" : " · 다음단계로 가면 이 박스는 지워집니다"), "#8d8");
      }, "1"));
      줄.appendChild(단추(b.붙박이 ? "고정" : "삭제", b.붙박이 ? "#3a3f47" : "#5a2b2b", () => {
        if (b.붙박이) { 알림("솔드아웃은 늘 같은 곳이라 지우지 않습니다"); return; }
        cfg.박스 = (cfg.박스 || []).filter((x) => x !== b);
        저장(); 그리기(); 알림("지웠습니다");
      }, "1"));
      card.appendChild(제목); card.appendChild(밑); card.appendChild(줄);
      p.appendChild(card);
    });

    // ── 저장소에서 다시 받기 ──
    p.appendChild((() => {
      const d = document.createElement("div");
      d.style.cssText = "display:flex;gap:6px;margin:2px 0 8px;";
      d.appendChild(단추("↻ 저장소에서 다시 받기", "#2f4a5d", async () => {
        알림("받는 중…");
        const r = await 저장소에서받기();
        if (r.오류) { 알림(r.오류, "#f88"); return; }
        저장소박스 = r.목 || [];
        그리기();
        알림("보낼 것 " + 저장소박스.length + "건" + (r.때 ? " (" + r.때 + ")" : ""), "#8d8");
      }, "1"));
      return d;
    })());

    // ── 새 박스 만들기 ──
    const 접 = document.createElement("details");
    접.style.cssText = "margin-top:4px;";
    const 머리 = document.createElement("summary");
    머리.textContent = "＋ 손으로 새로 만들기 (평소에는 안 씁니다)";
    머리.style.cssText = "cursor:pointer;font-size:11px;color:#9ad;padding:4px 0;";
    접.appendChild(머리);

    function 칸(라벨, 여러줄) {
      const w = document.createElement("div"); w.style.cssText = "margin-top:6px;";
      const l = document.createElement("div"); l.textContent = 라벨;
      l.style.cssText = "font-size:10px;color:#8b93a0;margin-bottom:3px;";
      const i = document.createElement(여러줄 ? "textarea" : "input");
      if (여러줄) { i.rows = 3; i.style.resize = "vertical"; } else i.type = "text";
      i.style.cssText = 입력틀;
      w.appendChild(l); w.appendChild(i); w._i = i; return w;
    }
    const 붙임 = 칸("판매처 화면을 통째로 붙여넣기", true);
    const 라벨 = 칸("박스 이름 (예: 후르츠 이영창 슈프림 청바지)");
    const 물명 = 칸("물품명 (예: 슈프림 청바지)");
    const 가액 = 칸("물품가액 (원 · 30만 넘으면 30만)");
    [붙임, 라벨, 물명, 가액].forEach((c) => 접.appendChild(c));

    const 만들기줄 = document.createElement("div");
    만들기줄.style.cssText = "display:flex;gap:6px;margin-top:8px;";
    만들기줄.appendChild(단추("박스로 만들기", "#2f5d7d", () => {
      const g = 갈라내기(붙임._i.value);
      if (!g.이름 || !g.주소) {
        알림("이름과 주소를 못 갈라냈습니다 — 붙여넣은 글을 보고 다시 해 주십시오", "#f88");
        return;
      }
      const 새 = {
        라벨: (라벨._i.value.trim() || (g.이름 + (물명._i.value.trim() ? " " + 물명._i.value.trim() : ""))),
        이름: g.이름, 전화: g.전화, 우편: g.우편, 주소: g.주소, 상세: g.상세,
        물품명: 물명._i.value.trim(), 물품가액: 가액._i.value.trim(),
      };
      cfg.박스 = [새].concat(cfg.박스 || []).slice(0, 30);
      저장(); 그리기();
      알림("박스를 만들었습니다 — 「적용」 을 누르면 들어갑니다", "#8d8");
    }, "1"));
    접.appendChild(만들기줄);
    p.appendChild(접);

    // ── 잘못 지워졌을 때 되살리기 ──
    if ((cfg.지운것 || []).length) {
      const 되 = document.createElement("details");
      되.style.cssText = "margin-top:4px;";
      const h = document.createElement("summary");
      h.textContent = "↩ 지워진 것 되살리기 (" + cfg.지운것.length + ")";
      h.style.cssText = "cursor:pointer;font-size:11px;color:#8b93a0;padding:4px 0;";
      되.appendChild(h);
      cfg.지운것.forEach((b) => {
        const d = document.createElement("div");
        d.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:5px;";
        const nm = document.createElement("div");
        nm.textContent = b.라벨 || b.이름 || "";
        nm.style.cssText = "flex:1;font-size:11px;color:#aab;overflow:hidden;white-space:nowrap;";
        d.appendChild(nm);
        d.appendChild(단추("되살리기", "#3a3f47", () => {
          cfg.박스 = [b].concat(cfg.박스 || []);
          cfg.지운것 = cfg.지운것.filter((x) => x !== b);
          저장(); 그리기(); 알림("되살렸습니다", "#8d8");
        }));
        되.appendChild(d);
      });
      p.appendChild(되);
    }

    // ── 받는 분 한 줄 더 ──
    p.appendChild((() => {
      const d = document.createElement("div");
      d.style.cssText = "display:flex;gap:6px;margin-top:9px;";
      d.appendChild(단추("받는 분 한 줄 더", "#4a3f6b", () => {
        try {
          if (typeof 페이지.addRecipient === "function") 페이지.addRecipient();
          setTimeout(() => {
            알림("줄을 늘렸습니다 — 모두 " +
                 document.getElementsByName("r_name").length + "줄입니다", "#8d8");
          }, 500);
        } catch (e) { 알림("줄을 못 늘렸습니다: " + e.message, "#f88"); }
      }, "1"));
      return d;
    })());

    const 도움 = document.createElement("div");
    도움.style.cssText = "font-size:10px;color:#777;margin-top:9px;line-height:1.5;";
    도움.textContent =
      "물품가액은 로지아이가 만원 단위로 받습니다 — 원으로 적으시면 만원으로 올려 넣고 30만원을 넘지 않습니다. " +
      "대형박스가 켜집니다. 여러 곳이면 「받는 분 한 줄 더」 를 누르고 다음 박스를 「적용」 하십시오. " +
      "마지막 제출은 자동으로 누르지 않습니다.";
    p.appendChild(도움);
  }

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand(cfg.자동진행 ? "자동 진행 끄기" : "자동 진행 켜기",
      () => { cfg.자동진행 = !cfg.자동진행; 저장(); location.reload(); });
    GM_registerMenuCommand("깃허브 토큰 넣기 (보낼 곳 목록 받기용)", () => {
      const v = window.prompt(
        "깃허브 토큰을 넣어 주십시오. 이 브라우저에만 저장되고 저장소에는 안 올라갑니다.", "");
      if (v && v.trim()) { GM_setValue(TOKEN_KEY, v.trim()); location.reload(); }
    });
    GM_registerMenuCommand("쓴 박스 다시 보이게", () => {
      cfg.쓴것 = []; 저장(); location.reload();
    });
  }

  function 시작() {
    그리기();
    if (받는사람화면()) 다음단추감시();
    if (메인화면()) 메인자동();
    else if (편의점화면()) 편의점자동();
    else if (받는사람화면()) {
      약관감시();
      알림("보낼 곳을 받는 중…");
      저장소에서받기().then((r) => {
        if (r.오류) { 알림(r.오류, "#fc8"); return; }
        저장소박스 = r.목 || [];
        그리기();
        알림("보낼 곳 " + 저장소박스.length + "건 — 고르고 「적용」", "#8d8");
      });
    }
  }
  if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(시작, 500);
  else document.addEventListener("DOMContentLoaded", () => setTimeout(시작, 500));
})();
