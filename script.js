const button = document.getElementById("plan-button");

button.addEventListener("click", async function () {

    const from = document.getElementById("from").value.trim();
    const destination = document.getElementById("destination").value.trim();
    const startDate = document.getElementById("start-date").value;
    const endDate = document.getElementById("end-date").value;
    const people = Number(document.getElementById("people").value);

    // -----------------------------------------
    // Validate user input
    // -----------------------------------------

    if (!from || !destination || !startDate || !endDate) {
        alert("Please fill all required fields.");
        return;
    }

    if (people < 1) {
        alert("Number of travelers must be at least 1.");
        return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
        alert("End date must be after start date.");
        return;
    }

    const result = document.getElementById("result-content");

    // -----------------------------------------
    // Loading
    // -----------------------------------------

    result.innerHTML = `
        <p>🤖 ROAMLY is preparing your trip...</p>
    `;

    try {

        // -----------------------------------------
        // STAGE 1
        // Send trip details to FastAPI
        // -----------------------------------------

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
                    people: people,
                })
            }
        );

        const data = await response.json();

        // -----------------------------------------
        // Handle backend errors
        // -----------------------------------------

        if (!response.ok || data.error) {
            throw new Error(
                data.error || "Unable to estimate trip budget."
            );
        }

        const trip = data.trip;
        const costs = data.estimated_cost;
        const details = data.estimate_details;

        // -----------------------------------------
        // DIRECTLY GO TO TRANSPORT
        // -----------------------------------------

        showTransportPlanning(
            result,
            trip
        );

    } catch (error) {

        console.error(error);

        result.innerHTML = `
            <p>
                ❌ ${error.message ||
                "Could not connect to the ROAMLY backend."}
            </p>
        `;
    }

});


// =========================================================
// STAGE 3 — REAL TRANSPORT OPTIONS
// =========================================================

// =========================================================
// STAGE 2 — HOTELS + ATTRACTIONS + TRANSPORT
// =========================================================

async function showTransportPlanning(result, trip) {

    result.innerHTML = `

        <!-- =========================================
             HOTELS
        ========================================== -->

        <div
            class="route-card"
            id="hotel-section"
        >

            <h2>🏨 Hotels</h2>

            <p>
                Searching real hotels in
                <strong>${trip.destination}</strong>
                for your trip dates...
            </p>

        </div>


        <!-- =========================================
             ATTRACTIONS
        ========================================== -->

        <div
            class="route-card"
            id="places-section"
        >

            <h2>📍 Attractions</h2>

            <p>
                Searching places to visit...
            </p>

        </div>


        <!-- =========================================
             TRANSPORT
        ========================================== -->

        <div
            class="transport-section"
            id="transport-section"
        >

            <h2>🚆 Transport</h2>

            <p>
                Loading real transport options...
            </p>

        </div>

    `;


    // =====================================================
    // START ALL SEARCHES IN PARALLEL
    // =====================================================

    loadHotels(
        document.getElementById("hotel-section"),
        trip
    );

    loadPlaces(
        document.getElementById("places-section"),
        trip
    );

    loadTransport(
        document.getElementById("transport-section"),
        trip
    );
}


// =========================================================
// SELECT REAL FLIGHT
// =========================================================

function selectRealFlight(
    result,
    trip,
    flight,
    flightPrice
) {

    const transportCost =
        Number(flightPrice);

    window.roamlyTripState = {
        trip: trip,
        transport: {
            mode: "Flight",
            cost: transportCost
        },
        totalCost: transportCost
    };

    const existing =
        document.getElementById(
            "selected-real-flight"
        );

    if (existing) {
        existing.remove();
    }

    const selection =
        document.createElement("div");

    selection.id =
        "selected-real-flight";

    selection.className =
        "selected-transport";

    selection.innerHTML = `

        <h3>
            ✅ Selected Flight
        </h3>

        <br>

        <p>
            ✈️ <strong>Transport:</strong>
            Flight
        </p>

        <p>
            💰 <strong>Flight Cost:</strong>
            ₹${transportCost.toLocaleString("en-IN")}
        </p>

        <hr>

        <h3>
            💰 Current Trip Total
        </h3>

        <br>

        <p>
            ✈️ <strong>Transport:</strong>
            ₹${transportCost.toLocaleString("en-IN")}
        </p>

        <p>
            💰 <strong>Current Total:</strong>
            ₹${transportCost.toLocaleString("en-IN")}
        </p>

        <p class="data-note">
            This is your running trip cost.
            Accommodation, food and activities
            will be added as you select them.
        </p>

    `;

    result.appendChild(selection);

    selection.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}

// =========================================================
// FLIGHT SEARCH HELPER
// =========================================================

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


async function getFlights(
    from,
    destination,
    startDate,
    endDate,
    people
) {
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
            `http://127.0.0.1:8000/flights?${params.toString()}`
        );

        const data = await response.json();

        if (!response.ok) {
            return {
                error: data.error || "Flight service returned an error."
            };
        }

        return data;

    } catch (error) {
        console.error("Flight API error:", error);

        return {
            error: "Unable to connect to the flight service."
        };
    }
}

// =========================================================
// RENDER FLIGHT OPTIONS
// =========================================================

function renderFlightOptions(section, flightData, trip) {

    // =====================================================
    // CHECK FOR FLIGHT ERRORS
    // =====================================================

    if (flightData.error) {

        section.innerHTML = `
            <h3>✈️ Flight</h3>

            <p>
                ⚠️ ${flightData.error}
            </p>

            <p class="data-note">
                ROAMLY could not obtain live flight
                prices for this route.
            </p>
        `;

        return;
    }


    // =====================================================
    // GET REAL FLIGHTS
    // =====================================================

    let flights = [];

    if (Array.isArray(flightData.best_flights)) {
        flights = flights.concat(
            flightData.best_flights
        );
    }

    if (Array.isArray(flightData.other_flights)) {
        flights = flights.concat(
            flightData.other_flights
        );
    }


    // =====================================================
    // KEEP ONLY FLIGHTS WITH REAL PRICES
    // =====================================================

    flights = flights.filter(
        flight =>
            Number.isFinite(
                Number(flight.price)
            )
    );


    // =====================================================
    // NO FLIGHTS
    // =====================================================

    if (flights.length === 0) {

        section.innerHTML = `
            <h3>✈️ Flight</h3>

            <p>
                😕 No real flights were found
                for these dates.
            </p>
        `;

        return;
    }


    // =====================================================
    // SORT BY REAL PRICE
    // =====================================================

    flights.sort(
        (a, b) =>
            Number(a.price) -
            Number(b.price)
    );


    // =====================================================
    // SELECT CHEAP / AVERAGE / PREMIUM
    // =====================================================

    let cheapFlight = null;
    let averageFlight = null;
    let premiumFlight = null;


    if (flights.length >= 1) {
        cheapFlight = flights[0];
    }


    if (flights.length >= 3) {

        averageFlight =
            flights[
                Math.floor(flights.length / 2)
            ];

        premiumFlight =
            flights[flights.length - 1];
    }

    else if (flights.length === 2) {

        premiumFlight = flights[1];
    }


    // =====================================================
    // FLIGHT CARD HELPER
    // =====================================================

    function createFlightCard(
        flight,
        category
    ) {

        if (!flight) {

            return `
                <div class="transport-category-card">

                    <h4>✈️ ${category}</h4>

                    <p>
                        😕 No real flight option
                        available for this category.
                    </p>

                </div>
            `;
        }


        const price =
            Number(flight.price);


        const firstLeg =
            flight.flights &&
            flight.flights.length > 0
                ? flight.flights[0]
                : null;


        const lastLeg =
            flight.flights &&
            flight.flights.length > 0
                ? flight.flights[
                    flight.flights.length - 1
                ]
                : null;


        const airline =
            firstLeg?.airline ||
            "Airline information unavailable";


        const departure =
            firstLeg?.departure_airport?.time ||
            "Not available";


        const arrival =
            lastLeg?.arrival_airport?.time ||
            "Not available";


        const duration =
            flight.total_duration
                ? `${flight.total_duration} minutes`
                : "Not available";


        return `
            <div class="transport-category-card">

                <h4>✈️ ${category}</h4>

                <h3>
                    ${airline}
                </h3>

                <p>
                    🛫 <strong>Departure:</strong>
                    ${departure}
                </p>

                <p>
                    🛬 <strong>Arrival:</strong>
                    ${arrival}
                </p>

                <p>
                    ⏱️ <strong>Duration:</strong>
                    ${duration}
                </p>

                <p>
                    👥 <strong>Travelers:</strong>
                    ${trip.people}
                </p>

                <p>
                    💰 <strong>Real Flight Price:</strong>
                    ₹${price.toLocaleString("en-IN")}
                </p>

                <p class="data-note">
                    🟢 Live flight price
                </p>

                <br>

                <button
                    class="main-button select-real-flight"
                    type="button"
                    data-flight-index="${flights.indexOf(flight)}"
                >
                    Select This Flight
                </button>

            </div>
        `;
    }


    // =====================================================
    // BUILD FLIGHT SECTION
    // =====================================================

    section.innerHTML = `

        <h3>✈️ Flight</h3>

        <p>
            Choose from real flight prices.
        </p>

        <div class="transport-category-grid">

            ${createFlightCard(
                cheapFlight,
                "Economy"
            )}

            ${createFlightCard(
                averageFlight,
                "Standard"
            )}

            ${createFlightCard(
                premiumFlight,
                "Premium"
            )}

        </div>

    `;


    // =====================================================
    // TEMPORARILY STORE FLIGHT DATA ON BUTTONS
    // =====================================================

    const buttons =
        section.querySelectorAll(
            ".select-real-flight"
        );

    buttons.forEach(function(button) {

        button.addEventListener(
            "click",
            function() {

                const selectedFlight =
                    flights[
                        Number(
                            button.dataset.flightIndex
                        )
                    ];

                const flightPrice =
                    Number(
                        selectedFlight.price
                    );

                selectRealFlight(
                    document.getElementById(
                        "result-content"
                    ),
                    trip,
                    selectedFlight,
                    flightPrice
                );

            }
        );

    });
}



// =========================================================
// RENDER GROUND TRANSPORT
// =========================================================

function renderGroundTransport(
    section,
    data,
    trip
) {

    // =====================================================
    // SEPARATE TRANSPORT TYPES
    // =====================================================

    const trains = data.options.filter(
        option => option.mode === "Train"
    );

    const cars = data.options.filter(
        option => option.mode === "Car"
    );


    // =====================================================
    // TRAIN GROUPS
    // =====================================================

    const economyTrains = trains.filter(
        train => train.category === "Economy"
    );

    const standardTrains = trains.filter(
        train => train.category === "Standard"
    );

    const premiumTrains = trains.filter(
        train => train.category === "Premium"
    );


    // =====================================================
    // TRAIN CARD
    // =====================================================

    function createTrainCard(train) {

        const classOrder = [
            "SL",
            "3A",
            "2A",
            "1A"
        ];

        const classNames = {
            "SL": "Sleeper",
            "3A": "3A",
            "2A": "2A",
            "1A": "1A"
        };


        const fareButtons = classOrder
            .filter(
                classCode =>
                    train.classes &&
                    train.classes[classCode]
            )
            .map(
                function(classCode) {

                    const fare =
                        train.classes[
                            classCode
                        ];

                    const perPerson =
                        Number(
                            fare.per_person
                        );

                    const total =
                        Number(
                            fare.total
                        );

                    return `
                        <div class="train-fare-row">

                            <div>
                                <strong>
                                    ${classNames[classCode]}
                                </strong>

                                <br>

                                <span>
                                    ₹${perPerson.toLocaleString(
                                        "en-IN"
                                    )}
                                    / person
                                </span>

                                <br>

                                <small>
                                    ₹${total.toLocaleString(
                                        "en-IN"
                                    )}
                                    for ${trip.people}
                                    traveler(s)
                                </small>
                            </div>

                            <button
                                class="main-button select-train-class"
                                type="button"
                                data-train-number="${train.train_number}"
                                data-train-name="${train.name}"
                                data-class-code="${classCode}"
                                data-cost="${total}"
                            >
                                Select
                            </button>

                        </div>
                    `;
                }
            )
            .join("");


        const liveStatusText =
            train.live_status
                ? train.live_status
                : "Scheduled";


        const delayText =
            Number(
                train.delay_minutes || 0
            ) > 0
                ? `${train.delay_minutes} min delay`
                : "On time";


        return `
            <div class="train-option-card">

                <div class="train-card-header">

                    <div>

                        <h3>
                            🚆 ${train.name}
                        </h3>

                        <p>
                            Train No:
                            <strong>
                                ${train.train_number}
                            </strong>
                        </p>

                    </div>

                    <span class="train-category-badge">
                        ${train.category}
                    </span>

                </div>


                <p>
                    🕐
                    <strong>Departure:</strong>
                    ${train.departure}
                </p>


                <p>
                    🕐
                    <strong>Arrival:</strong>
                    ${train.arrival}
                </p>


                <p>
                    ⏱️
                    <strong>Duration:</strong>
                    ${train.duration}
                </p>


                <p>
                    🚆
                    <strong>Type:</strong>
                    ${train.train_type}
                </p>


                <p>
                    📡
                    <strong>Live Status:</strong>
                    ${liveStatusText}
                    — ${delayText}
                </p>


                ${
                    train.distance_km
                        ? `
                            <p>
                                📍
                                <strong>Distance:</strong>
                                ${train.distance_km} km
                            </p>
                        `
                        : ""
                }


                <hr>


                <h4>
                    🎟️ Available Classes & Prices
                </h4>


                <div class="train-fares">

                    ${fareButtons}

                </div>


                <br>


                <button
                    class="main-button view-train-button"
                    type="button"
                    data-view-url="${train.view_url}"
                >
                    View Train Details
                </button>


                <p class="data-note">
                    🟢 Current fare data from
                    RailRadar.
                </p>

            </div>
        `;
    }


    // =====================================================
    // TRAIN SECTION
    // =====================================================

    let trainHTML = `
        <h3>🚆 Train</h3>

        <p>
            All available trains for your selected
            route and date.
        </p>
    `;


    if (trains.length === 0) {

        trainHTML += `
            <div class="hotel-card">

                <h4>
                    😕 No train options found
                </h4>

                <p>
                    ${
                        data.train_error ||
                        "No trains with available fare data were found."
                    }
                </p>

            </div>
        `;

    } else {

        if (economyTrains.length > 0) {

            trainHTML += `
                <h4 class="train-category-title">
                    🟢 Economy
                </h4>

                <div class="train-list">
                    ${economyTrains
                        .map(createTrainCard)
                        .join("")}
                </div>
            `;
        }


        if (standardTrains.length > 0) {

            trainHTML += `
                <h4 class="train-category-title">
                    🔵 Standard
                </h4>

                <div class="train-list">
                    ${standardTrains
                        .map(createTrainCard)
                        .join("")}
                </div>
            `;
        }


        if (premiumTrains.length > 0) {

            trainHTML += `
                <h4 class="train-category-title">
                    🟣 Premium
                </h4>

                <div class="train-list">
                    ${premiumTrains
                        .map(createTrainCard)
                        .join("")}
                </div>
            `;
        }
    }


    // =====================================================
    // CAR SECTION
    // =====================================================

    function createCarCard(
        car,
        category
    ) {

        if (!car) {

            return `
                <div class="transport-category-card">

                    <h4>
                        ${category}
                    </h4>

                    <p>
                        😕 No real option available.
                    </p>

                </div>
            `;
        }


        return `
            <div class="transport-category-card">

                <h4>
                    🚗 ${category}
                </h4>

                <h3>
                    ${car.name || "Car Route"}
                </h3>

                <p>
                    📍
                    <strong>Distance:</strong>
                    ${car.distance_km} km
                </p>

                <p>
                    ⛽
                    <strong>Fuel Price:</strong>
                    ₹${Number(
                        car.fuel_price
                    ).toLocaleString("en-IN")}/L
                </p>

                <p>
                    🚘
                    <strong>Mileage:</strong>
                    ${car.mileage} km/L
                </p>

                <p>
                    ⏱️
                    <strong>Estimated Time:</strong>
                    ${car.estimated_time}
                </p>

                <p>
                    💰
                    <strong>Estimated Fuel Cost:</strong>
                    ₹${Number(
                        car.cost
                    ).toLocaleString("en-IN")}
                </p>

                <p class="data-note">
                    🟡 Calculated from real road
                    distance and fuel price.
                </p>

                <br>

                <button
                    class="main-button select-ground-transport"
                    data-mode="Car"
                    data-cost="${car.cost}"
                    type="button"
                >
                    Select This Car
                </button>

            </div>
        `;
    }


    const saveMoneyCar =
        cars.length > 0
            ? cars[0]
            : null;


    const groundHTML = `

        ${trainHTML}

        <br><br>

        <h3>🚗 Car</h3>

        <p>
            Choose your car option.
        </p>

        <div class="car-option-grid">

            ${createCarCard(
                saveMoneyCar,
                "Save Money"
            )}

            ${createCarCard(
                null,
                "Save Time"
            )}

        </div>
    `;


    section.innerHTML =
        groundHTML;


    // =====================================================
    // SELECT TRAIN CLASS
    // =====================================================

    section
        .querySelectorAll(
            ".select-train-class"
        )
        .forEach(
            function(button) {

                button.addEventListener(
                    "click",
                    function() {

                        const trainNumber =
                            button.dataset
                                .trainNumber;

                        const trainName =
                            button.dataset
                                .trainName;

                        const classCode =
                            button.dataset
                                .classCode;

                        const cost =
                            Number(
                                button.dataset
                                    .cost
                            );


                        selectTrainClass(
                            document.getElementById(
                                "result-content"
                            ),
                            trip,
                            trainNumber,
                            trainName,
                            classCode,
                            cost
                        );

                    }
                );

            }
        );


    // =====================================================
    // VIEW TRAIN DETAILS
    // =====================================================

    section
        .querySelectorAll(
            ".view-train-button"
        )
        .forEach(
            function(button) {

                button.addEventListener(
                    "click",
                    function() {

                        const url =
                            button.dataset
                                .viewUrl;

                        if (url) {

                            window.open(
                                url,
                                "_blank"
                            );

                        }

                    }
                );

            }
        );


    // =====================================================
    // SELECT CAR
    // =====================================================

    section
        .querySelectorAll(
            ".select-ground-transport"
        )
        .forEach(
            function(button) {

                button.addEventListener(
                    "click",
                    function() {

                        const mode =
                            button.dataset.mode;

                        const cost =
                            Number(
                                button.dataset.cost
                            );

                        selectGroundTransport(
                            document.getElementById(
                                "result-content"
                            ),
                            trip,
                            mode,
                            cost
                        );

                    }
                );

            }
        );
}

// =========================================================
// SELECT GROUND TRANSPORT
// =========================================================

function selectTrainClass(
    result,
    trip,
    trainNumber,
    trainName,
    classCode,
    cost
) {

    const transportCost =
        Number(cost);


    // =====================================================
    // SAVE CURRENT TRIP STATE
    // =====================================================

    window.roamlyTripState = {

        trip: trip,

        transport: {

            mode: "Train",

            train_number:
                trainNumber,

            train_name:
                trainName,

            class:
                classCode,

            cost:
                transportCost

        },

        totalCost:
            transportCost
    };


    // =====================================================
    // REMOVE PREVIOUS SELECTION
    // =====================================================

    const existing =
        document.getElementById(
            "selected-ground-transport"
        );

    if (existing) {

        existing.remove();

    }


    // =====================================================
    // CREATE SELECTION CARD
    // =====================================================

    const selection =
        document.createElement(
            "div"
        );


    selection.id =
        "selected-ground-transport";


    selection.className =
        "selected-transport";


    selection.innerHTML = `

        <h3>
            ✅ Selected Train
        </h3>

        <br>

        <p>
            🚆
            <strong>Train:</strong>
            ${trainName}
        </p>

        <p>
            🔢
            <strong>Train Number:</strong>
            ${trainNumber}
        </p>

        <p>
            🎟️
            <strong>Class:</strong>
            ${classCode}
        </p>

        <p>
            💰
            <strong>Transport Cost:</strong>
            ₹${transportCost.toLocaleString(
                "en-IN"
            )}
        </p>

        <hr>

        <h3>
            💰 Current Trip Total
        </h3>

        <br>

        <p>
            🚆
            <strong>Train:</strong>
            ₹${transportCost.toLocaleString(
                "en-IN"
            )}
        </p>

        <p>
            💰
            <strong>Current Total:</strong>
            ₹${transportCost.toLocaleString(
                "en-IN"
            )}
        </p>

        <p class="data-note">
            This is your running trip cost.
            Accommodation, food and activities
            will be added as you select them.
        </p>

    `;


    result.appendChild(
        selection
    );


    selection.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}

function selectGroundTransport(
    result,
    trip,
    mode,
    cost
) {

    const transportCost = Number(cost);


    // =====================================================
    // SAVE CURRENT TRIP STATE
    // =====================================================

    window.roamlyTripState = {

        trip: trip,

        transport: {
            mode: mode,
            cost: transportCost
        },

        totalCost: transportCost

    };


    // =====================================================
    // REMOVE PREVIOUS SELECTION
    // =====================================================

    const existing =
        document.getElementById(
            "selected-ground-transport"
        );

    if (existing) {
        existing.remove();
    }


    // =====================================================
    // CREATE SELECTION CARD
    // =====================================================

    const selection =
        document.createElement("div");

    selection.id =
        "selected-ground-transport";

    selection.className =
        "selected-transport";


    selection.innerHTML = `

        <h3>
            ✅ Selected ${mode}
        </h3>

        <br>

        <p>
            🚆🚗 <strong>Transport:</strong>
            ${mode}
        </p>

        <p>
            💰 <strong>Transport Cost:</strong>
            ₹${transportCost.toLocaleString("en-IN")}
        </p>

        <hr>

        <h3>
            💰 Current Trip Total
        </h3>

        <br>

        <p>
            🚆🚗 <strong>Transport:</strong>
            ₹${transportCost.toLocaleString("en-IN")}
        </p>

        <p>
            💰 <strong>Current Total:</strong>
            ₹${transportCost.toLocaleString("en-IN")}
        </p>

        <p class="data-note">
            This is your running trip cost.
            Accommodation, food and activities
            will be added as you select them.
        </p>

    `;


    result.appendChild(selection);


    // =====================================================
    // SCROLL TO SELECTION
    // =====================================================

    selection.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}

// =========================================================
// HOTELS — REAL LIVE HOTEL DATA
// =========================================================

async function loadHotels(section, trip) {

    section.innerHTML = `

        <h2>🏨 Hotels</h2>

        <p>
            🔎 Searching real hotel prices...
        </p>

    `;

    const params = new URLSearchParams({

        destination: trip.destination,

        start_date: trip.start_date,

        end_date: trip.end_date,

        people: trip.people

    });


    try {

        const response = await fetch(
            `http://127.0.0.1:8000/hotels?${params.toString()}`
        );


        const data = await response.json();


        if (!response.ok || data.error) {

            throw new Error(
                data.error ||
                "Could not load hotel information."
            );

        }


        if (
            !Array.isArray(data.hotels) ||
            data.hotels.length === 0
        ) {

            section.innerHTML = `

                <h2>🏨 Hotels</h2>

                <p>
                    😕 No   with live pricing
                    were found for these dates.
                </p>

            `;

            return;

        }


        renderHotels(
            section,
            data.hotels,
            trip
        );


    } catch (error) {

        console.error(
            "Hotel search error:",
            error
        );


        section.innerHTML = `

            <h2>🏨 Hotels</h2>

            <p>
                ❌ ${error.message}
            </p>

        `;

    }
}


// =========================================================
// RENDER HOTEL CARDS
// =========================================================

function renderHotels(section, hotels, trip) {

    section.innerHTML = `

        <h2>🏨 Hotels</h2>

        <p>
            Real hotel availability and prices
            found for your trip.
        </p>

        <p class="data-note">

            🟢 Prices come from live Google Hotels
            search data.

        </p>

        <div
            class="hotel-grid"
            id="hotel-list"
        ></div>

    `;


    const hotelList =
        document.getElementById(
            "hotel-list"
        );


    hotels.forEach(function(hotel, index) {

        const hotelCard =
            document.createElement("div");


        hotelCard.className =
            "hotel-card";


        const ratingHTML =
            hotel.rating !== null &&
            hotel.rating !== undefined
                ? `
                    <p>
                        ⭐ <strong>Rating:</strong>
                        ${hotel.rating}
                        ${
                            hotel.reviews
                                ? `(${hotel.reviews} reviews)`
                                : ""
                        }
                    </p>
                `
                : "";


        const classHTML =
            hotel.hotel_class
                ? `
                    <p>
                        🏨 <strong>Class:</strong>
                        ${hotel.hotel_class}
                    </p>
                `
                : "";


        const amenitiesHTML =
            Array.isArray(hotel.amenities) &&
            hotel.amenities.length > 0
                ? `
                    <p>
                        🛎️ <strong>Amenities:</strong>
                        ${hotel.amenities
                            .slice(0, 6)
                            .join(", ")}
                    </p>
                `
                : "";


        const priceHTML =
            hotel.price_per_night !== null &&
            hotel.price_per_night !== undefined
                ? `
                    <p>
                        💰 <strong>From:</strong>
                        ₹${Number(
                            hotel.price_per_night
                        ).toLocaleString("en-IN")}
                        / night
                    </p>
                `
                : `
                    <p>
                        💰 Live price unavailable
                    </p>
                `;


        const totalPriceHTML =
            hotel.total_price !== null &&
            hotel.total_price !== undefined
                ? `
                    <p>
                        💵 <strong>Stay total:</strong>
                        ₹${Number(
                            hotel.total_price
                        ).toLocaleString("en-IN")}
                    </p>
                `
                : "";


        const bookingButtonHTML =
            hotel.hotel_website
                ? `
                    <a
                        href="${hotel.hotel_website}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hotel-booking-button"
                    >
                        🔎 Explore / Booking
                    </a>
                `
                : `
                    <p class="data-note">
                        Booking link unavailable
                        for this property.
                    </p>
                `;


        hotelCard.innerHTML = `

            <button
                type="button"
                class="hotel-header"
                onclick="toggleHotel(${index})"
            >

                <span>
                    🏨 ${hotel.name}
                </span>

                <span
                    id="hotel-arrow-${index}"
                    class="hotel-arrow"
                >
                    ▼
                </span>

            </button>


            <div
                id="hotel-details-${index}"
                class="hotel-details"
            >

                <a
                    href="https://www.openstreetmap.org/?mlat=${hotel.latitude}&mlon=${hotel.longitude}#map=18/${hotel.latitude}/${hotel.longitude}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="hotel-map-button"
                >
                    🗺️ View Hotel Location on OpenStreetMap
                </a>

                ${classHTML}

                ${ratingHTML}

                ${priceHTML}

                ${totalPriceHTML}

                ${amenitiesHTML}

                <br>

                ${bookingButtonHTML}

                <br><br>

                <button
                    type="button"
                    class="main-button select-hotel"
                >
                    ✅ Select Hotel
                </button>

            </div>

        `;


        hotelList.appendChild(
            hotelCard
        );


        const selectButton =
            hotelCard.querySelector(
                ".select-hotel"
            );

        selectButton.addEventListener(
            "click",
            function() {

                selectHotel(
                    hotel,
                    trip
                );

            }
        );

    });

}

// =========================================================
// TOGGLE HOTEL
// =========================================================

function toggleHotel(index) {

    const details =
        document.getElementById(
            `hotel-details-${index}`
        );

    const arrow =
        document.getElementById(
            `hotel-arrow-${index}`
        );


    if (!details) {
        return;
    }


    const isOpen =
        details.classList.contains(
            "open"
        );


    // Close every hotel

    document
        .querySelectorAll(
            ".hotel-details"
        )
        .forEach(function(item) {

            item.classList.remove(
                "open"
            );

        });


    document
        .querySelectorAll(
            ".hotel-arrow"
        )
        .forEach(function(item) {

            item.textContent = "▼";

        });


    // Open selected hotel

    if (!isOpen) {

        details.classList.add(
            "open"
        );

        arrow.textContent = "▲";

    }

}

// =========================================================
// SELECT HOTEL
// =========================================================

function selectHotel(
    hotel,
    trip
) {

    const selectedCost =
        Number(hotel.total_price);

    if (
        !Number.isFinite(selectedCost) ||
        selectedCost <= 0
    ) {

        alert(
            "ROAMLY cannot add this hotel because a valid hotel price was not returned."
        );

        return;
    }


    // =====================================================
    // INITIALIZE STATE IF NEEDED
    // =====================================================

    if (!window.roamlyTripState) {

        window.roamlyTripState = {

            trip: trip,

            transport: null,

            hotel: null,

            totalCost: 0

        };

    }


    // =====================================================
    // SAVE SELECTED HOTEL
    // =====================================================

    window.roamlyTripState.hotel = {

        name:
            hotel.name,

        address:
            hotel.address,

        price:
            selectedCost

    };


    // =====================================================
    // GET TRANSPORT COST
    // =====================================================

    const transportCost =
        window.roamlyTripState.transport &&
        Number(
            window.roamlyTripState.transport.cost
        )
            ? Number(
                window.roamlyTripState.transport.cost
            )
            : 0;


    // =====================================================
    // UPDATE TOTAL
    // =====================================================

    window.roamlyTripState.totalCost =
        transportCost +
        selectedCost;


    // =====================================================
    // RUNNING TOTAL CARD
    // =====================================================

    let totalCard =
        document.getElementById(
            "roamly-running-total"
        );


    if (!totalCard) {

        totalCard =
            document.createElement(
                "div"
            );

        totalCard.id =
            "roamly-running-total";

        totalCard.className =
            "selected-transport";

        document
            .getElementById(
                "result-content"
            )
            .appendChild(
                totalCard
            );

    }


    totalCard.innerHTML = `

        <h3>
            💰 ROAMLY Running Trip Total
        </h3>

        <br>

        <p>
            🚆🚗✈️
            <strong>Transport:</strong>

            ₹${transportCost.toLocaleString(
                "en-IN"
            )}
        </p>

        <p>
            🏨
            <strong>Hotel:</strong>

            ₹${selectedCost.toLocaleString(
                "en-IN"
            )}
        </p>

        <hr>

        <p>
            💰
            <strong>Current Total:</strong>

            ₹${window.roamlyTripState.totalCost.toLocaleString(
                "en-IN"
            )}
        </p>

        <p class="data-note">
            Hotel selected successfully.
            Its total stay price has been added
            to your running trip cost.
        </p>

    `;


    totalCard.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

}


// =========================================================
// LIVE HOTEL ROOMS
// =========================================================

async function loadHotelRooms(
    container,
    hotel,
    trip,
    button
) {

    if (!hotel.property_token) {

        container.innerHTML = `

            <p>
                ⚠️ Live room information is
                unavailable for this hotel.
            </p>

        `;

        return;

    }


    button.disabled = true;

    button.textContent =
        "🔎 Checking live rooms...";


    container.innerHTML = `

        <p>
            🔎 Fetching current room types,
            prices and booking options...
        </p>

    `;


    const params = new URLSearchParams({

        property_token:
            hotel.property_token,

        destination:
            trip.destination,

        start_date:
            trip.start_date,

        end_date:
            trip.end_date,

        people:
            trip.people

    });


    try {

        const response = await fetch(
            `http://127.0.0.1:8000/hotel-rooms?${params.toString()}`
        );


        const data = await response.json();


        if (!response.ok || data.error) {

            throw new Error(
                data.error ||
                "Could not fetch live room information."
            );

        }


        if (
            !Array.isArray(data.rooms) ||
            data.rooms.length === 0
        ) {

            container.innerHTML = `

                <div class="hotel-card">

                    <p>
                        😕 No live room details
                        are currently available
                        for this property.
                    </p>

                    <p class="data-note">

                        You can still use the
                        Explore / Booking link
                        above to check availability.

                    </p>

                </div>

            `;

            return;

        }


        renderHotelRooms(
            container,
            data.rooms,
            hotel,
            trip
        );


    } catch (error) {

        console.error(
            "Hotel room error:",
            error
        );


        container.innerHTML = `

            <div class="hotel-card">

                <p>
                    ❌ ${error.message}
                </p>

            </div>

        `;

    } finally {

        button.disabled = false;

        button.textContent =
            "🛏️ Check Live Rooms & Prices";

    }

}


// =========================================================
// RENDER LIVE ROOM OPTIONS
// =========================================================

function renderHotelRooms(
    container,
    rooms,
    hotel,
    trip
) {

    container.innerHTML = `

        <br>

        <h4>
            🛏️ Live Room Options
        </h4>

        <p class="data-note">

            Select the exact room you want.
            Only prices returned by the live
            hotel search are shown.

        </p>

        <div
            class="hotel-room-list"
        ></div>

    `;


    const roomList =
        container.querySelector(
            ".hotel-room-list"
        );


    rooms.forEach(function(room) {

        const roomCard =
            document.createElement("div");


        roomCard.className =
            "transport-card";


        const roomPriceHTML =
            room.price_per_night !== null &&
            room.price_per_night !== undefined
                ? `
                    <p>
                        💰 <strong>
                            Price per night:
                        </strong>

                        ₹${Number(
                            room.price_per_night
                        ).toLocaleString("en-IN")}
                    </p>
                `
                : "";


        const totalPriceHTML =
            room.total_price !== null &&
            room.total_price !== undefined
                ? `
                    <p>
                        💵 <strong>
                            Total stay price:
                        </strong>

                        ₹${Number(
                            room.total_price
                        ).toLocaleString("en-IN")}
                    </p>
                `
                : `
                    <p class="data-note">
                        Total stay price unavailable.
                    </p>
                `;


        const guestsHTML =
            room.guests
                ? `
                    <p>
                        👥 <strong>
                            Guests:
                        </strong>
                        ${room.guests}
                    </p>
                `
                : "";


        const bookingHTML =
            room.booking_url
                ? `
                    <a
                        href="${room.booking_url}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="main-button"
                    >
                        🔎 View / Book This Room
                    </a>
                `
                : "";


        roomCard.innerHTML = `

            <h4>
                🛏️ ${room.room_name}
            </h4>

            <p>
                🏷️ <strong>Source:</strong>
                ${room.source || "Booking provider"}
            </p>

            ${guestsHTML}

            ${roomPriceHTML}

            ${totalPriceHTML}

            ${bookingHTML}

            <br><br>

            <button
                type="button"
                class="main-button select-hotel-room"
            >
                Select This Room
            </button>

        `;


        roomList.appendChild(
            roomCard
        );


        const selectButton =
            roomCard.querySelector(
                ".select-hotel-room"
            );


        selectButton.addEventListener(
            "click",
            function() {

                selectHotelRoom(
                    hotel,
                    room,
                    trip
                );

            }
        );

    });

}


// =========================================================
// SELECT HOTEL ROOM
// =========================================================

function selectHotelRoom(
    hotel,
    room,
    trip
) {

    const selectedCost =
        Number(room.total_price);


    if (
        !Number.isFinite(selectedCost) ||
        selectedCost <= 0
    ) {

        alert(
            "ROAMLY cannot add this room because a real total stay price was not returned."
        );

        return;

    }


    // =====================================================
    // INITIALIZE STATE IF NEEDED
    // =====================================================

    if (!window.roamlyTripState) {

        window.roamlyTripState = {

            trip: trip,

            transport: null,

            hotel: null,

            totalCost: 0

        };

    }


    window.roamlyTripState.hotel = {

        name:
            hotel.name,

        address:
            hotel.address,

        room_name:
            room.room_name,

        source:
            room.source,

        booking_url:
            room.booking_url,

        price:
            selectedCost

    };


    // =====================================================
    // CALCULATE CURRENT TOTAL
    // =====================================================

    const transportCost =
        window.roamlyTripState.transport &&
        Number(
            window.roamlyTripState.transport.cost
        )
            ? Number(
                window.roamlyTripState.transport.cost
            )
            : 0;


    window.roamlyTripState.totalCost =
        transportCost +
        selectedCost;


    // =====================================================
    // SHOW RUNNING TOTAL
    // =====================================================

    let totalCard =
        document.getElementById(
            "roamly-running-total"
        );


    if (!totalCard) {

        totalCard =
            document.createElement(
                "div"
            );

        totalCard.id =
            "roamly-running-total";

        totalCard.className =
            "selected-transport";

        document
            .getElementById(
                "result-content"
            )
            .appendChild(
                totalCard
            );

    }


    totalCard.innerHTML = `

        <h3>
            💰 ROAMLY Running Trip Total
        </h3>

        <br>

        <p>
            🚆🚗✈️
            <strong>Transport:</strong>

            ₹${transportCost.toLocaleString(
                "en-IN"
            )}
        </p>

        <p>
            🏨
            <strong>Hotel:</strong>

            ₹${selectedCost.toLocaleString(
                "en-IN"
            )}
        </p>

        <hr>

        <p>
            💰
            <strong>Current Total:</strong>

            ₹${window.roamlyTripState.totalCost
                .toLocaleString("en-IN")}
        </p>

        <p class="data-note">

            This is the real cost of the
            options you have selected so far.

            Food, attractions and other
            expenses will be added later.

        </p>

    `;


    totalCard.scrollIntoView({

        behavior: "smooth",

        block: "center"

    });

}

// =========================================================
// ATTRACTIONS
// =========================================================

// =========================================================
// ATTRACTIONS
// =========================================================




async function loadPlaces(section, trip) {
    section.innerHTML = `
        <h2>📍 Attractions</h2>
        <p id="places-loading">⏳ Loading attractions...</p>
    `;

    try {
        const response = await fetch(
            `http://127.0.0.1:8000/places?destination=${encodeURIComponent(trip.destination)}`
        );

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || "Could not load attractions.");
        }

        if (!Array.isArray(data.places) || data.places.length === 0) {
            section.innerHTML = `
                <h2>📍 Attractions</h2>
                <p>No attractions found.</p>
            `;
            return;
        }

        const safe = value =>
            String(value ?? "Not available").replace(/[&<>"']/g, c => ({
                "&": "&amp;", "<": "&lt;", ">": "&gt;",
                '"': "&quot;", "'": "&#39;"
            })[c]);

        let html = `
            <h2>📍 Attractions</h2>
            <p>Click an attraction to show or hide its details.</p>
            <div class="hotel-grid">
        `;

        data.places.forEach((place, index) => {
            const mapURL =
                place.latitude != null && place.longitude != null
                ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.latitude + "," + place.longitude)}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((place.name || "Attraction") + " " + trip.destination)}`;

            const website = /^https?:\/\//i.test(place.website || "")
                ? place.website
                : "";

            html += `
                <div class="hotel-card attraction-card">
                    <button
                        type="button"
                        class="attraction-toggle"
                        data-panel="roamly-place-${index}"
                        aria-expanded="false">
                        <span class="attraction-arrow">▶</span>
                        📍 ${safe(place.name || "Unnamed attraction")}
                    </button>

                    <div
                        id="roamly-place-${index}"
                        class="attraction-details"
                        style="display:none !important; padding:16px;">
                        <p><strong>Type:</strong> ${safe(place.type || "Attraction")}</p>
                        <p><strong>Rating:</strong> ⭐ ${safe(place.rating)}</p>
                        <p><strong>Reviews:</strong> ${safe(place.reviews)}</p>
                        <p><strong>Entry fee:</strong> ${safe(place.fee)}</p>
                        <p><strong>Opening hours:</strong> ${safe(place.opening_hours)}</p>
                        <p><strong>Address:</strong> ${safe(place.address)}</p>
                        <p><strong>About:</strong> ${safe(place.description)}</p>
                        ${website ? `<p><a href="${safe(website)}" target="_blank" rel="noopener noreferrer">🌐 Official Website</a></p>` : ""}
                        <p>
                            <a href="${mapURL}" target="_blank"
                               rel="noopener noreferrer" class="main-button">
                                🗺️ Navigate with Google Maps
                            </a>
                        </p>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        section.innerHTML = html;

        // One click handler for all attraction buttons.
        section.addEventListener("click", function (event) {
            const button = event.target.closest(".attraction-toggle");

            if (!button || !section.contains(button)) return;

            const panel = document.getElementById(button.dataset.panel);
            if (!panel) return;

            const opening = button.getAttribute("aria-expanded") !== "true";

            // Explicitly show/hide, overriding conflicting CSS.
            panel.style.setProperty(
                "display",
                opening ? "block" : "none",
                "important"
            );

            button.setAttribute("aria-expanded", String(opening));

            const arrow = button.querySelector(".attraction-arrow");
            if (arrow) arrow.textContent = opening ? "▼" : "▶";
        });

    } catch (error) {
        console.error("Attraction loading failed:", error);

        section.innerHTML = `
            <h2>📍 Attractions</h2>
            <p>❌ ${safeErrorMessage(error)}</p>
            <p>Check that the backend is running.</p>
        `;
    }

    function safeErrorMessage(error) {
        return String(error.message || "Could not load attractions.")
            .replace(/[&<>"']/g, c => ({
                "&": "&amp;", "<": "&lt;", ">": "&gt;",
                '"': "&quot;", "'": "&#39;"
            })[c]);
    }
}


// =========================================================
// TOGGLE ATTRACTION
// =========================================================

function toggleAttraction(index) {

    const details =
        document.getElementById(
            `attraction-details-${index}`
        );

    const arrow =
        document.getElementById(
            `attraction-arrow-${index}`
        );


    if (!details) {
        return;
    }


    const isOpen =
        details.classList.contains(
            "open"
        );


    // Close every attraction

    document
        .querySelectorAll(
            ".attraction-details"
        )
        .forEach(function(item) {

            item.classList.remove(
                "open"
            );

        });


    document
        .querySelectorAll(
            ".attraction-arrow"
        )
        .forEach(function(item) {

            item.textContent = "▼";

        });


    // Open selected attraction

    if (!isOpen) {

        details.classList.add(
            "open"
        );

        arrow.textContent = "▲";

    }

}

