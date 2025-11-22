// === TEST : est-ce que le bouton GO appelle bien cette fonction ? ===
function searchPilot() {
  const input   = document.getElementById("search-input");
  const status  = document.getElementById("search-status");
  const list    = document.getElementById("search-results");

  if (!input || !status || !list) {
    console.error("Éléments manquants dans le DOM");
    alert("DEBUG : JS chargé, mais éléments introuvables");
    return;
  }

  const query = (input.value || "").trim();

  status.textContent = "DEBUG : recherche lancée pour → " + (query || "(vide)");
  list.innerHTML = "";

  const li = document.createElement("li");
  li.textContent = "DEBUG : la fonction searchPilot() est bien appelée.";
  list.appendChild(li);
}

// === COMMENTAIRES FAKES pour l'instant ===
async function refreshComments() {
  const list = document.getElementById("comments-list");
  if (list) {
    list.innerHTML = "";
    const li = document.createElement("li");
    li.textContent = "DEBUG : refreshComments() appelée (aucun vrai appel API pour l'instant).";
    list.appendChild(li);
  }
}

// PWA (on garde)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then(() => console.log("SW registered"))
    .catch((err) => console.error("SW error", err));
}

// On lance juste un refresh debug
document.addEventListener("DOMContentLoaded", () => {
  refreshComments();
});
