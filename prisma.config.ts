import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },

  datasource: {
    // Vercel provides DATABASE_URL; DIRECT_URL is optional (for migrations)
    // Use DATABASE_URL as fallback when DIRECT_URL is not set (e.g. Preview)
    url: env("DIRECT_URL") ?? env("DATABASE_URL"),
  },
});