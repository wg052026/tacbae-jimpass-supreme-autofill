// ==UserScript==
// @name         Supreme 결제폼 자동입력 (KR/US)
// @namespace    https://github.com/wg052026/tacbae-jimpass-supreme-autofill
// @version      1.1.0
// @description  shop.supreme.com(KR) / us.supreme.com(US) 체크아웃 배송지·연락처 자동입력. 카드정보는 브라우저 보안정책(isTrusted)상 자동입력 불가하여 포함하지 않음.
// @author       wg052026
// @match        https://shop.supreme.com/checkouts/*
// @match        https://us.supreme.com/checkouts/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/supreme-checkout-autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/supreme-checkout-autofill.user.js
// ==/UserScript==

(function () {
  "use strict";

  // ── 저장 키 ──────────────────────────────────────────────────
  const KEY_COMMON = "supreme_common"; // email, givenName, familyName
  const KEY_KR = "supreme_kr";
  const KEY_US_NJ = "supreme_us_nj";
  const KEY_US_OR = "supreme_us_or";
  const KEY_US_ACTIVE = "supreme_us_active"; // "nj" | "or"

  function g(key, fallback) {
    return GM_getValue(key, fallback);
  }
  function s(key, val) {
    GM_setValue(key, val);
  }

  // ── 필드 자동입력 엔진 (기존 확장 genericMainWorld.js 그대로 이식) ──
  function setNativeValue(el, value) {
    const tag = el.tagName;
    if (tag === "SELECT") {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (tag === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      const truthy = ["true", "1", "yes", "check", "checked", "on"].includes(String(value).trim().toLowerCase());
      if (el.checked !== truthy) el.click();
      return;
    }
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    try {
      el.focus();
    } catch (e) {}
    try {
      el.value = "";
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    } catch (e) {}

    let current = "";
    for (const ch of String(value)) {
      current += ch;
      let ok = true;
      try {
        el.value = current;
      } catch (e) {
        ok = false;
      }
      if (!ok && el.value !== current) {
        try {
          const proto = tag === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          if (desc && desc.set) desc.set.call(el, current);
        } catch (e) {}
      }
      try {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      } catch (e) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      el.blur();
    } catch (e) {}
  }

  function findByLabelText(text) {
    if (!text) return null;
    const target = text.trim().toLowerCase();
    const labels = document.querySelectorAll("label");
    for (const label of labels) {
      const t = (label.textContent || "").trim().toLowerCase();
      if (t.includes(target)) {
        if (label.htmlFor) {
          const el = document.getElementById(label.htmlFor);
          if (el) return el;
        }
        const inner = label.querySelector("input, select, textarea");
        if (inner) return inner;
      }
    }
    return null;
  }

  async function runGenericAutofill(fields) {
    if (!fields || !fields.length) return;
    for (const f of fields) {
      let el = null;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        try {
          el = f.selector ? document.querySelector(f.selector) : findByLabelText(f.labelText);
        } catch (e) {
          el = null;
        }
        if (el) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!el) {
        console.warn("[Supreme 자동입력] 항목을 찾지 못함: " + (f.selector || f.labelText));
        continue;
      }
      try {
        setNativeValue(el, f.value);
      } catch (e) {
        console.warn("[Supreme 자동입력] 처리 실패: " + (f.selector || f.labelText), e);
      }
    }
  }

  // ── 프로필별 필드 목록 구성 ──────────────────────────────────────
  function buildKrFields() {
    const c = g(KEY_COMMON, {});
    const kr = g(KEY_KR, {});
    return [
      { selector: "input[autocomplete~=email]", value: c.email || "" },
      { selector: "input[autocomplete~=given-name]", value: c.givenName || "" },
      { selector: "input[autocomplete~=family-name]", value: c.familyName || "" },
      { selector: "input[autocomplete~=postal-code]", value: kr.postalCode || "" },
      { selector: "input[autocomplete~=address-level2]", value: kr.city || "" },
      { selector: "input[autocomplete~=address-line1]", value: kr.address1 || "" },
      { selector: "input[autocomplete~=address-line2]", value: kr.address2 || "" },
      { selector: "input[autocomplete*=tel]", value: kr.phone || "" },
      { selector: "#PaymentAdditionalField-Cards-PersonalCardDateOfBirth", value: kr.birthDate || "" },
      { selector: "input[name='Personal Customs Code']", value: kr.customsCode || "" },
      { labelText: "save this information for next time", value: "true" },
      { labelText: "accept all", value: "true" },
      { labelText: "i have read and agree to the supreme", value: "true" },
    ];
  }

  function buildUsFields(profile) {
    const c = g(KEY_COMMON, {});
    return [
      { selector: "input[autocomplete~=email]", value: c.email || "" },
      { selector: "input[autocomplete~=given-name]", value: c.givenName || "" },
      { selector: "input[autocomplete~=family-name]", value: c.familyName || "" },
      { selector: "input[autocomplete~=address-line1]", value: profile.address1 || "" },
      { selector: "input[autocomplete~=address-line2]", value: profile.address2 || "" },
      { selector: "input[autocomplete~=address-level2]", value: profile.city || "" },
      { selector: "select[autocomplete~=address-level1]", value: profile.state || "" },
      { selector: "input[autocomplete~=postal-code]", value: profile.zip || "" },
      { selector: "input[autocomplete*=tel]", value: profile.phone || "" },
    ];
  }

  async function run() {
    if (location.hostname === "shop.supreme.com") {
      const c = g(KEY_COMMON, {});
      const kr = g(KEY_KR, {});
      if (!c.email || !kr.address1) {
        window.alert("[Supreme 자동입력] 배송지 정보가 아직 설정되지 않았습니다.\n지금 바로 설정창을 열어드릴게요.");
        openSettings();
        return;
      }
      await runGenericAutofill(buildKrFields());
    } else if (location.hostname === "us.supreme.com") {
      const active = g(KEY_US_ACTIVE, "nj");
      const profile = g(active === "or" ? KEY_US_OR : KEY_US_NJ, {});
      const c = g(KEY_COMMON, {});
      if (!c.email || !profile.address1) {
        window.alert("[Supreme 자동입력] 배송지 정보가 아직 설정되지 않았습니다.\n지금 바로 설정창을 열어드릴게요.");
        openSettings();
        return;
      }
      await runGenericAutofill(buildUsFields(profile));
    }
  }

  // ── 설정 화면 ────────────────────────────────────────────────
  function el(tag, style, text) {
    const e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text != null) e.textContent = text;
    return e;
  }

  function inputRow(container, labelText, value) {
    const wrap = el("div", "margin-bottom:8px;");
    wrap.appendChild(el("label", "display:block;font-size:11px;color:#aaa;margin-bottom:3px;", labelText));
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.style.cssText =
      "width:100%;box-sizing:border-box;background:#000;color:#eee;border:1px solid #444;border-radius:5px;padding:6px 7px;font-size:12px;";
    wrap.appendChild(input);
    container.appendChild(wrap);
    return input;
  }

  function sectionTitle(container, text) {
    container.appendChild(el("h3", "font-size:13px;color:#e32113;margin:16px 0 8px;border-top:1px solid #333;padding-top:12px;", text));
  }

  function openSettings() {
    if (document.getElementById("supreme-af-modal")) return;
    const c = g(KEY_COMMON, {});
    const kr = g(KEY_KR, {});
    const nj = g(KEY_US_NJ, {});
    const or_ = g(KEY_US_OR, {});
    const active = g(KEY_US_ACTIVE, "nj");

    const overlay = el(
      "div",
      "position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-family:sans-serif;"
    );
    overlay.id = "supreme-af-modal";

    const box = el(
      "div",
      "background:#1a1a1a;color:#eee;border-radius:10px;padding:20px;width:360px;max-height:85vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,.5);"
    );
    box.appendChild(el("h2", "font-size:16px;margin:0;", "Supreme 배송지 설정"));
    box.appendChild(
      el("p", "font-size:11px;color:#888;margin:6px 0 0;", "카드정보는 브라우저 보안정책상 자동입력이 불가해 포함되지 않습니다.")
    );

    sectionTitle(box, "공통 (이메일 · 이름)");
    const iEmail = inputRow(box, "이메일", c.email);
    const iGiven = inputRow(box, "이름(First name)", c.givenName);
    const iFamily = inputRow(box, "성(Last name)", c.familyName);

    sectionTitle(box, "한국(KR) 배송");
    const iKrPostal = inputRow(box, "우편번호", kr.postalCode);
    const iKrCity = inputRow(box, "시/군/구 (영문, 예: hwaseong-si)", kr.city);
    const iKrAddr1 = inputRow(box, "주소1 (영문 도로명)", kr.address1);
    const iKrAddr2 = inputRow(box, "주소2 (상세)", kr.address2);
    const iKrPhone = inputRow(box, "전화번호 (예: 10 5454 7930)", kr.phone);
    const iKrBirth = inputRow(box, "생년월일 (YYYY-MM-DD, 카드 소유자)", kr.birthDate);
    const iKrCustoms = inputRow(box, "개인통관고유부호 (P로 시작)", kr.customsCode);

    sectionTitle(box, "미국(US) 배송 — 사용할 주소");
    const usToggleWrap = el("div", "display:flex;gap:14px;margin-bottom:10px;font-size:12px;");
    const njLabel = document.createElement("label");
    njLabel.style.cssText = "display:flex;align-items:center;gap:4px;cursor:pointer;";
    const njRadio = document.createElement("input");
    njRadio.type = "radio";
    njRadio.name = "us-active";
    njRadio.checked = active !== "or";
    njLabel.appendChild(njRadio);
    njLabel.appendChild(document.createTextNode("뉴저지"));
    const orLabel = document.createElement("label");
    orLabel.style.cssText = "display:flex;align-items:center;gap:4px;cursor:pointer;";
    const orRadio = document.createElement("input");
    orRadio.type = "radio";
    orRadio.name = "us-active";
    orRadio.checked = active === "or";
    orLabel.appendChild(orRadio);
    orLabel.appendChild(document.createTextNode("오레곤"));
    usToggleWrap.appendChild(njLabel);
    usToggleWrap.appendChild(orLabel);
    box.appendChild(usToggleWrap);

    box.appendChild(el("h4", "font-size:12px;color:#ccc;margin:6px 0 4px;", "뉴저지"));
    const iNjAddr1 = inputRow(box, "주소1", nj.address1);
    const iNjAddr2 = inputRow(box, "주소2", nj.address2);
    const iNjCity = inputRow(box, "도시", nj.city);
    const iNjState = inputRow(box, "주(2글자, 예: NJ)", nj.state || "NJ");
    const iNjZip = inputRow(box, "우편번호", nj.zip);
    const iNjPhone = inputRow(box, "전화번호", nj.phone);

    box.appendChild(el("h4", "font-size:12px;color:#ccc;margin:10px 0 4px;", "오레곤"));
    const iOrAddr1 = inputRow(box, "주소1", or_.address1);
    const iOrAddr2 = inputRow(box, "주소2", or_.address2);
    const iOrCity = inputRow(box, "도시", or_.city);
    const iOrState = inputRow(box, "주(2글자, 예: OR)", or_.state || "OR");
    const iOrZip = inputRow(box, "우편번호", or_.zip);
    const iOrPhone = inputRow(box, "전화번호", or_.phone);

    const btnRow = el("div", "display:flex;gap:8px;margin-top:16px;");
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "저장";
    saveBtn.style.cssText = "flex:1;background:#2f7d3c;color:#fff;border:none;border-radius:6px;padding:9px;cursor:pointer;font-size:13px;";
    saveBtn.addEventListener("click", () => {
      s(KEY_COMMON, { email: iEmail.value.trim(), givenName: iGiven.value.trim(), familyName: iFamily.value.trim() });
      s(KEY_KR, {
        postalCode: iKrPostal.value.trim(),
        city: iKrCity.value.trim(),
        address1: iKrAddr1.value.trim(),
        address2: iKrAddr2.value.trim(),
        phone: iKrPhone.value.trim(),
        birthDate: iKrBirth.value.trim(),
        customsCode: iKrCustoms.value.trim(),
      });
      s(KEY_US_NJ, {
        address1: iNjAddr1.value.trim(),
        address2: iNjAddr2.value.trim(),
        city: iNjCity.value.trim(),
        state: iNjState.value.trim(),
        zip: iNjZip.value.trim(),
        phone: iNjPhone.value.trim(),
      });
      s(KEY_US_OR, {
        address1: iOrAddr1.value.trim(),
        address2: iOrAddr2.value.trim(),
        city: iOrCity.value.trim(),
        state: iOrState.value.trim(),
        zip: iOrZip.value.trim(),
        phone: iOrPhone.value.trim(),
      });
      s(KEY_US_ACTIVE, orRadio.checked ? "or" : "nj");
      overlay.remove();
      window.alert("저장되었습니다. 이 정보는 이 브라우저에만 저장되며 GitHub에는 올라가지 않습니다.");
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "취소";
    cancelBtn.style.cssText = "flex:1;background:transparent;color:#ccc;border:1px solid #555;border-radius:6px;padding:9px;cursor:pointer;font-size:13px;";
    cancelBtn.addEventListener("click", () => overlay.remove());

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    box.appendChild(btnRow);

    overlay.appendChild(box);
    overlay.addEventListener("click", (e2) => {
      if (e2.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("배송지 정보 설정/수정", openSettings);
  }

  setTimeout(run, 500);
})();
