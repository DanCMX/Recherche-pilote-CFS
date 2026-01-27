import os
import time
import json
import threading
import requests
from flask import Flask, render_template, request, jsonify

# =========================================
# Config
# =========================================
R1_URL = os.environ.get("R1_URL", "https://www.courses-sur-sable.fr/chrono/r1.json")
FETCH_TIMEOUT = float(os.environ.get("FETCH_TIMEOUT", "10"))
MIN_FETCH_INTERVAL = float(os.environ.get("MIN_FETCH_INTERVAL", "1.0"))  # anti-spam
CACHE_TTL = float(os.environ.get("CACHE_TTL", "2.0"))  # cache en mémoire

app = Flask(__name__, static_folder="static", template_folder="templates")

_cache_lock = threading.Lock()
_cache = {
    "ts": 0.0,
    "data": None,
    "err": None,
    "http_status": None,
}

# =========================================
# Fetch JSON (gère BOM)
# =========================================
def fetch_r1_json():
    r = requests.get(
        R1_URL,
        timeout=FETCH_TIMEOUT,
        headers={
            "User-Agent": "CMX-Chrono/2.0 (+https://cmxcreations.fr)",
            "Accept": "application/json,text/plain,*/*",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )
    status = r.status_code
    r.raise_for_status()

    # BOM UTF-8 => decode utf-8-sig
    text = r.content.decode("utf-8-sig", errors="replace")
    data = json.loads(text)
    return data, status

def get_data_cached(force=False):
    """Renvoie (data, err, http_status). Cache en mémoire pour limiter les requêtes."""
    now = time.time()
    with _cache_lock:
        if (not force) and _cache["data"] is not None and (now - _cache["ts"] < CACHE_TTL):
            return _cache["data"], _cache["err"], _cache["http_status"]

        # anti-spam : si on vient de fetch il y a < MIN_FETCH_INTERVAL, on renvoie cache même expiré
        if _cache["data"] is not None and (now - _cache["ts"] < MIN_FETCH_INTERVAL):
            return _cache["data"], _cache["err"], _cache["http_status"]

        try:
            data, status = fetch_r1_json()
            _cache.update({"ts": now, "data": data, "err": None, "http_status": status})
        except Exception as e:
            # on garde la dernière data si on en a une
            _cache["ts"] = now
            _cache["err"] = str(e)
            if _cache["data"] is None:
                _cache["data"] = {}
            _cache["http_status"] = _cache["http_status"] or 0

        return _cache["data"], _cache["err"], _cache["http_status"]

# =========================================
# Parse helpers
# =========================================
def parse_columns(data):
    cols = data.get("Colonnes") or []
    # Chez toi: {"Nom": "...", "Texte": "..."}
    col_names = [c.get("Nom") or c.get("Texte") or f"col_{i}" for i, c in enumerate(cols)]
    return col_names

def parse_rows_as_dicts(data):
    col_names = parse_columns(data)
    rows = data.get("Donnees") or []
    pilots = []
    for row in rows:
        if isinstance(row, list):
            pilots.append(dict(zip(col_names, row)))
    return pilots

def normalize(s):
    return (s or "").strip().lower()

def pick_key(pilot, *candidates):
    """Trouve la première clé existante parmi candidates (insensible à la casse)."""
    if not pilot:
        return None
    keys = {k.lower(): k for k in pilot.keys()}
    for c in candidates:
        k = keys.get(c.lower())
        if k is not None:
            return k
    return None

# =========================================
# Routes
# =========================================
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/meta")
def api_meta():
    data, err, status = get_data_cached()
    return jsonify({
        "ok": True,
        "source": R1_URL,
        "http_status": status,
        "error": err,
        "Titre": data.get("Titre"),
        "Drapeau": data.get("Drapeau"),
        "HeureJourUTC": data.get("HeureJourUTC"),
        "FuseauHoraire": data.get("FuseauHoraire"),
        "TempsEcoule": data.get("TempsEcoule"),
        "TempsRestant": data.get("TempsRestant"),
        "TourRestant": data.get("TourRestant"),
        "FigerTemps": data.get("FigerTemps"),
        "Rafraichir": data.get("Rafraichir"),
        "nb": len(data.get("Donnees") or []),
    })

@app.route("/api/pilots")
def api_pilots():
    """Renvoie la liste complète (attention: peut être lourd)."""
    data, err, status = get_data_cached()
    pilots = parse_rows_as_dicts(data)
    return jsonify({"ok": True, "http_status": status, "error": err, "pilots": pilots})

@app.route("/api/pilot/<num>")
def api_pilot(num):
    data, err, status = get_data_cached()
    pilots = parse_rows_as_dicts(data)

    found = None
    for p in pilots:
        k_num = pick_key(p, "Numero", "N°", "Num", "Dossard")
        if k_num and str(p.get(k_num)) == str(num):
            found = p
            break

    return jsonify({
        "ok": True,
        "http_status": status,
        "error": err,
        "pilot": found
    })

@app.route("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"ok": True, "results": []})

    data, err, status = get_data_cached()
    pilots = parse_rows_as_dicts(data)

    qn = normalize(q)
    results = []

    for p in pilots:
        k_num = pick_key(p, "Numero", "N°", "Num", "Dossard")
        k_name = pick_key(p, "Nom", "Pilote", "Name")
        k_pos = pick_key(p, "Position", "Pos")
        k_best = pick_key(p, "MeilleurTemps", "Best", "BestLap", "Meilleur", "Temps")

        # recherche sur toutes les valeurs texte
        hay = " ".join([str(v) for v in p.values()]).lower()
        if qn in hay:
            results.append({
                "pos": p.get(k_pos) if k_pos else "",
                "num": p.get(k_num) if k_num else "",
                "name": p.get(k_name) if k_name else "",
                "best": p.get(k_best) if k_best else "",
                "raw": p,
            })

    # Si l’utilisateur tape un numéro exact, on met ceux-là en premier
    results.sort(key=lambda r: (0 if str(r["num"]) == q else 1, str(r["pos"])))
    return jsonify({"ok": True, "http_status": status, "error": err, "results": results})

@app.route("/health")
def health():
    data, err, status = get_data_cached()
    return jsonify({"ok": True, "http_status": status, "error": err})

# =========================================
# Run
# =========================================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
