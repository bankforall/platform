import { defineConfig } from "prisma/config";

// Prisma 7: connection settings for the CLI (migrate) live here; the app connects through
// the pg driver adapter in src/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // optional so `prisma generate` works without a database (e.g. in the Docker build)
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
