import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },

  datasource: {
    // Vercel provides DATABASE_URL; DIRECT_URL is optional (for migrations)
    // Use process.env directly since prisma's env() throws if not found
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});