// src/lib/bolEditorEngine.ts
// Canvas + positioned-overlay BOL field editor — ported from logistics/bol-editor.js
// (BolEditor.open) for the logistics v2 BolEditorModal. This stays deliberately imperative DOM,
// same as legacy: dragging absolutely-positioned inputs over a pdf.js canvas render is not a
// case React state meaningfully improves on, and legacy's own implementation already isolated
// it as a self-contained module. BolEditorModal.tsx (React) owns the surrounding Modal chrome,
// the multi-load picker, and the fenced save call; this module owns only the canvas/overlay/
// drag surface, mounted into a container the React component refs.
//
// Differences from bol-editor.js (structural only, no field/coordinate/behavior change):
//   - pdf.js loaded via the npm `pdfjs-dist` package (pinned 4.4.168, matching the legacy CDN
//     version exactly) instead of a CDN dynamic import — same pattern as src/lib/packingSlip.ts,
//     including the `/v2/pdf.worker.min.mjs` workerSrc (copy-pdf-worker.mjs already places that
//     file for packingSlip.ts's use; no new build step needed).
//   - Coordinates/field list come from bolShared.ts's FIELD_MAP/PAGE/COORDS (the already-ported
//     source of truth) instead of window.BolShared.
//   - `open()` returns a cleanup function instead of relying on the caller to call a separate
//     teardown; BolEditorModal calls it on unmount/target change.
import { FIELD_MAP, PAGE, buildShipToLines, type BolFieldMapEntry, type BolOverrides, type BolRecord } from "./bolShared";

const BASELINE_FUDGE = 0;

let _pdfjs: typeof import("pdfjs-dist") | null = null;
async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import("pdfjs-dist");
  mod.GlobalWorkerOptions.workerSrc = "/v2/pdf.worker.min.mjs";
  _pdfjs = mod;
  return _pdfjs;
}

function deriveValue(bol: BolRecord, field: BolFieldMapEntry): string | boolean {
  const k = field.overrideKey;
  const ov: BolOverrides = (bol._overrides as BolOverrides) || {};

  if (field.type === "single") {
    const colMap: Record<string, keyof BolRecord> = {
      date: "date",
      bolNumber: "bol_number",
      carrierName: "carrier_name",
      trailerNo: "trailer_no",
    };
    return k in ov ? String((ov as any)[k]) : String((bol[colMap[k]] as any) || "");
  }

  if (field.type === "shipto") {
    return k in ov ? (ov.shipTo || []).join("\n") : buildShipToLines(bol).join("\n");
  }

  if (field.type === "multiline") {
    if (k in ov) {
      const v = (ov as any)[k];
      return Array.isArray(v) ? v.join("\n") : String(v);
    }
    if (k === "deliveryTime") return bol.delivery_time || "";
    if (k === "specialInstr") return bol.special_instructions || "";
    if (k === "contactInfo")
      return (
        bol.contact_info ||
        [bol.contact_name ? "POC: " + bol.contact_name : "", bol.contact_phone || ""].filter(Boolean).join(" ")
      );
    if (k === "poNumber") {
      const v = bol.po_number || bol.poNumber || "";
      return v ? "PO: " + v : "";
    }
    if (k === "commodity") return bol.commodity_description || "";
  }

  if (field.type === "scrap") {
    if (typeof (ov as any).scrap === "boolean") return (ov as any).scrap;
    return bol.is_scrap_pickup === 1 || bol.is_scrap_pickup === true || bol.is_scrap_pickup === "1";
  }

  return "";
}

function buildScrapToggle(initVal: boolean): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;display:flex;flex-direction:column;gap:2px;";
  wrap.dataset.scrapValue = String(initVal);

  function setState(val: boolean) {
    wrap.dataset.scrapValue = String(val);
    wrap.querySelectorAll("button").forEach((b) => {
      const active = (b.dataset.scrapOption === "yes") === val;
      (b as HTMLElement).style.background = active ? "var(--brand,#1e293b)" : "var(--card-bg,#fff)";
      (b as HTMLElement).style.color = active ? "#fff" : "var(--text,#111827)";
    });
  }

  for (const [label, val] of [
    ["Yes", true],
    ["No", false],
  ] as const) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.dataset.scrapOption = val ? "yes" : "no";
    btn.style.cssText =
      "padding:2px 8px;border-radius:4px;cursor:pointer;font-weight:600;border:1px solid var(--border,#d1d5db);";
    btn.style.background = val === initVal ? "var(--brand,#1e293b)" : "var(--card-bg,#fff)";
    btn.style.color = val === initVal ? "#fff" : "var(--text,#111827)";
    btn.addEventListener("click", () => setState(val));
    wrap.appendChild(btn);
  }
  return wrap;
}

export interface BolEditorHandle {
  cleanup: () => void;
  /** Re-enables the Apply button after a failed save (`success=false`) without discarding the
   * user's edits, or tears the editor down after a successful one (`success=true`). The engine
   * intentionally does NOT clean up on its own click handler — a fenced/failed save must never
   * silently wipe what the operator just typed. */
  finishApply: (success: boolean) => void;
}

export interface BolEditorCallbacks {
  /** Called with the pending change once the operator clicks Apply. The caller owns persistence
   * (the fenced PUT) and must call `handle.finishApply(success)` when it knows the outcome. */
  onApply: (updatedBol: BolRecord) => void;
  onCancel: () => void;
}

// Mounts the canvas+overlay editor into `mountEl`. Returns a handle with `cleanup()` — call it
// on unmount or before mounting a different BOL (e.g. switching the multi-load picker).
export async function mountBolEditor(
  mountEl: HTMLElement,
  bolIn: BolRecord,
  { onApply, onCancel }: BolEditorCallbacks
): Promise<BolEditorHandle> {
  const bol: BolRecord = { ...bolIn };
  if (!bol._overrides && bol.render_overrides) {
    try {
      bol._overrides = typeof bol.render_overrides === "string" ? JSON.parse(bol.render_overrides) : (bol.render_overrides as BolOverrides);
    } catch {
      // leave unset — editor falls back to base fields
    }
  }

  mountEl.innerHTML = "";
  mountEl.style.cssText = "display:flex;flex-direction:column;height:100%;overflow:hidden;";

  const loadingEl = document.createElement("div");
  loadingEl.style.cssText =
    "flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted,#4b5563);font-size:14px;";
  loadingEl.textContent = "Loading editor…";
  mountEl.appendChild(loadingEl);

  let pdfPage: any;
  try {
    const pdfjs = await loadPdfJs();
    const resp = await fetch("/logistics/assets/BLANK_BOL_Xpanda.pdf");
    if (!resp.ok) throw new Error("BOL template not found");
    const bytes = await resp.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    pdfPage = await doc.getPage(1);
  } catch (e: any) {
    loadingEl.textContent = "Editor failed to load: " + (e?.message || String(e));
    return { cleanup: () => {}, finishApply: () => {} };
  }
  loadingEl.remove();

  const scrollArea = document.createElement("div");
  scrollArea.style.cssText =
    "flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:12px;background:var(--bg,#f0f2f5);";
  mountEl.appendChild(scrollArea);

  const canvasWrap = document.createElement("div");
  canvasWrap.style.cssText = "position:relative;display:inline-block;box-shadow:0 2px 8px rgba(0,0,0,0.15);";
  scrollArea.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvasWrap.appendChild(canvas);

  const actionBar = document.createElement("div");
  actionBar.style.cssText =
    "flex-shrink:0;display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border,#d1d5db);background:var(--card-bg,#fff);";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText =
    "padding:8px 20px;border-radius:8px;border:1px solid var(--border,#d1d5db);background:var(--card-bg,#fff);cursor:pointer;font-size:14px;font-weight:600;color:var(--text,#111827);";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.textContent = "Apply Changes";
  applyBtn.style.cssText =
    "padding:8px 20px;border-radius:8px;border:none;background:var(--brand,#1e293b);color:#fff;cursor:pointer;font-size:14px;font-weight:600;";

  actionBar.appendChild(cancelBtn);
  actionBar.appendChild(applyBtn);
  mountEl.appendChild(actionBar);

  const inputEls: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLDivElement> = {};
  const handleEls: Record<string, HTMLDivElement> = {};
  const initialValues: Record<string, string | boolean> = {};

  const savedPos = (bol._overrides && (bol._overrides as BolOverrides)._pos) || {};
  const posOverrides: Record<string, { dx: number; dy: number }> = {};
  for (const k in savedPos) {
    const p = savedPos[k];
    if (p) posOverrides[k] = { dx: p.dx || 0, dy: p.dy || 0 };
  }

  for (const field of FIELD_MAP) {
    const k = field.overrideKey;
    const initVal = deriveValue(bol, field);
    initialValues[k] = initVal;

    let el: HTMLInputElement | HTMLTextAreaElement | HTMLDivElement;
    if (field.type === "scrap") {
      el = buildScrapToggle(initVal as boolean);
    } else if (field.type === "single") {
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(initVal);
      input.style.cssText =
        "position:absolute;box-sizing:border-box;background:rgba(255,255,255,0.88);border:1.5px solid var(--border,#d1d5db);border-radius:4px;padding:1px 4px;font-family:Helvetica,Arial,sans-serif;color:var(--text,#111827);";
      el = input;
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = String(initVal);
      textarea.style.cssText =
        "position:absolute;box-sizing:border-box;background:rgba(255,255,255,0.88);border:1.5px solid var(--border,#d1d5db);border-radius:4px;padding:2px 4px;font-family:Helvetica,Arial,sans-serif;color:var(--text,#111827);resize:none;overflow:hidden;";
      textarea.addEventListener("input", function (this: HTMLTextAreaElement) {
        this.style.height = "auto";
        this.style.height = this.scrollHeight + "px";
      });
      el = textarea;
    }

    inputEls[k] = el;
    canvasWrap.appendChild(el);

    const handle = document.createElement("div");
    handle.title = "Drag to move · double-click to reset";
    handle.style.cssText =
      "position:absolute;width:16px;height:16px;border-radius:4px;background:var(--brand,#1e293b);color:#fff;font-size:11px;line-height:16px;text-align:center;cursor:grab;z-index:5;box-shadow:0 1px 2px rgba(0,0,0,0.3);touch-action:none;user-select:none;";
    handle.textContent = "✥";
    attachDragHandle(handle, k);
    handleEls[k] = handle;
    canvasWrap.appendChild(handle);
  }

  let renderTask: any = null;
  let scale = 1;

  function attachDragHandle(handle: HTMLDivElement, k: string) {
    let startX = 0,
      startY = 0,
      baseDx = 0,
      baseDy = 0,
      dragging = false;

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      handle.style.cursor = "grabbing";
      startX = e.clientX;
      startY = e.clientY;
      const cur = posOverrides[k] || { dx: 0, dy: 0 };
      baseDx = cur.dx;
      baseDy = cur.dy;
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const s = scale || 1;
      const dx = baseDx + (e.clientX - startX) / s;
      const dy = baseDy - (e.clientY - startY) / s;
      posOverrides[k] = { dx: Math.round(dx), dy: Math.round(dy) };
      positionAll(scale);
    });

    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        // already released
      }
      handle.style.cursor = "grab";
      if (posOverrides[k] && posOverrides[k].dx === 0 && posOverrides[k].dy === 0) delete posOverrides[k];
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);

    handle.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      delete posOverrides[k];
      positionAll(scale);
    });
  }

  function reflow() {
    if (renderTask) {
      try {
        renderTask.cancel();
      } catch {
        // already finished
      }
      renderTask = null;
    }

    const logicalW = Math.max(200, scrollArea.clientWidth - 24);
    const logicalH = Math.round((logicalW * PAGE.height) / PAGE.width);
    const s = logicalW / PAGE.width;
    scale = s;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(logicalW * dpr);
    canvas.height = Math.round(logicalH * dpr);
    canvas.style.width = logicalW + "px";
    canvas.style.height = logicalH + "px";
    canvasWrap.style.width = logicalW + "px";
    canvasWrap.style.height = logicalH + "px";

    const ctx = canvas.getContext("2d")!;
    const vp = pdfPage.getViewport({ scale: s * dpr });
    renderTask = pdfPage.render({ canvasContext: ctx, viewport: vp });
    renderTask.promise.then(() => (renderTask = null)).catch(() => {});

    positionAll(s);
  }

  function positionAll(s: number) {
    const H = PAGE.height;
    for (const field of FIELD_MAP) {
      const k = field.overrideKey;
      const el = inputEls[k];
      if (!el) continue;

      if (field.type === "single") {
        const c = field.coord!;
        el.style.left = Math.round(c.x * s) + "px";
        el.style.top = Math.round((H - c.y) * s - (c.size || 10) * s + BASELINE_FUDGE) + "px";
        el.style.fontSize = (c.size || 10) * s + "px";
        el.style.height = Math.round(((c.size || 10) + 6) * s) + "px";
        el.style.lineHeight = Math.round(((c.size || 10) + 4) * s) + "px";
        el.style.width = Math.round((PAGE.width - c.x - 10) * s) + "px";
      } else if (field.type === "multiline") {
        const c = field.coord!;
        const lineH = c.lineH || 14;
        const lc = Math.max(2, ((el as HTMLTextAreaElement).value || "").split("\n").length);
        el.style.left = Math.round(c.x * s) + "px";
        el.style.top = Math.round((H - c.y) * s - (c.size || 10) * s + BASELINE_FUDGE) + "px";
        el.style.fontSize = (c.size || 10) * s + "px";
        el.style.width = Math.round((c.maxW || 250) * s) + "px";
        el.style.height = Math.round(lc * lineH * s + 8 * s) + "px";
        el.style.lineHeight = Math.round(lineH * s) + "px";
      } else if (field.type === "shipto") {
        const coords = field.coords as any[];
        const c1 = coords[0];
        const c4 = coords[3];
        const topPx = Math.round((H - c1.y) * s - c1.size * s + BASELINE_FUDGE);
        const bottomPx = Math.round((H - c4.y) * s + c4.size * s);
        el.style.left = Math.round(c1.x * s) + "px";
        el.style.top = topPx + "px";
        el.style.fontSize = c1.size * s + "px";
        el.style.width = Math.round(210 * s) + "px";
        el.style.height = bottomPx - topPx + "px";
        el.style.lineHeight = Math.round(14 * s) + "px";
      } else if (field.type === "scrap") {
        const coords = field.coords as any;
        const c = coords.yes;
        el.style.left = Math.round((c.x - 35) * s) + "px";
        el.style.top = Math.round((H - c.y) * s - c.size * s + BASELINE_FUDGE) + "px";
        el.style.fontSize = c.size * s + "px";
        el.querySelectorAll("button").forEach((b) => {
          (b as HTMLElement).style.fontSize = Math.round(c.size * s * 0.75) + "px";
        });
      }

      const p = posOverrides[k];
      if (p) {
        el.style.left = parseFloat(el.style.left) + p.dx * s + "px";
        el.style.top = parseFloat(el.style.top) - p.dy * s + "px";
      }
      const hx = parseFloat(el.style.left);
      const hy = parseFloat(el.style.top);
      const handle = handleEls[k];
      if (handle) {
        handle.style.left = Math.max(0, hx - 2) + "px";
        handle.style.top = Math.max(0, hy - 18) + "px";
      }
    }
  }

  applyBtn.addEventListener("click", () => {
    const overrides: BolOverrides = {};

    for (const field of FIELD_MAP) {
      const k = field.overrideKey;
      const el = inputEls[k];
      if (!el) continue;

      if (field.type === "single") {
        const val = (el as HTMLInputElement).value;
        if (val !== initialValues[k]) (overrides as any)[k] = val;
      } else if (field.type === "shipto") {
        const lines = (el as HTMLTextAreaElement).value
          .split("\n")
          .map((l) => l.trimEnd())
          .filter((l) => l.trim())
          .slice(0, 4);
        const init = String(initialValues[k] || "")
          .split("\n")
          .map((l) => l.trimEnd())
          .filter((l) => l.trim());
        if (lines.join("\n") !== init.join("\n")) overrides.shipTo = lines;
      } else if (field.type === "multiline") {
        const lines = (el as HTMLTextAreaElement).value.split("\n").map((l) => l.trimEnd());
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        const init = String(initialValues[k] || "")
          .split("\n")
          .map((l) => l.trimEnd());
        while (init.length && !init[init.length - 1].trim()) init.pop();
        if (lines.join("\n") !== init.join("\n")) (overrides as any)[k] = lines;
      } else if (field.type === "scrap") {
        const val = (el as HTMLDivElement).dataset.scrapValue === "true";
        if (val !== initialValues[k]) overrides.scrap = val;
      }
    }

    const posOut: Record<string, { dx: number; dy: number }> = {};
    for (const pk in posOverrides) {
      const pv = posOverrides[pk];
      if (pv && (pv.dx || pv.dy)) posOut[pk] = { dx: pv.dx, dy: pv.dy };
    }
    if (Object.keys(posOut).length > 0) overrides._pos = posOut;

    const updated: BolRecord = { ...bol };
    if (Object.keys(overrides).length > 0) {
      updated._overrides = overrides;
    } else {
      delete updated._overrides;
    }

    // Deliberately no cleanup() here — the caller (React) owns persistence and decides via
    // finishApply() whether this succeeded (tear down) or failed (leave the edits on screen).
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    applyBtn.textContent = "Saving…";
    onApply(updated);
  });

  cancelBtn.addEventListener("click", () => {
    cleanup();
    onCancel();
  });

  let ro: ResizeObserver | null = null;

  function cleanup() {
    if (renderTask) {
      try {
        renderTask.cancel();
      } catch {
        // already finished
      }
      renderTask = null;
    }
    if (ro) {
      ro.disconnect();
      ro = null;
    }
    mountEl.innerHTML = "";
    mountEl.style.cssText = "";
  }

  ro = new ResizeObserver(reflow);
  ro.observe(scrollArea);

  requestAnimationFrame(reflow);

  function finishApply(success: boolean) {
    if (success) {
      cleanup();
      return;
    }
    applyBtn.disabled = false;
    cancelBtn.disabled = false;
    applyBtn.textContent = "Apply Changes";
  }

  return { cleanup, finishApply };
}
