import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

function joinPath(...parts: string[]) {
  return parts
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "");
}

function contentTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".log") return "text/plain";
  return "application/octet-stream";
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
      continue;
    }
    if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function resolveSourceDir(): string {
  const explicit = process.env.BEAT_STORAGE_IMPORT_DIR?.trim();
  if (explicit) {
    return path.resolve(process.cwd(), explicit);
  }
  return path.resolve(process.cwd(), "..", "docs", "prod-backups", "beat-storage");
}

function storageFileUrl(objectPath: string) {
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  return `${env.storageEndpoint}/${env.BUNNY_STORAGE_ZONE}/${encoded}`;
}

async function main() {
  const sourceDir = resolveSourceDir();
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Beat storage source dir not found: ${sourceDir}`);
  }

  const files = await listFilesRecursive(sourceDir);
  console.log(`Found ${files.length} files in ${sourceDir}`);
  let uploaded = 0;

  for (const file of files) {
    const relative = path.relative(sourceDir, file).replace(/\\/g, "/");
    const objectPath = joinPath(env.BEAT_BUNNY_PREFIX, relative);
    const bytes = await fsp.readFile(file);
    const response = await fetch(storageFileUrl(objectPath), {
      method: "PUT",
      headers: {
        AccessKey: env.BUNNY_STORAGE_PASSWORD,
        "Content-Type": contentTypeForFile(file),
      },
      body: bytes,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed upload (${response.status}) ${objectPath}: ${body}`);
    }
    uploaded += 1;
    if (uploaded % 25 === 0 || uploaded === files.length) {
      console.log(`Uploaded ${uploaded}/${files.length}`);
    }
  }

  console.log(`Beat storage upload complete. Uploaded ${uploaded} files to prefix ${env.BEAT_BUNNY_PREFIX}.`);
}

await main();

