/*! Craftshan Studio support bot v1. Rule-based: answers only from faq.json (your published policies).
 *  No server, no AI, no tracking, no cookies or storage. Chats live in memory and vanish on reload. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.CraftshanSupportBot = api;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", api.autoStart);
    else api.autoStart();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const MAX_LEN = 300;
  const P = { answer: 0.5, clarify: 0.4, oov: 1 }; // tuning knobs (tests exercise these)
  const STOP = new Set("a an the is are was were be been am i me my we our you your it its this that to of for on in at with and or do does did can could would should will how what when where why which who if so as by from about please hi hello hey there any some have has get got tell give show know want need like just".split(" "));
  const CANON = { bought: "buy", purchase: "buy", purchased: "buy", buying: "buy", paid: "pay", payment: "pay", paying: "pay", charged: "pay",
    downloads: "download", downloaded: "download", commercially: "commercial", selling: "sell", sold: "sell", reselling: "resell", sharing: "share",
    shared: "share", broken: "corrupt", corrupted: "corrupt", damaged: "corrupt", reach: "contact", human: "person", someone: "person",
    reimburse: "refund", refunded: "refund", refunds: "refund", cancel: "refund", cancelled: "refund", twice: "duplicate", double: "duplicate",
    personalise: "personalize", personalised: "personalize", customise: "customize", colours: "color", colour: "color", recolour: "recolor" };

  // Meaning groups: different ways people say the same thing map to one concept word.
  const GROUPS = [
    ["sell", /\b(sell|selling|sold|make money|earn money|profit|monetize|monetise|customers? (can )?buy|for sale|commercial(ly)?|business|etsy|craft fair|market stall|small business)\b/g],
    ["share", /\b(share|sharing|send|email the|forward|give away|pass on|upload|post|hand over|distribute|redistribute|copy of the file|have a copy|bundle)\b/g],
    ["refund", /\b(refund|refunds|refunded|money back|reimburse|return|cancel)\b/g],
    ["duplicate", /\b(twice|two times|double|duplicate|same thing twice|billed two|charged two|paid two|again)\b/g],
    ["subscription", /\b(recurring|monthly|every month|per month|subscription|subscribe|membership|auto ?renew|renewal)\b/g],
    ["account", /\b(account|sign ?up|log ?in|sign ?in|register|password)\b/g],
    ["limit", /\b(cap|limit|maximum|how many|number of|quota)\b/g],
    ["corrupt", /\b(broken|corrupt|corrupted|damaged|empty|wont open|cant open|not opening|missing)\b/g],
    ["person", /\b(person|human|someone|staff|agent|representative|speak to|talk to)\b/g],
    ["machine", /\b(cricut|silhouette|glowforge|xtool|laser|cutter|machine|software|lightburn|inkscape|compatible|compatibility|design space)\b/g],
    ["ship", /\b(mail|ship|shipping|postage|post|by post|arrive|house|address|physical)\b/g],
    ["privacy", /\b(privacy|personal details|personal data|personal information|my data|my information|information about me|data protection|gdpr|email address)\b/g],
    ["delete", /\b(delete|remove|erase|forget)\b/g],
    ["cookie", /\b(track|tracking|analytics|cookies?|google analytics)\b/g],
    ["review", /\b(reviews?|ratings?|star ratings|testimonials?|feedback)\b/g],
    ["instant", /\b(immediate|immediately|instant|instantly|right away|straight away|how fast|how soon|how quickly|how long until)\b/g],
    ["pay", /\b(card|credit card|debit card|paypal|pay|paid|payment|payments|billed|billing|charge|charged)\b/g],
    ["discount", /\b(coupon|promo|promo code|discount|voucher|code|sale|offer|deal)\b/g],
    ["custom", /\b(custom|commission|bespoke|unique|made for me|personalized design|something for me)\b/g],
    ["founder", /\b(founder|creator|behind the shop|behind craftshan|who runs|who made|person behind)\b/g],
    ["locate", /\b(where|find|appear|located|see my)\b/g],
  ];
  const WEAK = new Set(["one", "two", "time", "thing", "item", "piece", "product", "design", "use", "make", "file", "zip", "work"]);
  function normalize(text) {
    let t = " " + String(text).toLowerCase().replace(/[’']/g, "") + " ";
    GROUPS.forEach(([c, re]) => (t = t.replace(re, " c_" + c + " ")));
    return t;
  }

  function stem(w) {
    if (CANON[w]) return CANON[w];
    if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
    else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
    else if (w.length > 4 && /(ch|sh|x|z|ss)es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    return CANON[w] || w;
  }
  function tokens(text) {
    return (normalize(text).match(/[a-z0-9_]+/g) || []).filter((w) => !STOP.has(w)).map((w) => (w.startsWith("c_") ? w : stem(w)));
  }
  const bigrams = (t) => t.slice(1).map((w, i) => t[i] + " " + w);

  const cache = new WeakMap();
  function index(faq) {
    if (cache.has(faq)) return cache.get(faq);
    const docs = faq.entries.map((e) => {
      const t = tokens([e.q, ...(e.also || [])].join(" . "));
      return { e, set: new Set(t), qset: new Set(tokens(e.q)), bi: new Set(bigrams(t)) };
    });
    const df = new Map();
    docs.forEach((d) => d.set.forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
    const n = docs.length, idf = new Map();
    df.forEach((c, t) => idf.set(t, Math.log(1 + n / c)));
    const built = { docs, idf, oov: Math.log(1 + n) };
    cache.set(faq, built);
    return built;
  }

  function rank(text, faq) {
    const { docs, idf, oov } = index(faq);
    const q = [...new Set(tokens(text))];
    if (!q.length) return [];
    const qb = bigrams(tokens(text));
    const wt = (t) => (idf.get(t) ?? oov * P.oov) * (WEAK.has(t) ? 0.3 : 1);
    const den = q.reduce((s, t) => s + wt(t), 0);
    return docs
      .map((d, order) => {
        // words from the main question count fully; words only in alternate wordings count 60%
        const num = q.reduce((s, t) => s + (d.qset.has(t) ? wt(t) : d.set.has(t) ? 0.6 * wt(t) : 0), 0);
        const bonus = qb.filter((b) => d.bi.has(b)).length * 0.08;
        return { entry: d.e, score: Math.min(num / den + bonus, 1.2), order };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.order - b.order);
  }

  /** Pure function: what should the bot say? */
  function respond(query, faq) {
    const raw = String(query || "").trim().slice(0, MAX_LEN);
    const low = raw.toLowerCase();
    if (!raw) return { type: "empty" };
    if (/^(hi|hello|hey|hiya|good (morning|afternoon|evening))\b[\s!.?]*$/.test(low)) return { type: "greeting" };
    if (/^(thanks|thank you|thx|cheers|ok thanks)\b[\s!.?]*$/.test(low)) return { type: "thanks" };
    if ((faq.config.handoff_terms || []).some((t) => low.includes(t))) return { type: "handoff", reason: "sensitive" };
    if ((faq.config.unsupported_terms || []).some((t) => low.includes(t))) return { type: "handoff", reason: "unsupported" };
    const ranked = rank(raw, faq);
    const best = ranked[0];
    const next = ranked[1];
    if (best && best.score >= P.answer && next && best.score < 0.8 && best.score - next.score < 0.08) return { type: "clarify", options: ranked.slice(0, 3).filter((r) => r.score >= P.clarify).map((r) => r.entry) }; // two answers are too close: ask, don't guess
    if (best && best.score >= P.answer) return { type: "answer", entry: best.entry, related: ranked.slice(1, 3).filter((r) => r.score >= P.clarify).map((r) => r.entry) };
    if (best && best.score >= P.clarify) return { type: "clarify", options: ranked.slice(0, 3).filter((r) => r.score >= P.clarify).map((r) => r.entry) };
    return { type: "handoff", reason: "unknown", suggestions: ranked.slice(0, 2).filter((r) => r.score >= 0.18).map((r) => r.entry) };
  }

  /** The answer text, with the honest "checkout isn't live" wording where it matters. */
  function answerText(entry, faq) {
    const live = faq.config.payments_live === true;
    if (!live && entry.a_not_live) return entry.a_not_live;
    if (!live && entry.needs_payments && faq.config.not_live_notice) return entry.a + "\n\n" + faq.config.not_live_notice;
    return entry.a;
  }

  // ---------- widget (shadow DOM so it can't clash with the site's styles) ----------
  const CSS = `
:host{all:initial}*{box-sizing:border-box}
.fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:56px;height:56px;border-radius:50%;border:0;background:#E8A020;color:#0D0D0D;cursor:pointer;box-shadow:0 8px 32px rgba(0,0,0,.25);display:grid;place-items:center;font:inherit}
.fab:hover{background:#F5C55A}.fab:focus-visible,button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid #E8A020;outline-offset:2px}
.panel{position:fixed;right:20px;bottom:88px;z-index:2147483000;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100vh - 110px));background:#FAFAF7;color:#1C1C1A;border:1px solid #E2DED8;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Inter,sans-serif}
.panel[hidden]{display:none}
header{background:#0D0D0D;color:#F5F1E8;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}
header b{font-weight:600}header small{display:block;color:#F5F1E8;opacity:.7;font-size:12px}
.x{background:none;border:0;color:#F5F1E8;font-size:22px;cursor:pointer;padding:4px 8px;border-radius:8px}
.log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.m{max-width:88%;padding:10px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
.bot{background:#fff;border:1px solid #E2DED8;align-self:flex-start}.me{background:#0D0D0D;color:#F5F1E8;align-self:flex-end}
.m a{color:#8C5E00;font-weight:600}.src{display:block;margin-top:8px;font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.chip{border:1px solid #E2DED8;background:#FAFAF7;border-radius:999px;padding:6px 11px;font:inherit;font-size:13px;cursor:pointer;color:#1C1C1A;text-align:left}
.chip:hover{border-color:#E8A020}
.human{display:inline-block;margin-top:8px;background:#E8A020;color:#0D0D0D;border-radius:999px;padding:7px 14px;text-decoration:none;font-weight:600;font-size:14px}
form{display:flex;gap:8px;padding:10px;border-top:1px solid #E2DED8;background:#fff}
input{flex:1;border:1px solid #E2DED8;border-radius:999px;padding:9px 14px;font:inherit;outline:none;background:#fff;color:#1C1C1A}input:focus{border-color:#E8A020}
.send{border:0;border-radius:999px;background:#E8A020;color:#0D0D0D;font:inherit;font-weight:600;padding:0 16px;cursor:pointer}.send:disabled{opacity:.5}
.note{padding:6px 12px 10px;font-size:11.5px;color:#4A4845;background:#fff}
@media (prefers-reduced-motion:no-preference){.m{animation:in .18s ease-out}@keyframes in{from{opacity:0;transform:translateY(4px)}}}
@media (max-width:480px){.panel{right:8px;bottom:80px;width:calc(100vw - 16px)}.fab{right:12px;bottom:12px}}`;

  function el(tag, props, children) {
    const n = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => (k === "text" ? (n.textContent = v) : n.setAttribute(k, v)));
    (children || []).forEach((c) => n.appendChild(c));
    return n;
  }

  function mount(faq, opts) {
    opts = opts || {};
    const site = (faq.config.site || "").replace(/\/$/, "");
    const url = (p) => (/^https?:/.test(p) ? p : site + p);
    const host = el("div", { id: "craftshan-support-bot" });
    const root = host.attachShadow({ mode: "open" });
    root.appendChild(el("style", { text: CSS }));
    const fab = el("button", { class: "fab", type: "button", "aria-label": "Open support chat", "aria-expanded": "false" });
    fab.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    const log = el("div", { class: "log", role: "log", "aria-live": "polite", "aria-label": "Conversation" });
    const input = el("input", { type: "text", maxlength: String(MAX_LEN), "aria-label": "Your question", placeholder: "Ask about licensing, refunds, downloads…", autocomplete: "off" });
    const send = el("button", { class: "send", type: "submit", text: "Send" });
    const close = el("button", { class: "x", type: "button", "aria-label": "Close support chat", text: "×" });
    const form = el("form", {}, [input, send]);
    const panel = el("section", { class: "panel", role: "dialog", "aria-label": "Craftshan Studio support chat", hidden: "" }, [
      el("header", {}, [el("div", {}, [el("b", { text: "Craftshan Studio help" }), el("small", { text: "Answers from our published policies" })]), close]),
      log, form,
      el("div", { class: "note", text: "Automated answers, not legal advice. Please don't share card numbers or passwords here. Nothing you type is saved." }),
    ]);
    root.append(panel, fab);

    let busy = 0, count = 0, started = false;
    const scroll = () => (log.scrollTop = log.scrollHeight);
    function say(text, who) { const m = el("div", { class: "m " + who, text }); log.appendChild(m); scroll(); return m; }
    const byQ = new Map(faq.entries.map((e) => [e.q, e]));
    const topics = (faq.config.topics || []).filter((t) => faq.entries.some((e) => e.topic === t));
    function pick(label) {
      if (topics.includes(label)) {
        if (busy) return;
        say(label, "me");
        const m = say("Here are the questions I can answer about " + label.toLowerCase() + ":", "bot");
        chips(faq.entries.filter((e) => e.topic === label).map((e) => e.q), m);
      } else if (byQ.has(label)) askEntry(byQ.get(label));
      else ask(label);
    }
    function chips(list, parent) {
      const box = el("div", { class: "chips" });
      list.forEach((label) => { const b = el("button", { class: "chip", type: "button", text: label }); b.addEventListener("click", () => pick(label)); box.appendChild(b); });
      parent.appendChild(box);
      scroll();
    }
    function askEntry(entry) { if (busy) return; say(entry.q, "me"); reply({ type: "answer", entry, related: [] }); }
    const humanLink = (parent, label) => parent.appendChild(el("a", { class: "human", href: url(faq.config.contact_path || "/Contact/"), target: "_blank", rel: "noopener", text: label || "Contact the owner" }));

    function reply(res) {
      let m;
      if (res.type === "greeting") { m = say(faq.config.greeting, "bot"); chips(topics.length ? topics : faq.config.starters || [], m); return; }
      if (res.type === "thanks") return void say("You're welcome! Ask me anything else about our licensing, refunds or downloads.", "bot");
      if (res.type === "answer") {
        m = say(answerText(res.entry, faq), "bot");
        if (res.entry.link) m.appendChild(el("a", { class: "src", href: url(res.entry.link.path), target: "_blank", rel: "noopener", text: "Read more: " + res.entry.link.text }));
        if (res.related.length) chips(res.related.map((r) => r.q), m);
        return;
      }
      if (res.type === "clarify") { m = say("Do you mean one of these?", "bot"); chips(res.options.map((o) => o.q), m); return; }
      m = say(res.reason === "sensitive" ? faq.config.sensitive : res.reason === "unsupported" ? faq.config.unsupported : faq.config.handoff, "bot");
      humanLink(m);
      if (res.suggestions && res.suggestions.length) { m.appendChild(el("span", { class: "src", text: "These might help:" })); chips(res.suggestions.map((e) => e.q), m); }
      if (res.reason !== "sensitive" && topics.length) chips(topics, m);
    }
    function ask(text) {
      text = String(text || "").trim().slice(0, MAX_LEN);
      if (!text || busy || ++count > 60) return;
      busy = 1; say(text, "me");
      setTimeout(() => { reply(respond(text, faq)); busy = 0; }, opts.instant ? 0 : 250);
    }
    function open(show) {
      panel.hidden = !show; fab.setAttribute("aria-expanded", String(show));
      fab.setAttribute("aria-label", show ? "Close support chat" : "Open support chat");
      if (show) { if (!started) { started = true; reply({ type: "greeting" }); } input.focus(); } else fab.focus();
    }
    fab.addEventListener("click", () => open(panel.hidden));
    close.addEventListener("click", () => open(false));
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") open(false); });
    form.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value; input.value = ""; ask(v); });
    document.body.appendChild(host);
    if (opts.hideWhen) { // e.g. hide the bot while the site shows its maintenance page
      const check = () => { try { host.style.display = document.querySelector(opts.hideWhen) ? "none" : ""; } catch (e) { /* bad selector: ignore */ } };
      check();
      new MutationObserver(check).observe(document.documentElement, { attributes: true });
    }
    return { open, ask, host };
  }

  async function autoStart() {
    if (document.getElementById("craftshan-support-bot")) return;
    const script = document.currentScript || document.querySelector("script[data-craftshan-support-bot]");
    const src = (script && script.getAttribute("data-faq")) || "/support-bot/faq.json";
    try {
      const res = await fetch(src, { credentials: "omit" });
      if (!res.ok) throw new Error("faq " + res.status);
      mount(await res.json(), { hideWhen: script && script.getAttribute("data-hide-when") });
    } catch (e) {
      console.warn("Craftshan support bot not started:", e.message); // the site keeps working without it
    }
  }
  return { respond, rank, tokens, answerText, mount, autoStart, params: P };
});
