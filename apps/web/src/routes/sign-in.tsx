import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "../lib/auth-form";

export const Route = createFileRoute("/sign-in")({
  component: () => <AuthForm mode="sign-in" />,
});
