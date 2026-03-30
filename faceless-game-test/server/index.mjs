import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./loadEnvFile.mjs";
import { getServerConfig } from "./config.mjs";
import { validateGameBeatsPayload, validateSavePayload } from "./validation.mjs";
import {
  createAudioReadStream,
  createSeparatedSourceReadStream,
  listSeparatedSources,
  listSavedBeatEntries,
  readSeparatedLogTail,
  readSavedBeatEntry,
  saveGameBeatsForEntry,
  saveSeparatedSources,
  saveMajorBeatsBundle
} from "./storage.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFile(rootDir);
const config = getServerConfig(rootDir);

function withCorsHeaders(headers = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers
  };
}

function readJsonBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      raw += chunk;
      if (bytes > maxBodyBytes) {
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400, withCorsHeaders({ "Content-Type": "application/json" }));
    response.end(JSON.stringify({ error: "Invalid request URL." }));
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, withCorsHeaders());
    response.end();
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "POST" && requestUrl.pathname === "/api/beats/save") {
    try {
      const payload = await readJsonBody(request, config.maxBodyBytes);
      const validationError = validateSavePayload(payload);
      if (validationError) {
        response.writeHead(400, withCorsHeaders({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: validationError }));
        return;
      }

      const { id, fileName, filePath } = await saveMajorBeatsBundle(config.storageDir, payload);
      response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(
        JSON.stringify({
          ok: true,
          id,
          fileName,
          filePath
        })
      );
      return;
    } catch (error) {
      response.writeHead(500, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to save major beats."
        })
      );
      return;
    }
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/beats/list") {
    try {
      const entries = await listSavedBeatEntries(config.storageDir);
      response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ ok: true, entries }));
      return;
    } catch (error) {
      response.writeHead(500, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to list saved beats."
        })
      );
      return;
    }
  }

  const separateStartMatch = requestUrl.pathname.match(/^\/api\/separate\/([^/]+)\/start$/);
  if (request.method === "POST" && separateStartMatch) {
    const id = decodeURIComponent(separateStartMatch[1]);
    const entry = await readSavedBeatEntry(config.storageDir, id);
    if (!entry) {
      response.writeHead(404, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ error: "Saved entry not found." }));
      return;
    }
    try {
      const workerResponse = await fetch(`${config.separationWorkerUrl}/separate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: id,
          storageDir: config.storageDir
        })
      });
      const workerBody = await workerResponse.json();
      if (!workerResponse.ok) {
        response.writeHead(502, withCorsHeaders({ "Content-Type": "application/json" }));
        response.end(
          JSON.stringify({
            error: workerBody?.error || "Separation worker rejected request."
          })
        );
        return;
      }
      response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ ok: true, worker: workerBody }));
      return;
    } catch (error) {
      response.writeHead(502, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to contact separation worker."
        })
      );
      return;
    }
  }

  const separateStatusMatch = requestUrl.pathname.match(/^\/api\/separate\/([^/]+)\/status$/);
  if (request.method === "GET" && separateStatusMatch) {
    const id = decodeURIComponent(separateStatusMatch[1]);
    try {
      const workerResponse = await fetch(
        `${config.separationWorkerUrl}/status/${encodeURIComponent(id)}`
      );
      const workerBody = await workerResponse.json();
      if (!workerResponse.ok) {
        response.writeHead(502, withCorsHeaders({ "Content-Type": "application/json" }));
        response.end(
          JSON.stringify({
            error: workerBody?.error || "Separation worker status failed."
          })
        );
        return;
      }

      if (workerBody?.status === "completed" && Array.isArray(workerBody?.sources)) {
        await saveSeparatedSources(config.storageDir, id, workerBody.sources);
      }
      response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ ok: true, ...workerBody }));
      return;
    } catch (error) {
      response.writeHead(502, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to fetch separation status."
        })
      );
      return;
    }
  }

  const separateSourcesMatch = requestUrl.pathname.match(/^\/api\/separate\/([^/]+)\/sources$/);
  if (request.method === "GET" && separateSourcesMatch) {
    const id = decodeURIComponent(separateSourcesMatch[1]);
    const sources = await listSeparatedSources(config.storageDir, id);
    if (sources === null) {
      response.writeHead(404, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ error: "Saved entry not found." }));
      return;
    }
    response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
    response.end(JSON.stringify({ ok: true, sources }));
    return;
  }

  const separateLogMatch = requestUrl.pathname.match(/^\/api\/separate\/([^/]+)\/log$/);
  if (request.method === "GET" && separateLogMatch) {
    const id = decodeURIComponent(separateLogMatch[1]);
    const tail = parsePositiveInt(
      requestUrl.searchParams.get("tail"),
      config.separationLogTailLines
    );
    try {
      const workerResponse = await fetch(
        `${config.separationWorkerUrl}/log/${encodeURIComponent(id)}?tail=${tail}`
      );
      const workerBody = await workerResponse.json();
      if (workerResponse.ok) {
        response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ ok: true, ...workerBody }));
        return;
      }
    } catch {
      // Fall back to local log tail if worker is unavailable.
    }

    const localLog = await readSeparatedLogTail(config.storageDir, id, tail);
    if (!localLog) {
      response.writeHead(400, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ error: "Invalid entry id." }));
      return;
    }
    response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
    response.end(
      JSON.stringify({
        ok: true,
        entryId: id,
        tailLines: localLog.tailLines,
        logFilePath: localLog.logFilePath
      })
    );
    return;
  }

  const separateSourceAudioMatch = requestUrl.pathname.match(
    /^\/api\/separate\/([^/]+)\/source\/([^/]+)\/audio$/
  );
  if (request.method === "GET" && separateSourceAudioMatch) {
    const id = decodeURIComponent(separateSourceAudioMatch[1]);
    const sourceLabel = decodeURIComponent(separateSourceAudioMatch[2]);
    const streamInfo = createSeparatedSourceReadStream(config.storageDir, id, sourceLabel);
    if (!streamInfo) {
      response.writeHead(404, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ error: "Separated source audio not found." }));
      return;
    }
    response.writeHead(
      200,
      withCorsHeaders({
        "Content-Type": streamInfo.mimeType,
        "Cache-Control": "no-store"
      })
    );
    streamInfo.stream.pipe(response);
    return;
  }

  const analyzeStartMatch = requestUrl.pathname.match(/^\/api\/analyze\/([^/]+)\/start$/);
  if (request.method === "POST" && analyzeStartMatch) {
    const id = decodeURIComponent(analyzeStartMatch[1]);
    const entry = await readSavedBeatEntry(config.storageDir, id);
    if (!entry) {
      response.writeHead(404, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ error: "Saved entry not found." }));
      return;
    }
    try {
      const payload = await readJsonBody(request, config.maxBodyBytes);
      const workerResponse = await fetch(`${config.separationWorkerUrl}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: id,
          storageDir: config.storageDir,
          analysisOverrides:
            payload?.analysisOverrides && typeof payload.analysisOverrides === "object"
              ? payload.analysisOverrides
              : undefined
        })
      });
      const workerBody = await workerResponse.json();
      if (!workerResponse.ok) {
        response.writeHead(502, withCorsHeaders({ "Content-Type": "application/json" }));
        response.end(
          JSON.stringify({
            error: workerBody?.error || "Analysis worker rejected request."
          })
        );
        return;
      }
      response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ ok: true, worker: workerBody }));
      return;
    } catch (error) {
      response.writeHead(502, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to contact analysis worker."
        })
      );
      return;
    }
  }

  const saveGameBeatsMatch = requestUrl.pathname.match(/^\/api\/beats\/([^/]+)\/game-beats$/);
  if (request.method === "POST" && saveGameBeatsMatch) {
    const id = decodeURIComponent(saveGameBeatsMatch[1]);
    const entry = await readSavedBeatEntry(config.storageDir, id);
    if (!entry) {
      response.writeHead(404, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ error: "Saved entry not found." }));
      return;
    }
    try {
      const payload = await readJsonBody(request, config.maxBodyBytes);
      const validationError = validateGameBeatsPayload(payload);
      if (validationError) {
        response.writeHead(400, withCorsHeaders({ "Content-Type": "application/json" }));
        response.end(JSON.stringify({ error: validationError }));
        return;
      }
      const updated = await saveGameBeatsForEntry(config.storageDir, id, payload);
      response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(
        JSON.stringify({
          ok: true,
          id,
          gameBeatCount: Array.isArray(updated?.gameBeats) ? updated.gameBeats.length : 0
        })
      );
      return;
    } catch (error) {
      response.writeHead(500, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to save game beats."
        })
      );
      return;
    }
  }

  const analyzeStatusMatch = requestUrl.pathname.match(/^\/api\/analyze\/([^/]+)\/status$/);
  if (request.method === "GET" && analyzeStatusMatch) {
    const id = decodeURIComponent(analyzeStatusMatch[1]);
    try {
      const workerResponse = await fetch(
        `${config.separationWorkerUrl}/analyze-status/${encodeURIComponent(id)}`
      );
      const workerBody = await workerResponse.json();
      if (!workerResponse.ok) {
        response.writeHead(502, withCorsHeaders({ "Content-Type": "application/json" }));
        response.end(
          JSON.stringify({
            error: workerBody?.error || "Analysis status failed."
          })
        );
        return;
      }
      response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ ok: true, ...workerBody }));
      return;
    } catch (error) {
      response.writeHead(502, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to fetch analysis status."
        })
      );
      return;
    }
  }

  const analyzeResultMatch = requestUrl.pathname.match(/^\/api\/analyze\/([^/]+)\/result$/);
  if (request.method === "GET" && analyzeResultMatch) {
    const id = decodeURIComponent(analyzeResultMatch[1]);
    try {
      const workerResponse = await fetch(
        `${config.separationWorkerUrl}/analyze-result/${encodeURIComponent(id)}`
      );
      const workerBody = await workerResponse.json();
      if (!workerResponse.ok) {
        response.writeHead(502, withCorsHeaders({ "Content-Type": "application/json" }));
        response.end(
          JSON.stringify({
            error: workerBody?.error || "Analysis result failed."
          })
        );
        return;
      }
      response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ ok: true, ...workerBody }));
      return;
    } catch (error) {
      response.writeHead(502, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to fetch analysis result."
        })
      );
      return;
    }
  }

  const detailMatch = requestUrl.pathname.match(/^\/api\/beats\/([^/]+)$/);
  if (request.method === "GET" && detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    const entry = await readSavedBeatEntry(config.storageDir, id);
    if (!entry) {
      response.writeHead(404, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ error: "Saved entry not found." }));
      return;
    }
    response.writeHead(200, withCorsHeaders({ "Content-Type": "application/json" }));
    response.end(JSON.stringify({ ok: true, entry }));
    return;
  }

  const audioMatch = requestUrl.pathname.match(/^\/api\/beats\/([^/]+)\/audio$/);
  if (request.method === "GET" && audioMatch) {
    const id = decodeURIComponent(audioMatch[1]);
    const entry = await readSavedBeatEntry(config.storageDir, id);
    if (!entry) {
      response.writeHead(404, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ error: "Saved entry not found." }));
      return;
    }
    const streamInfo = createAudioReadStream(config.storageDir, entry);
    if (!streamInfo) {
      response.writeHead(404, withCorsHeaders({ "Content-Type": "application/json" }));
      response.end(JSON.stringify({ error: "Saved audio not found." }));
      return;
    }
    response.writeHead(
      200,
      withCorsHeaders({
        "Content-Type": streamInfo.mimeType,
        "Cache-Control": "no-store"
      })
    );
    streamInfo.stream.pipe(response);
    return;
  }

  response.writeHead(404, withCorsHeaders({ "Content-Type": "application/json" }));
  response.end(JSON.stringify({ error: "Not found." }));
});

server.listen(config.port, () => {
  console.log(`Beat API listening on http://localhost:${config.port}`);
  console.log(`Beat storage directory: ${config.storageDir}`);
});
