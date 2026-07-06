import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { LoginRequest, type AuthResponse } from "@focus/shared";
import { env } from "../config.js";
import { db, schema } from "../db/index.js";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Interim auth: single credential pair from env (AUTH_USERNAME/AUTH_PASSWORD,
   * set privately on Railway). Google OAuth + Sign in with Slack replace this
   * in Phase 2; the JWT/session shape stays the same.
   */
  app.post("/auth/login", async (req, reply): Promise<AuthResponse> => {
    const { username, password } = LoginRequest.parse(req.body);

    if (!safeEqual(username, env.AUTH_USERNAME) || !safeEqual(password, env.AUTH_PASSWORD)) {
      return reply.code(401).send({ error: "invalid credentials" });
    }

    const email = `${username.toLowerCase()}@focus.local`;
    let user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (!user) {
      const [created] = await db
        .insert(schema.users)
        .values({ id: ulid(), email, displayName: username })
        .returning();
      user = created!;
    }

    const token = app.jwt.sign({ sub: user.id }, { expiresIn: "30d" });
    return {
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  });
}
