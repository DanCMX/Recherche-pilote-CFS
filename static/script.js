// === RECHERCHE PILOTE ===
async function searchPilot() {
  const input  = document.getElementById("search-input");
  const zone   = document.getElementById("results");

  if (!input || !zone) {
    console.error("Éléments DOM manquants pour la recherche");
    return;
  }

  const query = (input.value || "").trim();
  if (!query) {
    zone.textContent = "Merci de saisir un nom ou un numéro.";
    return;
  }

  zone.textContent = "Recherche en cours…";

  try {
    // 🚨 ICI : on passe en POST au lieu de GET
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })  // adapte le nom du champ si besoin
    });

    if (!res.ok) {
      throw new Error(`Erreur serveur (${res.status})`);
    }

    const data = await res.json();

    // On essaye de récupérer un tableau de résultats
    const results = data.results || data.pilots || data.data || [];
    if (!Array.isArray(results) || !results.length) {
      zone.textContent = "Aucun résultat trouvé pour cette recherche.";
      return;
    }

    // On construit une liste HTML
    const ul = document.createElement("ul");
    ul.className = "results-list";

    results.forEach(r => {
      const li = document.createElement("li");
      li.className = "result-item";

      const rank   = r.rank   ?? r.position ?? "";
      const number = r.number ?? r.dossard  ?? "";
      const name   = r.name   ?? r.pilote   ?? "";
      const gap    = r.gap    ?? r.ecart    ?? "";

      let text = "";
      if (rank) text += rank + ". ";
      if (number) text += "#" + number + " ";
      if (name) text += name;
      if (gap)  text += " — " + gap;

      li.textContent = text || JSON.stringify(r);
      ul.appendChild(li);
    });

    zone.innerHTML = "";
    zone.appendChild(ul);
  } catch (e) {
    console.error("Erreur searchPilot:", e);
    zone.textContent = "Erreur : " + e.message;
  }

  const query = (input.value || "").trim();
  if (!query) {
    zone.textContent = "Merci de saisir un nom ou un numéro.";
    return;
  }

  zone.textContent = "Recherche en cours…";

  try {
    // ⚠ adapte /api/search si ton endpoint est différent (ex: /search)
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) {
      throw new Error(`Erreur serveur (${res.status})`);
    }

    const data = await res.json();

    // On essaye de récupérer un tableau de résultats
    const results = data.results || data.pilots || data.data || [];
    if (!Array.isArray(results) || !results.length) {
      zone.textContent = "Aucun résultat trouvé pour cette recherche.";
      return;
    }

    // On construit une liste HTML
    const ul = document.createElement("ul");
    ul.className = "results-list";

    results.forEach(r => {
      const li = document.createElement("li");
      li.className = "result-item";

      const rank   = r.rank   ?? r.position ?? "";
      const number = r.number ?? r.dossard  ?? "";
      const name   = r.name   ?? r.pilote   ?? "";
      const gap    = r.gap    ?? r.ecart    ?? "";

      let text = "";
      if (rank) text += rank + ". ";
      if (number) text += "#" + number + " ";
      if (name) text += name;
      if (gap)  text += " — " + gap;

      li.textContent = text || JSON.stringify(r);
      ul.appendChild(li);
    });

    zone.innerHTML = "";
    zone.appendChild(ul);
  } catch (e) {
    console.error("Erreur searchPilot:", e);
    zone.textContent = "Erreur : " + e.message;
  }
}

// === VOTE LIKE / DISLIKE ===
async function vote(type) {
  try {
    await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type })
    });
    await refreshComments();
  } catch (e) {
    console.error("Erreur vote:", e);
  }
}

// === ENVOI COMMENTAIRE ===
async function sendComment(event) {
  if (event) event.preventDefault();

  const nameInput = document.getElementById("name");
  const msgInput  = document.getElementById("message");
  const status    = document.getElementById("comment-status");

  const name    = (nameInput && nameInput.value || "").trim();
  const message = (msgInput  && msgInput.value  || "").trim();

  if (!message) {
    if (status) status.textContent = "Merci d'écrire un message.";
    return;
  }

  if (status) status.textContent = "Envoi en cours…";

  try {
    await fetch("/api/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, message })
    });

    if (msgInput) msgInput.value = "";
    if (status) status.textContent = "Merci pour ton retour !";

    await refreshComments();
  } catch (e) {
    console.error("Erreur sendComment:", e);
    if (status) status.textContent = "Erreur : " + e.message;
  }
}

// === RAFRAÎCHIR LES STATS / COMMENTAIRES ===
async function refreshComments() {
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) throw new Error(`Erreur stats (${res.status})`);

    const data = await res.json();
    const list = document.getElementById("comments-list");

    // compteurs like/dislike si présents
    const likeEl    = document.getElementById("like-count");
    const dislikeEl = document.getElementById("dislike-count");
    if (likeEl)    likeEl.textContent    = data.likes    ?? 0;
    if (dislikeEl) dislikeEl.textContent = data.dislikes ?? 0;

    if (!list) return;

    list.innerHTML = "";
    (data.comments || []).forEach(c => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="meta">
          <span class="name">${c.name || "Anonyme"}</span>
        </div>
        <div class="text">${c.message}</div>
      `;
      list.appendChild(li);
    });
  } catch (e) {
    console.error("Erreur refreshComments:", e);
  }
}

// === SERVICE WORKER PWA ===
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then(() => console.log("SW registered"))
    .catch((err) => console.error("SW error", err));
}

// === Au chargement, on récupère les stats ===
document.addEventListener("DOMContentLoaded", () => {
  refreshComments().catch(() => {});
});
