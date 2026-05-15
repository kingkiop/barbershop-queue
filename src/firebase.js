import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, push, onValue, update, remove, get } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCYqG2mtEHwCiMTFEHmLuvviZ9RiKfejYc",
  authDomain: "barbershop-queue-a3947.firebaseapp.com",
  databaseURL: "https://barbershop-queue-a3947-default-rtdb.firebaseio.com",
  projectId: "barbershop-queue-a3947",
  storageBucket: "barbershop-queue-a3947.firebasestorage.app",
  messagingSenderId: "297749628445",
  appId: "1:297749628445:web:3d85b863c0f997945728f4"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ── Queue operations ──
export function subscribeToQueue(callback) {
  const queueRef = ref(db, "queue");
  return onValue(queueRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return callback([]);
    const arr = Object.entries(data).map(([key, val]) => ({ ...val, _key: key }));
    callback(arr);
  });
}

export function addToQueue(entry) {
  const queueRef = ref(db, "queue");
  const newRef = push(queueRef);
  return set(newRef, entry);
}

export function updateQueueEntry(key, updates) {
  const entryRef = ref(db, `queue/${key}`);
  return update(entryRef, updates);
}

export function removeQueueEntry(key) {
  const entryRef = ref(db, `queue/${key}`);
  return remove(entryRef);
}

// ── Chair state operations ──
export function subscribeToChairStates(callback) {
  const statesRef = ref(db, "chairStates");
  return onValue(statesRef, (snapshot) => {
    const data = snapshot.val();
    callback(data || {});
  });
}

export function setChairState(chairId, state) {
  const stateRef = ref(db, `chairStates/${chairId}`);
  return set(stateRef, state);
}

// ── SMS log operations ──
export function subscribeToSmsLog(callback) {
  const logRef = ref(db, "smsLog");
  return onValue(logRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return callback([]);
    const arr = Object.entries(data).map(([key, val]) => ({ ...val, _key: key }));
    arr.sort((a, b) => a.ts - b.ts);
    callback(arr);
  });
}

export function addSmsLog(entry) {
  const logRef = ref(db, "smsLog");
  const newRef = push(logRef);
  return set(newRef, entry);
}

// ── Clear day (optional) ──
export async function clearAllData() {
  await set(ref(db, "queue"), null);
  await set(ref(db, "chairStates"), null);
  await set(ref(db, "smsLog"), null);
}
