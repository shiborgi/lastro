"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type FormEvent, useState } from "react";

/*
 * Posts straight at the Better Auth endpoints through this app's same-origin
 * proxy, so the session cookie it sets back is first-party and HttpOnly. No
 * token ever reaches client JavaScript.
 */
export function SignIn({
  onSignedIn,
  reason,
}: {
  /** Reads the session back. `false` means the login was accepted and the
   * session still did not resolve — a state the form has to name, because
   * otherwise it re-renders unchanged and the button looks broken. */
  onSignedIn: () => Promise<boolean>;
  reason?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(data.get("email") ?? ""),
          password: String(data.get("password") ?? ""),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          response.status === 401
            ? "E-mail ou senha inválidos."
            : (body?.message ?? "Não foi possível entrar."),
        );
      }
      if (!(await onSignedIn())) {
        throw new Error(
          "Senha aceita, mas a sessão não foi reconhecida. Se este navegador bloqueia cookies para este endereço, libere-os e tente de novo.",
        );
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Lastro</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {(error ?? reason) ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error ?? reason}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
