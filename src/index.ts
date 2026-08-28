// Vercel's Express framework detector requires the entry point to import Express directly.
import express from "express";
import { createApp } from "./create-app.js";

void express;

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Move It is running at http://localhost:${port}`);
  });
}

export default app;
