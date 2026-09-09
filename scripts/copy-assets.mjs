import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const govukRoot = join(root, "node_modules", "govuk-frontend", "dist", "govuk");
const assetsDestination = join(root, "public", "assets");
const javascriptDestination = join(assetsDestination, "javascripts");

mkdirSync(assetsDestination, { recursive: true });
cpSync(join(govukRoot, "assets"), assetsDestination, { recursive: true });

mkdirSync(javascriptDestination, { recursive: true });
cpSync(
  join(govukRoot, "govuk-frontend.min.js"),
  join(javascriptDestination, "govuk-frontend.min.js")
);
