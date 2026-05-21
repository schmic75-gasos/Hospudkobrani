"""
Hospůdkobraní – Python Flask API server v1.4.5
Nasazení: hospudkobrani-8888.rostiapp.cz
DB: store6.rosti.cz / zdvacsez_3396

NOVINKY v 1.4.5:
- Follow / unfollow systém (uživatelé sledují uživatele)
- API /community/following – feed sledovaných (nedávné odkliknutí a výzvy)
- Chat: reakce (emoji), mazání vlastních zpráv, reply, read-receipts timestamp
- Push notifikace: nový like, nový follower, nová zpráva v chatu (Expo push)
- Nastavení soukromí profilovky (avatar_public_only_followers)
- Cachování transport/parking dat (viz plánovač)
- Pubs thumbnails: nejvíce lajkovaná fotka (ne náhodná)
"""

import os
import re
import uuid
import hashlib
import secrets
import datetime
from functools import wraps

import pymysql
import pymysql.cursors
from flask import Flask, request, jsonify, g, send_from_directory
from flask_cors import CORS
try:
    from flask_socketio import SocketIO
except Exception:
    SocketIO = None
import jwt
from werkzeug.utils import secure_filename
from apscheduler.schedulers.background import BackgroundScheduler
import requests
from geopy.distance import distance as geopy_distance

# ─── CONFIG ────────────────────────────────────────────────────────────────────
app = Flask(__name__)
application = app  # Gunicorn entrypoint
CORS(app)

# Initialize Socket.IO if available; otherwise run without realtime support
if SocketIO is not None:
    socketio = SocketIO(app, cors_allowed_origins="*")
    socketio_available = True
else:
    socketio = None
    socketio_available = False

# map of sid -> user_id
connected_sids = {}


if socketio_available:
    @socketio.on('connect')
    def _on_connect():
        token = None
        try:
            token = request.args.get('token') or request.headers.get('Authorization')
        except Exception:
            token = None
        if token and token.startswith('Bearer '):
            token = token.split(' ', 1)[1]
        if token:
            try:
                payload = decode_token(token)
                uid = payload.get('sub')
                if uid:
                    connected_sids[request.sid] = uid
            except Exception:
                pass

    @socketio.on('authenticate')
    def _on_auth(data):
        token = data.get('token') if isinstance(data, dict) else None
        if not token:
            return
        if token.startswith('Bearer '):
            token = token.split(' ', 1)[1]
        try:
            payload = decode_token(token)
            uid = payload.get('sub')
            if uid:
                connected_sids[request.sid] = uid
                socketio.emit('authenticated', {'ok': True}, to=request.sid)
        except Exception:
            socketio.emit('authenticated', {'ok': False}, to=request.sid)

    @socketio.on('disconnect')
    def _on_disconnect():
        try:
            connected_sids.pop(request.sid, None)
        except Exception:
            pass

DB_CONFIG = {
    "host":     "store6.rosti.cz",
    "port":     3306,
    "user":     "zdvacsez_3396",
    "password": "CR_Program1",
    "database": "zdvacsez_3396",
    "charset":  "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
    "autocommit": True,
}

JWT_SECRET  = os.environ.get("JWT_SECRET", "hospudkobrani_super_tajny_klic_2024_zmen_me!")
JWT_ALGO    = "HS256"
JWT_EXPIRE  = datetime.timedelta(days=90)

UPLOAD_DIR  = os.environ.get("UPLOAD_DIR", "/srv/app/uploads")
BASE_URL    = os.environ.get("BASE_URL", "https://hospudkobrani-8888.rostiapp.cz")
os.makedirs(UPLOAD_DIR, exist_ok=True)
ALLOWED_EXT = {"jpg", "jpeg", "png", "webp"}

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# ─── DB HELPERS ────────────────────────────────────────────────────────────────
def get_db():
    if "db" not in g:
        g.db = pymysql.connect(**DB_CONFIG)
    return g.db

@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db: db.close()

def q(sql, args=(), one=False, commit=False):
    db = get_db()
    with db.cursor() as cur:
        cur.execute(sql, args)
        if commit or sql.strip().upper().startswith(("INSERT","UPDATE","DELETE","CREATE","DROP")):
            db.commit()
        if one:
            return cur.fetchone()
        return cur.fetchall()

def qone(sql, args=()):
    return q(sql, args, one=True)

def insert(sql, args=()):
    db = get_db()
    with db.cursor() as cur:
        cur.execute(sql, args)
        db.commit()
        return cur.lastrowid

# ─── AUTH HELPERS ─────────────────────────────────────────────────────────────
def hash_pw(pw: str) -> str:
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + pw).encode()).hexdigest()
    return f"{salt}:{hashed}"

def verify_pw(pw: str, stored: str) -> bool:
    try:
        salt, hashed = stored.split(":", 1)
        return hashlib.sha256((salt + pw).encode()).hexdigest() == hashed
    except:
        return False

def make_token(user_id: int) -> str:
    payload = {
        "sub": user_id,
        "iat": datetime.datetime.utcnow(),
        "exp": datetime.datetime.utcnow() + JWT_EXPIRE,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

def decode_token(token: str):
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])

def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"message": "Nejsi přihlášen"}), 401
        try:
            payload = decode_token(auth[7:])
            g.user_id = payload["sub"]
            g.user = qone("SELECT * FROM users WHERE id=%s AND active=1", (g.user_id,))
            if not g.user:
                return jsonify({"message": "Účet nenalezen"}), 401
        except jwt.ExpiredSignatureError:
            return jsonify({"message": "Přihlášení vypršelo"}), 401
        except Exception:
            return jsonify({"message": "Neplatný token"}), 401
        return f(*args, **kwargs)
    return wrapper

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT

def _user_safe(u):
    return {
        "id":         u["id"],
        "username":   u["username"],
        "email":      u["email"],
        "bio":        u["bio"],
        "avatar_url": u["avatar_url"],
        "avatar_privacy": u.get("avatar_privacy", "public"),
        "created_at": u["created_at"].isoformat() if u.get("created_at") else None,
        "is_admin":   bool(u.get("is_admin", False)),
    }

# ─── EXPO PUSH NOTIFICATION HELPER ───────────────────────────────────────────
def send_push_notification(user_id, title, body, data=None):
    """Odešle Expo push notifikaci uživateli (pokud má token)."""
    try:
        with app.app_context():
            rows = q("SELECT token FROM push_tokens WHERE user_id=%s", (user_id,))
            for row in rows:
                token = row["token"]
                payload = {
                    "to": token,
                    "title": title,
                    "body": body,
                    "sound": "default",
                }
                if data:
                    payload["data"] = data
                requests.post(EXPO_PUSH_URL, json=payload, timeout=10)
    except Exception as e:
        app.logger.warning(f"Push notification selhal pro user {user_id}: {e}")

def fetch_transport_and_parking():
    """Stáhne z Overpass API zastávky a parkoviště v okolí našich podniků."""
    with app.app_context():
        pubs = q("SELECT latitude, longitude FROM pubs WHERE active=1")
        if not pubs:
            return
        
        min_lat = min(float(p["latitude"]) for p in pubs) - 0.02
        max_lat = max(float(p["latitude"]) for p in pubs) + 0.02
        min_lon = min(float(p["longitude"]) for p in pubs) - 0.02
        max_lon = max(float(p["longitude"]) for p in pubs) + 0.02
        
        bbox = f"{min_lat},{min_lon},{max_lat},{max_lon}"
        
        stop_query = f"""
        [out:json];
        (
        node["public_transport"="platform"]({bbox});
        node["railway"="station"]({bbox});
        node["railway"="halt"]({bbox});
        node["highway"="bus_stop"]({bbox});
        node["public_transport"="stop_position"]({bbox});
        );
        out body;
        """
        
        parking_query = f"""
        [out:json];
        (
        node["amenity"="parking"]({bbox});
        way["amenity"="parking"]({bbox});
        );
        out body;
        """
        
        try:
            print("spouštím Overpass dotaz")
            resp = requests.get(OVERPASS_URL, params={"data": stop_query}, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                stops = []
                for elem in data.get("elements", []):
                    if elem["type"] == "node":
                        tags = elem.get("tags", {})
                        stop_type = "bus"
                        if "railway" in tags:
                            stop_type = "train" if tags["railway"] in ("station", "halt") else "bus"
                        elif "public_transport" in tags:
                            stop_type = tags.get("public_transport", "bus")
                        stops.append((
                            stop_type,
                            tags.get("name", "Neznámá zastávka"),
                            elem["lat"],
                            elem["lon"],
                            elem["id"]
                        ))
                q("TRUNCATE TABLE transport_stops")
                for s in stops:
                    insert("INSERT INTO transport_stops (stop_type, name, latitude, longitude, osm_id) VALUES (%s,%s,%s,%s,%s)", s)
                app.logger.info(f"Staženo {len(stops)} zastávek.")
            
            resp = requests.get(OVERPASS_URL, params={"data": parking_query}, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                parking = []
                for elem in data.get("elements", []):
                    if elem["type"] == "node":
                        lat, lon = elem["lat"], elem["lon"]
                    elif elem["type"] == "way" and "center" in elem:
                        lat, lon = elem["center"]["lat"], elem["center"]["lon"]
                    else:
                        continue
                    tags = elem.get("tags", {})
                    access = tags.get("access", "").lower()
                    if access in ("private", "no"):
                        continue
                    parking.append((
                        tags.get("name", "Parkoviště"),
                        lat, lon,
                        tags.get("capacity"),
                        tags.get("fee", "no") == "yes",
                        elem["id"]
                    ))
                q("TRUNCATE TABLE parking_spots")
                for p in parking:
                    insert("INSERT INTO parking_spots (name, latitude, longitude, capacity, fee, osm_id) VALUES (%s,%s,%s,%s,%s,%s)", p)
                app.logger.info(f"Staženo {len(parking)} parkovišť.")
        except Exception as e:
            app.logger.error(f"Chyba při stahování Overpass: {e}")

# ══════════════════════════════════════════════════════════════════════════════
# AUTH ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json()
    email    = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    username = (data.get("username") or "").strip()

    if not email or not password or not username:
        return jsonify({"message": "Vyplň všechna pole"}), 400
    if len(password) < 8:
        return jsonify({"message": "Heslo musí mít alespoň 8 znaků"}), 400
    if not re.match(r"^[^@]+@[^@]+\.[^@]+$", email):
        return jsonify({"message": "Neplatný e-mail"}), 400
    if len(username) < 3 or len(username) > 30:
        return jsonify({"message": "Nick musí mít 3–30 znaků"}), 400

    if qone("SELECT id FROM users WHERE email=%s", (email,)):
        return jsonify({"message": "E-mail je již registrován"}), 409
    if qone("SELECT id FROM users WHERE username=%s", (username,)):
        return jsonify({"message": "Tento nick je již obsazen"}), 409

    uid = insert(
        "INSERT INTO users (email, password_hash, username, created_at) VALUES (%s,%s,%s,NOW())",
        (email, hash_pw(password), username)
    )
    user = qone("SELECT * FROM users WHERE id=%s", (uid,))
    token = make_token(uid)
    return jsonify({"token": token, "user": _user_safe(user)}), 201

@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json()
    email    = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    user = qone("SELECT * FROM users WHERE email=%s AND active=1", (email,))
    if not user or not verify_pw(password, user["password_hash"]):
        return jsonify({"message": "Špatný e-mail nebo heslo"}), 401

    q("UPDATE users SET last_login=NOW() WHERE id=%s", (user["id"],))
    token = make_token(user["id"])
    return jsonify({"token": token, "user": _user_safe(user)})

@app.route("/api/auth/me")
@require_auth
def me():
    return jsonify(_user_safe(g.user))

@app.route("/api/auth/change-password", methods=["POST"])
@require_auth
def change_password():
    data = request.get_json()
    old_pw  = data.get("old_password") or ""
    new_pw  = data.get("new_password") or ""

    if not old_pw or not new_pw:
        return jsonify({"message": "Vyplň staré i nové heslo"}), 400
    if len(new_pw) < 8:
        return jsonify({"message": "Nové heslo musí mít alespoň 8 znaků"}), 400

    user = qone("SELECT * FROM users WHERE id=%s", (g.user_id,))
    if not verify_pw(old_pw, user["password_hash"]):
        return jsonify({"message": "Staré heslo není správné"}), 400

    q("UPDATE users SET password_hash=%s WHERE id=%s", (hash_pw(new_pw), g.user_id))
    return jsonify({"message": "Heslo bylo změněno"})

@app.route("/api/auth/forgot-password", methods=["POST"])
def forgot_password():
    data  = request.get_json()
    email = (data.get("email") or "").strip().lower()
    if not email:
        return jsonify({"message": "Zadej e-mail"}), 400

    user = qone("SELECT id FROM users WHERE email=%s AND active=1", (email,))
    if user:
        token = secrets.token_urlsafe(32)
        expires = datetime.datetime.utcnow() + datetime.timedelta(hours=2)
        q("DELETE FROM password_resets WHERE user_id=%s", (user["id"],))
        insert("INSERT INTO password_resets (user_id, token, expires_at, created_at) VALUES (%s,%s,%s,NOW())",
               (user["id"], token, expires))
        reset_url = f"{BASE_URL}/reset-password?token={token}"
        app.logger.info(f"Password reset for {email}: {reset_url}")
    return jsonify({"message": "Pokud e-mail existuje, byl odeslán odkaz pro reset hesla."})

@app.route("/api/auth/reset-password", methods=["POST"])
def reset_password():
    data     = request.get_json()
    token    = data.get("token") or ""
    new_pw   = data.get("new_password") or ""

    if not token or not new_pw:
        return jsonify({"message": "Chybí token nebo heslo"}), 400
    if len(new_pw) < 8:
        return jsonify({"message": "Heslo musí mít alespoň 8 znaků"}), 400

    row = qone("SELECT * FROM password_resets WHERE token=%s", (token,))
    if not row:
        return jsonify({"message": "Neplatný nebo expirovaný token"}), 400
    if row["expires_at"] < datetime.datetime.utcnow():
        q("DELETE FROM password_resets WHERE token=%s", (token,))
        return jsonify({"message": "Token expiroval, požádej o nový reset"}), 400

    q("UPDATE users SET password_hash=%s WHERE id=%s", (hash_pw(new_pw), row["user_id"]))
    q("DELETE FROM password_resets WHERE user_id=%s", (row["user_id"],))
    return jsonify({"message": "Heslo bylo úspěšně resetováno"})

@app.route("/api/auth/delete-account", methods=["DELETE"])
@require_auth
def delete_account():
    data = request.get_json() or {}
    pw   = data.get("password") or ""

    user = qone("SELECT * FROM users WHERE id=%s", (g.user_id,))
    if not verify_pw(pw, user["password_hash"]):
        return jsonify({"message": "Špatné heslo – účet nebyl smazán"}), 400

    anon_email = f"deleted_{g.user_id}_{secrets.token_hex(6)}@deleted.invalid"
    q("UPDATE users SET active=0, email=%s, username=%s, bio=NULL, avatar_url=NULL, password_hash='deleted' WHERE id=%s",
      (anon_email, f"Smazaný účet #{g.user_id}", g.user_id))
    return jsonify({"message": "Účet byl smazán"})

# ══════════════════════════════════════════════════════════════════════════════
# PUBS
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/pubs")
@require_auth
def get_pubs():
    country = request.args.get("country")
    where = "WHERE p.active = 1"
    args = []
    if country:
        where += " AND p.country = %s"
        args.append(country.upper())
    pubs = q(f"""
        SELECT p.*,
               ROUND(AVG(v.rating),1) as avg_rating,
               COUNT(v.id)            as visit_count
        FROM pubs p
        LEFT JOIN visits v ON v.pub_id = p.id
        {where}
        GROUP BY p.id
        ORDER BY p.name
    """, tuple(args))
    return jsonify([_pub_safe(p) for p in pubs])

@app.route("/api/pubs/version")
@require_auth
def pubs_version():
    row = qone("SELECT GREATEST(MAX(updated_at), MAX(created_at)) as ts FROM pubs WHERE active=1")
    ts = row["ts"].isoformat() if row["ts"] else datetime.datetime.utcnow().isoformat()
    return jsonify({"version": ts})

@app.route("/api/pubs/updates")
@require_auth
def pubs_updates():
    since = request.args.get("since")
    if not since:
        return jsonify({"message": "Chybí parametr since"}), 400
    try:
        since_dt = datetime.datetime.fromisoformat(since.replace('Z', '+00:00'))
    except:
        return jsonify({"message": "Neplatný formát since"}), 400
    rows = q("""
        SELECT * FROM pubs
        WHERE active = 1 AND (updated_at > %s OR created_at > %s)
    """, (since_dt, since_dt))
    return jsonify([_pub_safe(p) for p in rows])

@app.route("/api/pubs/<int:pub_id>/share")
@require_auth
def share_pub(pub_id):
    pub = qone("SELECT id, name FROM pubs WHERE id=%s AND active=1", (pub_id,))
    if not pub:
        return jsonify({"message": "Hospůdka nenalezena"}), 404
    web_url = f"{BASE_URL}/pub/{pub_id}"
    # Deep link for mobile apps (app should handle hospudkobrani://pub/:id)
    app_link = f"hospudkobrani://pub/{pub_id}"
    return jsonify({"web_url": web_url, "app_link": app_link, "name": pub["name"]})

# ── Thumbnail: nejvíce lajkovaná fotka (nebo náhodná pokud nulové lajky) ──────
@app.route("/api/pubs/<int:pub_id>/thumbnail")
@require_auth
def pub_thumbnail(pub_id):
    row = qone("""
        SELECT pp.url, COUNT(pl.id) as like_count
        FROM pub_photos pp
        LEFT JOIN photo_likes pl ON pl.photo_id = pp.id
        WHERE pp.pub_id=%s AND pp.visibility='public'
        GROUP BY pp.id
        ORDER BY like_count DESC, pp.created_at DESC
        LIMIT 1
    """, (pub_id,))
    return jsonify({"url": row["url"] if row else None})

# ── Batch thumbnails – nejvíce lajkovaná fotka pro každý podnik ───────────────
@app.route("/api/pubs/thumbnails", methods=["POST"])
@require_auth
def pubs_thumbnails():
    data    = request.get_json() or {}
    pub_ids = data.get("ids", [])
    if not pub_ids:
        return jsonify({})
    placeholders = ','.join(['%s'] * len(pub_ids))
    # Subquery: pro každou hospůdku vezmi fotku s nejvyšším počtem lajků
    rows = q(f"""
        SELECT pp.pub_id, pp.url
        FROM pub_photos pp
        LEFT JOIN photo_likes pl ON pl.photo_id = pp.id
        WHERE pp.pub_id IN ({placeholders}) AND pp.visibility='public'
        GROUP BY pp.pub_id, pp.id
        ORDER BY pp.pub_id, COUNT(pl.id) DESC, pp.created_at DESC
    """, tuple(pub_ids))
    # Pro každé pub_id vezmi první (nejlajkovanější) záznam
    result = {}
    for r in rows:
        pid = r["pub_id"]
        if pid not in result:
            result[pid] = r["url"]
    return jsonify(result)

@app.route("/api/pubs/<int:pub_id>/firstlasts")
@require_auth
def pub_firstlasts(pub_id):
    rows = q("""
        SELECT vf.year, u.username, u.avatar_url, vf.created_at
        FROM visit_firstlast vf
        JOIN users u ON u.id = vf.user_id
        WHERE vf.pub_id = %s AND u.active = 1
        ORDER BY vf.year DESC
    """, (pub_id,))
    this_year = datetime.datetime.utcnow().year
    return jsonify([{
        "year":       r["year"],
        "username":   r["username"],
        "avatar_url": r["avatar_url"],
        "is_this_year": r["year"] == this_year,
        "date":       r["created_at"].strftime("%d.%m.%Y") if r.get("created_at") else None,
    } for r in rows])

@app.route("/api/pubs/suggest", methods=["POST"])
@require_auth
def suggest_pub():
    d = request.get_json()
    name = (d.get("name") or "").strip()[:200]
    if not name:
        return jsonify({"message": "Chybí název hospůdky"}), 400
    lat = d.get("latitude")
    lng = d.get("longitude")
    if lat is None or lng is None:
        return jsonify({"message": "Chybí souřadnice"}), 400
    try:
        lat, lng = float(lat), float(lng)
    except (ValueError, TypeError):
        return jsonify({"message": "Neplatné souřadnice"}), 400

    sid = insert(
        "INSERT INTO pub_suggestions (user_id, name, type, address, note, latitude, longitude, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,NOW())",
        (g.user_id, name, d.get("type","hospoda"),
         (d.get("address") or "")[:300],
         (d.get("note") or "")[:500],
         lat, lng)
    )
    return jsonify({"id": sid, "message": "Návrh odeslán"}), 201

@app.route("/api/transport/nearby")
def get_nearby_transport():
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    radius = request.args.get("radius", 1000, type=int)
    if not lat or not lng:
        return jsonify({"message": "Chybí souřadnice"}), 400
    
    stops = q("""
        SELECT stop_type, name, latitude, longitude,
               (6371000 * acos(cos(radians(%s)) * cos(radians(latitude)) * cos(radians(longitude) - radians(%s)) + sin(radians(%s)) * sin(radians(latitude)))) AS distance
        FROM transport_stops
        HAVING distance < %s
        ORDER BY distance
    """, (lat, lng, lat, radius))
    
    parking = q("""
        SELECT name, latitude, longitude, capacity, fee,
               (6371000 * acos(cos(radians(%s)) * cos(radians(latitude)) * cos(radians(longitude) - radians(%s)) + sin(radians(%s)) * sin(radians(latitude)))) AS distance
        FROM parking_spots
        HAVING distance < %s
        ORDER BY distance
    """, (lat, lng, lat, radius))
    
    return jsonify({
        "stops": stops,
        "parking": parking
    })

@app.route("/api/pubs/<int:pub_id>/report", methods=["POST"])
@require_auth
def report_pub(pub_id):
    if not qone("SELECT id FROM pubs WHERE id=%s AND active=1", (pub_id,)):
        return jsonify({"message": "Hospůdka nenalezena"}), 404
    d = request.get_json()
    reason = (d.get("reason") or "").strip()[:200]
    if not reason:
        return jsonify({"message": "Chybí důvod nahlášení"}), 400
    detail = (d.get("detail") or "")[:1000]
    insert(
        "INSERT INTO pub_reports (pub_id, user_id, reason, detail, created_at) VALUES (%s,%s,%s,%s,NOW())",
        (pub_id, g.user_id, reason, detail)
    )
    return jsonify({"message": "Nahlášení odesláno"}), 201

@app.route("/api/community/gallery/<int:photo_id>/like", methods=["POST"])
@require_auth
def toggle_like(photo_id):
    photo = qone("SELECT id, user_id FROM pub_photos WHERE id=%s", (photo_id,))
    if not photo:
        return jsonify({"message": "Foto nenalezeno"}), 404
    existing = qone("SELECT id FROM photo_likes WHERE photo_id=%s AND user_id=%s", (photo_id, g.user_id))
    if existing:
        q("DELETE FROM photo_likes WHERE photo_id=%s AND user_id=%s", (photo_id, g.user_id))
        liked = False
    else:
        insert("INSERT INTO photo_likes (photo_id, user_id, created_at) VALUES (%s,%s,NOW())", (photo_id, g.user_id))
        liked = True
        # Push notifikace majiteli fotky
        if photo["user_id"] != g.user_id:
            liker = qone("SELECT username FROM users WHERE id=%s", (g.user_id,))
            if liker:
                send_push_notification(
                    photo["user_id"],
                    "Nový like! ❤️",
                    f"{liker['username']} dal like na tvoji fotku.",
                    {"type": "like", "photo_id": photo_id}
                )
    count = qone("SELECT COUNT(*) as n FROM photo_likes WHERE photo_id=%s", (photo_id,))["n"]
    return jsonify({"liked": liked, "like_count": count})

@app.route("/api/pubs/<int:pub_id>")
@require_auth
def get_pub(pub_id):
    pub = qone("""
        SELECT p.*,
               ROUND(AVG(v.rating),1) as avg_rating,
               COUNT(v.id)            as visit_count
        FROM pubs p
        LEFT JOIN visits v ON v.pub_id = p.id
        WHERE p.id=%s AND p.active=1
        GROUP BY p.id
    """, (pub_id,))
    if not pub:
        return jsonify({"message": "Hospůdka nenalezena"}), 404
    result = _pub_safe(pub)
    this_year = datetime.datetime.utcnow().year
    fl_this_year = qone("""
        SELECT u.username FROM visit_firstlast vf
        JOIN users u ON u.id = vf.user_id
        WHERE vf.pub_id=%s AND vf.year=%s
    """, (pub_id, this_year))
    result["firstlast_this_year"] = fl_this_year["username"] if fl_this_year else None
    result["total_firstlasts"] = qone("SELECT COUNT(*) as n FROM visit_firstlast WHERE pub_id=%s", (pub_id,))["n"]
    return jsonify(result)

@app.route("/api/pubs/<int:pub_id>/question")
@require_auth
def get_pub_question(pub_id):
    q_row = qone("SELECT * FROM pub_questions WHERE pub_id=%s AND active=1 ORDER BY RAND() LIMIT 1", (pub_id,))
    if not q_row:
        return jsonify(None)
    answers = q("SELECT id, answer_text FROM question_answers WHERE question_id=%s ORDER BY RAND()", (q_row["id"],))
    return jsonify({
        "id":            q_row["id"],
        "question_text": q_row["question_text"],
        "answers":       list(answers),
    })

def _pub_safe(p):
    return {
        "id":           p["id"],
        "name":         p["name"],
        "type":         p["type"],
        "latitude":     float(p["latitude"]),
        "longitude":    float(p["longitude"]),
        "address":      p["address"],
        "opening_hours":p["opening_hours"],
        "beers":        p["beers"],
        "card_payment": bool(p["card_payment"]),
        "note":         p["note"],
        "phone":        p.get("phone"),
        "avg_rating":   float(p["avg_rating"]) if p.get("avg_rating") else 0,
        "visit_count":  p.get("visit_count", 0),
    }

# ══════════════════════════════════════════════════════════════════════════════
# VISITS
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/visits/my")
@require_auth
def my_visits():
    date = request.args.get("date")

    _photo_sq = """(SELECT pp.url FROM pub_photos pp
         LEFT JOIN photo_likes pl ON pl.photo_id = pp.id
         WHERE pp.pub_id = v.pub_id AND pp.visibility='public'
         GROUP BY pp.id ORDER BY COUNT(pl.id) DESC, pp.created_at DESC LIMIT 1)"""

    if date:
        visits = q(f"""
            SELECT v.*, p.name as pub_name, p.type as pub_type,
                   {_photo_sq} as pub_photo_url
            FROM visits v
            JOIN pubs p ON p.id = v.pub_id
            WHERE v.user_id=%s AND DATE(v.logged_at)=%s
            ORDER BY v.logged_at DESC
        """, (g.user_id, date))
        return jsonify([_visit_detail(v) for v in visits])

    visits = q(f"""
        SELECT v.*, p.name as pub_name, p.type as pub_type,
               {_photo_sq} as pub_photo_url
        FROM visits v
        JOIN pubs p ON p.id = v.pub_id
        WHERE v.user_id=%s
        ORDER BY v.logged_at DESC
    """, (g.user_id,))
    return jsonify([_visit_detail(v) for v in visits])

@app.route("/api/visits", methods=["POST"])
@require_auth
def log_visit():
    data = request.get_json()
    pub_id        = data.get("pub_id")
    answer_id     = data.get("answer_id")
    rating        = int(data.get("rating", 0))
    note          = (data.get("note") or "")[:1000]
    note_vis      = data.get("note_visibility", "public")
    travel_mode   = (data.get("travel_mode") or "")[:50]
    if note_vis not in ("public", "private"):
        note_vis = "public"
    logged_at_raw = data.get("logged_at") or datetime.datetime.utcnow().isoformat()
    try:
        logged_at = datetime.datetime.fromisoformat(logged_at_raw.replace('Z', '+00:00')).strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        logged_at = datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

    if not pub_id:
        return jsonify({"message": "Chybí pub_id"}), 400
    if not 1 <= rating <= 5:
        return jsonify({"message": "Hodnocení musí být 1–5"}), 400

    pub = qone("SELECT id FROM pubs WHERE id=%s AND active=1", (pub_id,))
    if not pub:
        return jsonify({"message": "Hospůdka nenalezena"}), 404

    if answer_id:
        ans = qone("SELECT q.pub_id, a.is_correct FROM question_answers a "
                   "JOIN pub_questions q ON q.id=a.question_id "
                   "WHERE a.id=%s AND q.pub_id=%s", (answer_id, pub_id))
        if not ans:
            return jsonify({"message": "Neplatná odpověď"}), 400
        if not ans["is_correct"]:
            return jsonify({"message": "Špatná odpověď! Zkus to znovu. 🍺"}), 400

    vid = insert(
        "INSERT INTO visits (user_id, pub_id, rating, note, note_visibility, logged_at, answer_id, travel_mode, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NOW())",
        (g.user_id, pub_id, rating, note, note_vis, logged_at, answer_id, travel_mode or None)
    )
    is_fl = _check_firstlast(g.user_id, pub_id, logged_at)
    newly_unlocked = _check_newly_unlocked_challenges(g.user_id)
    
    # Notifikace sledujícím o novém odkliknutí
    _notify_followers_about_visit(g.user_id, pub_id, vid)
    
    return jsonify({
        "id": vid,
        "is_firstlast": is_fl,
        "new_challenges": newly_unlocked,
        "message": "Hospůdka odkliknuta! 🍺"
    }), 201

def _notify_followers_about_visit(user_id, pub_id, visit_id):
    """Notifikuje followers o novém odkliknutí (asynchronně)."""
    try:
        user = qone("SELECT username FROM users WHERE id=%s", (user_id,))
        pub = qone("SELECT name FROM pubs WHERE id=%s", (pub_id,))
        if not user or not pub:
            return
        followers = q("""
            SELECT follower_id FROM user_follows WHERE followed_id=%s
        """, (user_id,))
        for f in followers:
            send_push_notification(
                f["follower_id"],
                f"{user['username']} odkliknul hospůdku 🍺",
                f"Byl(a) v: {pub['name']}",
                {"type": "visit", "user_id": user_id, "pub_id": pub_id}
            )
    except Exception as e:
        app.logger.warning(f"Follower notifikace selhala: {e}")

@app.route("/api/visits/photo", methods=["POST"])
@require_auth
def upload_photo():
    pub_id     = request.form.get("pub_id")
    visibility = request.form.get("photo_visibility", "public")
    if visibility not in ("public", "private"):
        visibility = "public"
    file = request.files.get("photo")
    if not file or not allowed_file(file.filename):
        return jsonify({"message": "Neplatný soubor"}), 400

    ext      = secure_filename(file.filename).rsplit(".", 1)[1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"
    folder   = os.path.join(UPLOAD_DIR, "pub_photos")
    os.makedirs(folder, exist_ok=True)
    file.save(os.path.join(folder, filename))

    url = f"{BASE_URL}/uploads/pub_photos/{filename}"
    insert("INSERT INTO pub_photos (pub_id, user_id, url, visibility, created_at) VALUES (%s,%s,%s,%s,NOW())",
           (pub_id, g.user_id, url, visibility))
    return jsonify({"url": url})

def _visit_detail(v):
    return {
        "id":            v["id"],
        "pub_id":        v["pub_id"],
        "pub_name":      v["pub_name"],
        "pub_type":      v["pub_type"],
        "rating":        v["rating"],
        "note":          v["note"],
        "travel_mode":   v.get("travel_mode"),
        "logged_at":     v["logged_at"].isoformat() if v.get("logged_at") else None,
        "pub_photo_url": v.get("pub_photo_url"),
    }

# ══════════════════════════════════════════════════════════════════════════════
# CHALLENGES
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/challenges/my")
@require_auth
def my_challenges():
    challenges = q("SELECT * FROM challenges WHERE active=1 ORDER BY sort_order")
    result = []
    for c in challenges:
        progress = _calc_challenge_progress(g.user_id, c)
        result.append({
            "id":          c["id"],
            "name":        c["name"],
            "description": c["description"],
            "icon":        c["icon"],
            "target":      c["target"],
            "progress":    progress,
            "reward":      c["reward"],
        })
    return jsonify(result)

def _calc_challenge_progress(user_id, challenge):
    ctype = challenge["challenge_type"]
    try:
        if ctype == "total_visits":
            r = qone("SELECT COUNT(DISTINCT pub_id) as n FROM visits WHERE user_id=%s", (user_id,))
            return r["n"]
        elif ctype == "visit_count_any":
            r = qone("SELECT COUNT(*) as n FROM visits WHERE user_id=%s", (user_id,))
            return r["n"]
        elif ctype == "pub_type":
            r = qone("SELECT COUNT(DISTINCT v.pub_id) as n FROM visits v "
                     "JOIN pubs p ON p.id=v.pub_id WHERE v.user_id=%s AND p.type=%s",
                     (user_id, challenge["filter_value"]))
            return r["n"]
        elif ctype == "beer_brand":
            r = qone("SELECT COUNT(DISTINCT v.pub_id) as n FROM visits v "
                     "JOIN pubs p ON p.id=v.pub_id WHERE v.user_id=%s AND p.beers LIKE %s",
                     (user_id, f"%{challenge['filter_value']}%"))
            return r["n"]
        elif ctype == "rating_5":
            r = qone("SELECT COUNT(*) as n FROM visits WHERE user_id=%s AND rating=5", (user_id,))
            return r["n"]
        elif ctype == "region":
            r = qone("SELECT COUNT(DISTINCT v.pub_id) as n FROM visits v "
                     "JOIN pubs p ON p.id=v.pub_id WHERE v.user_id=%s AND p.address LIKE %s",
                     (user_id, f"%{challenge['filter_value']}%"))
            return r["n"]
        elif ctype == "firstlast":
            r = qone("SELECT COUNT(*) as n FROM visit_firstlast WHERE user_id=%s", (user_id,))
            return r["n"]
        elif ctype == "travel_mode":
            r = qone("SELECT COUNT(DISTINCT pub_id) as n FROM visits WHERE user_id=%s AND travel_mode=%s",
                     (user_id, challenge["filter_value"]))
            return r["n"]
    except:
        pass
    return 0

def _update_challenges(user_id):
    pass

# ══════════════════════════════════════════════════════════════════════════════
# PROFILE
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/profile/bio", methods=["PUT"])
@require_auth
def update_bio():
    data = request.get_json()
    bio = (data.get("bio") or "")[:500]
    q("UPDATE users SET bio=%s WHERE id=%s", (bio, g.user_id))
    return jsonify({"bio": bio})

@app.route("/api/profile/avatar", methods=["POST"])
@require_auth
def upload_avatar():
    file = request.files.get("avatar")
    if not file or not allowed_file(file.filename):
        return jsonify({"message": "Neplatný soubor"}), 400

    ext      = file.filename.rsplit(".", 1)[1].lower()
    filename = f"avatar_{g.user_id}_{uuid.uuid4().hex[:8]}.{ext}"
    folder   = os.path.join(UPLOAD_DIR, "avatars")
    os.makedirs(folder, exist_ok=True)
    file.save(os.path.join(folder, filename))

    url = f"{BASE_URL}/uploads/avatars/{filename}"
    q("UPDATE users SET avatar_url=%s WHERE id=%s", (url, g.user_id))
    return jsonify({"avatar_url": url})

@app.route("/api/profile/avatar", methods=["DELETE"])
@require_auth
def delete_avatar():
    q("UPDATE users SET avatar_url=NULL WHERE id=%s", (g.user_id,))
    return jsonify({"message": "Profilovka smazána"})

# ── Nastavení soukromí profilovky ─────────────────────────────────────────────
@app.route("/api/profile/settings")
@require_auth
def get_profile_settings():
    u = qone("SELECT avatar_privacy, map_remember_position, show_join_date, show_visits_on_profile FROM users WHERE id=%s", (g.user_id,))
    return jsonify({
        "avatar_privacy":          u.get("avatar_privacy", "public"),
        "map_remember_position":   bool(u.get("map_remember_position")),
        "show_join_date":          bool(u.get("show_join_date", 1)),
        "show_visits_on_profile":  bool(u.get("show_visits_on_profile", 1)),
    })

@app.route("/api/profile/settings", methods=["PUT"])
@require_auth
def update_profile_settings():
    data = request.get_json()
    u = qone("SELECT avatar_privacy, map_remember_position, show_join_date, show_visits_on_profile FROM users WHERE id=%s", (g.user_id,))
    avatar_privacy = data.get("avatar_privacy", u.get("avatar_privacy", "public"))
    if avatar_privacy not in ("public", "followers_only"):
        avatar_privacy = "public"
    map_rem  = int(bool(data.get("map_remember_position",  bool(u.get("map_remember_position")))))
    show_jd  = int(bool(data.get("show_join_date",         bool(u.get("show_join_date", 1)))))
    show_vis = int(bool(data.get("show_visits_on_profile", bool(u.get("show_visits_on_profile", 1)))))
    q("UPDATE users SET avatar_privacy=%s, map_remember_position=%s, show_join_date=%s, show_visits_on_profile=%s WHERE id=%s",
      (avatar_privacy, map_rem, show_jd, show_vis, g.user_id))
    return jsonify({
        "avatar_privacy":         avatar_privacy,
        "map_remember_position":  bool(map_rem),
        "show_join_date":         bool(show_jd),
        "show_visits_on_profile": bool(show_vis),
    })

@app.route("/api/profile/stats")
@require_auth
def profile_stats():
    uid    = g.user_id
    period = request.args.get("period", "total")

    pc = ""
    if period == "year":   pc = "AND YEAR(logged_at)=YEAR(NOW())"
    elif period == "month":pc = "AND YEAR(logged_at)=YEAR(NOW()) AND MONTH(logged_at)=MONTH(NOW())"
    elif period == "day":  pc = "AND DATE(logged_at)=CURDATE()"

    total  = qone(f"SELECT COUNT(DISTINCT pub_id) as n FROM visits WHERE user_id=%s {pc}", (uid,))["n"]
    avg    = qone(f"SELECT ROUND(AVG(rating),1) as r FROM visits WHERE user_id=%s {pc}", (uid,))["r"]
    this_m = qone("SELECT COUNT(*) as n FROM visits WHERE user_id=%s AND MONTH(logged_at)=MONTH(NOW()) AND YEAR(logged_at)=YEAR(NOW())", (uid,))["n"]
    chs    = q("SELECT * FROM challenges WHERE active=1")
    done   = sum(1 for c in chs if _calc_challenge_progress(uid, c) >= c["target"])
    fl_cnt = qone("SELECT COUNT(*) as n FROM visit_firstlast WHERE user_id=%s", (uid,))["n"]
    fl_year= qone("SELECT COUNT(*) as n FROM visit_firstlast WHERE user_id=%s AND year=YEAR(NOW())", (uid,))["n"]

    travel_stats = q("""
        SELECT travel_mode, COUNT(*) as cnt FROM visits
        WHERE user_id=%s AND travel_mode IS NOT NULL AND travel_mode != ''
        GROUP BY travel_mode ORDER BY cnt DESC
    """, (uid,))

    best_day = qone("""
        SELECT DAYOFWEEK(logged_at) as dow, COUNT(*) as cnt
        FROM visits WHERE user_id=%s
        GROUP BY dow ORDER BY cnt DESC LIMIT 1
    """, (uid,))

    # Follower / following počty
    followers_count = qone("SELECT COUNT(*) as n FROM user_follows WHERE followed_id=%s", (uid,))["n"]
    following_count = qone("SELECT COUNT(*) as n FROM user_follows WHERE follower_id=%s", (uid,))["n"]

    return jsonify({
        "total_visits":      total,
        "avg_rating":        float(avg) if avg else None,
        "visits_this_month": this_m,
        "challenges_done":   done,
        "firstlast_count":   fl_cnt,
        "firstlast_this_year": fl_year,
        "travel_modes":      [{"mode": t["travel_mode"], "count": t["cnt"]} for t in travel_stats],
        "best_day_of_week":  best_day["dow"] if best_day else None,
        "followers_count":   followers_count,
        "following_count":   following_count,
    })

@app.route("/api/profile/activity")
@require_auth
def profile_activity():
    uid   = g.user_id
    year  = int(request.args.get("year",  datetime.datetime.utcnow().year))
    month = int(request.args.get("month", datetime.datetime.utcnow().month))

    rows = q("""
        SELECT DATE(logged_at) as day, COUNT(*) as cnt
        FROM visits
        WHERE user_id=%s AND YEAR(logged_at)=%s AND MONTH(logged_at)=%s
        GROUP BY DATE(logged_at)
    """, (uid, year, month))

    return jsonify({
        "year": year,
        "month": month,
        "days": {str(r["day"]): r["cnt"] for r in rows}
    })

@app.route("/api/profile/my-photos")
@require_auth
def my_photos():
    rows = q("""
        SELECT pp.id, pp.url, pp.visibility, p.name as pub_name,
               COUNT(pl.id) as like_count
        FROM pub_photos pp
        JOIN pubs p ON p.id = pp.pub_id
        LEFT JOIN photo_likes pl ON pl.photo_id = pp.id
        WHERE pp.user_id=%s
        GROUP BY pp.id
        ORDER BY pp.created_at DESC
        LIMIT 100
    """, (g.user_id,))
    return jsonify([{
        "id":          r["id"],
        "url":         r["url"],
        "visibility":  r["visibility"],
        "pub_name":    r["pub_name"],
        "like_count":  r["like_count"],
    } for r in rows])

@app.route("/api/profile/rank")
@require_auth
def profile_rank():
    uid = g.user_id
    my_cnt = qone("SELECT COUNT(DISTINCT pub_id) as n FROM visits WHERE user_id=%s", (uid,))["n"]
    pos = qone("""
        SELECT COUNT(*)+1 as pos FROM (
            SELECT user_id, COUNT(DISTINCT pub_id) as cnt FROM visits GROUP BY user_id
        ) t WHERE t.cnt > %s
    """, (my_cnt,))["pos"]
    total = qone("SELECT COUNT(*) as n FROM users WHERE active=1")["n"]
    return jsonify({"position": pos, "total_users": total, "my_count": my_cnt})

@app.route("/api/profile/records")
@require_auth
def profile_records():
    uid = g.user_id

    # Max visit streak (consecutive days)
    dates = q("SELECT DISTINCT DATE(logged_at) as d FROM visits WHERE user_id=%s ORDER BY d", (uid,))
    max_streak = 0
    if dates:
        streak = 1
        for i in range(1, len(dates)):
            diff = (dates[i]["d"] - dates[i-1]["d"]).days
            if diff == 1:
                streak += 1
            else:
                max_streak = max(max_streak, streak)
                streak = 1
        max_streak = max(max_streak, streak)

    # Longest note
    ln = qone("""
        SELECT v.note, LENGTH(v.note) as len, p.name as pub_name, v.pub_id
        FROM visits v JOIN pubs p ON p.id = v.pub_id
        WHERE v.user_id=%s AND v.note IS NOT NULL AND v.note != ''
        ORDER BY len DESC LIMIT 1
    """, (uid,))

    # Longest pub name visited
    lname = qone("""
        SELECT p.name, p.id FROM pubs p
        JOIN visits v ON v.pub_id = p.id
        WHERE v.user_id=%s ORDER BY LENGTH(p.name) DESC LIMIT 1
    """, (uid,))

    # Geo extremes
    west  = qone("SELECT p.name, p.id FROM pubs p JOIN visits v ON v.pub_id=p.id WHERE v.user_id=%s ORDER BY p.longitude ASC  LIMIT 1", (uid,))
    east  = qone("SELECT p.name, p.id FROM pubs p JOIN visits v ON v.pub_id=p.id WHERE v.user_id=%s ORDER BY p.longitude DESC LIMIT 1", (uid,))
    north = qone("SELECT p.name, p.id FROM pubs p JOIN visits v ON v.pub_id=p.id WHERE v.user_id=%s ORDER BY p.latitude  DESC LIMIT 1", (uid,))
    south = qone("SELECT p.name, p.id FROM pubs p JOIN visits v ON v.pub_id=p.id WHERE v.user_id=%s ORDER BY p.latitude  ASC  LIMIT 1", (uid,))

    return jsonify({
        "max_streak":           max_streak or None,
        "longest_note_len":     ln["len"]      if ln     else None,
        "longest_note_pub":     ln["pub_name"] if ln     else None,
        "longest_note_pub_id":  ln["pub_id"]   if ln     else None,
        "longest_name":         lname["name"]  if lname  else None,
        "longest_name_id":      lname["id"]    if lname  else None,
        "westernmost":          west["name"]   if west   else None,
        "westernmost_id":       west["id"]     if west   else None,
        "easternmost":          east["name"]   if east   else None,
        "easternmost_id":       east["id"]     if east   else None,
        "northernmost":         north["name"]  if north  else None,
        "northernmost_id":      north["id"]    if north  else None,
        "southernmost":         south["name"]  if south  else None,
        "southernmost_id":      south["id"]    if south  else None,
    })

# ══════════════════════════════════════════════════════════════════════════════
# USERS (find + follow system)
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/users/find")
@require_auth
def find_user():
    search = (request.args.get("q") or "").strip()
    if len(search) < 2:
        return jsonify({"message": "Zadej alespoň 2 znaky"}), 400

    user = qone("SELECT * FROM users WHERE username LIKE %s AND active=1 LIMIT 1",
                (f"%{search}%",))
    if not user:
        return jsonify({"message": "Uživatel nenalezen"}), 404

    uid = user["id"]
    return _build_user_profile(uid, g.user_id)

@app.route("/api/users/<int:uid>")
@require_auth
def get_user(uid):
    return jsonify(_build_user_profile(uid, g.user_id))

def _build_user_profile(uid, viewer_id):
    user = qone("SELECT * FROM users WHERE id=%s AND active=1", (uid,))
    if not user:
        return jsonify({"message": "Uživatel nenalezen"}), 404

    total = qone("SELECT COUNT(DISTINCT pub_id) as n FROM visits WHERE user_id=%s", (uid,))["n"]
    avg   = qone("SELECT ROUND(AVG(rating),1) as r FROM visits WHERE user_id=%s", (uid,))["r"]
    fl    = qone("SELECT COUNT(*) as n FROM visit_firstlast WHERE user_id=%s", (uid,))["n"]
    fl_yr = qone("SELECT COUNT(*) as n FROM visit_firstlast WHERE user_id=%s AND year=YEAR(NOW())", (uid,))["n"]

    # Follower info
    is_following = bool(qone("SELECT id FROM user_follows WHERE follower_id=%s AND followed_id=%s", (viewer_id, uid)))
    followers_count = qone("SELECT COUNT(*) as n FROM user_follows WHERE followed_id=%s", (uid,))["n"]
    following_count = qone("SELECT COUNT(*) as n FROM user_follows WHERE follower_id=%s", (uid,))["n"]

    # Soukromí profilovky
    avatar_privacy = user.get("avatar_privacy", "public")
    avatar_url = user["avatar_url"]
    if avatar_privacy == "followers_only" and not is_following and uid != viewer_id:
        avatar_url = None  # skryjeme pro cizí lidi

    # Veřejné fotky
    photos = q("""
        SELECT pp.url FROM pub_photos pp
        WHERE pp.user_id=%s AND pp.visibility='public'
        ORDER BY pp.created_at DESC LIMIT 9
    """, (uid,))
    
    visits = q("""
        SELECT v.pub_id, p.name as pub_name, v.rating, 
               CASE WHEN v.note_visibility='public' THEN v.note ELSE NULL END AS note,
               v.logged_at
        FROM visits v
        JOIN pubs p ON p.id = v.pub_id
        WHERE v.user_id=%s AND p.active=1
        ORDER BY v.logged_at DESC
        LIMIT 20
    """, (uid,))

    return {
        "id":              uid,
        "username":        user["username"],
        "bio":             user["bio"],
        "avatar_url":      avatar_url,
        "avatar_privacy":  avatar_privacy,
        "total_visits":    total,
        "avg_rating":      float(avg) if avg else None,
        "firstlast_count": fl,
        "firstlast_this_year": fl_yr,
        "public_photos":   [p["url"] for p in photos],
        "created_at":      user["created_at"].isoformat() if user.get("created_at") else None,
        "visits":          visits,
        "is_following":    is_following,
        "followers_count": followers_count,
        "following_count": following_count,
    }

# ── Follow / Unfollow ─────────────────────────────────────────────────────────
@app.route("/api/users/<int:uid>/follow", methods=["POST"])
@require_auth
def follow_user(uid):
    if uid == g.user_id:
        return jsonify({"message": "Nemůžeš sledovat sám sebe"}), 400
    target = qone("SELECT id, username FROM users WHERE id=%s AND active=1", (uid,))
    if not target:
        return jsonify({"message": "Uživatel nenalezen"}), 404
    existing = qone("SELECT id FROM user_follows WHERE follower_id=%s AND followed_id=%s", (g.user_id, uid))
    if existing:
        return jsonify({"message": "Již sleduješ tohoto uživatele", "is_following": True})
    insert("INSERT INTO user_follows (follower_id, followed_id, created_at) VALUES (%s,%s,NOW())",
           (g.user_id, uid))
    # Notifikace novému sledovanému
    me_user = qone("SELECT username FROM users WHERE id=%s", (g.user_id,))
    if me_user:
        send_push_notification(
            uid,
            "Nový sledující! 👀",
            f"{me_user['username']} tě začal(a) sledovat.",
            {"type": "follow", "user_id": g.user_id}
        )
    return jsonify({"message": "Sleduješ tohoto uživatele", "is_following": True}), 201

@app.route("/api/users/<int:uid>/unfollow", methods=["POST"])
@require_auth
def unfollow_user(uid):
    q("DELETE FROM user_follows WHERE follower_id=%s AND followed_id=%s", (g.user_id, uid))
    return jsonify({"message": "Přestals sledovat uživatele", "is_following": False})

@app.route("/api/users/<int:uid>/followers")
@require_auth
def get_followers(uid):
    rows = q("""
        SELECT u.id, u.username, u.avatar_url
        FROM user_follows uf
        JOIN users u ON u.id = uf.follower_id
        WHERE uf.followed_id=%s AND u.active=1
        ORDER BY uf.created_at DESC
    """, (uid,))
    return jsonify([{"id": r["id"], "username": r["username"], "avatar_url": r["avatar_url"]} for r in rows])

@app.route("/api/users/<int:uid>/following")
@require_auth
def get_following(uid):
    rows = q("""
        SELECT u.id, u.username, u.avatar_url
        FROM user_follows uf
        JOIN users u ON u.id = uf.followed_id
        WHERE uf.follower_id=%s AND u.active=1
        ORDER BY uf.created_at DESC
    """, (uid,))
    return jsonify([{"id": r["id"], "username": r["username"], "avatar_url": r["avatar_url"]} for r in rows])

# ── Feed sledovaných: nedávné odkliknutí a splněné výzvy ─────────────────────
@app.route("/api/community/following")
@require_auth
def following_feed():
    limit = min(int(request.args.get("limit", 30)), 100)
    
    # Nedávné odkliknutí
    visits = q("""
        SELECT v.id, v.user_id, u.username, u.avatar_url,
               v.pub_id, p.name as pub_name, p.type as pub_type,
               v.rating, 
               CASE WHEN v.note_visibility='public' THEN v.note ELSE NULL END as note,
               v.travel_mode, v.logged_at,
               'visit' as event_type
        FROM visits v
        JOIN user_follows uf ON uf.followed_id = v.user_id
        JOIN users u ON u.id = v.user_id
        JOIN pubs p ON p.id = v.pub_id
        WHERE uf.follower_id=%s AND u.active=1 AND p.active=1
        ORDER BY v.logged_at DESC
        LIMIT %s
    """, (g.user_id, limit))

    # Nedávno splněné výzvy
    challenges_done = q("""
        SELECT uc.user_id, u.username, u.avatar_url,
               c.name as challenge_name, c.icon, c.reward,
               uc.unlocked_at,
               'challenge' as event_type
        FROM user_challenges uc
        JOIN user_follows uf ON uf.followed_id = uc.user_id
        JOIN users u ON u.id = uc.user_id
        JOIN challenges c ON c.id = uc.challenge_id
        WHERE uf.follower_id=%s AND u.active=1
        ORDER BY uc.unlocked_at DESC
        LIMIT %s
    """, (g.user_id, limit))

    # Sloučit a seřadit chronologicky
    feed = []
    for v in visits:
        feed.append({
            "event_type": "visit",
            "user_id":    v["user_id"],
            "username":   v["username"],
            "avatar_url": v["avatar_url"],
            "pub_id":     v["pub_id"],
            "pub_name":   v["pub_name"],
            "pub_type":   v["pub_type"],
            "rating":     v["rating"],
            "note":       v["note"],
            "travel_mode": v.get("travel_mode"),
            "timestamp":  v["logged_at"].isoformat() if v.get("logged_at") else None,
        })
    for c in challenges_done:
        feed.append({
            "event_type":       "challenge",
            "user_id":         c["user_id"],
            "username":        c["username"],
            "avatar_url":      c["avatar_url"],
            "challenge_name":  c["challenge_name"],
            "challenge_icon":  c["icon"],
            "challenge_reward": c["reward"],
            "timestamp":       c["unlocked_at"].isoformat() if c.get("unlocked_at") else None,
        })
    
    feed.sort(key=lambda x: x["timestamp"] or "", reverse=True)
    return jsonify(feed[:limit])

@app.route("/api/user/onboarding", methods=["POST"])
@require_auth
def set_onboarding_seen():
    data = request.get_json()
    seen = data.get("seen", True)
    q("INSERT INTO user_onboarding (user_id, seen_tutorial) VALUES (%s, %s) ON DUPLICATE KEY UPDATE seen_tutorial=%s",
      (g.user_id, seen, seen))
    return jsonify({"message": "ok"})

@app.route("/api/user/onboarding")
@require_auth
def get_onboarding():
    row = qone("SELECT seen_tutorial FROM user_onboarding WHERE user_id=%s", (g.user_id,))
    return jsonify({"seen": bool(row["seen_tutorial"]) if row else False})

# ══════════════════════════════════════════════════════════════════════════════
# LEADERBOARD
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/leaderboard")
@require_auth
def leaderboard():
    mode = request.args.get("mode", "visits")
    limit = 50

    if mode == "visits":
        rows = q("""
            SELECT u.id as user_id, u.username, u.avatar_url,
                   COUNT(DISTINCT v.pub_id) as value
            FROM users u
            LEFT JOIN visits v ON v.user_id = u.id
            WHERE u.active = 1
            GROUP BY u.id
            ORDER BY value DESC, u.username
            LIMIT %s
        """, (limit,))
    elif mode == "rating":
        rows = q("""
            SELECT u.id as user_id, u.username, u.avatar_url,
                   ROUND(AVG(v.rating), 2) as value
            FROM users u
            JOIN visits v ON v.user_id = u.id
            WHERE u.active = 1
            GROUP BY u.id
            HAVING COUNT(v.id) >= 3
            ORDER BY value DESC, u.username
            LIMIT %s
        """, (limit,))
    elif mode == "monthly":
        rows = q("""
            SELECT u.id as user_id, u.username, u.avatar_url,
                   COUNT(DISTINCT v.pub_id) as value
            FROM users u
            LEFT JOIN visits v ON v.user_id = u.id
                AND MONTH(v.logged_at) = MONTH(NOW())
                AND YEAR(v.logged_at)  = YEAR(NOW())
            WHERE u.active = 1
            GROUP BY u.id
            ORDER BY value DESC, u.username
            LIMIT %s
        """, (limit,))
    elif mode == "firstlast":
        rows = q("""
            SELECT u.id as user_id, u.username, u.avatar_url,
                   COUNT(vf.id) as value
            FROM users u
            LEFT JOIN visit_firstlast vf ON vf.user_id = u.id
            WHERE u.active = 1
            GROUP BY u.id
            ORDER BY value DESC, u.username
            LIMIT %s
        """, (limit,))
    else:
        return jsonify({"message": "Neplatný mode"}), 400

    return jsonify([{
        "user_id":    r["user_id"],
        "username":   r["username"],
        "avatar_url": r["avatar_url"],
        "value":      float(r["value"]) if r["value"] is not None else 0,
    } for r in rows])

# ══════════════════════════════════════════════════════════════════════════════
# PUB REVIEWS
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/pubs/<int:pub_id>/reviews")
@require_auth
def pub_reviews(pub_id):
    rows = q("""
        SELECT v.rating,
               CASE WHEN v.note_visibility='public' THEN v.note ELSE NULL END AS note,
               v.travel_mode,
               DATE(v.logged_at) as logged_at,
               u.username, u.avatar_url
        FROM visits v
        JOIN users u ON u.id = v.user_id
        WHERE v.pub_id = %s AND u.active = 1
        ORDER BY v.logged_at DESC
        LIMIT 50
    """, (pub_id,))
    return jsonify([{
        "rating":      r["rating"],
        "note":        r["note"],
        "travel_mode": r.get("travel_mode"),
        "logged_at":   r["logged_at"].isoformat() if r.get("logged_at") else None,
        "username":    r["username"],
        "avatar_url":  r["avatar_url"],
    } for r in rows])

# ══════════════════════════════════════════════════════════════════════════════
# PUB PHOTOS
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/pubs/<int:pub_id>/photos")
@require_auth
def pub_photos(pub_id):
    rows = q("""
        SELECT pp.id, pp.url, pp.created_at, pp.visibility, pp.user_id, u.username,
               COUNT(pl.id) as like_count,
               MAX(CASE WHEN pl2.user_id=%s THEN 1 ELSE 0 END) as liked
        FROM pub_photos pp
        JOIN users u ON u.id = pp.user_id
        LEFT JOIN photo_likes pl  ON pl.photo_id  = pp.id
        LEFT JOIN photo_likes pl2 ON pl2.photo_id = pp.id AND pl2.user_id = %s
        WHERE pp.pub_id = %s
          AND (pp.visibility = 'public' OR pp.user_id = %s)
        GROUP BY pp.id
        ORDER BY like_count DESC, pp.created_at DESC
        LIMIT 30
    """, (g.user_id, g.user_id, pub_id, g.user_id))
    return jsonify([{
        "id":         r["id"],
        "url":        r["url"],
        "username":   r["username"],
        "user_id":    r["user_id"],
        "visibility": r["visibility"],
        "like_count": r["like_count"],
        "liked":      bool(r["liked"]),
    } for r in rows])

@app.route("/api/photos/<int:photo_id>/report", methods=["POST"])
@require_auth
def report_photo(photo_id):
    photo = qone("SELECT id, pub_id FROM pub_photos WHERE id=%s", (photo_id,))
    if not photo:
        return jsonify({"message": "Fotka nenalezena"}), 404
    d = request.get_json() or {}
    detail = (d.get("detail") or "")[:500]
    detail_str = f"Foto ID: {photo_id}" + (f" | {detail}" if detail else "")
    insert("INSERT INTO pub_reports (pub_id, user_id, reason, detail, created_at) VALUES (%s,%s,%s,%s,NOW())",
           (photo["pub_id"], g.user_id, "Nevhodn\u00e1 fotka", detail_str))
    return jsonify({"message": "Fotka nahl\u00e1\u0161ena"}), 201

@app.route("/api/photos/<int:photo_id>", methods=["DELETE"])
@require_auth
def delete_photo(photo_id):
    photo = qone("SELECT * FROM pub_photos WHERE id=%s AND user_id=%s", (photo_id, g.user_id))
    if not photo:
        return jsonify({"message": "Fotka nenalezena nebo nemáš právo ji smazat"}), 404

    try:
        url = photo["url"]
        rel = url.replace(BASE_URL, "").lstrip("/")
        file_path = os.path.join(UPLOAD_DIR, *rel.split("/")[1:])
        if os.path.exists(file_path):
            os.remove(file_path)
    except Exception as e:
        app.logger.warning(f"Nelze smazat soubor fotky {photo_id}: {e}")

    q("DELETE FROM photo_likes WHERE photo_id=%s", (photo_id,))
    q("DELETE FROM pub_photos WHERE id=%s AND user_id=%s", (photo_id, g.user_id))
    return jsonify({"message": "Fotka smazána"})

# ══════════════════════════════════════════════════════════════════════════════
# COMMUNITY – CHAT (plně funkční s reply, reakcemi, mazáním)
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/community/chat")
@require_auth
def get_chat():
    limit  = min(int(request.args.get("limit", 60)), 100)
    before = request.args.get("before")  # pagination: zprávy před daným ID
    
    if before:
        msgs = q("""
            SELECT m.id, m.user_id, m.message, m.created_at,
                   m.reply_to_id, m.reactions,
                   u.username, u.avatar_url,
                   rm.message as reply_message, ru.username as reply_username,
                   (SELECT COUNT(*) FROM chat_reads cr WHERE cr.message_id = m.id) as read_count,
                   EXISTS(SELECT 1 FROM chat_reads cr WHERE cr.message_id = m.id AND cr.user_id = %s) as read_by_me
            FROM chat_messages m
            JOIN users u ON u.id = m.user_id
            LEFT JOIN chat_messages rm ON rm.id = m.reply_to_id
            LEFT JOIN users ru ON ru.id = rm.user_id
            WHERE u.active = 1 AND m.id < %s
            ORDER BY m.created_at DESC
            LIMIT %s
        """, (g.user_id, before, limit))
    else:
        msgs = q("""
            SELECT m.id, m.user_id, m.message, m.created_at,
                   m.reply_to_id, m.reactions,
                   u.username, u.avatar_url,
                   rm.message as reply_message, ru.username as reply_username,
                   (SELECT COUNT(*) FROM chat_reads cr WHERE cr.message_id = m.id) as read_count,
                   EXISTS(SELECT 1 FROM chat_reads cr WHERE cr.message_id = m.id AND cr.user_id = %s) as read_by_me
            FROM chat_messages m
            JOIN users u ON u.id = m.user_id
            LEFT JOIN chat_messages rm ON rm.id = m.reply_to_id
            LEFT JOIN users ru ON ru.id = rm.user_id
            WHERE u.active = 1
            ORDER BY m.created_at DESC
            LIMIT %s
        """, (g.user_id, limit,))
    
    return jsonify([{
        "id":             m["id"],
        "user_id":        m["user_id"],
        "username":       m["username"],
        "avatar_url":     m["avatar_url"],
        "message":        m["message"],
        "reply_to_id":    m.get("reply_to_id"),
        "reply_message":  m.get("reply_message"),
        "reply_username": m.get("reply_username"),
        "reactions":      m.get("reactions") or "{}",
        "read_count":     int(m.get("read_count") or 0),
        "read_by_me":     bool(m.get("read_by_me")),
        "created_at":     m["created_at"].isoformat() if m.get("created_at") else None,
    } for m in msgs])

@app.route("/api/community/chat", methods=["POST"])
@require_auth
def post_chat():
    data = request.get_json()
    msg = (data.get("message") or "").strip()[:500]
    reply_to_id = data.get("reply_to_id")
    if not msg:
        return jsonify({"message": "Prázdná zpráva"}), 400
    
    # Ověř reply_to_id pokud je zadáno
    if reply_to_id:
        if not qone("SELECT id FROM chat_messages WHERE id=%s", (reply_to_id,)):
            reply_to_id = None
    
    mid = insert(
        "INSERT INTO chat_messages (user_id, message, reply_to_id, reactions, created_at) VALUES (%s,%s,%s,'{}',NOW())",
        (g.user_id, msg, reply_to_id)
    )
    
    # Notifikace uživateli, na jehož zprávu jsi odpověděl
    if reply_to_id:
        original = qone("SELECT user_id FROM chat_messages WHERE id=%s", (reply_to_id,))
        if original and original["user_id"] != g.user_id:
            me_user = qone("SELECT username FROM users WHERE id=%s", (g.user_id,))
            if me_user:
                send_push_notification(
                    original["user_id"],
                    "Odpověď v chatu 💬",
                    f"{me_user['username']}: {msg[:80]}",
                    {"type": "chat_reply", "message_id": mid}
                )
    # Fetch created message with user info
    created = qone("SELECT m.id, m.user_id, m.message, m.created_at, m.reply_to_id, m.reactions, u.username, u.avatar_url, rm.message as reply_message, ru.username as reply_username FROM chat_messages m JOIN users u ON u.id = m.user_id LEFT JOIN chat_messages rm ON rm.id = m.reply_to_id LEFT JOIN users ru ON ru.id = rm.user_id WHERE m.id=%s", (mid,))
    payload = {
        "id": created["id"],
        "user_id": created["user_id"],
        "username": created["username"],
        "avatar_url": created["avatar_url"],
        "message": created["message"],
        "reply_to_id": created.get("reply_to_id"),
        "reply_message": created.get("reply_message"),
        "reply_username": created.get("reply_username"),
        "reactions": created.get("reactions") or "{}",
        "created_at": created["created_at"].isoformat() if created.get("created_at") else None,
    }
    # Emit to all connected clients
    try:
        if socketio:
            socketio.emit('chat:new', payload, broadcast=True)
    except Exception:
        pass

    # Send push notifications to offline users (exclude sender and connected sids)
    try:
        # Get all active users who have push tokens, excluding sender
        rows = q("SELECT user_id FROM push_tokens WHERE user_id != %s", (g.user_id,))
        user_ids = list({r['user_id'] for r in rows})
        # Exclude users currently connected via websocket
        online = set(connected_sids.values())
        offline_users = [uid for uid in user_ids if uid not in online]
        for uid in offline_users:
            send_push_notification(uid, f"Nová zpráva od {payload['username']}", payload['message'][:120], {"type":"chat_message","message_id":payload['id']})
    except Exception as e:
        app.logger.warning(f"Push při nové zprávě selhal: {e}")
    return jsonify({"id": mid}), 201

@app.route("/api/community/chat/<int:mid>", methods=["DELETE"])
@require_auth
def delete_chat_message(mid):
    msg = qone("SELECT * FROM chat_messages WHERE id=%s AND user_id=%s", (mid, g.user_id))
    if not msg:
        # Admin může mazat cokoliv
        user = qone("SELECT is_admin FROM users WHERE id=%s", (g.user_id,))
        if user and user.get("is_admin"):
            q("DELETE FROM chat_messages WHERE id=%s", (mid,))
            return jsonify({"message": "Zpráva smazána (admin)"})
        return jsonify({"message": "Zprávu nemůžeš smazat"}), 403
    q("DELETE FROM chat_messages WHERE id=%s", (mid,))
    try:
        if socketio:
            socketio.emit('chat:delete', {"id": mid}, broadcast=True)
    except Exception:
        pass
    return jsonify({"message": "Zpráva smazána"})

@app.route("/api/community/chat/<int:mid>/react", methods=["POST"])
@require_auth
def react_to_message(mid):
    data = request.get_json()
    emoji = (data.get("emoji") or "").strip()[:10]
    if not emoji:
        return jsonify({"message": "Chybí emoji"}), 400
    
    msg = qone("SELECT reactions FROM chat_messages WHERE id=%s", (mid,))
    if not msg:
        return jsonify({"message": "Zpráva nenalezena"}), 404
    
    import json
    try:
        reactions = json.loads(msg["reactions"] or "{}")
    except:
        reactions = {}
    
    key = f"{emoji}_{g.user_id}"
    if key in reactions:
        del reactions[key]
    else:
        reactions[key] = emoji
    
    # Seskupit reakce: {emoji: count}
    summary = {}
    for v in reactions.values():
        summary[v] = summary.get(v, 0) + 1
    
    q("UPDATE chat_messages SET reactions=%s WHERE id=%s", (json.dumps(reactions), mid))
    try:
        if socketio:
            socketio.emit('chat:react', {"id": mid, "reactions": summary, "raw": reactions}, broadcast=True)
    except Exception:
        pass
    return jsonify({"reactions": summary, "raw": reactions})


@app.route('/api/community/chat/read', methods=['POST'])
@require_auth
def mark_read():
    data = request.get_json() or {}
    mid = data.get('message_id')
    if not mid:
        return jsonify({"error": "message_id required"}), 400
    try:
        q("INSERT INTO chat_reads (message_id, user_id, read_at) VALUES (%s,%s,NOW()) ON DUPLICATE KEY UPDATE read_at=NOW()", (mid, g.user_id))
    except Exception:
        # table may not exist — ignore
        pass
    try:
        if socketio:
            socketio.emit('chat:read', {"message_id": mid, "user_id": g.user_id, "read_at": datetime.datetime.utcnow().isoformat()}, broadcast=True)
    except Exception:
        pass
    return jsonify({"ok": True})

# ══════════════════════════════════════════════════════════════════════════════
# COMMUNITY – GALLERY
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/community/gallery")
@require_auth
def gallery():
    page  = max(1, int(request.args.get("page", 1)))
    limit = min(int(request.args.get("limit", 18)), 50)
    off   = (page - 1) * limit
    rows = q("""
        SELECT pp.id, pp.url, pp.created_at, u.username, p.name as pub_name,
               COUNT(pl.id) as like_count,
               MAX(CASE WHEN pl2.user_id = %s THEN 1 ELSE 0 END) as liked
        FROM pub_photos pp
        JOIN users u ON u.id = pp.user_id
        JOIN pubs  p ON p.id = pp.pub_id
        LEFT JOIN photo_likes pl  ON pl.photo_id  = pp.id
        LEFT JOIN photo_likes pl2 ON pl2.photo_id = pp.id AND pl2.user_id = %s
        WHERE u.active = 1 AND pp.visibility = 'public'
        GROUP BY pp.id
        ORDER BY pp.created_at DESC
        LIMIT %s OFFSET %s
    """, (g.user_id, g.user_id, limit, off))
    return jsonify([{
        "id": r["id"], "url": r["url"], "username": r["username"],
        "pub_name": r["pub_name"],
        "like_count": r["like_count"],
        "liked": bool(r["liked"]),
        "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
    } for r in rows])

# ══════════════════════════════════════════════════════════════════════════════
# NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/notifications/likes")
@require_auth
def check_new_likes():
    since = request.args.get("since")
    if not since:
        return jsonify({"count": 0}), 200
    try:
        since_dt = datetime.datetime.fromisoformat(since.replace('Z', '+00:00'))
    except:
        return jsonify({"count": 0}), 200

    photos = q("SELECT id FROM pub_photos WHERE user_id=%s", (g.user_id,))
    if not photos:
        return jsonify({"count": 0}), 200
    photo_ids = [p["id"] for p in photos]
    placeholders = ','.join(['%s'] * len(photo_ids))
    count = qone(f"""
        SELECT COUNT(*) as cnt FROM photo_likes
        WHERE photo_id IN ({placeholders}) AND created_at > %s
    """, (*photo_ids, since_dt))["cnt"]
    return jsonify({"count": count})

@app.route("/api/notifications/token", methods=["POST"])
@require_auth
def save_push_token():
    data = request.get_json()
    token = data.get("token")
    if not token:
        return jsonify({"message": "Chybí token"}), 400
    # Uloží nebo aktualizuje token pro tohoto uživatele
    try:
        insert("""
            INSERT INTO push_tokens (user_id, token, updated_at)
            VALUES (%s, %s, NOW())
            ON DUPLICATE KEY UPDATE token = VALUES(token), updated_at = NOW()
        """, (g.user_id, token))
    except Exception:
        # Fallback: UPDATE pokud INSERT selhal
        q("UPDATE push_tokens SET token=%s, updated_at=NOW() WHERE user_id=%s", (token, g.user_id))
    return jsonify({"message": "Token uložen"})

# ══════════════════════════════════════════════════════════════════════════════
# STATIC UPLOADS
# ══════════════════════════════════════════════════════════════════════════════
@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)

@app.route('/admin')
def serve_admin():
    return send_from_directory("/srv/app", "admin.html")

# ══════════════════════════════════════════════════════════════════════════════
# ADMIN HELPERS
# ══════════════════════════════════════════════════════════════════════════════
def require_admin(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"message": "Nejsi přihlášen"}), 401
        try:
            payload = decode_token(auth[7:])
            uid = payload["sub"]
            user = qone("SELECT * FROM users WHERE id=%s AND active=1 AND is_admin=1", (uid,))
            if not user:
                return jsonify({"message": "Přístup odepřen – nejsi admin"}), 403
            g.user_id = uid
            g.user = user
        except jwt.ExpiredSignatureError:
            return jsonify({"message": "Přihlášení vypršelo"}), 401
        except Exception:
            return jsonify({"message": "Neplatný token"}), 401
        return f(*args, **kwargs)
    return wrapper

# ══════════════════════════════════════════════════════════════════════════════
# ADMIN ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/admin/pubs")
@require_admin
def admin_get_pubs():
    pubs = q("""
        SELECT p.*,
               ROUND(AVG(v.rating),1) as avg_rating,
               COUNT(v.id) as visit_count
        FROM pubs p
        LEFT JOIN visits v ON v.pub_id = p.id
        GROUP BY p.id
        ORDER BY p.name
    """)
    return jsonify([{
        "id": p["id"], "name": p["name"], "type": p["type"],
        "latitude": float(p["latitude"]), "longitude": float(p["longitude"]),
        "address": p["address"], "opening_hours": p["opening_hours"],
        "beers": p["beers"], "card_payment": bool(p["card_payment"]),
        "note": p["note"], "phone": p.get("phone"), "active": bool(p["active"]),
        "avg_rating": float(p["avg_rating"]) if p.get("avg_rating") else 0,
        "visit_count": p.get("visit_count", 0),
    } for p in pubs])

@app.route("/api/admin/pubs", methods=["POST"])
@require_admin
def admin_add_pub():
    d = request.get_json()
    if not d.get("name") or not d.get("latitude") or not d.get("longitude"):
        return jsonify({"message": "Chybí povinná pole (name, latitude, longitude)"}), 400
    pid = insert(
        "INSERT INTO pubs (name,type,latitude,longitude,address,opening_hours,beers,card_payment,note,phone,active,added_by,created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,%s,NOW())",
        (d["name"], d.get("type","hospoda"), d["latitude"], d["longitude"],
         d.get("address"), d.get("opening_hours"), d.get("beers"),
         int(bool(d.get("card_payment",False))), d.get("note"), d.get("phone"), g.user_id)
    )
    return jsonify({"id": pid, "message": "Hospůdka přidána"}), 201

@app.route("/api/admin/pubs/<int:pub_id>", methods=["PUT"])
@require_admin
def admin_update_pub(pub_id):
    d = request.get_json()
    q("""UPDATE pubs SET name=%s,type=%s,latitude=%s,longitude=%s,address=%s,
         opening_hours=%s,beers=%s,card_payment=%s,note=%s,phone=%s,active=%s WHERE id=%s""",
      (d["name"], d.get("type","hospoda"), d["latitude"], d["longitude"],
       d.get("address"), d.get("opening_hours"), d.get("beers"),
       int(bool(d.get("card_payment",False))), d.get("note"), d.get("phone"),
       int(bool(d.get("active",True))), pub_id))
    return jsonify({"message": "Hospůdka aktualizována"})

@app.route("/api/admin/pubs/<int:pub_id>", methods=["DELETE"])
@require_admin
def admin_delete_pub(pub_id):
    q("UPDATE pubs SET active=0 WHERE id=%s", (pub_id,))
    return jsonify({"message": "Hospůdka skryta"})

@app.route("/api/admin/pubs/<int:pub_id>/questions")
@require_admin
def admin_get_questions(pub_id):
    questions = q("SELECT * FROM pub_questions WHERE pub_id=%s ORDER BY id", (pub_id,))
    result = []
    for qr in questions:
        answers = q("SELECT * FROM question_answers WHERE question_id=%s ORDER BY id", (qr["id"],))
        result.append({
            "id": qr["id"], "question_text": qr["question_text"], "active": bool(qr["active"]),
            "answers": [{"id": a["id"], "answer_text": a["answer_text"], "is_correct": bool(a["is_correct"])} for a in answers],
        })
    return jsonify(result)

@app.route("/api/admin/pubs/<int:pub_id>/questions", methods=["POST"])
@require_admin
def admin_add_question(pub_id):
    d = request.get_json()
    if not d.get("question_text") or not d.get("answers"):
        return jsonify({"message": "Chybí question_text nebo answers"}), 400
    if not any(a.get("is_correct") for a in d["answers"]):
        return jsonify({"message": "Musí být alespoň jedna správná odpověď"}), 400
    qid = insert("INSERT INTO pub_questions (pub_id,question_text,active,created_at) VALUES (%s,%s,1,NOW())",
                 (pub_id, d["question_text"]))
    for ans in d["answers"]:
        insert("INSERT INTO question_answers (question_id,answer_text,is_correct) VALUES (%s,%s,%s)",
               (qid, ans["answer_text"], int(bool(ans.get("is_correct",False)))))
    return jsonify({"id": qid, "message": "Otázka přidána"}), 201

@app.route("/api/admin/questions/<int:qid>", methods=["PUT"])
@require_admin
def admin_update_question(qid):
    d = request.get_json()
    q("UPDATE pub_questions SET question_text=%s, active=%s WHERE id=%s",
      (d["question_text"], int(bool(d.get("active", True))), qid))
    if d.get("answers"):
        q("DELETE FROM question_answers WHERE question_id=%s", (qid,))
        for ans in d["answers"]:
            insert("INSERT INTO question_answers (question_id,answer_text,is_correct) VALUES (%s,%s,%s)",
                   (qid, ans["answer_text"], int(bool(ans.get("is_correct",False)))))
    return jsonify({"message": "Otázka aktualizována"})

@app.route("/api/admin/questions/<int:qid>", methods=["DELETE"])
@require_admin
def admin_delete_question(qid):
    q("DELETE FROM question_answers WHERE question_id=%s", (qid,))
    q("DELETE FROM pub_questions WHERE id=%s", (qid,))
    return jsonify({"message": "Otázka smazána"})

@app.route("/api/admin/challenges")
@require_admin
def admin_get_challenges():
    rows = q("SELECT * FROM challenges ORDER BY sort_order, id")
    return jsonify([{
        "id": c["id"], "name": c["name"], "description": c["description"],
        "icon": c["icon"], "challenge_type": c["challenge_type"],
        "filter_value": c["filter_value"], "target": c["target"],
        "reward": c["reward"], "sort_order": c["sort_order"], "active": bool(c["active"]),
    } for c in rows])

@app.route("/api/admin/challenges", methods=["POST"])
@require_admin
def admin_add_challenge():
    d = request.get_json()
    cid = insert(
        "INSERT INTO challenges (name,description,icon,challenge_type,filter_value,target,reward,sort_order,active,created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())",
        (d["name"], d.get("description"), d.get("icon","🎯"), d["challenge_type"],
         d.get("filter_value"), int(d.get("target",1)), d.get("reward"),
         int(d.get("sort_order",0)), int(bool(d.get("active",True))))
    )
    return jsonify({"id": cid, "message": "Výzva přidána"}), 201

@app.route("/api/admin/challenges/<int:cid>", methods=["PUT"])
@require_admin
def admin_update_challenge(cid):
    d = request.get_json()
    q("UPDATE challenges SET name=%s,description=%s,icon=%s,challenge_type=%s,filter_value=%s,"
      "target=%s,reward=%s,sort_order=%s,active=%s WHERE id=%s",
      (d["name"], d.get("description"), d.get("icon","🎯"), d["challenge_type"],
       d.get("filter_value"), int(d.get("target",1)), d.get("reward"),
       int(d.get("sort_order",0)), int(bool(d.get("active",True))), cid))
    return jsonify({"message": "Výzva aktualizována"})

@app.route("/api/admin/challenges/<int:cid>", methods=["DELETE"])
@require_admin
def admin_delete_challenge(cid):
    q("DELETE FROM challenges WHERE id=%s", (cid,))
    return jsonify({"message": "Výzva smazána"})

@app.route("/api/admin/users")
@require_admin
def admin_get_users():
    rows = q("""
        SELECT u.id, u.username, u.email, u.is_admin, u.active, u.created_at, u.last_login,
               COUNT(DISTINCT v.pub_id) as visit_count
        FROM users u
        LEFT JOIN visits v ON v.user_id = u.id
        GROUP BY u.id
        ORDER BY u.created_at DESC
    """)
    return jsonify([{
        "id": u["id"], "username": u["username"], "email": u["email"],
        "is_admin": bool(u["is_admin"]), "active": bool(u["active"]),
        "visit_count": u["visit_count"],
        "created_at": u["created_at"].isoformat() if u.get("created_at") else None,
        "last_login": u["last_login"].isoformat() if u.get("last_login") else None,
    } for u in rows])

@app.route("/api/admin/users/<int:uid>", methods=["PUT"])
@require_admin
def admin_update_user(uid):
    d = request.get_json()
    q("UPDATE users SET is_admin=%s, active=%s WHERE id=%s",
      (int(bool(d.get("is_admin",False))), int(bool(d.get("active",True))), uid))
    return jsonify({"message": "Uživatel aktualizován"})

@app.route("/api/admin/stats")
@require_admin
def admin_stats():
    return jsonify({
        "total_pubs":    qone("SELECT COUNT(*) as n FROM pubs WHERE active=1")["n"],
        "total_users":   qone("SELECT COUNT(*) as n FROM users WHERE active=1")["n"],
        "total_visits":  qone("SELECT COUNT(*) as n FROM visits")["n"],
        "visits_today":  qone("SELECT COUNT(*) as n FROM visits WHERE DATE(logged_at)=CURDATE()")["n"],
        "visits_week":   qone("SELECT COUNT(*) as n FROM visits WHERE logged_at >= DATE_SUB(NOW(),INTERVAL 7 DAY)")["n"],
        "photos_total":  qone("SELECT COUNT(*) as n FROM pub_photos")["n"],
    })

@app.route("/api/admin/suggestions")
@require_admin
def admin_suggestions():
    rows = q("""
        SELECT s.*, u.username
        FROM pub_suggestions s
        JOIN users u ON u.id = s.user_id
        WHERE s.status = 'pending'
        ORDER BY s.created_at DESC
    """)
    return jsonify([{
        "id": r["id"], "username": r["username"], "name": r["name"],
        "type": r["type"], "address": r["address"], "note": r["note"],
        "latitude": float(r["latitude"]), "longitude": float(r["longitude"]),
        "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
    } for r in rows])

@app.route("/api/admin/suggestions/<int:sid>", methods=["PUT"])
@require_admin
def admin_update_suggestion(sid):
    d = request.get_json()
    status = d.get("status", "approved")
    q("UPDATE pub_suggestions SET status=%s WHERE id=%s", (status, sid))
    return jsonify({"message": "Návrh aktualizován"})

@app.route("/api/admin/reports")
@require_admin
def admin_reports():
    rows = q("""
        SELECT r.*, u.username, p.name as pub_name
        FROM pub_reports r
        JOIN users u ON u.id = r.user_id
        JOIN pubs  p ON p.id = r.pub_id
        WHERE r.resolved = 0
        ORDER BY r.created_at DESC
    """)
    return jsonify([{
        "id": r["id"], "pub_id": r["pub_id"], "pub_name": r["pub_name"],
        "username": r["username"], "reason": r["reason"], "detail": r["detail"],
        "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
    } for r in rows])

@app.route("/api/admin/reports/<int:rid>", methods=["PUT"])
@require_admin
def admin_resolve_report(rid):
    q("UPDATE pub_reports SET resolved=1 WHERE id=%s", (rid,))
    return jsonify({"message": "Nahlášení vyřešeno"})

# ══════════════════════════════════════════════════════════════════════════════
# DB MIGRATIONS (spustit POST /api/admin/migrate po nasazení 1.4.5)
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/admin/migrate", methods=["POST"])
@require_admin
def run_migrations():
    migrations = [
        # Existující migrace z 1.4.x
        "ALTER TABLE visits ADD COLUMN IF NOT EXISTS travel_mode VARCHAR(50) NULL",
        """CREATE TABLE IF NOT EXISTS password_resets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            token VARCHAR(100) NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL,
            INDEX idx_token (token),
            INDEX idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
        # NOVÉ pro 1.4.5: Follow systém
        """CREATE TABLE IF NOT EXISTS user_follows (
            id INT AUTO_INCREMENT PRIMARY KEY,
            follower_id INT NOT NULL,
            followed_id INT NOT NULL,
            created_at DATETIME NOT NULL,
            UNIQUE KEY uq_follow (follower_id, followed_id),
            INDEX idx_follower (follower_id),
            INDEX idx_followed (followed_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
        # Nastavení soukromí profilovky
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_privacy VARCHAR(30) NOT NULL DEFAULT 'public'",
        # Nastavení pamatování poslední polohy mapy
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS map_remember_position TINYINT(1) NOT NULL DEFAULT 0",
        # Chat: reply a reakce
        "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id INT NULL",
        "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reactions TEXT NULL DEFAULT '{}'",
        # Push tokens tabulka (pokud neexistuje)
        """CREATE TABLE IF NOT EXISTS push_tokens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            token VARCHAR(300) NOT NULL,
            updated_at DATETIME NOT NULL,
            UNIQUE KEY uq_user (user_id),
            INDEX idx_token (token(100))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
        # user_challenges tabulka
        """CREATE TABLE IF NOT EXISTS user_challenges (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            challenge_id INT NOT NULL,
            unlocked_at DATETIME NOT NULL,
            UNIQUE KEY uq_uc (user_id, challenge_id),
            INDEX idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
        # Telefonn\u00ed \u010d\u00edslo hospody (1.5.0)
        "ALTER TABLE pubs ADD COLUMN IF NOT EXISTS phone VARCHAR(30) NULL",
        # Nastaven\u00ed viditelnosti profilu (1.5.0)
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS show_join_date TINYINT(1) NOT NULL DEFAULT 1",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS show_visits_on_profile TINYINT(1) NOT NULL DEFAULT 1",
        # Telemetrie (1.5.0)
        """CREATE TABLE IF NOT EXISTS telemetry_events (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            event VARCHAR(100) NOT NULL,
            props TEXT,
            client_ts VARCHAR(40),
            created_at DATETIME NOT NULL,
            INDEX idx_user (user_id),
            INDEX idx_event (event)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
    ]
    results = []
    for sql in migrations:
        try:
            q(sql)
            results.append({"sql": sql[:60], "status": "ok"})
        except Exception as e:
            results.append({"sql": sql[:60], "status": "error", "error": str(e)})
    return jsonify({"results": results})

# ══════════════════════════════════════════════════════════════════════════════
# FIRSTLAST + CHALLENGES helpers
# ══════════════════════════════════════════════════════════════════════════════
def _check_firstlast(user_id, pub_id, logged_at_str):
    try:
        year = datetime.datetime.fromisoformat(logged_at_str.replace('Z','+00:00')).year
    except Exception:
        year = datetime.datetime.utcnow().year
    existing = qone("SELECT id FROM visit_firstlast WHERE pub_id=%s AND year=%s", (pub_id, year))
    if not existing:
        insert("INSERT INTO visit_firstlast (user_id,pub_id,year,created_at) VALUES (%s,%s,%s,NOW())",
               (user_id, pub_id, year))
        return True
    return False

def _check_newly_unlocked_challenges(user_id):
    challenges = q("SELECT * FROM challenges WHERE active=1")
    unlocked = []
    for ch in challenges:
        progress = _calc_challenge_progress(user_id, ch)
        already = qone("SELECT 1 FROM user_challenges WHERE user_id=%s AND challenge_id=%s", (user_id, ch["id"]))
        if progress >= ch["target"] and not already:
            unlocked.append(ch["name"])
            insert("INSERT INTO user_challenges (user_id, challenge_id, unlocked_at) VALUES (%s,%s,NOW())",
                   (user_id, ch["id"]))
            # Push notifikace o splnění výzvy
            send_push_notification(
                user_id,
                f"Výzva splněna! 🏆",
                f"Dokončil(a) jsi výzvu: {ch['name']}",
                {"type": "challenge", "challenge_id": ch["id"]}
            )
    return unlocked

# ══════════════════════════════════════════════════════════════════════════════
# TELEMETRY
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/telemetry", methods=["POST"])
@require_auth
def log_telemetry():
    data = request.get_json() or {}
    try:
        insert(
            "INSERT INTO telemetry_events (user_id, event, props, client_ts, created_at) VALUES (%s,%s,%s,%s,NOW())",
            (g.user_id, (data.get("event") or "")[:100],
             str(data.get("props", {}))[:2000], data.get("ts"))
        )
    except Exception:
        pass  # table may not exist yet, silently ignore
    return jsonify({"ok": True})

# ══════════════════════════════════════════════════════════════════════════════
# HEALTH
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "service": "Hospůdkobraní API v1.5.0"})

@app.route("/")
def indexhtml():
        return send_from_directory('','index.html')


@app.route('/pub/<int:pub_id>')
def pub_page(pub_id):
        pub = qone("SELECT id, name, address, note FROM pubs WHERE id=%s AND active=1", (pub_id,))
        if not pub:
                return "Hospůdka nenalezena", 404
        thumb = qone("SELECT pp.url FROM pub_photos pp WHERE pp.pub_id=%s AND pp.visibility='public' ORDER BY pp.created_at DESC LIMIT 1", (pub_id,))
        image = thumb["url"] if thumb else ""
        web_url = f"{BASE_URL}/pub/{pub_id}"
        app_link = f"hospudkobrani://pub/{pub_id}"
        html = f'''<!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta property="og:title" content="{pub['name']}">
            <meta property="og:description" content="{(pub['note'] or '')[:200]}">
            <meta property="og:image" content="{image}">
            <meta name="twitter:card" content="summary_large_image">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <title>{pub['name']}</title>
            <script>
                (function(){{
                    var appLink = '{app_link}';
                    var webUrl = '{web_url}';
                    var intentLink = 'intent://pub/{pub_id}#Intent;scheme=hospudkobrani;package=cz.fluffini.hospudkobrani;S.browser_fallback_url=' + encodeURIComponent(webUrl) + ';end';
                    var ua = navigator.userAgent || '';
                    var isAndroid = /Android/i.test(ua);
                    var isIOS = /iPhone|iPad|iPod/i.test(ua);

                    function openViaIframe(url) {{
                        var iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = url;
                        document.body.appendChild(iframe);
                        setTimeout(function() {{
                            document.body.removeChild(iframe);
                        }}, 2000);
                    }}

                    function tryOpen() {{
                        try {{
                            if (isAndroid) {{
                                window.location = intentLink;
                            }} else if (isIOS) {{
                                openViaIframe(appLink);
                                setTimeout(function() {{ window.location = webUrl; }}, 1200);
                            }} else {{
                                window.location = webUrl;
                            }}
                        }} catch (e) {{
                            window.location = webUrl;
                        }}
                    }}

                    window.openApp = tryOpen;
                    if (isAndroid || isIOS) {{
                        setTimeout(tryOpen, 300);
                    }}
                }})();
            </script>
            <style>body{{font-family:Helvetica,Arial,sans-serif;background:#fff;color:#111;padding:20px}}</style>
        </head>
        <body>
            <h1>{pub['name']}</h1>
            <p>{pub['address'] or ''}</p>
            <p>{pub['note'] or ''}</p>
            { (f'<img src="{image}" style="max-width:100%;height:auto;margin-top:12px" />') if image else '' }
            <p style="margin-top:18px;"><button onclick="openApp()">Otevřít v aplikaci</button></p>
            <p style="font-size:12px;color:#666">Pokud aplikaci nemáš, použij tento odkaz: <a href="{web_url}">{web_url}</a></p>
        </body>
        </html>'''
        return html

# ══════════════════════════════════════════════════════════════════════════════
# SCHEDULER (cachování transport/parking dat každou hodinu)
# ══════════════════════════════════════════════════════════════════════════════
scheduler = BackgroundScheduler()
scheduler.add_job(
    func=fetch_transport_and_parking,
    trigger="interval",
    hours=1,
    next_run_time=datetime.datetime.now()
)
scheduler.start()

fetch_transport_and_parking()

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)