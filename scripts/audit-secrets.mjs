import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ignoredDirs = new Set(["node_modules", "dist", "coverage", ".git", ".branches", ".temp"]);
const ignoredFiles = new Set(["package-lock.json", ".env", ".env.local", ".env.production", ".env.development"]);

const patterns = [
  {
    name: "private-key",
    regex: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/g
  },
  {
    name: "jwt-like-token",
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g
  },
  {
    name: "supabase-service-role-realistic",
    regex: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g
  },
  {
    name: "vapid-private-realistic",
    regex: /VAPID_PRIVATE_KEY\s*=\s*(?!PRIVATE_KEY_EXEMPLO_NUNCA_VERSIONAR)(?!\.\.\.)[A-Za-z0-9_-]{40,}/g
  }
];

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* files(path);
    else if (!ignoredFiles.has(entry)) yield path;
  }
}

const findings = [];
for (const file of files(root)) {
  const rel = relative(root, file).replaceAll("\\", "/");
  if (rel.split("/").some((part) => part.startsWith(".env"))) continue;
  if (/\.(png|ico|lock)$/.test(rel)) continue;
  const text = readFileSync(file, "utf8");
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) findings.push(`${rel}: ${pattern.name}`);
  }
}

if (findings.length > 0) {
  console.error("Possiveis segredos encontrados:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Nenhum segredo realista encontrado.");
