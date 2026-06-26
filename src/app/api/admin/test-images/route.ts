// Serves the local result-test-images folder as base64 data URLs so the batch
// cut-tester page can load every test image in one click. Local dev tool only.

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET() {
  try {
    const dir = path.join(process.cwd(), "images", "result-test-images");
    const entries = await fs.readdir(dir);
    const files = entries
      .filter((f) => MIME[path.extname(f).toLowerCase()])
      .sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, "")) || 0;
        const nb = parseInt(b.replace(/\D/g, "")) || 0;
        return na - nb;
      });

    const images = await Promise.all(
      files.map(async (name) => {
        const buf = await fs.readFile(path.join(dir, name));
        const mime = MIME[path.extname(name).toLowerCase()];
        return { name, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
      })
    );

    return NextResponse.json({ images });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to read test images";
    return NextResponse.json({ error: msg, images: [] }, { status: 500 });
  }
}
