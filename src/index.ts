import { createApp } from "./create-app.js";

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
