import traceback
import os, json, time, threading, requests
from flask import Flask, render_template, request, jsonify
from bs4 import BeautifulSoup

# =========================================
# Config & chemins
# =========================================
DATA_DIR = os.environ.get("DATA_DIR", "./data")
os.makedirs(DATA_DIR, exist_ok=True)

VOTES_FILE    = os.path.join(DATA_DIR, "votes.json")
COUNTER_FILE  = os.path.join(DATA_DIR, "counter.json")
COMMENTS_FILE = os.path.join(DATA_DIR, "comments.txt")

RESULTS_URL = os.environ.get("RESULTS_URL", "https://www.courses-sur-sable.fr/chrono/live.html")


WEBHOOK_URL   = os.environ.get("FEEDBACK_WEBHOOK_URL")
WEBHOOK_TOKEN = os.environ.get("FEEDBACK_TOKEN")

# Locks
votes_lock    = threading.Lock()
counter_lock  = threading.Lock()
comments_lock = threading.Lock()

# =========================================
# Helpers fichiers
# =========================================
def read_json(path, default=None):
    if default is None:
        default = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def write_json_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)

def ensure_files():
    if not os.path.exists(VOTES_FILE):
        write_json_atomic(VOTES_FILE, {"likes": 0, "dislikes": 0})
    if not os.path.exists(COUNTER_FILE):
        write_json_atomic(COUNTER_FILE, {"visits": 0})
    if not os.path.exists(COMMENTS_FILE):
        with open(COMMENTS_FILE, "w", encoding="utf-8") as f:
            f.write("")

ensure_files()

def sanitize_text(s: str, maxlen: int):
    s = (s or "").strip()
    s = " ".join(s.split())
    return s[:maxlen]

# =========================================
# Feedback → Google Sheets webhook
# =========================================
def send_feedback(payload: dict):
    """Envoie une ligne vers Google Sheets via Apps Script (best effort)."""
    if not WEBHOOK_URL or not WEBHOOK_TOKEN:
        return
    try:
        data = dict(payload)
        data["token"] = WEBHOOK_TOKEN
        data["userAgent"] = request.headers.get("User-Agent", "")
        data["ip"] = request.headers.get("X-Forwarded-For", request.remote_addr or "")
        requests.post(WEBHOOK_URL, json=data, timeout=5)
    except Exception as e:
        print("[feedback] warn:", e)

# =========================================
# App Flask
# =========================================
app = Flask(__name__, static_folder="static", template_folder="templates")

# =========================================
# Routes principales
# =========================================
@app.route("/")
def index():
    with counter_lock:
        counter = read_json(COUNTER_FILE, {"visits": 0})
        counter["visits"] = int(counter.get("visits", 0)) + 1
        write_json_atomic(COUNTER_FILE, counter)
    # Optionnel : envoyer la visite dans le sheet
    send_feedback({"type": "visit"})
    return render_template("index.html")

@app.route("/api/stats")
def api_stats():
    votes   = read_json(VOTES_FILE, {"likes": 0, "dislikes": 0})
    counter = read_json(COUNTER_FILE, {"visits": 0})
    # Derniers commentaires (on renvoie les 20 derniers)
    comments = []
    try:
        with open(COMMENTS_FILE, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip()]
            for line in lines[-20:]:
                # format: ts|name|message
                parts = line.split("|", 2)
                if len(parts) == 3:
                    ts, name, message = parts
                    comments.append({
                        "timestamp": int(ts),
                        "name": name,
                        "message": message
                    })
    except Exception:
        pass
    return jsonify({
        "likes": votes.get("likes", 0),
        "dislikes": votes.get("dislikes", 0),
        "visits": counter.get("visits", 0),
        "comments": comments
    })

# =========================================
# API votes
# =========================================
@app.route("/api/vote", methods=["POST"])
def api_vote():
    data = request.get_json(silent=True) or {}
    vtype = data.get("type")
    if vtype not in ("like", "dislike"):
        return jsonify({"ok": False, "error": "type must be 'like' or 'dislike'"}), 400

    with votes_lock:
        votes = read_json(VOTES_FILE, {"likes": 0, "dislikes": 0})
        key = vtype + "s"
        votes[key] = int(votes.get(key, 0)) + 1
        write_json_atomic(VOTES_FILE, votes)

    # Envoi vers Google Sheets
    send_feedback({"type": "vote", "action": vtype})

    return jsonify({"ok": True, "likes": votes["likes"], "dislikes": votes["dislikes"]})

# =========================================
# API commentaires
# =========================================
@app.route("/api/comment", methods=["POST"])
def api_comment():
    data = request.get_json(silent=True) or {}
    name = sanitize_text(data.get("name", "Anonyme"), 40)
    message = sanitize_text(data.get("message", ""), 600)
    if not message:
        return jsonify({"ok": False, "error": "message required"}), 400

    record = f"{int(time.time())}|{name}|{message}"
    with comments_lock:
        with open(COMMENTS_FILE, "a", encoding="utf-8") as f:
            f.write(record + "\n")

    # Envoi vers Google Sheets
    send_feedback({"type": "comment", "name": name, "message": message})

    return jsonify({"ok": True})

# =========================================
# API recherche (par nom/numéro)
# =========================================
@app.route("/api/search", methods=["POST"])
def api_search():
    data = request.get_json(silent=True) or {}

    q = sanitize_text(
        data.get("q") or data.get("query") or data.get("search") or "",
        80
    )

    debug = bool(data.get("debug"))

    if not q:
        return jsonify({"ok": True, "results": []})

    try:
        # Récupère la page live
        r = requests.get(
            RESULTS_URL,
            timeout=15,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
            }
        )
        html = r.text or ""

        # 🔎 DEBUG : voir ce que Render récupère vraiment
        if debug:
            return jsonify({
                "ok": True,
                "results": [],
                "debug": {
                    "url": RESULTS_URL,
                    "status_code": r.status_code,
                    "len_html": len(html),
                    "has_table_tag": ("<table" in html.lower()),
                    "tables_count": html.lower().count("<table"),
                    "html_head": html[:600],
                }
            })

        if r.status_code != 200 or not html:
            return jsonify({"ok": True, "results": []})

        soup = BeautifulSoup(html, "html.parser")

        # ✅ Prend la table la plus “grosse” (souvent la bonne)
        tables = soup.find_all("table")
        best_table = None
        best_rows_count = 0
        for t in tables:
            trs = t.find_all("tr")
            if len(trs) > best_rows_count:
                best_rows_count = len(trs)
                best_table = t

        rows = []
        if best_table:
            trs = best_table.select("tr")
            for tr in trs[1:]:  # skip header
                cols = [c.get_text(" ", strip=True) for c in tr.select("th,td")]
                if cols:
                    rows.append(cols)

        # Filtre sur la requête (nom ou numéro)
        q_low = q.lower()
        filtered = []
        for cols in rows:
            line_low = " ".join(cols).lower()
            if q_low in line_low:
                filtered.append({
                    "raw": cols,
                    "pos": cols[0] if len(cols) > 0 else "",
                    "num": cols[1] if len(cols) > 1 else "",
                    "name": cols[2] if len(cols) > 2 else "",
                    "time": cols[3] if len(cols) > 3 else "",
                    "gap": cols[4] if len(cols) > 4 else "",
                })

        return jsonify({"ok": True, "results": filtered})

    except Exception as e:
        # ✅ Si debug demandé, renvoie l’erreur complète (sinon reste silencieux)
        if debug:
            return jsonify({
                "ok": False,
                "results": [],
                "error": str(e),
                "trace": traceback.format_exc()
            }), 500

        print("[search] warn:", e)
        return jsonify({"ok": True, "results": []})


        # ... le reste de ton code parsing ici ...

        except Exception as e:
        # debug si demandé
        if data.get("debug"):
            return jsonify({
                "ok": False,
                "results": [],
                "error": str(e),
                "trace": traceback.format_exc()
            }), 500

        return jsonify({"ok": False, "results": [], "error": "server_error"}), 500


        # >>>> Adapte ici si besoin selon la structure exacte <<<<
        # Exemple générique : table principale
        table = soup.select_one(".result-table table, table.result-table, table")
        rows = []
        if table:
            for tr in table.select("tr")[1:]:  # skip header
                cols = [c.get_text(strip=True) for c in tr.select("th,td")]
                if not cols:
                    continue
                rows.append(cols)

        # Filtre sur la requête (nom ou numéro)
        q_low = q.lower()
        filtered = []
        for cols in rows:
            line_low = " ".join(cols).lower()
            if q_low in line_low:
                # essaie de normaliser quelques champs
                result = {
                    "raw": cols,
                    "pos": cols[0] if len(cols) > 0 else "",
                    "num": cols[1] if len(cols) > 1 else "",
                    "name": cols[2] if len(cols) > 2 else "",
                    "time": cols[3] if len(cols) > 3 else "",
                    "gap": cols[4] if len(cols) > 4 else "",
                }
                filtered.append(result)

        return jsonify({"ok": True, "results": filtered})

    except Exception as e:
        print("[search] warn:", e)
        return jsonify({"ok": True, "results": []})

@app.route('/sw.js')
def service_worker():
    return app.send_static_file('sw.js')

# =========================================
# Lancement
# =========================================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
