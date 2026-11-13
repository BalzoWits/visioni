// Interfaccia di Visioni: schermate, tocchi, visore delle carte.
import * as G from "./game.js";

const MIN_PLAYERS = 3;
const $app = document.getElementById("app");
const $toast = document.getElementById("toast");

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage non disponibile */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

const S = {
  screen: "loading", code: null, room: null, hand: null, handLoaded: false,
  cards: [], cardById: {}, tellCard: null, viewer: null, showMenu: false,
  prev: {}, dirty: false, prefillCode: "",
};
let disconnect = null;
let drawing = false;

// ---------- utilità ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(3, "0");
const imgSrc = (id) => `cards/${pad(id)}.jpg`;
const isHost = () => S.room && S.room.hostUid === G.uid;
const playerName = (id) => (S.room && S.room.players && S.room.players[id] && S.room.players[id].name) || "?";

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove("show"), 2600);
}
function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch { /* ok */ } }
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function myHand() {
  const r = S.room;
  return (S.hand && r && r.state && S.hand.gameId === r.state.gameId && S.hand.cards) || [];
}

// ---------- wake lock ----------
let wakeLock = null;
async function keepAwake() {
  if (!("wakeLock" in navigator) || S.screen !== "room" || document.visibilityState !== "visible") return;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch { /* non supportato */ }
}
document.addEventListener("visibilitychange", keepAwake);

// ---------- rendering ----------
function isTyping() {
  const a = document.activeElement;
  return a && $app.contains(a) && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type !== "checkbox"));
}

function render(force = false) {
  if (!force && isTyping()) { S.dirty = true; return; }
  S.dirty = false;
  const keep = {};
  $app.querySelectorAll("input[id], textarea[id]").forEach((el) => { keep[el.id] = el.value; });
  const y = window.scrollY;
  const views = { home: viewHome, room: viewRoom, credits: viewCredits, setup: viewError, error: viewError };
  $app.innerHTML = (views[S.screen] || viewLoading)() + (S.viewer ? viewViewer() : "");
  for (const [id, v] of Object.entries(keep)) { const el = document.getElementById(id); if (el) el.value = v; }
  window.scrollTo(0, y);
  document.body.classList.toggle("no-scroll", !!S.viewer || S.showMenu);
}
$app.addEventListener("focusout", () => setTimeout(() => { if (S.dirty && !isTyping()) render(); }, 0));

const viewLoading = () => `<main class="screen center"><div class="spinner"></div></main>`;

function viewError() {
  return `<main class="screen center narrow">
    <h1 class="title">Visioni</h1>
    <div class="panel"><p>${esc(S.error || "Errore di configurazione")}</p>
    <button class="btn primary" onclick="location.reload()">Riprova</button></div>
  </main>`;
}

function viewHome() {
  const sample = [12, 160, 84].map((i) => S.cards[i % Math.max(1, S.cards.length)]).filter(Boolean);
  return `<main class="screen home">
    <div class="hero">
      <div class="fan" aria-hidden="true">
        ${sample.map((c, i) => `<div class="fan-card f${i}"><img src="${imgSrc(c.id)}" alt=""></div>`).join("")}
      </div>
      <h1 class="title">Visioni</h1>
      <p class="tagline">Un indizio. Tante immagini. Una sola è quella giusta.</p>
    </div>
    <div class="panel">
      <label class="field"><span>Il tuo nome</span>
        <input id="nameInput" maxlength="16" autocomplete="nickname" enterkeyhint="done"
          placeholder="Come ti chiamano" value="${esc(LS.get("name", ""))}">
      </label>
      <button class="btn primary big" data-action="create">Crea una stanza</button>
      <div class="or"><span>oppure entra con il codice</span></div>
      <div class="join-row">
        <input id="codeInput" maxlength="4" placeholder="ABCD" autocapitalize="characters"
          autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go" value="${esc(S.prefillCode)}">
        <button class="btn" data-action="join">Entra</button>
      </div>
    </div>
    <details class="rules">
      <summary>Come si gioca</summary>
      <ol>
        <li>A turno un giocatore è il <b>narratore</b>: sceglie una carta dalla sua mano e dice ad alta voce un indizio (una parola, una frase, un verso, una canzone…).</li>
        <li>Gli altri scelgono dalla propria mano la carta che meglio si adatta all'indizio, per ingannare.</li>
        <li>Le carte vengono mescolate: tutti, tranne il narratore, votano quella che credono sia del narratore.</li>
        <li>Se la trovano <b>tutti</b> o <b>nessuno</b>, il narratore fa 0 e gli altri 2. Altrimenti narratore e chi l'ha trovata fanno 3.</li>
        <li>Ogni giocatore fa anche 1 punto per ogni voto ricevuto dalla sua carta. Vince chi arriva per primo al traguardo.</li>
      </ol>
      <p class="muted">Il trucco: un indizio né troppo facile né troppo difficile.</p>
    </details>
    <button class="btn ghost small center-btn" data-action="credits">Le opere del mazzo</button>
    ${G.testMode ? '<p class="test-flag">Modalità test: ogni scheda è un giocatore diverso</p>' : ""}
  </main>`;
}

function viewCredits() {
  return `<main class="screen credits">
    <header class="credits-head">
      <button class="btn ghost small" data-action="home">← Indietro</button>
      <h1>Le opere</h1>
    </header>
    <p class="muted">Tutte le immagini sono opere di pubblico dominio dell'<b>Art Institute of Chicago</b>,
    rilasciate con licenza CC0. Tocca un'opera per vederla.</p>
    <div class="credits-grid">
      ${S.cards.map((c) => `<button class="credit" data-action="viewCredit" data-id="${c.id}">
        <img src="${imgSrc(c.id)}" loading="lazy" alt="">
        <span><b>${esc(c.title)}</b><br>${esc(c.artist || "Anonimo")}${c.date ? ", " + esc(c.date) : ""}</span>
      </button>`).join("")}
    </div>
  </main>`;
}

function viewRoom() {
  const r = S.room;
  if (!r) return viewLoading();
  const phase = (r.state && r.state.phase) || "lobby";
  if (phase === "lobby") return viewLobby();
  if (phase === "end") return viewEnd() + (S.showMenu ? viewMenu() : "");
  return viewGame() + (S.showMenu ? viewMenu() : "");
}

function playerList(r) {
  return G.sortedPlayers(r).map((p) => `
    <li class="${p.online === false ? "off" : ""}">
      <span class="dot"></span>
      <span class="pname">${esc(p.name)}${p.uid === G.uid ? " <em>(tu)</em>" : ""}</span>
      ${p.uid === r.hostUid ? '<span class="badge">host</span>' : ""}
    </li>`).join("");
}

function viewLobby() {
  const r = S.room;
  const host = isHost();
  const online = G.sortedPlayers(r).filter((p) => p.online !== false);
  const target = (r.settings && r.settings.target) || 30;
  const hostOffline = r.players[r.hostUid] && r.players[r.hostUid].online === false;
  return `<main class="screen lobby">
    <header class="room-head">
      <div><div class="label">Codice stanza</div>
        <button class="room-code" data-action="copyCode">${esc(S.code)}</button></div>
      <button class="btn" data-action="share">Invita</button>
    </header>
    <section class="block">
      <h2>Giocatori <span class="count">${online.length}</span></h2>
      <ul class="players">${playerList(r)}</ul>
      ${online.length < MIN_PLAYERS ? `<p class="hint">Servono almeno ${MIN_PLAYERS} giocatori.</p>` : ""}
      ${hostOffline && !host ? `<button class="btn ghost small" data-action="becomeHost">L'host è offline: diventa host</button>` : ""}
    </section>
    <section class="block">
      <h2>Impostazioni</h2>
      <div class="setting"><span>Punti per vincere</span>
        <div class="chips">${[15, 20, 30].map((n) => `<button class="chip ${target === n ? "on" : ""}"
          data-action="setTarget" data-v="${n}" ${host ? "" : "disabled"}>${n}</button>`).join("")}</div>
      </div>
      <p class="muted">${S.cards.length} opere nel mazzo · 6 carte a testa</p>
    </section>
    <div class="bottom-bar">
      ${host
        ? `<button class="btn primary big" data-action="start" ${online.length < MIN_PLAYERS ? "disabled" : ""}>Inizia la partita</button>`
        : `<p class="waiting">In attesa che ${esc(playerName(r.hostUid))} avvii la partita…</p>`}
      <button class="btn ghost" data-action="leave">Esci</button>
    </div>
  </main>`;
}

function gameHeader(r) {
  const st = r.state;
  const me = r.players[G.uid] || {};
  const who = st.tellerUid === G.uid ? "Sei il narratore" : `Narratore: ${esc(playerName(st.tellerUid))}`;
  return `<header class="game-head">
    <div class="round">Round ${st.round}</div>
    <div class="teller">${who}</div>
    <button class="score-btn" data-action="menu" aria-label="Apri il menu">
      <svg class="menu-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      ${me.score || 0} pt</button>
  </header>`;
}

function clueBox(st) {
  const name = esc(playerName(st.tellerUid));
  return st.clue
    ? `<div class="clue"><span class="clue-label">L'indizio di ${name}</span><q>${esc(st.clue)}</q></div>`
    : `<div class="clue"><span class="clue-label">Indizio</span><span class="clue-voice">Ascolta l'indizio di ${name}</span></div>`;
}

function progress(done, total, what) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="progress"><div style="width:${pct}%"></div></div>
    <p class="muted center-text">${done} su ${total} ${what}</p>`;
}

function handGrid(cards, action, opts = {}) {
  if (!cards.length) return '<div class="center-text muted pad">Distribuisco le carte…</div>';
  return `<div class="grid">${cards.map((id, i) => `
    <button class="card ${opts.selected === id ? "sel" : ""}" data-action="${action}" data-i="${i}">
      <img src="${imgSrc(id)}" loading="lazy" alt="Carta">
    </button>`).join("")}</div>`;
}

function viewGame() {
  const r = S.room;
  const st = r.state;
  const isTeller = st.tellerUid === G.uid;
  const plays = G.currentPlays(r);
  const votes = G.currentVotes(r);
  const exp = G.expected(r);
  const head = gameHeader(r);
  const hand = myHand();

  if (st.phase === "clue") {
    if (isTeller) {
      if (S.tellCard && hand.includes(S.tellCard)) {
        return `<main class="screen game">${head}
          <section class="tell">
            <div class="big-card"><img src="${imgSrc(S.tellCard)}" alt="La tua carta"></div>
            <p class="muted center-text">Di' ad alta voce il tuo indizio. Se giocate a distanza, scrivilo qui:</p>
            <input id="clueInput" maxlength="80" placeholder="Indizio (facoltativo)" enterkeyhint="done" autocomplete="off">
          </section>
          <div class="bottom-bar">
            <button class="btn primary big" data-action="tell">Fatto, ho dato l'indizio</button>
            <button class="btn ghost" data-action="changeTell">Cambia carta</button>
          </div>
        </main>`;
      }
      return `<main class="screen game">${head}
        <p class="phase-msg"><b>Sei il narratore.</b> Scegli una carta e pensa a un indizio: una parola, una frase, un verso, un suono…</p>
        ${handGrid(hand, "openHandTell")}
      </main>`;
    }
    return `<main class="screen game">${head}
      <p class="phase-msg">${esc(playerName(st.tellerUid))} sta scegliendo una carta e pensando all'indizio…</p>
      <p class="muted center-text">Intanto studia la tua mano.</p>
      ${handGrid(hand, "openHandView")}
    </main>`;
  }

  if (st.phase === "playing") {
    const done = exp.filter((u) => plays[u]).length;
    if (isTeller) {
      return `<main class="screen game">${head}
        ${clueBox(st)}
        <section class="status">
          <p class="big-msg">Gli altri scelgono le loro carte</p>
          ${progress(done, exp.length, "hanno scelto")}
          <ul class="waitlist">${exp.map((u) => `<li class="${plays[u] ? "ok" : ""}">${esc(playerName(u))}</li>`).join("")}</ul>
        </section>
        <div class="bottom-bar">
          <button class="btn primary big" data-action="toVoting" ${done ? "" : "disabled"}>
            ${done < exp.length ? `Passa al voto ora (${done}/${exp.length})` : "Passa al voto"}</button>
        </div>
      </main>`;
    }
    if (plays[G.uid]) {
      return `<main class="screen game">${head}
        ${clueBox(st)}
        <section class="status">
          <div class="mini-card"><img src="${imgSrc(plays[G.uid].card)}" alt=""></div>
          <p class="big-msg">Carta giocata</p>
          ${progress(done, exp.length, "hanno scelto")}
        </section>
      </main>`;
    }
    return `<main class="screen game">${head}
      ${clueBox(st)}
      <p class="phase-msg">Scegli la carta che più si avvicina all'indizio, per confondere gli altri.</p>
      ${handGrid(hand, "openHandPlay")}
    </main>`;
  }

  if (st.phase === "voting") {
    const b = G.board(r);
    const voters = exp.filter((u) => plays[u]);
    const done = voters.filter((u) => votes[u]).length;
    const myVote = votes[G.uid] && votes[G.uid].card;
    const grid = `<div class="grid board">${b.map((x, i) => `
      <button class="card ${myVote === x.card ? "sel" : ""} ${x.owner === G.uid ? "mine" : ""}" data-action="openBoard" data-i="${i}">
        <span class="num">${i + 1}</span>
        ${x.owner === G.uid ? '<span class="tag">tua</span>' : ""}
        <img src="${imgSrc(x.card)}" loading="lazy" alt="Carta ${i + 1}">
      </button>`).join("")}</div>`;
    let msg;
    if (isTeller) msg = "Gli altri cercano la tua carta…";
    else if (!plays[G.uid]) msg = "Questo round guardi e basta.";
    else if (myVote) msg = "Voto dato. Aspettiamo gli altri…";
    else msg = "Quale carta è del narratore? Tocca per guardarla e votare.";
    return `<main class="screen game">${head}
      ${clueBox(st)}
      <p class="phase-msg">${msg}</p>
      ${grid}
      ${progress(done, voters.length, "hanno votato")}
      ${isTeller || isHost() ? `<div class="bottom-bar"><button class="btn big ${isTeller ? "primary" : ""}" data-action="finishVoting" ${done ? "" : "disabled"}>
        ${done < voters.length ? `Chiudi il voto ora (${done}/${voters.length})` : "Mostra i risultati"}</button></div>` : ""}
    </main>`;
  }

  // result
  const b = G.board(r);
  const delta = st.delta || {};
  const target = (r.settings && r.settings.target) || 30;
  const isOver = Math.max(0, ...G.sortedPlayers(r).map((p) => p.score || 0)) >= target;
  const tellerName = esc(playerName(st.tellerUid));
  const summary = (st.allFound
    ? `L'hanno trovata tutti: troppo facile! ${tellerName} fa 0, gli altri 2.`
    : st.noneFound
      ? `Non l'ha trovata nessuno: troppo difficile! ${tellerName} fa 0, gli altri 2.`
      : `${tellerName} e chi ha trovato la carta fanno 3 punti.`)
    + ` <span class="muted">In più, +1 per ogni voto ricevuto dalla propria carta.</span>`;
  const votersOf = (card) => Object.entries(votes).filter(([, v]) => v.card === card).map(([u]) => esc(playerName(u)));
  const cardsHTML = b.map((x, i) => {
    const vs = votersOf(x.card);
    const c = S.cardById[x.card] || {};
    return `<div class="res-card ${x.card === st.tellerCard ? "winner" : ""}">
      <button class="card" data-action="openResult" data-i="${i}"><img src="${imgSrc(x.card)}" loading="lazy" alt=""></button>
      <div class="res-info">
        <div class="res-owner">${x.card === st.tellerCard ? "★ " : ""}${esc(playerName(x.owner))}</div>
        <div class="res-votes">${vs.length ? "Votata da " + vs.join(", ") : "Nessun voto"}</div>
        <div class="res-art">${esc(c.title || "")}</div>
      </div>
    </div>`;
  }).join("");
  const deltaHTML = G.sortedPlayers(r)
    .filter((p) => delta[p.uid] !== undefined)
    .sort((a, b2) => (delta[b2.uid] || 0) - (delta[a.uid] || 0))
    .map((p) => `<li><span>${esc(p.name)}</span><b>+${delta[p.uid] || 0}</b></li>`).join("");
  const canNext = isTeller || isHost();
  return `<main class="screen game">${head}
    ${clueBox(st)}
    <p class="summary">${summary}</p>
    <ul class="deltas">${deltaHTML}</ul>
    <div class="results">${cardsHTML}</div>
    ${ranking(r, 5)}
    <div class="bottom-bar">
      ${canNext ? `<button class="btn primary big" data-action="next">${isOver ? "Classifica finale" : "Prossimo round"}</button>`
        : `<p class="waiting">In attesa di ${tellerName}…</p>`}
    </div>
  </main>`;
}

function ranking(r, limit) {
  const list = G.sortedPlayers(r).sort((a, b) => (b.score || 0) - (a.score || 0));
  return `<ol class="ranking">${(limit ? list.slice(0, limit) : list).map((p) => `
    <li class="${p.uid === G.uid ? "me" : ""} ${p.online === false ? "off" : ""}">
      <span class="pname">${esc(p.name)}</span><span class="pts">${p.score || 0}</span>
    </li>`).join("")}</ol>`;
}

function viewEnd() {
  const r = S.room;
  const top = G.sortedPlayers(r).sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  return `<main class="screen end">
    <section class="result-head">
      <div class="trophy">🏆</div>
      <h2>${top && top.uid === G.uid ? "Hai vinto la partita!" : `${esc(top ? top.name : "?")} vince la partita`}</h2>
    </section>
    ${ranking(r)}
    <div class="bottom-bar">
      ${isHost() ? '<button class="btn primary big" data-action="lobby">Nuova partita</button>'
        : "<p class=\"waiting\">L'host può avviare una nuova partita</p>"}
      <button class="btn ghost" data-action="leave">Esci</button>
    </div>
  </main>`;
}

function viewMenu() {
  const r = S.room;
  const hostOffline = r.players[r.hostUid] && r.players[r.hostUid].online === false;
  return `<div class="sheet-backdrop" data-action="closeMenu"></div>
  <div class="sheet" role="dialog" aria-label="Menu">
    <div class="sheet-grip"></div>
    <div class="sheet-head"><h2>Menu</h2><button class="close-btn" data-action="closeMenu" aria-label="Chiudi">✕</button></div>
    <h3>Classifica <small class="muted">· si vince a ${(r.settings && r.settings.target) || 30}</small></h3>
    ${ranking(r)}
    <h3>Azioni</h3>
    <div class="sheet-actions">
      <button class="btn" data-action="share">Invita altri</button>
      ${isHost() && r.state.phase !== "end" ? `<button class="btn" data-action="skip">Salta questo round</button>
        <button class="btn" data-action="endGame">Termina partita</button>` : ""}
      ${hostOffline && !isHost() ? `<button class="btn" data-action="becomeHost">L'host è offline: diventa host</button>` : ""}
      <button class="btn ghost" data-action="leave">Esci dalla stanza</button>
    </div>
  </div>`;
}

// Visore a schermo intero: scorre le carte e mostra l'azione del momento
function viewViewer() {
  const v = S.viewer;
  const id = v.list[v.index];
  const c = S.cardById[id] || {};
  const r = S.room;
  let action = "";
  if (v.mode === "tell") action = `<button class="btn primary big" data-action="pickTell">Scelgo questa</button>`;
  if (v.mode === "play") action = `<button class="btn primary big" data-action="pickPlay">Gioca questa</button>`;
  if (v.mode === "vote") {
    const owner = v.owners[v.index];
    const voted = r && G.currentVotes(r)[G.uid];
    if (owner === G.uid) action = `<button class="btn big" disabled>È la tua carta</button>`;
    else if (!voted) action = `<button class="btn primary big" data-action="pickVote">Voto questa</button>`;
  }
  const showInfo = v.mode === "credit" || v.mode === "result";
  return `<div class="viewer" data-swipe="1">
    <div class="viewer-top">
      <span class="viewer-count">${v.list.length > 1 ? `${v.index + 1} / ${v.list.length}` : ""}</span>
      <button class="close-btn" data-action="closeViewer" aria-label="Chiudi">✕</button>
    </div>
    <div class="viewer-img">
      ${v.list.length > 1 ? '<button class="nav prev" data-action="viewerPrev" aria-label="Precedente">‹</button>' : ""}
      <img src="${imgSrc(id)}" alt="">
      ${v.list.length > 1 ? '<button class="nav next" data-action="viewerNext" aria-label="Successiva">›</button>' : ""}
    </div>
    ${showInfo ? `<p class="viewer-info"><b>${esc(c.title)}</b><br>${esc(c.artist || "Anonimo")}${c.date ? ", " + esc(c.date) : ""}
      ${c.aic ? `<br><a href="https://www.artic.edu/artworks/${c.aic}" target="_blank" rel="noopener">Scheda del museo</a>` : ""}</p>` : ""}
    <div class="viewer-actions">${action}</div>
  </div>`;
}

function openViewer(list, index, mode, owners) {
  S.viewer = { list, index, mode, owners };
  render(true);
}

// swipe nel visore
let touchX = null;
document.addEventListener("touchstart", (e) => {
  if (e.target.closest("[data-swipe]")) touchX = e.touches[0].clientX;
}, { passive: true });
document.addEventListener("touchend", (e) => {
  if (touchX === null || !S.viewer) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) moveViewer(dx < 0 ? 1 : -1);
});
function moveViewer(d) {
  const v = S.viewer;
  if (!v || v.list.length < 2) return;
  v.index = (v.index + d + v.list.length) % v.list.length;
  render(true);
}
document.addEventListener("keydown", (e) => {
  if (!S.viewer) return;
  if (e.key === "ArrowRight") moveViewer(1);
  if (e.key === "ArrowLeft") moveViewer(-1);
  if (e.key === "Escape") { S.viewer = null; render(true); }
});

// ---------- stanza ----------
function enterRoom(code) {
  Object.assign(S, { code, screen: "room", room: null, hand: null, handLoaded: false, prev: {}, tellCard: null, viewer: null });
  LS.set("lastRoom", code);
  const url = new URL(location.href);
  url.searchParams.set("r", code);
  history.replaceState(null, "", url);
  if (disconnect) disconnect();
  disconnect = G.connect(code, onRoom, onHand);
  keepAwake();
  render(true);
}

function exitRoom(msg) {
  if (disconnect) disconnect();
  disconnect = null;
  LS.del("lastRoom");
  Object.assign(S, { code: null, room: null, showMenu: false, viewer: null, screen: "home", prefillCode: "" });
  const url = new URL(location.href);
  url.searchParams.delete("r");
  history.replaceState(null, "", url);
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  render(true);
  if (msg) toast(msg);
}

function onRoom(room) {
  if (!room || !room.hostUid) return exitRoom("La stanza non esiste più");
  if (!room.players || !room.players[G.uid]) return exitRoom("Sei uscito dalla stanza");
  S.room = room;
  const st = room.state || {};
  const p = S.prev;
  if (st.round !== p.round || st.phase !== p.phase) {
    if (S.viewer && S.viewer.mode !== "credit") S.viewer = null;
    if (st.round !== p.round) S.tellCard = null;
  }
  if (p.phase && st.phase !== p.phase) {
    if (st.phase === "clue" && st.tellerUid === G.uid) buzz([60, 40, 60]);
    if (st.phase === "playing" && st.tellerUid !== G.uid) buzz(80);
    if (st.phase === "voting") buzz(80);
  }
  S.prev = { round: st.round, phase: st.phase };

  // Il narratore manda avanti la partita quando tutti hanno fatto la loro mossa
  if (st.tellerUid === G.uid) {
    const exp = G.expected(room);
    const plays = G.currentPlays(room);
    if (st.phase === "playing" && exp.length && exp.every((u) => plays[u])) {
      G.toVoting(S.code, st.round).catch(console.error);
    }
    if (st.phase === "voting") {
      const votes = G.currentVotes(room);
      const voters = exp.filter((u) => plays[u]);
      if (voters.length && voters.every((u) => votes[u])) G.finishVoting(S.code, room).catch(console.error);
    }
  }
  ensureHand();
  render();
}

function onHand(hand) {
  S.hand = hand;
  S.handLoaded = true;
  ensureHand();
  render();
}

function ensureHand() {
  const r = S.room;
  if (!r || !r.state || !S.handLoaded || drawing) return;
  if (!["clue", "playing", "voting", "result"].includes(r.state.phase)) return;
  if (!r.deck || !r.deck.cards) return;
  const cards = myHand();
  // chi ha già giocato in questo round ha 5 carte finché non pesca: pesca subito
  if (cards.length >= G.HAND_SIZE) return;
  drawing = true;
  G.drawInto(S.code, r, cards)
    .catch((e) => { console.error(e); toast("Errore nel pescare le carte"); })
    .finally(() => { drawing = false; });
}

async function shareRoom() {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("r", S.code);
  const text = `Vieni a giocare a Visioni! Codice stanza: ${S.code}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Visioni", text, url: url.toString() }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast("Link copiato"); }
  catch { toast(`Codice: ${S.code}`); }
}

function getName() {
  const name = (document.getElementById("nameInput")?.value || "").trim().slice(0, 16);
  if (!name) { toast("Scrivi prima il tuo nome"); document.getElementById("nameInput")?.focus(); return null; }
  LS.set("name", name);
  return name;
}

// ---------- azioni ----------
const ACTIONS = {
  async create() {
    const name = getName(); if (!name) return;
    enterRoom(await G.createRoom(name));
  },
  async join() {
    const name = getName(); if (!name) return;
    const code = (document.getElementById("codeInput")?.value || "").trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) return toast("Il codice è di 4 lettere");
    await G.joinRoom(code, name);
    enterRoom(code);
  },
  credits() { S.screen = "credits"; window.scrollTo(0, 0); render(true); },
  home() { S.screen = "home"; render(true); },
  viewCredit(el) {
    const ids = S.cards.map((c) => c.id);
    openViewer(ids, ids.indexOf(Number(el.dataset.id)), "credit");
  },
  share: shareRoom,
  async copyCode() { try { await navigator.clipboard.writeText(S.code); toast("Codice copiato"); } catch { /* ok */ } },
  setTarget(el) { return G.setSetting(S.code, "target", Number(el.dataset.v)); },
  async start() {
    if (S.cards.length < 30) return toast("Mazzo non caricato");
    await G.startGame(S.code, S.room, shuffle(S.cards.map((c) => c.id)));
  },
  openHandTell(el) { openViewer(myHand(), Number(el.dataset.i), "tell"); },
  openHandPlay(el) { openViewer(myHand(), Number(el.dataset.i), "play"); },
  openHandView(el) { openViewer(myHand(), Number(el.dataset.i), "view"); },
  openBoard(el) {
    const b = G.board(S.room);
    const r = S.room;
    const canVote = r.state.tellerUid !== G.uid && G.currentPlays(r)[G.uid];
    openViewer(b.map((x) => x.card), Number(el.dataset.i), canVote ? "vote" : "view", b.map((x) => x.owner));
  },
  openResult(el) {
    const b = G.board(S.room);
    openViewer(b.map((x) => x.card), Number(el.dataset.i), "result");
  },
  closeViewer() { S.viewer = null; render(true); },
  viewerPrev() { moveViewer(-1); },
  viewerNext() { moveViewer(1); },
  pickTell() {
    S.tellCard = S.viewer.list[S.viewer.index];
    S.viewer = null;
    buzz(15);
    render(true);
  },
  changeTell() { S.tellCard = null; render(true); },
  async tell() {
    const clue = (document.getElementById("clueInput")?.value || "").trim().slice(0, 80);
    drawing = true;
    try { await G.tell(S.code, S.room, myHand(), S.tellCard, clue); }
    finally { drawing = false; }
    S.tellCard = null;
  },
  async pickPlay() {
    const card = S.viewer.list[S.viewer.index];
    S.viewer = null;
    render(true);
    drawing = true;
    try { await G.play(S.code, S.room, myHand(), card); }
    finally { drawing = false; }
    buzz(15);
  },
  async pickVote() {
    const card = S.viewer.list[S.viewer.index];
    S.viewer = null;
    render(true);
    await G.vote(S.code, S.room, card);
    buzz(15);
  },
  toVoting() { return G.toVoting(S.code, S.room.state.round); },
  finishVoting() { return G.finishVoting(S.code, S.room); },
  next() { return G.nextRound(S.code, S.room); },
  async skip() {
    if (!confirm("Saltare questo round? Le carte già giocate vanno perse.")) return;
    S.showMenu = false;
    await G.nextRound(S.code, S.room, true);
  },
  async endGame() {
    if (!confirm("Terminare la partita adesso? Si passa alla classifica finale.")) return;
    S.showMenu = false;
    await G.endGame(S.code);
  },
  lobby() { return G.backToLobby(S.code); },
  async becomeHost() { await G.becomeHost(S.code); toast("Ora sei l'host"); },
  menu() { S.showMenu = true; render(true); },
  closeMenu() { S.showMenu = false; render(true); },
  async leave() {
    if (!confirm("Vuoi uscire dalla stanza?")) return;
    const code = S.code, room = S.room;
    if (disconnect) disconnect();
    disconnect = null;
    await G.leave(code, room);
    exitRoom();
  },
};

const locks = new Set();
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  const fn = ACTIONS[a];
  if (!fn || locks.has(a)) return;
  locks.add(a);
  try { await fn(el, e); }
  catch (err) { console.error(err); toast(err.message || "Qualcosa è andato storto"); }
  finally { locks.delete(a); }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.id === "codeInput") ACTIONS.join().catch((err) => toast(err.message));
  if (e.target.id === "nameInput" || e.target.id === "clueInput") e.target.blur();
});

// ---------- avvio ----------
async function boot() {
  render(true);
  try {
    S.cards = await (await fetch("cards.json")).json();
    S.cardById = Object.fromEntries(S.cards.map((c) => [c.id, c]));
  } catch (e) { console.error("Mazzo non caricato", e); }
  try {
    await G.init();
  } catch (e) {
    console.error(e);
    S.error = "Non riesco a collegarmi. Controlla la connessione.";
    S.screen = "error";
    return render(true);
  }
  const urlCode = (new URLSearchParams(location.search).get("r") || "").toUpperCase();
  for (const code of [...new Set([urlCode, LS.get("lastRoom", "")].filter(Boolean))]) {
    try {
      const room = await G.getRoom(code);
      if (room && room.players && room.players[G.uid]) {
        await G.joinRoom(code, room.players[G.uid].name);
        return enterRoom(code);
      }
    } catch (e) { console.warn(e); }
  }
  S.prefillCode = /^[A-Z]{4}$/.test(urlCode) ? urlCode : "";
  S.screen = "home";
  render(true);
}

boot();
