(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var LS_KEY = "pct.v1";
  var CAT_LABEL = { 3: "美版", 85: "日版" };
  var SCOPE_CAT = { en: 3, jp: 85 };
  var MAX_RESULTS = 60;
  var SOURCE_NAMES = { snkrdunk: "SNKRDUNK", pricebase: "PRICE BASE" };

  var state = {
    latest: { items: {}, fx: { TWD: 31.5, JPY: 150 }, date: "" },
    watch: [], alerts: [], aliases: [], sourceDefaults: {}, comparisonDefaults: {}, config: { repo: "", local: false }, notice: "",
    local: loadLocal(), open: {}, hist: {}, catalogs: {},
    scope: "en", status: "loading"
  };

  /* ---------- storage ---------- */
  function loadLocal() {
    var d = { holdings: {}, pending: [], manual: [], token: "" };
    try {
      var raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (raw && typeof raw === "object") {
        if (raw.holdings && typeof raw.holdings === "object") d.holdings = raw.holdings;
        if (Array.isArray(raw.pending)) d.pending = raw.pending;
        if (Array.isArray(raw.manual)) d.manual = raw.manual;
        if (typeof raw.token === "string") d.token = raw.token;
      }
    } catch (e) {}
    return d;
  }
  function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(state.local)); return true; } catch (e) { return false; } }

  /* ---------- helpers ---------- */
  var nf = new Intl.NumberFormat("zh-TW");
  var nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function fmt(n) { return isNum(n) ? nf.format(Math.round(n)) : "—"; }
  function usd(n) { return isNum(n) ? "$" + nf2.format(n) : "—"; }
  function signed(n) { var r = Math.round(n); return (r > 0 ? "+" : r < 0 ? "−" : "") + nf.format(Math.abs(r)); }
  function pct(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(1) + "%"; }
  function dirOf(n) { return !isNum(n) || Math.round(n * 10) === 0 ? "flat" : n > 0 ? "up" : "down"; }
  function glyph(d) { return d === "up" ? "▲" : d === "down" ? "▼" : "—"; }
  function parts(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ""); return m ? [+m[1], +m[2], +m[3]] : null; }
  function md(d) { var p = parts(d); return p ? p[1] + "/" + p[2] : (d || "—"); }
  function ymd(d) { var p = parts(d); return p ? p[0] + "/" + p[1] + "/" + p[2] : (d || "—"); }
  function ts(d) { var p = parts(d); return p ? Date.UTC(p[0], p[1] - 1, p[2]) : NaN; }
  function fx() { var r = state.latest.fx && state.latest.fx.TWD; return isNum(r) && r > 0 ? r : 31.5; }
  function jpyRate() { var f = state.latest.fx || {}; return isNum(f.JPY) && f.JPY > 0 ? fx() / f.JPY : 0.2; }
  function yen(n) { return isNum(n) ? "¥" + nf.format(Math.round(n)) : "—"; }
  function $(id) { return document.getElementById(id); }

  function el(tag, props) {
    var n = document.createElement(tag), k, i;
    if (props) for (k in props) {
      var v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "hidden") n.hidden = true;
      else if (k === "value") n.value = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x != null && x !== false) n.append(x); });
      else n.append(c);
    }
    return n;
  }
  function svg(tag, attrs, text) {
    var n = document.createElementNS(SVGNS, tag), k;
    for (k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function getJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }
  function postJSON(path, body) {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (r) {
      return r.json().then(function (data) { if (!r.ok) throw new Error(data.error || "儲存失敗"); return data; });
    });
  }
  function primaryPrice(prices) {
    if (!prices || !prices.length) return null;
    for (var i = 0; i < prices.length; i++) if (prices[i][1] != null) return prices[i];
    return prices[0];
  }

  /* ---------- list model ---------- */
  function pendingByPid() {
    var m = {};
    state.local.pending.forEach(function (p) { m[Number(p.pid)] = p; });
    return m;
  }
  function listItems() {
    var out = [], seen = {}, pend = pendingByPid();
    state.watch.forEach(function (w) {
      var pid = Number(w.pid), L = state.latest.items[pid], P = pend[pid], src = L && !L.missing ? L : (P || L || {});
      seen[pid] = true;
      out.push({
        key: "p" + pid, type: "tracked", pid: pid, cat: Number(src.cat || w.cat),
        name: src.name || w.name || ("#" + pid), zh: w.zh || "", group: src.group || "", number: src.number || "", sub: src.sub || "",
        market: src.market, low: src.low, usdQuote: src.usdQuote, comparisons: src.comparisons, comparisonConfig: "comparisons" in w ? w.comparisons : state.comparisonDefaults[pid] || null,
        sealed: !!src.sealed, prev: L ? L.prev : null, spark: (L && L.spark) || [], prices: src.prices || [],
        japan: src.japan || null, japanConfig: "japan" in w ? w.japan : state.sourceDefaults[pid] || null,
        waiting: !L || !!L.missing
      });
    });
    state.local.pending.forEach(function (p) {
      var pid = Number(p.pid);
      if (seen[pid]) return;
      out.push({
        key: "p" + pid, type: "pending", pid: pid, cat: Number(p.cat), name: p.name, zh: "", group: p.group || "", number: p.number || "", sub: p.sub || "",
        market: p.market, low: p.low, prev: null, spark: [], prices: p.prices || [], asOf: p.asOf,
        japanConfig: state.sourceDefaults[pid] || null, comparisonConfig: state.comparisonDefaults[pid] || null, sealed: !!p.sealed
      });
    });
    out.forEach(function (it) {
      var h = state.local.holdings[it.key] || {};
      it.qty = isNum(h.qty) ? h.qty : 0;
      it.cost = isNum(h.cost) ? h.cost : null;
      it.note = h.note || "";
      it.usd = isNum(it.market) ? it.market : isNum(it.low) ? it.low : null;
      it.twd = it.usd != null ? it.usd * fx() : null;
      it.edition = CAT_LABEL[it.cat] || "";
      it.manualJpy = it.cat === 85 && isNum(h.jpy) && h.jpy > 0 ? h.jpy : null;
      it.jpyDate = h.jpyDate || "";
      it.quote = it.japan && it.japan.quotes && it.japan.quotes[it.japan.selected];
      it.jpyAuto = !!(it.quote && isNum(it.quote.price) && it.quote.price > 0);
      it.jpy = it.jpyAuto ? it.quote.price : it.manualJpy;
      if (it.japanConfig) {
        it.twd = null;
        it.spark = it.japan ? it.japan.spark || [] : [];
        it.prev = it.japan ? it.japan.prev : null;
      }
      if (it.jpy != null) it.twd = it.jpy * jpyRate();
    });
    state.local.manual.forEach(function (m) {
      out.push({
        key: "m" + m.id, type: "manual", id: m.id, edition: m.edition || "手動", name: m.name, zh: "", group: "", number: "",
        qty: isNum(m.qty) ? m.qty : 0, cost: isNum(m.cost) ? m.cost : null, note: m.note || "",
        usd: null, twd: isNum(m.price) ? m.price : null, prev: null, spark: [], prices: [], asOf: m.priceDate
      });
    });
    return out;
  }

  /* ---------- summary ---------- */
  function renderSummary(items) {
    var box = $("summary");
    box.textContent = "";
    var value = 0, cost = 0, held = 0, noCost = 0;
    items.forEach(function (it) {
      if (!(it.qty > 0) || it.twd == null) return;
      held++;
      value += it.qty * it.twd;
      if (it.cost != null) cost += it.qty * it.cost; else noCost++;
    });
    var has = held > 0, pl = value - cost, d = dirOf(has && cost > 0 ? pl : NaN);
    box.append(el("div", { class: "stat hero" },
      el("div", { class: "stat-label", text: "持有的行情總值" }),
      el("div", { class: "stat-value" }, has ? fmt(value) : "—", el("span", { class: "stat-unit", text: "元" })),
      el("div", { class: "stat-note", text: has ? held + " 項有填數量" : "在商品裡填入持有數量和成本，這裡會算出總值" })));
    box.append(el("div", { class: "stat" },
      el("div", { class: "stat-label", text: "成本" }),
      el("div", { class: "stat-value" }, has && cost > 0 ? fmt(cost) : "—", el("span", { class: "stat-unit", text: "元" })),
      el("div", { class: "stat-note", text: noCost ? noCost + " 項還沒填成本" : "台幣" })));
    box.append(el("div", { class: "stat" },
      el("div", { class: "stat-label", text: "行情與成本的差額" }),
      el("div", { class: "stat-value dir " + d }, has && cost > 0 ? glyph(d) + " " + signed(pl) : "—", el("span", { class: "stat-unit", text: "元" })),
      el("div", { class: "stat-note", text: has && cost > 0 ? "相當於成本的 " + pct(pl / cost * 100) : "正數表示行情高於成本" })));
  }

  /* ---------- charts ---------- */
  function sparkline(vals) {
    var W = 100, H = 30, pad = 4, n = vals.length;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "aria-hidden": "true" });
    var y0 = Math.min.apply(null, vals), y1 = Math.max.apply(null, vals);
    var X = function (i) { return pad + i / (n - 1) * (W - pad * 2); };
    var Y = function (v) { return y1 === y0 ? H / 2 : H - pad - (v - y0) / (y1 - y0) * (H - pad * 2); };
    var d = vals.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join(" ");
    s.append(svg("path", { d: d, fill: "none", stroke: "var(--accent)", "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    s.append(svg("circle", { cx: X(n - 1).toFixed(1), cy: Y(vals[n - 1]).toFixed(1), r: 3, fill: "var(--accent)", stroke: "var(--surface)", "stroke-width": 1.5 }));
    return s;
  }
  function niceStep(span, target) {
    var raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  /* Each chart contains one source and one currency. */
  function drawChart(box, name, pts, costUsd, currency) {
    var money = currency === "JPY" ? yen : usd, rate = currency === "JPY" ? jpyRate() : fx();
    box.textContent = "";
    if (!pts.length) { box.append(el("p", { class: "chart-note", text: "還沒有每日紀錄。下一次自動更新後，這裡會開始畫出走勢。" })); return; }
    var W = Math.max(280, Math.round(box.clientWidth || 560)), H = 230;
    var m = { l: 56, r: 54, t: 22, b: 28 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    var vals = pts.map(function (q) { return q.price; });
    if (isNum(costUsd)) vals.push(costUsd);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi = lo * 1.05 + 0.01; lo = lo * 0.95; }
    var step = niceStep((hi - lo) * 1.15, 4);
    var y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
    if (y1 === y0) y1 = y0 + step;
    var xs = pts.map(function (q) { return ts(q.date); }), x0 = xs[0], x1 = xs[xs.length - 1];
    var X = function (v) { return x1 === x0 ? m.l + pw / 2 : m.l + (v - x0) / (x1 - x0) * pw; };
    var Y = function (v) { return m.t + ph - (v - y0) / (y1 - y0) * ph; };
    var tick = function (v) { return (currency === "JPY" ? "¥" : "$") + (step < 1 ? nf2.format(v) : nf.format(Math.round(v))); };

    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", tabindex: 0,
      "aria-label": name + " 行情走勢，共 " + pts.length + " 筆，最新 " + money(pts[pts.length - 1].price) });
    var txt = { "font-size": 11, fill: "var(--ink-3)", "font-family": "var(--font-text)" };
    for (var v = y0; v <= y1 + step / 2; v += step) {
      var yy = Y(v);
      s.append(svg("line", { x1: m.l, x2: m.l + pw, y1: yy, y2: yy, stroke: "var(--line)", "stroke-width": 1 }));
      s.append(svg("text", Object.assign({ x: m.l - 8, y: yy + 4, "text-anchor": "end" }, txt), tick(v)));
    }
    var xi = pts.length === 1 ? [0] : pts.length === 2 || pw < 300 ? [0, pts.length - 1] : [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
    xi.forEach(function (i, k) {
      var anchor = pts.length === 1 ? "middle" : k === 0 ? "start" : k === xi.length - 1 ? "end" : "middle";
      s.append(svg("text", Object.assign({ x: X(xs[i]), y: H - 8, "text-anchor": anchor }, txt), md(pts[i].date)));
    });
    if (isNum(costUsd)) {
      var yc = Y(costUsd);
      s.append(svg("line", { x1: m.l, x2: m.l + pw, y1: yc, y2: yc, stroke: "var(--ink-3)", "stroke-width": 1 }));
      s.append(svg("text", { x: m.l + pw + 6, y: yc + 4, "font-size": 11, fill: "var(--ink-2)", "font-family": "var(--font-text)" }, "成本"));
    }
    var hasGaps = xs.some(function (x, i) { return i && x - xs[i - 1] > 86400000; });
    var line = pts.map(function (q, i) { return (i && xs[i] - xs[i - 1] <= 86400000 ? "L" : "M") + X(xs[i]).toFixed(1) + " " + Y(q.price).toFixed(1); }).join(" ");
    if (pts.length > 1) {
      if (!hasGaps) s.append(svg("path", { d: line + " L" + X(x1).toFixed(1) + " " + (m.t + ph) + " L" + X(x0).toFixed(1) + " " + (m.t + ph) + " Z", fill: "var(--accent-wash)", stroke: "none" }));
      s.append(svg("path", { d: line, fill: "none", stroke: "var(--accent)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    }
    if (hasGaps) pts.forEach(function (q, i) { s.append(svg("circle", { cx: X(xs[i]), cy: Y(q.price), r: 3, fill: "var(--accent)" })); });
    var li = pts.length - 1, lx = X(xs[li]), ly = Y(pts[li].price);
    var cross = svg("line", { x1: lx, x2: lx, y1: m.t, y2: m.t + ph, stroke: "var(--ink-3)", "stroke-width": 1, visibility: "hidden" });
    var dot = svg("circle", { cx: lx, cy: ly, r: 5, fill: "var(--accent)", stroke: "var(--surface)", "stroke-width": 2 });
    var labelY = ly < m.t + 18 ? ly + 20 : ly - 11;
    if (isNum(costUsd) && Math.abs(labelY - 4 - Y(costUsd)) < 12) labelY = ly + 20 <= m.t + ph - 2 ? ly + 20 : ly - 26;
    var endLabel = svg("text", { x: pts.length === 1 ? lx : Math.min(lx, m.l + pw), y: labelY, "text-anchor": pts.length === 1 ? "middle" : "end",
      "font-size": 13, "font-weight": 600, fill: "var(--ink)", "font-family": "var(--font-num)" }, money(pts[li].price));
    var hit = svg("rect", { x: m.l - 12, y: m.t - 8, width: pw + 24, height: ph + 16, fill: "transparent" });
    s.append(cross, dot, endLabel, hit);

    var tip = el("div", { class: "tip", hidden: true }), cur = -1;
    function show(i) {
      var q = pts[i], px = X(xs[i]), py = Y(q.price);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", px); dot.setAttribute("cy", py);
      endLabel.setAttribute("visibility", "hidden");
      tip.textContent = "";
      tip.append(el("b", { text: money(q.price) }), el("span", { text: ymd(q.date) }), el("div", { text: "約 " + fmt(q.price * rate) + " 元" }));
      tip.hidden = false;
      var bw = box.clientWidth || W, scale = bw / W, left = px * scale + 12;
      if (left + tip.offsetWidth > bw) left = px * scale - tip.offsetWidth - 12;
      tip.style.left = Math.max(0, left) + "px";
      tip.style.top = Math.max(0, py * scale - 12) + "px";
      cur = i;
    }
    function hide() {
      cross.setAttribute("visibility", "hidden");
      dot.setAttribute("cx", lx); dot.setAttribute("cy", ly);
      endLabel.setAttribute("visibility", "visible");
      tip.hidden = true; cur = -1;
    }
    function nearest(ev) {
      var r = s.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W, best = 0, bd = Infinity;
      xs.forEach(function (t, i) { var d = Math.abs(X(t) - px); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    hit.addEventListener("pointermove", function (ev) { show(nearest(ev)); });
    hit.addEventListener("pointerdown", function (ev) { show(nearest(ev)); });
    hit.addEventListener("pointerleave", hide);
    s.addEventListener("focus", function () { show(li); });
    s.addEventListener("blur", hide);
    s.addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      show(Math.max(0, Math.min(li, (cur < 0 ? li : cur) + (ev.key === "ArrowLeft" ? -1 : 1))));
    });
    box.append(s, tip);
    if (pts.length === 1) box.append(el("p", { class: "chart-note", text: "目前只有一筆紀錄；來源補入更多日期後，這裡會顯示走勢。" }));
  }

  function loadHistory(pid, quote) {
    var key = pid + (quote ? ":" + quote.key : "");
    if (state.hist[key]) return Promise.resolve(state.hist[key]);
    return getJSON("data/history/" + pid + (quote ? "-jpy" : "") + ".json").then(function (h) {
      var series = quote ? (h.series || {})[quote.key] || {} : h;
      var pts = (series.points || []).map(function (x) { return { date: x[0], price: isNum(x[1]) ? x[1] : x[2] }; })
        .filter(function (x) { return isNum(x.price) && parts(x.date); });
      state.hist[key] = pts;
      return pts;
    }, function () { state.hist[key] = []; return []; });
  }

  /* ---------- watchlist editing (GitHub) ---------- */
  function b64encode(s) { return btoa(unescape(encodeURIComponent(s))); }
  function b64decode(s) { return decodeURIComponent(escape(atob(s.replace(/\s/g, "")))); }
  function editWatchlist(mutate, message) {
    var repo = state.config.repo, token = state.local.token;
    var api = "https://api.github.com/repos/" + repo + "/contents/data/watchlist.json";
    var headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    return fetch(api, { headers: headers, cache: "no-store" }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error("Token 無效或權限不足，請到「設定」重新填寫。");
      if (!r.ok) throw new Error("讀取 watchlist.json 失敗（" + r.status + "）。");
      return r.json();
    }).then(function (cur) {
      var json = JSON.parse(b64decode(cur.content));
      if (!Array.isArray(json.items)) json.items = [];
      mutate(json);
      return fetch(api, { method: "PUT", headers: headers, body: JSON.stringify({ message: message, content: b64encode(JSON.stringify(json, null, 2) + "\n"), sha: cur.sha }) })
        .then(function (r) {
          if (r.status === 401 || r.status === 403) throw new Error("Token 沒有寫入權限，請確認有 Contents 的讀寫權限。");
          if (r.status === 409) throw new Error("檔案剛被別處修改，請再試一次。");
          if (!r.ok) throw new Error("寫入失敗（" + r.status + "）。");
          state.watch = json.items;
          return json;
        });
    });
  }
  function manualInstruction(box, snippet, verb) {
    box.textContent = "";
    var repo = state.config.repo;
    box.append(el("p", { class: "msg", text: "還沒設定 GitHub token。請自己編輯儲存庫的 data/watchlist.json，在 items 裡" + verb + "這一行：" }),
      el("pre", { class: "snippet", text: snippet }));
    if (repo) box.append(el("p", { class: "msg" }, el("a", { href: "https://github.com/" + repo + "/edit/main/data/watchlist.json", target: "_blank", rel: "noopener noreferrer", text: "在 GitHub 開啟 watchlist.json" })));
  }

  function saveLocalWatch(input) {
    return fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
      .then(function (r) { return r.json().then(function (data) { if (!r.ok) throw new Error(data.error || "本機儲存失敗"); return data; }); })
      .then(function (data) {
        state.watch = data.watch.items;
        state.latest = data.latest;
        state.hist = {};
        state.local.pending = state.local.pending.filter(function (p) {
          return !state.watch.some(function (w) { return Number(w.pid) === Number(p.pid); }) && !(input.action === "remove" && Number(p.pid) === input.pid);
        });
        saveLocal();
        var japan = input.entry && state.latest.items[input.entry.pid] && state.latest.items[input.entry.pid].japan;
        var failed = japan && Object.keys(japan.quotes || {}).some(function (s) { return japan.quotes[s].stale; });
        state.notice = input.action === "remove" ? "已停止每日紀錄，原有歷史仍保留。" : failed ? "已儲存；部分日本來源未能更新，請查看商品明細。" : "已儲存在本機，行情已更新。";
        renderList();
        return data;
      });
  }

  /* ---------- board ---------- */
  var charts = {};
  function renderDetail(it) {
    var chartBox = el("div", { class: "chart-box" });
    var facts = el("dl", { class: "facts" });
    function fact(k, v) { if (v == null || v === "") return; facts.append(el("dt", { text: k }), el("dd", null, v)); }
    if (it.type === "manual") {
      fact("行情單價", it.twd != null ? fmt(it.twd) + " 元（手動填寫）" : "尚未填寫");
      fact("填寫日期", it.asOf ? ymd(it.asOf) : null);
      chartBox.append(el("p", { class: "chart-note", text: "手動商品沒有自動價格來源，不會記錄走勢。價格可以在下面修改。" }));
    } else {
      if (it.jpy != null) fact("估值採用", yen(it.jpy) + "（約 " + fmt(it.jpy * jpyRate()) + " 元），" +
        (it.jpyAuto ? SOURCE_NAMES[it.quote.source] + " · " + it.quote.label + (it.quote.stale ? " · 沿用上次報價" : "") : "自填日本行情"));
      if (it.japan) Object.keys(it.japan.quotes || {}).forEach(function (source) {
        var q = it.japan.quotes[source];
        var details = (isNum(q.price) ? yen(q.price) + " · " + q.label : "尚無可用報價") +
          (q.priceAsOf ? " · 相場截至 " + q.priceAsOf : "") +
          (q.sourceUpdated ? " · 原文更新 " + ymd(q.sourceUpdated) : "") +
          (q.date ? " · 抓取 " + ymd(q.date) : "") +
          (q.stale ? " · 本次更新失敗" : "");
        fact(SOURCE_NAMES[source], el("span", null, details, " ",
          el("a", { href: q.url, target: "_blank", rel: "noopener noreferrer", text: "來源頁" })));
      });
      if (it.manualJpy != null) fact("備用自填價", yen(it.manualJpy) + (it.jpyDate ? " · " + ymd(it.jpyDate) : ""));
      fact(it.cat === 85 ? "美國市場價" : "市價", it.market != null ? usd(it.market) + "（約 " + fmt(it.market * fx()) + " 元）" : "尚無成交市價");
      if (it.usdQuote && it.usdQuote.source === "tcgplayer") fact("市價取得方式", "TCGplayer 原站補抓" + (it.usdQuote.stale ? " · 更新失敗，沿用上次報價" : "（彙整來源漏價）"));
      fact("最低掛價", it.low != null ? usd(it.low) + "（約 " + fmt(it.low * fx()) + " 元）" : null);
      if (it.comparisons) appendComparisonFacts(it.comparisons, fact);
      fact("系列", it.group);
      fact("編號", it.number);
      if (it.prices.length > 1) fact("各版本", it.prices.map(function (x) { return x[0] + " " + usd(x[1] != null ? x[1] : x[2]); }).join("、"));
      else fact("版本", it.sub && it.sub !== "Normal" ? it.sub : null);
      fact("美國資料日期", it.type === "pending" ? (it.asOf ? ymd(it.asOf) + "（加入時的價格）" : null) : ymd((state.latest.items[it.pid] || {}).date || state.latest.date));
      fact("美國來源", el("a", { href: "https://www.tcgplayer.com/product/" + it.pid, target: "_blank", rel: "noopener noreferrer", text: "TCGplayer 商品頁" }));
    }
    var side = el("div", { class: "side" }, facts);
    if (it.type !== "manual") {
      var img = el("img", { class: "thumb", loading: "lazy", alt: "", src: "https://tcgplayer-cdn.tcgplayer.com/product/" + it.pid + "_200w.jpg" });
      img.addEventListener("error", function () { img.hidden = true; });
      side.append(img);
    }

    /* 持有資料 */
    var qty = el("input", { id: "qty-" + it.key, type: "number", min: 0, step: 1, inputmode: "numeric", value: it.qty || "" });
    var cost = el("input", { id: "cost-" + it.key, type: "number", min: 0, step: 1, inputmode: "numeric", value: it.cost != null ? it.cost : "" });
    var note = el("input", { id: "note-" + it.key, maxlength: 120, value: it.note || "" });
    var price = it.type === "manual" ? el("input", { id: "price-" + it.key, type: "number", min: 0, step: 1, inputmode: "numeric", value: it.twd != null ? it.twd : "" }) : null;
    var jpy = it.type !== "manual" && it.cat === 85 ? el("input", { id: "jpy-" + it.key, type: "number", min: 0, step: 1, inputmode: "numeric", placeholder: "沒有自動報價時使用", value: it.manualJpy != null ? it.manualJpy : "" }) : null;
    var msg = el("div", { role: "status" });
    var form = el("form", { class: "form" },
      el("label", null, "持有數量", qty),
      el("label", null, "成本單價（台幣）", cost),
      price ? el("label", null, "行情單價（台幣）", price) : null,
      jpy ? el("label", null, "備用日本行情（日圓）", jpy) : null,
      el("label", null, "備註", note),
      el("button", { class: "btn primary", type: "submit", text: "儲存" }));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var q = parseFloat(qty.value), c = parseFloat(cost.value);
      if (it.type === "manual") {
        state.local.manual.forEach(function (m) {
          if (m.id !== it.id) return;
          m.qty = isNum(q) ? q : 0; m.cost = isNum(c) ? c : null; m.note = note.value.trim();
          var pr = parseFloat(price.value);
          if (isNum(pr) && pr !== m.price) { m.price = pr; m.priceDate = todayStr(); }
        });
      } else {
        var rec = { qty: isNum(q) ? q : 0, cost: isNum(c) ? c : null, note: note.value.trim() };
        if (jpy) {
          var j = parseFloat(jpy.value);
          if (isNum(j) && j > 0) { rec.jpy = j; rec.jpyDate = j === it.manualJpy && it.jpyDate ? it.jpyDate : todayStr(); }
        }
        state.local.holdings[it.key] = rec;
      }
      if (!saveLocal()) { msg.textContent = "瀏覽器不允許儲存，資料只會保留到關閉頁面為止。"; }
      renderList();
    });

    var actions = el("div", { class: "row-actions" });
    function button(label, cls, fn) { var b = el("button", { class: "btn small " + (cls || ""), type: "button", text: label }); b.addEventListener("click", function () { fn(b); }); actions.append(b); }
    if (it.type === "pending") {
      button("加入每日紀錄", "", function (b) { addToWatch(it, b, msg); });
      button("從清單移除", "danger", function () {
        state.local.pending = state.local.pending.filter(function (p) { return Number(p.pid) !== it.pid; });
        delete state.local.holdings[it.key]; delete state.open[it.key]; saveLocal(); renderList();
      });
    } else if (it.type === "tracked") {
      if (it.comparisonConfig && state.config.local) button("更新其他來源價格", "", function (b) {
        b.disabled = true; msg.textContent = "抓價中…";
        saveLocalWatch({ action: "upsert", entry: { pid: it.pid, cat: it.cat } }).catch(function (error) { b.disabled = false; msg.textContent = error.message; });
      });
      button("停止每日紀錄", "danger", function (b) { removeFromWatch(it, b, msg); });
    } else {
      button("刪除這個手動商品", "danger", function () {
        state.local.manual = state.local.manual.filter(function (m) { return m.id !== it.id; });
        delete state.open[it.key]; saveLocal(); renderList();
      });
    }
    return { node: el("div", { class: "detail" }, chartBox, side, el("div", { class: "full" }, form),
      it.type === "tracked" && state.config.local ? renderAlerts(it) : null,
      it.cat === 85 && it.type !== "manual" ? renderJapanConfig(it) : null,
      it.type === "tracked" && !it.sealed ? renderSingleConfig(it) : null,
      el("div", { class: "full" }, actions, msg)), chartBox: chartBox };
  }

  function alertChoices(it) {
    var choices = [];
    if (isNum(it.market) && it.market > 0) choices.push({ key: "market", label: "TCGplayer 市場價（美元）", currency: "USD" });
    if (it.japan) Object.keys(it.japan.quotes || {}).forEach(function (source) {
      var q = it.japan.quotes[source];
      if (isNum(q.price) && q.price > 0) choices.push({ key: "japan:" + source, label: (SOURCE_NAMES[source] || source) + " " + q.label + "（日圓）", currency: "JPY" });
    });
    (it.comparisons && it.comparisons.quotes || []).forEach(function (q) {
      if (isNum(q.price) && q.price > 0) choices.push({ key: "comparison:" + q.key, label: q.name + " " + q.label + " · " + q.condition + "（" + (q.currency === "JPY" ? "日圓" : "美元") + "）", currency: q.currency });
    });
    return choices;
  }
  function renderAlerts(it) {
    var choices = alertChoices(it), box = el("section", { class: "full alerts" }, el("h3", { text: "關注價格" }));
    var own = state.alerts.filter(function (a) { return a.pid === it.pid; });
    own.forEach(function (a) {
      var match = choices.find(function (c) { return c.key === a.sourceKey; });
      var remove = el("button", { type: "button", class: "btn small danger", text: "刪除" });
      remove.addEventListener("click", function () {
        remove.disabled = true;
        postJSON("/api/alerts", { action: "remove", id: a.id }).then(function (data) { state.alerts = data.alerts; renderList(); })
          .catch(function (error) { remove.disabled = false; status.textContent = error.message; });
      });
      box.append(el("div", { class: "alert-row" }, el("span", { text: (match ? match.label : a.sourceKey) + " " + (a.direction === "below" ? "低於或等於 " : "高於或等於 ") +
        (match && match.currency === "JPY" ? "¥" : "$") + nf.format(a.threshold) + (a.active ? " · 已到價，等待回到門檻外" : " · 待命中") }), remove));
    });
    var status = el("p", { class: "hint", role: "status" });
    if (!choices.length) { box.append(el("p", { class: "hint", text: "目前沒有可設定關注價的自動報價。" })); return box; }
    var source = el("select", { "aria-label": "關注的價格來源" }, choices.map(function (c) { return el("option", { value: c.key, text: c.label }); }));
    var direction = el("select", { "aria-label": "到價條件" }, el("option", { value: "below", text: "低於或等於" }), el("option", { value: "above", text: "高於或等於" }));
    var amount = el("input", { type: "number", min: "0.01", step: "0.01", inputmode: "decimal", required: true, placeholder: "目標價", "aria-label": "目標價" });
    var unit = el("span", { class: "small", text: choices[0].currency });
    source.addEventListener("change", function () { unit.textContent = choices.find(function (c) { return c.key === source.value; }).currency; });
    var form = el("form", { class: "alert-form" }, source, direction, amount, unit, el("button", { class: "btn primary", type: "submit", text: "新增關注價" }));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var button = form.querySelector("button"); button.disabled = true;
      postJSON("/api/alerts", { pid: it.pid, sourceKey: source.value, direction: direction.value, threshold: Number(amount.value) })
        .then(function (data) { state.alerts = data.alerts; renderList(); })
        .catch(function (error) { status.textContent = error.message; button.disabled = false; });
    });
    box.append(form, status, el("p", { class: "chart-note", text: "每日抓到新報價才檢查。首次到價通知一次，價格回到門檻外後才會再次通知；抓取失敗的舊價不觸發。" }));
    return box;
  }

  function appendComparisonFacts(data, fact) {
    (data.quotes || []).forEach(function (q) {
      var isYen = q.currency === "JPY";
      var details = isNum(q.price) ? (isYen ? yen(q.price) : usd(q.price)) + "（約 " + fmt(q.price * (isYen ? jpyRate() : fx())) + " 元）" : "尚無價格";
      details += " · " + q.label + (q.condition ? " · " + q.condition : "") +
        (q.priceAsOf ? " · 相場截至 " + q.priceAsOf : "") +
        (q.sourceUpdated ? " · 原文更新 " + ymd(q.sourceUpdated) : "") +
        (q.date ? " · 抓取 " + ymd(q.date) : "") +
        (q.stale ? " · 更新失敗，沿用舊報價" : "");
      fact(q.name + (q.metric === "a" ? " A" : q.metric === "psa10" ? " PSA10" : ""),
        el("span", null, details, " ", el("a", { href: q.url, target: "_blank", rel: "noopener noreferrer", text: "來源頁" })));
    });
    (data.errors || []).forEach(function (e) {
      if (!(data.quotes || []).some(function (q) { return q.name === e.name && q.stale; }))
        fact(e.name, e.message === "A 與 PSA10 都沒有有效掛價" ? "目前沒有 A／PSA10 掛價" : "更新失敗：" + e.message);
    });
    (data.links || []).forEach(function (l) {
      fact(l.name, el("span", null, l.note + " ", el("a", { href: l.url, target: "_blank", rel: "noopener noreferrer", text: "來源頁" })));
    });
  }

  function renderSingleConfig(it) {
    var config = it.comparisonConfig || {};
    var source = (config.sources || []).find(function (s) { return s.source === "snkrdunk-single" || s.source === "snkrdunk-used"; });
    var url = el("input", { type: "url", placeholder: "https://snkrdunk.com/apparels/…", value: source ? "https://snkrdunk.com/apparels/" + source.apparelId : "" });
    var msg = el("div", { role: "status" });
    var button = el("button", { class: "btn", type: "submit", text: "儲存單卡來源並抓價" });
    var form = el("form", { class: "form" }, el("label", null, "SNKRDUNK 同一張單卡商品網址", url), button);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var value = url.value.trim();
      var match = /^https:\/\/snkrdunk\.com\/(?:en\/)?(?:trading-cards|apparels)\/([1-9]\d*)\/?$/.exec(value);
      if (value && !match) { msg.textContent = "請貼上 SNKRDUNK 的單卡商品網址。"; return; }
      var comparison = { sources: (config.sources || []).filter(function (s) { return s.source !== "snkrdunk-single" && s.source !== "snkrdunk-used"; }), links: config.links || [] };
      if (match) comparison.sources.push({ source: "snkrdunk-single", apparelId: Number(match[1]), size: "1枚" });
      var entry = { pid: it.pid, cat: it.cat, comparisons: comparison.sources.length || comparison.links.length ? comparison : null };
      if (state.config.local) {
        button.disabled = true; msg.textContent = "儲存並抓取 A／PSA10 中…";
        saveLocalWatch({ action: "upsert", entry: entry }).catch(function (err) { button.disabled = false; msg.textContent = err.message; });
      } else if (!state.local.token || !state.config.repo) {
        manualInstruction(msg, JSON.stringify(entry, null, 2), "以這筆取代原商品資料，貼入");
      } else {
        button.disabled = true; msg.textContent = "寫入中…";
        editWatchlist(function (json) {
          var existing = json.items.find(function (w) { return Number(w.pid) === it.pid; });
          if (existing) existing.comparisons = entry.comparisons;
        }, "Configure SNKRDUNK single-card source for " + it.name).then(function () {
          button.disabled = false; msg.textContent = "已儲存。下次更新後顯示 A／PSA10 掛價。";
        }, function (err) { button.disabled = false; msg.textContent = err.message; });
      }
    });
    return el("details", { class: "full source-config", open: !source },
      el("summary", { text: source ? "單卡 SNKRDUNK 來源（已設定）" : "設定單卡 SNKRDUNK 來源" }),
      el("p", { class: "hint", text: "請確認卡名與卡號一致。只讀取 A 和 PSA10 的最低掛價；沒有掛價時會顯示原因。" }), form, msg);
  }

  function renderJapanConfig(it) {
    var config = it.japanConfig || {}, snkr = config.snkrdunk || {}, pb = config.pricebase || {};
    var snkrUrl = el("input", { type: "url", placeholder: "https://snkrdunk.com/apparels/…", value: snkr.apparelId ? "https://snkrdunk.com/apparels/" + snkr.apparelId : "" });
    var size = el("input", { value: snkr.size || "1個", placeholder: "例如 1個（單盒）、1枚（單卡）" });
    var pbUrl = el("input", { type: "url", placeholder: "https://price-base.com/useful/…", value: pb.url || "" });
    var preferred = el("select", null, el("option", { value: "snkrdunk", text: "SNKRDUNK" }), el("option", { value: "pricebase", text: "PRICE BASE" }));
    preferred.value = config.preferred || "snkrdunk";
    var msg = el("div", { role: "status" });
    var button = el("button", { class: "btn", type: "submit", text: "儲存自動抓價來源" });
    var form = el("form", { class: "form" }, el("label", null, "SNKRDUNK 商品網址", snkrUrl),
      el("label", null, "SNKRDUNK 規格（與來源頁一致）", size), el("label", null, "PRICE BASE 單一商品相場文章", pbUrl),
      el("label", null, "優先估值來源", preferred), button);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var japan = { preferred: preferred.value }, match;
      if (snkrUrl.value.trim()) {
        match = /^https:\/\/snkrdunk\.com\/apparels\/([1-9]\d*)\/?$/.exec(snkrUrl.value.trim());
        if (!match || !size.value.trim()) { msg.textContent = "請填入 SNKRDUNK 商品網址與明確規格。"; return; }
        japan.snkrdunk = { apparelId: Number(match[1]), size: size.value.trim() };
      }
      if (pbUrl.value.trim()) {
        if (!/^https:\/\/price-base\.com\/useful\/[a-z0-9-]+\/?$/.test(pbUrl.value.trim())) { msg.textContent = "請填入 PRICE BASE 單一商品的相場文章網址。"; return; }
        japan.pricebase = { url: pbUrl.value.trim().replace(/\/$/, "") };
      }
      var entry = Object.assign({}, state.watch.find(function (w) { return Number(w.pid) === it.pid; }) || { pid: it.pid, cat: it.cat });
      if (japan.snkrdunk || japan.pricebase) entry.japan = japan;
      else entry.japan = null;
      if (state.config.local) {
        button.disabled = true; msg.textContent = "儲存並抓取日本報價中…";
        saveLocalWatch({ action: "upsert", entry: entry }).catch(function (err) { button.disabled = false; msg.textContent = err.message; });
        return;
      }
      if (!state.local.token || !state.config.repo) {
        manualInstruction(msg, JSON.stringify(entry, null, 2), it.type === "tracked" ? "以這筆取代原商品資料，貼入" : "加入");
        return;
      }
      button.disabled = true; msg.textContent = "寫入中…";
      editWatchlist(function (json) {
        var existing = json.items.find(function (w) { return Number(w.pid) === it.pid; });
        if (existing) existing.japan = entry.japan;
        else json.items.push(entry);
      }, "Configure Japan prices for " + it.name).then(function () {
        button.disabled = false;
        msg.textContent = "已儲存。自動更新完成後，重新整理就會看到日本報價。";
      }, function (err) { button.disabled = false; msg.textContent = err.message; });
    });
    return el("details", { class: "full source-config", open: !it.japanConfig },
      el("summary", { text: it.japanConfig ? "日本報價來源（已帶入，可調整）" : "設定日本報價來源" }),
      el("p", { class: "hint", text: (state.config.local ? "本機直接儲存並抓價，不需要 GitHub token。" : "") +
        "已對照的商品會自動帶入來源；其他商品可貼上相同版本與包裝的網址。SNKRDUNK 使用新品最低掛價，PRICE BASE 使用當期相場參考價。" }), form, msg);
  }

  function todayStr() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()); }

  function addToWatch(it, btn, msg) {
    var entry = { pid: it.pid, cat: it.cat };
    if (it.japanConfig) entry.japan = it.japanConfig;
    if (state.config.local) {
      btn.disabled = true; msg.textContent = "加入並抓取行情中…";
      saveLocalWatch({ action: "upsert", entry: entry }).catch(function (err) { btn.disabled = false; msg.textContent = err.message; });
      return;
    }
    if (!state.local.token || !state.config.repo) { manualInstruction(msg, JSON.stringify(entry) + ",", "加入"); return; }
    btn.disabled = true; msg.textContent = "寫入中…";
    editWatchlist(function (json) {
      if (!json.items.some(function (x) { return Number(x.pid) === it.pid; })) json.items.push(entry);
    }, "Track " + it.name).then(function () {
      renderList();
    }, function (err) { btn.disabled = false; msg.textContent = err.message; });
  }
  function removeFromWatch(it, btn, msg) {
    if (state.config.local) {
      btn.disabled = true; msg.textContent = "儲存中…";
      saveLocalWatch({ action: "remove", pid: it.pid }).catch(function (err) { btn.disabled = false; msg.textContent = err.message; });
      return;
    }
    if (!state.local.token || !state.config.repo) { manualInstruction(msg, '"pid": ' + it.pid, "刪掉含有"); return; }
    btn.disabled = true; msg.textContent = "寫入中…";
    editWatchlist(function (json) {
      json.items = json.items.filter(function (x) { return Number(x.pid) !== it.pid; });
    }, "Untrack " + it.name).then(function () {
      delete state.open[it.key]; renderList();
    }, function (err) { btn.disabled = false; msg.textContent = err.message; });
  }

  function openChart(it, box) {
    if (it.type !== "tracked") {
      if (it.type === "pending") { box.textContent = ""; box.append(el("p", { class: "chart-note", text: "這個商品還沒有每日紀錄，所以沒有走勢。按下面的「加入每日紀錄」後，隔天開始累積。" })); }
      return;
    }
    var choices = it.japan && it.japan.historyChoices || [];
    if (it.japanConfig && !it.jpyAuto && !choices.length) {
      box.textContent = "";
      box.append(el("p", { class: "chart-note", text: "來源尚未提供可用的日本報價或歷史。請確認來源網址及規格。" }));
      return;
    }
    var japanese = !!(it.jpyAuto || choices.length), currency = japanese ? "JPY" : "USD";
    var costUsd = it.cost != null ? it.cost / (japanese ? jpyRate() : fx()) : null;
    if (japanese && !choices.length) choices = [{ key: it.quote.key, source: it.quote.source, label: it.quote.label, kind: "snapshot" }];
    var choice = choices.find(function (c) { return c.key === box.dataset.series; }) ||
      choices.find(function (c) { return c.key === it.japan.chartKey; }) || choices[0];
    box.dataset.series = choice ? choice.key : "";
    var requested = box.dataset.series;
    loadHistory(it.pid, choice || null).then(function (pts) {
      if (!state.open[it.key] || box.dataset.series !== requested) return;
      if (japanese) {
        var end = ts(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date())), start = end - 29 * 86400000;
        pts = pts.filter(function (p) { return ts(p.date) >= start && ts(p.date) <= end; });
      }
      drawChart(box, it.name, pts, costUsd, currency);
      if (japanese) {
        var select = el("select", { "aria-label": "走勢來源" });
        choices.forEach(function (c) { select.append(el("option", { value: c.key, text: SOURCE_NAMES[c.source] + " · " + c.label + (c.kind === "snapshot" ? "（每日抓取）" : "（歷史補入）") })); });
        select.value = choice.key;
        select.addEventListener("change", function () { box.dataset.series = select.value; openChart(it, box); });
        box.prepend(el("label", { class: "chart-note", text: "近 30 天走勢 " }, select));
        box.append(el("p", { class: "chart-note", text: "近 30 天共 " + pts.length + " 筆實際日期；缺少日期不補值。成交相場、文章相場與最低掛價分開記錄。台幣使用目前匯率換算。" }));
        if (choice.error) box.append(el("p", { class: "chart-note", text: "歷史更新失敗，保留已有紀錄：" + choice.error }));
        else if (choice.kind === "snapshot" && it.japan.historyErrors && it.japan.historyErrors[choice.source]) box.append(el("p", { class: "chart-note", text: "歷史補抓：" + it.japan.historyErrors[choice.source] }));
      } else if (it.cat === 85) box.append(el("p", { class: "chart-note", text: "這是 TCGplayer 美國市場的美元走勢。設定下方的自動日本報價後，會嘗試補入近 30 天日圓歷史。" }));
    });
  }

  function renderList() {
    var items = listItems();
    renderSummary(items);
    $("listMsg").textContent = state.notice;
    var board = $("board");
    board.textContent = "";
    charts = {};
    if (state.status !== "ready") {
      var t = state.status === "loading" ? ["正在讀取行情資料…", "追蹤的商品和最新價格會顯示在這裡。"] : ["資料讀取失敗", "請重新整理頁面。如果是第一次部署，要等自動更新跑完一次才會有資料。"];
      board.append(el("div", { class: "empty" }, el("strong", { text: t[0] }), t[1]));
      return;
    }
    if (!items.length) {
      board.append(el("div", { class: "empty" }, el("strong", { text: "清單是空的" }), "到「搜尋」找一張卡或一盒商品，按「加入清單」。"));
      return;
    }
    board.append(el("div", { class: "board-head", "aria-hidden": "true" },
      el("span", { text: "商品" }), el("span", { text: "近期走勢" }), el("span", { class: "r", text: "行情（台幣）" }), el("span", { class: "r", text: "與成本的差額" }), el("span")));

    items.forEach(function (it) {
      var has = it.twd != null;
      var singleQuotes = it.comparisons && it.comparisons.quotes || [];
      var aQuote = singleQuotes.find(function (q) { return q.name === "SNKRDUNK" && q.metric === "a" && isNum(q.price); });
      var psa10Quote = singleQuotes.find(function (q) { return q.name === "SNKRDUNK" && q.metric === "psa10" && isNum(q.price); });
      var singleError = it.comparisons && (it.comparisons.errors || []).find(function (e) { return e.name === "SNKRDUNK"; });
      function conditionLine(label, q) {
        return q ? el("div", { class: "condition-price", text: label + " " + yen(q.price) + "（約 " + fmt(q.price * jpyRate()) + " 元）" + (q.stale ? " · 舊報價" : "") }) : null;
      }
      var chartPrice = it.jpyAuto ? it.jpy : it.market;
      var chg = isNum(chartPrice) && isNum(it.prev) && it.prev > 0 && !(it.quote && it.quote.stale) && !(it.usdQuote && it.usdQuote.stale) ? (chartPrice - it.prev) / it.prev * 100 : null;
      var pl = has && it.qty > 0 && it.cost != null ? it.qty * (it.twd - it.cost) : null;
      var plPct = has && it.cost > 0 ? (it.twd - it.cost) / it.cost * 100 : null;
      var id = "d-" + it.key;
      var metaBits = [];
      if (it.group) metaBits.push(it.group + (it.number ? " · " + it.number : ""));
      if (it.qty > 0) metaBits.push(it.qty + " 件" + (it.cost != null ? " · 成本 " + fmt(it.cost) : ""));
      var meta = el("div", { class: "meta" },
        metaBits.length ? el("span", { text: metaBits.join("　") }) : null,
        it.type === "pending" ? el("span", { class: "chip warn", text: "尚未每日紀錄" }) : null,
        it.type === "tracked" && it.waiting ? el("span", { class: "chip warn", text: "等待下一次更新" }) : null,
        it.type === "tracked" && state.alerts.some(function (a) { return a.pid === it.pid; }) ?
          el("span", { class: "chip", text: "關注價 " + state.alerts.filter(function (a) { return a.pid === it.pid; }).length }) : null,
        it.usdQuote && it.usdQuote.stale ? el("span", { class: "chip warn", text: "美元市價補抓失敗" }) : null,
        it.japan && Object.keys(it.japan.quotes || {}).some(function (s) { return it.japan.quotes[s].stale; }) ? el("span", { class: "chip warn", text: "部分日本來源更新失敗" }) : null,
        it.type === "manual" ? el("span", { class: "chip", text: "手動價格" }) : null);
      var title = it.zh ? it.zh : it.name;
      var row = el("button", { class: "row", type: "button", "aria-expanded": state.open[it.key] ? "true" : "false", "aria-controls": id },
        el("div", { class: "name" },
          el("div", { class: "name-line" }, it.edition ? el("span", { class: "tag", text: it.edition }) : null, el("span", { class: "title", text: title })),
          it.zh ? el("div", { class: "meta" }, el("span", { text: it.name })) : null,
          meta),
        el("div", { class: "spark" }, it.spark.filter(isNum).length > 1 ? sparkline(it.spark.filter(isNum)) : (it.type === "tracked" && !it.waiting ? (it.japan && (it.japan.historyChoices || []).some(function (c) { return c.kind !== "snapshot"; }) ? "查看歷史" : "累積中") : "")),
        el("div", { class: "cell-r price-cell" },
          has ? el("div", { class: "price", text: fmt(it.twd) }) : el("div", { class: "price none", text: "尚無價格" }),
          el("div", { class: "small" },
            it.jpy != null ? yen(it.jpy) + " " + (it.jpyAuto ? SOURCE_NAMES[it.quote.source] + (it.quote.stale ? " · " + ymd(it.quote.date) + " 舊報價" : "") : "自填") + " "
              : (it.japanConfig ? "日本來源尚無報價" : it.usd != null ? usd(it.usd) + (it.cat === 85 ? " 美國市場價 " : " ") : ""),
            (it.jpyAuto || it.jpy == null) && chg != null ? el("span", { class: "dir " + dirOf(chg), text: glyph(dirOf(chg)) + " " + pct(chg) }) : null),
          conditionLine("SNKRDUNK A", aQuote), conditionLine("PSA10", psa10Quote),
          singleError && !aQuote && !psa10Quote ? el("div", { class: "condition-price", text: singleError.message === "A 與 PSA10 都沒有有效掛價" ? "SNKRDUNK：目前無 A／PSA10 掛價" : "SNKRDUNK：抓價失敗" }) : null),
        el("div", { class: "cell-r" },
          pl != null ? el("div", { class: "pl dir " + dirOf(pl), text: glyph(dirOf(pl)) + " " + signed(pl) }) : el("div", { class: "price none", text: "—" }),
          el("div", { class: "small", text: pl != null && plPct != null ? "單價 " + pct(plPct) : (it.qty > 0 ? "" : "未填持有") })),
        el("span", { class: "chev", "aria-hidden": "true", text: "▶" }));

      var d = renderDetail(it);
      d.node.id = id;
      d.node.hidden = !state.open[it.key];
      charts[it.key] = { it: it, box: d.chartBox };
      row.addEventListener("click", function () {
        var open = !state.open[it.key];
        state.open[it.key] = open;
        row.setAttribute("aria-expanded", open ? "true" : "false");
        d.node.hidden = !open;
        if (open) openChart(it, d.chartBox);
      });
      board.append(el("div", { class: "item" }, row, d.node));
      if (state.open[it.key]) openChart(it, d.chartBox);
    });
  }

  var rz;
  window.addEventListener("resize", function () {
    clearTimeout(rz);
    rz = setTimeout(function () { for (var k in charts) if (state.open[k]) openChart(charts[k].it, charts[k].box); }, 150);
  });

  /* ---------- search ---------- */
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function applyAliases(q) {
    var s = q;
    state.aliases.forEach(function (a) { s = s.replace(new RegExp(escapeRe(a[0]), "gi"), " " + a[1] + " "); });
    return s;
  }
  function loadCatalog(scope) {
    if (state.catalogs[scope]) return Promise.resolve(state.catalogs[scope]);
    return getJSON("data/catalog-" + scope + ".json").then(function (c) {
      c.hay = c.items.map(function (it) { var g = c.groups[it[1]] || []; return (it[2] + " " + it[3] + " " + (g[1] || "") + " " + (g[2] || "")).toLowerCase(); });
      state.catalogs[scope] = c;
      refreshPending(c);
      return c;
    });
  }
  /* 清單裡「尚未每日紀錄」的商品，趁目錄載入時順便更新價格 */
  function refreshPending(c) {
    var pend = pendingByPid(), changed = false;
    if (!state.local.pending.length) return;
    c.items.forEach(function (it) {
      var p = pend[it[0]];
      if (!p || Number(p.cat) !== c.cat) return;
      var pr = primaryPrice(it[5]);
      p.prices = it[5]; p.market = pr ? pr[1] : null; p.low = pr ? pr[2] : null; p.sub = pr ? pr[0] : ""; p.asOf = c.date;
      changed = true;
    });
    if (changed) { saveLocal(); renderList(); }
  }
  function search(c, q) {
    var tokens = applyAliases(q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    var hits = [];
    for (var i = 0; i < c.items.length; i++) {
      var h = c.hay[i], ok = true;
      for (var t = 0; t < tokens.length; t++) if (h.indexOf(tokens[t]) < 0) { ok = false; break; }
      if (!ok) continue;
      var it = c.items[i], name = it[2].toLowerCase(), inName = true;
      for (t = 0; t < tokens.length; t++) if (name.indexOf(tokens[t]) < 0) { inName = false; break; }
      var pr = primaryPrice(it[5]);
      hits.push({ i: i, score: (inName ? 2 : 0) + (name.indexOf(tokens[0]) === 0 ? 1 : 0), price: pr ? (pr[1] != null ? pr[1] : pr[2] || 0) : 0 });
    }
    hits.sort(function (a, b) { return b.score - a.score || b.price - a.price; });
    return hits;
  }
  var searchSeq = 0;
  function runSearch() {
    var q = $("q").value.trim(), box = $("results"), hint = $("searchHint"), seq = ++searchSeq;
    if (!q) { box.hidden = true; hint.textContent = "輸入關鍵字開始搜尋。已設定日本來源的商品顯示日圓；其他商品顯示 TCGplayer 美國市場的美元參考價。"; return; }
    hint.textContent = "搜尋中…";
    loadCatalog(state.scope).then(function (c) {
      if (seq !== searchSeq) return;
      var hits = search(c, q);
      box.textContent = "";
      box.hidden = !hits.length;
      hint.textContent = hits.length ? "找到 " + nf.format(hits.length) + " 筆" + (hits.length > MAX_RESULTS ? "，顯示價格最高的前 " + MAX_RESULTS + " 筆。加上編號或系列名稱可以縮小範圍。" : "。") + "　資料日期 " + ymd(c.date) +
          (state.scope === "jp" ? "　加入清單後可設定 SNKRDUNK／PRICE BASE 自動報價；未設定者顯示美國參考價。" : "")
        : "找不到符合的商品。試試英文卡名或編號，或切換美版／日版。";
      var inList = {};
      listItems().forEach(function (x) { if (x.pid) inList[x.pid] = true; });
      hits.slice(0, MAX_RESULTS).forEach(function (hh) {
        var it = c.items[hh.i], g = c.groups[it[1]] || [], pr = primaryPrice(it[5]), u = pr ? (pr[1] != null ? pr[1] : pr[2]) : null;
        var latestItem = state.latest.items[it[0]], japan = latestItem && latestItem.japan;
        var usdFallback = latestItem && latestItem.usdQuote && latestItem.usdQuote.source === "tcgplayer" && isNum(latestItem.market);
        if (usdFallback) { pr = [latestItem.sub, latestItem.market, latestItem.low]; u = latestItem.market; }
        var quote = japan && japan.quotes && japan.quotes[japan.selected];
        var hasJapan = quote && isNum(quote.price), sourceLabel = hasJapan ? SOURCE_NAMES[quote.source] + (quote.stale ? "（舊報價）" : "") : usdFallback ? "TCGplayer 原站補抓" + (latestItem.usdQuote.stale ? "（舊報價）" : "") : "TCGplayer 美國參考價";
        var img = el("img", { loading: "lazy", alt: "", src: "https://tcgplayer-cdn.tcgplayer.com/product/" + it[0] + "_200w.jpg" });
        img.addEventListener("error", function () { img.style.visibility = "hidden"; });
        var add = el("button", { class: "btn small add", type: "button", text: inList[it[0]] ? "已在清單" : "加入清單" });
        add.disabled = !!inList[it[0]];
        add.addEventListener("click", function () {
          if (state.config.local) {
            add.disabled = true; add.textContent = "抓價中…";
            var entry = { pid: it[0], cat: c.cat };
            if (c.cat === 85 && state.sourceDefaults[it[0]]) entry.japan = state.sourceDefaults[it[0]];
            saveLocalWatch({ action: "upsert", entry: entry }).then(function () {
              add.textContent = "已加入每日紀錄";
            }, function (err) { add.disabled = false; add.textContent = "重試加入"; hint.textContent = err.message; });
            return;
          }
          state.local.pending.push({ pid: it[0], cat: c.cat, name: it[2], group: g[1] || "", number: it[3] || "", sealed: it[4], sub: pr ? pr[0] : "", market: pr ? pr[1] : null, low: pr ? pr[2] : null, prices: it[5], asOf: c.date });
          saveLocal(); add.disabled = true; add.textContent = "已加入"; renderList();
        });
        var sub = pr && pr[0] !== "Normal" ? pr[0] : "";
        box.append(el("div", { class: "item result" }, img,
          el("div", { class: "name" },
            el("div", { class: "title" }, el("a", { href: "https://www.tcgplayer.com/product/" + it[0], target: "_blank", rel: "noopener noreferrer", text: it[2] })),
            el("div", { class: "meta" }, el("span", { text: (g[1] || "") + (it[3] ? " · " + it[3] : "") }), sub ? el("span", { class: "chip", text: sub }) : null, it[4] ? el("span", { class: "chip", text: "未拆商品" }) : null)),
          el("div", { class: "cell-r" },
            hasJapan ? el("div", { class: "price", text: yen(quote.price) }) : u != null ? el("div", { class: "price", text: usd(u) }) : el("div", { class: "price none", text: "尚無價格" }),
            el("div", { class: "small", text: hasJapan ? "約 " + fmt(quote.price * jpyRate()) + " 元 · " + sourceLabel : u != null ? "約 " + fmt(u * fx()) + " 元 · " + sourceLabel + (pr[1] == null ? "（掛價）" : "") : "" })),
          add));
      });
    }, function () {
      if (seq !== searchSeq) return;
      box.hidden = true; hint.textContent = "商品目錄讀取失敗，請稍後再試。";
    });
  }

  /* ---------- image identify ---------- */
  function setScope(scope) {
    state.scope = scope;
    document.querySelectorAll(".seg-btn").forEach(function (x) { x.setAttribute("aria-checked", x.getAttribute("data-scope") === scope ? "true" : "false"); });
  }
  /* 手機照片動輒數 MB，先縮到長邊 1568px 的 JPEG 再上傳 */
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var scale = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("無法讀取這張圖片")); };
      img.src = url;
    });
  }
  var identifySeq = 0;
  function identifyImage(file) {
    var msg = $("identifyMsg"), seq = ++identifySeq;
    msg.hidden = false;
    msg.textContent = "AI 辨識中…";
    shrinkImage(file).then(function (data) {
      return postJSON("/api/identify", { image: data, mediaType: "image/jpeg" });
    }).then(function (r) {
      if (seq !== identifySeq) return;
      if (!r.queries.length) { msg.textContent = "AI 判斷：" + (r.summary || "看不出是哪個商品") + " 請改用關鍵字搜尋。"; return; }
      var scope = r.language === "jp" ? "jp" : "en";
      return loadCatalog(scope).then(function (c) {
        if (seq !== identifySeq) return;
        var query = r.queries.find(function (q) { return search(c, q).length; });
        setScope(scope);
        $("q").value = query || r.queries[0];
        msg.textContent = "AI 判斷：" + r.summary + (query ? " 請從下方候選確認是哪一個。" : " 目錄裡找不到對應商品，可以修改關鍵字再試。");
        runSearch();
      });
    }).catch(function (error) { if (seq === identifySeq) msg.textContent = "辨識失敗：" + error.message; });
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    $("sourceText").textContent = "資料日期 " + ymd(state.latest.date) + "，匯率 1 美元 = " + fx() + " 台幣；1 日圓 = " + jpyRate().toFixed(4) + " 台幣。" +
      "日本來源：SNKRDUNK 新品最低掛價、PRICE BASE 獨自調查的取引相場參考價。每筆會標示來源、抓取日期與原文提供的相場日期。" +
      (state.config.scheduled ? "NAS 模式：每天台北時間 05:30 自動更新；清單及行情儲存在 NAS。持有數量與成本仍保存在各裝置的瀏覽器。" : state.config.local ? "本機模式：加入商品或儲存來源會立即抓取日本報價。每天開啟 npm start 會更新全部行情；本機關閉時不會執行。" : "每天台北時間清晨由 GitHub Actions 自動抓取並重新部署。") + (state.config.repo ? "儲存庫：" + state.config.repo + "。" : "");
    $("githubPanel").hidden = !!state.config.local;
    $("pushPanel").hidden = !state.config.local;
    if ($("identifyBtn")) $("identifyBtn").hidden = !state.config.identify;
    if (state.config.local) {
      $("pushHint").textContent = !window.isSecureContext ? "iPhone 網站推播需要受信任的 HTTPS 網址。請用 Safari 開啟 NAS 的 HTTPS 網址，加入主畫面後，從主畫面開啟並啟用推播。區網 IP 的 HTTP 網址無法啟用。" :
        "在商品明細設定關注價。iPhone 請先用 Safari 將此 HTTPS 網站加入主畫面，再從主畫面開啟並點「啟用推播」。每天更新後到價才通知。";
    }
    $("token").value = state.local.token || "";
  }
  function pushSubscription() {
    return navigator.serviceWorker.getRegistration().then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; });
  }
  function pushKeyBytes(key) {
    var padding = "=".repeat((4 - key.length % 4) % 4);
    return Uint8Array.from(atob((key + padding).replace(/-/g, "+").replace(/_/g, "/")), function (c) { return c.charCodeAt(0); });
  }
  function bindPushSettings() {
    var msg = $("pushMsg");
    $("pushEnable").addEventListener("click", async function () {
      var button = $("pushEnable");
      if (!window.isSecureContext || !navigator.serviceWorker || !window.PushManager || !window.Notification) {
        msg.textContent = "這個瀏覽器或網址不支援網站推播；iPhone 請改用可信任的 HTTPS 網址並加入主畫面。"; return;
      }
      // Permission must be requested directly from the user's tap on iPhone.
      var permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") { msg.textContent = "尚未允許通知，請到 iPhone 設定中允許此網站的通知。"; return; }
      button.disabled = true; msg.textContent = "設定推播中…";
      try {
        var reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        var key = await getJSON("/api/push/public-key");
        var sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKeyBytes(key.publicKey) });
        await postJSON("/api/push/subscribe", { subscription: sub.toJSON() });
        msg.textContent = "這台裝置已啟用推播。可以按「傳送測試通知」確認。";
      } catch (error) { msg.textContent = "啟用失敗：" + error.message; }
      button.disabled = false;
    });
    $("pushTest").addEventListener("click", async function () {
      try {
        var sub = await pushSubscription();
        if (!sub) throw new Error("請先在這台裝置啟用推播");
        await postJSON("/api/push/test", { endpoint: sub.endpoint });
        msg.textContent = "已送出測試通知。";
      } catch (error) { msg.textContent = error.message; }
    });
    $("pushDisable").addEventListener("click", async function () {
      try {
        var sub = await pushSubscription();
        if (sub) { await postJSON("/api/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
        msg.textContent = "這台裝置已停用推播；關注價仍保留。";
      } catch (error) { msg.textContent = error.message; }
    });
  }
  function bindSettings() {
    bindPushSettings();
    $("manualForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var name = $("m-name").value.trim();
      if (!name) return;
      var q = parseFloat($("m-qty").value), c = parseFloat($("m-cost").value), pr = parseFloat($("m-price").value);
      state.local.manual.push({ id: Date.now().toString(36), name: name, edition: $("m-edition").value, qty: isNum(q) ? q : 0, cost: isNum(c) ? c : null, price: isNum(pr) ? pr : null, priceDate: todayStr(), note: "" });
      saveLocal(); ev.target.reset(); renderList(); switchTab("list");
    });
    $("exportBtn").addEventListener("click", function () {
      var data = { app: "pokemon-card-tracker", exported: new Date().toISOString(), holdings: state.local.holdings, pending: state.local.pending, manual: state.local.manual };
      var a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), download: "card-tracker-backup-" + todayStr() + ".json" });
      document.body.append(a); a.click(); a.remove();
      $("backupMsg").textContent = "已匯出。";
    });
    $("importFile").addEventListener("change", function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      f.text().then(function (t) {
        var d = JSON.parse(t);
        if (!d || typeof d !== "object" || (!d.holdings && !d.manual && !d.pending)) throw new Error("格式不符");
        state.local.holdings = d.holdings && typeof d.holdings === "object" ? d.holdings : {};
        state.local.pending = Array.isArray(d.pending) ? d.pending : [];
        state.local.manual = Array.isArray(d.manual) ? d.manual : [];
        saveLocal(); renderList();
        $("backupMsg").textContent = "已匯入，原本的持有資料已被取代。";
      }).catch(function () { $("backupMsg").textContent = "匯入失敗：這不是這個網站匯出的檔案。"; });
      ev.target.value = "";
    });
    $("tokenForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      state.local.token = $("token").value.trim();
      $("tokenMsg").textContent = saveLocal() ? (state.local.token ? "已儲存在這個瀏覽器。" : "已清除。") : "瀏覽器不允許儲存。";
    });
    $("tokenClear").addEventListener("click", function () { state.local.token = ""; $("token").value = ""; saveLocal(); $("tokenMsg").textContent = "已清除。"; });
  }

  /* ---------- tabs ---------- */
  var TABS = ["list", "search", "settings"];
  function switchTab(name) {
    TABS.forEach(function (t) {
      $("tab-" + t).hidden = t !== name;
      $("tabbtn-" + t).setAttribute("aria-selected", t === name ? "true" : "false");
    });
    if (name === "search") $("q").focus();
    if (name === "list") for (var k in charts) if (state.open[k]) openChart(charts[k].it, charts[k].box);
  }
  function bindUI() {
    TABS.forEach(function (t) { $("tabbtn-" + t).addEventListener("click", function () { switchTab(t); }); });
    var timer;
    $("q").addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(runSearch, 220); });
    $("searchForm").addEventListener("submit", function (ev) { ev.preventDefault(); clearTimeout(timer); runSearch(); });
    document.querySelectorAll(".seg-btn").forEach(function (b) {
      b.addEventListener("click", function () { setScope(b.getAttribute("data-scope")); runSearch(); });
    });
    // 舊版 index.html 沒有辨識按鈕；缺少時只停用此功能，不讓整頁初始化失敗。
    if ($("identifyFile")) $("identifyFile").addEventListener("change", function () {
      var file = this.files[0];
      this.value = "";
      if (file) identifyImage(file);
    });
    bindSettings();
  }

  /* ---------- boot ---------- */
  function boot() {
    bindUI();
    renderList();
    Promise.all([
      getJSON("data/latest.json"),
      getJSON("data/watchlist.json"),
      getJSON("data/aliases.json").catch(function () { return {}; }),
      getJSON("data/config.json").catch(function () { return { repo: "" }; }),
      getJSON("data/japan-sources.json").catch(function () { return {}; }),
      getJSON("data/comparison-sources.json").catch(function () { return {}; }),
      getJSON("/api/alerts").catch(function () { return { alerts: [] }; })
    ]).then(function (r) {
      state.latest = { items: r[0].items || {}, fx: r[0].fx || { TWD: 31.5, JPY: 150 }, date: r[0].date || "" };
      state.watch = Array.isArray(r[1].items) ? r[1].items : [];
      state.aliases = Object.keys(r[2]).sort(function (a, b) { return b.length - a.length; }).map(function (k) { return [k, String(r[2][k])]; });
      state.config = { repo: r[3].repo || "", local: r[3].local === true, scheduled: r[3].scheduled === true, identify: r[3].identify === true };
      state.sourceDefaults = r[4];
      state.comparisonDefaults = r[5];
      state.alerts = r[6].alerts || [];
      /* 已經有每日紀錄的商品，不用再留在本機的待追蹤名單 */
      var before = state.local.pending.length;
      state.local.pending = state.local.pending.filter(function (p) { var L = state.latest.items[Number(p.pid)]; return !(L && !L.missing); });
      if (state.local.pending.length !== before) saveLocal();
      state.status = "ready";
      $("syncText").textContent = "資料日期 " + ymd(state.latest.date) + " · 1 日圓 = " + jpyRate().toFixed(4) + " 台幣 · " +
        (state.config.scheduled ? "NAS 模式・每天 05:30 更新" : state.config.local ? "本機模式・加入後立即抓價" : "每天清晨自動更新");
    }, function () {
      state.status = "error";
      $("syncText").textContent = "資料讀取失敗";
    }).then(function () {
      var product = Number(new URLSearchParams(location.search).get("product"));
      if (product && state.watch.some(function (w) { return Number(w.pid) === product; })) state.open["p" + product] = true;
      renderList(); renderSettings();
      if (product) document.getElementById("d-p" + product)?.scrollIntoView({ block: "start" });
    });
  }
  boot();
})();
