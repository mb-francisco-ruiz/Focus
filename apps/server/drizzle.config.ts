import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // eslint-disable-next-line no-restricted-syntax
    url: process.env.DATABASE_URL!,
  },
});
