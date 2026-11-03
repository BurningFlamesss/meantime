import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Referral links (`/r/<code>`) are the only public URL the referral program
 * hands out, so they must never 404. The code is normalised here and passed to
 * sign-up as `?ref=`, which is the one place registration reads it.
 */
export const Route = createFileRoute("/r/$code")({
  beforeLoad: ({ params }) => {
    const code = params.code.trim().toLowerCase().slice(0, 32);
    throw redirect({
      to: "/sign-up",
      search: { ref: code || undefined },
    });
  },
});
