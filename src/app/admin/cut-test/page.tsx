"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { splitMatchImage, SplitResult } from "@/lib/imageRowSplitter";

type Job = {
  id: string;
  src: string;        // original image data URL
  name: string;
  result: SplitResult | null;
  error: string | null;
  busy: boolean;
};

function uid() {
  return `cut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function CutTestPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [forcedRows, setForcedRows] = useState<string>("auto");

  const runSplit = useCallback(async (job: Job, forced: string) => {
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, busy: true, error: null } : j)));
    try {
      const forcedRowCount = forced === "auto" ? undefined : parseInt(forced) || undefined;
      const result = await splitMatchImage(job.src, { forcedRowCount });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, result, busy: false } : j)));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to split image";
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, error: msg, busy: false } : j)));
    }
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      Array.from(files).forEach((file) => {
        if (!file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const src = e.target?.result as string;
          const job: Job = { id: uid(), src, name: file.name || "pasted-image", result: null, error: null, busy: false };
          setJobs((prev) => [...prev, job]);
          runSplit(job, forcedRows);
        };
        reader.readAsDataURL(file);
      });
    },
    [forcedRows, runSplit]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imgs: File[] = [];
      for (const it of Array.from(items)) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) imgs.push(f);
        }
      }
      if (imgs.length) {
        e.preventDefault();
        addFiles(imgs);
      }
    },
    [addFiles]
  );

  const reprocessAll = () => {
    jobs.forEach((j) => runSplit(j, forcedRows));
  };

  const loadTestImages = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/test-images");
      const data = await res.json();
      if (!res.ok || !data.images) throw new Error(data.error || "Failed to load");
      const newJobs: Job[] = data.images.map((img: { name: string; dataUrl: string }) => ({
        id: uid(),
        src: img.dataUrl,
        name: img.name,
        result: null,
        error: null,
        busy: false,
      }));
      setJobs(newJobs);
      newJobs.forEach((j) => runSplit(j, forcedRows));
    } catch (err) {
      console.error(err);
    }
  }, [forcedRows, runSplit]);

  const removeJob = (id: string) => setJobs((prev) => prev.filter((j) => j.id !== id));
  const clearAll = () => setJobs([]);

  const totalRows = jobs.reduce(
    (acc, j) => acc + (j.result?.panels.reduce((a, p) => a + p.rows.length, 0) || 0),
    0
  );

  return (
    <div
      className="min-h-screen bg-gray-950 text-gray-100 p-6"
      onPaste={handlePaste}
      tabIndex={0}
    >
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-yellow-300">Row Cutter — Test Tool</h1>
          <Link href="/admin/import" className="text-sm text-sky-400 hover:underline">
            ← Back to Import
          </Link>
        </div>
        <p className="text-gray-400 text-sm mb-6">
          Auto-detects the coloured team panel in a match screenshot and slices it into one strip
          per player. Works regardless of image size / zoom. No AI yet — this just verifies the cuts.
        </p>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-4 bg-gray-900 border border-gray-800 rounded-lg p-4">
          <label className="cursor-pointer bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-2 px-4 rounded transition">
            Upload image(s)
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </label>
          <button
            onClick={loadTestImages}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-4 rounded transition"
          >
            Load all 15 test images
          </button>
          <span className="text-gray-500 text-sm">or paste (Ctrl/Cmd+V) anywhere on this page</span>

          <div className="ml-auto flex items-center gap-2">
            <label className="text-sm text-gray-400">Rows per panel:</label>
            <select
              value={forcedRows}
              onChange={(e) => setForcedRows(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm"
            >
              <option value="auto">Auto-detect</option>
              {[3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
                <option key={n} value={String(n)}>{n}</option>
              ))}
            </select>
            <button
              onClick={reprocessAll}
              disabled={jobs.length === 0}
              className="bg-sky-700 hover:bg-sky-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium py-1.5 px-3 rounded transition"
            >
              Re-cut all
            </button>
            <button
              onClick={clearAll}
              disabled={jobs.length === 0}
              className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-sm font-medium py-1.5 px-3 rounded transition"
            >
              Clear
            </button>
          </div>
        </div>

        {jobs.length > 0 && (
          <p className="text-sm text-gray-500 mb-4">
            {jobs.length} image(s) · {totalRows} row strip(s) detected
          </p>
        )}

        {jobs.length === 0 && (
          <div className="border-2 border-dashed border-gray-800 rounded-lg p-16 text-center text-gray-600">
            Upload or paste a match-result screenshot to see the cuts.
          </div>
        )}

        <div className="space-y-8">
          {jobs.map((job) => (
            <div key={job.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-400 truncate">{job.name}</span>
                <div className="flex items-center gap-3">
                  {job.busy && <span className="text-xs text-yellow-400">cutting…</span>}
                  <button
                    onClick={() => runSplit(job, forcedRows)}
                    className="text-xs text-sky-400 hover:underline"
                  >
                    Re-cut
                  </button>
                  <button onClick={() => removeJob(job.id)} className="text-xs text-red-400 hover:underline">
                    Remove
                  </button>
                </div>
              </div>

              {job.error && (
                <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded p-3 mb-3">
                  {job.error}
                </div>
              )}

              {job.result && (
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Overlay (detected boxes + cut lines) */}
                  <div>
                    <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                      Detected panels &amp; cut lines
                    </h3>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={job.result.overlayDataUrl}
                      alt="overlay"
                      className="w-full rounded border border-gray-700"
                    />
                    <p className="text-xs text-gray-500 mt-2">
                      {job.result.width}×{job.result.height}px · {job.result.panels.length} panel(s)
                      {job.result.panels.some((p) => !p.autoDetected) && " · ⚠ some panels used even-division fallback"}
                    </p>
                  </div>

                  {/* Cropped strips */}
                  <div>
                    <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                      Player row strips
                    </h3>
                    <div className="space-y-4">
                      {job.result.panels.map((panel) => (
                        <div key={panel.index}>
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="inline-block w-3 h-3 rounded-sm border border-gray-600"
                              style={{ background: `rgb(${panel.color.r},${panel.color.g},${panel.color.b})` }}
                            />
                            <span className="text-xs text-gray-400">
                              {panel.rows.filter((r) => !r.isSub).length} starter(s)
                              {panel.rows.some((r) => r.isSub) &&
                                ` · ${panel.rows.filter((r) => r.isSub).length} sub(s)`}{" "}
                              · {panel.autoDetected ? "auto-detected" : "even split"}
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {panel.rows.map((row) => (
                              <div key={row.index} className="flex items-center gap-2">
                                <span
                                  className={
                                    "text-[10px] w-10 shrink-0 text-right " +
                                    (row.isSub ? "text-yellow-500" : "text-gray-500")
                                  }
                                >
                                  {row.label}
                                </span>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={row.dataUrl}
                                  alt={row.label}
                                  className={
                                    "flex-1 rounded border bg-black/20 " +
                                    (row.isSub ? "border-yellow-700/60" : "border-gray-700")
                                  }
                                />
                                <a
                                  href={row.dataUrl}
                                  download={`${row.isSub ? "sub" : "row"}-${row.label.replace(/\s+/g, "")}.png`}
                                  className="text-[10px] text-sky-400 hover:underline shrink-0"
                                >
                                  save
                                </a>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {job.result.panels.length === 0 && (
                        <p className="text-sm text-gray-500">
                          No player rows detected. Try setting a fixed row count, or the image may
                          not contain a detailed stats panel.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
