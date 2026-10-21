from dotenv import load_dotenv
import os
from datetime import date

import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# MODELS
# =========================================================

class TripRequest(BaseModel):
    from_location: str
    destination: str
    start_date: str
    end_date: str
    people: int

class GroundTransportRequest(BaseModel):
    from_location: str
    destination: str
    journey_date: str
    people: int





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

def get_train_fare(
    train_number,
    source_code,
    destination_code,
    journey_date,
    class_code
):
    """
    Get the live/current fare for one train and one class
    from RailRadar.
    """

    api_key = os.getenv("RAILRADAR_KEY")

    if not api_key:
        print("RAILRADAR_KEY is not available.")
        return None

    try:

        response = requests.get(
            f"https://api.railradar.in/v1/trains/{train_number}/fare",
            params={
                "source": source_code,
                "destination": destination_code,
                "journeyDate": journey_date,
                "classCode": class_code,
                "quotaCode": "GN"
            },
            headers={
                "Authorization":
                    f"Bearer {api_key}"
            },
            timeout=15
        )

        print(
            f"FARE REQUEST: "
            f"{train_number} "
            f"{class_code} "
            f"-> HTTP {response.status_code}"
        )

        if response.status_code != 200:

            print(
                f"FARE ERROR {train_number} "
                f"{class_code}:",
                response.text[:500]
            )

            return None

        data = response.json()

        fare_data = data.get(
            "data"
        )

        if not fare_data:

            print(
                f"No fare data for "
                f"{train_number} "
                f"{class_code}"
            )

            return None

        total_fare = fare_data.get(
            "totalFare"
        )

        if total_fare is None:

            print(
                f"No totalFare for "
                f"{train_number} "
                f"{class_code}"
            )

            return None

        return round(
            float(total_fare)
        )

    except Exception as e:

        print(
            f"Fare error "
            f"{train_number} "
            f"{class_code}:",
            e
        )

        return None


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
    journey_date = request.journey_date
    people = request.people

    options = []
    train_error = None

    # =====================================================
    # 🚆 TRAIN
    # =====================================================

    api_key = os.getenv("RAILRADAR_KEY")

    if not api_key:

        train_error = "RAILRADAR_KEY is not available."

    else:

        # -------------------------------------------------
        # FIND SOURCE AND DESTINATION STATIONS
        # -------------------------------------------------

        source_station = find_railway_station(
            from_location
        )

        destination_station = find_railway_station(
            destination
        )

        if not source_station:

            train_error = (
                f"Could not find a railway station "
                f"for {from_location}."
            )

        elif not destination_station:

            train_error = (
                f"Could not find a railway station "
                f"for {destination}."
            )

        else:

            source_code = str(
                source_station.get("code", "")
            ).upper()

            destination_code = str(
                destination_station.get("code", "")
            ).upper()

            print(
                "================================================="
            )

            print(
                "ROAMLY TRAIN SEARCH"
            )

            print(
                "Source:",
                from_location,
                "->",
                source_code
            )

            print(
                "Destination:",
                destination,
                "->",
                destination_code
            )

            print(
                "Journey date:",
                journey_date
            )

            print(
                "================================================="
            )

            # -------------------------------------------------
            # STEP 1
            # DIRECT POINT-TO-POINT SEARCH
            # -------------------------------------------------

            train_list = []

            try:

                url = (
                    "https://api.railradar.in/v1/"
                    f"trains/between/"
                    f"{source_code}/"
                    f"{destination_code}"
                )

                response = requests.get(
                    url,
                    params={
                        "date": journey_date,
                        "byCity": "false",
                        "live": "false"
                    },
                    headers={
                        "Authorization":
                            f"Bearer {api_key}"
                    },
                    timeout=20
                )

                print(
                    "DIRECT TRAIN API STATUS:",
                    response.status_code
                )

                print(
                    "DIRECT TRAIN API RESPONSE:",
                    response.text[:2000]
                )

                if response.status_code == 200:

                    data = response.json()

                    train_list = (
                        data
                        .get("data", {})
                        .get("trains", [])
                    )

            except Exception as e:

                print(
                    "Direct train search error:",
                    e
                )

            # -------------------------------------------------
            # STEP 2
            # IF DATE FILTER RETURNS NOTHING,
            # TRY WITHOUT DATE
            # -------------------------------------------------

            if not train_list:

                print(
                    "No trains with date filter."
                )

                print(
                    "Retrying without date filter..."
                )

                try:

                    url = (
                        "https://api.railradar.in/v1/"
                        f"trains/between/"
                        f"{source_code}/"
                        f"{destination_code}"
                    )

                    response = requests.get(
                        url,
                        params={
                            "byCity": "false",
                            "live": "false"
                        },
                        headers={
                            "Authorization":
                                f"Bearer {api_key}"
                        },
                        timeout=20
                    )

                    print(
                        "NO-DATE TRAIN API STATUS:",
                        response.status_code
                    )

                    print(
                        "NO-DATE TRAIN API RESPONSE:",
                        response.text[:2000]
                    )

                    if response.status_code == 200:

                        data = response.json()

                        train_list = (
                            data
                            .get("data", {})
                            .get("trains", [])
                        )

                except Exception as e:

                    print(
                        "No-date train search error:",
                        e
                    )

            # -------------------------------------------------
            # STEP 3
            # LAST DISCOVERY METHOD:
            # CITY-WIDE SEARCH
            # -------------------------------------------------

            if not train_list:

                print(
                    "No direct-station trains found."
                )

                print(
                    "Trying city-wide RailRadar search..."
                )

                try:

                    url = (
                        "https://api.railradar.in/v1/"
                        f"trains/between/"
                        f"{source_code}/"
                        f"{destination_code}"
                    )

                    response = requests.get(
                        url,
                        params={
                            "date": journey_date,
                            "byCity": "true",
                            "live": "false"
                        },
                        headers={
                            "Authorization":
                                f"Bearer {api_key}"
                        },
                        timeout=20
                    )

                    print(
                        "CITY-WIDE TRAIN API STATUS:",
                        response.status_code
                    )

                    print(
                        "CITY-WIDE TRAIN API RESPONSE:",
                        response.text[:2000]
                    )

                    if response.status_code == 200:

                        data = response.json()

                        train_list = (
                            data
                            .get("data", {})
                            .get("trains", [])
                        )

                except Exception as e:

                    print(
                        "City-wide train search error:",
                        e
                    )

            print(
                "FINAL TRAIN COUNT:",
                len(train_list)
            )

            # -------------------------------------------------
            # STEP 4
            # PROCESS EVERY TRAIN
            # -------------------------------------------------

            for train_item in train_list:

                train_info = train_item.get(
                    "train",
                    {}
                )

                train_number = str(
                    train_info.get(
                        "number",
                        ""
                    )
                )

                if not train_number:
                    continue

                train_name = train_info.get(
                    "name",
                    "Indian Railways Train"
                )

                from_info = train_item.get(
                    "from",
                    {}
                )

                to_info = train_item.get(
                    "to",
                    {}
                )

                departure = from_info.get(
                    "departure",
                    "N/A"
                )

                arrival = to_info.get(
                    "arrival",
                    "N/A"
                )

                duration_minutes = train_item.get(
                    "duration"
                )

                if duration_minutes is not None:

                    hours = int(
                        duration_minutes // 60
                    )

                    minutes = int(
                        duration_minutes % 60
                    )

                    duration = (
                        f"{hours}h {minutes}m"
                    )

                else:

                    duration = "N/A"

                # -------------------------------------------------
                # LIVE INFORMATION
                # -------------------------------------------------

                live_info = train_item.get(
                    "live"
                )

                live_status = None
                delay_minutes = 0

                if isinstance(
                    live_info,
                    dict
                ):

                    live_status = live_info.get(
                        "type"
                    )

                    delay_minutes = (
                        live_info.get(
                            "delayMinutes",
                            0
                        )
                        or 0
                    )

                # -------------------------------------------------
                # FARES
                # -------------------------------------------------

                class_fares = {}

                for class_code in [
                    "SL",
                    "3A",
                    "2A",
                    "1A"
                ]:

                    fare = get_train_fare(
                        train_number,
                        source_code,
                        destination_code,
                        journey_date,
                        class_code
                    )

                    if fare is not None:

                        class_fares[
                            class_code
                        ] = {

                            "per_person": fare,

                            "total": round(
                                fare * people
                            )
                        }

                # -------------------------------------------------
                # AVERAGE FARE
                # -------------------------------------------------

                if class_fares:

                    average_price = round(
                        sum(
                            item["per_person"]
                            for item
                            in class_fares.values()
                        )
                        /
                        len(class_fares)
                    )

                else:

                    average_price = None

                # -------------------------------------------------
                # ADD TRAIN
                #
                # IMPORTANT:
                # We DO NOT discard the train if fare lookup
                # fails.
                # -------------------------------------------------

                options.append({

                    "mode": "Train",

                    "icon": "🚆",

                    "data_type": "Live",

                    "name": train_name,

                    "train_number":
                        train_number,

                    "departure":
                        departure,

                    "arrival":
                        arrival,

                    "duration":
                        duration,

                    "distance_km":
                        train_item.get(
                            "distance"
                        ),

                    "train_type":
                        train_info.get(
                            "type",
                            "Train"
                        ),

                    "classes":
                        class_fares,

                    "average_price":
                        average_price,

                    "live_status":
                        live_status,

                    "delay_minutes":
                        delay_minutes,

                    "view_url":
                        "https://railradar.in/"
                        f"train-status/{train_number}"
                })

            # -------------------------------------------------
            # TRAIN CATEGORISATION
            # -------------------------------------------------

            priced_trains = [
                option
                for option in options
                if (
                    option.get("mode") == "Train"
                    and
                    option.get(
                        "average_price"
                    ) is not None
                )
            ]

            if priced_trains:

                prices = sorted(
                    option["average_price"]
                    for option in priced_trains
                )

                total_priced = len(
                    prices
                )

                for option in priced_trains:

                    price = option[
                        "average_price"
                    ]

                    if total_priced == 1:

                        category = "Standard"

                    elif total_priced == 2:

                        if price == prices[0]:

                            category = "Economy"

                        else:

                            category = "Premium"

                    else:

                        first_index = (
                            (total_priced - 1)
                            // 3
                        )

                        second_index = (
                            2 *
                            (total_priced - 1)
                            // 3
                        )

                        first_cut = prices[
                            first_index
                        ]

                        second_cut = prices[
                            second_index
                        ]

                        if price <= first_cut:

                            category = "Economy"

                        elif price <= second_cut:

                            category = "Standard"

                        else:

                            category = "Premium"

                    option[
                        "category"
                    ] = category

            # Give trains without fares a clear category.
            for option in options:

                if (
                    option.get("mode") == "Train"
                    and
                    option.get(
                        "average_price"
                    ) is None
                ):

                    option[
                        "category"
                    ] = "Fare unavailable"

    # =====================================================
    # 🚗 CAR
    # =====================================================

    try:

        route = get_road_route(
            from_location,
            destination
        )

        if route is not None:

            distance_km = round(
                route["distance_km"],
                2
            )

            driving_hours = round(
                route["duration_hours"],
                2
            )

            api_mitra_key = os.getenv(
                "APIMITRA_KEY"
            )

            if api_mitra_key:

                fuel_response = requests.get(
                    "https://api.apimitra.in/fuel",
                    params={
                        "city":
                            from_location
                    },
                    headers={
                        "x-api-key":
                            api_mitra_key
                    },
                    timeout=10
                )

                fuel_response.raise_for_status()

                fuel_data = (
                    fuel_response.json()
                )

                petrol_price = None

                if "price" in fuel_data:

                    petrol_price = (
                        fuel_data[
                            "price"
                        ]
                        .get(
                            "petrol",
                            {}
                        )
                        .get(
                            "price"
                        )
                    )

                if petrol_price:

                    mileage = 15

                    litres_needed = (
                        distance_km /
                        mileage
                    )

                    fuel_cost_one_way = (
                        litres_needed *
                        float(
                            petrol_price
                        )
                    )

                    fuel_cost_round_trip = (
                        fuel_cost_one_way *
                        2
                    )

                    options.append({

                        "mode": "Car",

                        "icon": "🚗",

                        "data_type":
                            "Calculated estimate",

                        "cost":
                            round(
                                fuel_cost_round_trip
                            ),

                        "fuel_price":
                            float(
                                petrol_price
                            ),

                        "distance_km":
                            distance_km,

                        "mileage":
                            mileage,

                        "estimated_time":
                            driving_hours
                    })

    except Exception as e:

        print(
            "Car API error:",
            e
        )

    # =====================================================
    # FINAL RESPONSE
    # =====================================================

    train_count = len([
        option
        for option in options
        if option.get("mode") == "Train"
    ])

    return {

        "options":
            options,

        "train_error":
            train_error,

        "train_count":
            train_count,

        "data_type":
            "Live train data + "
            "live available fares + "
            "calculated car estimate"
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
    return_date: str,
    adults: int = 1
):

    import serpapi

    api_key = os.getenv("SERPAPI_KEY")

    if not api_key:
        return {"error": "SERPAPI_KEY is not available."}

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
        return {"error": str(e)}
