import { useState, useEffect, useRef } from "react";
import { subscribeToQueue, addToQueue, updateQueueEntry, subscribeToChairStates, setChairState, subscribeToSmsLog, clearAllData } from "./firebase";
import { sendSms } from "./sms";

// ═══════════════════════════════════════════
// CONFIG — Edit these to match your shop
// ═══════════════════════════════════════════
const CHAIRS = [
  { id: 1, label: "Chair 1" },
  { id: 2, label: "Chair 2" },
  { id: 3, label: "Chair 3" },
  { id: 4, label: "Chair 4" },
  { id: 5, label: "Chair 5" },
  { id: 6, label: "Chair 6" },
];

const SERVICES = [
  { id: "standard", name: "Standard Haircut", minutes: 45 },
  { id: "fade", name: "Fade Haircut", minutes: 60 },
  { id: "beard", name: "Beard Trim", minutes: 15 },
  { id: "combo", name: "Haircut + Beard", minutes: 75 },
  { id: "kids", name: "Kids Haircut", minutes: 30 },
  { id: "lineup", name: "Line Up / Shape Up", minutes: 25 },
];

const RESET_DELAY = 8000;

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
const uid = () => Math.random().toString(36).slice(2, 10);
const minsAgo = (iso) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m + "m ago";
};

const calcWait = (queue, chairId, joinedAt) =>
  queue
    .filter(q => q.chairId === chairId && q.status === "waiting" && new Date(q.joinedAt) < new Date(joinedAt))
    .reduce((sum, q) => sum + q.serviceTime, 0);

const calcTotalWait = (queue, chairId) =>
  queue.filter(q => q.chairId === chairId && q.status === "waiting").reduce((sum, q) => sum + q.serviceTime, 0);

const getPos = (queue, chairId, joinedAt) =>
  queue.filter(q => q.chairId === chairId && q.status === "waiting" && new Date(q.joinedAt) < new Date(joinedAt)).length + 1;

// ═══════════════════════════════════════════
// SMS TOAST
// ═══════════════════════════════════════════
function SmsToast({ log }) {
  const [visible, setVisible] = useState(null);
  const prevLen = useRef(log.length);
  useEffect(() => {
    if (log.length > prevLen.current) {
      setVisible(log[log.length - 1]);
      const t = setTimeout(() => setVisible(null), 5000);
      prevLen.current = log.length;
      return () => clearTimeout(t);
    }
  }, [log.length]);
  if (!visible) return null;
  return (
    <div style={s.toast} onClick={() => setVisible(null)}>
      <div style={s.toastDot}>📲</div>
      <div style={s.toastContent}>
        <div style={s.toastHead}>SMS to {visible.to}</div>
        <div style={s.toastBody}>{visible.message}</div>
      </div>
      <span style={s.toastX}>✕</span>
    </div>
  );
}

// ═══════════════════════════════════════════
// CUSTOMER TABLET
// ═══════════════════════════════════════════
function CustomerTablet({ queue, chairStates, onJoin }) {
  const [step, setStep] = useState("chair");
  const [chairId, setChairId] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notifPref, setNotifPref] = useState("sms");
  const [serviceTime, setServiceTime] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const resetTimer = useRef(null);

  const reset = () => {
    setStep("chair"); setChairId(null); setName(""); setPhone("");
    setNotifPref("sms"); setServiceTime(null); setSelectedService(null); setConfirmed(null);
  };

  useEffect(() => {
    if (confirmed) {
      resetTimer.current = setTimeout(reset, RESET_DELAY);
      return () => clearTimeout(resetTimer.current);
    }
  }, [confirmed]);

  const getWaiting = (cid) => queue.filter(q => q.chairId === cid && q.status === "waiting").length;
  const getWaitTime = (cid) => calcTotalWait(queue, cid);

  if (step === "chair") {
    return (
      <div style={s.cPage}>
        <div style={s.cTop}>
          <div style={s.cLogoMark}>✂</div>
          <h1 style={s.cTitle}>JOIN THE LINE</h1>
          <p style={s.cSub}>Tap your chair to get started</p>
        </div>
        <div style={s.cChairList}>
          {CHAIRS.map(c => {
            const state = chairStates[c.id] || "active";
            const closed = state === "closed";
            const onBreak = state === "break";
            const w = getWaiting(c.id);
            const wt = getWaitTime(c.id);
            return (
              <button key={c.id} disabled={closed}
                onClick={() => { setChairId(c.id); setStep("info"); }}
                style={{ ...s.cChairBtn, ...(closed ? s.cChairClosed : {}), ...(onBreak ? s.cChairBreak : {}) }}>
                <div style={s.cChairNum}>{c.label}</div>
                {closed ? (
                  <div style={s.cChairStatus}>Closed for today</div>
                ) : onBreak ? (
                  <div style={{ ...s.cChairStatus, color: "#fbbf24" }}>On break · {w} waiting</div>
                ) : w === 0 ? (
                  <div style={{ ...s.cChairStatus, color: "#4ade80" }}>No wait</div>
                ) : (
                  <div style={s.cChairStatus}>{w} in line · ~{wt} min</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (step === "info") {
    const chair = CHAIRS.find(c => c.id === chairId);
    const state = chairStates[chairId] || "active";
    const onBreak = state === "break";
    const canJoin = name.trim() && phone.trim() && serviceTime && selectedService;
    const handleJoin = () => {
      if (!canJoin) return;
      const svc = SERVICES.find(sv => sv.id === selectedService);
      const entry = {
        id: uid(), name: name.trim(), phone: phone.trim(), notifPref,
        chairId, serviceTime, serviceName: svc ? svc.name : "", status: "waiting", joinedDuringBreak: onBreak,
        joinedAt: new Date().toISOString(),
      };
      const pos = getWaiting(chairId) + 1;
      const wait = calcTotalWait(queue, chairId);
      onJoin(entry);
      setConfirmed({ ...entry, pos, wait });
      setStep("confirm");
    };

    return (
      <div style={s.cPage}>
        <button style={s.cBack} onClick={() => setStep("chair")}>← Back</button>
        <div style={s.cFormHead}>
          <div style={s.cFormChair}>{chair.label}</div>
          {onBreak && (
            <div style={s.cBreakNotice}>
              ⏸ This chair is on break. You can still join — we'll text you when they're back and your wait begins.
            </div>
          )}
        </div>
        <div style={s.cFieldGroup}>
          <label style={s.cLabel}>WHAT DO YOU NEED?</label>
          <div style={s.cServiceList}>
            {SERVICES.map(svc => {
              const sel = serviceTime === svc.minutes && selectedService === svc.id;
              return (
                <button key={svc.id} onClick={() => { setServiceTime(svc.minutes); setSelectedService(svc.id); }}
                  style={{ ...s.cServiceBtn, ...(sel ? s.cServiceSel : {}) }}>
                  <div style={s.cServiceName}>{svc.name}</div>
                  <div style={s.cServiceTime}>{svc.minutes >= 60 ? (svc.minutes === 60 ? "1 hr" : Math.floor(svc.minutes / 60) + " hr " + (svc.minutes % 60) + " min") : svc.minutes + " min"}</div>
                </button>
              );
            })}
          </div>
        </div>
        <div style={s.cFieldGroup}>
          <label style={s.cLabel}>YOUR INFO</label>
          <input style={s.cInput} placeholder="Your name" value={name}
            onChange={e => setName(e.target.value)} autoComplete="off" />
          <input style={{ ...s.cInput, marginTop: 8 }} placeholder="Phone number" value={phone}
            onChange={e => setPhone(e.target.value)} type="tel" />
        </div>
        <div style={s.cFieldGroup}>
          <label style={s.cLabel}>NOTIFY ME VIA</label>
          <div style={s.cToggleRow}>
            {["sms", "whatsapp"].map(t => (
              <button key={t} onClick={() => setNotifPref(t)}
                style={{ ...s.cToggle, ...(notifPref === t ? s.cToggleOn : {}) }}>
                {t === "sms" ? "📲 SMS" : "💬 WhatsApp"}
              </button>
            ))}
          </div>
        </div>
        <button disabled={!canJoin} onClick={handleJoin}
          style={{ ...s.cJoinBtn, opacity: canJoin ? 1 : 0.3 }}>
          Join the Line →
        </button>
      </div>
    );
  }

  if (step === "confirm" && confirmed) {
    const chair = CHAIRS.find(c => c.id === confirmed.chairId);
    const onBreak = chairStates[confirmed.chairId] === "break";
    const ahead = confirmed.pos - 1;
    return (
      <div style={s.cPage}>
        <div style={s.cConfirm}>
          <div style={s.cCheckCircle}>✓</div>
          <h2 style={s.cConfirmTitle}>You're in line!</h2>
          <div style={s.cConfirmCard}>
            <div style={s.cConfirmRow}><span>Service</span><strong>{confirmed.serviceName}</strong></div>
            <div style={s.cConfirmRow}><span>Chair</span><strong>{chair.label}</strong></div>
            <div style={s.cConfirmRow}><span>Ahead of you</span><strong>{ahead} {ahead === 1 ? "person" : "people"}</strong></div>
            <div style={s.cConfirmRow}><span>Est. wait</span><strong>{onBreak ? "After break" : "~" + confirmed.wait + " min"}</strong></div>
          </div>
          <div style={s.cConfirmMsg}>
            {onBreak
              ? "This chair is on break. We'll text " + confirmed.phone + " when they're back and your wait begins."
              : "You're free to leave — we'll text " + confirmed.phone + " with updates and when you're next."
            }
          </div>
          <div style={s.cAutoReset}>Screen resets in a few seconds</div>
          <button style={s.cResetBtn} onClick={reset}>Done</button>
        </div>
      </div>
    );
  }
  return null;
}

// ═══════════════════════════════════════════
// BARBER TABLET
// ═══════════════════════════════════════════
function BarberTablet({ queue, chairStates, onNext, onPause, onResume, onEndDay, onClearDay, smsLog }) {
  const [sel, setSel] = useState(null);
  const getQ = (cid) => queue.filter(q => q.chairId === cid && q.status === "waiting")
    .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));

  if (!sel) {
    return (
      <div style={s.bPage}>
        <div style={s.bHeader}>
          <h1 style={s.bTitle}>💈 Barber Panel</h1>
          <p style={s.bSub}>Tap your chair</p>
        </div>
        <div style={s.bChairGrid}>
          {CHAIRS.map(c => {
            const cq = getQ(c.id);
            const state = chairStates[c.id] || "active";
            const breakCount = cq.filter(q => q.joinedDuringBreak).length;
            return (
              <button key={c.id} onClick={() => setSel(c.id)} style={s.bChairCard}>
                <div style={s.bChairLabel}>{c.label}</div>
                <div style={{
                  ...s.bChairState,
                  color: state === "active" ? "#4ade80" : state === "break" ? "#fbbf24" : "#f87171"
                }}>
                  {state === "active" ? "Active" : state === "break" ? "On Break" : "Closed"}
                </div>
                <div style={s.bChairCount}>{cq.length} in line</div>
                {state === "break" && breakCount > 0 && (
                  <div style={s.bBreakJoined}>+{breakCount} joined on break</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Clear day button */}
        <button style={s.bClearDay} onClick={onClearDay}>
          🗑 Clear All — New Day
        </button>

        {smsLog.length > 0 && (
          <div style={s.bSmsSection}>
            <div style={s.bSmsTitle}>📨 Recent Messages Sent</div>
            {smsLog.slice(-6).reverse().map((m, i) => (
              <div key={m._key || i} style={s.bSmsRow}>
                <span style={s.bSmsDot}>📲</span>
                <span style={s.bSmsTo}>{m.to}</span>
                <span style={s.bSmsMsg}>{m.message && m.message.length > 55 ? m.message.slice(0, 55) + "…" : m.message}</span>
                <span style={s.bSmsTime}>{m.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const chair = CHAIRS.find(c => c.id === sel);
  const cq = getQ(sel);
  const state = chairStates[sel] || "active";

  return (
    <div style={s.bPage}>
      <button style={s.bBack} onClick={() => setSel(null)}>← All Chairs</button>
      <div style={s.bQueueHeader}>
        <div>
          <h2 style={s.bQueueTitle}>{chair.label}</h2>
          <div style={{
            ...s.bQueueState,
            color: state === "active" ? "#4ade80" : state === "break" ? "#fbbf24" : "#f87171"
          }}>
            {state === "active" ? "● Active" : state === "break" ? "⏸ On Break" : "■ Closed"}
          </div>
        </div>
        <div style={s.bQueueCount}>{cq.length}</div>
      </div>

      <div style={s.bControls}>
        {state === "active" && (
          <>
            <button style={s.bCtrlPause} onClick={() => onPause(sel)}>⏸ Break</button>
            <button style={s.bCtrlEnd} onClick={() => onEndDay(sel)}>■ End Day</button>
          </>
        )}
        {state === "break" && (
          <>
            <button style={s.bCtrlResume} onClick={() => onResume(sel)}>▶ Resume</button>
            <button style={s.bCtrlEnd} onClick={() => onEndDay(sel)}>■ End Day</button>
          </>
        )}
        {state === "closed" && cq.length === 0 && (
          <div style={s.bClosedMsg}>Chair is closed for today.</div>
        )}
      </div>

      {cq.length === 0 ? (
        <div style={s.bEmpty}>{state === "closed" ? "Done for the day ✂️" : "No one in line"}</div>
      ) : (
        <div style={s.bQueueList}>
          {cq.map((entry, idx) => {
            const isNxt = idx === 0;
            const waitAhead = cq.slice(0, idx).reduce((sum, q) => sum + q.serviceTime, 0);
            return (
              <div key={entry._key || entry.id} style={{
                ...s.bCard,
                ...(isNxt ? s.bCardNext : {}),
                ...(entry.joinedDuringBreak ? s.bCardBreak : {}),
              }}>
                {isNxt && <div style={s.bNextLabel}>⬆ NEXT</div>}
                {entry.joinedDuringBreak && <div style={s.bBreakLabel}>Joined during break</div>}
                <div style={s.bCardTop}>
                  <div>
                    <div style={s.bCardName}>{entry.name}</div>
                    <div style={s.bCardPhone}>{entry.phone} · {entry.notifPref === "whatsapp" ? "💬" : "📲"}</div>
                  </div>
                  <div style={s.bCardRight}>
                    <div style={s.bCardPos}>#{idx + 1}</div>
                    <div style={s.bCardService}>{entry.serviceName || entry.serviceTime + "m"}</div>
                  </div>
                </div>
                <div style={s.bCardMeta}>
                  Joined {minsAgo(entry.joinedAt)} · {waitAhead > 0 ? "~" + waitAhead + "m wait" : "ready"}
                </div>
                {isNxt && state !== "closed" && (
                  <button style={s.bNextBtn} onClick={() => onNext(sel)}>
                    ✂️ NEXT — Done with this cut
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════
export default function App() {
  const [view, setView] = useState("customer");
  const [queue, setQueue] = useState([]);
  const [chairStates, setChairStates] = useState({});
  const [smsLog, setSmsLog] = useState([]);
  const [, setTick] = useState(0);

  // Subscribe to Firebase real-time data
  useEffect(() => {
    const unsub1 = subscribeToQueue(setQueue);
    const unsub2 = subscribeToChairStates(setChairStates);
    const unsub3 = subscribeToSmsLog(setSmsLog);
    const timer = setInterval(() => setTick(x => x + 1), 15000);
    return () => { unsub1(); unsub2(); unsub3(); clearInterval(timer); };
  }, []);

  const handleJoin = (entry) => {
    addToQueue(entry);
    const pos = queue.filter(q => q.chairId === entry.chairId && q.status === "waiting").length + 1;
    const wait = calcTotalWait(queue, entry.chairId);
    const chair = CHAIRS.find(c => c.id === entry.chairId);
    const onBreak = chairStates[entry.chairId] === "break";

    if (onBreak) {
      sendSms(entry.phone, "Hey " + entry.name + "! You're #" + pos + " in line for " + chair.label + ". The barber is on break — we'll text you when they're back and your wait begins.");
    } else {
      sendSms(entry.phone, "Hey " + entry.name + "! You're #" + pos + " in line for " + chair.label + ". ~" + wait + " min wait. We'll text you as the line moves. You're free to leave!");
    }
  };

  const handleNext = (chairId) => {
    const cq = queue
      .filter(q => q.chairId === chairId && q.status === "waiting")
      .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
    if (!cq.length) return;

    // Mark first person as served
    updateQueueEntry(cq[0]._key, { status: "served" });

    const remaining = cq.slice(1);
    const chair = CHAIRS.find(c => c.id === chairId);

    remaining.forEach((q, i) => {
      if (i === 0) {
        sendSms(q.phone, "🔔 " + q.name + ", YOU'RE NEXT! Head back to the shop — " + chair.label + " is ready for you!");
      } else {
        const wait = remaining.slice(0, i).reduce((sum, r) => sum + r.serviceTime, 0);
        sendSms(q.phone, "📍 " + q.name + ", you moved up! Now #" + (i + 1) + " for " + chair.label + ". ~" + wait + " min wait.");
      }
    });
  };

  const handlePause = (chairId) => {
    setChairState(chairId, "break");
    const chair = CHAIRS.find(c => c.id === chairId);
    queue.filter(q => q.chairId === chairId && q.status === "waiting").forEach(q => {
      sendSms(q.phone, "⏸ " + q.name + ", " + chair.label + " is taking a break. Your spot is saved — we'll text you when they're back.");
    });
  };

  const handleResume = (chairId) => {
    setChairState(chairId, "active");
    const chair = CHAIRS.find(c => c.id === chairId);

    const waiting = queue
      .filter(q => q.chairId === chairId && q.status === "waiting")
      .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));

    // Clear break flags
    waiting.forEach(q => {
      updateQueueEntry(q._key, { joinedDuringBreak: false });
    });

    waiting.forEach((q, i) => {
      const wait = waiting.slice(0, i).reduce((sum, r) => sum + r.serviceTime, 0);
      if (i === 0) {
        sendSms(q.phone, "▶ " + q.name + ", " + chair.label + " is back! YOU'RE NEXT — head to the shop!");
      } else {
        sendSms(q.phone, "▶ " + q.name + ", " + chair.label + " is back! You're #" + (i + 1) + " in line. ~" + wait + " min wait.");
      }
    });
  };

  const handleEndDay = (chairId) => {
    setChairState(chairId, "closed");
    const chair = CHAIRS.find(c => c.id === chairId);
    const waiting = queue.filter(q => q.chairId === chairId && q.status === "waiting");
    waiting.forEach(q => {
      sendSms(q.phone, q.name + ", " + chair.label + " is done for the day. Sorry we couldn't get to you — come back tomorrow!");
      updateQueueEntry(q._key, { status: "cleared" });
    });
  };

  const handleClearDay = () => {
    if (window.confirm("Clear everything and start a fresh day? This removes all queues and resets all chairs.")) {
      clearAllData();
    }
  };

  return (
    <div style={s.root}>
      <div style={s.nav}>
        <button onClick={() => setView("customer")}
          style={{ ...s.navBtn, ...(view === "customer" ? s.navOn : {}) }}>
          📱 Customer Tablet
        </button>
        <button onClick={() => setView("barber")}
          style={{ ...s.navBtn, ...(view === "barber" ? s.navOn : {}) }}>
          ✂️ Barber Tablet
        </button>
      </div>
      <SmsToast log={smsLog} />
      {view === "customer"
        ? <CustomerTablet queue={queue} chairStates={chairStates} onJoin={handleJoin} />
        : <BarberTablet queue={queue} chairStates={chairStates}
            onNext={handleNext} onPause={handlePause} onResume={handleResume}
            onEndDay={handleEndDay} onClearDay={handleClearDay} smsLog={smsLog} />
      }
    </div>
  );
}

// ═══════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════
const s = {
  root: { fontFamily: "'Outfit', 'DM Sans', system-ui, sans-serif", background: "#0a0a0c", color: "#e2e0db", minHeight: "100vh", maxWidth: 600, margin: "0 auto", WebkitFontSmoothing: "antialiased" },
  nav: { display: "flex", gap: 4, padding: "8px 10px", background: "#101013", borderBottom: "1px solid #222228", position: "sticky", top: 0, zIndex: 300 },
  navBtn: { flex: 1, padding: "10px", border: "none", borderRadius: 8, background: "transparent", color: "#5a5a65", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all .15s" },
  navOn: { background: "linear-gradient(135deg, #e8a821, #c98b0e)", color: "#0a0a0c" },
  toast: { position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 999, background: "#1a1a1e", border: "1px solid #333", borderRadius: 14, padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", maxWidth: 360, width: "92%", boxShadow: "0 20px 60px rgba(0,0,0,.7)" },
  toastDot: { fontSize: 22, flexShrink: 0 },
  toastContent: { flex: 1 },
  toastHead: { fontSize: 10, fontWeight: 700, color: "#777", textTransform: "uppercase", letterSpacing: ".06em" },
  toastBody: { fontSize: 12, color: "#ddd", marginTop: 2, lineHeight: 1.4 },
  toastX: { color: "#555", fontSize: 14, cursor: "pointer", padding: 4 },
  cPage: { padding: "16px 16px 40px" },
  cTop: { textAlign: "center", padding: "24px 0 20px" },
  cLogoMark: { fontSize: 36, width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg, #e8a821, #c98b0e)", color: "#0a0a0c", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", fontWeight: 700 },
  cTitle: { fontSize: 26, fontWeight: 900, letterSpacing: ".06em", margin: 0, color: "#e8a821" },
  cSub: { fontSize: 13, color: "#5a5a65", marginTop: 6 },
  cChairList: { display: "flex", flexDirection: "column", gap: 6 },
  cChairBtn: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 16px", borderRadius: 12, border: "2px solid #1e1e24", background: "#111115", cursor: "pointer", fontFamily: "inherit", color: "#e2e0db", transition: "all .15s", textAlign: "left" },
  cChairClosed: { opacity: 0.35, cursor: "not-allowed" },
  cChairBreak: { borderColor: "#3d3520", background: "#16140e" },
  cChairNum: { fontSize: 17, fontWeight: 700 },
  cChairStatus: { fontSize: 12, color: "#5a5a65", fontWeight: 600 },
  cBack: { background: "none", border: "none", color: "#5a5a65", fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: "8px 0 12px" },
  cFormHead: { marginBottom: 20 },
  cFormChair: { fontSize: 22, fontWeight: 800, color: "#e8a821" },
  cBreakNotice: { fontSize: 12, color: "#fbbf24", background: "#1c1a11", borderRadius: 10, padding: "10px 12px", marginTop: 10, lineHeight: 1.5, border: "1px solid #332e16" },
  cFieldGroup: { marginBottom: 18 },
  cLabel: { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "#4a4a55", marginBottom: 8 },
  cInput: { width: "100%", padding: "14px 14px", borderRadius: 10, border: "1px solid #222228", background: "#111115", color: "#e2e0db", fontSize: 15, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
  cToggleRow: { display: "flex", gap: 8 },
  cToggle: { flex: 1, padding: "12px", borderRadius: 10, border: "2px solid #222228", background: "#111115", color: "#777", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  cToggleOn: { borderColor: "#e8a821", background: "#1c1a11", color: "#fbbf24" },
  cServiceList: { display: "flex", flexDirection: "column", gap: 6 },
  cServiceBtn: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 16px", borderRadius: 12, border: "2px solid #1e1e24", background: "#111115", cursor: "pointer", fontFamily: "inherit", color: "#e2e0db", transition: "all .15s", textAlign: "left" },
  cServiceSel: { borderColor: "#e8a821", background: "#1c1a11", boxShadow: "0 0 20px rgba(232,168,33,.1)" },
  cServiceName: { fontSize: 15, fontWeight: 700 },
  cServiceTime: { fontSize: 12, color: "#4a4a55", fontWeight: 600 },
  cJoinBtn: { width: "100%", padding: "16px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #e8a821, #c98b0e)", color: "#0a0a0c", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", marginTop: 8 },
  cConfirm: { textAlign: "center", padding: "40px 0" },
  cCheckCircle: { width: 60, height: 60, borderRadius: "50%", background: "#16a34a", color: "#fff", fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" },
  cConfirmTitle: { fontSize: 22, fontWeight: 900, margin: 0 },
  cConfirmCard: { background: "#111115", borderRadius: 12, padding: 16, margin: "16px auto", maxWidth: 300, textAlign: "left", border: "1px solid #222228" },
  cConfirmRow: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1a1a1e", fontSize: 14, color: "#999" },
  cConfirmMsg: { fontSize: 13, color: "#777", margin: "16px auto", maxWidth: 300, lineHeight: 1.5 },
  cAutoReset: { fontSize: 11, color: "#3a3a44", marginTop: 12 },
  cResetBtn: { marginTop: 12, padding: "10px 24px", borderRadius: 8, border: "1px solid #222228", background: "transparent", color: "#777", fontSize: 12, cursor: "pointer", fontFamily: "inherit" },
  bPage: { padding: "16px 14px 40px" },
  bHeader: { marginBottom: 20 },
  bTitle: { fontSize: 22, fontWeight: 900, margin: 0 },
  bSub: { fontSize: 12, color: "#5a5a65", marginTop: 2 },
  bChairGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  bChairCard: { padding: "16px 12px", borderRadius: 12, border: "1px solid #1e1e24", background: "#111115", cursor: "pointer", fontFamily: "inherit", color: "#e2e0db", textAlign: "center", transition: "all .15s" },
  bChairLabel: { fontSize: 16, fontWeight: 700 },
  bChairState: { fontSize: 11, fontWeight: 700, marginTop: 4 },
  bChairCount: { fontSize: 12, color: "#5a5a65", marginTop: 4 },
  bBreakJoined: { fontSize: 10, color: "#fbbf24", marginTop: 4, fontWeight: 600 },
  bClearDay: { width: "100%", padding: "12px", borderRadius: 10, border: "1px solid #2a1515", background: "transparent", color: "#f87171", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 16 },
  bBack: { background: "none", border: "none", color: "#5a5a65", fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: "6px 0 14px" },
  bQueueHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  bQueueTitle: { fontSize: 22, fontWeight: 800, margin: 0 },
  bQueueState: { fontSize: 12, fontWeight: 700, marginTop: 2 },
  bQueueCount: { fontSize: 28, fontWeight: 900, color: "#e8a821", background: "#1c1a11", borderRadius: 12, padding: "8px 16px" },
  bControls: { display: "flex", gap: 8, marginBottom: 16 },
  bCtrlPause: { flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "#44370a", color: "#fbbf24", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  bCtrlEnd: { flex: 1, padding: "12px", borderRadius: 10, border: "1px solid #3a2020", background: "transparent", color: "#f87171", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  bCtrlResume: { flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  bClosedMsg: { fontSize: 13, color: "#5a5a65", padding: "10px 0" },
  bEmpty: { fontSize: 14, color: "#3a3a44", textAlign: "center", padding: "40px 0" },
  bQueueList: { display: "flex", flexDirection: "column", gap: 6 },
  bCard: { background: "#111115", borderRadius: 12, padding: 14, border: "1px solid #1e1e24" },
  bCardNext: { borderColor: "#e8a821", background: "#14120b" },
  bCardBreak: { borderLeft: "3px solid #fbbf24", background: "#13120d" },
  bNextLabel: { fontSize: 9, fontWeight: 800, color: "#e8a821", letterSpacing: ".08em", marginBottom: 6 },
  bBreakLabel: { fontSize: 9, fontWeight: 700, color: "#fbbf24", marginBottom: 6 },
  bCardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  bCardName: { fontSize: 15, fontWeight: 700 },
  bCardPhone: { fontSize: 11, color: "#4a4a55", marginTop: 2 },
  bCardRight: { textAlign: "right" },
  bCardPos: { fontSize: 13, fontWeight: 700, color: "#4a4a55" },
  bCardService: { fontSize: 11, color: "#e8a821", fontWeight: 600, marginTop: 2 },
  bCardMeta: { fontSize: 11, color: "#3a3a44", marginTop: 6 },
  bNextBtn: { width: "100%", padding: "12px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginTop: 10 },
  bSmsSection: { marginTop: 24, borderTop: "1px solid #1e1e24", paddingTop: 14 },
  bSmsTitle: { fontSize: 11, fontWeight: 700, color: "#4a4a55", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".06em" },
  bSmsRow: { display: "flex", alignItems: "center", gap: 6, padding: "6px 0", borderBottom: "1px solid #141418", fontSize: 11 },
  bSmsDot: { fontSize: 12, flexShrink: 0 },
  bSmsTo: { color: "#777", fontWeight: 600, minWidth: 90 },
  bSmsMsg: { flex: 1, color: "#4a4a55", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  bSmsTime: { color: "#333", fontSize: 10, flexShrink: 0 },
};
