import math
from urllib.parse import quote_plus
from dotenv import load_dotenv
import os
from datetime import date, datetime, timedelta, timezone

import requests
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import re
import sqlite3
import hashlib
import hmac
import secrets
import json
from typing import Optional

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================================================
# ACCOUNTS + SAVED TRIPS (SQLite)
# =========================================================

DB_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "roamly.db"
)


def now_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None)


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():

    conn = db()

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            from_location TEXT NOT NULL,
            destination TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            people INTEGER NOT NULL,
            total_cost REAL NOT NULL DEFAULT 0,
            selection TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            amount REAL NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL
        );
    """)

    for column in ("ai_summary TEXT", "summary_hash TEXT"):
        try:
            conn.execute(f"ALTER TABLE trips ADD COLUMN {column}")
        except sqlite3.OperationalError:
            pass  # column already exists

    conn.commit()
    conn.close()


init_db()


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class SaveTripRequest(BaseModel):
    from_location: str
    destination: str
    start_date: str
    end_date: str
    people: int
    total_cost: float = 0
    selection: Optional[dict] = None

class ExpenseRequest(BaseModel):
    category: str
    amount: float
    note: str = ""


def hash_password(password, salt=None):

    salt = salt or secrets.token_hex(16)

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        200_000
    ).hex()

    return salt, digest


def create_session(conn, user_id):

    token = secrets.token_urlsafe(32)

    token_hash = hashlib.sha256(
        token.encode("utf-8")
    ).hexdigest()

    expires_at = (
        now_utc() + timedelta(days=30)
    ).isoformat()

    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) "
        "VALUES (?, ?, ?)",
        (token_hash, user_id, expires_at)
    )

    return token


def public_user(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"]
    }


def current_user(authorization: str = Header(default="")):

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Please sign in to continue."
        )

    token = authorization[7:].strip()

    token_hash = hashlib.sha256(
        token.encode("utf-8")
    ).hexdigest()

    conn = db()

    row = conn.execute(
        "SELECT users.id, users.name, users.email, sessions.expires_at "
        "FROM sessions JOIN users ON users.id = sessions.user_id "
        "WHERE sessions.token_hash = ?",
        (token_hash,)
    ).fetchone()

    conn.close()

    if (
        row is None
        or datetime.fromisoformat(row["expires_at"]) < now_utc()
    ):
        raise HTTPException(
            status_code=401,
            detail="Your session has expired. Please sign in again."
        )

    return row


# ---------------------------------------------------------
# AUTH ROUTES
# ---------------------------------------------------------

@app.post("/auth/register")
def register(data: RegisterRequest):

    name = data.name.strip()
    email = data.email.strip().lower()

    if len(name) < 2:
        raise HTTPException(
            status_code=400,
            detail="Please enter your name."
        )

    if not EMAIL_PATTERN.match(email):
        raise HTTPException(
            status_code=400,
            detail="Please enter a valid email address."
        )

    if len(data.password) < 6:
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 6 characters."
        )

    salt, digest = hash_password(data.password)

    conn = db()

    try:
        cursor = conn.execute(
            "INSERT INTO users "
            "(name, email, salt, password_hash, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (name, email, salt, digest, now_utc().isoformat())
        )

        user_id = cursor.lastrowid
        token = create_session(conn, user_id)
        conn.commit()

    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists."
        )

    conn.close()

    return {
        "token": token,
        "user": {"id": user_id, "name": name, "email": email}
    }


@app.post("/auth/login")
def login(data: LoginRequest):

    email = data.email.strip().lower()

    conn = db()

    row = conn.execute(
        "SELECT * FROM users WHERE email = ?",
        (email,)
    ).fetchone()

    if row is None:
        conn.close()
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password."
        )

    _, digest = hash_password(data.password, row["salt"])

    if not hmac.compare_digest(digest, row["password_hash"]):
        conn.close()
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password."
        )

    token = create_session(conn, row["id"])
    conn.commit()
    conn.close()

    return {"token": token, "user": public_user(row)}


@app.post("/auth/logout")
def logout(authorization: str = Header(default="")):

    if authorization.startswith("Bearer "):

        token_hash = hashlib.sha256(
            authorization[7:].strip().encode("utf-8")
        ).hexdigest()

        conn = db()
        conn.execute(
            "DELETE FROM sessions WHERE token_hash = ?",
            (token_hash,)
        )
        conn.commit()
        conn.close()

    return {"ok": True}


@app.get("/auth/me")
def me(user=Depends(current_user)):
    return {"user": public_user(user)}


# ---------------------------------------------------------
# TRIP ROUTES
# ---------------------------------------------------------

@app.post("/trips")
def save_trip(data: SaveTripRequest, user=Depends(current_user)):

    conn = db()

    cursor = conn.execute(
        "INSERT INTO trips "
        "(user_id, from_location, destination, start_date, end_date, "
        "people, total_cost, selection, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            user["id"],
            data.from_location.strip(),
            data.destination.strip(),
            data.start_date,
            data.end_date,
            data.people,
            data.total_cost,
            json.dumps(data.selection) if data.selection else None,
            now_utc().isoformat()
        )
    )

    conn.commit()
    trip_id = cursor.lastrowid
    conn.close()

    return {"id": trip_id, "saved": True}


@app.get("/trips")
def list_trips(user=Depends(current_user)):

    conn = db()

    rows = conn.execute(
        "SELECT * FROM trips WHERE user_id = ? ORDER BY id DESC",
        (user["id"],)
    ).fetchall()

    conn.close()

    trips = []

    for row in rows:
        trips.append({
            "id": row["id"],
            "from_location": row["from_location"],
            "destination": row["destination"],
            "start_date": row["start_date"],
            "end_date": row["end_date"],
            "people": row["people"],
            "total_cost": row["total_cost"],
            "selection": (
                json.loads(row["selection"])
                if row["selection"] else None
            ),
            "created_at": row["created_at"]
        })

    return {"trips": trips}


@app.delete("/trips/{trip_id}")
def delete_trip(trip_id: int, user=Depends(current_user)):

    conn = db()

    cursor = conn.execute(
        "DELETE FROM trips WHERE id = ? AND user_id = ?",
        (trip_id, user["id"])
    )

    conn.commit()
    deleted = cursor.rowcount
    conn.close()

    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="Trip not found."
        )

    return {"deleted": True}

@app.put("/trips/{trip_id}")
def update_trip(
    trip_id: int,
    data: SaveTripRequest,
    user=Depends(current_user)
):

    conn = db()

    cursor = conn.execute(
        "UPDATE trips SET "
        "from_location = ?, destination = ?, start_date = ?, "
        "end_date = ?, people = ?, total_cost = ?, selection = ? "
        "WHERE id = ? AND user_id = ?",
        (
            data.from_location.strip(),
            data.destination.strip(),
            data.start_date,
            data.end_date,
            data.people,
            data.total_cost,
            json.dumps(data.selection) if data.selection else None,
            trip_id,
            user["id"]
        )
    )

    conn.commit()
    updated = cursor.rowcount
    conn.close()

    if not updated:
        raise HTTPException(
            status_code=404,
            detail="Trip not found."
        )

    return {"id": trip_id, "saved": True}

# ---------------------------------------------------------
# TRIP EXPENSES
# ---------------------------------------------------------

EXPENSE_CATEGORIES = {"local_transport", "food", "tourism", "shopping"}


def trip_belongs_to_user(conn, trip_id, user_id):
    row = conn.execute(
        "SELECT id FROM trips WHERE id = ? AND user_id = ?",
        (trip_id, user_id)
    ).fetchone()
    return row is not None


@app.get("/trips/{trip_id}/expenses")
def list_expenses(trip_id: int, user=Depends(current_user)):

    conn = db()

    if not trip_belongs_to_user(conn, trip_id, user["id"]):
        conn.close()
        raise HTTPException(status_code=404, detail="Trip not found.")

    rows = conn.execute(
        "SELECT id, category, amount, note, created_at "
        "FROM expenses WHERE trip_id = ? AND user_id = ? "
        "ORDER BY id DESC",
        (trip_id, user["id"])
    ).fetchall()

    conn.close()

    return {"expenses": [dict(row) for row in rows]}


@app.post("/trips/{trip_id}/expenses")
def add_expense(
    trip_id: int,
    data: ExpenseRequest,
    user=Depends(current_user)
):

    if data.category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category.")

    if not (0 < data.amount <= 10_000_000):
        raise HTTPException(
            status_code=400,
            detail="Enter a valid amount."
        )

    conn = db()

    if not trip_belongs_to_user(conn, trip_id, user["id"]):
        conn.close()
        raise HTTPException(status_code=404, detail="Trip not found.")

    created = now_utc().isoformat()

    cursor = conn.execute(
        "INSERT INTO expenses "
        "(trip_id, user_id, category, amount, note, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            trip_id,
            user["id"],
            data.category,
            round(data.amount, 2),
            data.note.strip()[:120],
            created
        )
    )

    conn.commit()
    expense_id = cursor.lastrowid
    conn.close()

    return {
        "id": expense_id,
        "category": data.category,
        "amount": round(data.amount, 2),
        "note": data.note.strip()[:120],
        "created_at": created
    }


@app.delete("/trips/{trip_id}/expenses/{expense_id}")
def delete_expense(
    trip_id: int,
    expense_id: int,
    user=Depends(current_user)
):

    conn = db()

    cursor = conn.execute(
        "DELETE FROM expenses "
        "WHERE id = ? AND trip_id = ? AND user_id = ?",
        (expense_id, trip_id, user["id"])
    )

    conn.commit()
    deleted = cursor.rowcount
    conn.close()

    if not deleted:
        raise HTTPException(status_code=404, detail="Expense not found.")

    return {"deleted": True}

# =========================================================
# MODELS
# =========================================================

class TripRequest(BaseModel):
    from_location: str
    destination: str
    start_date: str
    end_date: str
    people: int

class AttractionPoint(BaseModel):
    name: str
    latitude: float
    longitude: float


class PlaceRouteRequest(BaseModel):
    hotel_name: str
    hotel_latitude: float
    hotel_longitude: float
    places: list[AttractionPoint]

class GroundTransportRequest(BaseModel):
    from_location: str
    destination: str
    journey_date: str
    people: int

class WeatherAdviceRequest(BaseModel):
    destination: str
    daily_forecast: dict
    transport_mode: Optional[str] = None

# =========================================================
# BASIC
# =========================================================

@app.get("/")
def home():
    return {"message": "ROAMLY backend is working!"}


# =========================================================
# LOCATION / ROUTE HELPERS
# =========================================================

def get_coordinates(place):
    url = "https://nominatim.openstreetmap.org/search"

    params = {
        "q": place,
        "format": "jsonv2",
        "limit": 1
    }

    headers = {
        "User-Agent": "ROAMLY-AI-Travel-Planner/1.0"
    }

    try:
        response = requests.get(
            url,
            params=params,
            headers=headers,
            timeout=15
        )
        response.raise_for_status()
        data = response.json()
    except requests.RequestException:
        return None

    if not data:
        return None

    return {
        "latitude": float(data[0]["lat"]),
        "longitude": float(data[0]["lon"])
    }


# =========================================================
# WEATHER FORECAST
# =========================================================

@app.get("/weather")
def get_weather(
    destination: str,
    start_date: str,
    end_date: str
):

    # Validate dates
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError:
        return {"error": "Invalid travel dates."}

    if end < start:
        return {"error": "End date cannot be before start date."}

    # Open-Meteo supports forecasts up to 16 days.
    today = date.today()
    last_forecast_date = today + timedelta(days=15)

    if end < today:
        return {
            "available": False,
            "message": "These travel dates are in the past. A live forecast is unavailable."
        }

    if start > last_forecast_date:
        return {
            "available": False,
            "message": "Weather forecasts are not available this far in advance. Check again closer to your trip."
        }

    # Use existing ROAMLY location search
    coordinates = get_coordinates(destination)

    if coordinates is None:
        return {"error": "Could not identify the destination location."}

    # Fetch actual weather forecast
    url = "https://api.open-meteo.com/v1/forecast"

    params = {
        "latitude": coordinates["latitude"],
        "longitude": coordinates["longitude"],
        "daily": (
            "weather_code,"
            "temperature_2m_max,"
            "temperature_2m_min,"
            "precipitation_probability_max,"
            "precipitation_sum,"
            "wind_speed_10m_max"
        ),
        "start_date": max(start, today).isoformat(),
        "end_date": end.isoformat(),
        "timezone": "auto"
    }

    try:
        response = requests.get(
            url,
            params=params,
            timeout=20
        )
        response.raise_for_status()
        weather_data = response.json()

    except requests.RequestException:
        return {"error": "Weather service is temporarily unavailable."}

    return {
        "available": True,
        "destination": destination,
        "latitude": coordinates["latitude"],
        "longitude": coordinates["longitude"],
        "daily": weather_data.get("daily", {}),
        "units": weather_data.get("daily_units", {}),
        "source": "Open-Meteo"
    }

# =========================================================
# AI WEATHER-BASED TRAVEL ADVICE
# =========================================================

@app.post("/weather-advice")
def generate_weather_advice(request: WeatherAdviceRequest):

    from huggingface_hub import InferenceClient

    token = os.getenv("HF_TOKEN")

    if not token:
        return {
            "error": "HF_TOKEN is not available to the FastAPI server."
        }

    try:

        client = InferenceClient(api_key=token)

        prompt = f"""
You are ROAMLY, an intelligent AI travel assistant.

Analyze the actual weather forecast below and give practical
recommendations for the traveller.

Destination: {request.destination}
Selected transport: {request.transport_mode or "Not specified"}

Actual daily weather forecast:
{json.dumps(request.daily_forecast, ensure_ascii=False)}

Give advice under these three headings:

1. TRANSPORT
- Suggest suitable ways to travel based on the forecast.
- Explain when walking, cycling or road travel may be inconvenient.
- Consider the selected transport mode where relevant.
- Do not claim that roads or transport services are closed.

2. SIGHTSEEING
- Suggest whether outdoor sightseeing is suitable.
- Recommend prioritizing indoor activities when weather conditions
  make outdoor visits less comfortable.
- Suggest suitable times of day when supported by the forecast.

3. DAILY TRAVEL TIPS
- Give practical suggestions based on the forecast.
- Mention useful items to carry, such as an umbrella, sunscreen
  or water, only when relevant.
- Mention any weather-related precautions.

IMPORTANT:
- Base every recommendation on the supplied forecast.
- Do not invent weather conditions or forecast details.
- Do not invent attraction names, closures or transport disruptions.
- Keep the advice concise, specific and easy to follow.
- If forecast information is missing, clearly say so.

Return only the recommendations with the three headings.
"""

        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        )

        return {
            "destination": request.destination,
            "advice": response.choices[0].message.content
        }

    except Exception as e:

        return {
            "error": str(e)
        }

def get_road_route(from_location, destination):
    start = get_coordinates(from_location)
    end = get_coordinates(destination)

    if start is None or end is None:
        return None

    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{start['longitude']},{start['latitude']};"
        f"{end['longitude']},{end['latitude']}"
    )

    try:
        response = requests.get(
            url,
            params={"overview": "false"},
            timeout=15
        )
        response.raise_for_status()
        data = response.json()
    except requests.RequestException:
        return None

    if data.get("code") != "Ok" or not data.get("routes"):
        return None

    route = data["routes"][0]

    return {
        "distance_km": route["distance"] / 1000,
        "duration_hours": route["duration"] / 3600
    }


@app.post("/plan-trip")
def plan_trip(trip: TripRequest):

    try:
        start = date.fromisoformat(
            trip.start_date
        )

        end = date.fromisoformat(
            trip.end_date
        )

    except ValueError:

        return {
            "error": "Please enter valid trip dates."
        }

    if end <= start:

        return {
            "error": "End date must be after start date."
        }

    if trip.people < 1:

        return {
            "error": "Number of travelers must be at least 1."
        }

    return {
        "message": "Trip details accepted.",
        "trip": {
            "from_location": trip.from_location,
            "destination": trip.destination,
            "start_date": trip.start_date,
            "end_date": trip.end_date,
            "people": trip.people
        }
    }

# =========================================================
# GROUND TRANSPORT
# =========================================================

def railradar_headers():
    api_key = os.getenv("RAILRADAR_KEY")

    if not api_key:
        return None

    return {
        "Authorization": f"Bearer {api_key}"
    }

def find_railway_station(place):
    """
    Find a suitable railway station for a city/place.

    Common cities use known major station codes.
    Other locations use RailRadar station search.
    """

    common_stations = {
        "lucknow": {
            "code": "LKO",
            "name": "Lucknow Jn",
            "city": "Lucknow"
        },
        "lucknow jn": {
            "code": "LKO",
            "name": "Lucknow Jn",
            "city": "Lucknow"
        },
        "delhi": {
            "code": "NDLS",
            "name": "New Delhi",
            "city": "Delhi"
        },
        "new delhi": {
            "code": "NDLS",
            "name": "New Delhi",
            "city": "Delhi"
        },
        "mumbai": {
            "code": "MMCT",
            "name": "Mumbai Central",
            "city": "Mumbai"
        },
        "kolkata": {
            "code": "HWH",
            "name": "Howrah Jn",
            "city": "Kolkata"
        },
        "howrah": {
            "code": "HWH",
            "name": "Howrah Jn",
            "city": "Kolkata"
        },
        "jaipur": {
            "code": "JP",
            "name": "Jaipur Jn",
            "city": "Jaipur"
        },
        "agra": {
            "code": "AGC",
            "name": "Agra Cantt",
            "city": "Agra"
        },
        "kanpur": {
            "code": "CNB",
            "name": "Kanpur Central",
            "city": "Kanpur"
        },
        "prayagraj": {
            "code": "PRYJ",
            "name": "Prayagraj Jn",
            "city": "Prayagraj"
        },
        "allahabad": {
            "code": "PRYJ",
            "name": "Prayagraj Jn",
            "city": "Prayagraj"
        },
        "varanasi": {
            "code": "BSB",
            "name": "Varanasi Jn",
            "city": "Varanasi"
        },
        "bengaluru": {
            "code": "SBC",
            "name": "KSR Bengaluru City",
            "city": "Bengaluru"
        },
        "bangalore": {
            "code": "SBC",
            "name": "KSR Bengaluru City",
            "city": "Bengaluru"
        },
        "chennai": {
            "code": "MAS",
            "name": "MGR Chennai Central",
            "city": "Chennai"
        },
        "hyderabad": {
            "code": "SC",
            "name": "Secunderabad Jn",
            "city": "Hyderabad"
        },
        "secunderabad": {
            "code": "SC",
            "name": "Secunderabad Jn",
            "city": "Hyderabad"
        },
        "pune": {
            "code": "PUNE",
            "name": "Pune Jn",
            "city": "Pune"
        },
        "ahmedabad": {
            "code": "ADI",
            "name": "Ahmedabad Jn",
            "city": "Ahmedabad"
        },
        "bhopal": {
            "code": "BPL",
            "name": "Bhopal Jn",
            "city": "Bhopal"
        },
        "indore": {
            "code": "INDB",
            "name": "Indore Jn",
            "city": "Indore"
        },
        "ujjain": {
            "code": "UJN",
            "name": "Ujjain Jn",
            "city": "Ujjain"
        },
        "gorakhpur": {
            "code": "GKP",
            "name": "Gorakhpur Jn",
            "city": "Gorakhpur"
        },
        "nagpur": {
            "code": "NGP",
            "name": "Nagpur",
            "city": "Nagpur"
        }
    }

    place_clean = place.strip().lower()

    if place_clean in common_stations:
        return common_stations[place_clean]

    headers = railradar_headers()

    if not headers:
        return None

    try:

        response = requests.get(
            "https://api.railradar.in/v1/lookup/search/stations",
            params={
                "q": place,
                "limit": 10
            },
            headers=headers,
            timeout=15
        )

        response.raise_for_status()

        data = response.json()

        stations = data.get(
            "data",
            []
        )

        if not stations:
            return None

        place_clean = place.strip().lower()

        for station in stations:

            station_name = str(
                station.get(
                    "name",
                    ""
                )
            ).strip().lower()

            station_city = str(
                station.get(
                    "city",
                    ""
                )
            ).strip().lower()

            if (
                place_clean == station_name
                or place_clean == station_city
            ):
                return station

        return stations[0]

    except Exception as e:

        print(
            "Station search error:",
            e
        )

        return None


@app.post("/ground-transport")
def ground_transport(request: GroundTransportRequest):

    from_location = request.from_location.strip()
    destination = request.destination.strip()

    # =====================================================
    # TRAIN STATION DETAILS ONLY
    # No live train fare or class fare fetching.
    # =====================================================

    source_station = find_railway_station(from_location)
    destination_station = find_railway_station(destination)

    station_details = {
        "departure": None,
        "arrival": None
    }

    train_error = None

    if source_station:
        station_details["departure"] = {
            "name": source_station.get("name"),
            "code": source_station.get("code"),
            "city": source_station.get("city") or from_location
        }

    if destination_station:
        station_details["arrival"] = {
            "name": destination_station.get("name"),
            "code": destination_station.get("code"),
            "city": destination_station.get("city") or destination
        }

    if not source_station:
        train_error = (
            f"Could not find a railway station for {from_location}."
        )

    elif not destination_station:
        train_error = (
            f"Could not find a railway station for {destination}."
        )

    # =====================================================
    # CAR — ROAD ROUTE + FUEL COST ESTIMATOR
    # =====================================================

    route = get_road_route(from_location, destination)

    if route is not None:
        distance_km = round(route["distance_km"], 2)
        driving_hours = round(route["duration_hours"], 2)
        route_error = None
    else:
        distance_km = None
        driving_hours = None
        route_error = "Could not calculate the road route."

    directions_url = (
        "https://www.google.com/maps/dir/?api=1"
        f"&origin={quote_plus(from_location)}"
        f"&destination={quote_plus(destination)}"
        "&travelmode=driving"
    )

    # =====================================================
    # FUEL PRICE
    # =====================================================

    petrol_price = None
    fuel_source = "manual"
    fuel_location = from_location
    fuel_updated_at = None
    fuel_error = None

    api_mitra_key = os.getenv("APIMITRA_KEY")

    if api_mitra_key:
        try:
            fuel_response = requests.get(
                "https://api.apimitra.in/fuel",
                params={"city": from_location},
                headers={"x-api-key": api_mitra_key},
                timeout=10
            )

            fuel_response.raise_for_status()
            fuel_data = fuel_response.json()

            price_data = fuel_data.get("price", {})
            petrol_data = price_data.get("petrol", {})
            candidate_price = petrol_data.get("price")

            if candidate_price is not None:
                candidate_price = float(candidate_price)

                if candidate_price > 0:
                    petrol_price = candidate_price
                    fuel_source = "API Mitra"
                    fuel_location = (
                        price_data.get("location")
                        or from_location
                    )
                    fuel_updated_at = (
                        fuel_data.get("fetched_at")
                        or fuel_data.get("updated_at")
                    )
                else:
                    fuel_error = (
                        "The API returned an invalid petrol price."
                    )
            else:
                fuel_error = (
                    "Live petrol price was not included in the API response."
                )

        except (requests.RequestException, ValueError, TypeError) as e:
            fuel_error = "Live petrol price is currently unavailable."
            print("ROAMLY fuel price error:", e)

    else:
        fuel_error = (
            "APIMITRA_KEY is not configured. "
            "Enter the fuel price manually."
        )

    # =====================================================
    # FINAL TRANSPORT OPTIONS
    # =====================================================

    options = [{
        "mode": "Car",
        "icon": "🚗",
        "name": "Personal car",
        "data_type": "Estimated fuel cost",

        "distance_km": distance_km,
        "estimated_time": driving_hours,
        "route_error": route_error,
        "directions_url": directions_url,

        "fuel_price": petrol_price,
        "fuel_source": fuel_source,
        "fuel_location": fuel_location,
        "fuel_updated_at": fuel_updated_at,
        "fuel_error": fuel_error,

        "mileage_min": 10,
        "mileage_average": 15,
        "mileage_max": 25,
        "cost": None
    }]

    # =====================================================
    # RESPONSE
    # =====================================================

    return {
        "options": options,

        # Frontend uses these details to create the station card.
        "station_details": station_details,

        "train_error": train_error,

        # No live train fare options are returned.
        "train_count": 0,

        "data_type": (
            "Railway station details + calculated car estimate"
        )
    }




# =========================================================
# HOTELS — REAL DATA VIA SERPAPI GOOGLE HOTELS
# =========================================================

@app.get("/hotels")
def hotel_options(
    destination: str,
    start_date: str,
    end_date: str,
    people: int
):
    """
    Search real hotels using SerpApi Google Hotels.
    """

    api_key = os.getenv("SERPAPI_KEY")

    if not api_key:
        return {
            "success": False,
            "error": "SERPAPI_KEY is not available."
        }

    if people < 1:
        return {
            "success": False,
            "error": "Number of travelers must be at least 1."
        }

    try:

        import requests

        # =====================================================
        # SERPAPI GOOGLE HOTELS REQUEST
        # =====================================================

        params = {
            "engine": "google_hotels",
            "q": destination,
            "check_in_date": start_date,
            "check_out_date": end_date,
            "adults": people,
            "children": 0,
            "currency": "INR",
            "gl": "in",
            "hl": "en",
            "sort_by": "3",
            "api_key": api_key
        }

        response = requests.get(
            "https://serpapi.com/search.json",
            params=params,
            timeout=30,
            verify=False
        )

        response.raise_for_status()

        results = response.json()


        # =====================================================
        # CHECK SERPAPI ERROR
        # =====================================================

        if results.get("error"):

            return {
                "success": False,
                "error": results["error"]
            }


        # =====================================================
        # GET HOTEL PROPERTIES
        # =====================================================

        properties = results.get(
            "properties",
            []
        )

        hotels = []


        # =====================================================
        # PROCESS HOTELS
        # =====================================================

        for hotel in properties[:20]:

            gps = hotel.get(
                "gps_coordinates",
                {}
            )

            rate_per_night = hotel.get(
                "rate_per_night",
                {}
            )

            total_rate = hotel.get(
                "total_rate",
                {}
            )

            prices = hotel.get(
                "prices",
                []
            )

            booking_sources = []


            # =================================================
            # BOOKING SOURCES
            # =================================================

            for price_source in prices:

                source_name = price_source.get(
                    "source"
                )

                source_link = price_source.get(
                    "link"
                )

                source_rate = price_source.get(
                    "rate_per_night",
                    {}
                )

                if source_name or source_link:

                    booking_sources.append({

                        "source":
                            source_name,

                        "link":
                            source_link,

                        "price_per_night":
                            source_rate.get(
                                "extracted_lowest"
                            )

                    })


            # =================================================
            # SAVE HOTEL
            # =================================================

            hotels.append({

                "name":
                    hotel.get(
                        "name",
                        "Hotel"
                    ),

                "address":
                    hotel.get(
                        "address"
                    ),

                "description":
                    hotel.get(
                        "description"
                    ),

                "hotel_class":
                    hotel.get(
                        "hotel_class"
                    ),

                "rating":
                    hotel.get(
                        "overall_rating"
                    ),

                "reviews":
                    hotel.get(
                        "reviews"
                    ),

                "amenities":
                    hotel.get(
                        "amenities",
                        []
                    ),

                "latitude":
                    gps.get(
                        "latitude"
                    ),

                "longitude":
                    gps.get(
                        "longitude"
                    ),

                "check_in_time":
                    hotel.get(
                        "check_in_time"
                    ),

                "check_out_time":
                    hotel.get(
                        "check_out_time"
                    ),

                "price_per_night":
                    rate_per_night.get(
                        "extracted_lowest"
                    ),

                "price_per_night_display":
                    rate_per_night.get(
                        "lowest"
                    ),

                "total_price":
                    total_rate.get(
                        "extracted_lowest"
                    ),

                "total_price_display":
                    total_rate.get(
                        "lowest"
                    ),

                "property_token":
                    hotel.get(
                        "property_token"
                    ),

                "hotel_website":
                    hotel.get(
                        "link"
                    ),

                "booking_sources":
                    booking_sources,

                "details_api_url":
                    hotel.get(
                        "serpapi_property_details_link"
                    )

            })


        # =====================================================
        # RETURN RESULTS
        # =====================================================

        return {

            "success":
                True,

            "destination":
                destination,

            "start_date":
                start_date,

            "end_date":
                end_date,

            "people":
                people,

            "count":
                len(hotels),

            "hotels":
                hotels,

            "data_type":
                "Live hotel data from Google Hotels via SerpApi"

        }


    except Exception as e:

        print(
            "Hotel search error:",
            e
        )

        return {

            "success":
                False,

            "error":
                str(e)

        }


# =========================================================
# HOTEL ROOMS / LIVE ROOM PRICES
# =========================================================

@app.get("/hotel-rooms")
def hotel_rooms(
    property_token: str,
    destination: str,
    start_date: str,
    end_date: str,
    people: int
):
    """
    Fetch detailed live information for one hotel.

    Uses the property_token returned by /hotels.
    Returns room types, live prices and booking links.
    """

    api_key = os.getenv("SERPAPI_KEY")

    if not api_key:
        return {
            "success": False,
            "error": "SERPAPI_KEY is not available."
        }

    if not property_token:
        return {
            "success": False,
            "error": "Hotel property token is required."
        }

    if people < 1:
        return {
            "success": False,
            "error": "Number of travelers must be at least 1."
        }

    try:
        from serpapi import Client

        client = Client(api_key=api_key)

        results = client.search(
            {
                "engine": "google_hotels",
                "q": destination,
                "property_token": property_token,
                "check_in_date": start_date,
                "check_out_date": end_date,
                "adults": people,
                "children": 0,
                "currency": "INR",
                "gl": "in",
                "hl": "en"
            }
        )

        rooms = []

        featured_prices = results.get(
            "featured_prices",
            []
        )

        for source in featured_prices:

            source_name = source.get(
                "source",
                "Booking source"
            )

            source_link = source.get(
                "link"
            )

            source_rooms = source.get(
                "rooms",
                []
            )

            for room in source_rooms:

                room_rate_per_night = room.get(
                    "rate_per_night",
                    {}
                )

                room_total_rate = room.get(
                    "total_rate",
                    {}
                )

                rooms.append({
                    "room_name": room.get(
                        "name",
                        "Room"
                    ),

                    "source": source_name,

                    "booking_url": (
                        room.get("link")
                        or source_link
                    ),

                    "guests": room.get(
                        "num_guests"
                    ),

                    "price_per_night": (
                        room_rate_per_night.get(
                            "extracted_lowest"
                        )
                    ),

                    "price_per_night_display": (
                        room_rate_per_night.get(
                            "lowest"
                        )
                    ),

                    "total_price": (
                        room_total_rate.get(
                            "extracted_lowest"
                        )
                    ),

                    "total_price_display": (
                        room_total_rate.get(
                            "lowest"
                        )
                    )
                })

        return {
            "success": True,
            "property_token": property_token,
            "start_date": start_date,
            "end_date": end_date,
            "people": people,
            "rooms": rooms,
            "room_count": len(rooms),
            "data_type": "Live room and price data from Google Hotels via SerpApi"
        }

    except Exception as e:

        print(
            "Hotel room search error:",
            e
        )

        return {
            "success": False,
            "error": str(e)
        }

# =========================================================
# PLACES
# =========================================================

# =========================================================
# PLACES / ATTRACTIONS
# =========================================================

@app.get("/places")
def places_to_visit(destination: str):

    location = get_coordinates(destination)

    if location is None:
        return {
            "success": False,
            "error": "Could not find destination."
        }

    latitude = location["latitude"]
    longitude = location["longitude"]

    serpapi_key = os.getenv("SERPAPI_KEY")

    if not serpapi_key:
        return {
            "success": False,
            "error": "SERPAPI_KEY is missing."
        }

    params = {
        "engine": "google_maps",
        "type": "search",
        "q": f"top tourist attractions in {destination}",
        "ll": f"@{latitude},{longitude},12z",
        "api_key": serpapi_key,
        "hl": "en",
        "start": 0
    }

    try:

        response = requests.get(
            "https://serpapi.com/search.json",
            params=params,
            timeout=30,
            verify=False
        )

        response.raise_for_status()

        data = response.json()

    except requests.RequestException as e:

        print("SerpApi attraction request failed:")
        print(e)

        return {
            "success": False,
            "error": "Could not fetch attraction data.",
            "details": str(e)
        }

    except ValueError as e:

        print("Invalid SerpApi response:")
        print(e)

        return {
            "success": False,
            "error": "Invalid attraction data received.",
            "details": str(e)
        }

    if data.get("error"):

        print("SerpApi returned an error:")
        print(data["error"])

        return {
            "success": False,
            "error": data["error"]
        }

    places = []

    for place in data.get("local_results", []):

        gps = place.get("gps_coordinates", {})

        place_latitude = gps.get("latitude")
        place_longitude = gps.get("longitude")

        if (
            place_latitude is None
            or place_longitude is None
        ):
            continue

        places.append({
            "name": place.get(
                "title",
                "Unknown attraction"
            ),

            "type": place.get(
                "type",
                "Tourist attraction"
            ),

            "latitude": place_latitude,

            "longitude": place_longitude,

            "rating": place.get(
                "rating"
            ),

            "reviews": place.get(
                "reviews"
            ),

            "fee": place.get(
                "price",
                "Not available"
            ),

            "opening_hours": place.get(
                "hours",
                "Not available"
            ),

            "description": place.get(
                "description",
                ""
            ),

            "address": place.get(
                "address",
                ""
            ),

            "website": place.get(
                "website",
                ""
            ),

            "google_maps_link": place.get(
                "links",
                {}
            ).get(
                "directions",
                ""
            )
        })

    if not places:

        return {
            "success": False,
            "error": (
                "No real tourist attractions "
                f"were found in {destination}."
            )
        }

    return {
        "success": True,
        "destination": destination,
        "count": len(places),
        "places": places[:20]
    }


# =========================================================
# FOOD NEARBY — RESTAURANTS VIA SERPAPI GOOGLE MAPS
# =========================================================

@app.get("/food")
def food_nearby(
    destination: str,
    near: str = "",
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    veg_only: bool = False
):
    api_key = os.getenv("SERPAPI_KEY")

    if not api_key:
        return {"error": "SERPAPI_KEY is missing."}

    # Prefer the exact hotel/attraction coordinates.
    if latitude is not None and longitude is not None:
        center = {
            "latitude": latitude,
            "longitude": longitude
        }
        located_by = "coordinates"
    else:
        # Fall back to the supplied address or destination.
        search_location = near.strip() or destination

        center = get_coordinates(search_location)

        if center is None:
            return {"error": "Could not identify the food search location."}

        located_by = "nearby" if near.strip() else "destination"

    search_area = near.strip() or destination

    query = (
        f"vegetarian restaurants near {search_area}"
        if veg_only
        else f"restaurants near {search_area}"
    )

    params = {
        "engine": "google_maps",
        "type": "search",
        "q": query,
        "ll": (
            f"@{center['latitude']},"
            f"{center['longitude']},15z"
        ),
        "api_key": api_key,
        "hl": "en"
    }

    try:
        response = requests.get(
            "https://serpapi.com/search.json",
            params=params,
            timeout=30
        )

        response.raise_for_status()
        data = response.json()

    except requests.RequestException as e:
        print("Food search error:", e)
        return {"error": "Could not fetch nearby restaurants."}

    if data.get("error"):
        return {"error": data["error"]}

    restaurants = []

    def calculate_distance(lat1, lon1, lat2, lon2):
        earth_radius = 6371

        d_lat = math.radians(lat2 - lat1)
        d_lon = math.radians(lon2 - lon1)

        a = (
            math.sin(d_lat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(d_lon / 2) ** 2
        )

        return 2 * earth_radius * math.asin(
            math.sqrt(a)
        )

    for place in data.get("local_results", []):

        gps = place.get("gps_coordinates") or {}

        lat = gps.get("latitude")
        lon = gps.get("longitude")

        if lat is None or lon is None:
            continue

        distance = calculate_distance(
            center["latitude"],
            center["longitude"],
            float(lat),
            float(lon)
        )

        # Keep restaurants within 2.5 km.
        if distance > 2.5:
            continue

        links = place.get("links") or {}

        maps_link = links.get("directions") or (
            "https://www.google.com/maps/search/?api=1&query="
            + quote_plus(place.get("title", "Restaurant"))
        )

        restaurants.append({
            "name": place.get("title", "Restaurant"),
            "rating": place.get("rating", "Not available"),
            "reviews": place.get("reviews", 0),
            "price": place.get("price", ""),
            "distance_km": round(distance, 2),
            "type": place.get("type", "Restaurant"),
            "address": place.get("address", ""),
            "maps_link": maps_link
        })

    # Highest-rated places first.
    restaurants.sort(
        key=lambda r: (
            float(r["rating"])
            if isinstance(r["rating"], (int, float))
            else 0,
            -r["distance_km"]
        ),
        reverse=True
    )

    return {
        "success": True,
        "located_by": located_by,
        "count": len(restaurants),
        "restaurants": restaurants[:15]
    }


@app.post("/optimize-place-route")
def optimize_place_route(request: PlaceRouteRequest):

    places = request.places[:20]

    if not places:
        return {
            "success": False,
            "error": "No attractions were provided for route optimization."
        }

    # Hotel is always the starting point.
    coordinates = [
        f"{request.hotel_longitude},{request.hotel_latitude}"
    ]

    for place in places:
        coordinates.append(
            f"{place.longitude},{place.latitude}"
        )

    coordinate_string = ";".join(coordinates)

    # Get real driving distances and durations between all points.
    table_url = (
        "https://router.project-osrm.org/table/v1/driving/"
        f"{coordinate_string}"
    )

    try:
        table_response = requests.get(
            table_url,
            params={
                "annotations": "distance,duration"
            },
            timeout=30
        )

        table_response.raise_for_status()
        table_data = table_response.json()

    except requests.RequestException as e:
        print("OSRM table request failed:", e)

        return {
            "success": False,
            "error": "Could not calculate road travel times."
        }

    if (
        table_data.get("code") != "Ok"
        or not table_data.get("durations")
    ):
        return {
            "success": False,
            "error": "Road travel data is unavailable for these locations."
        }

    durations = table_data["durations"]
    distances = table_data["distances"]

    # Greedy nearest-next-stop optimization.
    # Start at hotel (index 0), then repeatedly choose
    # the unvisited attraction with the shortest driving time.
    current = 0
    unvisited = set(range(1, len(coordinates)))

    ordered_indices = []
    total_distance = 0
    total_duration = 0

    while unvisited:

        possible_stops = [
            index
            for index in unvisited
            if durations[current][index] is not None
            and distances[current][index] is not None
        ]

        if not possible_stops:
            break

        next_stop = min(
            possible_stops,
            key=lambda index: durations[current][index]
        )

        total_duration += durations[current][next_stop]
        total_distance += distances[current][next_stop]

        ordered_indices.append(next_stop)
        unvisited.remove(next_stop)

        current = next_stop

    if not ordered_indices:
        return {
            "success": False,
            "error": "No reachable attractions could be arranged into a route."
        }

    # Build the ordered attraction list.
    ordered_places = []

    for position, index in enumerate(ordered_indices, start=1):

        place = places[index - 1]

        ordered_places.append({
            "sequence": position,
            "name": place.name,
            "latitude": place.latitude,
            "longitude": place.longitude
        })

    # Request the complete road route in the optimized order.
    ordered_coordinates = [
        coordinates[0]
    ] + [
        coordinates[index]
        for index in ordered_indices
    ]

    route_url = (
        "https://router.project-osrm.org/route/v1/driving/"
        + ";".join(ordered_coordinates)
    )

    route_geometry = None

    try:
        route_response = requests.get(
            route_url,
            params={
                "overview": "full",
                "geometries": "geojson"
            },
            timeout=30
        )

        route_response.raise_for_status()
        route_data = route_response.json()

        if (
            route_data.get("code") == "Ok"
            and route_data.get("routes")
        ):
            route = route_data["routes"][0]

            total_distance = route["distance"]
            total_duration = route["duration"]

            route_geometry = route.get("geometry")

    except requests.RequestException as e:
        print("OSRM route request failed:", e)

    return {
        "success": True,
        "starting_point": request.hotel_name,
        "places": ordered_places,
        "total_places": len(ordered_places),
        "unreachable_places": len(unvisited),
        "total_distance_km": round(total_distance / 1000, 2),
        "total_travel_time_minutes": round(total_duration / 60),
        "route_geometry": route_geometry,
        "optimization": "Shortest-next-stop driving-time heuristic",
        "note": (
            "This is an optimized suggested sequence, "
            "not a guaranteed globally shortest route. "
            "Opening hours and attraction visit durations "
            "are not included."
        )
    }

# =========================================================
# LOCATION
# =========================================================

@app.get("/location")
def find_location(place: str):

    coordinates = get_coordinates(place)

    if coordinates is None:
        return {"error": "Location not found"}

    return {
        "place": place,
        "coordinates": coordinates
    }


# =========================================================
# ROUTE
# =========================================================

@app.get("/route")
def get_route(from_location: str, destination: str):

    route = get_road_route(from_location, destination)

    if route is None:
        return {"error": "Could not calculate route"}

    return {
        "from": from_location,
        "destination": destination,
        "distance_km": round(route["distance_km"], 2),
        "duration_hours": round(route["duration_hours"], 2)
    }


# =========================================================
# AI ITINERARY
# =========================================================

@app.post("/ai-itinerary")
def generate_ai_itinerary(trip: TripRequest):

    from huggingface_hub import InferenceClient

    token = os.getenv("HF_TOKEN")

    if not token:
        return {
            "error":
                "HF_TOKEN is not available to the FastAPI server."
        }

    try:

        client = InferenceClient(
            api_key=token
        )

        prompt = f"""
You are ROAMLY, an AI travel planning assistant.

Create a practical and personalized travel itinerary.

Trip details:
Starting location: {trip.from_location}
Destination: {trip.destination}
Start date: {trip.start_date}
End date: {trip.end_date}
Number of travelers: {trip.people}

Instructions:
- Create a day-by-day itinerary.
- Suggest suitable places to visit.
- Keep the plan realistic.
- Include morning, afternoon and evening suggestions.
- Do not invent exact ticket prices.
- Do not assume a user budget.
- Do not use travel preferences.

Return only the itinerary.
"""

        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        )

        return {
            "destination":
                trip.destination,

            "itinerary":
                response.choices[0].message.content
        }

    except Exception as e:

        return {
            "error": str(e)
        }

# =========================================================
# FLIGHTS — REAL SEARCH VIA SERPAPI
# =========================================================

@app.get("/flights")
def search_flights(
    from_airport: str,
    to_airport: str,
    outbound_date: str,
    return_date: Optional[str] = None,
    adults: int = 1
):

    import serpapi

    api_key = os.getenv("SERPAPI_KEY")

    if not api_key:
        return {"error": "SERPAPI_KEY is not available."}

    params = {
        "engine": "google_flights",
        "departure_id": from_airport,
        "arrival_id": to_airport,
        "outbound_date": outbound_date,
        "adults": adults,
        "currency": "INR",
        "hl": "en",
        "type": "2"          # 2 = one way
    }

    # Only a real return date makes it a round-trip search.
    if return_date:
        params["return_date"] = return_date
        params["type"] = "1"  # 1 = round trip

    try:
        client = serpapi.Client(api_key=api_key)
        return client.search(params)

    except Exception as e:
        return {"error": str(e)}

# =========================================================
# AI TRIP SUMMARY (MY TRIPS CARDS)
# =========================================================

def fmt_date(value):
    try:
        parsed = date.fromisoformat(str(value)[:10])
        return f"{parsed.day} {parsed.strftime('%b %Y')}"
    except ValueError:
        return str(value or "")


def split_datetime(value):
    """'2026-11-20 13:00' -> ('20 Nov 2026', '13:00')"""

    text = str(value or "").strip().replace("T", " ")

    if not text:
        return "", ""

    parts = text.split(" ")
    day = fmt_date(parts[0]) if len(parts[0]) >= 10 else ""
    clock = parts[1][:5] if len(parts) > 1 else ""

    return day, clock


def rupees(value):
    return "₹{:,.0f}".format(float(value or 0))

def describe_leg(leg, places, from_place, to_place, fallback_date):

    if not leg:
        return None

    mode = leg.get("mode") or "Transport"
    departure_point = ((places or {}).get("departure") or {}).get("name")

    return {
        "mode": mode,
        "date": fallback_date,
        "place": departure_point or from_place,
        "from": from_place,
        "to": to_place
    }


def build_trip_facts(row):

    selection = json.loads(row["selection"]) if row["selection"] else {}
    selection = selection or {}

    transport = selection.get("transport") or {}
    hotel = selection.get("hotel") or {}
    route = selection.get("route_details") or {}

    def places_for(leg, key):
        """Airport / station saved for this leg of the journey."""

        if not leg:
            return None

        is_flight = leg.get("mode") == "Flight"
        legs = route.get("flightLegs" if is_flight else "trainLegs") or {}

        found = legs.get(key)

        # Older saved trips only stored the departure details.
        if not found and key == "departure":
            found = route.get("flight" if is_flight else "train")

        return found

    start_text, end_text = row["start_date"], row["end_date"]

    try:
        nights = max(0, (
            date.fromisoformat(end_text) - date.fromisoformat(start_text)
        ).days)
    except ValueError:
        nights = 0

    departure = transport.get("departure") or (
        transport if transport.get("mode") else None
    )
    returning = transport.get("return")

    facts = {
        "trip": {
            "from": row["from_location"],
            "destination": row["destination"],
            "start": fmt_date(start_text),
            "end": fmt_date(end_text),
            "nights": nights,
            "days": nights + 1,
            "travelers": row["people"],
            "total_cost": round(row["total_cost"] or 0)
        },
        "departure": describe_leg(
            departure, places_for(departure, "departure"),
            row["from_location"], row["destination"], fmt_date(start_text)
        ),
        "return": describe_leg(
            returning, places_for(returning, "return"),
            row["destination"], row["from_location"], fmt_date(end_text)
        ),
        "hotel": None
    }

    if hotel.get("name"):
        facts["hotel"] = {
            "name": hotel["name"],
            "rooms": int(hotel.get("rooms") or 1),
            "check_in": fmt_date(start_text),
            "check_out": fmt_date(end_text),
            "nights": nights,
            "cost": round(float(hotel.get("price") or 0))
        }

    return facts


def leg_sentence(leg, intro):

    if not leg:
        return ""

    mode = leg["mode"]

    if mode in ("Flight", "Train"):
        return (
            f"{intro} board your {mode.lower()} on {leg['date']} "
            f"at {leg['place']}."
        )

    return (
        f"{intro} set out by {mode.lower()} from {leg['from']} "
        f"on {leg['date']}."
    )

def compose_trip_summary(facts):
    """Plain, fully factual summary. Also the fallback when AI is off."""

    trip = facts["trip"]
    hotel = facts["hotel"]
    lines = []

    lines.append(leg_sentence(facts["departure"], "You will"))

    if facts["return"]:
        lines.append(leg_sentence(
            facts["return"], "For your return, you will"
        ))

    if hotel:
        rooms = hotel["rooms"]

        lines.append(
            f"You have booked {rooms} room{'s' if rooms != 1 else ''} at "
            f"{hotel['name']} from {hotel['check_in']} to "
            f"{hotel['check_out']}."
        )

    lines = [line for line in lines if line]

    # Nothing selected yet: a short overview so the card is never empty.
    if not lines:
        lines.append(
            f"Your trip from {trip['from']} to {trip['destination']} runs "
            f"from {trip['start']} to {trip['end']} for "
            f"{trip['travelers']} traveler(s)."
        )

    return " ".join(lines)

def ai_text(prompt):
    token = os.getenv("HF_TOKEN")

    if not token:
        return None

    try:
        from huggingface_hub import InferenceClient

        client = InferenceClient(api_key=token)

        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[{"role": "user", "content": prompt}]
        )

        return (response.choices[0].message.content or "").strip()

    except Exception as e:
        print("AI summary failed:", e)
        return None


@app.get("/trips/{trip_id}/summary")
def trip_summary(trip_id: int, user=Depends(current_user)):

    conn = db()

    row = conn.execute(
        "SELECT * FROM trips WHERE id = ? AND user_id = ?",
        (trip_id, user["id"])
    ).fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Trip not found.")

    facts = build_trip_facts(row)

    # Regenerate only when the saved trip actually changed.
    facts_hash = hashlib.sha256(
        json.dumps({"v": 3, "facts": facts}, sort_keys=True).encode()
    ).hexdigest()

    if row["summary_hash"] == facts_hash and row["ai_summary"]:
        conn.close()
        return {"summary": row["ai_summary"], "ai_used": True}

    draft = compose_trip_summary(facts)

    prompt = (
        "You are ROAMLY, a friendly travel assistant.\n"
        "Rewrite the trip draft below as one short, warm summary of 3 to 5 "
        "sentences, addressed to the traveller as 'you'.\n"
        "Start directly with the first sentence of the draft. Do not add "
        "any introduction or greeting.\n"
        "Rules:\n"
        "- Keep every date, time, airport, name, room count and amount "
        "exactly as written in the draft.\n"
        "- Do not add any new facts, prices, times or places.\n"
        "- You may end with ONE short practical reminder that fits the "
        "chosen transport (for example arriving early at the airport or "
        "station).\n"
        "- Plain text only: no markdown, bullet points or emojis.\n\n"
        f"Draft:\n{draft}"
    )

    text = ai_text(prompt)

    # Accept the AI text only if it kept the key facts.
    must_keep = []

    if facts["hotel"]:
        must_keep.append(facts["hotel"]["name"])

    if facts["departure"] :
        must_keep.append(facts["departure"].get("place",""))

    if (
        text
        and len(text) < 1500
        and all(item.lower() in text.lower() for item in must_keep if item)
    ):
        conn.execute(
            "UPDATE trips SET ai_summary = ?, summary_hash = ? WHERE id = ?",
            (text, facts_hash, trip_id)
        )
        conn.commit()
        conn.close()

        return {"summary": text, "ai_used": True}

    conn.close()

    return {"summary": draft, "ai_used": False}