const AUTO_REFRESH_MS = 30000; // aligné sur Rafraichir côté JSON

function esc(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function loadMeta() {
  const liveEl = document.getElementById("live-status");
  const flagEl = document.getElementById("flag-status");
  const timeEl = document.getElementById("time-status");

  try {
    const res = await fetch("/api/meta", { cache: "no-store" });
    const data = await res.json();

    // Infos course
    const figer = !!data.FigerTemps;
    const drapeau = data.Drapeau;

    if (liveEl) liveEl.textContent = figer ? "COURSE FIGÉE" : "LIVE";
    if (flagEl) flagEl.textContent = `Drapeau: ${drapeau ?? "—"}`;

    const ecoule = data.TempsEcoule ?? "";
    const restant = data.TempsRestant ?? "";
    if (timeEl) timeEl.textContent = `Écoulé: ${ecoule} | Restant: ${restant} | Pilotes: ${data.nb ?? 0}`;

  } catch (e) {
    if (liveEl) liveEl.textContent = "HORS LIGNE";
    if (flagEl) flagEl.textContent = "—";
  }
}

async function searchPilot(q) {
  const zone = document.getElementById("results");
  if (!zone) return;

  q = (q ?? "").trim();
  if (!q) {
    zone.textContent = "Merci de saisir un nom ou un numéro.";
    return;
  }

  zone.textContent = "Recherche en cours…";

  try {
    const url = `/api/search?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
      zone.textContent = "Aucun résultat.";
      return;
    }

    const html = results.slice(0, 30).map(r => {
      const pos = esc(r.pos);
      const num = esc(r.num);
      const name = esc(r.name);
      const best = esc(r.best);

      return `<div class="result-item">
        <strong>${pos ? pos + "." : ""} ${num ? "#" + num : ""}</strong>
        <span>${name}</span>
        ${best ? `<em> — ${best}</em>` : ""}
      </div>`;
    }).join("");

    zone.innerHTML = html;

  } catch (e) {
    zone.textContent = "Erreur de recherche.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      searchPilot(input?.value || "");
    });
  }

  loadMeta();
  setInterval(loadMeta, AUTO_REFRESH_MS);
});

// PWA
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
