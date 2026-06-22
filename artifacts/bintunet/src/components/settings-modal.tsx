import { useState, useRef, useEffect } from "react";
import { X, Upload, Trash2, CheckCircle2, AlertCircle, Cookie, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CookiesStatus {
  configured: boolean;
}

function CookiesSection({
  label,
  endpoint,
  hint,
}: {
  label: string;
  endpoint: string;
  hint: string;
}) {
  const [status, setStatus] = useState<CookiesStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch(endpoint, { credentials: "include" });
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  useEffect(() => { fetchStatus(); }, [endpoint]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData();
      form.append("cookies", file);
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message || "Cookies uploaded successfully.");
        await fetchStatus();
      } else {
        setError(data.message || "Upload failed.");
      }
    } catch {
      setError("Upload failed — check your connection.");
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onRemove = async () => {
    setRemoving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(endpoint, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message || "Cookies removed.");
        await fetchStatus();
      } else {
        setError(data.message || "Remove failed.");
      }
    } catch {
      setError("Remove failed — check your connection.");
    }
    setRemoving(false);
  };

  return (
    <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Cookie className="w-4 h-4 text-primary shrink-0" />
        <span className="font-semibold text-sm">{label}</span>
        {status && (
          <span className={`ml-auto text-xs font-medium flex items-center gap-1 ${status.configured ? "text-emerald-500" : "text-muted-foreground"}`}>
            {status.configured
              ? <><CheckCircle2 className="w-3.5 h-3.5" /> Configured</>
              : <><AlertCircle className="w-3.5 h-3.5" /> Not configured</>
            }
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>

      {error && (
        <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
      )}
      {success && (
        <p className="text-xs text-emerald-600 bg-emerald-500/10 rounded-lg px-3 py-2">{success}</p>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "Uploading…" : status?.configured ? "Replace cookies.txt" : "Upload cookies.txt"}
        </Button>
        {status?.configured && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-xs text-destructive hover:text-destructive"
            disabled={removing}
            onClick={onRemove}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {removing ? "Removing…" : "Remove"}
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={onUpload}
        />
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border bg-card shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Cookie className="w-5 h-5 text-primary" />
              Settings
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Upload browser cookies to authenticate with YouTube and TikTok.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-amber-600">Why cookies are required for YouTube</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
            YouTube enforces a <strong>Proof of Origin Token (rqh/1)</strong> on all live stream segments. Without a valid browser session, every segment download returns 403 Forbidden — regardless of User-Agent or IP. Uploading cookies from your logged-in YouTube session gives the server a valid token and unblocks streaming.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">How to export cookies.txt</h3>
          <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside leading-relaxed">
            <li>Install the <strong>"Get cookies.txt LOCALLY"</strong> extension for Chrome/Edge/Firefox</li>
            <li>Log into YouTube in your browser</li>
            <li>Navigate to <code className="bg-muted rounded px-1">youtube.com</code></li>
            <li>Click the extension icon → Export → <strong>Export as Netscape HTTP Cookie File</strong></li>
            <li>Save the file and upload it below</li>
          </ol>
          <a
            href="https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
          >
            <ExternalLink className="w-3 h-3" />
            Get cookies.txt LOCALLY (Chrome Web Store)
          </a>
        </div>

        <CookiesSection
          label="YouTube Cookies"
          endpoint="/api/settings/cookies"
          hint="Required for YouTube live sources. These cookies let yt-dlp authenticate with YouTube's CDN so segment downloads succeed."
        />

        <CookiesSection
          label="TikTok Cookies"
          endpoint="/api/settings/tiktok-cookies"
          hint="Optional — improves TikTok live stream access. Log in to TikTok in your browser, then export and upload cookies.txt."
        />
      </div>
    </div>
  );
}
