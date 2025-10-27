import os
# ...
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
os.makedirs(DATA_DIR, exist_ok=True)

VOTES_FILE = os.path.join(DATA_DIR, "votes.json")
COUNTER_FILE = os.path.join(DATA_DIR, "counter.json")
COMMENTS_FILE = os.path.join(DATA_DIR, "comments.txt")
WEBHOOK_URL = os.environ.get("FEEDBACK_WEBHOOK_URL")
WEBHOOK_TOKEN = os.environ.get("FEEDBACK_TOKEN")

# En prod, on pointera sur le live :
RESULTS_URL = os.environ.get("RESULTS_URL", "https://www.courses-sur-sable.fr/live/")

import os, json, tempfile, time
from threading import Lock
from flask import Flask, render_template, request, jsonify
import requests
from bs4 import BeautifulSoup

app = Flask(__name__, template_folder="templates", static_folder="static")

# ====== CONFIGURATION ======
RESULTS_URL = os.path.abspath("test_live.html")
print("RESULTS_URL =", RESULTS_URL)
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
VOTES_FILE = os.path.join(DATA_DIR, "votes.json")
COUNTER_FILE = os.path.join(DATA_DIR, "counter.json")
COMMENTS_FILE = os.path.join(DATA_DIR, "comments.txt")

# ====== VERROUS ======
votes_lock = Lock()
counter_lock = Lock()
comments_lock = Lock()

# ====== FONCTIONS UTILES ======
def ensure_data_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(VOTES_FILE):
        with open(VOTES_FILE, "w", encoding="utf-8") as f:
            json.dump({"likes": 0, "dislikes": 0}, f)
    if not os.path.exists(COUNTER_FILE):
        with open(COUNTER_FILE, "w", encoding="utf-8") as f:
            json.dump({"visits": 0}, f)
    if not os.path.exists(COMMENTS_FILE):
        with open(COMMENTS_FILE, "w", encoding="utf-8") as f:
            f.write("")

def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def write_json_atomic(path, data):
    fd, tmp_path = tempfile.mkstemp(dir=DATA_DIR, prefix=".tmp_", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            json.dump(data, tmp, ensure_ascii=False)
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def sanitize_text(s: str, max_len: int = 600):
    s = (s or "").strip().replace("\r", " ").replace("\n", " ")
    return s[:max_len]

def send_feedback(payload: dict):
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

# ====== INITIALISATION ======
ensure_data_files()

# ====== ROUTES PRINCIPALES ======
@app.route("/")
def index():
    # compteur de visites
    with counter_lock:
        counter = read_json(COUNTER_FILE)
        counter["visits"] = int(counter.get("visits", 0)) + 1
        write_json_atomic(COUNTER_FILE, counter)

    # votes
    with votes_lock:
        votes = read_json(VOTES_FILE)
send_feedback({"type": "vote", "action": vtype})
return jsonify({"ok": True, "likes": votes["likes"], "dislikes": votes["dislikes"]})

# commentaires
    comments = []
    try:
        with open(COMMENTS_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    parts = line.split("|", 2)
                    if len(parts) == 3:
                        ts, name, msg = parts
                        comments.append({"timestamp": ts, "name": name, "message": msg})
    except FileNotFoundError:
        pass
    comments = comments[-20:]

    return render_template(
        "index.html",
        likes=votes.get("likes", 0),
        dislikes=votes.get("dislikes", 0),
        visits=counter.get("visits", 0),
        comments=comments
    )

# ====== API POUR LES STATS ======
@app.route("/api/stats", methods=["GET"])
def api_stats():
    with votes_lock:
        votes = read_json(VOTES_FILE)
    with counter_lock:
        counter = read_json(COUNTER_FILE)
    comments = []
    try:
        with open(COMMENTS_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    parts = line.split("|", 2)
                    if len(parts) == 3:
                        ts, name, msg = parts
                        comments.append({"timestamp": ts, "name": name, "message": msg})
    except FileNotFoundError:
        pass
    comments = comments[-20:]

    return jsonify({
        "likes": votes.get("likes", 0),
        "dislikes": votes.get("dislikes", 0),
        "visits": counter.get("visits", 0),
        "comments": comments
    })

# ====== API POUR LES VOTES ======
@app.route("/api/vote", methods=["POST"])
def api_vote():
    data = request.get_json(silent=True) or {}
    vtype = data.get("type")
    if vtype not in ("like", "dislike"):
        return jsonify({"ok": False, "error": "type must be 'like' or 'dislike'"}), 400

    with votes_lock:
        votes = read_json(VOTES_FILE)
        votes[vtype + "s"] = int(votes.get(vtype + "s", 0)) + 1
        write_json_atomic(VOTES_FILE, votes)
        
    send_feedback({"type": "vote", "action": vtype})

    return jsonify({"ok": True, "likes": votes["likes"], "dislikes": votes["dislikes"]})

# ====== API POUR LES COMMENTAIRES ======
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

    send_feedback({"type": "comment", "name": name, "message": message})

    return jsonify({"ok": True})

# ====== API POUR LA RECHERCHE PILOTE ======
@app.route("/api/search", methods=["POST"], endpoint="api_search_v2")
def api_search():
    data = request.get_json(silent=True) or {}
    query = (data.get("q") or "").strip()
    if not query:
        return jsonify({"ok": False, "error": "query required"}), 400

    try:
        html = None
        # 1) Cas fichier local : chemin absolu existant
        if os.path.exists(RESULTS_URL):
            with open(RESULTS_URL, "r", encoding="utf-8") as f:
                html = f.read()
        # 2) Cas URL file://
        elif RESULTS_URL.startswith("file://"):
            path = RESULTS_URL[len("file://"):]
            with open(path, "r", encoding="utf-8") as f:
                html = f.read()
        # 3) Cas URL HTTP(S)
        else:
            r = requests.get(RESULTS_URL, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            html = r.text

        if not html:
            raise RuntimeError("empty html")

    except Exception as e:
        return jsonify({"ok": False, "error": f"fetch error: {e}"}), 502

    soup = BeautifulSoup(html, "html.parser")
    container = soup.find("div", class_="result-table") or soup

    matches = []
    rows = container.select("tbody tr")
    for tr in rows:
        cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
        if not cells:
            continue
        txt = " ".join(cells)
        if query.lower() in txt.lower():
            matches.append(txt)

    # dédoublonnage et limite
    seen, cleaned = set(), []
    for m in matches:
        if m not in seen:
            seen.add(m)
            cleaned.append(m)
    cleaned = cleaned[:20]

    return jsonify({"ok": True, "results": cleaned})

# ====== LANCEMENT LOCAL ======
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
