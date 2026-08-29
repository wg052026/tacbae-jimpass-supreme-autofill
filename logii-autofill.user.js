// ==UserScript==
// @name         로지아이 택배예약 자동입력
// @namespace    https://github.com/wg052026/tacbae-jimpass-supreme-autofill
// @version      1.3.1
// @description  로지아이(logii.com) 편의점 택배예약 — 메인에서 예약 시작·편의점 선택·다음단계까지 자동, 받는사람 주소 자동입력(솔드아웃 고정 주소 단추 포함)
// @author       wg052026
// @match        https://www.logii.com/
// @match        https://www.logii.com/Main.pm*
// @match        https://www.logii.com/Reservation/Reserve.pm*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/logii-autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/logii-autofill.user.js
// ==/UserScript==
(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────
  // 이 스크립트가 하는 일
  //   메인(Main.pm)      : 택배예약 화면으로 스스로 들어간다.
  //   1단계(편의점 선택) : 「세븐일레븐 편의점」을 고르고 다음단계로 넘어간다.
  //                        보내는사람 단계는 로지아이가 저장된 기본 발송지로 저절로 넘긴다.
  //   3단계(받는사람)    : 오른쪽 패널에서 고르거나 검색하면 칸을 채운다.
  //
  // 실측(2026-08-29)
  //   1단계 폼 RegiForm · many_comp_code = "eleven" · 카드 onclick=click_comp_code_select · 다음=GoNext()
  //   3단계 폼 RegiForm · 받는사람 칸에 **id 가 없다 — name 으로 잡는다**
  //     r_name · r_mobile1(select) · r_mobile2 · r_mobile3
  //     r_zipcode1(3자리,hidden) · r_zipcode2(2자리,hidden) · r_addr1 · r_addr2 · r_isl_div(hidden)
  //   우편번호 검색 : POST /Reservation/PopReserveZipRoadCvsNet.pm
  //     fname=RegiForm · gbn=R · comp_code=eleven · search_word=검색어
  //     결과 줄이 go_parent(우편번호앞3, 우편번호뒤2, 주소) 를 부른다
  //
  // 개인정보는 코드에 넣지 않는다(저장소가 Public). 전부 GM_setValue 로 이 브라우저에만 둔다.
  // ─────────────────────────────────────────────────────────────

  const CFG_KEY = "logii_cfg";
  const 기본설정 = {
    자동진행: true,          // 편의점 선택 화면에서 스스로 다음단계로 간다
    택배사: "eleven",        // 세븐일레븐
    최근: [],                // 최근에 넣은 받는사람 (최대 10건)
  };
  const cfg = Object.assign({}, 기본설정, GM_getValue(CFG_KEY, {}) || {});
  const 저장 = () => GM_setValue(CFG_KEY, cfg);

  // ── 물품 규칙 (사장님 확정 2026-08-29) ──
  //   물품명   브랜드 + 품목 (보기: 슈프림 후드티 · 캐피탈 장갑)
  //   물품가액 1만원 단위 · 최대 30만원
  //   박스     **대형박스 = C** (무게 20kg / 크기 160cm 이하 · 전자레인지박스·우체국5호박스) — 실측 확정
  const 물품 = { 가액단위: 10000, 가액상한: 300000, 박스: "C", 박스수량: 1 };
  function 가액다듬기(v) {
    let n = parseInt(String(v).replace(/[^0-9]/g, ""), 10);
    if (!n || n < 0) return "";
    n = Math.ceil(n / 물품.가액단위) * 물품.가액단위;      // 1만원 단위로 올린다
    if (n > 물품.가액상한) n = 물품.가액상한;              // 30만원을 넘지 않는다
    return String(n);
  }

  // 솔드아웃은 늘 같은 곳으로 간다 (사장님 확정 · 실측 검색 결과와 일치)
  const 솔드아웃 = {
    이름: "솔드아웃",
    우편1: "079", 우편2: "83",
    주소: "서울특별시 양천구  목동동로 363(목동)",   // 시군구와 도로명 사이 공백 두 칸
    상세: "솔드아웃",
    // 검수센터 070-5117-5114 (사장님 확정 2026-08-29)
    // 앞자리가 목록에 없으면 목록에 만들어 넣고 고른다(사장님 지시 — 휴대폰 칸에 그대로).
    휴대1: "070", 휴대2: "5117", 휴대3: "5114",
  };

  // ── 화면에 상태를 직접 보여 준다 (캡처를 뜨지 않아도 무엇이 됐는지 보이게) ──
  let 상태줄 = null;
  function 알림(msg, 색) {
    if (상태줄) {
      상태줄.textContent = msg;
      상태줄.style.color = 색 || "#9ad";
    }
    try { console.log("[로지아이 자동입력]", msg); } catch (e) {}
  }

  // ── 값 넣기 : 네이티브 setter 로 넣어야 되돌아가지 않는다 ──
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }
  function 넣기(name, value, idx) {
    const els = document.getElementsByName(name);
    const el = els && els[idx || 0];
    if (!el) return false;
    setNativeValue(el, value == null ? "" : String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function 고르기(name, value, idx, 없으면만들기) {
    const els = document.getElementsByName(name);
    const el = els && els[idx || 0];
    if (!el) return false;
    const 있나 = [...el.options].some((o) => o.value === value);
    // [사장님 지시 2026-08-29 — "그냥 휴대폰 자리에 넣어"]
    // 070 처럼 목록에 없는 앞자리는 **목록에 만들어 넣고** 고른다.
    if (!있나) {
      if (!없으면만들기) return false;
      el.appendChild(new Option(value, value));
    }
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  const 페이지 = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const 받는사람화면 = () => !!document.getElementsByName("r_name").length;
  const 편의점화면 = () =>
    !!document.getElementsByName("many_comp_code").length && !받는사람화면();
  // 메인 화면 — 로그인하면 여기로 온다. 여기서부터 예약을 시작한다.
  const 메인화면 = () => {
    const p = location.pathname || "";
    return (p === "/" || /^\/Main\.pm/i.test(p)) && !편의점화면() && !받는사람화면();
  };
  const 예약주소 = "/Reservation/Reserve.pm?select_service=delv_24&sub_comp_code=";

  // ── 메인 : 택배예약으로 스스로 들어간다 ─────────────────────────
  function 메인자동() {
    if (!cfg.자동진행) { 알림("자동 진행이 꺼져 있습니다 — 메뉴에서 켤 수 있습니다"); return; }
    // [사장님 지시 2026-08-29] 기다리지 말고 바로 넘어간다.
    // 그냥 로지아이를 쓰실 때는 메뉴(Tampermonkey)에서 「자동 진행 끄기」를 누르시면 된다.
    알림("택배예약으로 갑니다…");
    location.href = 예약주소;
  }

  // ── 1단계 : 편의점 고르고 다음단계 ──────────────────────────────
  function 편의점자동() {
    if (!cfg.자동진행) { 알림("자동 진행이 꺼져 있습니다 — 메뉴에서 켤 수 있습니다"); return; }
    const 카드 = [...document.querySelectorAll("[onclick]")].find(
      (e) =>
        /click_comp_code_select/.test(e.getAttribute("onclick") || "") &&
        /세븐일레븐 편의점/.test(e.innerText || "")
    );
    if (!카드) { 알림("세븐일레븐 카드를 못 찾았습니다", "#f88"); return; }

    // [사장님 지시 2026-08-29] 기다리지 말고 바로 넘어간다.
    try {
      카드.click();
      const 값 = (document.getElementsByName("many_comp_code")[0] || {}).value;
      if (값 !== cfg.택배사) { 알림("택배사가 안 골라졌습니다: " + 값, "#f88"); return; }
      알림("다음단계로 갑니다…");
      if (typeof 페이지.GoNext === "function") 페이지.GoNext();
      else 알림("GoNext 를 못 찾았습니다 — 손으로 눌러 주십시오", "#f88");
    } catch (e) {
      알림("멈췄습니다: " + e.message, "#f88");
    }
  }

  // ── 우편번호 검색 : 팝업을 열지 않고 그 화면이 쓰는 통로를 직접 부른다 ──
  async function 주소검색(검색어) {
    const 몸 =
      "fname=RegiForm&gbn=R&comp_code=" + encodeURIComponent(cfg.택배사) +
      "&sub_comp_code=&addrbooksearch=&page_row=10&page_now=1&page_set=1" +
      "&search_word=" + encodeURIComponent(검색어);
    const res = await fetch("/Reservation/PopReserveZipRoadCvsNet.pm", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: 몸,
      credentials: "same-origin",
    });
    const html = await res.text();
    const 줄 = [];
    const re = /go_parent\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      if (줄.some((x) => x.우편1 === m[1] && x.우편2 === m[2] && x.주소 === m[3])) continue;
      줄.push({ 우편1: m[1], 우편2: m[2], 주소: m[3] });
      if (줄.length >= 10) break;
    }
    return 줄;
  }

  // ── 받는사람 채우기 ─────────────────────────────────────────────
  function 받는사람채우기(x) {
    if (!받는사람화면()) { 알림("받는사람 화면이 아닙니다", "#f88"); return; }
    넣기("r_name", x.이름 || "");
    // 번호는 **늘 휴대폰 칸**에 넣는다(사장님 지시). 앞자리가 목록에 없으면 만들어 넣는다.
    if (x.휴대1) 고르기("r_mobile1", x.휴대1, 0, true);
    넣기("r_mobile2", x.휴대2 || "");
    넣기("r_mobile3", x.휴대3 || "");
    넣기("r_zipcode1", x.우편1 || "");
    넣기("r_zipcode2", x.우편2 || "");
    넣기("r_addr1", x.주소 || "");
    넣기("r_addr2", x.상세 || "");
    물품채우기(x);
    // 도서산간 구분 — 팝업이 채우던 자리. 값이 없으면 육지로 둔다.
    if (document.getElementsByName("r_isl_div").length) 넣기("r_isl_div", x.도서 || "");
    // 최근 목록에 쌓아 둔다(이 브라우저에만)
    const 키 = (x.이름 || "") + "|" + (x.주소 || "") + "|" + (x.상세 || "");
    cfg.최근 = [{ 키, ...x }].concat((cfg.최근 || []).filter((r) => r.키 !== 키)).slice(0, 10);
    저장();
    // [고침 1.3.1] 다시 그리면 적어 두신 물품명·가액이 지워졌다. 그대로 남긴다.
    const 적은것 = [...(판 ? 판.querySelectorAll("input") : [])].map((i) => i.value);
    그리기();
    const 새칸 = [...(판 ? 판.querySelectorAll("input") : [])];
    적은것.forEach((v, i) => { if (새칸[i] && v) 새칸[i].value = v; });
    알림("채웠습니다 — 물품 정보와 약관은 확인하고 눌러 주십시오", "#8d8");
  }

  // ── 물품 채우기 ────────────────────────────────────────────────
  function 물품채우기(x) {
    if (x.물품명) 넣기("comm_p_code_name", x.물품명);
    const 값 = 가액다듬기(x.물품가액);
    if (값) 넣기("p_pric", 값);
    // 대형박스(C)를 켠다. 체크박스는 로지아이 쪽 코드가 붙어 있어 **클릭**으로 켜야 한다.
    const 박스 = document.getElementById("bs_" + 물품.박스 + "_0");
    if (박스 && !박스.checked) {
      try { 박스.click(); } catch (e) {}
    }
    넣기("p_amt_" + 물품.박스, String(물품.박스수량));
  }

  // ── 화면 ────────────────────────────────────────────────────────
  let 판 = null;
  function 틀만들기() {
    if (판) return 판;
    판 = document.createElement("div");
    판.id = "logii-af";
    판.style.cssText =
      // [사장님 지시 2026-08-29] 오른쪽 위에 두었더니 「다음단계」 단추를 가렸다.
      // 왼쪽 아래로 옮긴다.
      "position:fixed;bottom:14px;left:14px;z-index:999999;width:300px;background:#16181c;" +
      "color:#e8e8e8;border:1px solid #333;border-radius:10px;padding:12px 12px 10px;" +
      "font-family:'맑은 고딕',sans-serif;font-size:12px;box-shadow:0 8px 26px rgba(0,0,0,.5);";
    document.body.appendChild(판);
    return 판;
  }
  function 단추(글, 색, fn) {
    const b = document.createElement("button");
    b.textContent = 글;
    b.style.cssText =
      "flex:1;background:" + 색 + ";color:#fff;border:none;border-radius:6px;padding:8px;" +
      "cursor:pointer;font-size:12px;";
    b.onclick = fn;
    return b;
  }
  function 줄(내용) {
    const d = document.createElement("div");
    d.style.cssText = "display:flex;gap:6px;margin-top:7px;";
    (Array.isArray(내용) ? 내용 : [내용]).forEach((c) => d.appendChild(c));
    return d;
  }
  function 칸(라벨, 값, 폭) {
    const w = document.createElement("div");
    w.style.cssText = "flex:" + (폭 || 1) + ";";
    const l = document.createElement("div");
    l.textContent = 라벨;
    l.style.cssText = "font-size:11px;color:#999;margin-bottom:3px;";
    const i = document.createElement("input");
    i.type = "text";
    i.value = 값 || "";
    i.style.cssText =
      "width:100%;box-sizing:border-box;background:#0b0c0e;color:#eee;border:1px solid #3a3a3a;" +
      "border-radius:5px;padding:6px 7px;font-size:12px;";
    w.appendChild(l); w.appendChild(i);
    w._input = i;
    return w;
  }

  function 그리기() {
    const p = 틀만들기();
    p.innerHTML = "";
    const t = document.createElement("div");
    t.textContent = "로지아이 자동입력 v1.3.1";
    t.style.cssText = "font-size:13px;font-weight:700;margin-bottom:8px;color:#fff;";
    p.appendChild(t);

    상태줄 = document.createElement("div");
    상태줄.style.cssText = "font-size:11px;color:#9ad;min-height:15px;margin-bottom:6px;";
    p.appendChild(상태줄);

    if (!받는사람화면()) {
      const m = document.createElement("div");
      m.style.cssText = "font-size:11px;color:#999;";
      m.textContent = 메인화면()
        ? "택배예약을 시작해 받는사람 화면까지 갑니다."
        : "받는사람 화면에서 자동입력 칸이 열립니다.";
      p.appendChild(m);
      return;
    }

    // 솔드아웃 — 한 번에
    p.appendChild(
      줄(단추("솔드아웃 (07983)", "#2f5d7d", () =>
        받는사람채우기(Object.assign({}, 솔드아웃, {
          물품명: (물품명 && 물품명._input.value.trim()) || "",
          물품가액: (가액 && 가액._input.value.trim()) || "",
        }))))
    );

    // 최근 목록
    if ((cfg.최근 || []).length) {
      const s = document.createElement("select");
      s.style.cssText =
        "width:100%;margin-top:7px;background:#0b0c0e;color:#eee;border:1px solid #3a3a3a;" +
        "border-radius:5px;padding:6px;font-size:12px;";
      s.appendChild(new Option("최근에 넣은 곳…", ""));
      cfg.최근.forEach((r, i) =>
        s.appendChild(new Option((r.이름 || "") + " · " + (r.주소 || "").slice(0, 18), String(i)))
      );
      s.onchange = () => { if (s.value !== "") 받는사람채우기(cfg.최근[+s.value]); };
      p.appendChild(s);
    }

    // 손으로 넣기
    const 이름 = 칸("받는사람", "");
    const 휴2 = 칸("휴대폰 중간", "");
    const 휴3 = 칸("뒷자리", "");
    p.appendChild(줄(이름));
    p.appendChild(줄([휴2, 휴3]));

    const 검색 = 칸("도로명 주소 검색 (예: 목동동로 363)", "");
    p.appendChild(줄(검색));
    const 결과 = document.createElement("select");
    결과.style.cssText =
      "width:100%;margin-top:6px;background:#0b0c0e;color:#eee;border:1px solid #3a3a3a;" +
      "border-radius:5px;padding:6px;font-size:12px;display:none;";
    p.appendChild(결과);
    const 상세 = 칸("상세주소", "");
    p.appendChild(줄(상세));
    const 물품명 = 칸("물품명 (예: 슈프림 후드티)", "");
    p.appendChild(줄(물품명));
    const 가액 = 칸("물품가액 (1만원 단위 · 최대 30만)", "");
    p.appendChild(줄(가액));

    let 고른것 = null;
    p.appendChild(
      줄([
        단추("주소 찾기", "#3a3f47", async () => {
          const w = 검색._input.value.trim();
          if (!w) { 알림("검색어를 넣어 주십시오", "#f88"); return; }
          알림("찾는 중…");
          try {
            const 목 = await 주소검색(w);
            결과.innerHTML = "";
            if (!목.length) { 결과.style.display = "none"; 알림("결과가 없습니다", "#f88"); return; }
            목.forEach((r, i) => 결과.appendChild(new Option(r.주소, String(i))));
            결과.style.display = "block";
            고른것 = 목[0];
            결과.onchange = () => { 고른것 = 목[+결과.value]; };
            알림(목.length + "건 찾았습니다 — 고르고 「채우기」");
          } catch (e) {
            알림("검색이 막혔습니다: " + e.message, "#f88");
          }
        }),
        단추("채우기", "#2f7d3c", () => {
          if (!고른것) { 알림("주소를 먼저 찾아 주십시오", "#f88"); return; }
          받는사람채우기({
            이름: 이름._input.value.trim(),
            휴대1: "010", 휴대2: 휴2._input.value.trim(), 휴대3: 휴3._input.value.trim(),
            우편1: 고른것.우편1, 우편2: 고른것.우편2,
            주소: 고른것.주소, 상세: 상세._input.value.trim(),
            물품명: 물품명._input.value.trim(),
            물품가액: 가액._input.value.trim(),
          });
        }),
      ])
    );

    const 도움 = document.createElement("div");
    도움.style.cssText = "font-size:10px;color:#777;margin-top:8px;line-height:1.5;";
    도움.textContent =
      "물품가액은 1만원 단위로 올려 넣고 30만원을 넘지 않습니다. 대형박스가 켜집니다. " +
      "마지막 제출은 자동으로 누르지 않습니다.";
    p.appendChild(도움);
  }

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand(
      (cfg.자동진행 ? "자동 진행 끄기" : "자동 진행 켜기"),
      () => { cfg.자동진행 = !cfg.자동진행; 저장(); location.reload(); }
    );
  }

  function 시작() {
    그리기();
    if (메인화면()) 메인자동();
    else if (편의점화면()) 편의점자동();
    else if (받는사람화면()) 알림("받는사람 화면입니다 — 아래에서 고르십시오");
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(시작, 500);
  } else {
    document.addEventListener("DOMContentLoaded", () => setTimeout(시작, 500));
  }
})();
