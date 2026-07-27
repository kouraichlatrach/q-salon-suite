import { errorMessage } from "@/lib/error-message";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { toast } from "sonner";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Sign in — Q-Salon Suite" },
      { name: "description", content: "Sign in or create your salon brand account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode: initialMode, redirect } = Route.useSearch();
  const navigate = useNavigate();
  

  const [mode, setMode] = useState<"signin" | "signup">(initialMode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  // If already signed in, bounce to app.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: redirect ?? "/app" });
    });
  }, [navigate, redirect]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/app`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Account created", {
            description: "Check your email to confirm before signing in.",
          });
          setMode("signin");
          setPassword("");
          return;
        }
        // Attach any pending invite matching this email to the new account.
        const { data: claimed } = await supabase.rpc("claim_pending_invite");
        if (Array.isArray(claimed) && claimed.length > 0) {
          toast.success("Welcome!", { description: "You've been added to your team." });
        } else {
          toast.success("Account created", {
            description: "You're signed in. Let's set up your salon.",
          });
        }
        navigate({ to: "/app" });
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.session) {
          toast.message("Please confirm your email before signing in.");
          return;
        }
        // Also claim on sign-in in case invite was created after they signed up.
        await supabase.rpc("claim_pending_invite");
        navigate({ to: redirect ?? "/app" });
      }
    } catch (err) {
      toast.error(mode === "signup" ? "Could not create account" : "Sign in failed", {
        description: errorMessage(err, "Please try again."),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      {/* Left panel */}
      <div className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground md:flex">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo size={36} className="rounded-md bg-white p-0.5" />
          <span className="font-display text-lg font-semibold tracking-tight">Q-Salon Suite</span>
        </Link>
        <div>
          <h2 className="max-w-md font-display text-4xl font-semibold leading-tight tracking-tight">
            The calm operations layer for beauty brands in Qatar.
          </h2>
          <p className="mt-4 max-w-sm text-sm text-primary-foreground/70">
            Appointments, staff, stock and revenue — organised across every branch.
          </p>
        </div>
        <div className="text-xs text-primary-foreground/60">Trusted by growing salon groups in Doha.</div>
      </div>

      {/* Form */}
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="md:hidden">
            <Link to="/" className="flex items-center gap-2.5">
              <Logo size={32} />
              <span className="font-display text-lg font-semibold tracking-tight">Q-Salon Suite</span>
            </Link>
          </div>
          <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight md:mt-0">
            {mode === "signup" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signup"
              ? "Start your 14-day trial. No card required."
              : "Sign in to manage your salon."}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Your name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  placeholder="Aisha Al Kuwari"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@salon.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Please wait..." : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signup" ? "Already have an account?" : "New to Q-Salon?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
              className="font-medium text-accent hover:underline"
            >
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
