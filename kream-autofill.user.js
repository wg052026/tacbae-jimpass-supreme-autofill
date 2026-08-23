// ==UserScript==
// @name         KREAM 택배예약 자동입력
// @namespace    https://github.com/wg052026/tacbae-jimpass-supreme-autofill
// @version      1.4.0
// @description  롯데글로벌로지스 KREAM 택배예약(방문/편의점) 발송인·물품정보 자동입력
// @author       wg052026
// @match        https://www.lotteglogis.com/home/reservation/kream/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/kream-autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/kream-autofill.user.js
// ==/UserScript==

(function () {
  "use strict";

  // ── 발송인 정보: 코드에 안 넣고 Tampermonkey 로컬 저장소에만 저장 ──
  const CONFIG_KEY = "kream_sender_config";
  const CONFIG_FIELDS = [
    { key: "name", label: "성명 (최대 10자)" },
    { key: "tel1", label: "전화번호 앞자리 (예: 010)" },
    { key: "tel2", label: "전화번호 중간자리" },
    { key: "tel3", label: "전화번호 뒷자리" },
    { key: "roadKeyword", label: "도로명 주소 검색어 (예: 죽전로1길6-14)" },
    { key: "addr3", label: "상세주소 (예: 302호)" },
    { key: "goodsName", label: "물품명 (최대 15자)" },
    { key: "goodsValue", label: "물품가액 (숫자만, storeForm 최대 100만/form 최대 300만)" },
    { key: "goodsNumber", label: "개수 (최대 9)" },
  ];

  function getConfig() {
    return GM_getValue(CONFIG_KEY, null);
  }

  function saveConfig(cfg) {
    GM_setValue(CONFIG_KEY, cfg);
  }

  function runSetupWizard() {
    if (document.getElementById("kream-af-modal")) return;
    const existing = getConfig() || {};

    const overlay = document.createElement("div");
    overlay.id = "kream-af-modal";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.6);" +
      "display:flex;align-items:center;justify-content:center;font-family:sans-serif;";

    const box = document.createElement("div");
    box.style.cssText =
      "background:#1a1a1a;color:#eee;border-radius:10px;padding:20px;width:340px;" +
      "max-height:85vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,.5);";

    const title = document.createElement("h2");
    title.textContent = "발송인 정보 설정";
    title.style.cssText = "font-size:16px;margin:0 0 14px;";
    box.appendChild(title);

    const inputs = {};
    CONFIG_FIELDS.forEach((f) => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "margin-bottom:10px;";
      const label = document.createElement("label");
      label.textContent = f.label;
      label.style.cssText = "display:block;font-size:12px;color:#aaa;margin-bottom:4px;";
      const input = document.createElement("input");
      input.type = "text";
      input.value = existing[f.key] || "";
      input.style.cssText =
        "width:100%;box-sizing:border-box;background:#000;color:#eee;border:1px solid #444;" +
        "border-radius:5px;padding:7px 8px;font-size:13px;";
      wrap.appendChild(label);
      wrap.appendChild(input);
      box.appendChild(wrap);
      inputs[f.key] = input;
    });

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;margin-top:12px;";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "저장";
    saveBtn.style.cssText =
      "flex:1;background:#2f7d3c;color:#fff;border:none;border-radius:6px;padding:9px;cursor:pointer;font-size:13px;";
    saveBtn.addEventListener("click", () => {
      const next = {};
      CONFIG_FIELDS.forEach((f) => {
        next[f.key] = inputs[f.key].value.trim();
      });
      saveConfig(next);
      overlay.remove();
      window.alert("발송인 정보가 저장되었습니다. 이 정보는 이 브라우저에만 저장되며 GitHub에는 올라가지 않습니다.");
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "취소";
    cancelBtn.style.cssText =
      "flex:1;background:transparent;color:#ccc;border:1px solid #555;border-radius:6px;padding:9px;cursor:pointer;font-size:13px;";
    cancelBtn.addEventListener("click", () => overlay.remove());

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    box.appendChild(btnRow);

    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("발송인 정보 설정/수정", runSetupWizard);
  }
  // ──────────────────────────────────────────────────────────────

  function byId(id) {
    return document.getElementById(id);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  async function typeChar(el, text) {
    if (!el) return;
    setNativeValue(el, "");
    el.focus();
    for (const ch of String(text)) {
      const cur = el.value;
      setNativeValue(el, cur + ch);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }

  // ── index 페이지: 전체 동의 상시 재체크 ──────────────────────────
  function watchTotalAgree() {
    const chk = byId("totAgree");
    if (!chk) return;
    setInterval(() => {
      if (!chk.checked) {
        chk.checked = true;
        chk.dispatchEvent(new Event("click", { bubbles: true }));
        chk.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, 500);
  }

  // ── form 페이지: 접수안내 팝업 상시 감시 후 자동 닫기 ─────────────
  function watchImgPopup() {
    setInterval(() => {
      const popup = byId("imgPopup");
      if (popup && popup.style.display !== "none") {
        const closeBtn = byId("closePopupBtn");
        if (closeBtn) closeBtn.click();
        else popup.style.display = "none";
      }
    }, 300);
  }

  async function searchZip(keyword) {
    try {
      const res = await fetch("/home/popup/common/zipcode5", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "mode=road&scwd=" + encodeURIComponent(keyword),
        credentials: "same-origin",
      });
      const data = await res.json();
      return (data.list && data.list[0]) || null;
    } catch (e) {
      return null;
    }
  }

  // 페이지 컨텍스트(unsafeWindow)에 접근 가능하면 그걸 쓰고, 아니면 window로 폴백
  const pageWin = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  function setVal(id, value) {
    const el = byId(id);
    if (!el) return false;
    setNativeValue(el, value == null ? "" : String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // 페이지가 띄우는 alert()를 잠시 가로채서 자동으로 넘긴다.
  const origAlert = pageWin.alert;
  let capturedAlerts = [];

  function startSuppressAlerts() {
    capturedAlerts = [];
    try {
      pageWin.alert = function (msg) {
        capturedAlerts.push(String(msg == null ? "" : msg));
      };
    } catch (e) {}
  }

  function stopSuppressAlerts() {
    try {
      pageWin.alert = origAlert;
    } catch (e) {}
    return capturedAlerts.slice();
  }

  function showAlert(msg) {
    try {
      origAlert.call(pageWin, msg);
    } catch (e) {
      window.alert(msg);
    }
  }

  // javascript: 링크(예약가능확인, 요금계산)를 눌러 페이지 컨텍스트에서 실행시킨다.
  function clickJsLink(fnName) {
    const a = document.querySelector('a[href*="' + fnName + '"]');
    if (a) {
      a.click();
      return true;
    }
    try {
      if (typeof pageWin[fnName] === "function") {
        pageWin[fnName]();
        return true;
      }
    } catch (e) {}
    return false;
  }

  // 우편번호 팝업을 열지 않고, 검색 API 결과로 주소 관련 필드를 직접 채운다.
  // (Tampermonkey 샌드박스에서는 페이지의 setSenderAddress를 호출할 수 없어서 직접 채움)
  function applySenderAddress(found, isForm) {
    if (!found) return false;
    const zip = String(found.ZIP_CD || "");
    const bas = String(found.BAS_AREA_CD || "");

    if (isForm) {
      setVal("sFromPost1", zip.substring(0, 3));
      setVal("sFromPost2", zip.substring(3, 6));
      setVal("sFromAddr1", found.CITY_DO);
      setVal("sFromAddr2", found.CITY_GUN_GU);
      setVal("sPickBrnshp", found.C_BRNSHP_NM);
      setVal("sPickBrnshpTel", found.C_RPN_TEL);
      setVal("sPickBrnshpCd", found.C_BRNSHP_CD);
    } else {
      setVal("snper_zip_no1", bas.substring(0, 2));
      setVal("snper_zip_no2", bas.substring(2, 5));
      setVal("snper_addr1", found.CITY_DO);
      setVal("snper_addr2", found.CITY_GUN_GU);
    }

    // 공통 API 파라미터
    setVal("snperBldMgrNo", found.BLD_MGR_NO);
    setVal("snperBasAreaCd", bas);
    setVal("snperAdrSctCd", "R"); // 도로명 검색이므로 R
    setVal("sFromPostShow1", bas); // 화면 표시용 (ROAD_ZIP_NO = BAS_AREA_CD)
    return true;
  }

  function getFieldMap() {
    const isForm = !!byId("sFromName");
    const isStore = !!byId("snper_nm");
    if (!isForm && !isStore) return null;
    return isForm
      ? {
          name: "sFromName",
          tel1: "sFromTel1",
          tel2: "sFromTel2",
          tel3: "sFromTel3",
          addr3: "sFromAddr3",
          goodsName: "sGoodsName",
          goodsValue: "sGoodsValue",
          goodsNumber: "sGoodsNumber",
        }
      : {
          name: "snper_nm",
          tel1: "snper_tel1",
          tel2: "snper_tel2",
          tel3: "snper_tel3",
          addr3: "snper_addr3",
          goodsName: "item_nm",
          goodsValue: "item_amt",
          goodsNumber: "box_amt_s",
        };
  }

  async function fillFormPage() {
    watchImgPopup();
    const F = getFieldMap();
    if (!F) return;

    const SENDER = getConfig();
    if (!SENDER || !SENDER.name) {
      window.alert('발송인 정보가 아직 설정되지 않았습니다.\n지금 바로 설정창을 열어드릴게요.');
      runSetupWizard();
      return;
    }

    await typeChar(byId(F.name), SENDER.name);
    await typeChar(byId(F.tel1), SENDER.tel1);
    await typeChar(byId(F.tel2), SENDER.tel2);
    await typeChar(byId(F.tel3), SENDER.tel3);

    const isForm = !!byId("sFromName");
    const found = await searchZip(SENDER.roadKeyword);
    if (!found) {
      window.alert(
        '[KREAM 자동입력] 주소 검색에 실패했습니다.\n검색어: "' +
          SENDER.roadKeyword +
          '"\n설정에서 도로명 주소 검색어를 확인해주세요. (예: 죽전로1길6-14)'
      );
    } else {
      applySenderAddress(found, isForm);
    }
    await sleep(300);
    await typeChar(byId(F.addr3), SENDER.addr3);

    // 예약가능확인 (페이지의 javascript: 링크를 클릭해 실행)
    // "해당 지역은 서비스 가능 지역입니다." 같은 성공 알림은 자동으로 넘긴다.
    startSuppressAlerts();
    clickJsLink("fnCheckSenderPossible");
    await sleep(1500);
    const checkMsgs = stopSuppressAlerts();
    const notOk = checkMsgs.filter((m) => !m.includes("가능"));
    if (notOk.length) {
      showAlert("[KREAM 자동입력] 예약가능확인 결과:\n" + notOk.join("\n"));
    }

    const senderBtn = byId("btnSender");
    if (senderBtn) senderBtn.click();
    await sleep(300);
    const receiverBtn = byId("btnReceiver");
    if (receiverBtn) receiverBtn.click();
    await sleep(300);

    await typeChar(byId(F.goodsName), SENDER.goodsName);
    await typeChar(byId(F.goodsValue), SENDER.goodsValue);
    await typeChar(byId(F.goodsNumber), SENDER.goodsNumber);

    // 요금계산 (페이지의 javascript: 링크를 클릭해 실행)
    clickJsLink("CalFare");
    // 최종 제출(#btnSubmit)은 자동으로 누르지 않음 — 사용자가 직접 확인 후 클릭
  }

  function init() {
    if (location.pathname.includes("/kream/index")) {
      watchTotalAgree();
    } else if (location.pathname.includes("/kream/form") || location.pathname.includes("/kream/storeForm")) {
      fillFormPage();
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 400);
  } else {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 400));
  }
})();
