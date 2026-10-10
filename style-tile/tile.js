/* Style tile behaviour: generated chain colours, live contrast report,
   verse rendering and the font-ready gate. Prototype only; no engine code. */
(function () {
  "use strict";
  const { chains: C, verse: V } = window.Rhymescape;
  const root = document.documentElement;
  const $ = (sel, scope = document) => scope.querySelector(sel);
  const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];

  const STOCKS = ["--paper", "--paper-raised", "--paper-sunk"];
  const MAX_CHAINS = 26;
  const WORDS = [
    "bars",
    "flow",
    "rhyme",
    "verse",
    "beat",
    "cadence",
    "scheme",
    "pocket",
    "spit",
    "double",
    "triple",
    "stack",
    "wrap",
    "switch",
    "bounce",
    "pause",
    "chain",
    "punch",
    "swing",
    "slant",
    "echo",
    "drop",
    "hook",
    "cipher",
    "lyric",
    "ink",
  ];

  const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();
  const tokenColor = (name) => C.parseOklch(cssVar(name));
  const svg = (name, attrs = {}) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  };

  /* ── Chain colours: regenerated whenever the stock changes ── */
  let chains = [];
  function regenerate() {
    chains = C.generateChains(
      MAX_CHAINS,
      STOCKS.map(tokenColor),
      tokenColor("--ink"),
    );
    C.applyChainVars(root, chains);
  }
  const chainStyle = (i) =>
    `--chain-ink: var(--chain-${i}-ink); --chain-wash: var(--chain-${i}-wash);`;
  const ratioText = (r) => r.toFixed(1) + ":1";

  /* ── Palette values + contrast report ───────────────── */
  function renderTokens() {
    $$("[data-swatches] [data-token]").forEach((li) => {
      const token = li.dataset.token;
      const val = $(".val", li);
      if (val) val.textContent = cssVar(token);
      const on = $("[data-on]", li);
      if (on)
        on.textContent =
          "ink on it " +
          ratioText(C.contrast(tokenColor("--on-fl"), tokenColor(token)));
    });
  }

  function renderContrast() {
    const rows = [];
    const add = (name, fg, bg, ratio) => rows.push({ name, fg, bg, ratio });
    const tc = tokenColor;
    add(
      "Ink on paper",
      "--ink",
      "--paper",
      C.contrast(tc("--ink"), tc("--paper")),
    );
    add(
      "Ink on raised sheet",
      "--ink",
      "--paper-raised",
      C.contrast(tc("--ink"), tc("--paper-raised")),
    );
    add(
      "Ink on sunk tray",
      "--ink",
      "--paper-sunk",
      C.contrast(tc("--ink"), tc("--paper-sunk")),
    );
    add(
      "Soft ink on paper",
      "--ink-soft",
      "--paper",
      C.contrast(tc("--ink-soft"), tc("--paper")),
    );
    add(
      "Soft ink on sunk tray",
      "--ink-soft",
      "--paper-sunk",
      C.contrast(tc("--ink-soft"), tc("--paper-sunk")),
    );
    [
      ["Hot pink", "--fl-pink"],
      ["Orange", "--fl-orange"],
      ["Yellow", "--fl-yellow"],
      ["Mint", "--fl-mint"],
      ["Blue", "--fl-blue"],
    ].forEach(([n, v]) =>
      add(
        `Print ink on ${n.toLowerCase()}`,
        "--on-fl",
        v,
        C.contrast(tc("--on-fl"), tc(v)),
      ),
    );
    chains
      .slice(0, 4)
      .forEach((c) =>
        add(
          `Chain ${c.label} ink, hardest stock`,
          `--chain-${c.index}-ink`,
          "--paper-sunk",
          c.inkRatio,
        ),
      );
    chains
      .slice(0, 4)
      .forEach((c) =>
        add(
          `Body ink on chain ${c.label} wash`,
          "--ink",
          `--chain-${c.index}-wash`,
          c.washRatio,
        ),
      );

    const ul = $("#contrast-report");
    ul.textContent = "";
    rows.forEach((r) => {
      const li = document.createElement("li");
      const grade = r.ratio >= 7 ? "AAA" : r.ratio >= 4.5 ? "AA" : "FAIL";
      li.innerHTML = `<span class="pair-chip" style="--fg: var(${r.fg}); --bg: var(${r.bg})" aria-hidden="true">Aa</span><span>${r.name}</span><span class="ratio">${ratioText(r.ratio)}</span><span class="badge${grade === "FAIL" ? " fail" : ""}">${grade}</span>`;
      ul.append(li);
    });
  }

  /* ── Chain colour engine list ───────────────────────── */
  function markerSvg(chain, cls) {
    const s = svg("svg", {
      class: cls,
      viewBox: "-7 -7 14 14",
      "aria-hidden": "true",
    });
    s.append(svg("path", { d: chain.marker.d }));
    return s;
  }
  function arcSample(chain) {
    const s = svg("svg", {
      class: "chain-arc",
      viewBox: "0 0 110 24",
      preserveAspectRatio: "xMinYMid meet",
      "aria-hidden": "true",
    });
    C.strokesFor(chain.lineStyle, C.arcPoints(3, 107, 21, 17)).forEach((st) => {
      const p = svg("path", {
        d: st.d,
        "stroke-width": st.width,
        "stroke-linecap": st.cap,
        "stroke-linejoin": "round",
      });
      if (st.dash) p.setAttribute("stroke-dasharray", st.dash);
      s.append(p);
    });
    return s;
  }
  function renderChains(n) {
    const list = $("#chain-list");
    list.textContent = "";
    chains.slice(0, n).forEach((c, k) => {
      const li = document.createElement("li");
      li.className = "chain";
      li.setAttribute(
        "style",
        `--k: ${k}; ${chainStyle(c.index)} --line-style: ${c.lineStyle};`,
      );
      const head = document.createElement("div");
      head.className = "chain-head";
      const letter = document.createElement("span");
      letter.className = "chain-letter";
      letter.textContent = c.label;
      head.append(markerSvg(c, "chain-mark"), letter, arcSample(c));
      const word = document.createElement("span");
      word.className = "chain-word";
      word.textContent = WORDS[c.index % WORDS.length];
      const meta = document.createElement("p");
      meta.className = "chain-meta";
      meta.innerHTML = `<b>${ratioText(c.inkRatio)}</b> ink · <b>${ratioText(c.washRatio)}</b> wash<br>${c.lineStyle} · ${c.marker.name} · ${Math.round(c.hue)}°`;
      li.append(head, word, meta);
      list.append(li);
    });
  }

  /* ── Verse ──────────────────────────────────────────── */
  const stage = $("#verse-stage");
  let pinned = null;

  function renderLegend() {
    const ul = $("#verse-legend");
    ul.textContent = "";
    V.VERSE.chains.forEach((def) => {
      const idx = def.id.charCodeAt(0) - 65;
      const c = chains[idx];
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "legend-chip";
      b.setAttribute("aria-pressed", String(pinned === def.id));
      b.setAttribute("style", chainStyle(idx));
      const m = markerSvg(c, "m");
      m.setAttribute("class", "m");
      const ltr = document.createElement("span");
      ltr.className = "ltr";
      ltr.textContent = def.id;
      const sound = document.createElement("span");
      sound.textContent = def.sound;
      const line = svg("svg", {
        viewBox: "0 0 44 20",
        width: 44,
        height: 20,
        "aria-hidden": "true",
      });
      line.style.width = "44px";
      C.strokesFor(c.lineStyle, C.arcPoints(2, 42, 17, 11)).forEach((st) => {
        const p = svg("path", {
          d: st.d,
          class: "l",
          "stroke-width": st.width,
          "stroke-linecap": st.cap,
        });
        if (st.dash) p.setAttribute("stroke-dasharray", st.dash);
        line.append(p);
      });
      b.append(m, ltr, sound, line);
      const show = () => V.solo(stage, def.id);
      const hide = () => V.solo(stage, pinned);
      b.addEventListener("pointerenter", show);
      b.addEventListener("pointerleave", hide);
      b.addEventListener("focus", show);
      b.addEventListener("blur", hide);
      b.addEventListener("click", () => {
        pinned = pinned === def.id ? null : def.id;
        $$(".legend-chip").forEach((el, i) =>
          el.setAttribute(
            "aria-pressed",
            String(pinned === V.VERSE.chains[i].id),
          ),
        );
        V.solo(stage, pinned);
      });
      li.append(b);
      ul.append(li);
    });
  }

  function drawVerse(animate) {
    V.draw(stage, chains, { animate });
    V.solo(stage, pinned);
  }

  let redrawQueued = false;
  new ResizeObserver(() => {
    if (redrawQueued || !root.classList.contains("fonts-ready")) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      drawVerse(false);
    });
  }).observe(stage);

  /* ── Render ─────────────────────────────────────────── */
  function renderAll(animateVerse) {
    renderTokens();
    renderContrast();
    renderChains(Number($("#chain-count").value));
    renderLegend();
    if (root.classList.contains("fonts-ready")) drawVerse(animateVerse);
  }

  /* ── Controls ───────────────────────────────────────── */
  const slider = $("#chain-count");
  slider.addEventListener("input", () => {
    $("#chain-count-out").textContent = slider.value;
    renderChains(Number(slider.value));
  });
  $("#verse-replay").addEventListener("click", () => drawVerse(true));
  $$(".demo").forEach((b) =>
    b.addEventListener("click", () => b.classList.toggle("is-run")),
  );

  /* ── Reveal on scroll ───────────────────────────────── */
  function initReveal() {
    const els = $$("[data-reveal]");
    els.forEach((el) => {
      const sibs = $$("[data-reveal]", el.parentElement).filter(
        (s) => s.parentElement === el.parentElement,
      );
      el.style.setProperty("--d", Math.max(0, sibs.indexOf(el)));
    });
    if (!("IntersectionObserver" in window))
      return els.forEach((el) => el.classList.add("is-in"));
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }),
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    els.forEach((el) => io.observe(el));
  }

  /* ── Fonts: the verse is measured, so wait before drawing ─ */
  async function waitForFonts() {
    const status = $("#font-status");
    const faces = [
      '450 15px "Martian Mono"',
      '740 15px "Martian Mono"',
      '800 64px "Bricolage Grotesque"',
      '420 17px "Bricolage Grotesque"',
    ];
    try {
      await Promise.all(
        faces.map((f) => document.fonts.load(f, "Aa Rhyme 0123")),
      );
      await document.fonts.ready;
    } catch (_) {
      /* fall through to the check below */
    }
    const ok = faces.every((f) => document.fonts.check(f));
    root.classList.add("fonts-ready");
    status.classList.toggle("is-ready", ok);
    $("span", status).textContent = ok
      ? "Fonts ready · 2 families"
      : "Fallback fonts";
    return ok;
  }

  /* ── Boot ───────────────────────────────────────────── */
  regenerate();
  V.build(stage);
  renderAll(false);
  initReveal();
  waitForFonts().then(() => {
    renderAll(true);
  });
  window.Rhymescape.tile = {
    get chains() {
      return chains;
    },
    regenerate,
  };
})();
