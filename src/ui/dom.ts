type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> | string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el && k !== "list") (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function svg(markup: string): SVGElement {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGElement;
}

export function row(label: string, value: Child | Child[]): HTMLElement {
  return h("div", { class: "row" }, h("label", null, label), h("span", null, ...(Array.isArray(value) ? value : [value])));
}

export function seg<T extends string | number>(options: { value: T; label: string; title?: string }[], current: T, onPick: (v: T) => void): HTMLElement {
  return h(
    "div",
    { class: "seg" },
    options.map((o) => h("button", { class: o.value === current ? "on" : "", title: o.title, onclick: () => onPick(o.value) }, o.label)),
  );
}

export function modal(content: HTMLElement, onClose?: () => void): () => void {
  const backdrop = h("div", { class: "backdrop" }, content);
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  return close;
}

/** Bar chart of 24 hourly values on a canvas, sized to its CSS box. */
export function hourChart(values: ArrayLike<number>, color: string, marker?: number): HTMLCanvasElement {
  const canvas = h("canvas", { class: "chart" });
  requestAnimationFrame(() => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 260;
    const hgt = canvas.clientHeight || 64;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    let max = 0;
    for (let i = 0; i < values.length; i++) max = Math.max(max, values[i]);
    const bw = w / values.length;
    const muted = getComputedStyle(document.documentElement).getPropertyValue("--line").trim();
    ctx.fillStyle = muted;
    ctx.fillRect(0, hgt - 14, w, 1);
    for (let i = 0; i < values.length; i++) {
      const v = max > 0 ? (values[i] / max) * (hgt - 18) : 0;
      ctx.fillStyle = i === marker ? getComputedStyle(document.documentElement).getPropertyValue("--text") : color;
      ctx.fillRect(i * bw + 1, hgt - 14 - v, Math.max(1, bw - 2), v);
    }
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted");
    ctx.font = `10px ${getComputedStyle(document.body).fontFamily}`;
    for (const hr of [0, 6, 12, 18]) ctx.fillText(String(hr).padStart(2, "0"), hr * bw + 1, hgt - 2);
  });
  return canvas;
}

/** A small line chart, newest value on the right. */
export function lineChart(values: number[], color: string): HTMLCanvasElement {
  const canvas = h("canvas", { class: "chart" });
  requestAnimationFrame(() => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 260;
    const hgt = canvas.clientHeight || 64;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    if (values.length < 2) return;
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * (w - 2) + 1;
      const y = hgt - 4 - ((v - min) / (max - min || 1)) * (hgt - 8);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  return canvas;
}
