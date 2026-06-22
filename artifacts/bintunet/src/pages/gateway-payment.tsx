/**
 * gateway-payment.tsx
 *
 * Public donation page at /gateway-payment
 * QR code on the stream links here — no login required.
 * Calls BintuNet's own /api/gateway/* endpoints (Paystack proxy).
 */

import { useState, useEffect, useCallback } from "react";

type View = "checkout" | "status" | "otp" | "threeds" | "receipt" | "error";
type Method = "mpesa" | "card";

interface CardState { number: string; expiry: string; cvv: string; name: string }
interface ReceiptData { amount: string; method: Method; masked: string; reference: string }

const GREEN = "#22c55e";
const DARK  = "#0f172a";

const SHEET: React.CSSProperties = {
  position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 10000,
  background: "#fff", borderRadius: "22px 22px 0 0",
  padding: "20px 20px 32px", transition: "transform 0.38s cubic-bezier(.32,1.1,.58,1)",
  maxHeight: "92vh", overflowY: "auto",
  boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
};
const IW: React.CSSProperties = { display: "flex", flexDirection: "column", marginBottom: 14 };
const IL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 };
const IF: React.CSSProperties = {
  padding: "11px 14px", borderRadius: 10, border: "1.5px solid #d1d5db",
  fontSize: 15, outline: "none", background: "#f9fafb", color: "#111827",
  transition: "border-color 0.2s",
};
const BTN: React.CSSProperties = {
  width: "100%", padding: "14px", borderRadius: 100, fontSize: 15, fontWeight: 700,
  cursor: "pointer", border: "none", background: GREEN, color: "#fff", marginBottom: 12,
  transition: "background 0.2s",
};
const DRAG = (
  <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
    <div style={{ width: 42, height: 4, borderRadius: 99, background: "#e5e7eb" }} />
  </div>
);

function formatCardNumber(v: string) {
  return v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
}
function formatExpiry(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}
function fmtCountdown(s: number) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function HeartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={GREEN} stroke="none">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  );
}

export default function GatewayPaymentPage() {
  const [isOpen, setIsOpen]       = useState(false);
  const [view, setView]           = useState<View>("checkout");
  const [method, setMethod]       = useState<Method>("mpesa");
  const [amount, setAmount]       = useState("");
  const [phone, setPhone]         = useState("");
  const [donorName, setDonorName] = useState("");
  const [card, setCard]           = useState<CardState>({ number: "", expiry: "", cvv: "", name: "" });
  const [receipt, setReceipt]     = useState<ReceiptData | null>(null);
  const [errorMsg, setErrorMsg]   = useState("");
  const [countdown, setCountdown] = useState(120);
  const [statusTitle, setStatusTitle] = useState("Processing…");
  const [statusDesc,  setStatusDesc]  = useState("Please wait while we confirm your payment.");
  const [reference, setReference] = useState("");
  const [otpCode, setOtpCode]     = useState("");
  const [otpAction, setOtpAction] = useState("submit_otp");
  const [otpLabel, setOtpLabel]   = useState("Enter OTP");
  const [otpHint, setOtpHint]     = useState("Check your phone for the OTP code.");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [iframeLoading, setIframeLoading] = useState(true);
  const [copied, setCopied]       = useState(false);
  const [streamName, setStreamName] = useState("BintuNet Live");
  const [healthy, setHealthy]     = useState<boolean | null>(null);

  const vis = (v: View) => view === v;

  // Track QR scan + fetch health on mount
  useEffect(() => {
    // Register this page load as a QR scan
    fetch("/api/gateway/scan", { method: "POST" }).catch(() => {});
    // Health check
    fetch("/api/gateway/health")
      .then(r => r.json())
      .then((d: { status: string }) => setHealthy(d.status === "ok"))
      .catch(() => setHealthy(false));
  }, []);

  // Start polling when reference is set
  useEffect(() => {
    if (!reference || view !== "status") return;
    let cancelled = false;
    const POLL_INTERVAL = 4000;
    const MAX_POLLS = 30;
    let polls = 0;

    const tick = async () => {
      if (cancelled || polls >= MAX_POLLS) {
        if (!cancelled) {
          setStatusTitle("Timed Out");
          setStatusDesc("We couldn't confirm your payment. Please check your phone and try again.");
        }
        return;
      }
      polls++;
      try {
        const r = await fetch(`/api/gateway/verify?reference=${encodeURIComponent(reference)}`);
        const d = await r.json() as { status: boolean; data?: { status: string; gateway_response: string; channel: string; amount: number } };
        if (!cancelled && d.status && d.data) {
          const s = d.data.status;
          if (s === "success") {
            const amountKes = (d.data.amount ?? 0) / 100;
            setReceipt({
              amount: `KES ${amountKes.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`,
              method,
              masked: method === "mpesa" ? phone.slice(-4).padStart(phone.length, "*") : `**** **** **** ${card.number.replace(/\s/g, "").slice(-4)}`,
              reference,
            });
            setView("receipt");
            return;
          }
          if (s === "failed") {
            setErrorMsg(d.data.gateway_response || "Payment was declined. Please try again.");
            setView("error");
            return;
          }
        }
      } catch {}
      if (!cancelled) setTimeout(tick, POLL_INTERVAL);
    };

    const timer = setTimeout(tick, 3000);
    const cdTimer = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(cdTimer); };
  }, [reference, view]);

  const showError = useCallback((msg: string) => { setErrorMsg(msg); setView("error"); }, []);

  const processMpesa = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt < 10) { showError("Enter a valid amount (minimum KES 10)."); return; }
    if (!phone) { showError("Enter your M-Pesa phone number."); return; }
    setCountdown(120); setStatusTitle("Sending STK Push…"); setStatusDesc("An M-Pesa prompt is being sent to your phone. Enter your PIN to confirm.");
    setView("status");
    try {
      const r = await fetch("/api/gateway/charge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mpesa", amount, phone, name: donorName || "Anonymous" }),
      });
      const d = await r.json() as { status: boolean; message?: string; data?: { reference: string; status: string } };
      if (!d.status) { showError(d.message || "Could not initiate payment."); return; }
      setReference(d.data?.reference ?? "");
    } catch { showError("Network error. Please try again."); }
  }, [amount, phone, donorName, showError]);

  const processCard = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt < 10) { showError("Enter a valid amount (minimum KES 10)."); return; }
    const cleanCard = card.number.replace(/\s/g, "");
    if (cleanCard.length < 13) { showError("Enter a valid card number."); return; }
    if (!card.expiry || !card.cvv || !card.name) { showError("All card fields are required."); return; }
    setCountdown(120); setStatusTitle("Processing Card…"); setStatusDesc("Verifying your card details securely.");
    setView("status");
    try {
      const r = await fetch("/api/gateway/charge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "card", amount, card_number: cleanCard, expiry: card.expiry, cvv: card.cvv, name: card.name }),
      });
      const d = await r.json() as { status: boolean; message?: string; data?: { reference: string; status: string; gateway_response: string; redirect_url?: string; display_text?: string } };
      if (!d.status) { showError(d.message || "Card charge declined."); return; }
      const s = d.data?.status ?? "";
      const ref = d.data?.reference ?? "";
      setReference(ref);
      if (s === "success") {
        setReceipt({ amount: `KES ${amt.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`, method: "card", masked: `**** **** **** ${cleanCard.slice(-4)}`, reference: ref });
        setView("receipt"); return;
      }
      if (s === "pay_offline" && d.data?.redirect_url) {
        setRedirectUrl(d.data.redirect_url); setIframeLoading(true); setView("threeds"); return;
      }
      if (s === "send_otp" || s === "send_pin" || s === "send_address" || s === "send_phone" || s === "send_birthday") {
        const labels: Record<string, [string, string, string]> = {
          send_otp:      ["Enter OTP",           "Check your phone for the one-time password.", "submit_otp"],
          send_pin:      ["Enter Card PIN",       "Enter your 4-digit card PIN to confirm.", "submit_pin"],
          send_address:  ["Enter Billing Address","Enter your billing address.", "submit_address"],
          send_phone:    ["Enter Phone Number",   "Enter the phone number registered with your card.", "submit_phone"],
          send_birthday: ["Enter Date of Birth",  "Enter your birthday (YYYY-MM-DD).", "submit_birthday"],
        };
        const [label, hint, action] = labels[s] ?? ["Enter Code", "Check your phone.", "submit_otp"];
        setOtpLabel(label); setOtpHint(hint); setOtpAction(action); setOtpCode(""); setView("otp"); return;
      }
      // pending/processing — start polling
      setStatusTitle("Awaiting Confirmation…");
      setStatusDesc(d.data?.gateway_response || "Your transaction is being processed.");
    } catch { showError("Network error. Please try again."); }
  }, [amount, card, showError]);

  const submitOtp = useCallback(async () => {
    if (!otpCode.trim()) return;
    setView("status"); setStatusTitle("Verifying…"); setStatusDesc("Confirming your details with the bank.");
    try {
      const r = await fetch("/api/gateway/charge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: otpAction, [otpAction.replace("submit_", "")]: otpCode, reference }),
      });
      const d = await r.json() as { status: boolean; message?: string; data?: { status: string; gateway_response: string; redirect_url?: string } };
      if (!d.status) { showError(d.message || "Code rejected. Please try again."); return; }
      const s = d.data?.status ?? "";
      if (s === "success") {
        const amt = parseFloat(amount);
        setReceipt({ amount: `KES ${amt.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`, method, masked: method === "mpesa" ? phone : `**** ${card.number.replace(/\s/g, "").slice(-4)}`, reference });
        setView("receipt");
      } else if (s === "pay_offline" && d.data?.redirect_url) {
        setRedirectUrl(d.data.redirect_url); setIframeLoading(true); setView("threeds");
      }
    } catch { showError("Network error. Please try again."); }
  }, [otpCode, otpAction, reference, amount, method, phone, card, showError]);

  const closeAll = () => { setIsOpen(false); setView("checkout"); setOtpCode(""); setReference(""); };
  const goBack = () => { setView("checkout"); setOtpCode(""); setReference(""); };
  const copyRef = () => { if (receipt?.reference) { navigator.clipboard.writeText(receipt.reference); setCopied(true); setTimeout(() => setCopied(false), 2000); } };

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(160deg, ${DARK} 0%, #0d1f0f 60%, #1a2e1a 100%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Inter', system-ui, sans-serif", position: "relative", overflow: "hidden" }}>
      {/* Animated background blobs */}
      <div style={{ position: "absolute", top: "10%", right: "-10%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,197,94,0.12) 0%, transparent 70%)", filter: "blur(60px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "5%", left: "-10%", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,197,94,0.07) 0%, transparent 70%)", filter: "blur(50px)", pointerEvents: "none" }} />

      {/* Hero */}
      <div style={{ textAlign: "center", maxWidth: 380, position: "relative", zIndex: 1 }}>
        <div style={{ width: 72, height: 72, background: "rgba(34,197,94,0.15)", border: "2px solid rgba(34,197,94,0.3)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <HeartIcon />
        </div>
        <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>Support the Stream</h1>
        <p style={{ margin: "0 0 32px", fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
          Send a donation via M-Pesa or card. It shows up live on the stream!
        </p>

        {/* Health badge */}
        {healthy !== null && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", borderRadius: 99, background: healthy ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", border: `1px solid ${healthy ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`, marginBottom: 28 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: healthy ? GREEN : "#ef4444", animation: "pulse 1.5s infinite" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: healthy ? GREEN : "#ef4444" }}>{healthy ? "LIVE — Accepting Donations" : "Gateway Unavailable"}</span>
          </div>
        )}

        <button
          onClick={() => { setIsOpen(true); setView("checkout"); }}
          style={{ ...BTN, fontSize: 16, padding: "16px 32px", borderRadius: 100, display: "inline-flex", alignItems: "center", gap: 10, justifyContent: "center", boxShadow: `0 4px 24px rgba(34,197,94,0.35)` }}
        >
          <HeartIcon />
          Donate Now
        </button>

        <p style={{ margin: "16px 0 0", fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
          Powered by Paystack · Secured by 256-bit SSL
        </p>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div onClick={closeAll} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", zIndex: 9999 }} />
      )}

      {/* ── CHECKOUT sheet ──────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("checkout") && isOpen ? "0%" : "110%"})`, zIndex: 10000 }}>
        {DRAG}
        <h3 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#111827" }}>
          💚 Make a Donation
        </h3>
        <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 20px" }}>All payments processed securely via Paystack</p>

        {/* Method tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "#f3f4f6", borderRadius: 12, padding: 4 }}>
          {(["mpesa", "card"] as Method[]).map(m => (
            <button key={m} onClick={() => setMethod(m)} style={{ flex: 1, padding: "10px 0", border: "none", cursor: "pointer", borderRadius: 9, fontSize: 13, fontWeight: 700, transition: "all 0.2s", background: method === m ? "#fff" : "transparent", color: method === m ? "#111827" : "#9ca3af", boxShadow: method === m ? "0 2px 8px rgba(0,0,0,0.1)" : "none" }}>
              {m === "mpesa" ? "📱 M-Pesa" : "💳 Card"}
            </button>
          ))}
        </div>

        {/* Donor name */}
        <div style={IW}>
          <label style={IL}>Your Name (optional)</label>
          <input value={donorName} onChange={e => setDonorName(e.target.value)} placeholder="e.g. John" style={IF} />
        </div>

        {/* Amount */}
        <div style={IW}>
          <label style={IL}>Amount (KES)</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 500" style={IF} min={10} />
        </div>

        {/* Quick amounts */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {[50, 100, 200, 500, 1000].map(a => (
            <button key={a} onClick={() => setAmount(String(a))} style={{ padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${amount === String(a) ? GREEN : "#e5e7eb"}`, background: amount === String(a) ? `rgba(34,197,94,0.08)` : "#f9fafb", color: amount === String(a) ? "#16a34a" : "#374151", transition: "all 0.15s" }}>
              KES {a}
            </button>
          ))}
        </div>

        {/* M-Pesa fields */}
        {method === "mpesa" && (
          <div style={IW}>
            <label style={IL}>M-Pesa Number</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="07XXXXXXXX" style={IF} />
            <span style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>An STK push will be sent to this number</span>
          </div>
        )}

        {/* Card fields */}
        {method === "card" && (
          <>
            <div style={IW}>
              <label style={IL}>Card Number</label>
              <input type="text" inputMode="numeric" value={card.number} onChange={e => setCard({ ...card, number: formatCardNumber(e.target.value) })} placeholder="1234 5678 9012 3456" maxLength={19} style={{ ...IF, letterSpacing: 2 }} />
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <div style={{ ...IW, flex: 1, marginBottom: 0 }}>
                <label style={IL}>Expiry</label>
                <input type="text" inputMode="numeric" value={card.expiry} onChange={e => setCard({ ...card, expiry: formatExpiry(e.target.value) })} placeholder="MM/YY" maxLength={5} style={IF} />
              </div>
              <div style={{ ...IW, flex: 1, marginBottom: 0 }}>
                <label style={IL}>CVV</label>
                <input type="password" inputMode="numeric" value={card.cvv} onChange={e => setCard({ ...card, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="•••" maxLength={4} style={IF} />
              </div>
            </div>
            <div style={IW}>
              <label style={IL}>Cardholder Name</label>
              <input type="text" value={card.name} onChange={e => setCard({ ...card, name: e.target.value.toUpperCase() })} placeholder="JOHN DOE" style={IF} />
            </div>
          </>
        )}

        <button onClick={method === "mpesa" ? processMpesa : processCard} style={{ ...BTN, boxShadow: `0 4px 20px rgba(34,197,94,0.3)` }}>
          {method === "mpesa" ? "💚 Pay via M-Pesa" : `💳 Donate KES ${amount || "0"}`}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", color: "#9ca3af", fontSize: 11 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          256-bit SSL · Secured by Paystack
        </div>
      </div>

      {/* ── STATUS sheet ─────────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("status") && isOpen ? "0%" : "110%"})`, zIndex: 10001 }}>
        {DRAG}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "10px 0" }}>
          <div style={{ width: 88, height: 88, borderRadius: "50%", background: "#f0fdf4", border: `4px solid #e0f2e9`, borderTopColor: GREEN, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20, animation: "spin 1.2s linear infinite" }}>
            <span style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#111827" }}>{fmtCountdown(countdown)}</span>
          </div>
          <h3 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800, color: "#111827" }}>{statusTitle}</h3>
          <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>{statusDesc}</p>
        </div>
      </div>

      {/* ── OTP sheet ────────────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("otp") && isOpen ? "0%" : "110%"})`, zIndex: 10002 }}>
        {DRAG}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <div style={{ width: 52, height: 52, background: "#f0fdf4", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          </div>
        </div>
        <h3 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800, color: "#111827", textAlign: "center" }}>{otpLabel}</h3>
        <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 20px", textAlign: "center", lineHeight: 1.5 }}>{otpHint}</p>
        <div style={{ ...IW }}>
          <input type="text" inputMode="numeric" value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••••" maxLength={8} autoFocus style={{ ...IF, textAlign: "center", fontSize: 26, letterSpacing: 8, fontWeight: 700 }} />
        </div>
        <button onClick={submitOtp} disabled={!otpCode.trim()} style={{ ...BTN, background: otpCode.trim() ? GREEN : "#d1fae5", color: otpCode.trim() ? "#fff" : "#6b7280", cursor: otpCode.trim() ? "pointer" : "default" }}>Confirm</button>
        <button onClick={goBack} style={{ ...BTN, background: "transparent", color: "#6b7280", border: "1.5px solid #e5e7eb" }}>Cancel</button>
      </div>

      {/* ── 3DS sheet ────────────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("threeds") && isOpen ? "0%" : "110%"})`, zIndex: 10003, padding: 0, display: "flex", flexDirection: "column", maxHeight: "92vh" }}>
        <div style={{ padding: "14px 20px 12px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, background: "#f0fdf4", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Bank Verification</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>3D Secure · Secured by your bank</div>
            </div>
          </div>
          <button onClick={goBack} style={{ background: "transparent", border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#6b7280" }}>Cancel</button>
        </div>
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {iframeLoading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#fff" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid #e5e7eb", borderTopColor: GREEN, animation: "spin 1s linear infinite", marginBottom: 12 }} />
              <div style={{ fontSize: 13, color: "#6b7280" }}>Loading bank page…</div>
            </div>
          )}
          {redirectUrl && <iframe src={redirectUrl} onLoad={() => setIframeLoading(false)} style={{ width: "100%", height: "100%", border: "none" }} title="Bank Authentication" allow="payment" />}
        </div>
      </div>

      {/* ── RECEIPT sheet ────────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("receipt") && isOpen ? "0%" : "110%"})`, zIndex: 10001 }}>
        {DRAG}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
          <div style={{ width: 68, height: 68, background: "#f0fdf4", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.8"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h3 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#111827" }}>💚 Thank You!</h3>
          <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0", textAlign: "center" }}>Your donation was processed successfully and is now showing on stream!</p>
        </div>
        <div style={{ background: "#f9fafb", border: "1.5px solid #e5e7eb", borderRadius: 16, padding: "18px 20px", marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 14, borderBottom: "1px dashed #e5e7eb" }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>Amount Donated</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>{receipt?.amount}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>Method</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{receipt?.method === "card" ? "Credit / Debit Card" : "M-Pesa"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>Status</span>
            <span style={{ background: "#f0fdf4", color: "#16a34a", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>CONFIRMED ✓</span>
          </div>
        </div>
        {receipt?.reference && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Transaction Reference</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 12, padding: "12px 14px" }}>
              <span style={{ flex: 1, fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#166534", wordBreak: "break-all" }}>{receipt.reference}</span>
              <button onClick={copyRef} style={{ flexShrink: 0, padding: "6px 12px", background: copied ? GREEN : "#111827", color: "#fff", border: "none", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{copied ? "Copied!" : "Copy"}</button>
            </div>
          </div>
        )}
        <button onClick={closeAll} style={{ ...BTN }}>Done</button>
      </div>

      {/* ── ERROR sheet ───────────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("error") && isOpen ? "0%" : "110%"})`, background: "#fffbfb", borderTop: "4px solid #ef4444", zIndex: 10002 }}>
        {DRAG}
        <div style={{ width: 48, height: 48, background: "#fef2f2", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444", marginBottom: 14 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: "#111827" }}>Payment Failed</h3>
        <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 20px" }}>{errorMsg}</p>
        <button onClick={goBack} style={{ ...BTN }}>Try Again</button>
        <button onClick={closeAll} style={{ ...BTN, background: "transparent", color: "#6b7280", border: "1.5px solid #e5e7eb" }}>Close</button>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
