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
    const lex = new Map(); // every word the knowledge base knows, for spelling correction
    const addWords = (t) => (String(t).toLowerCase().replace(/[’']/g, "").match(/[a-z]{4,}/g) || []).forEach((w) => lex.set(w, (lex.get(w) || 0) + 1));
    faq.entries.forEach((e) => { addWords(e.q); (e.also || []).forEach(addWords); addWords(e.a); });
    GROUPS.forEach(([, re]) => addWords(re.source));
    const built = { docs, idf, oov: Math.log(1 + n), lex };
    cache.set(faq, built);
    return built;
  }

  // Edit distance where swapping two neighbouring letters counts as one mistake ("refudn" -> "refund").
  function osa(a, b, max) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > max) return max + 1;
    const d = [];
    for (let i = 0; i <= m; i++) d[i] = [i];
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
    }
    return d[m][n];
  }
  /** Fix likely typos using only words the knowledge base already knows. Short or known words are left alone. */
  function correct(text, faq) {
    const { lex } = index(faq);
    return String(text).replace(/[’']/g, "").replace(/[A-Za-z]{5,}/g, (w) => {
      const lw = w.toLowerCase();
      if (lex.has(lw) || STOP.has(lw)) return w;
      const max = lw.length >= 9 ? 2 : 1;
      let best = null, bd = max + 1, bf = 0;
      for (const [v, f] of lex) { const dist = osa(lw, v, max); if (dist < bd || (dist === bd && f > bf)) { best = v; bd = dist; bf = f; } }
      return best && bd <= max ? best : w;
    });
  }

  function rank(text, faq) {
    text = correct(text, faq);
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
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
    thumbUp: '<path d="M7 11v9H4v-9z"/><path d="M7 11l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.3 20H7"/>',
    thumbDown: '<path d="M17 13V4h3v9z"/><path d="M17 13l-4 8a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 6.7 4H17"/>',
  };
  const TOPIC_ICON = [/licens/i, "licensing", /refund/i, "refunds", /file|download/i, "files", /order|payment/i, "orders", /privacy|data/i, "privacy", /studio|contact/i, "contact"];
  const topicIcon = (t) => { for (let k = 0; k < TOPIC_ICON.length; k += 2) if (TOPIC_ICON[k].test(t)) return I[TOPIC_ICON[k + 1]]; return I.contact; };

  // Three avatars. Pick one with "avatar" in faq.json: "smile" (default), "rosette" or "support".
  const AV = {
    smile: (n) => `<svg class="crafty" width="${n}" height="${n}" viewBox="0 0 48 48" aria-hidden="true"><path d="M11 12h26a6.5 6.5 0 0 1 6.5 6.5v11A6.5 6.5 0 0 1 37 36H27.5L21 43l-1.2-7H11A6.5 6.5 0 0 1 4.5 29.5v-11A6.5 6.5 0 0 1 11 12z" fill="#0D0D0D"/><g class="eyes"><path d="M14.5 23.5q3.5-5 7 0M26.5 23.5q3.5-5 7 0" stroke="#F5C55A" stroke-width="2.8" fill="none" stroke-linecap="round"/></g><path d="M17 28.5q7 6.5 14 0" stroke="#F5C55A" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="13.2" cy="28" r="2" fill="#E8A020" opacity=".7"/><circle cx="34.8" cy="28" r="2" fill="#E8A020" opacity=".7"/><path class="spark" d="M39 1.5l1.7 4.1 4.1 1.7-4.1 1.7L39 13l-1.7-4.1-4.1-1.7 4.1-1.7z" fill="#0D0D0D"/></svg>`,
    rosette: (n) => `<svg class="crafty" width="${n}" height="${n}" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 3.5a20.5 20.5 0 1 1-9.4 38.7L5.5 45l3.1-8.6A20.5 20.5 0 0 1 24 3.5z" fill="#0D0D0D"/><g fill="#F5C55A">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<ellipse cx="24" cy="14" rx="3.3" ry="7.2" transform="rotate(${a} 24 24)"/>`).join("")}</g><circle cx="24" cy="24" r="4.4" fill="#0D0D0D"/><circle cx="24" cy="24" r="2" fill="#E8A020"/></svg>`,
    support: (n) => `<svg class="crafty" width="${n}" height="${n}" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="19" r="9.5" fill="#0D0D0D"/><path d="M13.5 8.5a10.6 10.6 0 0 1 21 0" stroke="#0D0D0D" stroke-width="2.6" fill="none" stroke-linecap="round"/><rect x="8.8" y="16" width="5" height="8.5" rx="2.5" fill="#0D0D0D"/><rect x="34.2" y="16" width="5" height="8.5" rx="2.5" fill="#0D0D0D"/><path d="M36.5 24.5v3.5q0 3-4 3h-4" stroke="#0D0D0D" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="27.5" cy="31" r="1.9" fill="#0D0D0D"/><circle cx="20.5" cy="18.5" r="1.5" fill="#F5C55A"/><circle cx="27.5" cy="18.5" r="1.5" fill="#F5C55A"/><path d="M20.5 22.2q3.5 2.8 7 0" stroke="#F5C55A" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M12.5 44c0-6.4 5.1-10 11.5-10s11.5 3.6 11.5 10z" fill="#0D0D0D"/></svg>`,
  };
  let AVATAR = "smile";
  const crafty = (n) => AV[AVATAR](n);

  const CSS = `
:host{all:initial;--gold:#E8A020;--ink:#0D0D0D;--head:#0D0D0D;--panel:#1A1A1A;--bot:#252525;--chip:#252525;--input:#0D0D0D;--text:#F5F1E8;--muted:#A9A397;--line:#303030;--link:#F5C55A;--side:22px;--fab-bottom:24px;--sh:0 20px 60px rgba(0,0,0,.55)}
:host([data-theme=light]){--panel:#FAFAF7;--bot:#fff;--chip:#fff;--input:#fff;--text:#1C1C1A;--muted:#6E6A64;--line:#E2DED8;--link:#8C5E00;--sh:0 20px 60px rgba(0,0,0,.22)}
*{box-sizing:border-box}button,a,input,select,textarea{font:inherit}
.fab{position:fixed;right:var(--side);bottom:calc(var(--fab-bottom) + env(safe-area-inset-bottom,0px));z-index:2147483000;width:60px;height:60px;border-radius:50%;border:0;background:radial-gradient(circle at 30% 25%,#F5C55A,#E8A020 62%);color:var(--ink);cursor:pointer;display:grid;place-items:center;box-shadow:0 8px 28px rgba(0,0,0,.4),0 0 0 3px rgba(232,160,32,.25);transition:bottom .2s ease,transform .15s ease;animation:ring 2.4s ease-out 3 2.5s}
@keyframes ring{0%{box-shadow:0 8px 28px rgba(0,0,0,.4),0 0 0 3px rgba(232,160,32,.25),0 0 0 0 rgba(232,160,32,.55)}100%{box-shadow:0 8px 28px rgba(0,0,0,.4),0 0 0 3px rgba(232,160,32,.25),0 0 0 20px rgba(232,160,32,0)}}
:host([data-pos=left]) .fab,:host([data-pos=left]) .tip{right:auto;left:var(--side)}
.fab:hover{transform:scale(1.06)}.fab:focus-visible,button:focus-visible,input:focus-visible,a:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.fab .crafty{width:42px;height:42px}.fab .x{display:none}.fab[aria-expanded=true] .crafty{display:none}.fab[aria-expanded=true] .x{display:block}
.eyes{transform-box:fill-box;transform-origin:center;animation:blink 5.5s infinite}.spark{transform-box:fill-box;transform-origin:center;animation:tw 2.8s ease-in-out infinite}
@keyframes blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.15)}}@keyframes tw{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}
.tip{position:fixed;right:var(--side);bottom:calc(var(--fab-bottom) + 72px + env(safe-area-inset-bottom,0px));z-index:2147483000;max-width:240px;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:14px 14px 4px 14px;padding:10px 14px;box-shadow:var(--sh);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Inter,sans-serif;cursor:pointer;text-align:left;transition:bottom .2s ease}
.tip[hidden],.panel[hidden]{display:none}
.panel{position:fixed;right:var(--side);bottom:calc(var(--fab-bottom) + 72px + env(safe-area-inset-bottom,0px));z-index:2147483000;width:min(396px,calc(100vw - 24px));height:min(640px,calc(100vh - var(--fab-bottom) - 96px));background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:22px;box-shadow:var(--sh);display:flex;flex-direction:column;overflow:hidden;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Inter,sans-serif;transition:bottom .2s ease}
:host([data-pos=left]) .panel{right:auto;left:var(--side)}
header{background:var(--head);color:#F5F1E8;padding:12px 12px 12px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #303030}
.av{flex:none;width:38px;height:38px;border-radius:50%;background:radial-gradient(circle at 30% 25%,#F5C55A,#E8A020 62%);display:grid;place-items:center}.av .crafty{width:28px;height:28px}
.ttl{flex:1;min-width:0}.ttl b{display:block;font-weight:600;font-size:16px;line-height:1.2}.ttl small{display:block;color:#F5F1E8;opacity:.72;font-size:12px;line-height:1.3}
.hb{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:10px;border:0;background:transparent;color:#F5F1E8;cursor:pointer;text-decoration:none}.hb:hover{background:#252525}
.log{position:relative;flex:1;overflow-y:auto;padding:14px 14px 16px;display:flex;flex-direction:column;gap:12px;scroll-behavior:smooth;scrollbar-width:thin;scrollbar-color:#4a4a4a transparent}
.log::-webkit-scrollbar{width:8px}.log::-webkit-scrollbar-thumb{background:#4a4a4a;border-radius:8px}.log::-webkit-scrollbar-track{background:transparent}
:host([data-theme=light]) .log{scrollbar-color:#c9c4bb transparent}:host([data-theme=light]) .log::-webkit-scrollbar-thumb{background:#c9c4bb}
.row{display:flex;gap:8px;align-items:flex-start}.row.me{justify-content:flex-end}.row .mini{flex:none;width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 30% 25%,#F5C55A,#E8A020 62%);display:grid;place-items:center}.row .mini .crafty{width:19px;height:19px}
.bub{max-width:88%;padding:10px 13px;border-radius:16px;word-wrap:break-word}.txt{white-space:pre-wrap}.txt+.txt{margin-top:8px}.note2{font-size:13.5px;color:var(--muted)}
.bot .bub{background:var(--bot);border:1px solid var(--line);border-bottom-left-radius:5px}.me .bub{background:var(--gold);color:var(--ink);border-bottom-right-radius:5px;font-weight:500;white-space:pre-wrap}
.showmore{display:block;margin-top:6px;border:0;background:none;color:var(--link);cursor:pointer;padding:2px 0;font-weight:600;font-size:13px}.showmore:hover{text-decoration:underline}
.dots{display:inline-flex;gap:4px;padding:5px 2px}.dots i{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:b 1s infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
@keyframes b{0%,60%,100%{transform:none;opacity:.5}30%{transform:translateY(-4px);opacity:1}}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.card{display:flex;align-items:center;gap:8px;text-align:left;border:1px solid var(--line);background:var(--chip);color:var(--text);border-radius:12px;padding:10px;cursor:pointer;font-size:13.5px;line-height:1.25}.card:hover,.q:hover{border-color:var(--gold)}.card svg{flex:none;color:var(--gold)}
.card.wide{grid-column:1/-1;border-color:var(--gold);background:rgba(232,160,32,.1)}
.qs{display:flex;flex-direction:column;gap:6px;margin-top:10px}.q{display:flex;justify-content:space-between;align-items:center;gap:8px;text-align:left;border:1px solid var(--line);background:var(--chip);color:var(--text);border-radius:12px;padding:9px 12px;cursor:pointer;font-size:13.5px;line-height:1.3}.q svg{flex:none;color:var(--gold)}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.btn{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:8px 16px;font-weight:600;font-size:14px;line-height:1.2;text-decoration:none;border:1px solid var(--gold);background:var(--gold);color:var(--ink);cursor:pointer}.btn:hover{filter:brightness(1.08)}
.btn.ghost{background:transparent;color:var(--link)}.btn.ghost:hover{background:rgba(232,160,32,.12);filter:none}
.fb{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:10px;font-size:12.5px;color:var(--muted)}.fb button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:transparent;color:var(--text);border-radius:999px;padding:4px 10px;cursor:pointer;font-size:12.5px}.fb button:hover{border-color:var(--gold)}
.cmp{display:flex;flex-direction:column;gap:10px;margin-top:10px}.cmp label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted)}
.cmp input,.cmp select,.cmp textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--input);color:var(--text);font-size:14px;outline:none}.cmp textarea{resize:vertical;min-height:84px}
.cmp input:focus,.cmp select:focus,.cmp textarea:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(232,160,32,.28)}
.err{color:#FF8A7A;font-size:13px}.err:empty{display:none}:host([data-theme=light]) .err{color:#B42318}
.out{width:100%;margin-top:10px;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--input);color:var(--text);font-size:13.5px;line-height:1.45;resize:vertical;min-height:200px}
.sug{display:flex;flex-direction:column;gap:6px;padding:8px 12px 0;background:var(--panel);border-top:1px solid var(--line)}.sug[hidden]{display:none}
.sq{display:flex;justify-content:space-between;align-items:center;gap:8px;text-align:left;border:1px solid var(--line);background:var(--chip);color:var(--text);border-radius:10px;padding:7px 11px;cursor:pointer;font-size:13px;line-height:1.3}.sq:hover{border-color:var(--gold)}.sq svg{flex:none;color:var(--gold)}
.chatform{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line);background:var(--panel)}
.sug:not([hidden])+.chatform{border-top:0}
.chatform input{flex:1;min-width:0;border:1px solid var(--line);border-radius:999px;padding:10px 15px;outline:none;background:var(--input);color:var(--text)}.chatform input::placeholder{color:var(--muted)}.chatform input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(232,160,32,.28)}.chatform input:disabled{opacity:.6}
.send{flex:none;border:0;border-radius:999px;background:var(--gold);color:var(--ink);font-weight:700;padding:0 18px;cursor:pointer}.send:disabled{opacity:.5;cursor:default}
.note{padding:0 14px 10px;font-size:11.5px;line-height:1.4;color:var(--muted);background:var(--panel)}
@media (prefers-reduced-motion:no-preference){.row{animation:in .2s ease-out}@keyframes in{from{opacity:0;transform:translateY(5px)}}}
@media (prefers-reduced-motion:reduce){.eyes,.spark,.dots i,.fab{animation:none}.log{scroll-behavior:auto}.fab,.tip,.panel{transition:none}}
@media (max-width:520px){.panel{left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom,0px));width:auto;height:min(680px,calc(100dvh - 16px - env(safe-area-inset-bottom,0px)))}:host([data-pos=left]) .panel{left:8px}.fab[aria-expanded=true]{display:none}}`;

  function el(tag, props, children) {
    const n = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => (k === "text" ? (n.textContent = v) : n.setAttribute(k, v)));
    (children || []).forEach((c) => n.appendChild(c));
    return n;
  }
  const html = (tag, props, inner) => { const n = el(tag, props); n.innerHTML = inner; return n; }; // inner is always trusted, built-in markup

  // What the message helper offers. [what the customer sees, the subject to pick on the contact page]
  const ISSUES = [
    ["A problem with a file", "Technical issue"], ["I can't find my download", "Technical issue"],
    ["I was charged twice, or a billing question", "Billing"], ["A refund question", "General enquiry"],
    ["A licensing question", "Licensing question"], ["A custom design request", "Custom design request"], ["Something else", "General enquiry"],
  ];
  const PRESET = { "file-problem": 0, "my-downloads": 1, duplicate: 2, chargeback: 2, refund: 3, "refund-no": 3, "refund-license": 3, "commercial-use": 4, "resell-file": 4, "custom-design": 5 };
  const looksLikeCard = (t) => /(?:\d[ -]?){13,19}/.test(t);
  function composeMessage(f) {
    return ["Subject: " + f.subject, "About: " + f.topic, "Order number: " + (f.order || "not sure"), f.product ? "Design: " + f.product : null, "", f.details, "", "(Written with the Crafty help assistant on craftshan.studio)"].filter((l) => l !== null).join("\n");
  }

  function mount(faq, opts) {
    opts = opts || {};
    const cfg = faq.config, name = cfg.bot_name || "Crafty";
    AVATAR = AV[cfg.avatar] ? cfg.avatar : "smile";
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
    const tip = el("button", { class: "tip", type: "button", hidden: "", text: cfg.tooltip || "Hi, I'm " + name + "! How can I help you today?" });
    const log = el("div", { class: "log", role: "log", "aria-live": "polite", "aria-label": "Conversation with " + name });
    const input = el("input", { type: "text", maxlength: String(MAX_LEN), "aria-label": "Your question", placeholder: "Ask " + name + " a question…", autocomplete: "off", enterkeyhint: "send" });
    const send = el("button", { class: "send", type: "submit", text: "Send" });
    const sug = el("div", { class: "sug", "aria-label": "Suggested questions", hidden: "" });
    const humanHref = url(cfg.contact_path || "/Contact/");
    const head = el("header", {}, [
      html("span", { class: "av" }, crafty(28)),
      el("div", { class: "ttl" }, [el("b", { text: name }), el("small", { text: "Automated assistant" })]),
      html("a", { class: "hb", href: humanHref, target: "_blank", rel: "noopener", "aria-label": "Contact the owner (opens in a new tab)", title: "Talk to a person" }, ico(I.contact, 19)),
      html("button", { class: "hb restart", type: "button", "aria-label": "Start over", title: "Start over" }, ico(I.restart, 18)),
      html("button", { class: "hb close", type: "button", "aria-label": "Close chat", title: "Close" }, ico(I.close, 20)),
    ]);
    const form = el("form", { class: "chatform" }, [input, send]);
    const panel = el("section", { class: "panel", role: "dialog", "aria-label": name + ", Craftshan Studio help chat", hidden: "" }, [
      head, log, sug, form,
      el("div", { class: "note", text: "Automated answers from our published policies, not legal advice. Please don't share card numbers or passwords. Nothing you type is saved." }),
    ]);
    root.append(panel, tip, fab);

    const PROBLEM = "I have a problem";
    const problemEntries = () => (cfg.problems || ["file-problem", "my-downloads", "duplicate", "refund", "chargeback"]).map((id) => faq.entries.find((e) => e.id === id)).filter(Boolean);
    const rt = () => (cfg.response_time ? "\n\nWe usually reply " + cfg.response_time + "." : "");
    let busy = false, count = 0, started = false;
    const byQ = new Map(faq.entries.map((e) => [e.q, e]));
    const topics = (cfg.topics || []).filter((t) => faq.entries.some((e) => e.topic === t));
    const toBottom = () => (log.scrollTop = log.scrollHeight);
    const toRow = (row) => (log.scrollTop = Math.max(0, row.offsetTop - 8));
    const pageHint = () => { // different suggestions on the cart, account and product pages
      const here = (location.pathname + location.search + location.hash).toLowerCase();
      for (const h of cfg.page_hints || []) { try { if (new RegExp(h.match, "i").test(here)) return h; } catch (e) { /* bad pattern */ } }
      return null;
    };

    function botRow(content) {
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
      list.forEach((label) => { const b = html("button", { class: "q", type: "button" }, "<span></span>" + ico(I.arrow, 15)); b.firstChild.textContent = label; b.addEventListener("click", () => pick(label)); box.appendChild(b); });
      parent.appendChild(box);
    }
    const actions = (parent) => parent.querySelector(":scope > .actions") || parent.appendChild(el("div", { class: "actions" }));
    const humanLink = (parent, label, ghost) => { const a = html("a", { class: "btn" + (ghost ? " ghost" : ""), href: humanHref, target: "_blank", rel: "noopener" }, ico(I.contact, 16) + "<span></span>"); a.querySelector("span").textContent = label || "Talk to a person"; actions(parent).appendChild(a); };
    const writeBtn = (parent, preset) => { const b = html("button", { class: "btn ghost", type: "button" }, ico(I.pen, 16) + "<span>Write my message</span>"); b.addEventListener("click", () => { if (!busy) composer(preset); }); actions(parent).appendChild(b); };

    // The message helper: builds a complete message locally. Nothing is sent or saved anywhere.
    function composer(preset) {
      const r = botRow("Let's put your message together. It stays on your device: I'll write a ready-to-send text that you copy into our contact form.");
      const form = el("form", { class: "cmp", novalidate: "" });
      const field = (label, node) => el("label", {}, [el("span", { text: label }), node]);
      const topic = el("select", { "aria-label": "What is it about?" });
      ISSUES.forEach(([t], i) => topic.appendChild(el("option", { value: String(i), text: t })));
      if (preset != null) topic.value = String(preset);
      const order = el("input", { type: "text", maxlength: "40", placeholder: "For example 12345", autocomplete: "off" });
      const product = el("input", { type: "text", maxlength: "80", autocomplete: "off" });
      const details = el("textarea", { maxlength: "600", rows: "4", placeholder: "What happened, and what did you expect?" });
      const err = el("div", { class: "err", role: "alert" });
      form.append(field("What is it about?", topic), field("Order number (if you have one)", order), field("Design name (optional)", product), field("What happened?", details), err, el("button", { class: "btn", type: "submit", text: "Create my message" }));
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const f = { subject: ISSUES[+topic.value][1], topic: ISSUES[+topic.value][0], order: order.value.trim(), product: product.value.trim(), details: details.value.trim() };
        if (f.details.length < 10) { err.textContent = "Please tell us a little more about what happened."; details.focus(); return; }
        if (looksLikeCard(f.order + " " + f.product + " " + f.details)) { err.textContent = "That looks like a card number. Please remove it. We never need card details."; return; }
        const text = composeMessage(f);
        form.remove();
        const box = el("textarea", { class: "out", readonly: "", "aria-label": "Your message", rows: "10" });
        box.value = text;
        r.bub.appendChild(el("div", { class: "txt note2", text: "Here's your message. Copy it, open the contact page, choose the subject \"" + f.subject + "\" and paste it in." }));
        r.bub.appendChild(box);
        const copy = html("button", { class: "btn", type: "button" }, ico(I.copy, 16) + "<span>Copy message</span>");
        copy.addEventListener("click", async () => {
          let ok = false;
          try { await navigator.clipboard.writeText(text); ok = true; } catch (e1) { box.focus(); box.select(); try { ok = document.execCommand("copy"); } catch (e2) { ok = false; } }
          copy.querySelector("span").textContent = ok ? "Copied!" : "Press Ctrl+C to copy";
        });
        const open = html("a", { class: "btn ghost", href: humanHref, target: "_blank", rel: "noopener" }, ico(I.contact, 16) + "<span>Open the contact page</span>");
        r.bub.appendChild(el("div", { class: "actions" }, [copy, open]));
        r.bub.appendChild(el("div", { class: "txt note2", text: "Please don't add passwords or card numbers." }));
        toBottom();
      });
      r.bub.appendChild(form);
      toRow(r.row);
      setTimeout(() => (preset == null ? topic : details).focus(), 50);
    }

    function feedback(parent) {
      const box = el("div", { class: "fb" }, [el("span", { text: "Was this helpful?" })]);
      const yes = html("button", { type: "button" }, ico(I.thumbUp, 14) + " Yes"), no = html("button", { type: "button" }, ico(I.thumbDown, 14) + " No"), more = html("button", { type: "button" }, "More topics");
      yes.addEventListener("click", () => { box.textContent = "Glad that helped!"; });
      no.addEventListener("click", () => { box.remove(); const r = botRow((cfg.feedback_down || "Thanks for telling me. I don't keep feedback, so if an answer looks wrong, please let the owner know.") + rt()); humanLink(r.bub, "Tell the owner"); writeBtn(r.bub); toRow(r.row); });
      more.addEventListener("click", () => { box.remove(); const r = botRow("Pick a topic, or just type your question."); cards(r.bub); toRow(r.row); });
      box.append(yes, no, more);
      parent.appendChild(box);
    }
    function pick(label) {
      if (busy) return;
      if (label === PROBLEM) { me(label); respondLater(() => { const r = botRow("I'm sorry you're having trouble. What's going on?"); questions(problemEntries().map((e) => e.q), r.bub); humanLink(r.bub, "Talk to a person"); writeBtn(r.bub); return r; }); return; }
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
      if (entry.link && entry.link.path === (cfg.contact_path || "/Contact/")) writeBtn(r.bub, PRESET[entry.id]);
      if (related.length) { r.bub.appendChild(el("div", { class: "fb", text: "You might also want to know:" })); questions(related.map((x) => x.q), r.bub); }
      feedback(r.bub);
      return r;
    }
    function greeting() {
      const r = botRow(cfg.greeting);
      const h = pageHint();
      const list = h ? h.ids.map((id) => faq.entries.find((e) => e.id === id)).filter(Boolean) : [];
      if (list.length) { r.bub.appendChild(el("div", { class: "fb", text: h.title })); questions(list.map((e) => e.q), r.bub); }
      cards(r.bub);
      return r;
    }
    function reply(res) {
      if (res.type === "greeting") return greeting();
      if (res.type === "thanks") return botRow(cfg.thanks || "You're welcome! Is there anything else I can help with?");
      if (res.type === "answer") return answer(res.entry, res.related);
      if (res.type === "clarify") { const r = botRow("I want to get this right. Did you mean one of these?"); questions(res.options.map((o) => o.q), r.bub); return r; }
      const r = botRow((res.reason === "sensitive" ? cfg.sensitive : res.reason === "unsupported" ? cfg.unsupported : cfg.handoff) + rt());
      humanLink(r.bub, "Talk to a person"); writeBtn(r.bub);
      if (res.suggestions && res.suggestions.length) { r.bub.appendChild(el("div", { class: "fb", text: "These might help:" })); questions(res.suggestions.map((e) => e.q), r.bub); }
      else if (res.reason !== "sensitive" && topics.length) cards(r.bub);
      return r;
    }
    function respondLater(make) { // shows a typing indicator, then the reply
      busy = true; input.disabled = true; send.disabled = true; sug.hidden = true;
      const dots = botRow(html("span", { class: "dots", "aria-label": name + " is typing" }, "<i></i><i></i><i></i>")); toBottom();
      setTimeout(() => { dots.row.remove(); const r = make(); toRow(r.row); busy = false; input.disabled = false; send.disabled = false; if (!panel.hidden) input.focus(); }, opts.instant || reduce ? 0 : 550);
    }
    function ask(text) {
      text = String(text || "").trim().slice(0, MAX_LEN);
      if (!text || busy || ++count > 60) return;
      me(text);
      respondLater(() => reply(respond(text, faq)));
    }
    function start() { log.textContent = ""; sug.hidden = true; count = 0; greeting(); }
    function open(show) {
      panel.hidden = !show; tip.hidden = true; fab.setAttribute("aria-expanded", String(show));
      fab.setAttribute("aria-label", show ? "Close chat" : "Chat with " + name);
      if (show) { if (!started) { started = true; start(); } input.focus(); } else fab.focus();
    }
    // Suggestions while typing: matching questions appear above the box, so customers can tap instead of finishing.
    let sugTimer;
    function updateSug() {
      const v = input.value.trim(); sug.textContent = "";
      if (v.length < 3 || busy) { sug.hidden = true; return; }
      const hits = rank(v, faq).filter((r) => r.score >= P.clarify).slice(0, 3);
      hits.forEach((h) => { const b = html("button", { class: "sq", type: "button" }, "<span></span>" + ico(I.arrow, 14)); b.firstChild.textContent = h.entry.q; b.addEventListener("click", () => { input.value = ""; sug.hidden = true; pick(h.entry.q); }); sug.appendChild(b); });
      sug.hidden = hits.length === 0;
    }
    input.addEventListener("input", () => { clearTimeout(sugTimer); sugTimer = setTimeout(updateSug, 120); });
    fab.addEventListener("click", () => open(panel.hidden));
    tip.addEventListener("click", () => open(true));
    head.querySelector(".close").addEventListener("click", () => open(false));
    head.querySelector(".restart").addEventListener("click", () => { if (!busy) { start(); input.focus(); } });
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") open(false); });
    form.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value; input.value = ""; sug.hidden = true; ask(v); });
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
  return { respond, rank, tokens, correct, answerText, mount, autoStart, params: P };
});
