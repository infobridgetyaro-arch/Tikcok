import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Radio, Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function JoinPage() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("error");
      setMessage("No invite token found in this link.");
      return;
    }

    fetch("/api/invite/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (res.ok) {
          setStatus("success");
          setTimeout(() => navigate("/"), 1500);
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus("error");
          setMessage(data.message || "Invalid or expired invite link.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Network error. Please try again.");
      });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm text-center space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div
            className="flex items-center justify-center w-16 h-16 rounded-xl"
            style={{ background: "linear-gradient(135deg, #0f172a, #1e293b)", border: "1px solid rgba(56,189,248,0.3)" }}
          >
            <Radio className="w-8 h-8" style={{ color: "#38bdf8" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">BintuNet</h1>
            <p className="text-sm text-muted-foreground">Stream Control Panel</p>
          </div>
        </div>

        {/* Status card */}
        <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
          {status === "loading" && (
            <>
              <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
              <div>
                <p className="font-semibold">Verifying invite link…</p>
                <p className="text-sm text-muted-foreground mt-1">Hang tight, logging you in.</p>
              </div>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <div>
                <p className="font-semibold text-emerald-600">Access granted!</p>
                <p className="text-sm text-muted-foreground mt-1">Redirecting to the dashboard…</p>
              </div>
              <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-emerald-500 animate-[width_1.5s_ease-in-out]" style={{ width: "100%", transition: "width 1.5s ease-in-out" }} />
              </div>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="w-10 h-10 text-destructive mx-auto" />
              <div>
                <p className="font-semibold text-destructive">Invalid invite link</p>
                <p className="text-sm text-muted-foreground mt-1">{message}</p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate("/")}
              >
                Go to login
              </Button>
            </>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Powered by FFmpeg · BintuNet Live
        </p>
      </div>
    </div>
  );
}
