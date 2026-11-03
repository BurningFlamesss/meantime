import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "../lib/auth-form";

export const Route = createFileRoute("/sign-up")({
  // `ref` stays optional so ordinary links to /sign-up do not need search params.
  validateSearch: (search: Record<string, unknown>): { ref?: string } => ({
    ref: typeof search.ref === "string" ? search.ref.slice(0, 32) : undefined,
  }),
  component: SignUp,
});

function SignUp() {
  const { ref } = Route.useSearch();
  return <AuthForm mode="sign-up" referralCode={ref} />;
}
