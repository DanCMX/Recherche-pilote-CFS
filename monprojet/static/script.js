async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  if (!res.ok) {
    // essaie de remonter un message lisible
    let txt = "";
    try { txt = await res.text(); } catch(e) {}
    throw new Error(txt || res.statusText || "HTTP " + res.status);
  }
  return res.json();
}

async function searchPilot() {
  const q = (document.getElementById("search-input").value || "").trim();
  const status = document.getElementById("search-status");
  const list = document.getElementById("search-results");
  const banner = document.getElementById("live-banner");

  // on repart propre
  status.textContent = "";
  list.innerHTML = "";
  if (banner) banner.classList.add("hidden");

  if (!q) {
    status.textContent = "Saisissez un nom ou un numéro.";
    return;
  }

  status.textContent = "Recherche...";

  try {
    const data = await fetchJSON("/api/search", {
      method: "POST",
      body: JSON.stringify({ q })
    });

    // Aucun résultat → affiche la bannière
    if (!data.ok || !data.results || data.results.length === 0) {
      status.textContent = (data && data.message) || "Aucun résultat ou live inactif.";
      if (banner) banner.classList.remove("hidden");
      return;
    }

    // Résultats → cache la bannière et affiche la liste
    status.textContent = `Résultats : ${data.results.length}`;
    data.results.forEach(line => {
      const li = document.createElement("li");
      li.className = "search-item";
      li.textContent = line;
      list.appendChild(li);
    });
    if (banner) banner.classList.add("hidden");
  } catch (e) {
    status.textContent = "Erreur: " + e.message;
    if (banner) banner.classList.remove("hidden");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("search-btn");
  const input = document.getElementById("search-input");
  if (btn) btn.addEventListener("click", searchPilot);
  if (input) input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") searchPilot();
  });
});

async function vote(type) {
  try {
    const res = await fetch("/api/vote", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({type})
    });
    const data = await res.json();
    document.getElementById("like-count").textContent = data.likes ?? 0;
    document.getElementById("dislike-count").textContent = data.dislikes ?? 0;
    console.log("Vote enregistré:", data);
  } catch (e) {
    alert("Erreur: " + e.message);
  }
}

async function sendComment(ev) {
  ev.preventDefault();
  const name = document.getElementById("name").value.trim();
  const message = document.getElementById("message").value.trim();
  const status = document.getElementById("comment-status");
  if (!message) {
    status.textContent = "Message requis.";
    return;
  }
  status.textContent = "Envoi...";

  try {
    const res = await fetch("/api/comment", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ name, message })
    });
    const data = await res.json();

    if (data.ok) {
      status.textContent = "Merci pour votre commentaire !";
      document.getElementById("message").value = "";
      document.getElementById("name").value = "";
      refreshComments(); // 👈 on actualise la liste juste après
      setTimeout(() => status.textContent = "", 2000);
    } else {
      status.textContent = "Erreur : " + (data.error || "inconnue");
    }
  } catch (e) {
    status.textContent = "Erreur : " + e.message;
  }
}

async function refreshComments() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    const list = document.getElementById("comments-list");
    list.innerHTML = "";
    (data.comments || []).forEach(c => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="meta"><span class="name">${c.name || "Anonyme"}</span></div>
                      <div class="text">${c.message}</div>`;
      list.appendChild(li);
    });
  } catch (e) {
    console.error("Erreur refreshComments:", e);
  }
}
