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
  const ico = (inner, size) => `<svg width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const I = {
    licensing: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m9 14 2 2 4-4"/>',
    refunds: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    files: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>',
    orders: '<path d="M6 7h12l1 13H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    privacy: '<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/>',
    contact: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    restart: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>', alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.4v.1"/>',
    up: '<path d="m6 15 6-6 6 6"/>', arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    thumbUp: '<path d="M7 11v9H4v-9z"/><path d="M7 11l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.3 20H7"/>',
    thumbDown: '<path d="M17 13V4h3v9z"/><path d="M17 13l-4 8a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 6.7 4H17"/>',
  };
  const TOPIC_ICON = [/licens/i, "licensing", /refund/i, "refunds", /file|download/i, "files", /order|payment/i, "orders", /privacy|data/i, "privacy", /studio|contact/i, "contact"];
  const topicIcon = (t) => { for (let k = 0; k < TOPIC_ICON.length; k += 2) if (TOPIC_ICON[k].test(t)) return I[TOPIC_ICON[k + 1]]; return I.contact; };

  // Crafty: a friendly laser-bot. Rounded speech-bubble head, spark antenna (a nod to the laser), blinking eyes.
  const crafty = (size) => `<svg class="crafty" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 11v5" stroke="#0D0D0D" stroke-width="2.6" stroke-linecap="round"/><path class="spark" d="M24 1.5l1.9 4.6 4.6 1.9-4.6 1.9L24 14.5l-1.9-4.6L17.5 8l4.6-1.9z" fill="#0D0D0D"/><rect x="1.5" y="24" width="3.5" height="8" rx="1.75" fill="#0D0D0D"/><rect x="43" y="24" width="3.5" height="8" rx="1.75" fill="#0D0D0D"/><path d="M11 16.5h26a5.5 5.5 0 0 1 5.5 5.5v11a5.5 5.5 0 0 1-5.5 5.5H29.5L24 44.5l-5.5-5.5H11A5.5 5.5 0 0 1 5.5 33V22A5.5 5.5 0 0 1 11 16.5z" fill="#0D0D0D"/><g class="eyes"><circle cx="17.5" cy="27" r="3.2" fill="#E8A020"/><circle cx="30.5" cy="27" r="3.2" fill="#E8A020"/></g><path d="M19.5 33.2q4.5 3.6 9 0" stroke="#E8A020" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`;

  const CSS = `
:host{all:initial;--gold:#E8A020;--ink:#0D0D0D;--head:#0D0D0D;--panel:#1A1A1A;--bot:#252525;--chip:#252525;--input:#0D0D0D;--text:#F5F1E8;--muted:#A9A397;--line:#303030;--link:#F5C55A;--side:22px;--fab-bottom:24px;--sh:0 20px 60px rgba(0,0,0,.55)}
:host([data-theme=light]){--panel:#FAFAF7;--bot:#fff;--chip:#fff;--input:#fff;--text:#1C1C1A;--muted:#6E6A64;--line:#E2DED8;--link:#8C5E00;--sh:0 20px 60px rgba(0,0,0,.22)}
*{box-sizing:border-box}button,a,input{font:inherit}
.fab{position:fixed;right:var(--side);bottom:var(--fab-bottom);z-index:2147483000;width:60px;height:60px;border-radius:50%;border:0;background:var(--gold);color:var(--ink);cursor:pointer;display:grid;place-items:center;box-shadow:0 8px 28px rgba(0,0,0,.4),0 0 0 3px rgba(232,160,32,.25);transition:bottom .2s ease,transform .15s ease}
:host([data-pos=left]) .fab,:host([data-pos=left]) .tip{right:auto;left:var(--side)}
.fab:hover{transform:scale(1.06)}.fab:focus-visible,button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.fab .crafty{width:42px;height:42px}.fab .x{display:none}.fab[aria-expanded=true] .crafty{display:none}.fab[aria-expanded=true] .x{display:block}
.eyes{transform-box:fill-box;transform-origin:center;animation:blink 5.5s infinite}.spark{transform-box:fill-box;transform-origin:center;animation:tw 2.8s ease-in-out infinite}
@keyframes blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}@keyframes tw{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}
.tip{position:fixed;right:var(--side);bottom:calc(var(--fab-bottom) + 72px);z-index:2147483000;max-width:240px;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:14px 14px 4px 14px;padding:10px 14px;box-shadow:var(--sh);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Inter,sans-serif;cursor:pointer;text-align:left;transition:bottom .2s ease}
.tip[hidden],.panel[hidden]{display:none}
.panel{position:fixed;right:var(--side);bottom:calc(var(--fab-bottom) + 72px);z-index:2147483000;width:min(396px,calc(100vw - 24px));height:min(620px,calc(100vh - var(--fab-bottom) - 96px));background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:22px;box-shadow:var(--sh);display:flex;flex-direction:column;overflow:hidden;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Inter,sans-serif;transition:bottom .2s ease}
:host([data-pos=left]) .panel{right:auto;left:var(--side)}
header{background:var(--head);color:#F5F1E8;padding:12px 12px 12px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #303030}
.av{flex:none;width:38px;height:38px;border-radius:50%;background:var(--gold);display:grid;place-items:center}.av .crafty{width:28px;height:28px}
.ttl{flex:1;min-width:0}.ttl b{display:block;font-weight:600;font-size:16px;line-height:1.2}.ttl small{display:block;color:#F5F1E8;opacity:.72;font-size:12px;line-height:1.3}
.hb{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:10px;border:0;background:transparent;color:#F5F1E8;cursor:pointer;text-decoration:none}.hb:hover{background:#252525}
.log{position:relative;flex:1;overflow-y:auto;padding:14px 14px 16px;display:flex;flex-direction:column;gap:12px;scroll-behavior:smooth}
.row{display:flex;gap:8px;align-items:flex-start}.row.me{justify-content:flex-end}.row .mini{flex:none;width:26px;height:26px;border-radius:50%;background:var(--gold);display:grid;place-items:center}.row .mini .crafty{width:19px;height:19px}
.bub{max-width:86%;padding:10px 13px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}
.bot .bub{background:var(--bot);border:1px solid var(--line);border-bottom-left-radius:5px}.me .bub{background:var(--gold);color:var(--ink);border-bottom-right-radius:5px;font-weight:500}
.txt+.txt{margin-top:8px}.note2{font-size:13.5px;color:var(--muted)}.showmore{display:block;margin-top:6px;border:0;background:none;color:var(--link);cursor:pointer;padding:2px 0;font-weight:600;font-size:13px}.showmore:hover{text-decoration:underline}
.dots{display:inline-flex;gap:4px;padding:5px 2px}.dots i{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:b 1s infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
@keyframes b{0%,60%,100%{transform:none;opacity:.5}30%{transform:translateY(-4px);opacity:1}}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;white-space:normal}.card{display:flex;align-items:center;gap:8px;text-align:left;border:1px solid var(--line);background:var(--chip);color:var(--text);border-radius:12px;padding:10px;cursor:pointer;font-size:13.5px;line-height:1.25}.card:hover,.q:hover{border-color:var(--gold)}.card svg{flex:none;color:var(--gold)}
.qs{display:flex;flex-direction:column;gap:6px;margin-top:10px;white-space:normal}.q{display:flex;justify-content:space-between;align-items:center;gap:8px;text-align:left;border:1px solid var(--line);background:var(--chip);color:var(--text);border-radius:12px;padding:9px 12px;cursor:pointer;font-size:13.5px;line-height:1.3}.q svg{flex:none;color:var(--gold)}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.btn{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:8px 16px;font-weight:600;font-size:14px;line-height:1.2;text-decoration:none;border:1px solid var(--gold);background:var(--gold);color:var(--ink);cursor:pointer}.btn:hover{filter:brightness(1.08)}
.btn.ghost{background:transparent;color:var(--link)}.btn.ghost:hover{background:rgba(232,160,32,.12);filter:none}
.card.wide{grid-column:1/-1;border-color:var(--gold);background:rgba(232,160,32,.1)}
.log{scrollbar-width:thin;scrollbar-color:#4a4a4a transparent}.log::-webkit-scrollbar{width:8px}.log::-webkit-scrollbar-thumb{background:#4a4a4a;border-radius:8px}.log::-webkit-scrollbar-track{background:transparent}
:host([data-theme=light]) .log{scrollbar-color:#c9c4bb transparent}:host([data-theme=light]) .log::-webkit-scrollbar-thumb{background:#c9c4bb}
.fb{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:10px;font-size:12.5px;color:var(--muted);white-space:normal}.fb button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:transparent;color:var(--text);border-radius:999px;padding:4px 10px;cursor:pointer;font-size:12.5px}.fb button:hover{border-color:var(--gold)}
form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line);background:var(--panel)}
input{flex:1;min-width:0;border:1px solid var(--line);border-radius:999px;padding:10px 15px;outline:none;background:var(--input);color:var(--text)}input::placeholder{color:var(--muted)}input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(232,160,32,.28)}input:focus-visible{outline:none}input:disabled{opacity:.6}
.send{flex:none;border:0;border-radius:999px;background:var(--gold);color:var(--ink);font-weight:700;padding:0 18px;cursor:pointer}.send:disabled{opacity:.5;cursor:default}
.note{padding:0 14px 10px;font-size:11.5px;line-height:1.4;color:var(--muted);background:var(--panel)}
@media (prefers-reduced-motion:no-preference){.row{animation:in .2s ease-out}@keyframes in{from{opacity:0;transform:translateY(5px)}}}
@media (prefers-reduced-motion:reduce){.eyes,.spark,.dots i{animation:none}.log{scroll-behavior:auto}.fab,.tip,.panel{transition:none}}
@media (max-width:520px){.panel{left:8px;right:8px;bottom:8px;width:auto;height:min(660px,calc(100dvh - 16px))}:host([data-pos=left]) .panel{left:8px}.fab[aria-expanded=true]{display:none}.cards{grid-template-columns:1fr 1fr}}`;

  function el(tag, props, children) {
    const n = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => (k === "text" ? (n.textContent = v) : n.setAttribute(k, v)));
    (children || []).forEach((c) => n.appendChild(c));
    return n;
  }
  const html = (tag, props, inner) => { const n = el(tag, props); n.innerHTML = inner; return n; }; // inner is always trusted, built-in markup

  function mount(faq, opts) {
    opts = opts || {};
    const cfg = faq.config, name = cfg.bot_name || "Crafty";
    const site = (cfg.site || "").replace(/\/$/, "");
    const url = (p) => (/^https?:/.test(p) ? p : site + p);
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const host = el("div", { id: "craftshan-support-bot" });
    const root = host.attachShadow({ mode: "open" });
    root.appendChild(el("style", { text: CSS }));
    host.setAttribute("data-pos", cfg.position === "left" ? "left" : "right");
    const theme = () => host.setAttribute("data-theme", document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    theme();
    new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const fab = html("button", { class: "fab", type: "button", "aria-label": "Chat with " + name, "aria-expanded": "false" }, crafty(42) + `<span class="x">${ico(I.close, 26)}</span>`);
    const tip = el("button", { class: "tip", type: "button", hidden: "", text: cfg.tooltip || "Hi, I'm " + name + "! Ask me about licensing, refunds or downloads." });
    const log = el("div", { class: "log", role: "log", "aria-live": "polite", "aria-label": "Conversation with " + name });
    const input = el("input", { type: "text", maxlength: String(MAX_LEN), "aria-label": "Your question", placeholder: "Ask " + name + " a question…", autocomplete: "off", enterkeyhint: "send" });
    const send = el("button", { class: "send", type: "submit", text: "Send" });
    const humanHref = url(cfg.contact_path || "/Contact/");
    const head = el("header", {}, [
      html("span", { class: "av" }, crafty(28)),
      el("div", { class: "ttl" }, [el("b", { text: name }), el("small", { text: "Automated assistant" })]),
      html("a", { class: "hb", href: humanHref, target: "_blank", rel: "noopener", "aria-label": "Contact the owner (opens in a new tab)", title: "Talk to a person" }, ico(I.contact, 19)),
      html("button", { class: "hb restart", type: "button", "aria-label": "Start over", title: "Start over" }, ico(I.restart, 18)),
      html("button", { class: "hb close", type: "button", "aria-label": "Close chat", title: "Close" }, ico(I.close, 20)),
    ]);
    const panel = el("section", { class: "panel", role: "dialog", "aria-label": name + ", Craftshan Studio help chat", hidden: "" }, [
      head, log, el("form", {}, [input, send]),
      el("div", { class: "note", text: "Automated answers from our published policies, not legal advice. Please don't share card numbers or passwords. Nothing you type is saved." }),
    ]);
    root.append(panel, tip, fab);

    const PROBLEM = "I have a problem";
    const problemEntries = () => (cfg.problems || ["file-problem", "my-downloads", "duplicate", "refund", "chargeback"]).map((id) => faq.entries.find((e) => e.id === id)).filter(Boolean);
    let busy = false, count = 0, started = false;
    const form = panel.querySelector("form");
    const byQ = new Map(faq.entries.map((e) => [e.q, e]));
    const topics = (cfg.topics || []).filter((t) => faq.entries.some((e) => e.topic === t));
    const toBottom = () => (log.scrollTop = log.scrollHeight);
    const toRow = (row) => (log.scrollTop = Math.max(0, row.offsetTop - 8));

    function botRow(content) { // returns the bubble; content may be text or a typing indicator
      const bub = el("div", { class: "bub" });
      if (typeof content === "string") content.split("\n\n").filter(Boolean).forEach((t, i) => bub.appendChild(el("div", { class: i ? "txt note2" : "txt", text: t })));
      else bub.appendChild(content);
      const row = el("div", { class: "row bot" }, [html("span", { class: "mini" }, crafty(19)), bub]);
      log.appendChild(row);
      return { row, bub };
    }
    function me(text) { log.appendChild(el("div", { class: "row me" }, [el("div", { class: "bub", text })])); toBottom(); }
    function cards(parent) {
      const box = el("div", { class: "cards" });
      const add = (icon, label, cls) => { const b = html("button", { class: "card " + (cls || ""), type: "button" }, ico(icon, 20) + "<span></span>"); b.querySelector("span").textContent = label; b.addEventListener("click", () => pick(label)); box.appendChild(b); };
      topics.forEach((t) => add(topicIcon(t), t));
      add(I.alert, PROBLEM, "wide");
      parent.appendChild(box);
    }
    function questions(list, parent) {
      const box = el("div", { class: "qs" });
      list.forEach((label) => { const b = html("button", { class: "q", type: "button" }, `<span></span>` + ico(I.arrow, 15)); b.firstChild.textContent = label; b.addEventListener("click", () => pick(label)); box.appendChild(b); });
      parent.appendChild(box);
    }
    const actions = (parent) => parent.querySelector(":scope > .actions") || parent.appendChild(el("div", { class: "actions" }));
    const humanLink = (parent, label, ghost) => { const a = html("a", { class: "btn" + (ghost ? " ghost" : ""), href: humanHref, target: "_blank", rel: "noopener" }, ico(I.contact, 16) + "<span></span>"); a.querySelector("span").textContent = label || "Talk to a person"; actions(parent).appendChild(a); };
    function feedback(parent, entry) {
      const box = el("div", { class: "fb" }, [el("span", { text: "Was this helpful?" })]);
      const yes = html("button", { type: "button" }, ico(I.thumbUp, 14) + " Yes"), no = html("button", { type: "button" }, ico(I.thumbDown, 14) + " No"), more = html("button", { type: "button" }, "More topics");
      yes.addEventListener("click", () => { box.textContent = "Glad that helped!"; });
      no.addEventListener("click", () => { box.remove(); const r = botRow(cfg.feedback_down || "Thanks for telling me. I don't keep feedback, so if an answer looks wrong, please let the owner know through the contact page."); humanLink(r.bub, "Tell the owner"); toRow(r.row); });
      more.addEventListener("click", () => { box.remove(); showTopics(); });
      box.append(yes, no, more);
      parent.appendChild(box);
    }
    function showTopics(text) { const r = botRow(text || "Pick a topic, or just type your question."); cards(r.bub); toRow(r.row); }

    function pick(label) {
      if (busy) return;
      if (label === PROBLEM) { me(label); respondLater(() => { const r = botRow("I'm sorry you're having trouble. What's going on?"); questions(problemEntries().map((e) => e.q), r.bub); humanLink(r.bub, "Talk to a person"); return r; }); return; }
      if (topics.includes(label)) { me(label); respondLater(() => { const r = botRow("Here's what I can help with about " + label.toLowerCase() + ":"); questions(faq.entries.filter((e) => e.topic === label).map((e) => e.q), r.bub); return r; }); }
      else if (byQ.has(label)) { me(label); respondLater(() => answer(byQ.get(label), [])); }
      else ask(label);
    }
    function answer(entry, related) {
      // Short first: long answers show two sentences with "Show more". Notices (like "checkout isn't live") are never hidden.
      const [main, ...notes] = answerText(entry, faq).split("\n\n");
      const sentences = main.match(/[^.!?]+[.!?]+(\s+|$)/g) || [main];
      const long = main.length > 260 && sentences.length > 2;
      const r = botRow("");
      const txt = el("div", { class: "txt", text: long ? sentences.slice(0, 2).join("").trim() : main });
      r.bub.appendChild(txt);
      if (long) {
        const more = el("button", { class: "showmore", type: "button", text: "Show more" });
        more.addEventListener("click", () => { txt.textContent = main; more.remove(); });
        r.bub.appendChild(more);
      }
      notes.forEach((n) => r.bub.appendChild(el("div", { class: "txt note2", text: n })));
      if (entry.link) { const a = html("a", { class: "btn ghost", href: url(entry.link.path), target: "_blank", rel: "noopener" }, "<span></span>" + ico(I.arrow, 14)); a.firstChild.textContent = entry.link.label || "Read the " + entry.link.text; actions(r.bub).appendChild(a); }
      if (related.length) { r.bub.appendChild(el("div", { class: "fb", text: "You might also want to know:" })); questions(related.map((x) => x.q), r.bub); }
      feedback(r.bub, entry);
      return r;
    }
    function reply(res) {
      if (res.type === "greeting") { const r = botRow(cfg.greeting); cards(r.bub); return r; }
      if (res.type === "thanks") return botRow(cfg.thanks || "You're welcome! Anything else I can help with?");
      if (res.type === "answer") return answer(res.entry, res.related);
      if (res.type === "clarify") { const r = botRow("I want to get this right. Did you mean one of these?"); questions(res.options.map((o) => o.q), r.bub); return r; }
      const r = botRow(res.reason === "sensitive" ? cfg.sensitive : res.reason === "unsupported" ? cfg.unsupported : cfg.handoff);
      humanLink(r.bub, "Talk to a person");
      if (res.suggestions && res.suggestions.length) { r.bub.appendChild(el("div", { class: "fb", text: "These might help:" })); questions(res.suggestions.map((e) => e.q), r.bub); }
      else if (res.reason !== "sensitive" && topics.length) cards(r.bub);
      return r;
    }
    function respondLater(make) { // shows a typing indicator, then the reply
      busy = true; input.disabled = true; send.disabled = true;
      const dots = botRow(html("span", { class: "dots", "aria-label": name + " is typing" }, "<i></i><i></i><i></i>")); toBottom();
      setTimeout(() => { dots.row.remove(); const r = make(); toRow(r.row); busy = false; input.disabled = false; send.disabled = false; if (!panel.hidden) input.focus(); }, opts.instant || reduce ? 0 : 550);
    }
    function ask(text) {
      text = String(text || "").trim().slice(0, MAX_LEN);
      if (!text || busy || ++count > 60) return;
      me(text);
      respondLater(() => reply(respond(text, faq)));
    }
    function start() { log.textContent = ""; count = 0; reply({ type: "greeting" }); }
    function open(show) {
      panel.hidden = !show; tip.hidden = true; fab.setAttribute("aria-expanded", String(show));
      fab.setAttribute("aria-label", show ? "Close chat" : "Chat with " + name);
      if (show) { if (!started) { started = true; start(); } input.focus(); } else fab.focus();
    }
    fab.addEventListener("click", () => open(panel.hidden));
    tip.addEventListener("click", () => open(true));
    head.querySelector(".close").addEventListener("click", () => open(false));
    head.querySelector(".restart").addEventListener("click", () => { if (!busy) { start(); input.focus(); } });
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") open(false); });
    form.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value; input.value = ""; ask(v); });
    document.body.appendChild(host);

    // Never sit on top of the site's own floating things (back-to-top, toasts, mobile bar, buy bar, cookie banner).
    let queued = false;
    function place() {
      const SIZE = 60, mobile = innerWidth <= 520, side = mobile ? 14 : 22, left = cfg.position === "left";
      const x0 = left ? side : innerWidth - side - SIZE, x1 = x0 + SIZE;
      let bottom = mobile ? 16 : 24;
      (cfg.avoid || []).forEach((sel) => {
        let nodes = []; try { nodes = document.querySelectorAll(sel); } catch (e) { /* bad selector */ }
        nodes.forEach((n) => {
          const cs = getComputedStyle(n);
          if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return;
          const r = n.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || r.right <= x0 || r.left >= x1 || r.top > innerHeight || r.bottom < innerHeight - 280) return;
          bottom = Math.max(bottom, innerHeight - r.top + 12);
        });
      });
      bottom = Math.min(bottom, Math.max(16, innerHeight - SIZE - 120));
      host.style.setProperty("--fab-bottom", bottom + "px");
      host.style.setProperty("--side", side + "px");
    }
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; place(); }); } };
    place();
    addEventListener("scroll", queue, { passive: true }); addEventListener("resize", queue);
    document.addEventListener("transitionend", queue, true);
    new MutationObserver(queue).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class", "style", "hidden"] });
    setInterval(place, 1000);

    if (opts.hideWhen) { // e.g. hide while the site shows its maintenance page
      const check = () => { try { host.style.display = document.querySelector(opts.hideWhen) ? "none" : ""; } catch (e) { /* bad selector */ } };
      check();
      new MutationObserver(check).observe(document.documentElement, { attributes: true });
    }
    if (cfg.tooltip !== false) setTimeout(() => { if (panel.hidden && host.style.display !== "none") { tip.hidden = false; setTimeout(() => (tip.hidden = true), 9000); } }, reduce ? 1500 : 3500);
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
      console.warn("Crafty support bot not started:", e.message); // the site keeps working without it
    }
  }
  return { respond, rank, tokens, answerText, mount, autoStart, params: P };
});
