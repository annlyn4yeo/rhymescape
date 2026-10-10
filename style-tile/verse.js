/* Sample verse for the style tile: builds the beat grid and draws mock rhyme arcs.
   Mock data only. The real engine is not touched here.

   Verse DSL, one string per bar, exactly 16 slots (4 beats x 4 sixteenths):
     .        rest
     !word    stressed syllable
     word:A   syllable belongs to rhyme chain A
     word/    syllable continues into the next slot (same word)
*/
(function (global) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const { LINE_STYLES, strokesFor, arcPoints, routePoints } =
    global.Rhymescape.chains;

  const VERSE = {
    title: "Arc in the Dark",
    bpm: 90,
    chains: [
      { id: "A", sound: "-ark" },
      { id: "B", sound: "-ow" },
      { id: "C", sound: "-able" },
      { id: "D", sound: "-ime" },
    ],
    bars: [
      "!Mid/ night !ink . I'm !draw/ ing ev/ ry !arc:A in the !dark:A . . .",
      "!Slow:B the !flow:B . let the !beat . !show:B where the !pulse !goes:B . . .",
      "!Syl/ la:C/ ble:C . !stack/ a:C/ ble:C . backed up un/ !break/ a:C/ ble:C . .",
      "!Rhyme:D on the !line:D . !climb:D in !time:D ev/ ry !mark:A is !mine:D . . .",
    ],
  };

  const COUNT = ["1", "e", "&", "a"];
  const chainIndex = (id) => id.charCodeAt(0) - 65;

  function parseBar(str) {
    const tokens = str.trim().split(/\s+/);
    if (tokens.length !== 16)
      throw new Error(`Bar needs 16 slots, got ${tokens.length}: ${str}`);
    return tokens.map((tok) => {
      if (tok === ".") return { rest: true };
      let t = tok;
      const stress = t.startsWith("!");
      if (stress) t = t.slice(1);
      const join = t.endsWith("/");
      if (join) t = t.slice(0, -1);
      const [text, chain] = t.split(":");
      return { text, stress, join, chain: chain || null };
    });
  }

  const svgEl = (name, attrs) => {
    const el = document.createElementNS(NS, name);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  };

  function build(stage) {
    stage.textContent = "";
    const head = document.createElement("div");
    head.className = "beat-head";
    head.setAttribute("aria-hidden", "true");
    head.innerHTML =
      '<span class="bar-no"></span><span class="cells">' +
      Array.from(
        { length: 16 },
        (_, i) =>
          `<span class="cell" data-beat="${i >> 2}" data-count="${i % 4 === 0 ? "beat" : "sub"}">${i % 4 === 0 ? (i >> 2) + 1 : COUNT[i % 4]}</span>`,
      ).join("") +
      "</span>";
    stage.append(head);

    VERSE.bars.forEach((str, b) => {
      const slots = parseBar(str);
      const row = document.createElement("div");
      row.className = "bar";
      row.setAttribute("role", "group");
      row.setAttribute(
        "aria-label",
        `Bar ${b + 1}: ` +
          slots
            .filter((s) => !s.rest)
            .map((s) => s.text + (s.join ? "" : " "))
            .join("")
            .replace(/\s+/g, " ")
            .trim(),
      );
      const no = document.createElement("span");
      no.className = "bar-no";
      no.textContent = String(b + 1).padStart(2, "0");
      const cells = document.createElement("span");
      cells.className = "cells";
      slots.forEach((s, i) => {
        const cell = document.createElement("span");
        cell.className = "cell";
        cell.dataset.beat = String(i >> 2);
        cell.dataset.slot = String(i);
        if (s.rest) {
          cell.classList.add("rest");
        } else {
          if (s.join) cell.dataset.join = "";
          const syl = document.createElement("span");
          syl.className = "syl";
          syl.textContent = s.text;
          if (s.stress) syl.dataset.stress = "";
          if (s.chain) {
            const prev = slots[i - 1];
            const next = slots[i + 1];
            const samePrev = prev && prev.chain === s.chain;
            const sameNext = next && next.chain === s.chain;
            syl.dataset.chain = s.chain;
            syl.dataset.pos = samePrev
              ? sameNext
                ? "mid"
                : "end"
              : sameNext
                ? "start"
                : "solo";
            syl.dataset.line =
              LINE_STYLES[chainIndex(s.chain) % LINE_STYLES.length];
            syl.style.setProperty(
              "--chain-ink",
              `var(--chain-${chainIndex(s.chain)}-ink)`,
            );
            syl.style.setProperty(
              "--chain-wash",
              `var(--chain-${chainIndex(s.chain)}-wash)`,
            );
          }
          cell.append(syl);
        }
        cells.append(cell);
      });
      row.append(no, cells);
      stage.append(row);
    });

    stage.append(
      svgEl("svg", {
        class: "verse-svg",
        "aria-hidden": "true",
        focusable: "false",
      }),
    );
  }

  /* Group adjacent same-chain syllables of one bar into one member of the chain. */
  function collectMembers(stage, chains) {
    const sr = stage.getBoundingClientRect();
    const byChain = new Map();
    stage.querySelectorAll(".bar").forEach((row, bar) => {
      let current = null;
      row.querySelectorAll(".syl").forEach((syl) => {
        const id = syl.dataset.chain;
        const r = syl.getBoundingClientRect();
        const box = {
          l: r.left - sr.left,
          r: r.right - sr.left,
          t: r.top - sr.top,
          b: r.bottom - sr.top,
        };
        if (!id) {
          current = null;
          return;
        }
        if (
          current &&
          current.id === id &&
          syl.dataset.pos !== "start" &&
          syl.dataset.pos !== "solo"
        ) {
          current.r = box.r;
          current.els.push(syl);
          return;
        }
        current = { id, bar, l: box.l, r: box.r, t: box.t, els: [syl] };
        if (!byChain.has(id)) byChain.set(id, []);
        byChain.get(id).push(current);
      });
    });
    return byChain;
  }

  function draw(stage, chains, { animate = true } = {}) {
    const svg = stage.querySelector(".verse-svg");
    const sr = stage.getBoundingClientRect();
    svg.textContent = "";
    svg.classList.remove("is-drawn", "settled", "no-anim");
    clearTimeout(svg._settle);
    svg.setAttribute("width", sr.width);
    svg.setAttribute("height", sr.height);
    svg.setAttribute("viewBox", `0 0 ${sr.width} ${sr.height}`);

    const members = collectMembers(stage, chains);
    const gridRight = Math.max(
      ...[...stage.querySelectorAll(".bar .cells")].map(
        (c) => c.getBoundingClientRect().right - sr.left,
      ),
    );
    const arcLayer = svgEl("g");
    const markerLayer = svgEl("g");
    svg.append(arcLayer, markerLayer);
    let order = 0;

    [...members.entries()].forEach(([id, list]) => {
      const idx = chainIndex(id);
      const chain = chains[idx];
      const style = `--chain-ink: var(--chain-${idx}-ink)`;

      list.forEach((m, k) => {
        const cx = (m.l + m.r) / 2;
        const my = m.t - 11;
        const g = svgEl("g", {
          class: "marker",
          "data-chain": id,
          style,
          transform: `translate(${cx.toFixed(1)} ${my.toFixed(1)})`,
        });
        g.style.setProperty("--i", order);
        g.append(svgEl("path", { d: chain.marker.d }));
        if (k === 0) {
          const tag = svgEl("g", {
            class: "tag",
            transform: "translate(-24 0)",
          });
          tag.append(
            svgEl("rect", { x: -7.5, y: -7.5, width: 15, height: 15, rx: 4.5 }),
          );
          const t = svgEl("text", {
            y: 0.5,
            "text-anchor": "middle",
            "dominant-baseline": "central",
          });
          t.textContent = id;
          tag.append(t);
          g.append(tag);
        }
        markerLayer.append(g);

        const next = list[k + 1];
        if (!next) return;
        const nx = (next.l + next.r) / 2;
        const y1 = m.t - 17;
        let pts;
        if (next.bar === m.bar) {
          const dx = Math.abs(nx - cx);
          pts = arcPoints(cx, nx, y1, Math.min(10 + dx * 0.12, 30));
        } else {
          const gutter = gridRight + 22 + idx * 11;
          const y2 = next.t - 17;
          pts = routePoints(
            [
              [cx, y1],
              [cx, y1 - 32 - idx * 5],
              [gutter, y1 - 32 - idx * 5],
              [gutter, y2 - 40 - idx * 5],
              [nx, y2 - 40 - idx * 5],
              [nx, y2],
            ],
            14,
          );
        }
        const arc = svgEl("g", {
          class: "arc",
          "data-chain": id,
          "data-style": chain.lineStyle,
          style,
        });
        arc.style.setProperty("--i", order++);
        strokesFor(chain.lineStyle, pts).forEach((s) => {
          const p = svgEl("path", {
            d: s.d,
            "stroke-width": s.width,
            "stroke-linecap": s.cap,
            "stroke-linejoin": "round",
            fill: "none",
          });
          if (s.dash) p.setAttribute("stroke-dasharray", s.dash);
          arc.append(p);
        });
        arcLayer.append(arc);
      });
    });

    // Two frames: first paint the hidden state, then release it so the transition runs.
    if (animate)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => svg.classList.add("is-drawn")),
      );
    else svg.classList.add("is-drawn", "no-anim", "settled");
    if (animate)
      svg._settle = setTimeout(() => svg.classList.add("settled"), 2200);
  }

  /* Focus one chain: dim every other chain's syllables, markers and arcs. */
  function solo(stage, id) {
    stage.classList.toggle("has-solo", Boolean(id));
    stage
      .querySelectorAll("[data-chain]")
      .forEach((el) =>
        el.classList.toggle("is-dim", Boolean(id) && el.dataset.chain !== id),
      );
  }

  global.Rhymescape.verse = { VERSE, build, draw, solo };
})(window);
