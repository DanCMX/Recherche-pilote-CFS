// === RECHERCHE PILOTE ===
async function searchPilot() {
  const input   = document.getElementById("search-input");
  const status  = document.getElementById("search-status");
  const list    = document.getElementById("search-results");
  const banner  = document.getElementById("live-banner");
  const btn     = document.getElementById("search-btn");

  if (!input || !status || !list) {
    console.error("Éléments de recherche manquants dans le DOM");
    return;
  }

  const query = (input.value || "").trim();
  if (!query) {
    status.textContent = "Merci de saisir un nom ou un numéro.";
    return;
  }

  status.textContent = "Recherche en cours…";
  list.innerHTML = "";
  if (banner) banner.classList.add("hidden");
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) {
      throw new Error(`Erreur serveur (${res.status})`);
    }

    const data = await res.json();
    // On suppose que ton endpoint renvoie { live_active: bool, results: [...] }
    if (banner && data.live_active === false) {
      banner.classList.remove("hidden");
    }

    const results = data.results || data.pilots || [];
    if (!results.length) {
      status.textContent = "Aucun résultat trouvé pour cette recherche.";
      return;
    }

    results.forEach((r) => {
      const li = document.createElement("li");
      // Adapte ces champs aux noms utilisés dans ta réponse JSON
      const rank   = r.rank   ?? r.position ?? "";
      const number = r.number ?? r.dossard ?? "";
      const name   = r.name   ?? r.pilote   ?? "";
      const gap    = r.gap    ?? r.ecart    ?? "";

      li.className = "result-item";
      li.textContent = `${rank ? rank + ". " : ""}#${number} ${name} ${gap ? " — " + gap : ""}`;
      list.appendChild(li);
    });

    status.textContent = "";
  } catch (e) {
    console.error("Erreur searchPilot:", e);
    status.textContent = "Erreur : " + e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// === VOTE LIKE / DISLIKE ===
async function vote(type) {
  const status = document.getElementById("comment-status");
  if (status) status.textContent = "";

  try {
    const res = await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type })
    });

    if (!res.ok) {
      throw new Error(`Erreur vote (${res.status})`);
    }

    await refreshComments();
  } catch (e) {
    console.error("Erreur vote:", e);
    if (status) status.textContent = "Erreur lors de l'envoi du vote.";
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
    const res = await fetch("/api/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, message })
    });

    if (!res.ok) {
      throw new Error(`Erreur commentaire (${res.status})`);
    }

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

    // likes / dislikes
    const likeEl    = document.getElementById("like-count");
    const dislikeEl = document.getElementById("dislike-count");
    if (likeEl)    likeEl.textContent    = data.likes    ?? 0;
    if (dislikeEl) dislikeEl.textContent = data.dislikes ?? 0;

    // commentaires
    const list = document.getElementById("comments-list");
    if (!list) return;

    list.innerHTML = "";
    (data.comments || []).forEach((c) => {
      const li = document.createElement("li");
      li.className = "comment-item";
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

// Au chargement, on récupère les stats
document.addEventListener("DOMContentLoaded", () => {
  refreshComments().catch(() => {});
});
