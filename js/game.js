// Logica di rete di Visioni su Firebase Realtime Database (stesso progetto di Carte Infami, rami separati).
// Niente server: ogni azione la fa il telefono di chi tocca (narratore, giocatori, host).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeAuth, inMemoryPersistence, browserLocalPersistence,
  indexedDBLocalPersistence, signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, set, get, update, onValue, onDisconnect,
  runTransaction, serverTimestamp, query, orderByChild, endAt, limitToFirst,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

export const testMode = new URLSearchParams(location.search).has("test");
const ROOMS = "vrooms";
const HANDS = "vhands";
const ROOM_TTL_MS = 18 * 3600 * 1000;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const HAND_SIZE = 6;

let db;
export let uid = null;

export async function init() {
  const app = initializeApp(firebaseConfig);
  const auth = testMode
    ? initializeAuth(app, { persistence: inMemoryPersistence })
    : initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  db = getDatabase(app);
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  uid = auth.currentUser.uid;
}

const roomRef = (code, path = "") => ref(db, `${ROOMS}/${code}${path ? "/" + path : ""}`);
const P = (code, path) => `${ROOMS}/${code}/${path}`;

export async function getRoom(code) {
  return (await get(roomRef(code))).val();
}

export async function createRoom(name) {
  let code;
  for (let i = 0; i < 10; i++) {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    if (!(await get(roomRef(code, "hostUid"))).exists()) break;
  }
  await set(roomRef(code), {
    hostUid: uid,
    createdAt: serverTimestamp(),
    settings: { target: 30 },
    state: { phase: "lobby", round: 0 },
    players: { [uid]: { name, score: 0, joinedAt: Date.now(), online: true } },
  });
  cleanupOldRooms();
  return code;
}

export async function joinRoom(code, name) {
  const room = await getRoom(code);
  if (!room || !room.hostUid) throw new Error("Stanza non trovata");
  if (room.players && room.players[uid]) {
    await update(roomRef(code, `players/${uid}`), { name, online: true });
  } else {
    await set(roomRef(code, `players/${uid}`), { name, score: 0, joinedAt: Date.now(), online: true });
  }
}

export function connect(code, onRoom, onHand) {
  const meOnline = roomRef(code, `players/${uid}/online`);
  const unsubs = [
    onValue(ref(db, ".info/connected"), (s) => {
      if (s.val() === true) onDisconnect(meOnline).set(false).then(() => set(meOnline, true));
    }),
    onValue(roomRef(code), (s) => onRoom(s.val())),
    onValue(ref(db, `${HANDS}/${code}/${uid}`), (s) => onHand(s.val())),
  ];
  return () => { unsubs.forEach((u) => u()); onDisconnect(meOnline).cancel(); };
}

export async function leave(code, room) {
  const updates = { [P(code, `players/${uid}`)]: null, [`${HANDS}/${code}/${uid}`]: null };
  if (room && room.hostUid === uid) {
    const others = sortedPlayers(room).filter((p) => p.uid !== uid);
    const next = others.find((p) => p.online !== false) || others[0];
    if (next) updates[P(code, "hostUid")] = next.uid;
  }
  await update(ref(db), updates);
}

export const becomeHost = (code) => set(roomRef(code, "hostUid"), uid);
export const setSetting = (code, key, value) => set(roomRef(code, `settings/${key}`), value);

// ---------- utilità condivise con la UI ----------
export function sortedPlayers(room) {
  return Object.entries(room.players || {})
    .filter(([, p]) => p && p.name)
    .map(([id, p]) => ({ uid: id, ...p }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}

function ofRound(room, key) {
  const round = room.state && room.state.round;
  const out = {};
  for (const [id, v] of Object.entries(room[key] || {})) if (v && v.round === round) out[id] = v;
  return out;
}
export const currentPlays = (room) => ofRound(room, "plays");
export const currentVotes = (room) => ofRound(room, "votes");

// Chi deve ancora giocare/votare: online e non narratore
export function expected(room) {
  return sortedPlayers(room)
    .filter((p) => p.online !== false && p.uid !== room.state.tellerUid)
    .map((p) => p.uid);
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Le carte del round in ordine mescolato ma uguale per tutti
export function board(room) {
  const plays = currentPlays(room);
  return Object.entries(plays)
    .map(([owner, p]) => ({ owner, card: p.card }))
    .sort((a, b) => hash(`${a.card}:${room.state.round}`) - hash(`${b.card}:${room.state.round}`));
}

function nextTeller(room) {
  const all = sortedPlayers(room);
  const idx = all.findIndex((p) => p.uid === room.state.tellerUid);
  for (let i = 1; i <= all.length; i++) {
    const p = all[(idx + i) % all.length];
    if (p.online !== false) return p.uid;
  }
  return room.state.tellerUid;
}

// Punteggio: se tutti o nessuno trovano la carta del narratore, lui 0 e gli altri 2;
// altrimenti narratore e chi l'ha trovata 3. In più 1 punto per ogni voto ricevuto dalla propria carta.
export function computeScores(room) {
  const teller = room.state.tellerUid;
  const plays = currentPlays(room);
  const votes = currentVotes(room);
  const tellerCard = plays[teller] && plays[teller].card;
  const owners = {};
  for (const [o, p] of Object.entries(plays)) owners[p.card] = o;
  const voters = Object.keys(votes).filter((u) => u !== teller);
  const correct = voters.filter((u) => votes[u].card === tellerCard);
  const delta = {};
  for (const u of Object.keys(plays)) delta[u] = 0;
  if (correct.length === 0 || correct.length === voters.length) {
    for (const u of Object.keys(plays)) if (u !== teller) delta[u] += 2;
  } else {
    delta[teller] = 3;
    for (const u of correct) delta[u] += 3;
  }
  for (const u of voters) {
    const owner = owners[votes[u].card];
    if (owner && owner !== teller && owner !== u) delta[owner] += 1;
  }
  return { delta, tellerCard, allFound: correct.length === voters.length && voters.length > 0, noneFound: correct.length === 0 };
}

// ---------- partita ----------
export async function startGame(code, room, deck) {
  const players = sortedPlayers(room).filter((p) => p.online !== false);
  const updates = {
    [P(code, "deck")]: { cards: deck, wi: 0 },
    [P(code, "state")]: { phase: "clue", round: 1, tellerUid: players[0].uid, gameId: Date.now().toString(36) },
    [P(code, "plays")]: null,
    [P(code, "votes")]: null,
  };
  for (const p of sortedPlayers(room)) updates[P(code, `players/${p.uid}/score`)] = 0;
  await update(ref(db), updates);
}

export async function drawInto(code, room, cards) {
  const n = HAND_SIZE - cards.length;
  if (n <= 0) return;
  const res = await runTransaction(roomRef(code, "deck/wi"), (cur) => (cur || 0) + n);
  const start = res.snapshot.val() - n;
  const deck = room.deck.cards;
  const drawn = Array.from({ length: n }, (_, i) => deck[(start + i) % deck.length]);
  await set(ref(db, `${HANDS}/${code}/${uid}`), { gameId: room.state.gameId, cards: [...cards, ...drawn] });
}

async function playCard(code, room, hand, card) {
  await set(roomRef(code, `plays/${uid}`), { card, round: room.state.round });
  await drawInto(code, room, hand.filter((c) => c !== card));
}

// Il narratore sceglie la carta e (se vuole) scrive l'indizio
export async function tell(code, room, hand, card, clue) {
  await playCard(code, room, hand, card);
  await runTransaction(roomRef(code, "state"), (s) => {
    if (!s) return s;
    if (s.phase !== "clue" || s.round !== room.state.round) return;
    return { ...s, phase: "playing", clue: clue || "" };
  });
}

export const play = (code, room, hand, card) => playCard(code, room, hand, card);

export function toVoting(code, round) {
  return runTransaction(roomRef(code, "state"), (s) => {
    if (!s) return s;
    if (s.phase !== "playing" || s.round !== round) return;
    return { ...s, phase: "voting" };
  });
}

export const vote = (code, room, card) =>
  set(roomRef(code, `votes/${uid}`), { card, round: room.state.round });

export async function finishVoting(code, room) {
  const { delta, tellerCard, allFound, noneFound } = computeScores(room);
  const res = await runTransaction(roomRef(code, "state"), (s) => {
    if (!s) return s;
    if (s.phase !== "voting" || s.round !== room.state.round) return;
    return { ...s, phase: "result", delta, tellerCard, allFound, noneFound };
  });
  if (!res.committed) return;
  const updates = {};
  for (const [u, d] of Object.entries(delta)) {
    if (d && room.players[u]) updates[P(code, `players/${u}/score`)] = (room.players[u].score || 0) + d;
  }
  if (Object.keys(updates).length) await update(ref(db), updates);
}

export async function nextRound(code, room, force = false) {
  const round = room.state.round;
  const target = (room.settings && room.settings.target) || 30;
  const maxScore = Math.max(0, ...sortedPlayers(room).map((p) => p.score || 0));
  const tellerUid = nextTeller(room);
  const res = await runTransaction(roomRef(code, "state"), (s) => {
    if (!s) return s;
    if (s.round !== round) return;
    if (!force && s.phase !== "result") return;
    if (!force && maxScore >= target) return { ...s, phase: "end" };
    return { phase: "clue", round: round + 1, tellerUid, gameId: s.gameId };
  });
  if (res.committed && res.snapshot.val().phase === "clue") {
    await update(ref(db), { [P(code, "plays")]: null, [P(code, "votes")]: null });
  }
}

export const endGame = (code) => set(roomRef(code, "state/phase"), "end");

export function backToLobby(code) {
  return update(roomRef(code), { state: { phase: "lobby", round: 0 }, deck: null, plays: null, votes: null });
}

async function cleanupOldRooms() {
  try {
    const q = query(ref(db, ROOMS), orderByChild("createdAt"), endAt(Date.now() - ROOM_TTL_MS), limitToFirst(20));
    const s = await get(q);
    const updates = {};
    s.forEach((c) => { updates[`${ROOMS}/${c.key}`] = null; updates[`${HANDS}/${c.key}`] = null; });
    if (Object.keys(updates).length) await update(ref(db), updates);
  } catch (e) {
    console.warn("Pulizia stanze non riuscita", e);
  }
}
