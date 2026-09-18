from dotenv import load_dotenv
import os
load_dotenv()

from fastapi import FastAPI
import requests
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import date


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TripRequest(BaseModel):
    from_location: str
    destination: str
    start_date: str
    end_date: str
    people: int
    budget: float
    preference: str


@app.get("/")
def home():
    return {"message": "AI Travel Planner is working!"}


@app.post("/plan-trip")
def plan_trip(trip: TripRequest):

    # Calculate number of days
    start = date.fromisoformat(trip.start_date)
    end = date.fromisoformat(trip.end_date)

    days = (end - start).days

    # Basic budget calculations
    budget_per_person = trip.budget / trip.people
    budget_per_day = trip.budget / days

    # Estimated budget distribution
    transport_budget = trip.budget * 0.30
    hotel_budget = trip.budget * 0.30
    food_budget = trip.budget * 0.20
    activities_budget = trip.budget * 0.15
    emergency_budget = trip.budget * 0.05
    total_estimated_cost = (
    transport_budget
    + hotel_budget
    + food_budget
    + activities_budget
    + emergency_budget
)

    return {
        "message": "Travel plan calculated successfully!",

        "trip": {
            "from": trip.from_location,
            "destination": trip.destination,
            "start_date": trip.start_date,
            "end_date": trip.end_date,
            "days": days,
            "people": trip.people,
            "budget": trip.budget,
            "budget_per_person": round(budget_per_person, 2),
            "budget_per_day": round(budget_per_day, 2),
            "preference": trip.preference
        },

        "estimated_cost": {
            "transport": round(transport_budget, 2),
            "hotel": round(hotel_budget, 2),
            "food": round(food_budget, 2),
            "activities": round(activities_budget, 2),
            "emergency": round(emergency_budget, 2),
            "total": round(total_estimated_cost, 2)
        }
    }
@app.get("/transport")
def transport_options(from_location: str, destination: str):

    # Get the road distance between the two locations
    start = get_coordinates(from_location)
    end = get_coordinates(destination)

    if start is None or end is None:
        return {
            "error": "Could not find one or both locations"
        }

    # OSRM route
    url = (
        f"https://router.project-osrm.org/route/v1/driving/"
        f"{start['longitude']},{start['latitude']};"
        f"{end['longitude']},{end['latitude']}"
    )

    response = requests.get(
        url,
        params={"overview": "false"},
        timeout=15
    )

    if response.status_code != 200:
        return {
            "error": "Could not calculate route"
        }

    route_data = response.json()

    if route_data["code"] != "Ok":
        return {
            "error": "Could not calculate route"
        }

    route = route_data["routes"][0]

    distance_km = route["distance"] / 1000
    driving_hours = route["duration"] / 3600

    # Estimated transportation costs
    train_cost = round(distance_km * 4)
    bus_cost = round(distance_km * 3)
    car_cost = round(distance_km * 8)

    # Rough travel-time estimates
    train_hours = round(driving_hours * 1.3, 1)
    bus_hours = round(driving_hours * 1.4, 1)

    # For longer distances, flying becomes an option
    options = [
        {
            "mode": "Train",
            "icon": "🚆",
            "estimated_cost": train_cost,
            "estimated_time": f"{train_hours} hours",
            "data_type": "Estimated"
        },
        {
            "mode": "Bus",
            "icon": "🚌",
            "estimated_cost": bus_cost,
            "estimated_time": f"{bus_hours} hours",
            "data_type": "Estimated"
        },
        {
            "mode": "Car",
            "icon": "🚗",
            "estimated_cost": car_cost,
            "estimated_time": f"{round(driving_hours, 1)} hours",
            "data_type": "Estimated"
        }
    ]

    # Add flight option for long-distance trips
    if distance_km > 500:

        flight_cost = round(2500 + distance_km * 3)

        options.append({
            "mode": "Flight",
            "icon": "✈️",
            "estimated_cost": flight_cost,
            "estimated_time": "Approx. 1-3 hours",
            "data_type": "Estimated"
        })

    return {
        "from": from_location,
        "destination": destination,
        "distance_km": round(distance_km, 2),
        "options": options
    }

@app.get("/hotels")
def hotel_options(destination: str, nights: int):

    url = "https://nominatim.openstreetmap.org/search"

    params = {
        "q": f"hotel, {destination}",
        "format": "jsonv2",
        "limit": 10,
        "addressdetails": 1,
        "layer": "poi"
    }

    headers = {
        "User-Agent": "AI-Travel-Planner/1.0"
    }

    try:

        response = requests.get(
            url,
            params=params,
            headers=headers,
            timeout=20
        )

        print("Hotel API status:", response.status_code)

        if response.status_code != 200:
            print("Hotel API response:", response.text[:500])

            return {
                "error": "Could not fetch hotel data"
            }

        data = response.json()

    except requests.exceptions.RequestException as e:

        print("Hotel API error:", e)

        return {
            "error": "Could not connect to hotel service"
        }

    hotels = []

    for place in data:

        name = place.get("name")

        if not name:
            name = place.get(
                "display_name",
                "Unknown hotel"
            ).split(",")[0]

        hotels.append({
            "name": name,
            "type": place.get("type", "hotel"),
            "latitude": float(place["lat"]),
            "longitude": float(place["lon"]),
            "address": place.get(
                "display_name",
                "Address not available"
            )
        })

    return {
        "destination": destination,
        "nights": nights,
        "count": len(hotels),
        "hotels": hotels
    }
@app.get("/places")
def places_to_visit(destination: str):

    # First find the coordinates of the destination
    location = get_coordinates(destination)

    if location is None:
        return {
            "error": "Could not find destination"
        }

    latitude = location["latitude"]
    longitude = location["longitude"]

    # Search for tourist attractions around the destination
    overpass_url = "https://overpass-api.de/api/interpreter"

    query = f"""
    [out:json][timeout:25];

    (
        nwr["tourism"="attraction"](around:10000,{latitude},{longitude});
        nwr["tourism"="museum"](around:10000,{latitude},{longitude});
        nwr["tourism"="viewpoint"](around:10000,{latitude},{longitude});
    );

    out center tags;
    """

    headers = {
        "User-Agent": "AI-Travel-Planner/1.0"
    }

    response = requests.post(
        overpass_url,
        data=query,
        headers=headers,
        timeout=30
    )

    if response.status_code != 200:
        return {
            "error": "Could not fetch places"
        }

    data = response.json()

    places = []

    for element in data["elements"]:

        tags = element.get("tags", {})

        name = tags.get("name")

        if not name:
            continue

        places.append({
            "name": name,
            "type": tags.get("tourism", "attraction"),
            "latitude": element.get("lat") or element.get("center", {}).get("lat"),
            "longitude": element.get("lon") or element.get("center", {}).get("lon"),
            "fee": tags.get("fee", "Unknown")
        })

    # Remove duplicate place names
    unique_places = []
    seen_names = set()

    for place in places:

        if place["name"] not in seen_names:
            unique_places.append(place)
            seen_names.add(place["name"])

    return {
        "destination": destination,
        "count": len(unique_places),
        "places": unique_places[:10]
    }
def get_coordinates(place):
    url = "https://nominatim.openstreetmap.org/search"

    params = {
        "q": place,
        "format": "jsonv2",
        "limit": 1
    }

    headers = {
        "User-Agent": "AI-Travel-Planner/1.0"
    }

    response = requests.get(
        url,
        params=params,
        headers=headers
    )

    data = response.json()

    if not data:
        return None

    return {
        "latitude": float(data[0]["lat"]),
        "longitude": float(data[0]["lon"])
    }


@app.get("/location")
def find_location(place: str):

    coordinates = get_coordinates(place)

    if coordinates is None:
        return {
            "error": "Location not found"
        }

    return {
        "place": place,
        "coordinates": coordinates
    }
@app.get("/route")
def get_route(from_location: str, destination: str):

    start = get_coordinates(from_location)
    end = get_coordinates(destination)

    if start is None or end is None:
        return {
            "error": "Could not find one or both locations"
        }

    url = (
        f"https://router.project-osrm.org/route/v1/driving/"
        f"{start['longitude']},{start['latitude']};"
        f"{end['longitude']},{end['latitude']}"
    )

    params = {
        "overview": "false"
    }

    response = requests.get(url, params=params)
    data = response.json()

    if data["code"] != "Ok":
        return {
            "error": "Could not calculate route"
        }

    route = data["routes"][0]

    return {
        "from": from_location,
        "destination": destination,
        "distance_km": round(route["distance"] / 1000, 2),
        "duration_hours": round(route["duration"] / 3600, 2)
    }
# ==============================
# AI ITINERARY GENERATOR
# ==============================

@app.post("/ai-itinerary")
def generate_ai_itinerary(trip: TripRequest):

    import os
    from huggingface_hub import InferenceClient

    # Check token
    token = os.getenv("HF_TOKEN")

    if not token:
        return {
            "error": "HF_TOKEN is not available to the FastAPI server."
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
Total budget: ₹{trip.budget}
Travel preference: {trip.preference}

Instructions:
- Create a day-by-day itinerary.
- Suggest suitable places to visit.
- Consider the travel preference.
- Keep the plan realistic.
- Consider the given budget.
- Include morning, afternoon and evening suggestions.
- Do not invent exact ticket prices.
- Mention that costs are estimates.

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

        itinerary = response.choices[0].message.content

        return {
            "destination": trip.destination,
            "itinerary": itinerary
        }

    except Exception as e:

        return {
            "error": str(e)
        }

# ==============================
# FLIGHT SEARCH
# ==============================

@app.get("/flights")
def search_flights(
    from_airport: str,
    to_airport: str,
    outbound_date: str,
    return_date: str,
    adults: int = 1
):

    import serpapi

    api_key = os.getenv("SERPAPI_KEY")

    if not api_key:
        return {
            "error": "SERPAPI_KEY is not available."
        }

    try:

        client = serpapi.Client(api_key=api_key)

        results = client.search({
            "engine": "google_flights",
            "departure_id": from_airport,
            "arrival_id": to_airport,
            "outbound_date": outbound_date,
            "return_date": return_date,
            "adults": adults,
            "currency": "INR",
            "hl": "en",
            "type": "1"
        })

        return results

    except Exception as e:

        return {
            "error": str(e)
        }