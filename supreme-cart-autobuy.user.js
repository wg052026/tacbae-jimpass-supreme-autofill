// ==UserScript==
// @name         Supreme 자동 구매 (shop/us)
// @namespace    https://github.com/wg052026/tacbae-jimpass-supreme-autofill
// @version      1.0.0
// @description  supremecommunity 장바구니에 담아둔 상품을 shop.supreme.com / us.supreme.com에서 자동으로 찾아 담고 checkout으로 이동합니다.
// @author       wg052026
// @match        https://shop.supreme.com/*
// @match        https://us.supreme.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/supreme-cart-autobuy.user.js
// @downloadURL  https://raw.githubusercontent.com/wg052026/tacbae-jimpass-supreme-autofill/main/supreme-cart-autobuy.user.js
// ==/UserScript==

(function () {
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

  function sizesMatch(userSize, variantTitle) {
    const candidates = sizeCandidates(userSize);
    return candidates.some((c) => {
      const a2 = normalizeAlnum(c);
      const b2 = normalizeAlnum(variantTitle);
      if (a2 === b2) return true;
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

  function matchProduct(products, item) {
    const nTitle = normalizeTitle(item.title);
    const matches = products.filter((p) => {
      const pTitle = normalizeTitle(p.title);
      return pTitle === nTitle || nTitle.includes(pTitle) || pTitle.includes(nTitle);
    });
    const colorMatches = matches.filter((p) => textsMatch(p.color, item.color));
    const candidates = colorMatches.length ? colorMatches : matches;

    if (!candidates.length) {
      return { type: "notfound" };
    }
    for (const product of candidates) {
      const variant = (product.variants || []).find((v) => v.available && sizesMatch(item.size, v.public_title));
      if (variant) return { type: "found", product, variant };
    }
    return { type: "soldout", product: candidates[0] };
  }

  function makePanel() {
    let panel = document.getElementById("scf-autobuy-panel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "scf-autobuy-panel";
    panel.style.cssText =
      "position:fixed;top:70px;right:16px;z-index:999999;width:280px;" +
      "background:#111;color:#fff;border-radius:10px;padding:14px;" +
      "font-family:-apple-system,sans-serif;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,.4);";
    panel.innerHTML = '<b style="font-size:13px;">Supreme 자동 구매</b><div class="scf-ab-status" style="margin-top:8px;font-size:12px;line-height:1.5;color:#8f8;"></div>';
    document.body.appendChild(panel);
    return panel;
  }

  function setStatus(text, isError) {
    const panel = makePanel();
    const s = panel.querySelector(".scf-ab-status");
    s.style.color = isError ? "#ff8080" : "#8f8";
    s.textContent = text;
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
        setStatus(
          graceExpired && stillPending
            ? "유예시간이 지나 지금까지 담은 상품으로 checkout으로 이동합니다..."
            : "모든 상품 처리를 완료했습니다. checkout으로 이동합니다..."
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

    if (!item.color || !item.size) {
      setStatus(`"${item.title}"은(는) 컬러/사이즈가 비어있어 건너뜁니다.`, true);
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

      const readyIdx = pendingIdx.filter((i) => q.items[i].color && q.items[i].size);
      for (const i of pendingIdx) {
        if ((!q.items[i].color || !q.items[i].size) && q.items[i].status !== "skipped_no_info") {
          await markItemStatus(i, "skipped_no_info");
        }
      }
      if (!readyIdx.length) {
        setStatus("모든 상품에 컬러/사이즈가 비어있어 진행할 항목이 없습니다.", true);
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
      <span class="scf-fb-label">\uc7a5\ubc14\uad6c\ub2c8</span>
    `;
    btn.addEventListener("click", () => {
      window.open("https://www.supremecommunity.com/droplists/", "_blank");
    });
    document.body.appendChild(btn);
  }

  async function init() {
    createFloatingButton();
    createClearCartButton();
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
