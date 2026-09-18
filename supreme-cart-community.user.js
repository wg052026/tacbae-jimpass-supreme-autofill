// ==UserScript==
// @name         Supreme Community 장바구니
// @namespace    https://github.com/wg052026/tacbae-jimpass-supreme-autofill
// @version      2.6.0
// @description  supremecommunity.com에서 장바구니를 구성하고, shop/us.supreme.com에서 그대로 자동으로 찾아 담습니다. (한 스크립트로 통합 — 저장소를 공유해야 동작함)
// @author       wg052026
// @match        https://www.supremecommunity.com/*
// @match        https://shop.supreme.com/*
// @match        https://us.supreme.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/supreme-cart-community.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/supreme-cart-community.user.js
// ==/UserScript==

(function () {
  "use strict";
  if (location.hostname.indexOf("supremecommunity.com") === -1) return;


  const STORAGE_KEY = "scf_data";
  const QUEUE_KEY = "scf_purchase_queue";
  const RETRY_INTERVAL_KEY = "scf_retry_interval_ms";
  const GRACE_SEC_KEY = "scf_grace_sec_ms";

  function defaultData() {
    return { carts: {}, nextCartId: 1, nextItemId: 1 };
  }

  function getData() {
    return GM_getValue(STORAGE_KEY, null) || defaultData();
  }

  function setData(data) {
    GM_setValue(STORAGE_KEY, data);
  }

  // ── 담기 콤보박스 ──────────────────────────────────────────────
  function resolveUrl(raw) {
    if (!raw) return location.href;
    return new URL(raw, location.href).href;
  }

  function extractItemData(card) {
    let url;
    if (card.dataset.href) {
      url = resolveUrl(card.dataset.href);
    } else if (card.tagName === "A" && card.getAttribute("href")) {
      url = resolveUrl(card.getAttribute("href"));
    } else {
      const linkEl = card.querySelector("a.item-card-link, a[href]");
      url = resolveUrl(linkEl ? linkEl.getAttribute("href") : "");
    }
    const img = card.querySelector("img");
    const image = img ? img.currentSrc || img.src || "" : "";
    let title = card.dataset.name || "";
    if (!title) {
      const nameEl = card.querySelector(".item-name");
      title = nameEl ? nameEl.textContent.trim() : "";
    }
    if (!title && img && img.alt) {
      title = img.alt.replace(/^Supreme\s+/i, "").replace(/\s*-\s*\$[\d,.]+$/, "").trim();
    }
    let price = "";
    if (card.dataset.price) price = `$${card.dataset.price}`;
    else {
      const priceEl = card.querySelector(".item-price");
      price = priceEl ? priceEl.textContent.trim() : "";
    }
    return { url, image, title, price };
  }

  function extractDetailPageItemData(container) {
    const nameEl = container.querySelector(".item-title--desktop, .item-title--mobile");
    const title = nameEl ? nameEl.textContent.trim() : document.title.replace(/\s*-\s*Supreme.*$/i, "").trim();
    const priceEl = container.querySelector(".price-main");
    const price = priceEl ? priceEl.textContent.trim() : "";
    const img = container.querySelector("#main-item-image") || container.querySelector(".main-image img");
    const image = img ? img.currentSrc || img.src || "" : "";
    return { url: location.origin + location.pathname, image, title, price };
  }

  function createCart() {
    const data = getData();
    const id = data.nextCartId++;
    data.carts[id] = { name: `cart${id}`, included: false, items: [] };
    setData(data);
    return id;
  }

  function addItemToCart(cartId, itemData) {
    const data = getData();
    const cart = data.carts[cartId];
    if (!cart) return null;
    const id = data.nextItemId++;
    cart.items.push({
      id,
      title: itemData.title,
      url: itemData.url,
      image: itemData.image,
      price: itemData.price,
      color: "",
      size: "",
      colorOptions: [],
      sizeOptions: [],
      fetchStatus: "pending",
    });
    setData(data);
    return id;
  }

  async function fetchAndStoreOptions(cartId, itemId, url) {
    let colors = [];
    let sizes = [];
    let ok = false;
    try {
      const res = await fetch(url, { credentials: "omit" });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      colors = Array.from(doc.querySelectorAll(".colorway-tag"))
        .map((el) => el.textContent.trim())
        .filter(Boolean);
      sizes = Array.from(doc.querySelectorAll(".item-sizing-table table tr:first-child th"))
        .map((el) => el.textContent.trim())
        .filter(Boolean);
      sizes = sizes.length > 1 ? sizes.slice(1) : [];
      ok = true;
    } catch (e) {
      ok = false;
    }
    const data = getData();
    const cart = data.carts[cartId];
    if (!cart) return;
    const item = cart.items.find((it) => it.id === itemId);
    if (!item) return;
    if (ok) {
      item.colorOptions = colors;
      item.sizeOptions = sizes;
      item.fetchStatus = "done";
    } else {
      item.fetchStatus = "error";
    }
    setData(data);
    renderPanel();
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function buildOptionsHtml(carts) {
    let html = `<option value="" selected>담기 \u25be</option>`;
    Object.keys(carts)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((id) => {
        html += `<option value="${id}">${escapeHtml(carts[id].name)}</option>`;
      });
    html += `<option value="__new__">+ 새 장바구니</option>`;
    return html;
  }

  function refreshAllCombos() {
    const data = getData();
    document.querySelectorAll("select.scf-combo").forEach((sel) => {
      sel.innerHTML = buildOptionsHtml(data.carts);
    });
  }

  function flashDone(select) {
    select.classList.add("scf-done");
    setTimeout(() => {
      select.classList.remove("scf-done");
      select.value = "";
    }, 700);
  }

  function attachComboBehavior(select, getItemData) {
    select.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    select.addEventListener("mousedown", (e) => e.stopPropagation());
    select.addEventListener("change", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const value = select.value;
      if (!value) return;
      select.value = "";
      try {
        let targetCartId = value;
        if (value === "__new__") {
          targetCartId = createCart();
          refreshAllCombos();
          if (!targetCartId) {
            window.alert("[Supreme 장바구니] 새 장바구니 생성에 실패했습니다.");
            return;
          }
        }
        const itemData = getItemData();
        if (!itemData || !itemData.title) {
          window.alert("[Supreme 장바구니] 상품 정보를 읽지 못했습니다.");
          return;
        }
        const itemId = addItemToCart(targetCartId, itemData);
        if (!itemId) {
          window.alert("[Supreme 장바구니] 담기에 실패했습니다. 대상 장바구니를 찾지 못했습니다.");
          return;
        }
        flashDone(select);
        renderPanel();
        fetchAndStoreOptions(targetCartId, itemId, itemData.url);
      } catch (err) {
        window.alert("[Supreme 장바구니] 오류: " + (err && err.message ? err.message : String(err)));
      }
    });
  }

  function injectCombo(card) {
    if (card.querySelector(".scf-combo")) return;
    const select = document.createElement("select");
    select.className = "scf-combo";
    select.innerHTML = buildOptionsHtml(getData().carts);
    attachComboBehavior(select, () => extractItemData(card));
    card.appendChild(select);
  }

  let detailComboInjecting = false;
  function injectDetailPageCombo() {
    const container = document.querySelector(".item-detail[data-item-id]");
    if (!container) return;
    if (document.getElementById("scf-detail-combo")) return;
    if (detailComboInjecting) return;
    detailComboInjecting = true;
    try {
      const wrap = document.createElement("div");
      wrap.className = "scf-detail-wrap";
      const label = document.createElement("span");
      label.className = "scf-detail-label";
      label.textContent = "장바구니에 담기:";
      const select = document.createElement("select");
      select.id = "scf-detail-combo";
      select.className = "scf-combo scf-detail-combo";
      select.innerHTML = buildOptionsHtml(getData().carts);
      attachComboBehavior(select, () => extractDetailPageItemData(container));
      wrap.appendChild(label);
      wrap.appendChild(select);
      const panel = container.querySelector(".item-info-panel");
      if (panel) panel.insertBefore(wrap, panel.firstChild);
      else container.insertBefore(wrap, container.firstChild);
    } finally {
      detailComboInjecting = false;
    }
  }

  // ── 슬라이드 패널 ──────────────────────────────────────────────
  const collapsedState = {};
  let panelRoot = null;

  const CUSTOM_OPTION = "__custom__";

  function makeTextInput(value, placeholder, onChange) {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = value || "";
    input.addEventListener("change", () => onChange(input.value.trim()));
    return input;
  }

  function buildFieldEl({ options, value, placeholder, onChange }) {
    const wrap = document.createElement("span");
    wrap.className = "scf-field";

    function renderSelect() {
      wrap.textContent = "";
      const select = document.createElement("select");
      const optList = (options || []).slice();
      const isCustomValue = value && !optList.includes(value);

      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = placeholder;
      select.appendChild(blank);

      optList.forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (opt === value) o.selected = true;
        select.appendChild(o);
      });

      const customOpt = document.createElement("option");
      customOpt.value = CUSTOM_OPTION;
      customOpt.textContent = "직접 입력...";
      if (isCustomValue) customOpt.selected = true;
      select.appendChild(customOpt);

      select.addEventListener("change", () => {
        if (select.value === CUSTOM_OPTION) {
          renderInput("");
          return;
        }
        value = select.value;
        onChange(select.value);
      });

      wrap.appendChild(select);
      if (isCustomValue) renderInput(value);
    }

    function renderInput(initial) {
      wrap.textContent = "";
      const input = makeTextInput(initial, placeholder + " 직접입력", (val) => {
        value = val;
        onChange(val);
      });
      wrap.appendChild(input);

      const backBtn = document.createElement("button");
      backBtn.className = "scf-icon-btn scf-back-btn";
      backBtn.textContent = "\u21a9";
      backBtn.title = "목록에서 고르기";
      backBtn.addEventListener("click", () => {
        value = "";
        onChange("");
        renderSelect();
      });
      if (options && options.length) wrap.appendChild(backBtn);
      input.focus();
    }

    if (options && options.length > 0) renderSelect();
    else renderInput(value || "");

    return wrap;
  }

  const STATUS_LABEL = {
    pending: "대기 중",
    added: "담기 완료",
    soldout: "품절",
    notfound: "못 찾음",
    error: "오류",
    skipped_no_info: "컬러 없음(건너뜀)",
  };

  function renderBuyStatus(container) {
    const q = GM_getValue(QUEUE_KEY, null);
    container.textContent = "";
    if (!q) return;
    const lines = [];
    if (q.status === "cancelled") lines.push("취소되었습니다.");
    q.items.forEach((it, i) => {
      const mark = i === q.currentIndex && q.status === "running" ? "\u25b6 " : "  ";
      const label = STATUS_LABEL[it.status] || it.status || "대기 중";
      lines.push(`${mark}${it.title} (${it.color}/${it.size}) - ${label}`);
    });
    if (q.status === "done") lines.push("", "완료되었습니다.");
    container.textContent = lines.join("\n");
  }

  function buildQueueItems() {
    const data = getData();
    const includedIds = Object.keys(data.carts).filter((cid) => data.carts[cid].included);
    if (!includedIds.length) {
      window.alert('"포함" 체크된 장바구니가 없습니다.');
      return null;
    }
    const items = [];
    includedIds.forEach((cid) => {
      data.carts[cid].items.forEach((it) => {
        items.push({ title: it.title, color: it.color, size: it.size, status: "pending" });
      });
    });
    if (!items.length) {
      window.alert("체크된 장바구니에 담긴 상품이 없습니다.");
      return null;
    }
    return items;
  }

  function startSearch(mode) {
    const items = buildQueueItems();
    if (!items) return;
    GM_setValue(QUEUE_KEY, { items, currentIndex: 0, status: "running", mode });
    window.open("https://shop.supreme.com/collections/new", "_blank");
  }

  function renderPanel() {
    if (!panelRoot) return;
    const body = panelRoot.querySelector(".scf-panel-body");
    if (!body) return;
    body.textContent = "";
    const data = getData();

    // 설정 영역
    const settings = document.createElement("div");
    settings.className = "scf-settings";
    const intervalRow = document.createElement("div");
    intervalRow.className = "scf-row";
    const intervalLabel = document.createElement("label");
    intervalLabel.textContent = "재시도 간격(초)";
    const intervalInput = document.createElement("input");
    intervalInput.type = "number";
    intervalInput.min = "0.1";
    intervalInput.step = "0.1";
    intervalInput.value = ((GM_getValue(RETRY_INTERVAL_KEY, 500)) / 1000).toString();
    intervalInput.addEventListener("change", () => {
      const sec = parseFloat(intervalInput.value);
      GM_setValue(RETRY_INTERVAL_KEY, Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : 500);
    });
    intervalRow.appendChild(intervalLabel);
    intervalRow.appendChild(intervalInput);
    settings.appendChild(intervalRow);

    const graceRow = document.createElement("div");
    graceRow.className = "scf-row";
    const graceLabel = document.createElement("label");
    graceLabel.textContent = "첫 상품 담은 후 유예(초)";
    const graceInput = document.createElement("input");
    graceInput.type = "number";
    graceInput.min = "0";
    graceInput.step = "1";
    graceInput.value = ((GM_getValue(GRACE_SEC_KEY, 5000)) / 1000).toString();
    graceInput.addEventListener("change", () => {
      const sec = parseFloat(graceInput.value);
      GM_setValue(GRACE_SEC_KEY, Number.isFinite(sec) && sec >= 0 ? Math.round(sec * 1000) : 5000);
    });
    graceRow.appendChild(graceLabel);
    graceRow.appendChild(graceInput);
    settings.appendChild(graceRow);
    body.appendChild(settings);

    // 실행 버튼
    const buyBlock = document.createElement("div");
    buyBlock.className = "scf-buy-block";
    const startBtn = document.createElement("button");
    startBtn.className = "scf-btn scf-btn-primary";
    startBtn.textContent = "시작 (첫 상품만 최대 1분 재시도)";
    startBtn.addEventListener("click", () => startSearch("once"));
    const retryBtn = document.createElement("button");
    retryBtn.className = "scf-btn scf-btn-dark";
    retryBtn.textContent = "재시도 (품절이면 다음 상품, 계속 반복)";
    retryBtn.addEventListener("click", () => startSearch("continuous"));
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "scf-btn scf-btn-ghost";
    cancelBtn.textContent = "취소";
    cancelBtn.addEventListener("click", () => {
      const q = GM_getValue(QUEUE_KEY, null);
      if (!q) return;
      q.status = "cancelled";
      GM_setValue(QUEUE_KEY, q);
      renderPanel();
    });
    buyBlock.appendChild(startBtn);
    buyBlock.appendChild(retryBtn);
    buyBlock.appendChild(cancelBtn);
    const statusEl = document.createElement("div");
    statusEl.className = "scf-buy-status";
    renderBuyStatus(statusEl);
    buyBlock.appendChild(statusEl);
    body.appendChild(buyBlock);

    // 장바구니 관리 버튼
    const newCartBtn = document.createElement("button");
    newCartBtn.className = "scf-btn scf-btn-green";
    newCartBtn.textContent = "+ 새 장바구니 만들기";
    newCartBtn.addEventListener("click", () => {
      createCart();
      refreshAllCombos();
      renderPanel();
    });
    body.appendChild(newCartBtn);

    const clearAllBtn = document.createElement("button");
    clearAllBtn.className = "scf-btn scf-btn-danger";
    clearAllBtn.textContent = "전체 장바구니 삭제";
    clearAllBtn.addEventListener("click", () => {
      const d = getData();
      const n = Object.keys(d.carts).length;
      if (!n) return;
      if (!window.confirm(`장바구니 ${n}개를 전부 삭제할까요? 되돌릴 수 없습니다.`)) return;
      if (!window.confirm("정말로 전부 삭제하시겠어요?")) return;
      setData(defaultData());
      refreshAllCombos();
      renderPanel();
    });
    body.appendChild(clearAllBtn);

    // 장바구니 목록
    const list = document.createElement("div");
    list.className = "scf-cart-list";
    const cartIds = Object.keys(data.carts).sort((a, b) => Number(a) - Number(b));
    if (!cartIds.length) {
      const empty = document.createElement("div");
      empty.className = "scf-empty";
      empty.textContent = "아직 담긴 장바구니가 없습니다.\n상품 카드의 담기 버튼을 눌러보세요.";
      list.appendChild(empty);
    }

    cartIds.forEach((id) => {
      const cart = data.carts[id];
      const collapsed = collapsedState[id] === true;
      const cartEl = document.createElement("div");
      cartEl.className = "scf-cart";

      const header = document.createElement("div");
      header.className = "scf-cart-header";

      const includeLabel = document.createElement("label");
      includeLabel.className = "scf-flag";
      const includeCheckbox = document.createElement("input");
      includeCheckbox.type = "checkbox";
      includeCheckbox.checked = !!cart.included;
      includeCheckbox.addEventListener("click", (e) => {
        e.stopPropagation();
        const d = getData();
        d.carts[id].included = includeCheckbox.checked;
        setData(d);
      });
      includeLabel.appendChild(includeCheckbox);
      includeLabel.appendChild(document.createTextNode("포함"));

      const nameEl = document.createElement("span");
      nameEl.className = "scf-cart-name";
      nameEl.textContent = cart.name;

      const countEl = document.createElement("span");
      countEl.className = "scf-cart-count";
      countEl.textContent = `(${cart.items.length})`;

      const editBtn = document.createElement("button");
      editBtn.className = "scf-icon-btn";
      editBtn.textContent = "\u270e";
      editBtn.title = "이름 수정";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const newName = window.prompt("장바구니 이름", cart.name);
        if (newName === null) return;
        const d = getData();
        d.carts[id].name = newName.trim() || cart.name;
        setData(d);
        refreshAllCombos();
        renderPanel();
      });

      const delBtn = document.createElement("button");
      delBtn.className = "scf-icon-btn";
      delBtn.textContent = "\u2715";
      delBtn.title = "장바구니 삭제";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!window.confirm(`"${cart.name}" 장바구니를 삭제할까요?`)) return;
        const d = getData();
        delete d.carts[id];
        setData(d);
        refreshAllCombos();
        renderPanel();
      });

      header.appendChild(includeLabel);
      header.appendChild(nameEl);
      header.appendChild(countEl);
      header.appendChild(editBtn);
      header.appendChild(delBtn);
      header.addEventListener("click", () => {
        collapsedState[id] = !collapsed;
        renderPanel();
      });

      const itemsEl = document.createElement("div");
      itemsEl.className = "scf-cart-items" + (collapsed ? " scf-collapsed" : "");

      cart.items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "scf-item-row";

        const thumb = document.createElement("img");
        thumb.className = "scf-thumb";
        thumb.src = item.image || "";
        thumb.alt = "";
        row.appendChild(thumb);

        const titleEl = document.createElement("span");
        titleEl.className = "scf-item-title";
        titleEl.textContent = item.title || "(상품명 없음)";
        titleEl.title = item.title || "";
        row.appendChild(titleEl);

        if (item.fetchStatus === "pending") {
          const loading = document.createElement("span");
          loading.className = "scf-loading";
          loading.textContent = "불러오는 중...";
          row.appendChild(loading);
        } else {
          row.appendChild(
            buildFieldEl({
              options: item.colorOptions,
              value: item.color,
              placeholder: "컬러",
              onChange: (val) => {
                const d = getData();
                const t = d.carts[id].items.find((it) => it.id === item.id);
                if (t) t.color = val;
                setData(d);
              },
            })
          );
          row.appendChild(
            buildFieldEl({
              options: item.sizeOptions,
              value: item.size,
              placeholder: "사이즈",
              onChange: (val) => {
                const d = getData();
                const t = d.carts[id].items.find((it) => it.id === item.id);
                if (t) t.size = val;
                setData(d);
              },
            })
          );
        }

        const removeBtn = document.createElement("button");
        removeBtn.className = "scf-icon-btn";
        removeBtn.textContent = "\u2715";
        removeBtn.addEventListener("click", () => {
          const d = getData();
          d.carts[id].items = d.carts[id].items.filter((it) => it.id !== item.id);
          setData(d);
          renderPanel();
        });
        row.appendChild(removeBtn);
        itemsEl.appendChild(row);
      });

      cartEl.appendChild(header);
      cartEl.appendChild(itemsEl);
      list.appendChild(cartEl);
    });

    body.appendChild(list);
  }

  function createPanel() {
    if (document.getElementById("scf-panel")) return;
    panelRoot = document.createElement("div");
    panelRoot.id = "scf-panel";
    panelRoot.className = "scf-panel";

    const head = document.createElement("div");
    head.className = "scf-panel-head";
    const title = document.createElement("h2");
    title.textContent = "내 장바구니";
    const closeBtn = document.createElement("button");
    closeBtn.className = "scf-icon-btn";
    closeBtn.textContent = "\u2715";
    closeBtn.addEventListener("click", () => panelRoot.classList.remove("scf-open"));
    head.appendChild(title);
    head.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "scf-panel-body";

    panelRoot.appendChild(head);
    panelRoot.appendChild(body);
    document.body.appendChild(panelRoot);
    renderPanel();
  }

  function createFloatingButton() {
    if (document.getElementById("scf-floating-btn")) return;
    const btn = document.createElement("div");
    btn.id = "scf-floating-btn";
    btn.innerHTML =
      '<div class="scf-fb-icon"><svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M222.14 58.87A8 8 0 0 0 216 56H54.68L49.79 25.14A16 16 0 0 0 34 12H16a8 8 0 0 0 0 16h18l30.29 179.4A24 24 0 0 0 88 224h116a8 8 0 0 0 0-16H88a8 8 0 0 1-7.87-6.63L77.35 184h116.75a24 24 0 0 0 23.62-19.7L224 64.4a8 8 0 0 0-1.86-5.53M197.72 128h-127l-9.6-56H207.7z"/>' +
      '</svg></div><span class="scf-fb-label">장바구니</span>';
    btn.addEventListener("click", () => {
      createPanel();
      renderPanel();
      panelRoot.classList.toggle("scf-open");
    });
    document.body.appendChild(btn);
  }

  // ── 스타일 ────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
.scf-combo{position:absolute;top:6px;right:6px;z-index:50;font-size:11px;line-height:1.2;padding:3px 4px;height:24px;max-width:110px;border-radius:4px;border:1px solid #555;background:#111;color:#fff;cursor:pointer;}
.scf-combo.scf-done{border-color:#1d9e75;color:#1d9e75;}
.item-card{position:relative;}
.scf-detail-wrap{display:flex;align-items:center;gap:8px;margin:0 0 14px;padding:8px 10px;border:1px solid #333;border-radius:8px;background:#141414;}
.scf-detail-label{font-size:13px;color:#ccc;}
.scf-detail-combo{position:static;max-width:160px;height:30px;font-size:12px;}
#scf-floating-btn{position:fixed;bottom:20px;right:20px;z-index:2147483646;display:flex;flex-direction:column;align-items:center;gap:4px;background:#1a1a1a;border:1px solid #333;border-radius:14px;padding:10px 12px;box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;user-select:none;}
#scf-floating-btn .scf-fb-icon{width:40px;height:40px;border-radius:10px;background:#e32113;display:flex;align-items:center;justify-content:center;}
#scf-floating-btn .scf-fb-icon svg{width:22px;height:22px;fill:#fff;}
#scf-floating-btn .scf-fb-label{font-size:11px;color:#ccc;font-family:-apple-system,"Malgun Gothic",sans-serif;}
.scf-panel{position:fixed;top:0;right:0;width:380px;max-width:92vw;height:100vh;background:#111;color:#eee;z-index:2147483647;box-shadow:-4px 0 20px rgba(0,0,0,.5);display:flex;flex-direction:column;font-family:-apple-system,"Malgun Gothic",sans-serif;font-size:13px;transform:translateX(100%);transition:transform .25s ease;}
.scf-panel.scf-open{transform:translateX(0);}
.scf-panel-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #262626;}
.scf-panel-head h2{font-size:15px;margin:0;}
.scf-panel-body{flex:1;overflow-y:auto;padding:12px 16px;}
.scf-settings{margin-bottom:10px;}
.scf-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:12px;color:#ccc;}
.scf-row input{width:70px;background:#000;border:1px solid #444;color:#eee;border-radius:4px;padding:5px 6px;font-size:12px;}
.scf-buy-block{border:1px solid #333;border-radius:8px;padding:10px;margin-bottom:10px;}
.scf-btn{width:100%;border:none;border-radius:6px;padding:8px;margin-bottom:6px;cursor:pointer;font-size:12.5px;font-weight:600;}
.scf-btn-primary{background:#da291c;color:#fff;}
.scf-btn-dark{background:#7a1610;color:#fff;}
.scf-btn-green{background:#1d9e75;color:#fff;}
.scf-btn-ghost{background:transparent;color:#999;border:1px solid #444;font-weight:400;}
.scf-btn-danger{background:transparent;color:#e24b4a;border:1px solid #552626;font-weight:400;}
.scf-buy-status{font-size:10.5px;color:#999;line-height:1.5;white-space:pre-line;}
.scf-cart{border:1px solid #333;border-radius:8px;margin-bottom:10px;overflow:hidden;}
.scf-cart-header{display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;background:#1a1a1a;}
.scf-flag{display:flex;align-items:center;gap:2px;font-size:10px;color:#aaa;cursor:pointer;user-select:none;}
.scf-cart-name{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.scf-cart-count{color:#888;font-size:11px;}
.scf-icon-btn{background:none;border:none;color:#888;cursor:pointer;font-size:13px;padding:2px 4px;}
.scf-icon-btn:hover{color:#fff;}
.scf-cart-items{padding:6px 10px 10px;display:flex;flex-direction:column;gap:6px;}
.scf-cart-items.scf-collapsed{display:none;}
.scf-item-row{display:flex;align-items:center;gap:8px;border-top:1px solid #262626;padding-top:8px;flex-wrap:wrap;}
.scf-thumb{width:40px;height:40px;border-radius:4px;object-fit:cover;background:#000;flex-shrink:0;}
.scf-item-title{flex:1;min-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;}
.scf-item-row input,.scf-item-row select{width:76px;background:#000;border:1px solid #444;color:#eee;border-radius:4px;padding:5px 6px;font-size:12px;}
.scf-field{display:inline-flex;align-items:center;gap:2px;}
.scf-back-btn{font-size:12px;padding:0 2px;}
.scf-loading{font-size:11px;color:#666;width:76px;}
.scf-empty{color:#666;text-align:center;padding:30px 0;font-size:12px;white-space:pre-line;}
`;
  document.head.appendChild(style);

  function scanCards() {
    document.querySelectorAll(".item-card").forEach(injectCombo);
    injectDetailPageCombo();
  }

  new MutationObserver(() => scanCards()).observe(document.body, { childList: true, subtree: true });

  scanCards();
  createFloatingButton();
})();


(function () {
  if (location.hostname !== "shop.supreme.com" && location.hostname !== "us.supreme.com") return;

  const QUEUE_KEY = "scf_purchase_queue";
  const TARGET_URL = location.origin + "/collections/new";
  const params = new URLSearchParams(location.search);
  const isAddToCartStage = params.has("_dropfind");

  async function getQueue() {
    return GM_getValue(QUEUE_KEY, null);
  }

  async function setQueue(q) {
    GM_setValue(QUEUE_KEY, q);
  }

  function normalizeLoose(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, "");
  }
  function normalizeAlnum(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function normalizeTitle(s) {
    return normalizeAlnum(String(s || "").replace(/supreme\s*®?\s*\/?/gi, ""));
  }
  function textsMatch(a, b) {
    const a1 = normalizeLoose(a);
    const b1 = normalizeLoose(b);
    if (a1 === b1) return true;
    const a2 = normalizeAlnum(a);
    const b2 = normalizeAlnum(b);
    return a2 === b2;
  }

  const SIZE_ALIASES = {
    xs: ["xsmall", "x-small", "extrasmall"],
    s: ["small"],
    m: ["medium"],
    l: ["large"],
    xl: ["xlarge", "x-large", "extralarge"],
    xxl: ["xxlarge", "2xlarge", "xx-large", "2x-large"],
    xxxl: ["xxxlarge", "3xlarge"],
  };

  function sizeCandidates(size) {
    const raw = String(size || "").trim();
    const key = normalizeAlnum(raw);
    const list = [raw];
    if (SIZE_ALIASES[key]) list.push(...SIZE_ALIASES[key]);
    return list;
  }

  // 사이즈가 없는 상품(비니·모자 등)은 슈프림이 "OS" 한 칸만 둔다
  const ONE_SIZE_WORDS = ["os", "onesize", "one", "na", "default", "freesize", "free"];

  function isOneSizeTitle(t) {
    return ONE_SIZE_WORDS.includes(normalizeAlnum(t));
  }

  function sizesMatch(userSize, variantTitle) {
    // 사이즈를 안 적었으면 "사이즈 없는 상품"으로 보고 OS 칸을 받아들인다
    if (!String(userSize || "").trim()) return isOneSizeTitle(variantTitle);
    const candidates = sizeCandidates(userSize);
    return candidates.some((c) => {
      const a2 = normalizeAlnum(c);
      const b2 = normalizeAlnum(variantTitle);
      if (a2 === b2) return true;
      if (isOneSizeTitle(c) && isOneSizeTitle(b2)) return true;
      return a2.replace(/^us/, "") === b2.replace(/^us/, "");
    });
  }

  function findProductsJson() {
    const el = document.getElementById("products-json") || document.getElementById("home-products-json");
    if (!el) return null;
    try {
      return JSON.parse(el.textContent).products || [];
    } catch (e) {
      return null;
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function fetchProductsFresh() {
    try {
      const res = await fetch(TARGET_URL, { cache: "no-store", credentials: "omit" });
      const html = await res.text();
      const m =
        html.match(/id="products-json"[^>]*>([\s\S]*?)<\/script>/) ||
        html.match(/id="home-products-json"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) return null;
      const data = JSON.parse(m[1]);
      return data.products || [];
    } catch (e) {
      return null;
    }
  }

  function normalizeColorWord(s) {
    // 슈프림이 grey / gray 를 섞어 쓰므로 한쪽으로 맞춘다
    return normalizeAlnum(s).replace(/grey/g, "gray");
  }

  function colorMatches(pageColor, wantColor) {
    if (!wantColor) return true;
    const a = normalizeColorWord(pageColor);
    const b = normalizeColorWord(wantColor);
    if (!a || !b) return false;
    if (a === b) return true;
    // "Grey" 로 적었을 때 "Heather Grey"·"Ash Grey" 도 같은 색으로 본다
    return a.includes(b) || b.includes(a);
  }

  function matchProduct(products, item) {
    const nTitle = normalizeTitle(item.title);
    const matches = products.filter((p) => {
      const pTitle = normalizeTitle(p.title);
      return pTitle === nTitle || nTitle.includes(pTitle) || pTitle.includes(nTitle);
    });

    if (!matches.length) {
      return { type: "notfound" };
    }

    // 컬러를 적어 두었으면 그 컬러만 본다. 없으면 다른 컬러로 넘어가지 않고 없는 것으로 친다.
    let candidates = matches;
    if (item.color) {
      candidates = matches.filter((p) => colorMatches(p.color, item.color));
      if (!candidates.length) return { type: "notfound" };
    }

    for (const product of candidates) {
      const variant = (product.variants || []).find((v) => v.available && sizesMatch(item.size, v.public_title));
      if (variant) return { type: "found", product, variant };
    }
    return { type: "soldout", product: candidates[0] };
  }

  const DATA_KEY = "scf_data";
  const RESULT_KEY = "scf_cart_results";

  function getCartData() {
    return GM_getValue(DATA_KEY, null) || { carts: {} };
  }
  function getResults() {
    return GM_getValue(RESULT_KEY, null) || {};
  }
  function saveResult(cartId, label) {
    if (!cartId) return;
    const r = getResults();
    r[cartId] = { label, at: Date.now() };
    GM_setValue(RESULT_KEY, r);
  }

  const SELF_RAW_URL =
    "https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/supreme-cart-community.user.js";

  function myVersion() {
    try {
      return GM_info.script.version;
    } catch (e) {
      return "0";
    }
  }

  function verIsNewer(a, b) {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
  }

  async function fetchLatestVersion() {
    try {
      const txt = await fetch(SELF_RAW_URL + "?t=" + Date.now(), { cache: "no-store" }).then((r) => r.text());
      const m = txt.match(/@version\s+([0-9.]+)/);
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  }

  async function doUpdateCheck(loud) {
    const latest = await fetchLatestVersion();
    const mine = myVersion();
    if (!latest) {
      if (loud) setStatus("새 판을 확인하지 못했습니다.", true);
      return;
    }
    if (verIsNewer(latest, mine)) {
      setStatus("새 판 " + latest + " 이 있습니다. 설치 화면을 엽니다. (지금 " + mine + ")");
      window.open(SELF_RAW_URL, "_blank");
    } else if (loud) {
      setStatus("최신입니다. (" + mine + ")");
    }
  }

  let runnerAttempt = 0;
  let cartLive = null;

  async function refreshCartLive() {
    try {
      cartLive = await fetch("/cart.js", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json());
    } catch (e) {
      cartLive = null;
    }
    renderRunnerRows();
  }

  // 슈프림 장바구니에 이 상품이 실제로 들어 있는지 본다
  function isItemInSupremeCart(item) {
    if (!cartLive || !cartLive.items) return false;
    return cartLive.items.some((ci) => {
      if (normalizeTitle(ci.product_title || "") !== normalizeTitle(item.title || "")) return false;
      if (item.size && !sizesMatch(item.size, ci.variant_title || "")) return false;
      const style = (ci.properties && (ci.properties.Style || ci.properties.style)) || "";
      if (item.color && style && !colorMatches(style, item.color)) return false;
      return true;
    });
  }

  function makePanel() {
    let panel = document.getElementById("scf-runner");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "scf-runner";
    panel.style.cssText =
      "position:fixed;top:70px;right:16px;z-index:2147483647;width:320px;" +
      "background:#111;color:#eee;border:1px solid #333;border-radius:12px;overflow:hidden;" +
      "font-family:-apple-system,'Malgun Gothic',sans-serif;font-size:13px;" +
      "box-shadow:0 4px 20px rgba(0,0,0,.45);max-height:80vh;display:flex;flex-direction:column;";

    const head = document.createElement("div");
    head.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #262626;";
    const title = document.createElement("span");
    title.textContent = "카트 실행";
    title.style.cssText = "font-size:15px;font-weight:600;";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "\u2715";
    closeBtn.style.cssText = "background:none;border:none;color:#888;cursor:pointer;font-size:14px;";
    closeBtn.addEventListener("click", () => panel.remove());
    head.appendChild(title);
    head.appendChild(closeBtn);

    const optRow = document.createElement("div");
    optRow.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #262626;font-size:12px;color:#aaa;";
    const optLabel = document.createElement("span");
    optLabel.textContent = "재시도 간격";
    const optInput = document.createElement("input");
    optInput.type = "number";
    optInput.min = "0.1";
    optInput.step = "0.1";
    optInput.id = "scf-runner-interval";
    optInput.value = (GM_getValue(RETRY_INTERVAL_KEY, 500) / 1000).toString();
    optInput.style.cssText =
      "width:58px;background:#000;border:1px solid #444;color:#eee;border-radius:4px;padding:5px 6px;font-size:12px;";
    optInput.addEventListener("change", () => {
      const sec = parseFloat(optInput.value);
      GM_setValue(RETRY_INTERVAL_KEY, Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : 500);
    });
    const optUnit = document.createElement("span");
    optUnit.textContent = "초";
    optRow.appendChild(optLabel);
    optRow.appendChild(optInput);
    optRow.appendChild(optUnit);

    const list = document.createElement("div");
    list.className = "scf-runner-list";
    list.style.cssText = "padding:8px 14px 4px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;flex:1;";

    const clearRow = document.createElement("div");
    clearRow.style.cssText = "padding:8px 14px 0;display:flex;gap:6px;";
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "슈프림 장바구니 비우기";
    clearBtn.style.cssText =
      "flex:1;height:32px;font-size:12px;border-radius:6px;cursor:pointer;" +
      "background:transparent;border:1px solid #552626;color:#e24b4a;";
    clearBtn.addEventListener("click", clearSupremeCart);
    const updBtn = document.createElement("button");
    updBtn.textContent = "새 판 받기";
    updBtn.title = "최신판 " + myVersion();
    updBtn.style.cssText =
      "height:32px;font-size:12px;border-radius:6px;cursor:pointer;padding:0 10px;" +
      "background:transparent;border:1px solid #555;color:#ccc;";
    updBtn.addEventListener("click", () => doUpdateCheck(true));
    clearRow.appendChild(clearBtn);
    clearRow.appendChild(updBtn);

    const status = document.createElement("div");
    status.className = "scf-runner-status";
    status.style.cssText = "padding:10px 14px 12px;font-size:11px;color:#8f8;line-height:1.6;white-space:pre-line;";

    panel.appendChild(head);
    panel.appendChild(optRow);
    panel.appendChild(list);
    panel.appendChild(clearRow);
    panel.appendChild(status);
    document.body.appendChild(panel);
    renderRunnerRows();
    return panel;
  }

  async function clearSupremeCart() {
    let cart;
    try {
      cart = await fetch("/cart.js", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json());
    } catch (e) {
      setStatus("슈프림 장바구니를 읽지 못했습니다.", true);
      return;
    }
    const items = cart.items || [];
    if (!items.length) {
      setStatus("슈프림 장바구니가 이미 비어 있습니다.");
      return;
    }

    setStatus("비우는 중...");
    let removed = 0;
    for (const it of items) {
      try {
        await fetch("/cart/change.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ id: it.key || it.variant_id || it.id, quantity: 0 }),
        });
        removed++;
      } catch (e) {}
    }
    let left = -1;
    try {
      const after = await fetch("/cart.js", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json());
      left = (after.items || []).length;
    } catch (e) {}
    await refreshCartLive();
    if (left === 0) setStatus("슈프림 장바구니를 비웠습니다. (" + removed + "개)");
    else setStatus("일부만 지워졌습니다. 남은 것 " + left + "개", true);
  }

  function setStatus(text, isError) {
    const panel = makePanel();
    const s = panel.querySelector(".scf-runner-status");
    s.style.color = isError ? "#ff8080" : "#8f8";
    s.textContent = text;
  }

  async function startCart(cartId) {
    const data = getCartData();
    const cart = data.carts[cartId];
    if (!cart || !cart.items.length) {
      window.alert("이 카트에 담긴 상품이 없습니다.");
      return;
    }
    const items = cart.items.map((it) => ({
      title: it.title,
      color: it.color,
      size: it.size,
      status: "pending",
    }));
    const r = getResults();
    delete r[cartId];
    GM_setValue(RESULT_KEY, r);
    await setQueue({ items, currentIndex: 0, status: "running", mode: "continuous", cartId });
    location.href = TARGET_URL;
  }

  async function stopCart() {
    const q = await getQueue();
    if (!q) return;
    q.status = "cancelled";
    await setQueue(q);
    setStatus("정지했습니다.");
    renderRunnerRows();
  }

  function renderRunnerRows() {
    const panel = document.getElementById("scf-runner");
    if (!panel) return;
    const list = panel.querySelector(".scf-runner-list");
    if (!list) return;

    const data = getCartData();
    const results = getResults();
    const q = GM_getValue(QUEUE_KEY, null);
    const activeId = q && q.status === "running" ? String(q.cartId) : null;

    list.textContent = "";
    const ids = Object.keys(data.carts).sort((a, b) => Number(a) - Number(b));
    if (!ids.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "color:#666;font-size:12px;padding:16px 0;text-align:center;";
      empty.textContent = "담긴 카트가 없습니다.";
      list.appendChild(empty);
      return;
    }

    ids.forEach((id) => {
      const cart = data.carts[id];
      const isActive = activeId === String(id);

      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;" +
        (isActive ? "border:1px solid #3a6ea5;background:#101c2b;" : "border:1px solid #2a2a2a;");

      const info = document.createElement("div");
      info.style.cssText = "flex:1;min-width:0;";
      const nameEl = document.createElement("p");
      nameEl.textContent = cart.name;
      nameEl.style.cssText = "margin:0;font-size:13px;font-weight:600;";

      const titleEl = document.createElement("p");
      titleEl.textContent = cart.items.map((it) => it.title || "(상품명 없음)").join(", ");
      titleEl.title = titleEl.textContent;
      titleEl.style.cssText =
        "margin:2px 0 0;font-size:11.5px;color:#ddd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

      const descEl = document.createElement("p");
      descEl.textContent = cart.items
        .map((it) => [it.color, it.size].filter(Boolean).join(" \u00b7 ") || "컬러/사이즈 없음")
        .join(", ");
      descEl.style.cssText =
        "margin:2px 0 0;font-size:11px;color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      info.appendChild(nameEl);
      info.appendChild(titleEl);
      info.appendChild(descEl);

      const badge = document.createElement("span");
      badge.style.cssText = "font-size:11px;white-space:nowrap;";
      const inCount = cart.items.filter(isItemInSupremeCart).length;
      const saved = results[id] ? results[id].label : null;
      if (isActive) {
        badge.textContent = "찾는 중 " + runnerAttempt + "회";
        badge.style.color = "#7ab8ff";
      } else if (inCount > 0 && inCount === cart.items.length) {
        badge.textContent = "담김";
        badge.style.color = "#6ede9a";
      } else if (inCount > 0) {
        badge.textContent = "일부 담김";
        badge.style.color = "#e8c66a";
      } else if (saved && saved !== "담김" && saved !== "일부 담김") {
        badge.textContent = saved;
        badge.style.color = "#ff9090";
      }

      const btn = document.createElement("button");
      btn.style.cssText =
        "height:30px;font-size:12px;padding:0 12px;border-radius:6px;cursor:pointer;background:transparent;" +
        (isActive ? "border:1px solid #7a2626;color:#ff8080;" : "border:1px solid #555;color:#eee;");
      btn.textContent = isActive ? "정지" : "시작";
      btn.addEventListener("click", () => {
        if (isActive) stopCart();
        else startCart(id);
      });

      row.appendChild(info);
      if (badge.textContent) row.appendChild(badge);
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  let runnerTimer = null;
  let runnerTick = 0;
  function startRunnerRefresh() {
    if (runnerTimer) clearInterval(runnerTimer);
    runnerTick = 0;
    runnerTimer = setInterval(() => {
      const el = document.getElementById("scf-runner-interval");
      if (el && document.activeElement === el) return;
      runnerTick++;
      if (runnerTick % 5 === 0) refreshCartLive();
      else renderRunnerRows();
    }, 1000);
  }

  async function markItemStatus(index, status) {
    const q = await getQueue();
    if (!q || !q.items[index]) return q;
    q.items[index].status = status;
    await setQueue(q);
    return q;
  }

  async function clickCheckoutWithRetries() {
    let clicked = false;
    for (let i = 0; i < 10 && !clicked; i++) {
      clicked = clickCheckout();
      if (!clicked) await new Promise((r) => setTimeout(r, 300));
    }
    if (!clicked) {
      setStatus("완료했지만 checkout 버튼을 찾지 못했습니다. 직접 눌러주세요.", true);
    }
  }

  async function goToNextOrFinish(q) {
    if (q.mode === "continuous") {
      const stillPending = q.items.some((it) => it.status !== "added");
      const graceMs = await getGraceMs();
      const graceExpired = q.firstAddedAt && Date.now() - q.firstAddedAt >= graceMs;

      if (!stillPending || graceExpired) {
        q.status = "done";
        await setQueue(q);
        const addedCount = q.items.filter((it) => it.status === "added").length;
        let label = "담김";
        if (addedCount === 0) {
          const soldout = q.items.some((it) => it.status === "soldout");
          label = soldout ? "품절" : "못 찾음";
        } else if (addedCount < q.items.length) {
          label = "일부 담김";
        }
        saveResult(q.cartId, label);
        renderRunnerRows();
        setStatus(
          graceExpired && stillPending
            ? "유예시간이 지나 지금까지 담은 상품으로 결제 화면으로 넘어갑니다."
            : "다 담았습니다. 결제 화면으로 넘어갑니다."
        );
        await clickCheckoutWithRetries();
        return;
      }
      await setQueue(q);
      location.href = TARGET_URL;
      return;
    }

    const nextIndex = q.currentIndex + 1;
    if (nextIndex >= q.items.length) {
      q.status = "done";
      q.currentIndex = nextIndex;
      await setQueue(q);
      setStatus("모든 상품 처리를 완료했습니다. checkout으로 이동합니다...");
      await clickCheckoutWithRetries();
      return;
    }
    q.currentIndex = nextIndex;
    await setQueue(q);
    location.href = TARGET_URL;
  }

  const RETRY_INTERVAL_KEY = "scf_retry_interval_ms";
  const GRACE_SEC_KEY = "scf_grace_sec_ms";

  async function getRetryIntervalMs() {
    return GM_getValue(RETRY_INTERVAL_KEY, 500);
  }

  async function getGraceMs() {
    const v = GM_getValue(GRACE_SEC_KEY, 5000);
    return v != null ? v : 5000;
  }

  const FIRST_ITEM_TIMEOUT_MS = 60 * 1000;

  async function runOnceStage() {
    const q = await getQueue();
    if (!q || q.status !== "running") return;

    if (q.currentIndex >= q.items.length) {
      await goToNextOrFinish({ ...q, currentIndex: q.items.length - 1 });
      return;
    }

    const item = q.items[q.currentIndex];
    const isFirstItem = q.currentIndex === 0;
    const timeoutMs = isFirstItem ? FIRST_ITEM_TIMEOUT_MS : 0;

    if (!item.color) {
      setStatus(`"${item.title}"은(는) 컬러가 비어있어 건너뜁니다.`, true);
      await markItemStatus(q.currentIndex, "skipped_no_info");
      await goToNextOrFinish(await getQueue());
      return;
    }

    const retryIntervalMs = await getRetryIntervalMs();
    const startTs = Date.now();
    let result = { type: "notfound" };
    let attempt = 0;
    while (true) {
      const liveQ = await getQueue();
      if (!liveQ || liveQ.status !== "running") return;
      attempt++;
      runnerAttempt = attempt;

      const products = attempt === 1 ? findProductsJson() || (await fetchProductsFresh()) : await fetchProductsFresh();
      result = products ? matchProduct(products, item) : { type: "notfound" };
      if (result.type === "found") break;
      if (result.type === "soldout") break;

      if (Date.now() - startTs >= timeoutMs) break;

      const remainSec = Math.max(0, (timeoutMs - (Date.now() - startTs)) / 1000).toFixed(0);
      setStatus(`(${q.currentIndex + 1}/${q.items.length}) "${item.title}" 아직 미등록, 확인 중... (첫 상품, 남은 ${remainSec}초, ${attempt}회 시도)`);
      await sleep(retryIntervalMs);
    }

    if (result.type !== "found") {
      const label = result.type === "soldout" ? "품절입니다." : "찾지 못했습니다.";
      setStatus(`"${item.title}" (${item.color} / ${item.size}) ${label}`, true);
      await markItemStatus(q.currentIndex, result.type);
      await goToNextOrFinish(await getQueue());
      return;
    }

    navigateToAdd(result);
  }

  async function runContinuousStage() {
    const q0 = await getQueue();
    if (!q0 || q0.status !== "running") return;

    const retryIntervalMs = await getRetryIntervalMs();
    let round = 0;
    while (true) {
      const q = await getQueue();
      if (!q || q.status !== "running") return;

      const pendingIdx = q.items
        .map((it, i) => i)
        .filter((i) => q.items[i].status !== "added");

      if (!pendingIdx.length) {
        await goToNextOrFinish(q);
        return;
      }

      if (q.firstAddedAt) {
        const graceMs = await getGraceMs();
        if (Date.now() - q.firstAddedAt >= graceMs) {
          await goToNextOrFinish(q);
          return;
        }
      }

      const readyIdx = pendingIdx.filter((i) => q.items[i].color);
      for (const i of pendingIdx) {
        if (!q.items[i].color && q.items[i].status !== "skipped_no_info") {
          await markItemStatus(i, "skipped_no_info");
        }
      }
      if (!readyIdx.length) {
        setStatus("모든 상품에 컬러가 비어있어 진행할 항목이 없습니다.", true);
        await goToNextOrFinish(await getQueue());
        return;
      }

      round++;
      const products = round === 1 ? findProductsJson() || (await fetchProductsFresh()) : await fetchProductsFresh();

      if (products) {
        for (const i of readyIdx) {
          const item = q.items[i];
          const result = matchProduct(products, item);
          if (result.type === "found") {
            const q2 = await getQueue();
            q2.currentIndex = i;
            await setQueue(q2);
            navigateToAdd(result);
            return;
          }
        }
      }

      let graceNote = "";
      if (q.firstAddedAt) {
        const graceMs = await getGraceMs();
        const remainMs = Math.max(0, graceMs - (Date.now() - q.firstAddedAt));
        graceNote = ` / 유예시간 ${(remainMs / 1000).toFixed(1)}초 남음`;
      }
      setStatus(`계속 재시도 중... (남은 ${readyIdx.length}개, ${(retryIntervalMs / 1000).toFixed(1)}초 간격, ${round}회째${graceNote})`);
      await sleep(retryIntervalMs);
    }
  }

  function navigateToAdd(found) {
    setStatus(`"${found.product.title}" (${found.product.color} / ${found.variant.public_title}) 발견! 이동합니다...`);
    sessionStorage.setItem(
      "__scfAutoBuyTarget",
      JSON.stringify({
        variantId: found.variant.id,
        sizeLabel: found.variant.public_title,
        productTitle: found.product.title,
        color: found.product.color,
      })
    );
    const sep = found.product.url.includes("?") ? "&" : "?";
    location.href = found.product.url + sep + "variant=" + found.variant.id + "&_dropfind=1";
  }

  async function runAddToCartStage() {
    const q = await getQueue();
    if (!q || q.status !== "running") return;

    const raw = sessionStorage.getItem("__scfAutoBuyTarget");
    sessionStorage.removeItem("__scfAutoBuyTarget");
    let target = null;
    try {
      target = raw ? JSON.parse(raw) : null;
    } catch (e) {}

    setStatus(target ? `${target.sizeLabel} 사이즈 선택 중...` : "처리 중...");

    const start = Date.now();
    let select = null;
    while (Date.now() - start < 8000) {
      select = document.querySelector('select[data-testid="size-dropdown"]');
      if (select) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!select) {
      setStatus("사이즈 선택창을 찾지 못했습니다.", true);
      await markItemStatus(q.currentIndex, "error");
      await goToNextOrFinish(await getQueue());
      return;
    }

    if (target && target.variantId) {
      select.value = String(target.variantId);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 300));

    const soldOut = document.querySelector('p[data-testid="sold-out-product-message"]');
    if (soldOut) {
      setStatus("품절되었습니다. (한발 늦었습니다)", true);
      await markItemStatus(q.currentIndex, "soldout");
      await goToNextOrFinish(await getQueue());
      return;
    }

    const inCartMsg = document.querySelector('[data-testid="product-in-cart-message"]');
    const styleLimitMsg = document.querySelector('[data-testid="style-limit-message"]');
    if (inCartMsg || styleLimitMsg) {
      setStatus(
        inCartMsg
          ? "이미 장바구니에 담긴 상품입니다. 다음으로 넘어갑니다."
          : "상품당 스타일 제한에 걸렸습니다(이미 담긴 것으로 처리). 다음으로 넘어갑니다."
      );
      const afterAddQ = await markItemStatus(q.currentIndex, "added");
      if (afterAddQ && afterAddQ.mode === "continuous" && !afterAddQ.firstAddedAt) {
        afterAddQ.firstAddedAt = Date.now();
        await setQueue(afterAddQ);
      }
      await goToNextOrFinish(await getQueue());
      return;
    }

    const addBtn = document.querySelector('button[data-testid="add-to-cart-button"]');
    if (!addBtn || addBtn.disabled) {
      setStatus("담기 버튼을 찾지 못했습니다.", true);
      await markItemStatus(q.currentIndex, "error");
      await goToNextOrFinish(await getQueue());
      return;
    }
    addBtn.click();
    setStatus("장바구니에 담았습니다!");
    const afterAddQ = await markItemStatus(q.currentIndex, "added");
    if (afterAddQ && afterAddQ.mode === "continuous" && !afterAddQ.firstAddedAt) {
      afterAddQ.firstAddedAt = Date.now();
      await setQueue(afterAddQ);
    }
    await new Promise((r) => setTimeout(r, 500));
    await goToNextOrFinish(await getQueue());
  }

  function clickCheckout() {
    const candidates = Array.from(document.querySelectorAll("button, span, a"));
    const target = candidates.find((el) => el.textContent.trim().toLowerCase() === "checkout");
    if (!target) return false;
    const btn = target.closest("button") || target;
    btn.click();
    return true;
  }

  async function clearShopCart() {
    if (!window.confirm("슈프림 장바구니를 전부 비울까요? 되돌릴 수 없습니다.")) return;
    try {
      const cartRes = await fetch("/cart.js", { credentials: "same-origin" });
      if (!cartRes.ok) throw new Error("cart.js failed");
      const cart = await cartRes.json();
      for (const item of cart.items || []) {
        await fetch("/cart/change.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ id: item.key || item.variant_id || item.id, quantity: 0 }),
        });
      }
      location.reload();
    } catch (e) {
      window.alert("장바구니 비우기에 실패했습니다. 새로고침 후 다시 시도해주세요.");
    }
  }

  function createClearCartButton() {
    if (!/\/cart\/?$/.test(location.pathname)) return;
    if (document.getElementById("scf-clear-cart-btn")) return;
    const btn = document.createElement("button");
    btn.id = "scf-clear-cart-btn";
    btn.type = "button";
    btn.textContent = "슈프림 장바구니 전체 비우기";
    btn.style.cssText =
      "position:fixed;bottom:20px;left:20px;z-index:999999;" +
      "background:#7a1610;color:#fff;border:none;border-radius:8px;" +
      "padding:10px 14px;font-size:12px;cursor:pointer;font-family:-apple-system,sans-serif;" +
      "box-shadow:0 2px 10px rgba(0,0,0,.35);";
    btn.addEventListener("click", clearShopCart);
    document.body.appendChild(btn);
  }


  // 플로팅 버튼 스타일 (확장앱의 floating.css 대체)
  const scfStyle = document.createElement("style");
  scfStyle.textContent = `
#scf-floating-btn{position:fixed;bottom:20px;right:20px;z-index:2147483646;display:flex;flex-direction:column;align-items:center;gap:4px;background:#1a1a1a;border:1px solid #333;border-radius:14px;padding:10px 12px;box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;user-select:none;}
#scf-floating-btn .scf-fb-icon{width:40px;height:40px;border-radius:10px;background:#e32113;display:flex;align-items:center;justify-content:center;}
#scf-floating-btn .scf-fb-icon svg{width:22px;height:22px;fill:#fff;}
#scf-floating-btn .scf-fb-label{font-size:11px;color:#ccc;font-family:-apple-system,"Malgun Gothic",sans-serif;}
`;
  document.head.appendChild(scfStyle);

  function createFloatingButton() {
    if (document.getElementById("scf-floating-btn")) return;
    const btn = document.createElement("div");
    btn.id = "scf-floating-btn";
    btn.innerHTML = `
      <div class="scf-fb-icon">
        <svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><path d="M222.14 58.87A8 8 0 0 0 216 56H54.68L49.79 25.14A16 16 0 0 0 34 12H16a8 8 0 0 0 0 16h18l30.29 179.4A24 24 0 0 0 88 224h116a8 8 0 0 0 0-16H88a8 8 0 0 1-7.87-6.63L77.35 184h116.75a24 24 0 0 0 23.62-19.7L224 64.4a8 8 0 0 0-1.86-5.53M197.72 128h-127l-9.6-56H207.7z"/></svg>
      </div>
      <span class="scf-fb-label">\uce74\ud2b8 \uc2e4\ud589</span>
    `;
    btn.addEventListener("click", () => {
      const p = document.getElementById("scf-runner");
      if (p) p.remove();
      else {
        makePanel();
        renderRunnerRows();
      }
    });
    document.body.appendChild(btn);
  }

  async function init() {
    createFloatingButton();
    makePanel();
    renderRunnerRows();
    refreshCartLive();
    startRunnerRefresh();
    doUpdateCheck(false);
    const q = await getQueue();
    if (!q || q.status !== "running") return;
    if (isAddToCartStage) {
      runAddToCartStage();
    } else if (q.mode === "continuous") {
      runContinuousStage();
    } else {
      runOnceStage();
    }
  }

  init();
})();
