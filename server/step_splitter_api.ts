import { IncomingMessage, ServerResponse } from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";

const PYTHON_CORE_SCRIPT = path.resolve(process.cwd(), "server", "step_splitter_core.py");

export async function handleStepSplitterApi(req: IncomingMessage, res: ServerResponse, pathname: string) {
  // CORS & Security headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. POST /api/step-split/start - SSE Progress Streaming
  if (pathname === "/api/step-split/start" && req.method === "POST") {
    let rawBody = "";
    req.on("data", chunk => { rawBody += chunk; });
    req.on("end", async () => {
      try {
        const body = JSON.parse(rawBody || "{}");
        const rawInput = (body.inputPath || "").trim();
        const inputPath = rawInput.replace(/^["']+|["']+$/g, "").trim();
        const rawOutput = (body.outputDir || "").trim();
        let outputDir = rawOutput.replace(/^["']+|["']+$/g, "").trim();
        const maxChunkMb = parseFloat(body.maxChunkMb) || 95.0;
        const splitMode = body.splitMode || "size";
        const preserveColors = body.preserveColors !== false;

        if (!inputPath || !fs.existsSync(inputPath)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Input file does not exist: ${inputPath || "unspecified"}` }));
          return;
        }

        if (!outputDir) {
          const dir = path.dirname(inputPath);
          const baseName = path.basename(inputPath, path.extname(inputPath));
          outputDir = path.join(dir, `${baseName}_parts`);
        }

        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // Set up SSE headers
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        });

        const sendSse = (data: any) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        sendSse({ type: "init", message: "Initializing CAD splitter...", outputDir });

        const pyArgs = [
          PYTHON_CORE_SCRIPT,
          inputPath,
          "--output-dir", outputDir,
          "--max-mb", String(maxChunkMb),
          "--mode", splitMode
        ];
        if (!preserveColors) pyArgs.push("--no-color");

        console.log(`[STEP-SPLITTER] Spawning: python ${pyArgs.join(' ')}`);
        const pyProc = spawn("python", pyArgs, { windowsHide: true });

        pyProc.on("error", (err) => {
          console.error(`[STEP-SPLITTER] Spawn error:`, err);
          sendSse({ type: "error", message: `Error starting Python: ${err.message}` });
        });

        let lineBuffer = "";

        pyProc.stdout.on("data", (chunk: Buffer) => {
          lineBuffer += chunk.toString();
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("__STEP_EVENT__")) {
              try {
                const eventJson = JSON.parse(trimmed.replace("__STEP_EVENT__", ""));
                sendSse(eventJson);
              } catch (e) {
                // Ignore parsing errors of partial json
              }
            } else if (trimmed) {
              sendSse({ type: "log", message: trimmed });
            }
          }
        });

        pyProc.stderr.on("data", (chunk: Buffer) => {
          const errText = chunk.toString().trim();
          if (errText) {
            sendSse({ type: "warning", message: errText });
          }
        });

        pyProc.on("close", (code) => {
          if (lineBuffer.trim().startsWith("__STEP_EVENT__")) {
            try {
              const eventJson = JSON.parse(lineBuffer.trim().replace("__STEP_EVENT__", ""));
              sendSse(eventJson);
            } catch (e) {}
          }

          if (code === 0) {
            sendSse({ type: "finished", success: true, message: "Process completed successfully." });
          } else {
            sendSse({ type: "error", success: false, message: `Splitting process exited with error code ${code}` });
          }
          res.end();
        });

        res.on("close", () => {
          if (!res.writableEnded && !pyProc.killed) {
            try { pyProc.kill(); } catch (e) {}
          }
        });

      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 2. POST /api/step-split/upload - Upload file from browser
  if (pathname === "/api/step-split/upload" && req.method === "POST") {
    const filenameHeader = req.headers["x-filename"] ? decodeURIComponent(req.headers["x-filename"] as string) : `upload_${Date.now()}.step`;
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, filenameHeader);
    const writeStream = fs.createWriteStream(tempFilePath);

    req.pipe(writeStream);

    writeStream.on("finish", () => {
      const stats = fs.statSync(tempFilePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        filePath: tempFilePath,
        fileName: filenameHeader,
        sizeMb: (stats.size / (1024 * 1024)).toFixed(2)
      }));
    });

    writeStream.on("error", (err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // 3. POST /api/step-split/open-folder - Reveal folder in Windows File Explorer
  if (pathname === "/api/step-split/open-folder" && req.method === "POST") {
    let rawBody = "";
    req.on("data", chunk => { rawBody += chunk; });
    req.on("end", () => {
      try {
        const body = JSON.parse(rawBody || "{}");
        const folderPath = body.folderPath;
        if (!folderPath || !fs.existsSync(folderPath)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Folder not found" }));
          return;
        }

        // Windows command to open explorer
        spawn("explorer.exe", [path.resolve(folderPath)], { detached: true, stdio: "ignore" });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Windows Explorer opened." }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 4. GET /api/step-split/download - Download file
  if ((pathname === "/api/step-split/download" || pathname.startsWith("/api/step-split/download/")) && (req.method === "GET" || req.method === "HEAD")) {
    const urlObj = new URL(req.url || "", `http://localhost:3000`);
    const rawPath = urlObj.searchParams.get("path") || "";
    const cleanPath = rawPath.trim().replace(/^["']+|["']+$/g, "").trim();
    const filePath = path.isAbsolute(cleanPath) ? cleanPath : path.resolve(process.cwd(), cleanPath);

    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `File not found: ${filePath || "unspecified"}` }));
      return;
    }

    const stats = fs.statSync(filePath);
    let fileName = path.basename(filePath);
    // Ensure filename always has .step or .stp extension
    if (!fileName.toLowerCase().endsWith(".step") && !fileName.toLowerCase().endsWith(".stp")) {
      fileName += ".step";
    }

    res.writeHead(200, {
      "Content-Type": "model/step",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": stats.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on("error", (err) => {
      console.error("[STEP-DOWNLOAD] Stream error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 5. GET /api/step-split/defaults - Provide sensible default paths
  if (pathname === "/api/step-split/defaults" && req.method === "GET") {
    const cwd = process.cwd();
    const defaultOutputDir = path.join(cwd, "step_parts");
    
    // Check if step_parts exists, if not list existing files in it if any
    let existingFiles: any[] = [];
    if (fs.existsSync(defaultOutputDir)) {
      try {
        const list = fs.readdirSync(defaultOutputDir).filter(f => f.toLowerCase().endsWith(".step") || f.toLowerCase().endsWith(".stp"));
        existingFiles = list.map((f, idx) => {
          const p = path.join(defaultOutputDir, f);
          const st = fs.statSync(p);
          const mb = Number((st.size / (1024 * 1024)).toFixed(2));
          return {
            part_number: idx + 1,
            filename: f,
            path: path.resolve(p),
            size_bytes: st.size,
            size_mb: mb,
            solids_count: 1,
            component_names: [f.replace(/\.(step|stp)$/i, '')]
          };
        });
      } catch (e) {}
    }

    // Find suggested/detected STEP files in workspace and Downloads for quick 1-click selection
    const suggestedInputFiles: { name: string; path: string; sizeMb: string; rawBytes: number }[] = [];
    const searchDirs = [
      cwd,
      path.join(cwd, "scratch"),
      path.join(cwd, "temp"),
      path.join(os.homedir(), "Downloads")
    ];
    for (const sDir of searchDirs) {
      if (fs.existsSync(sDir)) {
        try {
          const entries = fs.readdirSync(sDir);
          for (const entry of entries) {
            if (entry.toLowerCase().endsWith(".step") || entry.toLowerCase().endsWith(".stp")) {
              const fullP = path.join(sDir, entry);
              const st = fs.statSync(fullP);
              if (st.isFile()) {
                suggestedInputFiles.push({
                  name: entry,
                  path: path.resolve(fullP),
                  sizeMb: (st.size / (1024 * 1024)).toFixed(2),
                  rawBytes: st.size
                });
              }
            }
          }
        } catch (e) {}
      }
    }

    // Sort by largest size first so heavy files (like 740MB) are at the top
    suggestedInputFiles.sort((a, b) => b.rawBytes - a.rawBytes);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      workspaceDir: cwd,
      defaultOutputDir: defaultOutputDir,
      existingParts: existingFiles,
      suggestedInputFiles: suggestedInputFiles.slice(0, 15)
    }));
    return;
  }

  // Fallback 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Endpoint not found" }));
}
