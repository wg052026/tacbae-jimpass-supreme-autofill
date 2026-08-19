// ==UserScript==
// @name         KREAM 택배예약 자동입력
// @namespace    https://github.com/wg052026/tacbae-jimpass-supreme-autofill
// @version      1.0.0
// @description  롯데글로벌로지스 KREAM 택배예약(방문/편의점) 발송인·물품정보 자동입력
// @author       wg052026
// @match        https://www.lotteglogis.com/home/reservation/kream/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/kream-autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/kream-autofill.user.js
// ==/UserScript==

(function () {
  "use strict";

  // ── 발송인 기본값 (여기만 고치면 됨) ─────────────────────────────
  const SENDER = {
    name: "르플러스",
    tel1: "010",
    tel2: "5454",
    tel3: "7930",
    roadKeyword: "죽전로1길6-14",
    addr3: "302호",
    goodsName: "크림판매",
    goodsValue: "500000", // storeForm은 최대 100만원, form은 최대 300만원
    goodsNumber: "1",
  };
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

  function callSetSenderAddress(found) {
    if (!found || typeof window.setSenderAddress !== "function") return;
    window.setSenderAddress({
      ZIP_NO: found.ZIP_CD,
      ROAD_ZIP_NO: found.BAS_AREA_CD,
      CITY_DO: found.CITY_DO,
      CITY_GUN_GU: found.CITY_GUN_GU,
      C_RPN_TEL: found.C_RPN_TEL,
      C_BRNSHP_CD: found.C_BRNSHP_CD,
      C_BRNSHP_NM: found.C_BRNSHP_NM,
      BAS_AREA_CD: found.BAS_AREA_CD,
      BLD_MGR_NO: found.BLD_MGR_NO,
    });
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

    await typeChar(byId(F.name), SENDER.name);
    await typeChar(byId(F.tel1), SENDER.tel1);
    await typeChar(byId(F.tel2), SENDER.tel2);
    await typeChar(byId(F.tel3), SENDER.tel3);

    const found = await searchZip(SENDER.roadKeyword);
    callSetSenderAddress(found);
    await sleep(300);
    await typeChar(byId(F.addr3), SENDER.addr3);

    if (typeof window.fnCheckSenderPossible === "function") {
      window.fnCheckSenderPossible();
      await sleep(500);
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

    if (typeof window.CalFare === "function") {
      window.CalFare();
    }
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
