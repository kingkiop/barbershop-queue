import { addSmsLog } from "./firebase";

const uid = () => Math.random().toString(36).slice(2, 10);
const timeNow = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export async function sendSms(to, message) {
  // Log to Firebase
  const logEntry = {
    id: uid(),
    to,
    message,
    time: timeNow(),
    ts: Date.now(),
    status: "sending"
  };
  
  addSmsLog(logEntry);

  // Call serverless function to send real SMS
  try {
    const res = await fetch("/api/send-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, message }),
    });
    const data = await res.json();
    if (!data.success) {
      console.error("SMS failed:", data.error);
    }
  } catch (err) {
    console.error("SMS request failed:", err);
  }
}
