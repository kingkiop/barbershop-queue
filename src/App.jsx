import { useState, useEffect, useRef } from "react";
import { subscribeToQueue, addToQueue, updateQueueEntry, subscribeToChairStates, setChairState, subscribeToSmsLog, clearAllData } from "./firebase";
import { sendSms } from "./sms";

// ═══════════════════════════════════════════
// CONFIG
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
const fmtMin = (m) => m >= 60 ? (m % 60 === 0 ? Math.floor(m/60) + " hr" : Math.floor(m/60) + " hr " + (m%60) + " min") : m + " min";

const calcTotalWait = (queue, chairId) =>
  queue.filter(q => q.chairId === chairId && q.status === "waiting").reduce((sum, q) => sum + q.serviceTime, 0);

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
// Steps: chair → service → info → confirm
// ═══════════════════════════════════════════
function CustomerTablet({ queue, chairStates, onJoin }) {
  const [step, setStep] = useState("chair");
  const [chairId, setChairId] = useState(null);
  const [serviceId, setServiceId] = useState(null);
  const [serviceTime, setServiceTime] = useState(null);
  const [serviceName, setServiceName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [confirmed, setConfirmed] = useState(null);
  const resetTimer = useRef(null);

  const reset = () => {
    setStep("chair"); setChairId(null); setServiceId(null);
    setServiceTime(null); setServiceName(""); setName(""); setPhone("");
    setConfirmed(null);
  };

  useEffect(() => {
    if (confirmed) {
      resetTimer.current = setTimeout(reset, RESET_DELAY);
      return () => clearTimeout(resetTimer.current);
    }
  }, [confirmed]);

  const getWaiting = (cid) => queue.filter(q => q.chairId === cid && q.status === "waiting").length;
  const getWaitTime = (cid) => calcTotalWait(queue, cid);

  // ── Step 1: Pick Chair ──
  if (step === "chair") {
    return (
      <div style={s.cPage}>
        <div style={s.cTop}>
          <div style={s.cLogoMark}>✂</div>
          <h1 style={s.cTitle}>PICK YOUR CHAIR</h1>
        </div>
        <div style={s.cChairGrid}>
          {CHAIRS.map(c => {
            const state = chairStates[c.id] || "active";
            const closed = state === "closed";
            const onBreak = state === "break";
            const w = getWaiting(c.id);
            const wt = getWaitTime(c.id);
            return (
              <button key={c.id} disabled={closed}
                onClick={() => { setChairId(c.id); setStep("service"); }}
                style={{
                  ...s.cChairBtn,
                  ...(closed ? s.cChairClosed : {}),
                  ...(onBreak ? s.cChairOnBreak : {}),
                }}>
                <div style={s.cChairNum}>{c.id}</div>
                <div style={s.cChairLabel}>{c.label}</div>
                {closed ? (
                  <div style={s.cChairMeta}>Closed</div>
                ) : onBreak ? (
                  <div style={{ ...s.cChairMeta, color: "#facc15" }}>On break</div>
                ) : w === 0 ? (
                  <div style={{ ...s.cChairMeta, color: "#4ade80" }}>Open</div>
                ) : (
                  <div style={s.cChairMeta}>{w} waiting · ~{wt}m</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Step 2: Pick Service ──
  if (step === "service") {
    const chair = CHAIRS.find(c => c.id === chairId);
    const state = chairStates[chairId] || "active";
    const onBreak = state === "break";
    return (
      <div style={s.cPage}>
        <button style={s.cBack} onClick={() => setStep("chair")}>← Back</button>
        <div style={s.cStepHeader}>
          <div style={s.cStepChip}>{chair.label}</div>
          {onBreak && <div style={s.cBreakTag}>On break — you can still join</div>}
        </div>
        <h2 style={s.cStepTitle}>WHAT DO YOU NEED?</h2>
        <div style={s.cServiceList}>
          {SERVICES.map(svc => (
            <button key={svc.id}
              onClick={() => {
                setServiceId(svc.id);
                setServiceTime(svc.minutes);
                setServiceName(svc.name);
                setStep("info");
              }}
              style={s.cServiceBtn}>
              <div style={s.cServiceName}>{svc.name}</div>
              <div style={s.cServiceTime}>{fmtMin(svc.minutes)}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Step 3: Name + Phone ──
  if (step === "info") {
    const canJoin = name.trim() && phone.trim();
    const handleJoin = () => {
      if (!canJoin) return;
      const entry = {
        id: uid(), name: name.trim(), phone: phone.trim(),
        chairId, serviceTime, serviceName,
        status: "waiting",
        joinedDuringBreak: (chairStates[chairId] || "active") === "break",
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
        <button style={s.cBack} onClick={() => setStep("service")}>← Back</button>
        <div style={s.cStepHeader}>
          <div style={s.cStepChip}>{CHAIRS.find(c => c.id === chairId)?.label}</div>
          <div style={s.cStepService}>{serviceName}</div>
        </div>
        <h2 style={s.cStepTitle}>YOUR INFO</h2>
        <div style={s.cFieldGroup}>
          <input style={s.cInput} placeholder="Your name" value={name}
            onChange={e => setName(e.target.value)} autoComplete="off" />
        </div>
        <div style={s.cFieldGroup}>
          <input style={s.cInput} placeholder="(649) 343-9586" value={phone}
            onChange={e => setPhone(e.target.value)} type="tel" />
        </div>
        <button disabled={!canJoin} onClick={handleJoin}
          style={{ ...s.cJoinBtn, opacity: canJoin ? 1 : 0.3 }}>
          Join the Line
        </button>
      </div>
    );
  }

  // ── Step 4: Confirmation ──
  if (step === "confirm" && confirmed) {
    const chair = CHAIRS.find(c => c.id === confirmed.chairId);
    const onBreak = chairStates[confirmed.chairId] === "break";
    const ahead = confirmed.pos - 1;
    const isFirst = ahead === 0;
    return (
      <div style={s.cPage}>
        <div style={s.cConfirm}>
          <div style={s.cCheckCircle}>✓</div>
          <h2 style={s.cConfirmTitle}>You're in line!</h2>
          <div style={s.cConfirmCard}>
            <div style={s.cConfirmRow}><span>{confirmed.serviceName}</span><strong>{chair.label}</strong></div>
            <div style={s.cConfirmRow}><span>Ahead of you</span><strong>{isFirst ? "You're next" : ahead + (ahead === 1 ? " person" : " people")}</strong></div>
            {!isFirst && !onBreak && (
              <div style={s.cConfirmRow}><span>Est. wait</span><strong>~{confirmed.wait} min</strong></div>
            )}
            {onBreak && (
              <div style={s.cConfirmRow}><span>Est. wait</span><strong>After break</strong></div>
            )}
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
  const [locked, setLocked] = useState(true);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState(false);
  const PASSCODE = "2466";

  const getQ = (cid) => queue.filter(q => q.chairId === cid && q.status === "waiting")
    .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));

  // ── Passcode Screen ──
  if (locked) {
    const handleCode = (digit) => {
      const next = code + digit;
      setCodeError(false);
      if (next.length === 4) {
        if (next === PASSCODE) {
          setLocked(false);
          setCode("");
        } else {
          setCodeError(true);
          setTimeout(() => { setCode(""); setCodeError(false); }, 800);
        }
      } else {
        setCode(next);
      }
    };
    const handleDelete = () => { setCode(code.slice(0, -1)); setCodeError(false); };

    return (
      <div style={s.bPage}>
        <div style={s.lockWrap}>
          <div style={s.lockIcon}>🔒</div>
          <h2 style={s.lockTitle}>Barber Access</h2>
          <p style={s.lockSub}>Enter code to continue</p>
          <div style={s.lockDots}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                ...s.lockDot,
                background: codeError ? "#dc2626" : i < code.length ? "#2d6a2d" : "#d1d9d1",
              }} />
            ))}
          </div>
          {codeError && <div style={s.lockError}>Wrong code</div>}
          <div style={s.lockPad}>
            {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d, i) => (
              d === "" ? <div key={i} /> :
              <button key={i}
                onClick={() => d === "⌫" ? handleDelete() : handleCode(String(d))}
                style={d === "⌫" ? s.lockKeyDel : s.lockKey}>
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

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
                  color: state === "active" ? "#4ade80" : state === "break" ? "#facc15" : "#f87171"
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
        <button style={s.bClearDay} onClick={onClearDay}>🗑 Clear All — New Day</button>
        {smsLog.length > 0 && (
          <div style={s.bSmsSection}>
            <div style={s.bSmsTitle}>📨 Recent Messages</div>
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
            color: state === "active" ? "#4ade80" : state === "break" ? "#facc15" : "#f87171"
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
                    <div style={s.bCardPhone}>{entry.phone}</div>
                    <div style={s.bCardServiceName}>{entry.serviceName || ""}</div>
                  </div>
                  <div style={s.bCardRight}>
                    <div style={s.bCardPos}>#{idx + 1}</div>
                    <div style={s.bCardService}>{entry.serviceTime}m</div>
                  </div>
                </div>
                <div style={s.bCardMeta}>
                  Joined {minsAgo(entry.joinedAt)}{waitAhead > 0 ? " · ~" + waitAhead + "m wait" : ""}
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

    if (pos === 1 && !onBreak) {
      sendSms(entry.phone, "Hey " + entry.name + "! You're next up for " + chair.label + ". " + entry.serviceName + ".");
    } else if (onBreak) {
      sendSms(entry.phone, "Hey " + entry.name + "! You're #" + pos + " in line for " + chair.label + ". The barber is on break — we'll text you when they're back.");
    } else {
      sendSms(entry.phone, "Hey " + entry.name + "! You're #" + pos + " in line for " + chair.label + ". ~" + wait + " min wait.");
    }
  };

  const handleNext = (chairId) => {
    const cq = queue
      .filter(q => q.chairId === chairId && q.status === "waiting")
      .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
    if (!cq.length) return;

    updateQueueEntry(cq[0]._key, { status: "served" });

    const remaining = cq.slice(1);
    const chair = CHAIRS.find(c => c.id === chairId);

    remaining.forEach((q, i) => {
      if (i === 0) {
        sendSms(q.phone, "🔔 YOU'RE NEXT — " + chair.label + " is ready for you!");
      } else {
        const wait = remaining.slice(0, i).reduce((sum, r) => sum + r.serviceTime, 0);
        sendSms(q.phone, "📍 " + q.name + ", you moved up! #" + (i + 1) + " for " + chair.label + ". ~" + wait + " min.");
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

    waiting.forEach(q => {
      updateQueueEntry(q._key, { joinedDuringBreak: false });
    });

    waiting.forEach((q, i) => {
      const wait = waiting.slice(0, i).reduce((sum, r) => sum + r.serviceTime, 0);
      if (i === 0) {
        sendSms(q.phone, "🔔 YOU'RE NEXT — " + chair.label + " is back and ready for you!");
      } else {
        sendSms(q.phone, "▶ " + q.name + ", " + chair.label + " is back! You're #" + (i + 1) + " in line. ~" + wait + " min.");
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
    if (window.confirm("Clear everything and start a fresh day?")) {
      clearAllData();
    }
  };

  return (
    <div style={s.root}>
      <div style={s.nav}>
        <button onClick={() => setView("customer")}
          style={{ ...s.navBtn, ...(view === "customer" ? s.navOn : {}) }}>
          📱 Customer
        </button>
        <button onClick={() => setView("barber")}
          style={{ ...s.navBtn, ...(view === "barber" ? s.navOn : {}) }}>
          ✂️ Barber
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
// STYLES — Green theme, square buttons
// ═══════════════════════════════════════════
const G = {
  bg: "#f5f7f5",
  card: "#ffffff",
  border: "#d1d9d1",
  borderStrong: "#2d6a2d",
  primary: "#2d6a2d",
  primaryLight: "#e8f5e8",
  primaryDark: "#1a4d1a",
  text: "#1a1a1a",
  textMid: "#555",
  textLight: "#999",
  accent: "#facc15",
  danger: "#dc2626",
  dangerLight: "#fef2f2",
};

const s = {
  root: { fontFamily: "'Outfit', 'DM Sans', system-ui, sans-serif", background: G.bg, color: G.text, minHeight: "100vh", maxWidth: 600, margin: "0 auto", WebkitFontSmoothing: "antialiased" },

  // Nav
  nav: { display: "flex", gap: 4, padding: "8px 10px", background: "#fff", borderBottom: "2px solid " + G.border, position: "sticky", top: 0, zIndex: 300 },
  navBtn: { flex: 1, padding: "10px", border: "none", borderRadius: 8, background: "transparent", color: G.textMid, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  navOn: { background: G.primary, color: "#fff" },

  // Toast
  toast: { position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 999, background: "#fff", border: "2px solid " + G.primary, borderRadius: 14, padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", maxWidth: 360, width: "92%", boxShadow: "0 10px 40px rgba(0,0,0,.12)" },
  toastDot: { fontSize: 22, flexShrink: 0 },
  toastContent: { flex: 1 },
  toastHead: { fontSize: 10, fontWeight: 700, color: G.primary, textTransform: "uppercase", letterSpacing: ".06em" },
  toastBody: { fontSize: 12, color: G.text, marginTop: 2, lineHeight: 1.4 },
  toastX: { color: G.textLight, fontSize: 14, cursor: "pointer", padding: 4 },

  // ── Customer ──
  cPage: { padding: "20px 16px 40px" },
  cTop: { textAlign: "center", padding: "20px 0 24px" },
  cLogoMark: { fontSize: 32, width: 56, height: 56, borderRadius: 12, background: G.primary, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", fontWeight: 700 },
  cTitle: { fontSize: 22, fontWeight: 900, letterSpacing: ".04em", margin: 0, color: G.primary },

  // Chair grid — squares
  cChairGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },
  cChairBtn: {
    aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    borderRadius: 12, border: "3px solid " + G.border, background: "#fff",
    cursor: "pointer", fontFamily: "inherit", color: G.text, transition: "all .15s",
  },
  cChairClosed: { opacity: 0.3, cursor: "not-allowed", background: "#f0f0f0" },
  cChairOnBreak: { borderColor: "#e5c200", background: "#fffef0" },
  cChairNum: { fontSize: 28, fontWeight: 900, color: G.primary },
  cChairLabel: { fontSize: 11, color: G.textMid, fontWeight: 600, marginTop: 2 },
  cChairMeta: { fontSize: 10, color: G.textLight, fontWeight: 600, marginTop: 6 },

  // Step header
  cBack: { background: "none", border: "none", color: G.textMid, fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: "4px 0 12px" },
  cStepHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 },
  cStepChip: { background: G.primaryLight, color: G.primary, fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8 },
  cStepService: { fontSize: 13, fontWeight: 600, color: G.textMid },
  cBreakTag: { fontSize: 11, color: "#b59200", fontWeight: 600 },
  cStepTitle: { fontSize: 18, fontWeight: 800, color: G.primary, marginBottom: 16 },

  // Service list
  cServiceList: { display: "flex", flexDirection: "column", gap: 6 },
  cServiceBtn: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "18px 16px", borderRadius: 12, border: "3px solid " + G.border,
    background: "#fff", cursor: "pointer", fontFamily: "inherit",
    color: G.text, transition: "all .15s", textAlign: "left",
  },
  cServiceName: { fontSize: 15, fontWeight: 700, color: G.text },
  cServiceTime: { fontSize: 13, color: G.textLight, fontWeight: 600 },

  // Info
  cFieldGroup: { marginBottom: 14 },
  cInput: {
    width: "100%", padding: "16px 14px", borderRadius: 12,
    border: "3px solid " + G.border, background: "#fff",
    color: G.text, fontSize: 16, fontFamily: "inherit",
    outline: "none", boxSizing: "border-box",
  },
  cSmsNote: { fontSize: 11, color: G.textLight, textAlign: "center", marginTop: 10 },

  cJoinBtn: {
    width: "100%", padding: "18px", borderRadius: 12, border: "none",
    background: G.primary, color: "#fff", fontSize: 16, fontWeight: 800,
    cursor: "pointer", fontFamily: "inherit", marginTop: 8,
  },

  // Confirm
  cConfirm: { textAlign: "center", padding: "40px 0" },
  cCheckCircle: { width: 56, height: 56, borderRadius: "50%", background: G.primary, color: "#fff", fontSize: 26, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" },
  cConfirmTitle: { fontSize: 20, fontWeight: 900, margin: 0, color: G.primary },
  cConfirmCard: { background: "#fff", borderRadius: 12, padding: 16, margin: "16px auto", maxWidth: 300, textAlign: "left", border: "2px solid " + G.border },
  cConfirmRow: { display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #eee", fontSize: 14, color: G.textMid },
  cAutoReset: { fontSize: 11, color: G.textLight, marginTop: 16 },
  cResetBtn: { marginTop: 10, padding: "10px 24px", borderRadius: 8, border: "2px solid " + G.border, background: "#fff", color: G.textMid, fontSize: 12, cursor: "pointer", fontFamily: "inherit" },

  // ── Barber ──
  bPage: { padding: "16px 14px 40px" },
  bHeader: { marginBottom: 20 },
  bTitle: { fontSize: 22, fontWeight: 900, margin: 0, color: G.primary },
  bSub: { fontSize: 12, color: G.textMid, marginTop: 2 },
  bChairGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  bChairCard: { padding: "16px 12px", borderRadius: 12, border: "2px solid " + G.border, background: "#fff", cursor: "pointer", fontFamily: "inherit", color: G.text, textAlign: "center" },
  bChairLabel: { fontSize: 16, fontWeight: 700 },
  bChairState: { fontSize: 11, fontWeight: 700, marginTop: 4 },
  bChairCount: { fontSize: 12, color: G.textMid, marginTop: 4 },
  bBreakJoined: { fontSize: 10, color: "#b59200", marginTop: 4, fontWeight: 600 },
  bClearDay: { width: "100%", padding: "12px", borderRadius: 10, border: "2px solid #f5d5d5", background: "#fff", color: G.danger, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 16 },
  bBack: { background: "none", border: "none", color: G.textMid, fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: "6px 0 14px" },
  bQueueHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  bQueueTitle: { fontSize: 22, fontWeight: 800, margin: 0, color: G.primary },
  bQueueState: { fontSize: 12, fontWeight: 700, marginTop: 2 },
  bQueueCount: { fontSize: 28, fontWeight: 900, color: G.primary, background: G.primaryLight, borderRadius: 12, padding: "8px 16px" },
  bControls: { display: "flex", gap: 8, marginBottom: 16 },
  bCtrlPause: { flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "#fef3c7", color: "#92400e", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  bCtrlEnd: { flex: 1, padding: "12px", borderRadius: 10, border: "2px solid #fecaca", background: "#fff", color: G.danger, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  bCtrlResume: { flex: 1, padding: "12px", borderRadius: 10, border: "none", background: G.primary, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  bClosedMsg: { fontSize: 13, color: G.textMid, padding: "10px 0" },
  bEmpty: { fontSize: 14, color: G.textLight, textAlign: "center", padding: "40px 0" },
  bQueueList: { display: "flex", flexDirection: "column", gap: 6 },
  bCard: { background: "#fff", borderRadius: 12, padding: 14, border: "2px solid " + G.border },
  bCardNext: { borderColor: G.primary, background: G.primaryLight },
  bCardBreak: { borderLeft: "4px solid #facc15", background: "#fffef5" },
  bNextLabel: { fontSize: 9, fontWeight: 800, color: G.primary, letterSpacing: ".08em", marginBottom: 6 },
  bBreakLabel: { fontSize: 9, fontWeight: 700, color: "#92400e", marginBottom: 6 },
  bCardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  bCardName: { fontSize: 15, fontWeight: 700 },
  bCardPhone: { fontSize: 11, color: G.textLight, marginTop: 2 },
  bCardServiceName: { fontSize: 11, color: G.primary, fontWeight: 600, marginTop: 2 },
  bCardRight: { textAlign: "right" },
  bCardPos: { fontSize: 13, fontWeight: 700, color: G.textLight },
  bCardService: { fontSize: 11, color: G.primary, fontWeight: 600, marginTop: 2 },
  bCardMeta: { fontSize: 11, color: G.textLight, marginTop: 6 },
  bNextBtn: { width: "100%", padding: "12px", borderRadius: 8, border: "none", background: G.primary, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginTop: 10 },
  bSmsSection: { marginTop: 24, borderTop: "2px solid " + G.border, paddingTop: 14 },
  bSmsTitle: { fontSize: 11, fontWeight: 700, color: G.textMid, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".06em" },
  bSmsRow: { display: "flex", alignItems: "center", gap: 6, padding: "6px 0", borderBottom: "1px solid #f0f0f0", fontSize: 11 },
  bSmsDot: { fontSize: 12, flexShrink: 0 },
  bSmsTo: { color: G.textMid, fontWeight: 600, minWidth: 90 },
  bSmsMsg: { flex: 1, color: G.textLight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  bSmsTime: { color: G.textLight, fontSize: 10, flexShrink: 0 },

  // Lock screen
  lockWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "70vh", padding: "20px 0" },
  lockIcon: { fontSize: 40, marginBottom: 12 },
  lockTitle: { fontSize: 20, fontWeight: 800, color: G.primary, margin: 0 },
  lockSub: { fontSize: 13, color: G.textMid, marginTop: 4 },
  lockDots: { display: "flex", gap: 14, margin: "24px 0 8px" },
  lockDot: { width: 16, height: 16, borderRadius: "50%", transition: "background .15s" },
  lockError: { fontSize: 12, color: "#dc2626", fontWeight: 600, marginTop: 4, height: 18 },
  lockPad: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 20, width: 240 },
  lockKey: { width: "100%", aspectRatio: "1.4", borderRadius: 12, border: "2px solid " + G.border, background: "#fff", fontSize: 22, fontWeight: 700, color: G.text, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" },
  lockKeyDel: { width: "100%", aspectRatio: "1.4", borderRadius: 12, border: "none", background: "transparent", fontSize: 20, color: G.textMid, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center" },
};
