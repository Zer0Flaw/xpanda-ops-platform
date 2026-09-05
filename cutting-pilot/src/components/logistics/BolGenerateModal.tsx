"use client";
// src/components/logistics/BolGenerateModal.tsx
// Replaces legacy's BolCompose.open (logistics/bol-compose.js) as a real React component — a
// per-trailer paged form (not the 47x h() DOM-builder original) prefilled from the job + its
// live loading assignments. "Include packing slip" / "Include Loading Diagram" are deliberately
// dropped from this port: neither has a v2 endpoint in this unit's scope (packing-slip bytes
// live in the Job Board; the Loading Diagram comes from Load Builder, its own later unit) — only
// "Hide tracking QR code" survives, since it needs no cross-module data.
//
// Write action is FENCED (POST /v2/api/bols returns 501 while V2_LOGISTICS_WRITES_ENABLED is
// false) -- Generate All still runs the full save loop per trailer so the wiring is exercised
// end-to-end; a 501 shows a clear, non-blocking banner instead of ever spinning forever or
// silently failing, and never closes the modal (so the operator doesn't lose typed data).
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { confirmNoBolNumber } from "@/lib/bolDomGlue";
import type { JobForBol, LoadingAssignmentForJob } from "./types";

interface BolGenerateModalProps {
  jobId: string | null;
  /** Called on close. `generated=true` only when at least one trailer actually saved (never
   * happens while the fence is on) so the dashboard knows to refetch (Bug 2 fix). */
  onClose: (generated: boolean) => void;
}

type FreightTerms = "prepaid" | "collect" | "3rd_party";

// Same token-driven input styling as OrderEntryForm.tsx's `inputClass` — kept as a local literal
// (small, single-purpose) rather than importing across feature-component boundaries.
const inputClass =
  "w-full min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

interface TrailerForm {
  invNumber: string;
  invAutoFilled: boolean;
  date: string;
  shipToCompany: string;
  shipToAttention: string;
  shipToStreet: string;
  shipToStreet2: string;
  shipToCity: string;
  shipToState: string;
  shipToZip: string;
  contactName: string;
  contactPhone: string;
  carrierName: string;
  poNumber: string;
  deliveryTime: string;
  freightTerms: FreightTerms;
  specialInstructions: string;
  trailerNo: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Legacy carries these through to bols.handling_unit_qty/package_qty/weight, but bol-shared.js's
// generatePdf never draws them on the printed BOL — they're persisted, unrendered columns today
// in both legacy and v2. No compose-form input exists for them either (only a computed piece
// count guess); ported as data-completeness, not a visible feature.
function piecesGuess(job: JobForBol): number {
  if (!Array.isArray(job.line_items)) return 0;
  return job.line_items.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0);
}

function buildCommodityDescription(job: JobForBol): string {
  if (!Array.isArray(job.line_items) || !job.line_items.length) return "";
  return job.line_items
    .map((li) => [li.quantity ? `${li.quantity} ×` : "", li.part_number || "", li.description || ""].filter(Boolean).join(" "))
    .join("\n");
}

export default function BolGenerateModal({ jobId, onClose }: BolGenerateModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [job, setJob] = useState<JobForBol | null>(null);
  const [trailers, setTrailers] = useState<TrailerForm[]>([]);
  const [page, setPage] = useState(0);
  const [hideQr, setHideQr] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Array<{ text: string; done: boolean }>>([]);
  const [fenced, setFenced] = useState(false);
  const [savedAny, setSavedAny] = useState(false);

  useEffect(() => {
    setJob(null);
    setTrailers([]);
    setPage(0);
    setLoadError(null);
    setFormError(null);
    setFenced(false);
    setSavedAny(false);
    setProgress([]);
    if (!jobId) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const [jobJson, laJson] = await Promise.all([
          fetch(`/v2/api/jobs/${encodeURIComponent(jobId)}`).then((r) => r.json()),
          fetch(`/v2/api/loading-assignments?job_id=${encodeURIComponent(jobId)}`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (!jobJson.ok || !jobJson.job) {
          setLoadError("Could not load this job.");
          return;
        }
        const j: JobForBol = jobJson.job;
        setJob(j);

        const assignments: LoadingAssignmentForJob[] = laJson.ok && Array.isArray(laJson.assignments) ? laJson.assignments : [];
        const byLoad = new Map<number, LoadingAssignmentForJob>();
        for (const a of assignments) if (a.load_number != null) byLoad.set(Number(a.load_number), a);

        const loadCount = Math.max(1, Number(j.load_count) || 1);
        const commodityDescription = buildCommodityDescription(j);
        const cityStateFromLocation = (j.location || "").split(",");

        const built: TrailerForm[] = [];
        for (let i = 0; i < loadCount; i++) {
          const assignment = byLoad.get(i + 1);
          built.push({
            invNumber: i === 0 ? j.invoice_number || "" : "",
            invAutoFilled: false,
            date: assignment?.load_ship_date || j.ship_date || today(),
            shipToCompany: j.ship_to_company || j.customer || "",
            shipToAttention: j.ship_to_attention || "",
            shipToStreet: j.ship_to_street || "",
            shipToStreet2: j.ship_to_street2 || "",
            shipToCity: j.ship_to_city || (cityStateFromLocation[0] || "").trim(),
            shipToState: j.ship_to_state || (cityStateFromLocation[1] || "").trim(),
            shipToZip: j.ship_to_zip || "",
            contactName: j.contact_name || "",
            contactPhone: j.contact_phone || "",
            carrierName: j.carrier || "",
            poNumber: j.po_number || "",
            deliveryTime: j.delivery_time || "",
            freightTerms: "prepaid",
            specialInstructions: "",
            trailerNo: assignment?.trailer_number || "",
          });
        }
        setTrailers(built);
      } catch {
        if (!cancelled) setLoadError("Network error — could not load this job.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  function updateField<K extends keyof TrailerForm>(index: number, field: K, value: TrailerForm[K]) {
    setTrailers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  // Suffix auto-fill (ported from bol-compose.js:448-462, corrected per this prompt's spec):
  // editing trailer 0's INV# with a `prefix-###` shape auto-fills subsequent BLANK-or-still-
  // auto-filled trailers. A manual edit to ANY trailer clears THAT trailer's own auto-fill flag
  // — unlike legacy, which never cleared a later trailer's flag on direct edit, so a second edit
  // to trailer 0 could silently clobber a hand-typed value on trailer 2+.
  function handleInvNumberChange(index: number, value: string) {
    setTrailers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], invNumber: value, invAutoFilled: false };
      if (index === 0) {
        const match = value.trim().match(/^(.+-)(\d+)$/);
        if (match) {
          const prefix = match[1];
          const startNum = parseInt(match[2], 10);
          for (let j = 1; j < next.length; j++) {
            if (!next[j].invNumber || next[j].invAutoFilled) {
              const suffix = String(startNum + j).padStart(match[2].length, "0");
              next[j] = { ...next[j], invNumber: prefix + suffix, invAutoFilled: true };
            }
          }
        }
      }
      return next;
    });
  }

  async function handleGenerateAll() {
    setFormError(null);
    for (let i = 0; i < trailers.length; i++) {
      const td = trailers[i];
      if (!td.date) {
        setPage(i);
        setFormError(`Trailer ${i + 1}: Date is required.`);
        return;
      }
      if (!td.shipToCompany.trim()) {
        setPage(i);
        setFormError(`Trailer ${i + 1}: Company is required.`);
        return;
      }
    }
    const missingNumbers = trailers.some((td) => !td.invNumber.trim());
    if (missingNumbers) {
      const proceed = await confirmNoBolNumber();
      if (!proceed) return;
    }

    setGenerating(true);
    setProgress(trailers.map((_, i) => ({ text: `Trailer ${i + 1} — waiting…`, done: false })));

    const bolGroupId = trailers.length > 1 ? crypto.randomUUID() : null;

    for (let i = 0; i < trailers.length; i++) {
      const td = trailers[i];
      setProgress((p) => {
        const n = [...p];
        n[i] = { text: `Trailer ${i + 1} — saving…`, done: false };
        return n;
      });

      const payload = {
        bol_number: td.invNumber || null,
        date: td.date,
        ship_to_company: td.shipToCompany,
        ship_to_attention: td.shipToAttention,
        ship_to_street: td.shipToStreet,
        ship_to_street2: td.shipToStreet2,
        ship_to_city: td.shipToCity,
        ship_to_state: td.shipToState,
        ship_to_zip: td.shipToZip,
        carrier_name: td.carrierName,
        trailer_no: td.trailerNo || "",
        freight_terms: td.freightTerms,
        is_scrap_pickup: job?.scrap_pickup === "YES" ? 1 : 0,
        special_instructions: td.specialInstructions,
        contact_info: [td.contactName ? `POC: ${td.contactName}` : "", td.contactPhone || ""].filter(Boolean).join(" "),
        po_number: td.poNumber || "",
        is_master_bol: 0,
        bol_group_id: bolGroupId,
        load_number: i + 1,
        load_count: trailers.length,
        commodity_description: job ? buildCommodityDescription(job) : "",
        handling_unit_qty: "",
        handling_unit_type: "stacks",
        package_qty: job ? String(piecesGuess(job) || "") : "",
        package_type: "pcs",
        weight: "",
        delivery_time: td.deliveryTime,
        job_id: jobId,
        notes: "",
      };

      try {
        const res = await fetch("/v2/api/bols", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (res.status === 501) {
          setFenced(true);
          setGenerating(false);
          return;
        }
        if (!res.ok || !data.ok) {
          setFormError(`Trailer ${i + 1}: ${data.error || `HTTP ${res.status}`}`);
          setGenerating(false);
          return;
        }

        setSavedAny(true);
        setProgress((p) => {
          const n = [...p];
          n[i] = { text: `Trailer ${i + 1} — ${data.bol?.bol_number ? `BOL #${data.bol.bol_number}` : "BOL"} saved`, done: true };
          return n;
        });
      } catch {
        setFormError(`Trailer ${i + 1}: network error.`);
        setGenerating(false);
        return;
      }
    }

    setGenerating(false);
    onClose(true);
  }

  const trailer = trailers[page];
  const isOpen = !!jobId;

  return (
    <Modal isOpen={isOpen} onClose={() => onClose(savedAny)} title="Generate BOL" size="lg">
      {loading && <p className="text-sm text-muted py-6 text-center">Loading job…</p>}
      {loadError && !loading && <p className="text-sm text-[var(--danger-text)] py-6 text-center">{loadError}</p>}

      {fenced && (
        <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
          Generate is disabled in the v2 preview phase. Use the legacy Logistics dashboard to generate this BOL for now.
        </div>
      )}

      {formError && (
        <div className="rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-sm px-4 py-3 font-medium">
          {formError}
        </div>
      )}

      {trailer && !loading && !loadError && (
        <div className="space-y-4">
          {trailers.length > 1 && (
            <p className="text-xs font-semibold text-muted">
              Trailer {page + 1} of {trailers.length}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="BOL Date">
              <input
                type="date"
                className={inputClass}
                value={trailer.date}
                onChange={(e) => updateField(page, "date", e.target.value)}
              />
            </Field>
            <Field label="INV #">
              <input
                type="text"
                className={inputClass}
                value={trailer.invNumber}
                onChange={(e) => handleInvNumberChange(page, e.target.value)}
              />
            </Field>
            <Field label="Company">
              <input
                type="text"
                className={inputClass}
                value={trailer.shipToCompany}
                onChange={(e) => updateField(page, "shipToCompany", e.target.value)}
              />
            </Field>
            <Field label="Attention">
              <input
                type="text"
                className={inputClass}
                value={trailer.shipToAttention}
                onChange={(e) => updateField(page, "shipToAttention", e.target.value)}
              />
            </Field>
            <Field label="Street">
              <input
                type="text"
                className={inputClass}
                value={trailer.shipToStreet}
                onChange={(e) => updateField(page, "shipToStreet", e.target.value)}
              />
            </Field>
            <Field label="Street 2">
              <input
                type="text"
                className={inputClass}
                value={trailer.shipToStreet2}
                onChange={(e) => updateField(page, "shipToStreet2", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="City">
              <input
                type="text"
                className={inputClass}
                value={trailer.shipToCity}
                onChange={(e) => updateField(page, "shipToCity", e.target.value)}
              />
            </Field>
            <Field label="State">
              <input
                type="text"
                className={inputClass}
                value={trailer.shipToState}
                onChange={(e) => updateField(page, "shipToState", e.target.value)}
              />
            </Field>
            <Field label="Zip">
              <input
                type="text"
                className={inputClass}
                value={trailer.shipToZip}
                onChange={(e) => updateField(page, "shipToZip", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Contact Name">
              <input
                type="text"
                className={inputClass}
                value={trailer.contactName}
                onChange={(e) => updateField(page, "contactName", e.target.value)}
              />
            </Field>
            <Field label="Contact Phone">
              <input
                type="text"
                className={inputClass}
                value={trailer.contactPhone}
                onChange={(e) => updateField(page, "contactPhone", e.target.value)}
              />
            </Field>
            <Field label="Carrier">
              <input
                type="text"
                className={inputClass}
                value={trailer.carrierName}
                onChange={(e) => updateField(page, "carrierName", e.target.value)}
              />
            </Field>
            <Field label="PO Number">
              <input
                type="text"
                className={inputClass}
                value={trailer.poNumber}
                onChange={(e) => updateField(page, "poNumber", e.target.value)}
              />
            </Field>
            <Field label="Trailer #">
              <input
                type="text"
                className={inputClass}
                value={trailer.trailerNo}
                onChange={(e) => updateField(page, "trailerNo", e.target.value)}
              />
            </Field>
            <Field label="Delivery Time">
              <input
                type="text"
                className={inputClass}
                value={trailer.deliveryTime}
                onChange={(e) => updateField(page, "deliveryTime", e.target.value)}
              />
            </Field>
          </div>

          <Field label="Freight Terms">
            <div className="flex gap-4 flex-wrap">
              {(["prepaid", "collect", "3rd_party"] as FreightTerms[]).map((val) => (
                <label key={val} className="flex items-center gap-1.5 text-sm text-text cursor-pointer">
                  <input
                    type="radio"
                    name={`freight-${page}`}
                    checked={trailer.freightTerms === val}
                    onChange={() => updateField(page, "freightTerms", val)}
                  />
                  {val === "prepaid" ? "Prepaid" : val === "collect" ? "Collect" : "3rd Party"}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Special Instructions">
            <textarea
              className={`${inputClass} min-h-[70px] resize-y`}
              value={trailer.specialInstructions}
              onChange={(e) => updateField(page, "specialInstructions", e.target.value)}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
            <input type="checkbox" checked={hideQr} onChange={(e) => setHideQr(e.target.checked)} />
            Hide tracking QR code
          </label>

          {progress.length > 0 && (
            <ul className="text-xs text-muted space-y-1 list-none p-0 m-0">
              {progress.map((p, i) => (
                <li key={i} className={p.done ? "text-[var(--success-text)]" : ""}>
                  {p.text}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-[var(--line)]">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="min-h-[44px] px-4 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold text-text disabled:opacity-40 cursor-pointer"
            >
              ← Prev
            </button>
            <span className="text-xs font-mono tabular-nums text-muted">
              {page + 1}/{trailers.length}
            </span>
            {page === trailers.length - 1 ? (
              <button
                type="button"
                disabled={generating}
                onClick={handleGenerateAll}
                className="min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold disabled:opacity-50 cursor-pointer hover:opacity-90"
              >
                {generating ? "Generating…" : "Generate All BOLs"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                className="min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90"
              >
                Next →
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-muted">{label}</label>
      {children}
    </div>
  );
}
