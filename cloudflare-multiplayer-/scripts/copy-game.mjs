import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(projectDirectory, "..", "..", "upload-one-file", "index.html");
const destinationDirectory = resolve(projectDirectory, "public");
const destination = resolve(destinationDirectory, "index.html");
await mkdir(destinationDirectory, { recursive: true });

try {
  await access(source);
  await copyFile(source, destination);
  console.log(destination);
} catch {
  await access(destination);
  console.log(`${destination} (using bundled game)`);
}
