// ===== Réglages =====
const AUTO_REFRESH_META_MS = 30000;
const AUTO_REFRESH_FAV_MS  = 30000;

// Favoris (tests)
const FAV_KEY = "cfs_favorites_v1";
const FAV_LIMIT = 2;

// Mets ici ton lien Google Form (feedback)
const FEEDBACK_URL = "https://docs.google.com/forms/d/e/1FAIpQLSeR_CQQTAXImL-kIcHEy8ifVz6jeLU3wFBD2SseCBPEOavjIA/viewform?usp=header";

// ===== Helpers =====
function esc(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function msToHMS(ms) {
  ms = Number(ms);
  if (!Number.isFinite(ms)) return "—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;
}

function getFavs() {
  try {
    const arr = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function setFavs(arr) {
  localStorage.setItem(FAV_KEY, JSON.stringify(arr));
}

function addFav(num) {
  num = (num ?? "").toString().trim();
  if (!num) return { ok: false, msg: "Numéro invalide." };

  let favs = getFavs();
  if (favs.includes(num)) return { ok: true, msg: "Déjà en favori." };

  if (favs.length >= FAV_LIMIT) {
    return { ok: false, msg: `Limite atteinte (max ${FAV_LIMIT} pour les tests).` };
  }

  favs.push(num);
  setFavs(favs);
  return { ok: true, msg: "Ajouté aux favoris." };
}

function removeFav(num) {
  let favs = getFavs().filter(x => x !== String(num));
  setFavs(favs);
}

// ===== UI builders =====
function pilotCardHTML(p, { showFavButton = false, showRemove = false } = {}) {
  // Les clés exactes viennent de ton JSON: Position, Numero, Nom, Categorie, Moto, Tours, Ecart, Temps
  const num   = p.Numero ?? p["N°"] ?? p.Num ?? p.Dossard ?? "";
  const pos   = p.Position ?? p.Pos ?? "";
  const name  = p.Nom ?? p.Name ?? "";
  const cat   = p.Categorie ?? "";
  const moto  = p.Moto ?? "";
  const tours = p.Tours ?? "";
  const ecart = p.Ecart ?? "";
  const best  = p.Temps ?? p.MeilleurTemps ?? "";

  const idLine = `
    <div class="pilot-id">
      <strong>#${esc(num)}</strong>
      <span class="badge">Pos ${esc(pos)}</span>
    </div>
  `;

  const removeBtn = showRemove
    ? `<button class="btn btn-small btn-remove" data-remove="${esc(num)}" type="button">Retirer</button>`
    : "";

  const favBtn = showFavButton
    ? `<button class="btn btn-small btn-fav" data-fav="${esc(num)}" type="button">⭐ Favori</button>`
    : "";

  const actions = (removeBtn || favBtn)
    ? `<div class="actions">${favBtn}${removeBtn}</div>`
    : "";

  return `
    <div class="pilot-card">
      <div class="pilot-top">
        ${idLine}
      </div>

      <div class="pilot-name">${esc(name)}</div>
      <div class="pilot-sub">${esc(cat)}${cat && moto ? " • " : ""}${esc(moto)}</div>
      <div class="pilot-sub">
        ${tours ? `Tours: ${esc(tours)}` : ""}
        ${ecart ? `${tours ? " • " : ""}Écart: ${esc(ecart)}` : ""}
        ${best ? `${(tours || ecart) ? " • " : ""}Best: ${esc(best)}` : ""}
      </div>

      ${actions}
    </div>
  `;
}

// ===== API calls =====
async function loadMeta() {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const el = document.getElementById("meta-elapsed");
  const re = document.getElementById("meta-remaining");
  const co = document.getElementById("meta-count");

  try {
    const res = await fetch("/api/meta", { cache: "no-store" });
    const data = await res.json();

    const figer = !!data.FigerTemps;
    // Heuristique statut :
    // - si figé -> orange
    // - sinon -> vert
    if (figer) {
      dot?.classList.remove("dot-live", "dot-off");
      dot?.classList.add("dot-paused");
      if (text) text.textContent = "COURSE FIGÉE";
    } else {
      dot?.classList.remove("dot-paused", "dot-off");
      dot?.classList.add("dot-live");
      if (text) text.textContent = "LIVE ACTIF";
    }

    if (el) el.textContent = msToHMS(data.TempsEcoule);
    if (re) re.textContent = msToHMS(data.TempsRestant);
    if (co) co.textContent = (data.nb ?? "—").toString();

  } catch (e) {
    dot?.classList.remove("dot-live", "dot-paused");
    dot?.classList.add("dot-off");
    if (text) text.textContent = "HORS LIGNE";
  }
}

async function searchPilot(query) {
  const zone = document.getElementById("search-zone");
  query = (query ?? "").trim();

  if (!zone) return;
  if (!query) {
    zone.innerHTML = `<div class="muted">Merci de saisir un nom ou un numéro.</div>`;
    return;
  }

  zone.innerHTML = `<div class="muted">Recherche en cours…</div>`;

  try {
    const url = `/api/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
      zone.innerHTML = `<div class="muted">Aucun résultat.</div>`;
      return;
    }

    // On prend le meilleur match (le premier) pour rester “1 pilote libre”
    const r = results[0];
    const raw = r.raw || null;

    // Si backend renvoie raw, on l’utilise, sinon on reconstruit un objet minimal
    const pilot = raw || {
      Numero: r.num,
      Position: r.pos,
      Nom: r.name,
      Temps: r.best
    };

    zone.innerHTML = pilotCardHTML(pilot, { showFavButton: true });

    // brancher bouton favori
    zone.querySelectorAll("[data-fav]").forEach(btn => {
      btn.addEventListener("click", () => {
        const num = btn.getAttribute("data-fav");
        const out = addFav(num);
        btn.textContent = out.ok ? "⭐ Ajouté" : "⭐ Favori";
        alert(out.msg);
        refreshFavorites();
      });
    });

  } catch (e) {
    zone.innerHTML = `<div class="muted">Erreur de recherche.</div>`;
  }
}

async function refreshFavorites() {
  const zone = document.getElementById("favorites-zone");
  if (!zone) return;

  const favs = getFavs();
  if (!favs.length) {
    zone.innerHTML = `<div class="muted">Aucun favori pour l’instant.</div>`;
    return;
  }

  try {
    const url = `/api/pilots/by_numbers?nums=${encodeURIComponent(favs.join(","))}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    const pilots = Array.isArray(data.pilots) ? data.pilots : [];
    if (!pilots.length) {
      zone.innerHTML = `<div class="muted">Favoris introuvables (données indisponibles).</div>`;
      return;
    }

    zone.innerHTML = pilots.map(p => pilotCardHTML(p, { showRemove: true })).join("");

    zone.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        const num = btn.getAttribute("data-remove");
        removeFav(num);
        refreshFavorites();
      });
    });

  } catch (e) {
    zone.innerHTML = `<div class="muted">Erreur chargement favoris.</div>`;
  }
}

// ===== Boot =====
document.addEventListener("DOMContentLoaded", () => {
  // Lien feedback
  const feedback = document.getElementById("feedback-link");
  if (feedback) feedback.href = FEEDBACK_URL;

  // Form search
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    searchPilot(input?.value || "");
  });

  // Auto refresh
  loadMeta();
  refreshFavorites();

  setInterval(loadMeta, AUTO_REFRESH_META_MS);
  setInterval(refreshFavorites, AUTO_REFRESH_FAV_MS);

  // PWA
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
});
