// ==UserScript==
// @name         Supreme Community 장바구니
// @namespace    https://github.com/wg052026/tacbae-jimpass-supreme-autofill
// @version      1.1.0
// @description  supremecommunity.com에서 상품을 여러 장바구니에 나눠 담고, 슬라이드 패널에서 컬러/사이즈를 골라 관리합니다.
// @author       wg052026
// @match        https://www.supremecommunity.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/supreme-cart-community.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/supreme-cart-community.user.js
// ==/UserScript==

(function () {
  "use strict";

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
    skipped_no_info: "컬러/사이즈 없음(건너뜀)",
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
