import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { LoginRequest, RegisterRequest, type AuthResponse } from "@focus/shared";
import { db, schema } from "../db/index.js";
import { hashPassword, verifyPassword } from "../lib/passwords.js";

/**
 * DB-backed accounts (2026-07-06). Internal tool for two users — registration
 * is open and validation-free by design; passwords are still scrypt-hashed.
 * Everything a user creates hangs off users.id, so one account works across
 * every client (macOS/Windows/Android).
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  const sign = (userId: string) => app.jwt.sign({ sub: userId }, { expiresIn: "90d" });

  const toResponse = (
    user: typeof schema.users.$inferSelect,
    token: string,
  ): AuthResponse => ({
    token,
    user: { id: user.id, email: user.email, displayName: user.displayName },
  });

  app.post("/auth/register", async (req, reply) => {
    const { username, password } = RegisterRequest.parse(req.body);

    const taken = await db.query.users.findFirst({
      where: eq(schema.users.username, username),
    });
    if (taken) return reply.code(409).send({ error: "username already exists" });

    const [user] = await db
      .insert(schema.users)
      .values({
        id: ulid(),
        // email kept unique+required by schema; synthesize until real emails matter
        email: `${username.toLowerCase()}@focus.local`,
        username,
        passwordHash: hashPassword(password),
        displayName: username,
      })
      .returning();
    return reply.code(201).send(toResponse(user!, sign(user!.id)));
  });

  app.post("/auth/login", async (req, reply) => {
    const { username, password } = LoginRequest.parse(req.body);

    const user = await db.query.users.findFirst({
      where: eq(schema.users.username, username),
    });
    if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    return toResponse(user, sign(user.id));
  });
}
