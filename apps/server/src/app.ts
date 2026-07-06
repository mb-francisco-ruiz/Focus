import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import { env, isDev } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { attachmentRoutes, contextRoutes } from "./routes/context.js";
import { taskRoutes } from "./routes/tasks.js";
import { wsRoutes } from "./routes/ws.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isDev ? { transport: { target: "pino-pretty" } } : true,
  });

  await app.register(cors, { origin: true }); // tauri webviews send tauri://localhost or http://localhost
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(multipart);
  await app.register(websocket);

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      req.userId = req.user.sub;
    } catch {
      await reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation", issues: err.issues });
    }
    app.log.error({ err });
    return reply.code(500).send({ error: "internal" });
  });

  app.get("/health", async () => ({ ok: true, service: "focus-server" }));

  await app.register(authRoutes);
  await app.register(taskRoutes);
  await app.register(contextRoutes);
  await app.register(attachmentRoutes);
  await app.register(wsRoutes);

  return app;
}
