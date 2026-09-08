import { Router } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const presetsRouter: Router = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESETS_PATH = join(__dirname, "..", "..", "..", "presets", "providers.json");

let cached: { providers: any[]; source: string; loadedAt: number } | null = null;
const TTL_MS = 60_000; // refresh every 60s in dev to pick up file edits

function loadPresets() {
  try {
    const raw = readFileSync(PRESETS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    cached = {
      providers: parsed.providers || [],
      source: parsed.source || "",
      loadedAt: Date.now(),
    };
    return cached;
  } catch (e: any) {
    if (cached) return cached; // fall back to stale cache
    return { providers: [], source: "", loadedAt: 0, error: e.message };
  }
}

// GET /api/presets
presetsRouter.get("/", (_req, res) => {
  if (!cached || Date.now() - cached.loadedAt > TTL_MS) loadPresets();
  res.json({ data: cached!.providers, source: cached!.source, count: cached!.providers.length });
});

// GET /api/presets/:platform
presetsRouter.get("/:platform", (req, res) => {
  if (!cached || Date.now() - cached.loadedAt > TTL_MS) loadPresets();
  const p = cached!.providers.find(
    (x: any) => x.platform === req.params.platform,
  );
  if (!p) {
    res.status(404).json({ error: { code: "not_found", message: `No preset for platform '${req.params.platform}'` } });
    return;
  }
  res.json({ data: p });
});
