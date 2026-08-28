import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = join(root, "node_modules", "govuk-frontend", "dist", "govuk", "assets");
const destination = join(root, "public", "assets");

mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
