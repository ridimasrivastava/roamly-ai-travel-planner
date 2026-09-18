import os
import serpapi

print("FLIGHT TEST STARTED")

api_key = os.getenv("SERPAPI_KEY")

print("API key loaded:", bool(api_key))

client = serpapi.Client(api_key=api_key)

results = client.search({
    "engine": "google_flights",
    "departure_id": "DEL",
    "arrival_id": "JAI",
    "outbound_date": "2026-09-20",
    "return_date": "2026-09-23",
    "currency": "INR",
    "hl": "en",
    "type": "1"
})

print("\nFLIGHT SEARCH SUCCESSFUL")

print(results)