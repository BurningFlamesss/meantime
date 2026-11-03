import Fastify from "fastify";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import { loadEnv } from "./env.js";
import { buildContext, registerContext } from "./context.js";
import { authRoutes, adsRoutes } from "./routes/auth-ads.js";
import { telemetryRoutes } from "./routes/telemetry.js";
import { userRoutes, advertiserRoutes } from "./routes/users-advertisers.js";
import { advertiserListRoutes } from "./routes/advertiser-list.js";
import { advertiserAuthRoutes } from "./routes/advertiser-auth.js";
import { adminRoutes } from "./routes/admin.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const ctx = buildContext(env);

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // The raw IP is available to handlers via req.ip but must never reach
      // logs. Authorization/cookie headers are redacted too.
      redact: {
        paths: [
          "req.remoteAddress",
          "req.remotePort",
          "req.headers.authorization",
          "req.headers.cookie",
        ],
        censor: "[redacted]",
      },
    },
  });
  registerContext(app, ctx);

  // Money columns are Postgres bigints. JSON has no bigint type, and the web
  // client types these fields as decimal strings so it never loses precision,
  // so serialize every bigint as a string instead of throwing.
  app.setReplySerializer((payload) =>
    JSON.stringify(payload, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );

  // Accept both loopback spellings in local development: a page served from
  // 127.0.0.1 is a different origin than localhost and would otherwise fail
  // every API call even though both reach the same server.
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed =
        origin === env.WEB_ORIGIN ||
        /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
        origin.startsWith("chrome-extension://");
      cb(null, allowed);
    },
    credentials: true,
  });
  await app.register(compress, { encodings: ["br", "gzip", "deflate"] });

  app.get("/health", async () => ({ ok: true, service: "meantime-api" }));

  await authRoutes(app, ctx);
  await adsRoutes(app, ctx);
  await telemetryRoutes(app, ctx);
  await userRoutes(app, ctx);
  await advertiserAuthRoutes(app, ctx);
  await advertiserRoutes(app, ctx);
  await advertiserListRoutes(app, ctx);
  await adminRoutes(app, ctx);

  app.setErrorHandler((err: Error, _req, reply) => {
    if (err.name === "ZodError") {
      return reply.code(400).send({ error: "validation_failed", issues: err.message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

void main();
