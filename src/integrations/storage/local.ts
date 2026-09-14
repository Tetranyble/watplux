import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/lib/env";
import type {
  StorageProvider,
  UploadObjectInput,
} from "@/src/integrations/storage/types";

function rootDirectory(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    env.LOCAL_MEDIA_ROOT,
  );
}

function safePath(key: string): string {
  const root = rootDirectory();
  const target = path.resolve(/* turbopackIgnore: true */ root, key);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid media storage key.");
  }
  return target;
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = "LOCAL" as const;

  async upload(input: UploadObjectInput) {
    const target = safePath(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.body);
    return { key: input.key };
  }

  async read(key: string) {
    return { body: await readFile(safePath(key)) };
  }

  async remove(key: string) {
    await rm(safePath(key), { force: true });
  }
}
