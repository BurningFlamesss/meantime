import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "../lib/auth-form";

export const Route = createFileRoute("/sign-up")({
  component: () => <AuthForm mode="sign-up" />,
});
