import { env } from "../../config/env.js";

const joinPath = (...parts: string[]) =>
  parts
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "");

const storageFileUrl = (objectPath: string) => {
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  return `${env.storageEndpoint}/${env.BUNNY_STORAGE_ZONE}/${encoded}`;
};

const publicFileUrl = (objectPath: string) => {
  const host = env.BUNNY_PULL_ZONE_HOSTNAME.replace(/^https?:\/\//, "");
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  return `https://${host}/${encoded}`;
};

export async function uploadBufferToBunny(params: {
  buffer: Buffer;
  objectPath: string;
  contentType: string;
}) {
  const url = storageFileUrl(params.objectPath);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: env.BUNNY_STORAGE_PASSWORD,
      "Content-Type": params.contentType,
    },
    body: new Uint8Array(params.buffer),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Bunny upload failed (${response.status}): ${body}`);
  }

  return {
    objectPath: params.objectPath,
    publicUrl: publicFileUrl(params.objectPath),
  };
}

export async function uploadTextToBunny(params: {
  text: string;
  objectPath: string;
  contentType?: string;
}) {
  return uploadBufferToBunny({
    buffer: Buffer.from(params.text, "utf8"),
    objectPath: params.objectPath,
    contentType: params.contentType ?? "application/json",
  });
}

export async function downloadFromBunny(objectPath: string) {
  const response = await fetch(storageFileUrl(objectPath), {
    headers: {
      AccessKey: env.BUNNY_STORAGE_PASSWORD,
    },
  });

  if (!response.ok) {
    throw new Error(`Bunny download failed with status ${response.status}`);
  }

  const bytes = await response.arrayBuffer();
  return {
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    buffer: Buffer.from(bytes),
  };
}

export async function bunnyObjectExists(objectPath: string): Promise<boolean> {
  const response = await fetch(storageFileUrl(objectPath), {
    method: "HEAD",
    headers: {
      AccessKey: env.BUNNY_STORAGE_PASSWORD,
    },
  });
  return response.ok;
}

export async function listBunnyObjects(prefixPath: string): Promise<Array<{ objectName: string; isDirectory: boolean }>> {
  const normalized = prefixPath.replace(/^\/+/, "").replace(/\/+$/, "");
  const pathWithSlash = normalized ? `${normalized}/` : "";
  const response = await fetch(storageFileUrl(pathWithSlash), {
    headers: {
      AccessKey: env.BUNNY_STORAGE_PASSWORD,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Bunny list failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as Array<Record<string, unknown>>;
  return payload.map((item) => ({
    objectName: String(item.ObjectName ?? item.objectName ?? ""),
    isDirectory: Boolean(item.IsDirectory ?? item.isDirectory ?? false),
  }));
}

export const buildObjectPath = (parts: string[]) => joinPath(...parts);
