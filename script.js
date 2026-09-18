const button = document.getElementById("plan-button");

button.addEventListener("click", async function () {

    const from = document.getElementById("from").value;
    const destination = document.getElementById("destination").value;
    const startDate = document.getElementById("start-date").value;
    const endDate = document.getElementById("end-date").value;
    const people = document.getElementById("people").value;
    const budget = document.getElementById("budget").value;
    const preference = document.getElementById("preferences").value;

    // Check required fields
    if (
        from === "" ||
        destination === "" ||
        startDate === "" ||
        endDate === "" ||
        budget === ""
    ) {
        alert("Please fill in all the required fields.");
        return;
    }

    const result = document.getElementById("result-content");

    // Show loading message
    result.innerHTML = `
        <p>🤖 Calculating your trip...</p>
    `;

    try {

        // Send information to FastAPI
        const response = await fetch(
            "http://127.0.0.1:8000/plan-trip",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    from_location: from,
                    destination: destination,
                    start_date: startDate,
                    end_date: endDate,
                    people: Number(people),
                    budget: Number(budget),
                    preference: preference
                })
            }
        );

        const data = await response.json();

        // Display the result
        result.innerHTML = `

            <h3>
                ✈️ ${data.trip.from} → ${data.trip.destination}
            </h3>

            <br>

            <p>
                📅 <strong>Dates:</strong>
                ${data.trip.start_date}
                → ${data.trip.end_date}
            </p>

            <p>
                🗓️ <strong>Trip Duration:</strong>
                ${data.trip.days} days
            </p>

            <p>
                👥 <strong>Travelers:</strong>
                ${data.trip.people}
            </p>

            <p>
                ❤️ <strong>Preference:</strong>
                ${data.trip.preference || "Not selected"}
            </p>

            <hr>

            <h3>💰 Budget Summary</h3>

            <br>

            <p>
                💵 <strong>Total Budget:</strong>
                ₹${data.trip.budget}
            </p>

            <p>
                👤 <strong>Budget per Person:</strong>
                ₹${data.trip.budget_per_person}
            </p>

            <p>
                📅 <strong>Budget per Day:</strong>
                ₹${data.trip.budget_per_day}
            </p>

            <br>

            <h3>📊 Budget Allocation</h3>

            <br>

            <p>
                🚆 <strong>Transportation Budget:</strong>
                ₹${data.estimated_cost.transport}
            </p>

            <p>
                🏨 <strong>Accommodation Budget:</strong>
                ₹${data.estimated_cost.hotel}
            </p>

            <p>
                🍜 <strong>Food Budget:</strong>
                ₹${data.estimated_cost.food}
            </p>

            <p>
                🎟️ <strong>Activities Budget:</strong>
                ₹${data.estimated_cost.activities}
            </p>

            <p>
                🛟 <strong>Emergency Budget:</strong>
                ₹${data.estimated_cost.emergency}
            </p>

            <hr>

            <h3>💰 Total Estimated Expenditure</h3>

            <br>

            <p>
                💸 <strong>Total:</strong>
                ₹${data.estimated_cost.total}
            </p>

            <p>
                📊 <strong>Remaining Budget:</strong>
                ₹${data.trip.budget - data.estimated_cost.total}
            </p>

            <br>

            <p>
                ✅ <strong>Trip calculation completed!</strong>
            </p>

            <hr>

            <h3>🚆 Transportation Options</h3>

            <br>

            <div id="transport-options">
                <p>Loading transportation options...</p>
            </div>

            <hr>

            <h3>🏨 Accommodation Options</h3>

            <br>

            <div id="hotel-options">
                <p>Loading hotel options...</p>
            </div>

        `;
        // Get real road route information
        const routeResponse = await fetch(
            `http://127.0.0.1:8000/route?from_location=${encodeURIComponent(from)}&destination=${encodeURIComponent(destination)}`
        );

        const routeData = await routeResponse.json();

        if (routeData.error) {
            throw new Error(routeData.error);
        }

        result.innerHTML += `
            <div class="route-card">
                <h3>🛣️ Road Route</h3>

            <p>
                📍 <strong>Distance:</strong>
                ${routeData.distance_km} km
            </p>

            <p>
                ⏱️ <strong>Estimated driving time:</strong>
                ${routeData.duration_hours} hours
            </p>

            <p class="data-note">
                Based on OpenStreetMap road data.
            </p>
        </div>
        `;
        // Get transportation options
        const transportResponse = await fetch(
            `http://127.0.0.1:8000/transport?from_location=${encodeURIComponent(from)}&destination=${encodeURIComponent(destination)}`
        );

        const transportData = await transportResponse.json();

        const transportOptions =
            document.getElementById("transport-options");

        transportOptions.innerHTML = "";

        transportData.options.forEach(function(option) {

            transportOptions.innerHTML += `
                <div class="transport-card">

                    <h4>
                        ${option.icon} ${option.mode}
                    </h4>

                    <p>
                        💰 Estimated Cost:
                        ₹${option.estimated_cost}
                    </p>

                    <p>
                        ⏱️ Travel Time:
                        ${option.estimated_time}
                    </p>

                    <button
                        class="select-transport"
                        data-mode="${option.mode}"
                        data-cost="${option.estimated_cost}"
                    >
                        Select ${option.mode}
                    </button>

                </div>
            `;
        });

        // Get real flight options
        const flightData = await getFlights(
        from,
        destination,
        startDate,
        endDate,
        Number(people)
        );

        result.innerHTML += `
            <hr>

            <h3>✈️ Flight Options</h3>

            <br>

            <div id="flight-options">
                <p>Loading flight options...</p>
            </div>
        `;

        const flightOptions =
            document.getElementById("flight-options");

        if (flightData.error) {

            flightOptions.innerHTML = `
                <p>⚠️ ${flightData.error}</p>
            `;

        } else if (
            !flightData.best_flights ||
            flightData.best_flights.length === 0
        ) {

            flightOptions.innerHTML = `
                <p>😕 No flights found for these dates.</p>
            `;

        } else {

            flightOptions.innerHTML = "";

            flightData.best_flights.forEach(function(flight) {

                const firstLeg = flight.flights[0];

                flightOptions.innerHTML += `
                    <div class="transport-card">

                        <h4>
                            ✈️ ${firstLeg.airline}
                        </h4>

                        <p>
                            🛫 <strong>Departure:</strong>
                            ${firstLeg.departure_airport.time}
                        </p>

                        <p>
                            🛬 <strong>Arrival:</strong>
                            ${firstLeg.arrival_airport.time}
                        </p>

                        <p>
                            ⏱️ <strong>Duration:</strong>
                            ${firstLeg.duration} minutes
                        </p>

                        <p>
                            💰 <strong>Current Price:</strong>
                            ₹${flight.price}
                        </p>

                        <p>
                            👥 <strong>Travelers:</strong>
                            ${people}
                        </p>

                    </div>
                `;
            });

            flightOptions.innerHTML += `
                <p class="data-note">
                    💡 Flight prices are current search results and can change
                    before booking. Confirm the final price with the airline or
                    booking provider.
                </p>
            `;
        }
        // Get hotel options
        const nights = data.trip.days - 1;

        const hotelResponse = await fetch(
            `http://127.0.0.1:8000/hotels?destination=${encodeURIComponent(destination)}&nights=${nights}`
        );

        const hotelData = await hotelResponse.json();

        const hotelOptions =
            document.getElementById("hotel-options");

        hotelOptions.innerHTML = "";

        if (hotelData.error) {

            hotelOptions.innerHTML = `
                <p>⚠️ Hotel information is currently unavailable.</p>
            `;

        } else if (hotelData.hotels.length === 0) {

            hotelOptions.innerHTML = `
                <p>😕 No hotels found for this destination.</p>
            `;

        } else {

            hotelData.hotels.forEach(function(hotel) {

                hotelOptions.innerHTML += `
                    <div class="hotel-card">

                        <h4>
                            🏨 ${hotel.name}
                        </h4>

                        <p>
                            🏷️ <strong>Type:</strong>
                            ${hotel.type}
                        </p>

                        <p>
                            📍 <strong>Address:</strong>
                            ${hotel.address}
                        </p>

                        <a
                            href="https://www.openstreetmap.org/?mlat=${hotel.latitude}&mlon=${hotel.longitude}#map=17/${hotel.latitude}/${hotel.longitude}"
                            target="_blank"
                            class="map-link"
                        >
                            🗺️ View on Map
                        </a>

                    </div>
                `;
            });
        }

        // places
        const placesResponse = await fetch(
            `http://127.0.0.1:8000/places?destination=${encodeURIComponent(destination)}`
        );

        const placesData = await placesResponse.json();

        if (placesData.error) {
            throw new Error(placesData.error);
        }

        result.innerHTML += `
            <hr>
            <h3>📍 Places to Visit</h3>
            <br>
            <p>Found <strong>${placesData.count}</strong> places nearby.</p>
            <br>
            <div id="places-options"></div>
        `;

        const placesOptions = document.getElementById("places-options");

        placesData.places.forEach(function(place) {

            placesOptions.innerHTML += `
                <div class="place-card">
                    <h4>📍 ${place.name}</h4>

                    <p>
                        🏷️ <strong>Type:</strong>
                        ${place.type}
                    </p>

                    <p>
                        💰 <strong>Entry Fee:</strong>
                        ${place.fee}
                    </p>

                    <a
                        href="https://www.openstreetmap.org/?mlat=${place.latitude}&mlon=${place.longitude}#map=17/${place.latitude}/${place.longitude}"
                        target="_blank"
                        class="map-link"
                    >
                        🗺️ View on Map
                    </a>

                </div>
            `;
        });

        const transportButtons =
            document.querySelectorAll(".select-transport");

        transportButtons.forEach(function(button) {

            button.addEventListener("click", function() {

                const selectedMode =
                    button.dataset.mode;

                const selectedCost =
                    Number(button.dataset.cost);

                const otherExpenses =
                data.estimated_cost.hotel +
                data.estimated_cost.food +
                data.estimated_cost.activities +
                data.estimated_cost.emergency;

            const newTotal =
                selectedCost + otherExpenses;

            const remainingBudget =
                data.trip.budget - newTotal;

            alert(
                `${selectedMode} selected! Estimated transport cost: ₹${selectedCost}`
            );

            const selectedTransport =
                document.createElement("div");

            selectedTransport.className =
                "selected-transport";

            selectedTransport.innerHTML = `
                <h3>✅ Selected Transportation</h3>

                <p>
                    🚆 <strong>Mode:</strong>
                    ${selectedMode}
                </p>

                <p>
                    💰 <strong>Estimated Cost:</strong>
                    ₹${selectedCost}
                </p>

                <p>
                    💵 <strong>Updated Estimated Expenditure:</strong>
                    ₹${newTotal}
                </p>

                <p>
                    💚 <strong>Remaining Budget:</strong>
                    ₹${remainingBudget}
                </p>
            `;

            result.appendChild(selectedTransport);

        });

    });

    } catch (error) {

        console.error(error);

        result.innerHTML = `
            <p>
                ❌ Could not connect to the travel planner backend.
            </p>
        `;
    }

});
function getAirportCode(city) {
    const airports = {
        "delhi": "DEL",
        "new delhi": "DEL",
        "mumbai": "BOM",
        "jaipur": "JAI",
        "bangalore": "BLR",
        "bengaluru": "BLR",
        "hyderabad": "HYD",
        "chennai": "MAA",
        "kolkata": "CCU",
        "pune": "PNQ",
        "ahmedabad": "AMD",
        "lucknow": "LKO",
        "goa": "GOI",
        "dehradun": "DED",
        "varanasi": "VNS",
        "indore": "IDR",
        "nagpur": "NAG",
        "bhubaneswar": "BBI",
        "patna": "PAT",
        "chandigarh": "IXC",
        "raipur": "RPR"
    };

    return airports[city.trim().toLowerCase()] || null;
}
async function getFlights(from, destination, startDate, endDate, people) {

    const fromCode = getAirportCode(from);
    const toCode = getAirportCode(destination);

    // Check whether we know the airport codes
    if (!fromCode || !toCode) {
        return {
            error: "Flight search is currently available for selected major cities."
        };
    }

    const params = new URLSearchParams({
        from_airport: fromCode,
        to_airport: toCode,
        outbound_date: startDate,
        return_date: endDate,
        adults: people
    });

    try {

        const response = await fetch(
            `http://127.0.0.1:8000/flights?${params}`
        );

        const data = await response.json();

        return data;

    } catch (error) {

        return {
            error: "Unable to connect to the flight service."
        };
    }
}