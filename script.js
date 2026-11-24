// =========================================================
// ROAMLY — SCRIPT.JS
// PART 1: TRIP PLANNING, FLIGHTS AND GROUND TRANSPORT
// =========================================================

const ROAMLY_API = "http://127.0.0.1:8000";

window.roamlyRouteDetails = {};
window.roamlyTripState = null;
window.roamlyCurrentTrip = null;

// =========================================================
// ROAMLY — CATEGORY-WISE BUDGET MANAGEMENT
// =========================================================

window.roamlyBudgetLimits = window.roamlyBudgetLimits || {
    transport: null,
    hotel: null
};


// Get the maximum budget for a category
function getBudgetLimit(category) {

    const value = Number(window.roamlyBudgetLimits[category]);

    return Number.isFinite(value) && value > 0
        ? value
        : null;
}


// Check whether an option exceeds its category budget
function isOverBudget(category, amount) {

    const limit = getBudgetLimit(category);
    const cost = Number(amount);

    if (limit === null || !Number.isFinite(cost)) {
        return false;
    }

    return cost > limit;
}


// Validate a selection before accepting it
function canSelectWithinBudget(category, amount) {

    const limit = getBudgetLimit(category);
    const cost = Number(amount);

    if (limit === null) {

        alert(
            `Please enter your maximum ${category} budget first.`
        );

        return false;
    }

    if (!Number.isFinite(cost) || cost <= 0) {

        alert("The selected option has an invalid price.");

        return false;
    }

    if (cost > limit) {

        alert(
            `Amount exceeding the budget.\n\n` +
            `Selected ${category} cost: ${formatMoney(cost)}\n` +
            `Your ${category} budget: ${formatMoney(limit)}\n\n` +
            `Increase your budget or choose another option.`
        );

        return false;
    }

    return true;
}


function updateBudgetLimitsFromInputs() {

    const transportInput =
        document.getElementById("max-transport-budget");

    const hotelInput =
        document.getElementById("max-hotel-budget");

    const transportValue = Number(transportInput?.value);
    const hotelValue = Number(hotelInput?.value);

    window.roamlyBudgetLimits.transport =
        transportInput?.value.trim() &&
        Number.isFinite(transportValue) &&
        transportValue > 0
            ? transportValue
            : null;

    window.roamlyBudgetLimits.hotel =
        hotelInput?.value.trim() &&
        Number.isFinite(hotelValue) &&
        hotelValue > 0
            ? hotelValue
            : null;


    // Check the currently selected hotel against the updated limit.
    const hotel = window.roamlyTripState?.hotel;
    const hotelLimit = getBudgetLimit("hotel");

    const hotelOverBudget = Boolean(
        hotel &&
        hotelLimit !== null &&
        Number(hotel.price) > hotelLimit
    );


    // Show one toast when the hotel first becomes over budget.
    if (hotelOverBudget && !window.roamlyHotelBudgetWarningShown) {

        const message =
            `Amount exceeding the budget. Selected hotel cost: ` +
            `${formatMoney(hotel.price)}. Your hotel budget: ` +
            `${formatMoney(hotelLimit)}. Increase your budget or choose another option.`;

        if (typeof window.roamlyToast === "function") {
            window.roamlyToast(message, "warn");
        } else {
            alert(message);
        }
    }

    window.roamlyHotelBudgetWarningShown = hotelOverBudget;


    // Remove the hotel highlight while it exceeds the budget.
    if (hotelOverBudget) {

        if (typeof clearSelected === "function") {
            clearSelected("#hotel-dropdown");
        }

    } else if (
        hotel &&
        window.roamlyLastSelectButton &&
        window.roamlyLastSelectButton.matches(
            ".select-hotel, .select-hotel-room"
        ) &&
        typeof applySelectionHighlight === "function"
    ) {

        // Restore the highlight when the hotel is back within budget.
        applySelectionHighlight();
    }


    if (typeof renderRunningTotal === "function") {
        renderRunningTotal();
    }

    if (typeof updateFinalizeButton === "function") {
        updateFinalizeButton();
    }
}


// Listen for changes in either budget input
document.addEventListener("input", function (event) {

    if (
        event.target.id === "max-transport-budget" ||
        event.target.id === "max-hotel-budget"
    ) {
        updateBudgetLimitsFromInputs();
    }

});

// =========================================================
// SHARED HELPERS
// =========================================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function formatMoney(value) {
    return "₹" + Number(value || 0).toLocaleString("en-IN");
}

function safeErrorMessage(error) {
    return escapeHTML(error?.message || "Something went wrong.");
}

function directionsUrl(destination, origin) {
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("destination", destination);

    if (origin) {
        url.searchParams.set("origin", origin);
    }

    url.searchParams.set("travelmode", "driving");
    return url.toString();
}

function openDirections(destination) {
    window.open(
        directionsUrl(destination),
        "_blank",
        "noopener,noreferrer"
    );
}


// =========================================================
// PLAN MY TRIP
// =========================================================


const planButton = document.getElementById("plan-button");

if (planButton) {
    planButton.addEventListener("click", async function () {

        const from = document.getElementById("from").value.trim();
        const destination = document.getElementById("destination").value.trim();
        const startDate = document.getElementById("start-date").value;
        const endDate = document.getElementById("end-date").value;
        const people = Number(document.getElementById("people").value);

        if (!from || !destination || !startDate || !endDate) {
            alert("Please fill all required fields.");
            return;
        }

        if (!Number.isInteger(people) || people < 1) {
            alert("Number of travelers must be at least 1.");
            return;
        }

        if (new Date(endDate) <= new Date(startDate)) {
            alert("End date must be after start date.");
            return;
        }

        const result = document.getElementById("result-content");

        if (!result) {
            console.error("ROAMLY result-content element was not found.");
            return;
        }

        // Determine whether this is a saved trip being edited.
        const isEditingSavedTrip = window.roamlyEditingSavedTrip === true;

        // Consume the editing flag so the next normal plan starts fresh.
        window.roamlyEditingSavedTrip = false;

        if (!isEditingSavedTrip) {
            // A genuinely new trip: clear previous selections.
            window.roamlyTripState = null;
            window.roamlyRouteDetails = {};
            window.roamlyEditingTripId = null;
        }

        // Allow the edited trip to be finalized again.
        window.roamlyFinalizedKey = null;

        // Update the current trip details.
        window.roamlyCurrentTrip = {
            from_location: from,
            destination,
            start_date: startDate,
            end_date: endDate,
            people
        };

        if (typeof setDashboardView === "function") {
            setDashboardView("transport");
        }

        if (typeof renderRunningTotal === "function") {
            renderRunningTotal();
        }

        showPlanScreen();

        result.innerHTML = `
            <div class="loader">
                <span class="spinner" aria-hidden="true"></span>
                <p>${isEditingSavedTrip
                    ? "Reopening your trip plan…"
                    : "Preparing your trip…"
                }</p>
            </div>
        `;

        planButton.disabled = true;

        try {
            const response = await fetch(`${ROAMLY_API}/plan-trip`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    from_location: from,
                    destination,
                    start_date: startDate,
                    end_date: endDate,
                    people
                })
            });

            const data = await response.json();

            if (!response.ok || data.error) {
                throw new Error(
                    data.error || "Unable to estimate trip budget."
                );
            }

            // Retain the existing trip estimate.
            const trip = {
                ...window.roamlyCurrentTrip,
                ...(data.trip || {})
            };

            // Existing selections remain untouched when editing.
            showTransportPlanning(result, trip);

            // Restore visual highlighting for previously selected options.
            if (isEditingSavedTrip) {
                requestAnimationFrame(() => {
                    if (typeof applySelectionHighlight === "function") {
                        applySelectionHighlight();
                    }
                });
            }

            // Refresh the running total after the planning screen loads.
            if (typeof renderRunningTotal === "function") {
                renderRunningTotal();
            }

        } catch (error) {
            console.error("Trip planning error:", error);

            result.innerHTML = `
                <p>❌ ${safeErrorMessage(error)}</p>
                <p class="data-note">
                    Check that the ROAMLY backend is running and try again.
                </p>
            `;
        } finally {
            planButton.disabled = false;
        }
    });
}



// =========================================================
// DISPLAY THE TRANSPORT, HOTEL AND ATTRACTION SECTIONS
// =========================================================

function showTransportPlanning(result, trip) {

    result.innerHTML = `
        <section class="transport-section" id="transport-section">
            <h2>Transport</h2>
            <div class="loader">
                <span class="spinner" aria-hidden="true"></span>
                <p>Finding the best transport options…</p>
            </div>
        </section>

        <details class="route-card dropdown-section" id="hotel-dropdown">
            <summary>
                <span>Hotels</span>
                <span class="dropdown-arrow">⌄</span>
            </summary>

            <div id="hotel-section">
                <p>
                    Searching hotels in
                    <strong>${escapeHTML(trip.destination)}</strong>
                    for your trip dates...
                </p>
            </div>
        </details>
    `;

    // Load transportation and hotels independently.
    loadTransport(
        document.getElementById("transport-section"),
        trip
    );

    loadHotels(
        document.getElementById("hotel-section"),
        trip
    );
}

// =========================================================
// AIRPORT CODE LOOKUP
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

    return airports[String(city || "").trim().toLowerCase()] || null;
}


// =========================================================
// GET FLIGHTS FROM BACKEND
// =========================================================


async function getFlights(from, destination, startDate, endDate, people) {
    const fromCode = getAirportCode(from);
    const toCode = getAirportCode(destination);

    if (!fromCode || !toCode) {
        return {
            error: "Flight search is currently available only for selected major cities."
        };
    }

    const params = new URLSearchParams({
        from_airport: fromCode,
        to_airport: toCode,
        outbound_date: startDate,
        adults: String(people)
    });

    // Include return_date only when explicitly provided.
    if (endDate) {
        params.set("return_date", endDate);
    }

    try {
        const response = await fetch(
            `${ROAMLY_API}/flights?${params.toString()}`
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Flight service returned an error."
            );
        }

        return data;

    } catch (error) {
        console.error("Flight API error:", error);

        return {
            error: error.message || "Unable to connect to the flight service."
        };
    }
}


// =========================================================
// AIRPORT / STATION ROUTE DETAILS
// =========================================================

function createRouteNote(kind, from, to) {

    window.roamlyRouteDetails = window.roamlyRouteDetails || {};

    window.roamlyRouteDetails[kind] = {
        departure: from,
        arrival: to
    };

    const isFlight = kind === "flight";
    const placeType = isFlight ? "airport" : "railway station";

    function createStop(label, place) {

        const name = place?.name || "Not available";
        const code = place?.code || "";

        const display = code ? `${name} (${code})` : name;

        return `
            <div class="route-stop">
                <div>
                    <span class="route-stop-label">${label}</span>
                    <strong>${escapeHTML(display)}</strong>
                </div>

                <button
                    type="button"
                    class="main-button nav-go"
                    data-destination="${escapeHTML(name + " " + placeType)}">
                    Navigate
                </button>
            </div>
        `;
    }

    const tip = isFlight
        ? "Reach the airport about 2 hours early for a smooth start."
        : "Reach the station 30 to 45 minutes early to find your platform.";

    return `
        <div class="route-note">
            <div class="route-note-title">Getting there</div>

            ${createStop(
                `Board your ${isFlight ? "flight" : "train"} at`,
                from
            )}

            ${createStop(
                "You will arrive at",
                to
            )}

            <p class="route-note-tip">${tip}</p>
        </div>
    `;
}


// =========================================================
// GOOGLE MAPS NAVIGATION PANEL
// =========================================================

function createNavigationPanel(prefix, heading) {

    return `
        <div class="roamly-navigation-panel"
             data-navigation-panel="${prefix}">

            <h4>Navigate to your station / airport</h4>

            <p class="data-note">
                ${escapeHTML(heading)}. Enter both locations to open directions
                in Google Maps.
            </p>

            <label for="${prefix}-origin">Starting location</label>

            <input
                id="${prefix}-origin"
                type="text"
                placeholder="Enter your current location"
                autocomplete="street-address">

            <label for="${prefix}-destination">Station / airport</label>

            <input
                id="${prefix}-destination"
                type="text"
                placeholder="Enter station or airport name"
                autocomplete="off">

            <button
                class="main-button roamly-open-navigation"
                type="button"
                data-navigation-prefix="${prefix}">
                Open navigation in Google Maps ↗
            </button>
        </div>
    `;
}

function bindNavigationPanel(container, prefix) {

    const panel = container.querySelector(
        `[data-navigation-panel="${prefix}"]`
    );

    if (!panel) return;

    const originInput = panel.querySelector(`#${prefix}-origin`);
    const destinationInput = panel.querySelector(`#${prefix}-destination`);
    const openButton = panel.querySelector(".roamly-open-navigation");

    if (!originInput || !destinationInput || !openButton) return;

    openButton.addEventListener("click", function () {

        const origin = originInput.value.trim();
        const destination = destinationInput.value.trim();

        if (!origin || !destination) {
            alert("Please enter both your starting location and the station/airport destination.");
            return;
        }

        const url = new URL("https://www.google.com/maps/dir/");
        url.searchParams.set("api", "1");
        url.searchParams.set("origin", origin);
        url.searchParams.set("destination", destination);
        url.searchParams.set("travelmode", "driving");

        window.open(url.toString(), "_blank", "noopener,noreferrer");
    });
}


// =========================================================
// SELECT A FLIGHT
// =========================================================

function selectRealFlight(
    result,
    trip,
    flight,
    flightPrice,
    pricePerPerson,
    journeyType
) {
    const transportCost = Number(flightPrice);
    const travelers = Math.max(1, Number(trip.people) || 1);
    const individualCost = Number(pricePerPerson);

    if (
        !Number.isFinite(transportCost) ||
        transportCost <= 0 ||
        !Number.isFinite(individualCost) ||
        individualCost <= 0
    ) {
        alert("The flight fare is invalid.");
        return;
    }

    if (!canSelectWithinBudget("transport", transportCost)) {
        return;
    }

    const firstLeg = flight?.flights?.[0] || {};
    const lastLeg = flight?.flights?.[
        (flight?.flights?.length || 1) - 1
    ] || {};

    const previousState = window.roamlyTripState || {};
    const previousTransport = previousState.transport || {};

    const journeyLeg = trip.journey_leg || "departure";
    const isReturn = journeyLeg === "return";

    const departureAirport = firstLeg.departure_airport || {};
    const arrivalAirport = lastLeg.arrival_airport || {};

    // Save airport details separately for each journey leg.
    if (!window.roamlyRouteDetails) {
        window.roamlyRouteDetails = {};
    }

    if (!window.roamlyRouteDetails.flightLegs) {
        window.roamlyRouteDetails.flightLegs = {};
    }

    window.roamlyRouteDetails.flightLegs[journeyLeg] = {
        departure: {
            name: departureAirport.name || trip.from_location,
            code: departureAirport.id || ""
        },
        arrival: {
            name: arrivalAirport.name || trip.destination,
            code: arrivalAirport.id || ""
        }
    };

    // Keep the existing departure airport structure for compatibility.
    if (!isReturn) {
        window.roamlyRouteDetails.flight =
            window.roamlyRouteDetails.flightLegs.departure;
    }

    // Create the selected flight record.
    const selectedFlight = {
        mode: "Flight",
        cost: transportCost,
        costPerPerson: individualCost,
        passengers: travelers,
        airline: firstLeg.airline || "",
        flight_number: firstLeg.flight_number || "",
        departure_time: departureAirport.time || "",
        arrival_time: arrivalAirport.time || "",
        journey_leg: journeyLeg
    };

    // Preserve an existing legacy selection as the departure leg.
    const previousDeparture =
        previousTransport.departure ||
        (!previousTransport.departure && previousTransport.mode
            ? previousTransport
            : null);

    const departureSelection = isReturn
        ? previousDeparture
        : selectedFlight;

    const returnSelection = isReturn
        ? selectedFlight
        : previousTransport.return || null;

    const totalTransportCost =
        Number(departureSelection?.cost || 0) +
        Number(returnSelection?.cost || 0);

    // Store both journey legs independently.
    window.roamlyTripState = {
        ...previousState,
        trip,

        transport: {
            departure: departureSelection,
            return: returnSelection,

            // Aggregate fields retained for existing trip calculations.
            mode: returnSelection
                ? "Round Trip"
                : "Flight",

            cost: totalTransportCost,
            journey_type: journeyType,
            return_included: Boolean(returnSelection)
        },

        hotel: previousState.hotel || null,

        totalCost:
            totalTransportCost +
            Number(previousState.hotel?.price || 0)
    };

    if (typeof renderRunningTotal === "function") {
        renderRunningTotal();
    }

    if (typeof updateFinalizeButton === "function") {
        updateFinalizeButton();
    }

    // Show a separate selection card for each journey leg.
    const selectionId = `selected-real-flight-${journeyLeg}`;

    const existing = document.getElementById(selectionId);

    if (existing) {
        existing.remove();
    }

    const selection = document.createElement("div");

    selection.id = selectionId;
    selection.className = "selected-transport";

    selection.innerHTML = `
        <h3>
            Selected ${isReturn ? "Return" : "Departure"} Flight
        </h3>

        <p><strong>Airline:</strong> ${escapeHTML(selectedFlight.airline)}</p>
        <p><strong>Passengers:</strong> ${travelers}</p>

        <p>
            <strong>Flight Cost Per Person:</strong>
            ${formatMoney(individualCost)}
        </p>

        <p>
            <strong>${isReturn ? "Return" : "Departure"} Flight Expense:</strong>
            ${formatMoney(transportCost)}
        </p>

        <hr>

        <h3>Updated Transport Total</h3>

        <p>
            <strong>Departure:</strong>
            ${formatMoney(Number(departureSelection?.cost || 0))}
        </p>

        <p>
            <strong>Return:</strong>
            ${returnSelection
                ? formatMoney(Number(returnSelection.cost || 0))
                : "Not selected yet"}
        </p>

        <p>
            <strong>Total Transport:</strong>
            ${formatMoney(totalTransportCost)}
        </p>

        <p class="data-note">
            This flight has been saved as your
            ${isReturn ? "return" : "departure"} journey.
        </p>
    `;

    result.appendChild(selection);

    selection.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}

// =========================================================
// RENDER FLIGHT OPTIONS
// =========================================================

function renderFlightOptions(section, flightData, trip) {

    if (flightData.error) {
        section.innerHTML = `
            <h3>Flight</h3>
            <p>${escapeHTML(flightData.error)}</p>
            <p class="data-note">
                ROAMLY could not obtain live flight prices for this route.
            </p>
        `;
        return;
    }

    let flights = [
        ...(Array.isArray(flightData.best_flights) ? flightData.best_flights : []),
        ...(Array.isArray(flightData.other_flights) ? flightData.other_flights : [])
    ];

    flights = flights.filter(flight =>
        Number.isFinite(Number(flight.price)) &&
        Number(flight.price) > 0
    );

    if (flights.length === 0) {
        section.innerHTML = `
            <h3>Flight</h3>
            <p>No real flights were found for these dates.</p>
        `;
        return;
    }

    flights.sort((a, b) => Number(a.price) - Number(b.price));

    const cheapFlight = flights[0];

    const averageFlight = flights.length >= 3
        ? flights[Math.floor(flights.length / 2)]
        : (flights.length === 2 ? flights[1] : null);

    const premiumFlight = flights.length >= 3
        ? flights[flights.length - 1]
        : (flights.length === 2 ? flights[1] : null);

    const travelers = Math.max(
        1,
        Number(trip.people) || 1
    );

    const isReturn = trip.journey_leg === "return";

    const journeyLabel = isReturn
        ? "Return"
        : "Departure";

    const journeyType = trip.journey_type || "oneway";

    function createFlightCard(flight, category) {

        if (!flight) {
            return `
                <div class="transport-category-card">
                    <h4>${category}</h4>
                    <p>No separate flight option is available for this category.</p>
                </div>
            `;
        }

        const price = Number(flight.price);
        const estimatedPricePerPerson = price / travelers;

        const legs = Array.isArray(flight.flights)
            ? flight.flights
            : [];

        const firstLeg = legs[0] || {};
        const lastLeg = legs[legs.length - 1] || {};

        const airline = firstLeg.airline ||
            "Airline information unavailable";

        const departure =
            firstLeg.departure_airport?.time || "Not available";

        const arrival =
            lastLeg.arrival_airport?.time || "Not available";

        const duration = flight.total_duration != null
            ? `${flight.total_duration} minutes`
            : "Not available";

        return `
            <div class="transport-category-card">

                <h4>${category}</h4>
                <h3>${escapeHTML(airline)}</h3>

                <p><strong>Departure:</strong> ${escapeHTML(departure)}</p>
                <p><strong>Arrival:</strong> ${escapeHTML(arrival)}</p>
                <p><strong>Duration:</strong> ${escapeHTML(duration)}</p>
                <p><strong>Travelers:</strong> ${travelers}</p>

                <div class="flight-price-details">

                    <p>
                        <strong>Estimated Price per person:</strong>
                        ${formatMoney(estimatedPricePerPerson)}
                    </p>

                    <p>
                        <strong>Estimated Total (${travelers} travelers):</strong>
                        ${formatMoney(price)}
                    </p>

                </div>

                <div class="flight-booking-actions">

                    <button
                        class="main-button check-book-flight"
                        type="button"
                        data-flight-index="${flights.indexOf(flight)}">
                        Check & Book Flight
                    </button>

                    <button
                        class="main-button select-real-flight"
                        type="button"
                        data-flight-index="${flights.indexOf(flight)}">
                        Select This Flight
                    </button>

                </div>

            </div>
        `;
    }

    section.innerHTML = `
        <h3>${journeyLabel} Flight Options</h3>

        <p>
            ${escapeHTML(trip.from_location)}
            → ${escapeHTML(trip.destination)}
        </p>

        <p class="data-note">
            Select a flight for your ${journeyLabel.toLowerCase()} journey.
            Enter its live fare when selecting it.
        </p>

        <div class="transport-category-grid flight-category-grid">

            ${createFlightCard(cheapFlight, "Economy")}
            ${createFlightCard(averageFlight, "Standard")}
            ${createFlightCard(premiumFlight, "Premium")}

        </div>
    `;


    // -----------------------------------------------------
    // AIRLINE BOOKING LINKS
    // -----------------------------------------------------

    const airlineWebsites = {
        "IndiGo": "https://www.goindigo.in/",
        "Air India": "https://www.airindia.com/",
        "Air India Express": "https://www.airindiaexpress.com/",
        "Akasa Air": "https://www.akasaair.com/",
        "SpiceJet": "https://www.spicejet.com/",
        "Vistara": "https://www.airindia.com/"
    };

    section.querySelectorAll(".check-book-flight")
        .forEach(button => {

            button.addEventListener("click", function () {

                const selectedFlight =
                    flights[Number(button.dataset.flightIndex)];

                if (!selectedFlight) return;

                const airline =
                    selectedFlight.flights?.[0]?.airline || "";

                const website = airlineWebsites[airline] ||
                    "https://www.google.com/travel/flights";

                window.open(
                    website,
                    "_blank",
                    "noopener,noreferrer"
                );
            });
        });


    // -----------------------------------------------------
    // SELECT FLIGHT FOR THE CURRENT JOURNEY LEG
    // -----------------------------------------------------

    section.querySelectorAll(".select-real-flight")
        .forEach(button => {

            button.addEventListener("click", function () {

                const selectedFlight =
                    flights[Number(button.dataset.flightIndex)];

                if (!selectedFlight) return;

                const fareInput = prompt(
                    `Enter the live ${journeyLabel.toLowerCase()} flight cost per person (₹):\n\n` +
                    `Number of passengers: ${travelers}`
                );

                if (fareInput === null) return;

                const pricePerPerson = Number(fareInput);

                if (
                    !fareInput.trim() ||
                    !Number.isFinite(pricePerPerson) ||
                    pricePerPerson <= 0
                ) {
                    alert("Please enter a valid live flight fare per person.");
                    return;
                }

                const totalFlightCost =
                    pricePerPerson * travelers;

                selectRealFlight(
                    document.getElementById("result-content"),
                    trip,
                    selectedFlight,
                    totalFlightCost,
                    pricePerPerson,
                    journeyType
                );
            });
        });
}

// =========================================================
// RENDER GROUND TRANSPORT — MANUAL TRAIN + CAR
// =========================================================

function renderGroundTransport(section, data, trip) {

    const options = Array.isArray(data.options) ? data.options : [];

    const cars = options.filter(option => option.mode === "Car");
    const selectedCar = cars[0] || null;

    // -----------------------------------------------------
    // MANUAL TRAIN FARE PANEL
    // -----------------------------------------------------

    function createManualTrainPanel() {

        const isReturn = trip.journey_leg === "return";

        const journeyLabel = isReturn ? "Return" : "Departure";

        return `
            <div class="train-option-card">

                <h3>Train fare calculator</h3>

                <p>
                    Route:
                    ${escapeHTML(trip.from_location)}
                    → ${escapeHTML(trip.destination)}
                </p>

                <p>
                    Journey: <strong>${journeyLabel}</strong>
                </p>

                <p>
                    Passengers: <strong>${Number(trip.people)}</strong>
                </p>

                <p>
                    Check the official fare for your route,
                    journey date and class.
                </p>

                <a
                    href="https://www.irctc.co.in/nget/train-search"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="irctc-fare-button">
                    Check official train fare ↗
                </a>

                <hr>

                <label for="train-live-fare">
                    Live ${journeyLabel} fare per passenger (₹)
                </label>

                <input
                    id="train-live-fare"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Enter live ${journeyLabel.toLowerCase()} fare per passenger">

                <button
                    id="calculate-train-fare"
                    class="main-button"
                    type="button">
                    Calculate and select train
                </button>

                <div id="train-fare-result" aria-live="polite"></div>

            </div>
        `;
    }

    // -----------------------------------------------------
    // TRAIN STATION DETAILS CARD
    // -----------------------------------------------------

    const stationDetails = data.station_details || {};

    const departureStation = stationDetails.departure || {
        name: trip.from_location,
        code: ""
    };

    const arrivalStation = stationDetails.arrival || {
        name: trip.destination,
        code: ""
    };

    // Save station details separately for departure and return.
    window.roamlyRouteDetails =
        window.roamlyRouteDetails || {};

    window.roamlyRouteDetails.trainLegs =
        window.roamlyRouteDetails.trainLegs || {};

    window.roamlyRouteDetails.trainLegs[
        trip.journey_leg || "departure"
    ] = {
        departure: departureStation,
        arrival: arrivalStation
    };

    // Preserve compatibility with older saved trips.
    if ((trip.journey_leg || "departure") === "departure") {
        window.roamlyRouteDetails.train = {
            departure: departureStation,
            arrival: arrivalStation
        };
    }


    const trainStationCard = `
        <div class="train-station-card">

            <div class="station-card-header">
                <div class="station-icon">🚉</div>

                <div>
                    <span class="station-eyebrow">YOUR TRAIN ROUTE</span>
                    <h3>Station Details</h3>
                </div>
            </div>

            <p class="station-card-intro">
                Know exactly where to board your train
                and where you will arrive.
            </p>

            ${createRouteNote(
                "train",
                departureStation,
                arrivalStation
            )}

        </div>
    `;


    // -----------------------------------------------------
    // CAR FUEL ESTIMATOR CARD
    // -----------------------------------------------------

    function createCarCard(car) {

        if (!car) {
            return `
                <div class="transport-category-card">
                    <h4>Fuel Cost Estimator</h4>
                    <p>Car route information is unavailable.</p>
                </div>
            `;
        }

        const distance = Number(car.distance_km);
        const fuelPrice = Number(car.fuel_price);

        const hasDistance =
            Number.isFinite(distance) && distance > 0;

        const hasFuelPrice =
            Number.isFinite(fuelPrice) && fuelPrice > 0;

        const distanceHTML = hasDistance
            ? `<p><strong>One-way distance:</strong> ${distance.toLocaleString("en-IN")} km</p>`
            : `<p>Road distance is unavailable. Open Google Maps to check the route.</p>`;

        const fuelPriceHTML = hasFuelPrice
            ? `<p><strong>Current fuel price:</strong> ${formatMoney(fuelPrice)}/L</p>`
            : `
                <label for="car-fuel-price">
                    Current fuel price per litre (₹)
                </label>

                <input
                    id="car-fuel-price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="Enter current fuel price">
            `;

        const routeURL = car.directions_url || directionsUrl(
            trip.from_location,
            trip.destination
        );

        const journeyLabel = trip.journey_leg === "return"
            ? "Return"
            : "Departure";

        return `
            <div class="transport-category-card car-estimator-card">

                <h4>Fuel Cost Estimator</h4>

                <p>
                    <strong>Journey:</strong> ${journeyLabel}
                </p>

                <h3>${escapeHTML(car.name || "Personal car")}</h3>

                ${distanceHTML}
                ${fuelPriceHTML}

                <button
                    class="main-button"
                    id="calculate-car-cost"
                    type="button">
                    Calculate fuel cost
                </button>

                <div id="car-cost-result" aria-live="polite"></div>

                <p>
                    <a
                        href="${escapeHTML(routeURL)}"
                        target="_blank"
                        rel="noopener noreferrer">
                        View driving route on Google Maps ↗
                    </a>
                </p>

                <p class="data-note">
                    Fuel costs are estimates based on typical mileage.
                    Actual costs vary by vehicle, traffic and driving
                    conditions. Tolls and parking are excluded.
                </p>

                <button
                    class="main-button select-ground-transport"
                    data-mode="Car"
                    data-cost=""
                    type="button"
                    disabled
                    id="select-car-trip">
                    Select Car
                </button>

            </div>
        `;
    }

    // -----------------------------------------------------
    // BUILD THE GROUND TRANSPORT HTML
    // -----------------------------------------------------

    section.innerHTML = `
        <div id="train-mode-results">

            ${createManualTrainPanel()}

        </div>

        <div id="car-mode-results">

            <br><br>

            <h3>Car</h3>

            <p>Estimated fuel costs for your road journey.</p>

            <div class="car-option-grid">
                ${createCarCard(selectedCar)}
            </div>

        </div>
    `;

    // -----------------------------------------------------
    // SHOW THE SELECTED MODE FOR THIS JOURNEY LEG
    // -----------------------------------------------------

    const activeMode = section.dataset.selectedMode || "train";

    const trainBox = section.querySelector("#train-mode-results");
    const carBox = section.querySelector("#car-mode-results");

    if (trainBox) {
        trainBox.hidden = activeMode !== "train";
    }

    if (carBox) {
        carBox.hidden = activeMode !== "car";
    }

    // -----------------------------------------------------
    // MANUAL TRAIN FARE CALCULATION
    // -----------------------------------------------------

    const trainFareInput = section.querySelector("#train-live-fare");
    const trainFareResult = section.querySelector("#train-fare-result");

    section.querySelector("#calculate-train-fare")
        .addEventListener("click", function () {

            const farePerPassenger = Number(trainFareInput.value);

            if (
                !trainFareInput.value.trim() ||
                !Number.isFinite(farePerPassenger) ||
                farePerPassenger <= 0
            ) {
                alert("Enter a valid live train fare per passenger.");
                return;
            }

            const passengers = Math.max(
                1,
                Number(trip.people) || 1
            );

            const total = farePerPassenger * passengers;

            trainFareResult.innerHTML = `
                <hr>

                <h4>Calculated ${trip.journey_leg === "return"
                    ? "return"
                    : "departure"} train cost</h4>

                <p>
                    Fare per passenger:
                    ${formatMoney(farePerPassenger)}
                </p>

                <p>
                    Passengers:
                    ${passengers}
                </p>

                <p>
                    <strong>Total train cost: ${formatMoney(total)}</strong>
                </p>

                <p class="data-note">
                    Based on the live fare you entered.
                    Confirm the final fare and availability on IRCTC
                    before booking.
                </p>
            `;

            selectTrainClass(
                document.getElementById("result-content"),
                trip,
                "MANUAL",
                "Train fare entered by user",
                "User-entered fare",
                total,
                trip.journey_type
            );
        });
    
    // -----------------------------------------------------
    // CAR FUEL COST CALCULATION
    // -----------------------------------------------------

    const calculateCarButton = section.querySelector("#calculate-car-cost");

    if (calculateCarButton) {

        calculateCarButton.addEventListener("click", function () {

            const result = section.querySelector("#car-cost-result");
            const selectButton = section.querySelector("#select-car-trip");
            const fuelInput = section.querySelector("#car-fuel-price");

            const fuelPrice = selectedCar && Number(selectedCar.fuel_price) > 0
                ? Number(selectedCar.fuel_price)
                : Number(fuelInput?.value);

            const distance = Number(selectedCar?.distance_km);

            if (!Number.isFinite(distance) || distance <= 0) {
                result.innerHTML = `
                    <p>⚠️ A valid road distance is unavailable.
                    Check the route on Google Maps.</p>
                `;

                selectButton.disabled = true;
                return;
            }

            if (!Number.isFinite(fuelPrice) || fuelPrice <= 0) {
                result.innerHTML = `
                    <p>⚠️ Enter a valid fuel price per litre.</p>
                `;

                selectButton.disabled = true;
                return;
            }

            // The current leg is already a one-way route.
            const totalDistance = distance;

            const lowCost = Math.round((totalDistance / 25) * fuelPrice);
            const averageCost = Math.round((totalDistance / 15) * fuelPrice);
            const highCost = Math.round((totalDistance / 10) * fuelPrice);

            result.innerHTML = `
                <h4>Estimated fuel cost range</h4>

                <p>
                    <strong>Low estimate (25 km/L):</strong>
                    ${formatMoney(lowCost)}
                </p>

                <p>
                    <strong>Average estimate (15 km/L):</strong>
                    ${formatMoney(averageCost)}
                </p>

                <p>
                    <strong>High estimate (10 km/L):</strong>
                    ${formatMoney(highCost)}
                </p>

                <hr>

                <p>
                    <strong>Driving distance:</strong>
                    ${totalDistance.toLocaleString("en-IN")} km
                </p>

                <p>
                    <strong>Fuel price used:</strong>
                    ${formatMoney(fuelPrice)}/L
                </p>

                <p class="data-note">
                    These are estimates, not guaranteed prices.
                    The average estimate will be used in your trip total.
                </p>
            `;

            selectButton.dataset.cost = String(averageCost);
            selectButton.disabled = false;
        });
    }

    // -----------------------------------------------------
    // SELECT CAR
    // -----------------------------------------------------

    section.querySelectorAll(".select-ground-transport")
        .forEach(button => {

            button.addEventListener("click", function () {

                const mode = button.dataset.mode;
                const cost = Number(button.dataset.cost);

                if (!Number.isFinite(cost) || cost <= 0) {
                    alert("Calculate a valid car fuel cost first.");
                    return;
                }

                selectGroundTransport(
                    document.getElementById("result-content"),
                    trip,
                    mode,
                    cost,
                    selectedCar,
                    trip.journey_type
                );
            });
        });
}


// =========================================================
// LOAD FLIGHTS, TRAINS AND CAR
// =========================================================

async function loadTransport(section, trip) {

    section.innerHTML = `
        <h2>Choose your journey</h2>

        <p class="data-note">
            First select whether you are travelling one way or returning.
        </p>

        <div class="transport-mode-picker journey-choice-picker">

            <button
                class="transport-mode-button journey-type-button"
                data-journey="oneway"
                type="button">
                One-way Trip
            </button>

            <button
                class="transport-mode-button journey-type-button"
                data-journey="roundtrip"
                type="button">
                Round Trip
            </button>

        </div>

        <div id="transport-journey-content" hidden></div>
    `;

    const content = section.querySelector("#transport-journey-content");

    const journeyButtons = section.querySelectorAll(
        ".journey-type-button"
    );

    let temporarilySavedReturnTransport = null;

    function showJourney(journeyType) {

        journeyButtons.forEach(button => {

            const active = button.dataset.journey === journeyType;

            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });

        // Temporarily save the return journey before switching to one-way.
        if (journeyType === "oneway") {

            const state = window.roamlyTripState;

            if (state?.transport) {

                // Save the return selection BEFORE clearing it.
                if (state.transport.return) {
                    temporarilySavedReturnTransport =
                        state.transport.return;
                }

                const departure = state.transport.departure ||
                    (state.transport.mode &&
                    state.transport.mode !== "Round Trip"
                        ? state.transport
                        : null);

                state.transport = {
                    ...state.transport,
                    departure,
                    return: null,
                    mode: departure?.mode || null,
                    cost: Number(departure?.cost || 0),
                    journey_type: "oneway",
                    return_included: false
                };

                state.totalCost =
                    Number(departure?.cost || 0) +
                    Number(state.hotel?.price || 0);
            }

            // Hide the previously selected return cards.
            [
                "selected-ground-transport-return",
                "selected-real-flight-return",
                "selected-train-return"
            ].forEach(id => {
                const element = document.getElementById(id);
                if (element) element.hidden = true;
            });

            renderRunningTotal();
            updateFinalizeButton();
        }
        
        content.hidden = false;

        if (journeyType === "oneway") {

            content.innerHTML = `
                <h3>Select your departure transport</h3>

                <div class="transport-mode-picker">

                    <button class="transport-mode-button" data-mode="flight" type="button">
                        Flights
                    </button>

                    <button class="transport-mode-button" data-mode="train" type="button">
                        Trains
                    </button>

                    <button class="transport-mode-button" data-mode="car" type="button">
                        Car
                    </button>

                </div>

                <p id="transport-mode-prompt" class="data-note">
                    Choose Flights, Trains or Car above.
                </p>

                <div id="transport-results" hidden>

                    <div id="roamly-flight-section" class="route-card" hidden>
                        <p>Searching flight prices...</p>
                    </div>

                    <div id="roamly-ground-section" class="route-card" hidden>
                        <p>Loading ground transport...</p>
                    </div>

                </div>
            `;

        } else {

                // Restore the previously selected return transport.
                const returnState = window.roamlyTripState;

                if (returnState?.transport && temporarilySavedReturnTransport) {

                    returnState.transport.return =
                        temporarilySavedReturnTransport;

                    returnState.transport.journey_type = "roundtrip";
                    returnState.transport.return_included = true;
                    returnState.transport.mode = "Round Trip";

                    returnState.transport.cost =
                        Number(returnState.transport.departure?.cost || 0) +
                        Number(temporarilySavedReturnTransport.cost || 0);

                    returnState.totalCost =
                        returnState.transport.cost +
                        Number(returnState.hotel?.price || 0);

                    [
                        "selected-ground-transport-return",
                        "selected-real-flight-return",
                        "selected-train-return"
                    ].forEach(id => {
                        const element = document.getElementById(id);

                        if (element) {
                            element.hidden = false;
                        }
                    });

                    renderRunningTotal();
                    updateFinalizeButton();
                }
                

            content.innerHTML = `
                <h3>Select your round-trip transport</h3>

                <div class="transport-mode-picker journey-leg-picker">

                    <button
                        class="transport-mode-button journey-leg-button"
                        data-leg="departure"
                        type="button">
                        Select Departure Transport
                    </button>

                    <button
                        class="transport-mode-button journey-leg-button"
                        data-leg="return"
                        type="button">
                        Select Return Transport
                    </button>

                </div>

                <div id="journey-leg-content"></div>
            `;

            const legButtons = content.querySelectorAll(
                ".journey-leg-button"
            );

            const legContent = content.querySelector("#journey-leg-content");

            legButtons.forEach(button => {

                button.addEventListener("click", function () {

                    legButtons.forEach(item => {
                        const active = item === button;

                        item.classList.toggle("active", active);
                        item.setAttribute("aria-pressed", String(active));
                    });

                    const leg = button.dataset.leg;

                    showTransportOptions(
                        legContent,
                        trip,
                        journeyType,
                        leg
                    );
                });
            });

            // Open departure selection first.
            legButtons[0].click();
        }

        if (journeyType === "oneway") {

            showTransportOptions(
                content,
                trip,
                journeyType,
                "departure"
            );
        }
    }

    journeyButtons.forEach(button => {

        button.setAttribute("aria-pressed", "false");

        button.addEventListener("click", function () {
            showJourney(button.dataset.journey);
        });
    });
}


// -----------------------------------------------------
// LOAD OPTIONS FOR THE SELECTED JOURNEY LEG
// -----------------------------------------------------

async function showTransportOptions(container, trip, journeyType, leg) {

    const isReturn = leg === "return";

    const legTrip = {
        ...trip,

        from_location: isReturn
            ? trip.destination
            : trip.from_location,

        destination: isReturn
            ? trip.from_location
            : trip.destination,

        start_date: isReturn
            ? trip.end_date
            : trip.start_date,

        end_date: isReturn
            ? trip.end_date
            : trip.end_date,

        journey_type: journeyType,
        journey_leg: leg
    };

    container.innerHTML = `
        <h3>
            ${isReturn ? "Return Journey" : "Departure Journey"}
        </h3>

        <p class="data-note">
            ${escapeHTML(legTrip.from_location)}
            → ${escapeHTML(legTrip.destination)}
            <br>
            Date: ${escapeHTML(legTrip.start_date)}
        </p>

        <div class="transport-mode-picker">

            <button class="transport-mode-button" data-mode="flight" type="button">
                Flights
            </button>

            <button class="transport-mode-button" data-mode="train" type="button">
                Trains
            </button>

            <button class="transport-mode-button" data-mode="car" type="button">
                Car
            </button>

        </div>

        <p id="transport-mode-prompt" class="data-note">
            Choose Flights, Trains or Car above.
        </p>

        <div id="transport-results" hidden>

            <div id="roamly-flight-section" class="route-card" hidden>
                <p>Searching flight prices...</p>
            </div>

            <div id="roamly-ground-section" class="route-card" hidden>
                <p>Loading ground transport...</p>
            </div>

        </div>
    `;

    const flightSection = container.querySelector("#roamly-flight-section");
    const groundSection = container.querySelector("#roamly-ground-section");
    const results = container.querySelector("#transport-results");
    const prompt = container.querySelector("#transport-mode-prompt");

    const modeButtons = container.querySelectorAll(".transport-mode-button");

    function selectMode(mode) {

        results.hidden = false;
        prompt.hidden = true;

        modeButtons.forEach(button => {

            const active = button.dataset.mode === mode;

            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });

        flightSection.hidden = mode !== "flight";
        groundSection.hidden = mode === "flight";
        // Remember the selected mode for this specific journey leg.
        groundSection.dataset.selectedMode = mode;

        const trainResults = groundSection.querySelector("#train-mode-results");
        const carResults = groundSection.querySelector("#car-mode-results");

        if (trainResults) {
            trainResults.hidden = mode !== "train";
        }

        if (carResults) {
            carResults.hidden = mode !== "car";
        }
    }

    modeButtons.forEach(button => {

        button.setAttribute("aria-pressed", "false");

        button.addEventListener("click", function () {
            selectMode(button.dataset.mode);
        });
    });


    // FLIGHT SEARCH

    (async function () {

        try {

            const flightData = await getFlights(
                legTrip.from_location,
                legTrip.destination,
                legTrip.start_date,
                null,
                legTrip.people
            );

            renderFlightOptions(flightSection, flightData, legTrip);

        } catch (error) {

            console.error("ROAMLY flight loading error:", error);

            flightSection.innerHTML = `
                <h3>Flights</h3>
                <p>❌ ${safeErrorMessage(error)}</p>
            `;
        }

    })();


    // GROUND TRANSPORT SEARCH

    (async function () {

        try {

            const response = await fetch(`${ROAMLY_API}/ground-transport`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    from_location: legTrip.from_location,
                    destination: legTrip.destination,
                    journey_date: legTrip.start_date,
                    people: legTrip.people
                })
            });

            const groundData = await response.json();

            if (
                !response.ok ||
                !Array.isArray(groundData.options)
            ) {
                throw new Error(
                    groundData.error ||
                    "Ground transport service returned an invalid response."
                );
            }

            renderGroundTransport(groundSection, groundData, legTrip);

        } catch (error) {

            console.error("ROAMLY ground transport error:", error);

            groundSection.innerHTML = `
                <h3>Trains & Car</h3>
                <p>❌ ${safeErrorMessage(error)}</p>
            `;
        }

    })();
}

// =========================================================
// SELECT MANUAL TRAIN FARE
// =========================================================

function selectTrainClass(
    result,
    trip,
    trainNumber,
    trainName,
    classCode,
    cost,
    journeyType
) {
    const transportCost = Number(cost);

    if (!Number.isFinite(transportCost) || transportCost <= 0) {
        alert("The train fare is invalid.");
        return;
    }

    if (!canSelectWithinBudget("transport", transportCost)) {
        return;
    }

    const previousState = window.roamlyTripState || {};
    const previousTransport = previousState.transport || {};

    const journeyLeg = trip.journey_leg || "departure";
    const isReturn = journeyLeg === "return";

    const selectedTrain = {
        mode: "Train",
        train_number: trainNumber,
        train_name: trainName,
        class: classCode,
        cost: transportCost,
        journey_leg: journeyLeg
    };

    // Preserve the previously selected journey leg.
    const previousDeparture =
        previousTransport.departure ||
        (!previousTransport.departure && previousTransport.mode
            ? previousTransport
            : null);

    const departureSelection = isReturn
        ? previousDeparture
        : selectedTrain;

    const returnSelection = isReturn
        ? selectedTrain
        : previousTransport.return || null;

    const totalTransportCost =
        Number(departureSelection?.cost || 0) +
        Number(returnSelection?.cost || 0);

    window.roamlyTripState = {
        ...previousState,
        trip,

        transport: {
            departure: departureSelection,
            return: returnSelection,
            mode: returnSelection ? "Round Trip" : "Train",
            cost: totalTransportCost,
            journey_type: journeyType,
            return_included: Boolean(returnSelection)
        },

        hotel: previousState.hotel || null,

        totalCost:
            totalTransportCost +
            Number(previousState.hotel?.price || 0)
    };

    if (typeof renderRunningTotal === "function") {
        renderRunningTotal();
    }

    if (typeof updateFinalizeButton === "function") {
        updateFinalizeButton();
    }

    const selectionId = `selected-ground-transport-${journeyLeg}`;

    const existing = document.getElementById(selectionId);

    if (existing) existing.remove();

    const selection = document.createElement("div");

    selection.id = selectionId;
    selection.className = "selected-transport";

    selection.innerHTML = `
        <h3>Selected ${isReturn ? "Return" : "Departure"} Train</h3>

        <p><strong>Train:</strong> ${escapeHTML(trainName)}</p>
        <p><strong>Train Number:</strong> ${escapeHTML(trainNumber)}</p>
        <p><strong>Class:</strong> ${escapeHTML(classCode)}</p>
        <p><strong>Journey Cost:</strong> ${formatMoney(transportCost)}</p>

        <hr>

        <h3>Updated Transport Total</h3>

        <p>
            <strong>Departure:</strong>
            ${formatMoney(Number(departureSelection?.cost || 0))}
        </p>

        <p>
            <strong>Return:</strong>
            ${returnSelection
                ? formatMoney(Number(returnSelection.cost || 0))
                : "Not selected yet"}
        </p>

        <p>
            <strong>Total Transport:</strong>
            ${formatMoney(totalTransportCost)}
        </p>

        <p class="data-note">
            This train has been saved as your
            ${isReturn ? "return" : "departure"} journey.
        </p>
    `;

    result.appendChild(selection);

    selection.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}

// =========================================================
// SELECT GROUND TRANSPORT
// =========================================================

function selectGroundTransport(
    result,
    trip,
    mode,
    cost,
    carDetails,
    journeyType
) {
    const transportCost = Number(cost);

    if (!Number.isFinite(transportCost) || transportCost <= 0) {
        alert("The transport cost is invalid.");
        return;
    }

    if (!canSelectWithinBudget("transport", transportCost)) {
        return;
    }

    const previousState = window.roamlyTripState || {};
    const previousTransport = previousState.transport || {};

    const journeyLeg = trip.journey_leg || "departure";
    const isReturn = journeyLeg === "return";

    const selectedTransport = {
        ...(carDetails || {}),
        mode,
        cost: transportCost,
        journey_leg: journeyLeg
    };

    const previousDeparture =
        previousTransport.departure ||
        (!previousTransport.departure && previousTransport.mode
            ? previousTransport
            : null);

    const departureSelection = isReturn
        ? previousDeparture
        : selectedTransport;

    const returnSelection = isReturn
        ? selectedTransport
        : previousTransport.return || null;

    const totalTransportCost =
        Number(departureSelection?.cost || 0) +
        Number(returnSelection?.cost || 0);

    window.roamlyTripState = {
        ...previousState,
        trip,

        transport: {
            departure: departureSelection,
            return: returnSelection,
            mode: returnSelection ? "Round Trip" : mode,
            cost: totalTransportCost,
            journey_type: journeyType,
            return_included: Boolean(returnSelection)
        },

        hotel: previousState.hotel || null,

        totalCost:
            totalTransportCost +
            Number(previousState.hotel?.price || 0)
    };

    if (typeof renderRunningTotal === "function") {
        renderRunningTotal();
    }

    if (typeof updateFinalizeButton === "function") {
        updateFinalizeButton();
    }

    const selectionId = `selected-ground-transport-${journeyLeg}`;
    const existing = document.getElementById(selectionId);

    if (existing) existing.remove();

    const selection = document.createElement("div");

    selection.id = selectionId;
    selection.className = "selected-transport";

    selection.innerHTML = `
        <h3>
            Selected ${isReturn ? "Return" : "Departure"} ${escapeHTML(mode)}
        </h3>

        <p>
            <strong>Journey Cost:</strong>
            ${formatMoney(transportCost)}
        </p>

        ${
            mode === "Car" && carDetails
                ? `
                    <p>
                        <strong>Distance:</strong>
                        ${escapeHTML(String(carDetails.distance_km || "—"))} km
                    </p>

                    <p>
                        <strong>Estimated Time:</strong>
                        ${escapeHTML(String(carDetails.estimated_time || "—"))}
                    </p>
                `
                : ""
        }

        <hr>

        <h3>Updated Transport Total</h3>

        <p>
            <strong>Departure:</strong>
            ${formatMoney(Number(departureSelection?.cost || 0))}
        </p>

        <p>
            <strong>Return:</strong>
            ${
                returnSelection
                    ? formatMoney(Number(returnSelection.cost || 0))
                    : "Not selected yet"
            }
        </p>

        <p>
            <strong>Total Transport:</strong>
            ${formatMoney(totalTransportCost)}
        </p>

        <p class="data-note">
            This transport has been saved as your
            ${isReturn ? "return" : "departure"} journey.
        </p>
    `;

    result.appendChild(selection);

    selection.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}

// =========================================================
// HOTELS — REAL HOTEL DATA
// =========================================================

async function loadHotels(section, trip) {

    section.innerHTML = `
        <h2>Hotels</h2>
        <p>Searching real hotel prices...</p>
    `;

    const params = new URLSearchParams({
        destination: trip.destination,
        start_date: trip.start_date,
        end_date: trip.end_date,
        people: String(trip.people)
    });

    try {

        const response = await fetch(
            `${ROAMLY_API}/hotels?${params.toString()}`
        );

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(
                data.error || "Could not load hotel information."
            );
        }

        if (!Array.isArray(data.hotels) || data.hotels.length === 0) {

            section.innerHTML = `
                <h2>Hotels</h2>
                <p>No hotels with live pricing were found for these dates.</p>
            `;

            return;
        }

        renderHotels(section, data.hotels, trip);

    } catch (error) {

        console.error("Hotel search error:", error);

        section.innerHTML = `
            <h2>Hotels</h2>
            <p>❌ ${safeErrorMessage(error)}</p>
        `;
    }
}


// =========================================================
// RENDER HOTEL CARDS
// =========================================================

function renderHotels(section, hotels, trip) {

    section.innerHTML = `
        <h2>Hotels</h2>

        <p>Real hotel availability and prices found for your trip.</p>

        <p class="data-note">
            Prices come from live Google Hotels search data.
        </p>

        <div class="hotel-grid" id="hotel-list"></div>
    `;

    const hotelList = section.querySelector("#hotel-list");

    hotels.forEach((hotel, index) => {

        const hotelCard = document.createElement("div");
        hotelCard.className = "hotel-card";

        const ratingHTML =
            hotel.rating !== null && hotel.rating !== undefined
                ? `
                    <p>
                        ⭐ <strong>Rating:</strong>
                        ${escapeHTML(hotel.rating)}
                        ${
                            hotel.reviews
                                ? `(${escapeHTML(hotel.reviews)} reviews)`
                                : ""
                        }
                    </p>
                `
                : "";

        const classHTML = hotel.hotel_class
            ? `<p><strong>Class:</strong> ${escapeHTML(hotel.hotel_class)}</p>`
            : "";

        const amenitiesHTML =
            Array.isArray(hotel.amenities) && hotel.amenities.length
                ? `
                    <p>
                        <strong>Amenities:</strong>
                        ${hotel.amenities.slice(0, 6).map(escapeHTML).join(", ")}
                    </p>
                `
                : "";

        const priceHTML =
            hotel.price_per_night !== null &&
            hotel.price_per_night !== undefined
                ? `
                    <p>
                        <strong>From:</strong>
                        ${formatMoney(hotel.price_per_night)} / night
                    </p>
                `
                : `<p>Live price unavailable</p>`;

        const totalPriceHTML =
            hotel.total_price !== null &&
            hotel.total_price !== undefined
                ? `
                    <p>
                        <strong>Stay total:</strong>
                        ${formatMoney(hotel.total_price)}
                    </p>
                `
                : "";

        const bookingButtonHTML = hotel.hotel_website
            ? `
                <a
                    href="${escapeHTML(hotel.hotel_website)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="hotel-booking-button">
                    🔎 Explore / Booking
                </a>
            `
            : `
                <p class="data-note">
                    Booking link unavailable for this property.
                </p>
            `;

        const latitude = Number(hotel.latitude);
        const longitude = Number(hotel.longitude);

        const hasCoordinates =
            Number.isFinite(latitude) &&
            Number.isFinite(longitude);

        const mapButtonHTML = hasCoordinates
            ? `
                <a
                    href="https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="hotel-map-button">
                    View Hotel Location on OpenStreetMap
                </a>
            `
            : "";

        hotelCard.innerHTML = `
            <button
                type="button"
                class="hotel-header"
                aria-expanded="false">

                <span>${escapeHTML(hotel.name || "Hotel")}</span>

                <span id="hotel-arrow-${index}" class="hotel-arrow">▼</span>
            </button>

            <div id="hotel-details-${index}" class="hotel-details">

                ${mapButtonHTML}
                ${classHTML}
                ${ratingHTML}
                ${priceHTML}
                ${totalPriceHTML}
                ${amenitiesHTML}

                <br>
                
                ${bookingButtonHTML}

                <br>

                <div class="hotel-room-count">


                <label>
                    **Number of Rooms Required**
                </label>

                <input
                    type="number"
                    class="hotel-room-quantity"
                    min="1"
                    step="1"
                    value="1">

            </div>

            <br>

            <button
                type="button"
                class="main-button select-hotel">
                Select Hotel
            </button>

            </div>
        `;

        hotelList.appendChild(hotelCard);

        const header = hotelCard.querySelector(".hotel-header");
        const details = hotelCard.querySelector(".hotel-details");
        const arrow = hotelCard.querySelector(".hotel-arrow");

        header.addEventListener("click", function () {

            const wasOpen = details.classList.contains("open");

            // Close all other hotel cards.
            section.querySelectorAll(".hotel-details").forEach(item => {
                item.classList.remove("open");
            });

            section.querySelectorAll(".hotel-arrow").forEach(item => {
                item.textContent = "▼";
            });

            section.querySelectorAll(".hotel-header").forEach(item => {
                item.setAttribute("aria-expanded", "false");
            });

            if (!wasOpen) {
                details.classList.add("open");
                arrow.textContent = "▲";
                header.setAttribute("aria-expanded", "true");
            }
        });

        hotelCard.querySelector(".select-hotel")
            .addEventListener("click", function () {

                const roomInput =
                    hotelCard.querySelector(".hotel-room-quantity");

                const roomCount = Number(roomInput.value);

                if (
                    !Number.isInteger(roomCount) ||
                    roomCount < 1
                ) {
                    alert("Please enter a valid number of rooms.");
                    return;
                }

                selectHotel(hotel, trip, roomCount);
            });
    });
}


// =========================================================
// SELECT HOTEL
// =========================================================

function selectHotel(hotel, trip, roomCount = 1) {

    const pricePerRoom = Number(hotel.total_price);

    if (
        !Number.isFinite(pricePerRoom) ||
        pricePerRoom <= 0
    ) {
        alert("A valid hotel price was not returned.");
        return;
    }

    const selectedCost = pricePerRoom * roomCount;

    // Check the multiplied amount against the hotel budget.
    if (!canSelectWithinBudget("hotel", selectedCost)) {
        return;
    }

    const previousState = window.roamlyTripState || {};

    window.roamlyTripState = {
        trip,
        transport: previousState.transport || null,

        hotel: {
            name: hotel.name,
            address: hotel.address,
            latitude: Number(hotel.latitude) || null,
            longitude: Number(hotel.longitude) || null,
            price: selectedCost,
            price_per_room: pricePerRoom,
            rooms: roomCount
        },

        totalCost:
            Number(previousState.transport?.cost || 0) +
            selectedCost
    };

    updateHotelRunningTotal();
}

// =========================================================
// LIVE HOTEL ROOMS
// =========================================================

async function loadHotelRooms(container, hotel, trip, button) {

    if (!hotel.property_token) {
        container.innerHTML = `
            <p>⚠️ Live room information is unavailable for this hotel.</p>
        `;
        return;
    }

    button.disabled = true;
    button.textContent = "🔎 Checking live rooms...";

    container.innerHTML = `
        <p>🔎 Fetching current room types, prices and booking options...</p>
    `;

    const params = new URLSearchParams({
        property_token: hotel.property_token,
        destination: trip.destination,
        start_date: trip.start_date,
        end_date: trip.end_date,
        people: String(trip.people)
    });

    try {

        const response = await fetch(
            `${ROAMLY_API}/hotel-rooms?${params.toString()}`
        );

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(
                data.error || "Could not fetch live room information."
            );
        }

        if (!Array.isArray(data.rooms) || data.rooms.length === 0) {
            container.innerHTML = `
                <div class="hotel-card">
                    <p>No live room details are currently available for this property.</p>
                    <p class="data-note">
                        You can still use the Explore / Booking link above.
                    </p>
                </div>
            `;
            return;
        }

        renderHotelRooms(container, data.rooms, hotel, trip);

    } catch (error) {

        console.error("Hotel room error:", error);

        container.innerHTML = `
            <div class="hotel-card">
                <p>❌ ${safeErrorMessage(error)}</p>
            </div>
        `;

    } finally {

        button.disabled = false;
        button.textContent = "Check Live Rooms & Prices";
    }
}


// =========================================================
// RENDER LIVE ROOM OPTIONS
// =========================================================

function renderHotelRooms(container, rooms, hotel, trip) {

    container.innerHTML = `
        <br>

        <h4>Live Room Options</h4>

        <p class="data-note">
            Select the exact room you want. Only prices returned by
            the live hotel search are shown.
        </p>

        <div class="hotel-room-list"></div>
    `;

    const roomList = container.querySelector(".hotel-room-list");

    rooms.forEach(room => {

        const roomCard = document.createElement("div");
        roomCard.className = "transport-card";

        const roomPriceHTML =
            room.price_per_night !== null &&
            room.price_per_night !== undefined
                ? `
                    <p>
                        <strong>Price per night:</strong>
                        ${formatMoney(room.price_per_night)}
                    </p>
                `
                : "";

        const totalPriceHTML =
            room.total_price !== null &&
            room.total_price !== undefined
                ? `
                    <p>
                        <strong>Total stay price:</strong>
                        ${formatMoney(room.total_price)}
                    </p>
                `
                : `
                    <p class="data-note">Total stay price unavailable.</p>
                `;

        const guestsHTML = room.guests
            ? `<p><strong>Guests:</strong> ${escapeHTML(room.guests)}</p>`
            : "";

        const bookingHTML = room.booking_url
            ? `
                <a
                    href="${escapeHTML(room.booking_url)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="main-button">
                    🔎 View / Book This Room
                </a>
            `
            : "";

        roomCard.innerHTML = `
            <h4>${escapeHTML(room.room_name || "Room option")}</h4>

            <p>
                <strong>Source:</strong>
                ${escapeHTML(room.source || "Booking provider")}
            </p>

            ${guestsHTML}
            ${roomPriceHTML}
            ${totalPriceHTML}
            ${bookingHTML}

            <br><br>

            <button
                type="button"
                class="main-button select-hotel-room">
                Select This Room
            </button>
        `;

        roomList.appendChild(roomCard);

        roomCard.querySelector(".select-hotel-room")
            .addEventListener("click", function () {
                selectHotelRoom(hotel, room, trip);
            });
    });
}


// =========================================================
// SELECT HOTEL ROOM
// =========================================================


function selectHotelRoom(hotel, room, trip) {

    const selectedCost = Number(room.total_price);

    if (!Number.isFinite(selectedCost) || selectedCost <= 0) {
        alert(
            "ROAMLY cannot add this room because a real total stay price was not returned."
        );
        return;
    }

    // SAME VALIDATION LOGIC AS TRANSPORT
    if (!canSelectWithinBudget("hotel", selectedCost)) {
        return;
    }

    // Only save the hotel AFTER budget validation succeeds.
    const previousState = window.roamlyTripState || {};

    window.roamlyTripState = {
        trip,
        transport: previousState.transport || null,

        hotel: {
            name: hotel.name,
            address: hotel.address,
            latitude: Number(hotel.latitude) || null,
            longitude: Number(hotel.longitude) || null,
            room_name: room.room_name,
            source: room.source,
            booking_url: room.booking_url,
            price: selectedCost
        },

        totalCost:
            Number(previousState.transport?.cost || 0) + selectedCost
    };

    updateHotelRunningTotal();
}


// =========================================================
// UPDATE RUNNING TOTAL AFTER HOTEL / ROOM SELECTION
// =========================================================

function updateHotelRunningTotal() {

    if (typeof renderRunningTotal === "function") {
        renderRunningTotal();
    }

    if (typeof updateFinalizeButton === "function") {
        updateFinalizeButton();
    }

    const state = window.roamlyTripState;

    if (!state) return;

    const transportCost = Number(state.transport?.cost || 0);
    const hotelCost = Number(state.hotel?.price || 0);

    let totalCard = document.getElementById("roamly-running-total");

    if (!totalCard) {
        totalCard = document.createElement("div");
        totalCard.id = "roamly-running-total";
        totalCard.className = "selected-transport";

        document.getElementById("result-content").appendChild(totalCard);
    }

    totalCard.innerHTML = `
        <h3>ROAMLY Running Trip Total</h3>

        <p><strong>Transport:</strong> ${formatMoney(transportCost)}</p>
        <p><strong>Hotel:</strong> ${formatMoney(hotelCost)}</p>

        <hr>

        <p>
            <strong>Current Total:</strong>
            ${formatMoney(state.totalCost)}
        </p>

        <p class="data-note">
            This is the real cost of the options you have selected so far.
            Food, attractions and other expenses will be added later.
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

async function loadPlaces(section, trip) {

    section.innerHTML = `
        <h2>Attractions</h2>
        <p>⏳ Loading attractions...</p>
    `;

    try {

        const response = await fetch(
            `${ROAMLY_API}/places?destination=${encodeURIComponent(trip.destination)}`
        );

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(
                data.error || "Could not load attractions."
            );
        }

        if (!Array.isArray(data.places) || data.places.length === 0) {
            section.innerHTML = `
                <h2>Attractions</h2>
                <p>No attractions found.</p>
            `;
            return;
        }

        let html = `
            <div class="best-route-section">

                <h3>Optimized Visiting Sequence</h3>

                <p>
                    This is an optimized visiting sequence to save travel time
                    starting from your hotel.
                </p>

                <div id="best-route-results">
                    <p>⏳ Finding the best route...</p>
                </div>

            </div>

            <div class="hotel-grid">
        `;

        data.places.forEach((place, index) => {

            const name = escapeHTML(place.name || "Unnamed attraction");

            const navDestination =
                place.latitude != null && place.longitude != null
                    ? `${place.latitude},${place.longitude}`
                    : `${place.name || "Attraction"} ${trip.destination}`;

            const mapURL =
                place.latitude != null && place.longitude != null
                    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(navDestination)}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(navDestination)}`;

            const website = /^https?:\/\//i.test(place.website || "")
                ? place.website
                : "";

            html += `
                <div
                    class="hotel-card attraction-card"
                    data-place-name="${escapeHTML(place.name || "")}"
                    data-place-lat="${place.latitude ?? ""}"
                    data-place-lng="${place.longitude ?? ""}">

                    <span class="attraction-sequence-number" hidden></span>

                    <button
                        type="button"
                        class="attraction-toggle"
                        data-panel="roamly-place-${index}"
                        aria-expanded="false">

                        <span class="attraction-arrow">▶</span>
                        ${name}

                    </button>

                    <div
                        id="roamly-place-${index}"
                        class="attraction-details"
                        style="display:none; padding:16px;">

                        <p>
                            <strong>Type:</strong>
                            ${escapeHTML(place.type || "Attraction")}
                        </p>

                        <p>
                            <strong>Rating:</strong>
                            ⭐ ${escapeHTML(place.rating ?? "Not available")}
                        </p>

                        <p>
                            <strong>Reviews:</strong>
                            ${escapeHTML(place.reviews ?? "Not available")}
                        </p>

                        <p>
                            <strong>Entry fee:</strong>
                            ${escapeHTML(place.fee ?? "Not available")}
                        </p>

                        <p>
                            <strong>Opening hours:</strong>
                            ${escapeHTML(place.opening_hours ?? "Not available")}
                        </p>

                        <p>
                            <strong>Address:</strong>
                            ${escapeHTML(place.address ?? "Not available")}
                        </p>

                        <p>
                            <strong>About:</strong>
                            ${escapeHTML(place.description ?? "Not available")}
                        </p>

                        ${
                            website
                                ? `
                                    <p>
                                        <a
                                            href="${escapeHTML(website)}"
                                            target="_blank"
                                            rel="noopener noreferrer">
                                            🌐 Official Website
                                        </a>
                                    </p>
                                `
                                : ""
                        }

                        <p>
                            <a
                                href="${mapURL}"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="main-button attraction-navigate"
                                data-destination="${escapeHTML(navDestination)}">
                                Navigate with Google Maps
                            </a>
                        </p>

                        <button
                            type="button"
                            class="main-button food-nearby-button"
                            data-destination="${escapeHTML(trip.destination)}"
                            data-near="${escapeHTML(place.address || place.name)}"
                            data-lat="${place.latitude ?? ""}"
                            data-lng="${place.longitude ?? ""}">
                            🍽️ Food near here
                        </button>

                        <div class="food-results" hidden></div>

                    </div>
                </div>
            `;
        });

        html += `</div>`;

        section.innerHTML = html;

        // -----------------------------------------------------
        // AUTOMATIC BEST VISITING SEQUENCE
        // -----------------------------------------------------

        const bestRouteResults = section.querySelector(
            "#best-route-results"
        );

        (async function generateBestRouteAutomatically() {

            const hotel = trip.hotel || window.roamlyTripState?.hotel || null;

            if (!hotel) {
                bestRouteResults.innerHTML = `
                    <div class="best-route-summary">
                        <h4>Start: ${escapeHTML(result.starting_point)}</h4>
                    </div>
                `;
                return;
            }

            const hotelLatitude = Number(hotel.latitude);
            const hotelLongitude = Number(hotel.longitude);

            if (
                !Number.isFinite(hotelLatitude) ||
                !Number.isFinite(hotelLongitude) ||
                hotel.latitude == null ||
                hotel.longitude == null
            ) {
                bestRouteResults.innerHTML = `
                    <p class="data-note">
                        Your selected hotel does not have usable location
                        coordinates, so ROAMLY cannot calculate the route.
                    </p>
                `;
                return;
            }

            const validPlaces = data.places.filter(place =>
                place.latitude != null &&
                place.longitude != null &&
                Number.isFinite(Number(place.latitude)) &&
                Number.isFinite(Number(place.longitude))
            );

            if (validPlaces.length === 0) {
                bestRouteResults.innerHTML = `
                    <p class="data-note">
                        No attractions with valid location coordinates are available.
                    </p>
                `;
                return;
            }

            try {

                const response = await fetch(
                    `${ROAMLY_API}/optimize-place-route`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            hotel_name: hotel.name,
                            hotel_latitude: hotelLatitude,
                            hotel_longitude: hotelLongitude,
                            places: validPlaces.map(place => ({
                                name: place.name,
                                latitude: Number(place.latitude),
                                longitude: Number(place.longitude)
                            }))
                        })
                    }
                );

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(
                        result.error || "Could not optimize the visiting sequence."
                    );
                }

                // Display the optimized route summary.
                
                bestRouteResults.innerHTML = `
                    <div class="best-route-summary">
                        <p>Start: ${escapeHTML(result.starting_point)}</p>
                    </div>
                `;

                // Reorder the existing attraction cards.
                const attractionGrid = section.querySelector(".hotel-grid");

                const attractionCards = Array.from(
                    attractionGrid.querySelectorAll(".attraction-card")
                );

                const usedCards = new Set();
                const orderedCards = [];

                result.places.forEach((routePlace, index) => {

                    const matchingCard = attractionCards.find(card => {

                        if (usedCards.has(card)) return false;

                        const cardLat = Number(card.dataset.placeLat);
                        const cardLng = Number(card.dataset.placeLng);

                        return (
                            Math.abs(cardLat - Number(routePlace.latitude)) < 0.00001 &&
                            Math.abs(cardLng - Number(routePlace.longitude)) < 0.00001
                        );
                    });

                    if (!matchingCard) return;

                    usedCards.add(matchingCard);

                    const sequenceNumber = matchingCard.querySelector(
                        ".attraction-sequence-number"
                    );

                    if (sequenceNumber) {
                        sequenceNumber.hidden = false;
                        sequenceNumber.textContent = String(index + 1);
                    }

                    orderedCards.push(matchingCard);
                });

                // Show optimized attractions first.
                orderedCards.forEach(card => {
                    attractionGrid.appendChild(card);
                });

                // Keep attractions not included in the route afterwards.
                attractionCards.forEach(card => {

                    if (usedCards.has(card)) return;

                    const sequenceNumber = card.querySelector(
                        ".attraction-sequence-number"
                    );

                    if (sequenceNumber) {
                        sequenceNumber.hidden = true;
                        sequenceNumber.textContent = "";
                    }

                    attractionGrid.appendChild(card);
                });

            } catch (error) {

                console.error("Best route error:", error);

                bestRouteResults.innerHTML = `
                    <p class="data-note">
                        ⚠️ ${escapeHTML(
                            error.message || "Unable to generate the route."
                        )}
                    </p>
                `;
            }

        })();


        // Assign one delegated handler to this section.
        // This avoids adding duplicate listeners when attractions
        // are loaded again in the saved-trip dashboard.
        section.onclick = function (event) {

            const button = event.target.closest(".attraction-toggle");

            if (!button || !section.contains(button)) return;

            const panel = document.getElementById(button.dataset.panel);

            if (!panel) return;

            const opening =
                button.getAttribute("aria-expanded") !== "true";

            // Close all other attractions.
            section.querySelectorAll(".attraction-toggle").forEach(other => {

                if (other === button) return;

                const otherPanel = document.getElementById(other.dataset.panel);

                if (otherPanel) {
                    otherPanel.style.display = "none";
                }

                other.setAttribute("aria-expanded", "false");

                const arrow = other.querySelector(".attraction-arrow");

                if (arrow) arrow.textContent = "▶";
            });

            panel.style.display = opening ? "block" : "none";

            button.setAttribute("aria-expanded", String(opening));

            const arrow = button.querySelector(".attraction-arrow");

            if (arrow) {
                arrow.textContent = opening ? "▼" : "▶";
            }
        };

    } catch (error) {

        console.error("Attraction loading failed:", error);

        section.innerHTML = `
            <h2>Attractions</h2>
            <p>❌ ${safeErrorMessage(error)}</p>
            <p>Check that the backend is running.</p>
        `;
    }
}


// =========================================================
// DASHBOARD VIEW
// =========================================================

function setDashboardView(view) {

    const content = document.getElementById("result-content");

    if (!content) return;

    content.dataset.view = view;

    document.querySelectorAll(".menu-item").forEach(item => {
        item.classList.toggle("active", item.dataset.view === view);
    });

    const hotelBox = document.getElementById("hotel-dropdown");
    const placesBox = document.getElementById("places-dropdown");

    if (view === "hotels" && hotelBox) {
        hotelBox.open = true;
    }

    if (view === "places" && placesBox) {
        placesBox.open = true;
    }
}

document.querySelectorAll(".menu-item").forEach(item => {

    item.addEventListener("click", function () {
        setDashboardView(item.dataset.view);
    });
});


// =========================================================
// RUNNING TRIP TOTAL
// =========================================================


function renderRunningTotal() {
    const body = document.getElementById("total-panel-body");

    if (!body) return;

    const state = window.roamlyTripState;

    if (!state) {
        body.innerHTML = `
            <p class="total-empty">
                Select a flight, train, car or hotel and your
                running total will appear here.
            </p>
        `;

        updateFinalizeButton();
        return;
    }

    const transport = state.transport || null;
    const hotel = state.hotel || null;

    const departure = transport?.departure || null;
    const returnJourney = transport?.return || null;

    // Support older saved selections that used the previous structure.
    const legacyTransport =
        transport && !departure && transport.mode
            ? transport
            : null;

    const departureCost = Number(
        departure?.cost || legacyTransport?.cost || 0
    );

    const returnCost = Number(returnJourney?.cost || 0);

    const transportCost = departureCost + returnCost;
    const hotelCost = Number(hotel?.price || 0);

    const transportOverBudget =
        transport && isOverBudget("transport", transportCost);

    const hotelOverBudget =
        hotel && isOverBudget("hotel", hotelCost);

    // Always display selected costs, even when they exceed the budget.
    const total = transportCost + hotelCost;

    function getTransportLabel(selection) {
        if (!selection) return "Not selected";

        let label = selection.mode || "Transport";

        if (selection.train_name) {
            label += ` — ${selection.train_name}`;

            if (selection.class) {
                label += ` (${selection.class})`;
            }
        }

        return label;
    }

    const departureLabel = getTransportLabel(
        departure || legacyTransport
    );

    const returnLabel = getTransportLabel(returnJourney);

    const hotelLabel = hotel
        ? hotel.name || "Hotel"
        : "Not selected";

    const returnMissing = !returnJourney;

    body.innerHTML = `
        <div class="total-line">
            <span>🚆 Departure Transport</span>
            <strong>
                ${departure
                    ? formatMoney(departureCost)
                    : legacyTransport
                        ? formatMoney(departureCost)
                    : "—"}
            </strong>
        </div>

        <small>${escapeHTML(departureLabel)}</small>

        <div class="total-line">
            <span>🔁 Return Transport</span>
            <strong>
                ${returnJourney
                    ? formatMoney(returnCost)
                    : "—"}
            </strong>
        </div>

        <small>
            ${escapeHTML(returnLabel)}
        </small>

        ${returnMissing ? `
            <p class="data-note">
                Return transport not booked, Save budget for that!
            </p>
        ` : ""}

        <div class="total-line">
            <span>🏨 Hotel</span>
            <strong>
                ${hotel
                    ? formatMoney(hotelCost)
                    : "—"}
            </strong>
        </div>

        <small>${escapeHTML(hotelLabel)}</small>

        <hr>

        <div class="total-grand">
            <span>Current Total</span>
            <strong>${formatMoney(total)}</strong>
        </div>

        ${transportOverBudget || hotelOverBudget ? `
            <p class="data-note">
                ⚠️ One or more selected options exceed their category budget.
                The actual selected costs are still included above.
            </p>
        ` : ""}
    `;

    updateFinalizeButton();
}


// =========================================================
// SELECTED OPTION HIGHLIGHT
// =========================================================

window.roamlyLastSelectButton = null;

document.addEventListener("click", function (event) {

    const pressed = event.target.closest(
        ".select-real-flight, " +
        ".select-ground-transport, " +
        ".select-hotel, " +
        ".select-hotel-room"
    );

    if (pressed) {
        window.roamlyLastSelectButton = pressed;
    }

}, true);


function markSelected(element) {

    if (element) {
        element.classList.add("is-selected");
    }
}

function clearSelected(rootSelector) {

    document.querySelectorAll(
        `${rootSelector} .is-selected`
    ).forEach(element => {
        element.classList.remove("is-selected");
    });
}

function applySelectionHighlight() {

    const button = window.roamlyLastSelectButton;

    if (!button || !document.body.contains(button)) return;

    if (
        button.matches(
            ".select-real-flight, .select-ground-transport"
        )
    ) {

        clearSelected("#transport-section");

        markSelected(
            button.closest(".transport-category-card")
        );

        return;
    }

    if (button.matches(".select-hotel, .select-hotel-room")) {

        clearSelected("#hotel-dropdown");

        // Never highlight a hotel that exceeds its budget.
        const selectedHotel = window.roamlyTripState?.hotel;

        if (
            selectedHotel &&
            isOverBudget("hotel", selectedHotel.price)
        ) {
            return;
        }

        markSelected(button.closest(".hotel-card"));

        if (button.matches(".select-hotel-room")) {
            markSelected(button.closest(".transport-card"));
        }
    }
}


// Apply highlighting after a selection function changes the state.
[
    "selectRealFlight",
    "selectGroundTransport",
    "selectHotel",
    "selectHotelRoom"
].forEach(name => {

    const original = window[name];

    if (typeof original !== "function") return;

    window[name] = function () {

        const previousState = JSON.stringify(
            window.roamlyTripState || null
        );

        const output = original.apply(this, arguments);

        const newState = JSON.stringify(
            window.roamlyTripState || null
        );

        if (previousState !== newState) {
            applySelectionHighlight();
        }

        return output;
    };
});


// =========================================================
// SCREEN ROUTER — HOME / PLAN / SIGN IN / MY TRIPS
// =========================================================

function showScreen(name, push = true) {

    const body = document.body;

    body.classList.remove(
        "plan-view",
        "auth-view",
        "trips-view",
        "journey-view"
    );

    if (name === "plan") body.classList.add("plan-view");
    if (name === "auth") body.classList.add("auth-view");
    if (name === "trips") body.classList.add("trips-view");
    if (name === "journey") body.classList.add("journey-view");

    if (push !== false) {

        const current = history.state?.view || "home";

        if (current !== name) {

            history.pushState(
                { view: name },
                "",
                name === "home"
                    ? location.pathname + location.search
                    : `#${name}`
            );
        }
    }

    window.scrollTo(0, 0);

    if (name === "trips") {
        loadTrips();
    }
}

function showPlanScreen() {
    showScreen("plan");
}


// Browser Back / Forward.
window.addEventListener("popstate", function (event) {

    const view = event.state?.view || "home";

    if (view === "trips" && !getToken()) {
        showScreen("auth", false);
        return;
    }

    showScreen(view, false);
});


// Reloading on a hash should start at Home.
if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
}


// =========================================================
// SIGN-IN STATE
// =========================================================

function getToken() {

    try {
        return localStorage.getItem("roamly_token");
    } catch (error) {
        return null;
    }
}

function getUser() {

    try {
        return JSON.parse(localStorage.getItem("roamly_user"));
    } catch (error) {
        return null;
    }
}

function setSession(token, user) {

    try {
        localStorage.setItem("roamly_token", token);
        localStorage.setItem("roamly_user", JSON.stringify(user));
    } catch (error) {
        console.error("Could not save session:", error);
    }

    updateAuthUI();
}

function clearSession() {

    try {
        localStorage.removeItem("roamly_token");
        localStorage.removeItem("roamly_user");
    } catch (error) {
        console.error("Could not clear session:", error);
    }

    updateAuthUI();
}

function updateAuthUI() {

    const link = document.getElementById("nav-auth");
    const user = getUser();

    if (!link) return;

    if (getToken() && user) {
        link.textContent =
            "Sign Out (" + String(user.name || "User").split(" ")[0] + ")";
    } else {
        link.textContent = "Sign In";
    }
}


// =========================================================
// API HELPER
// =========================================================

function tripEsc(value) {
    return escapeHTML(value);
}

function tripMoney(value) {
    return formatMoney(value);
}

async function roamlyApi(path, options = {}) {

    const headers = Object.assign(
        { "Content-Type": "application/json" },
        options.headers || {}
    );

    const token = getToken();

    if (token) {
        headers.Authorization = "Bearer " + token;
    }

    const response = await fetch(
        ROAMLY_API + path,
        Object.assign({}, options, { headers })
    );

    let data = {};

    try {
        data = await response.json();
    } catch (error) {
        // The server may return an empty response.
    }

    if (response.status === 401 && token) {
        clearSession();
    }

    if (!response.ok) {
        throw new Error(
            data.detail || data.error || "Request failed."
        );
    }

    return data;
}


// =========================================================
// SIGN IN / CREATE ACCOUNT
// =========================================================

let authMode = "signin";
let afterAuth = null;

function setAuthMode(mode) {

    authMode = mode;

    const signup = mode === "signup";

    document.getElementById("tab-signin")
        .classList.toggle("active", !signup);

    document.getElementById("tab-signup")
        .classList.toggle("active", signup);

    document.getElementById("auth-name-group")
        .classList.toggle("auth-hidden", !signup);

    document.getElementById("auth-title").textContent =
        signup ? "Create your account" : "Sign in";

    document.getElementById("auth-submit").textContent =
        signup ? "Create account" : "Sign in";

    document.getElementById("auth-error").textContent = "";
}

function openAuth(notice, next) {

    afterAuth = next || null;

    setAuthMode("signin");

    document.getElementById("auth-notice").textContent = notice || "";

    showScreen("auth");
}

async function submitAuth() {

    const name = document.getElementById("auth-name").value.trim();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;

    const errorBox = document.getElementById("auth-error");
    const submit = document.getElementById("auth-submit");

    errorBox.textContent = "";

    if (!email || !password || (authMode === "signup" && !name)) {
        errorBox.textContent = "Please fill in all fields.";
        return;
    }

    submit.disabled = true;

    try {

        const data = await roamlyApi(
            authMode === "signup" ? "/auth/register" : "/auth/login",
            {
                method: "POST",
                body: JSON.stringify(
                    authMode === "signup"
                        ? { name, email, password }
                        : { email, password }
                )
            }
        );

        setSession(data.token, data.user);

        document.getElementById("auth-password").value = "";

        const next = afterAuth;
        afterAuth = null;

        if (next === "save") {
            showScreen("plan");
            saveCurrentTrip();
        } else if (next === "trips") {
            showScreen("trips");
        } else {
            showScreen("home");
        }

    } catch (error) {

        errorBox.textContent =
            error.message || "Could not connect to the ROAMLY backend.";

    } finally {
        submit.disabled = false;
    }
}

document.getElementById("tab-signin")
    .addEventListener("click", () => setAuthMode("signin"));

document.getElementById("tab-signup")
    .addEventListener("click", () => setAuthMode("signup"));

document.getElementById("auth-submit")
    .addEventListener("click", submitAuth);

["auth-name", "auth-email", "auth-password"].forEach(id => {

    document.getElementById(id).addEventListener("keydown", function (event) {

        if (event.key === "Enter") {
            submitAuth();
        }
    });
});


// =========================================================
// NAVBAR
// =========================================================

document.getElementById("nav-home").addEventListener("click", function (event) {

    event.preventDefault();
    showScreen("home");
});

document.getElementById("nav-trips").addEventListener("click", function (event) {

    event.preventDefault();

    if (!getToken()) {
        openAuth("Sign in to view your saved trips.", "trips");
        return;
    }

    showScreen("trips");
});

document.getElementById("nav-auth").addEventListener("click", async function (event) {

    event.preventDefault();

    if (getToken()) {

        try {
            await roamlyApi("/auth/logout", { method: "POST" });
        } catch (error) {
            // Continue signing out locally if the API is unavailable.
        }

        clearSession();
        showScreen("home");

        return;
    }

    openAuth("", null);
});

document.getElementById("back-button").addEventListener("click", function () {
    history.back();
});


document.getElementById("nav-explore").addEventListener("click", function (event) {

    event.preventDefault();

    showScreen("home");

    setTimeout(() => {
        document.getElementById("planner-card").scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }, 50);

});


updateAuthUI();


// =========================================================
// SAVE / FINALIZE CURRENT TRIP
// =========================================================

function selectionKey() {

    const state = window.roamlyTripState;

    if (!state) return "";

    return JSON.stringify({
        trip: window.roamlyCurrentTrip || null,
        transport: state.transport || null,
        hotel: state.hotel || null
    });
}


function updateFinalizeButton(keepStatus = false) {

    const button = document.getElementById("save-trip-button");
    const status = document.getElementById("save-trip-status");

    if (!button || !status) return;

    const state = window.roamlyTripState;

    const transport = state?.transport || null;
    const hotel = state?.hotel || null;

    const hasSelection = Boolean(
        transport || hotel
    );

    button.classList.toggle("auth-hidden", !hasSelection);

    if (!hasSelection) {
        status.textContent = "";
        return;
    }

    // Read the new departure and return structure.
    const departure = transport?.departure || null;
    const returnJourney = transport?.return || null;

    // Support older selections using the previous structure.
    const legacyTransport =
        transport && !departure && transport.mode
            ? transport
            : null;

    const departureCost = Number(
        departure?.cost || legacyTransport?.cost || 0
    );

    const returnCost = Number(
        returnJourney?.cost || 0
    );

    const combinedTransportCost =
        departureCost + returnCost;

    // Check transport budget using both journeys.
    const transportOverBudget =
        transport &&
        isOverBudget("transport", combinedTransportCost);

    // Check hotel budget.
    const hotelOverBudget =
        hotel &&
        isOverBudget("hotel", hotel.price);

    const hasBudgetViolation = Boolean(
        transportOverBudget || hotelOverBudget
    );

    const isRoundTrip =
        transport?.journey_type === "roundtrip";

    const missingRoundTripLeg =
        isRoundTrip && (!departure || !returnJourney);

    const alreadyFinalized =
        window.roamlyFinalizedKey === selectionKey();

    button.disabled =
        alreadyFinalized || hasBudgetViolation || missingRoundTripLeg;

    button.textContent = alreadyFinalized
        ? "Trip finalized"
        : "Finalize this trip";

    if (hasBudgetViolation) {

        status.textContent =
            "Your selected options exceed the budget. Increase the relevant budget or choose another option.";

    } 
    
    else if (missingRoundTripLeg) {

        status.textContent =
            "Please select both departure and return transport before finalizing your round trip.";

    }
    
    else if (!alreadyFinalized && !keepStatus) {

        status.textContent = "";

    }
}


async function saveCurrentTrip() {

    const status = document.getElementById("save-trip-status");
    const button = document.getElementById("save-trip-button");

    const trip = window.roamlyCurrentTrip;

    if (!trip) {
        status.textContent = "Plan a trip first.";
        return;
    }

    if (!getToken()) {
        openAuth(
            "Sign in to finalize this trip and save it to My Trips.",
            "save"
        );
        return;
    }

    const state = window.roamlyTripState || null;

    button.disabled = true;
    status.textContent = "Finalizing...";

    try {

        const editingId = window.roamlyEditingTripId;

        const saved = await roamlyApi(
            editingId ? "/trips/" + encodeURIComponent(editingId) : "/trips",
            {
                method: editingId ? "PUT" : "POST",
                body: JSON.stringify({
                    from_location: trip.from_location,
                    destination: trip.destination,
                    start_date: trip.start_date,
                    end_date: trip.end_date,
                    people: trip.people,

                    total_cost: state
                        ? Number(state.totalCost) || 0
                        : 0,

                    selection: state
                        ? {
                            transport: state.transport || null,
                            hotel: state.hotel || null,
                            route_details: window.roamlyRouteDetails || {}
                        }
                        : null
                })
            }
        );

        // After the first save, later finalizes update the same trip.
        if (saved && saved.id) {
            window.roamlyEditingTripId = saved.id;
        }

        window.roamlyFinalizedKey = selectionKey();

        status.textContent = "Trip finalized and saved to My Trips.";

    } catch (error) {

        status.textContent = error.message;

        if (!getToken()) {
            openAuth(
                "Please sign in again to finalize this trip.",
                "save"
            );
        }

    } finally {
        updateFinalizeButton(true);
    }
}

document.getElementById("save-trip-button")
    .addEventListener("click", saveCurrentTrip);

updateFinalizeButton();


// =========================================================
// MY TRIPS — TRANSPORT AND HOTEL SUMMARIES
// =========================================================

function transportSummary(selection) {

    const transport = selection?.transport;

    if (!transport) return "Not selected";

    let summary = transport.mode || "Transport";

    if (transport.train_name) {
        summary += " - " + transport.train_name;

        if (transport.class) {
            summary += " (" + transport.class + ")";
        }
    }

    return summary + ": " + tripMoney(transport.cost);
}

function hotelSummary(selection) {

    const hotel = selection?.hotel;

    if (!hotel) return "Not selected";

    return (hotel.name || "Hotel") + ": " + tripMoney(hotel.price);
}


// =========================================================
// RENDER SAVED TRIPS
// =========================================================

function renderTrips(trips) {

    const list = document.getElementById("trips-list");

    window.roamlySavedTrips = trips;

    if (!Array.isArray(trips) || trips.length === 0) {

        list.innerHTML = `
            <div class="saved-trip-card">
                <p>You have no saved trips yet.</p>

                <p class="saved-trip-meta">
                    Plan a trip and finalize it to keep it here.
                </p>
            </div>
        `;

        return;
    }

    list.innerHTML = trips.map(trip => {

        const savedOn = new Date(trip.created_at + "Z")
            .toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric"
            });

        return `
            <div class="saved-trip-card">

                <div class="saved-trip-head">
                    <h3>
                        ${tripEsc(trip.from_location)} to
                        ${tripEsc(trip.destination)}
                    </h3>

                    <span class="saved-trip-date">
                        Saved ${savedOn}
                    </span>
                </div>

                <p class="saved-trip-meta">
                    ${tripEsc(trip.start_date)} to
                    ${tripEsc(trip.end_date)}
                    | ${Number(trip.people)} traveler(s)
                </p>

                <div
                    class="saved-trip-summary"
                    data-trip-id="${tripEsc(trip.id)}">

                    <span class="summary-label">✨ AI trip summary</span>

                    <p class="summary-text">
                        Preparing your trip summary...
                    </p>

                </div>

                <div class="saved-trip-lines">

                    <div>
                        <span>Transport</span>
                        <strong>${tripEsc(transportSummary(trip.selection))}</strong>
                    </div>

                    <div>
                        <span>Hotel</span>
                        <strong>${tripEsc(hotelSummary(trip.selection))}</strong>
                    </div>

                    <div class="saved-trip-total">
                        <span>Total</span>
                        <strong>${tripMoney(trip.total_cost)}</strong>
                    </div>

                </div>

                <div class="saved-trip-actions">

                    <button
                        type="button"
                        class="main-button trip-open"
                        data-id="${tripEsc(trip.id)}">
                        Edit Plan
                    </button>

                    <button
                        type="button"
                        class="trip-delete"
                        data-id="${tripEsc(trip.id)}">
                        Delete
                    </button>

                    <button
                        type="button"
                        class="main-button trip-start"
                        data-id="${tripEsc(trip.id)}">
                        Start Your Trip
                    </button>

                </div>

            </div>
        `;

    }).join("");
    loadTripSummaries(trips);
}

// =========================================================
// AI TRIP SUMMARIES (MY TRIPS)
// =========================================================

let tripSummaryRun = 0;

async function loadTripSummaries(trips) {

    // If the list is re-rendered mid-load, stop the old run.
    const run = ++tripSummaryRun;

    // One at a time, so we don't fire many AI requests together.
    for (const trip of trips) {

        const card = document.querySelector(
            `.saved-trip-summary[data-trip-id="${trip.id}"]`
        );

        if (!card) continue;

        const text = card.querySelector(".summary-text");
        const label = card.querySelector(".summary-label");

        try {
            const data = await roamlyApi(
                `/trips/${encodeURIComponent(trip.id)}/summary`
            );

            if (run !== tripSummaryRun) return;

            text.textContent = data.summary;

            label.textContent = data.ai_used
                ? "✨ AI trip summary"
                : "📝 Trip summary";

        } catch (error) {

            if (run !== tripSummaryRun) return;

            text.textContent = "Summary is unavailable right now.";
        }
    }
}

async function loadTrips() {

    const list = document.getElementById("trips-list");

    if (!getToken()) {
        openAuth("Sign in to view your saved trips.", "trips");
        return;
    }

    list.innerHTML = "<p>Loading your trips...</p>";

    try {

        const data = await roamlyApi("/trips");

        renderTrips(data.trips);

    } catch (error) {

        list.innerHTML = `
            <p class="auth-error">${tripEsc(error.message)}</p>
        `;
    }
}


// =========================================================
// SAVED TRIP DASHBOARD — HELPER
// =========================================================

function findJourneyValue(object, possibleKeys) {

    if (!object || typeof object !== "object") {
        return null;
    }

    for (const key of possibleKeys) {

        if (
            Object.prototype.hasOwnProperty.call(object, key) &&
            object[key] !== null &&
            object[key] !== undefined &&
            object[key] !== ""
        ) {
            return object[key];
        }
    }

    for (const value of Object.values(object)) {

        if (value && typeof value === "object") {

            const result = findJourneyValue(value, possibleKeys);

            if (result !== null) {
                return result;
            }
        }
    }

    return null;
}


// =========================================================
// START MY TRIP — TRANSPORT DETAILS
// =========================================================


function renderJourneyTransport(savedTrip) {

    const container = document.getElementById(
        "journey-transport-content"
    );

    if (!container) return;

    const selection = savedTrip.selection || {};
    const transport = selection.transport || {};

    if (!selection.transport) {

        container.innerHTML = `
            <div class="journey-info">
                <p><strong>Transport:</strong> Not selected</p>
                <p class="data-note">
                    No transport was selected when this trip was finalized.
                </p>
            </div>
        `;

        return;
    }

    const routeDetails = selection.route_details || {};

    // Support both new and older saved-trip structures.
    const departureTransport =
        transport.departure || transport;

    const returnTransport =
        transport.departure
            ? transport.return
            : null;

    const journeyType = String(
        transport.journey_type || "oneway"
    ).toLowerCase();


    // -----------------------------------------------------
    // RENDER ONE TRANSPORT LEG
    // -----------------------------------------------------

    function renderTransportLeg(legTransport, leg) {

        if (!legTransport) {

            return `
                <div class="journey-info">
                    <h3>
                        ${leg === "departure"
                            ? "Departure Journey"
                            : "Return Journey"}
                    </h3>

                    <p class="data-note">
                        ${leg === "return"
                            ? "Return transport has not been selected yet."
                            : "No transport selected."}
                    </p>
                </div>
            `;
        }

        const isReturn = leg === "return";

        const fromLocation = isReturn
            ? savedTrip.destination
            : savedTrip.from_location;

        const toLocation = isReturn
            ? savedTrip.from_location
            : savedTrip.destination;

        const mode = String(
            legTransport.mode || ""
        ).toLowerCase();

        const money = tripMoney(legTransport.cost);

        const routeFallback = {
            departure: {
                name: fromLocation,
                code: ""
            },
            arrival: {
                name: toLocation,
                code: ""
            }
        };

        // Flight route details are stored separately by leg.
        const flightRoute =
            routeDetails.flightLegs?.[leg] ||
            (!isReturn ? routeDetails.flight : null) ||
            routeFallback;

        // Support separate train/station route details if present.
        const trainRoute =
            routeDetails.trainLegs?.[leg] ||
            routeDetails.stationLegs?.[leg] ||
            (!isReturn
                ? routeDetails.train || routeDetails.station
                : null) ||
            routeFallback;

        const heading = isReturn
            ? "↩️ Return Journey"
            : "🛫 Departure Journey";


        // -------------------------------------------------
        // FLIGHT
        // -------------------------------------------------

        if (mode.includes("flight")) {

            const departure =
                flightRoute.departure || routeFallback.departure;

            const arrival =
                flightRoute.arrival || routeFallback.arrival;

            const airline = findJourneyValue(
                legTransport,
                ["airline", "airline_name", "name"]
            );

            const flightNumber = findJourneyValue(
                legTransport,
                ["flight_number", "flight_no", "flightNumber"]
            );

            const departureTime = findJourneyValue(
                legTransport,
                ["departure_time", "depart_time", "departureTime"]
            );

            const arrivalTime = findJourneyValue(
                legTransport,
                ["arrival_time", "arrive_time", "arrivalTime"]
            );

            return `
                <div class="journey-info">

                    <h3>${heading}</h3>

                    <p>
                        <strong>Flight:</strong>
                        ${tripEsc(airline || "Selected flight")}
                    </p>

                    ${
                        flightNumber
                            ? `<p><strong>Flight number:</strong> ${tripEsc(flightNumber)}</p>`
                            : ""
                    }

                    ${
                        departureTime
                            ? `<p><strong>Departure:</strong> ${tripEsc(departureTime)}</p>`
                            : ""
                    }

                    ${
                        arrivalTime
                            ? `<p><strong>Arrival:</strong> ${tripEsc(arrivalTime)}</p>`
                            : ""
                    }

                    <p><strong>Selected cost:</strong> ${money}</p>

                </div>

                <div class="flight-airport-card">

                    <h3>✈️ ${isReturn ? "Return" : "Departure"} Airport Navigation</h3>

                    ${createRouteNote("flight", departure, arrival)}

                </div>
            `;
        }


        // -------------------------------------------------
        // TRAIN
        // -------------------------------------------------

        if (mode.includes("train")) {

            const departure =
                trainRoute.departure || routeFallback.departure;

            const arrival =
                trainRoute.arrival || routeFallback.arrival;

            const trainName = findJourneyValue(
                legTransport,
                ["train_name", "name"]
            );

            const trainNumber = findJourneyValue(
                legTransport,
                ["train_number", "train_no", "trainNumber"]
            );

            const departureTime = findJourneyValue(
                legTransport,
                ["departure_time", "depart_time", "departureTime"]
            );

            return `
                <div class="journey-info">

                    <h3>${heading}</h3>

                    <p>
                        <strong>Train</strong>
                    </p>

                    ${
                        departureTime
                            ? `<p><strong>Departure:</strong> ${tripEsc(departureTime)}</p>`
                            : ""
                    }

                    <p><strong>Selected fare:</strong> ${money}</p>

                </div>

                <div class="train-station-card">

                    <h3>🚆 ${isReturn ? "Return" : "Departure"} Station Navigation</h3>

                    ${createRouteNote("train", departure, arrival)}

                </div>
            `;
        }


        // -------------------------------------------------
        // CAR
        // -------------------------------------------------

        if (mode.includes("car")) {

            const distance = legTransport.distance_km;
            const duration = legTransport.estimated_time;

            const destinationURL = directionsUrl(toLocation);

            return `
                <div class="journey-info">

                    <h3>${heading}</h3>

                    <p><strong>Transport:</strong> Personal car</p>

                    ${
                        distance != null
                            ? `<p><strong>Distance:</strong> ${tripEsc(distance)} km</p>`
                            : ""
                    }

                    ${
                        duration != null
                            ? `<p><strong>Estimated driving time:</strong> ${tripEsc(duration)} hours</p>`
                            : ""
                    }

                    <p><strong>Estimated fuel cost:</strong> ${money}</p>

                    <p><strong>From:</strong> ${tripEsc(fromLocation)}</p>

                    <p><strong>To:</strong> ${tripEsc(toLocation)}</p>

                    <a
                        href="${destinationURL}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="journey-action">
                        🚗 Start your journey with Google Maps
                    </a>

                </div>
            `;
        }


        // -------------------------------------------------
        // OTHER TRANSPORT
        // -------------------------------------------------

        return `
            <div class="journey-info">

                <h3>${heading}</h3>

                <p>
                    <strong>Selected transport:</strong>
                    ${tripEsc(legTransport.mode || "Transport")}
                </p>

                <p><strong>Cost:</strong> ${money}</p>

            </div>
        `;
    }


    // -----------------------------------------------------
    // DISPLAY BOTH JOURNEYS
    // -----------------------------------------------------

    container.innerHTML = `

        <div class="journey-leg-section">

            ${renderTransportLeg(
                departureTransport,
                "departure"
            )}

        </div>

        ${
            journeyType === "roundtrip"
                ? `
                    <div class="journey-leg-section">

                        ${renderTransportLeg(
                            returnTransport,
                            "return"
                        )}

                    </div>
                `
                : ""
        }

    `;
}

// =========================================================
// START MY TRIP — HOTEL DETAILS
// =========================================================

function renderJourneyHotel(savedTrip) {

    const container = document.getElementById(
        "journey-hotel-content"
    );

    const hotel = savedTrip.selection?.hotel;

    if (!hotel) {

        container.innerHTML = `
            <div class="journey-info">
                <p><strong>Hotel:</strong> Not selected</p>
                <p class="data-note">
                    No hotel was selected when this trip was finalized.
                </p>
            </div>
        `;

        return;
    }

    const hotelLocation = hotel.address || hotel.name;

    const hotelURL = directionsUrl(hotelLocation);

    container.innerHTML = `
        <div class="journey-info">

            <h3>${tripEsc(hotel.name || "Selected hotel")}</h3>

            ${
                hotel.address
                    ? `<p><strong>Address:</strong> ${tripEsc(hotel.address)}</p>`
                    : ""
            }

            ${
                hotel.room_name
                    ? `<p><strong>Room:</strong> ${tripEsc(hotel.room_name)}</p>`
                    : ""
            }

            ${
                hotel.source
                    ? `<p><strong>Booking source:</strong> ${tripEsc(hotel.source)}</p>`
                    : ""
            }

            <p>
                <strong>Selected hotel cost:</strong>
                ${tripMoney(hotel.price)}
            </p>

            ${
                hotel.booking_url
                    ? `
                        <a
                            href="${tripEsc(hotel.booking_url)}"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="journey-action">
                            View booking details
                        </a>
                    `
                    : ""
            }

            <br>

            <a
                href="${hotelURL}"
                target="_blank"
                rel="noopener noreferrer"
                class="journey-action">
                🏨 Navigate to your hotel
            </a>

            <br><br>

            <button
                type="button"
                class="main-button food-nearby-button"
                data-destination="${tripEsc(savedTrip.destination)}"
                data-near="${tripEsc(hotelLocation)}"
                data-lat="${hotel.latitude ?? ""}"
                data-lng="${hotel.longitude ?? ""}">
                🍽️ Food near your hotel
            </button>

            <div class="food-results" hidden></div>

        </div>
    `;
}

async function loadJourneyWeather(savedTrip) {

    const container = document.getElementById("journey-weather-content");

    if (!container) return;

    // Check whether the saved trip has the required details
    if (
        !savedTrip ||
        !savedTrip.destination ||
        !savedTrip.start_date ||
        !savedTrip.end_date
    ) {
        container.innerHTML = `
            <p class="data-note">
                Trip destination or travel dates are missing.
            </p>
        `;
        return;
    }

    container.innerHTML = `
        <div class="journey-info">
            <p>Loading the latest weather forecast...</p>
        </div>
    `;

    const params = new URLSearchParams({
        destination: savedTrip.destination,
        start_date: savedTrip.start_date,
        end_date: savedTrip.end_date
    });

    try {

        const response = await fetch(
            `${ROAMLY_API}/weather?${params.toString()}`
        );

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || "Unable to fetch weather data.");
        }

        if (!data.available) {
            container.innerHTML = `
                <div class="journey-info">
                    <h3>Forecast currently unavailable</h3>
                    <p>${tripEsc(data.message || "Please check again closer to your trip.")}</p>
                    <button type="button" class="weather-refresh-button">
                        Refresh Forecast
                    </button>
                </div>
            `;

            container.querySelector(".weather-refresh-button")
                .addEventListener("click", () => loadJourneyWeather(savedTrip));

            return;
        }

        const daily = data.daily || {};
        const dates = daily.time || [];

        if (!dates.length) {
            throw new Error("No daily forecast data was returned.");
        }

        const weatherDescriptions = {
            0: ["☀️", "Clear Sky"],
            1: ["🌤️", "Mainly Clear"],
            2: ["⛅", "Partly Cloudy"],
            3: ["☁️", "Overcast"],
            45: ["🌫️", "Fog"],
            48: ["🌫️", "Depositing Rime Fog"],
            51: ["🌦️", "Light Drizzle"],
            53: ["🌦️", "Moderate Drizzle"],
            55: ["🌧️", "Dense Drizzle"],
            56: ["🌧️", "Freezing Drizzle"],
            57: ["🌧️", "Heavy Freezing Drizzle"],
            61: ["🌧️", "Slight Rain"],
            63: ["🌧️", "Moderate Rain"],
            65: ["🌧️", "Heavy Rain"],
            66: ["🌧️", "Freezing Rain"],
            67: ["🌧️", "Heavy Freezing Rain"],
            71: ["❄️", "Slight Snow"],
            73: ["❄️", "Moderate Snow"],
            75: ["❄️", "Heavy Snow"],
            77: ["🌨️", "Snow Grains"],
            80: ["🌦️", "Rain Showers"],
            81: ["🌧️", "Moderate Rain Showers"],
            82: ["⛈️", "Heavy Rain Showers"],
            85: ["🌨️", "Snow Showers"],
            86: ["❄️", "Heavy Snow Showers"],
            95: ["⛈️", "Thunderstorm"],
            96: ["⛈️", "Thunderstorm with Hail"],
            99: ["⛈️", "Severe Thunderstorm"]
        };

        const getValue = (key, index) => {
            const value = daily[key]?.[index];
            return value === null || value === undefined ? "—" : value;
        };

        const forecastCards = dates.map((date, index) => {

            const code = Number(getValue("weather_code", index));
            const weather = weatherDescriptions[code] || ["🌡️", "Unknown Conditions"];

            const formattedDate = new Date(date + "T12:00:00")
                .toLocaleDateString("en-IN", {
                    weekday: "short",
                    day: "numeric",
                    month: "short"
                });

            const maxTemp = getValue("temperature_2m_max", index);
            const minTemp = getValue("temperature_2m_min", index);
            const rainChance = getValue("precipitation_probability_max", index);
            const rainfall = getValue("precipitation_sum", index);
            const wind = getValue("wind_speed_10m_max", index);
            const humidity = getValue("relative_humidity_2m_mean", index);

            return `
                <div class="weather-day-card">

                    <div class="weather-day-top">
                        <strong>${formattedDate}</strong>
                        <span>${weather[0]}</span>
                    </div>

                    <h3>${weather[1]}</h3>

                    <div class="weather-temperature">
                        <strong>${maxTemp}°C</strong>
                        <span> / ${minTemp}°C</span>
                    </div>

                    <div class="weather-detail">
                        <span>🌧️ Rain probability</span>
                        <strong>${rainChance === "—" ? "—" : rainChance + "%"}</strong>
                    </div>

                    <div class="weather-detail">
                        <span>💧 Rainfall</span>
                        <strong>${rainfall === "—" ? "—" : rainfall + " mm"}</strong>
                    </div>

                    <div class="weather-detail">
                        <span>💨 Wind speed</span>
                        <strong>${wind === "—" ? "—" : wind + " km/h"}</strong>
                    </div>

                    ${humidity !== "—" ? `
                        <div class="weather-detail">
                            <span>Humidity</span>
                            <strong>${humidity}%</strong>
                        </div>
                    ` : ""}

                </div>
            `;
        }).join("");

        container.innerHTML = `
            <div class="journey-info">
                <h3>Live weather forecast for ${tripEsc(data.destination || savedTrip.destination)}</h3>
            </div>

            <div class="weather-forecast-grid">
                ${forecastCards}
            </div>
        `;

    } catch (error) {

        console.error("Weather forecast error:", error);

        container.innerHTML = `
            <div class="journey-info">
                <h3>Unable to load weather forecast</h3>
                <p>${tripEsc(error.message || "Please try again later.")}</p>

                <button type="button" class="weather-refresh-button">
                    Try Again
                </button>
            </div>
        `;

        container.querySelector(".weather-refresh-button")
            .addEventListener("click", () => loadJourneyWeather(savedTrip));
    }
}

// =========================================================
// AI WEATHER-BASED TRAVEL ADVICE
// =========================================================

async function loadWeatherAIAdvice(savedTrip, daily) {

    const adviceContainer = document.getElementById(
        "weather-ai-advice-content"
    );

    if (!adviceContainer) return;

    adviceContainer.innerHTML = `
        <p class="data-note">🤖 Analyzing your trip's weather...</p>
    `;

    const transport =
        savedTrip.selection?.transport ||
        savedTrip.transport ||
        {};

    const transportMode =
        transport.departure?.mode ||
        transport.mode ||
        "Not specified";

    try {

        const response = await fetch(`${ROAMLY_API}/weather-advice`, {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                destination: savedTrip.destination,
                daily_forecast: daily,
                transport_mode: transportMode
            })
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(
                data.error || "Unable to generate AI weather advice."
            );
        }

        adviceContainer.innerHTML = `
            <div class="weather-ai-response">
                ${tripEsc(data.advice)}
            </div>
        `;

    } catch (error) {

        console.error("AI weather advice error:", error);

        adviceContainer.innerHTML = `
            <p class="data-note">
                AI weather advice is temporarily unavailable.
                ${tripEsc(error.message)}
            </p>
        `;
    }
}

// =========================================================
// JOURNEY — SWITCH BETWEEN SIDEBAR PANELS
// =========================================================

function setJourneyPanel(panelName) {

    const panels = {
        transport: document.getElementById("journey-transport-panel"),
        hotel: document.getElementById("journey-hotel-panel"),
        places: document.getElementById("journey-places-panel"),
        weather: document.getElementById("journey-weather-panel")
    };

    const emptyState = document.getElementById("journey-empty-state");

    const buttons = document.querySelectorAll(
        ".journey-menu-item"
    );

    // Hide every content panel first.
    Object.values(panels).forEach(panel => {
        panel.hidden = true;
    });

    // Remove active styling from all sidebar options.
    buttons.forEach(button => {

        button.classList.remove("active");
        button.setAttribute("aria-pressed", "false");

    });

    // No panel selected: display the introductory message.
    if (!panels[panelName]) {

        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    // Display only the requested panel.
    panels[panelName].hidden = false;

    // Highlight the selected sidebar option.
    const selectedButton = document.querySelector(
        `.journey-menu-item[data-journey-panel="${panelName}"]`
    );

    if (selectedButton) {

        selectedButton.classList.add("active");
        selectedButton.setAttribute("aria-pressed", "true");

    }
}

document.querySelector(".journey-sidebar").addEventListener("click", function(event) {
    const button = event.target.closest(".journey-menu-item");

    if (!button) return;

    const panelName = button.dataset.journeyPanel;

    setJourneyPanel(panelName);

    if (panelName === "weather") {
        loadJourneyWeather(window.roamlyActiveSavedTrip);
    }
});

// =========================================================
// OPEN SAVED TRIP DASHBOARD
// =========================================================


function startSavedTrip(savedTrip) {
    if (!savedTrip) {
        alert("Could not load this saved trip.");
        return;
    }

    window.roamlyActiveSavedTrip = savedTrip;

    // Restore saved route details for airport and station navigation.
    window.roamlyRouteDetails =
        savedTrip.selection?.route_details || {};

    // Update Journey heading.
    document.getElementById("journey-title").textContent =
        `${savedTrip.from_location} → ${savedTrip.destination}`;

    document.getElementById("journey-subtitle").textContent =
        `${savedTrip.start_date} to ${savedTrip.end_date} | ${savedTrip.people} traveler(s)`;

    // Update destination-specific Places labels.
    document.getElementById("journey-places-label").textContent =
        `Places to explore in ${savedTrip.destination}`;

    document.getElementById("journey-places-heading").textContent =
        `Places to explore in ${savedTrip.destination}`;

    // Render saved transport, hotel and expenses.
    renderJourneyTransport(savedTrip);
    renderJourneyHotel(savedTrip);
    initExpenseTracker(savedTrip);

    // Prepare the attractions section.
    const attractionsContainer = document.getElementById(
        "journey-attractions-content"
    );

    attractionsContainer.innerHTML = `
        <p>Loading attractions...</p>
    `;

    // Open the separate Journey screen.
    showScreen("journey");

    // Initially show the welcome panel.
    setJourneyPanel(null);

    // Load destination attractions.
    loadPlaces(attractionsContainer, {
        from_location: savedTrip.from_location,
        destination: savedTrip.destination,
        start_date: savedTrip.start_date,
        end_date: savedTrip.end_date,
        people: savedTrip.people,
        hotel: savedTrip.selection?.hotel || null
    });
}


// =========================================================
// BACK TO MY TRIPS
// =========================================================

document.getElementById("journey-back-button")
    .addEventListener("click", function () {
        showScreen("trips");
    });




window.roamlyEditingSavedTrip = false;

function restoreSavedTripForEditing(savedTrip) {

    const selection = savedTrip.selection || {};
    const savedRouteDetails = selection.route_details || {};

    // Restore the saved trip's selected options.
    const {
        route_details,
        ...savedSelections
    } = selection;

    window.roamlyTripState = {
        ...savedSelections,
        transport: savedSelections.transport || null,
        hotel: savedSelections.hotel || null
    };

    // Restore route details separately.
    window.roamlyRouteDetails = savedRouteDetails;

    // Restore the trip details.
    window.roamlyCurrentTrip = {
        from_location: savedTrip.from_location,
        destination: savedTrip.destination,
        start_date: savedTrip.start_date,
        end_date: savedTrip.end_date,
        people: savedTrip.people
    };

    window.roamlyFinalizedKey = null;

    // Tell the Plan My Trip handler not to clear saved selections.
    window.roamlyEditingSavedTrip = true;
}


// =========================================================
// MY TRIPS — PLAN AGAIN / START / DELETE
// =========================================================

document.getElementById("trips-list")
    .addEventListener("click", async function (event) {

        const openButton = event.target.closest(".trip-open");
        const startButton = event.target.closest(".trip-start");
        const deleteButton = event.target.closest(".trip-delete");

        // -------------------------------------------------
        // EDIT PLAN — RESTORE THE SAVED TRIP
        // -------------------------------------------------

        
        if (openButton) {

            const trip = (window.roamlySavedTrips || []).find(item =>
                String(item.id) === openButton.dataset.id
            );

            if (!trip) return;

            // Restore saved selections before reopening the planner.
            restoreSavedTripForEditing(trip);
            window.roamlyEditingTripId = trip.id;

            document.getElementById("from").value = trip.from_location;
            document.getElementById("destination").value = trip.destination;
            document.getElementById("start-date").value = trip.start_date;
            document.getElementById("end-date").value = trip.end_date;
            document.getElementById("people").value = trip.people;

            document.getElementById("plan-button").click();

            return;
        }


        // -------------------------------------------------
        // START MY TRIP
        // -------------------------------------------------

        if (startButton) {

            const trip = (window.roamlySavedTrips || []).find(item =>
                String(item.id) === startButton.dataset.id
            );

            if (!trip) return;

            startSavedTrip(trip);

            return;
        }

        // -------------------------------------------------
        // DELETE TRIP
        // -------------------------------------------------

        if (deleteButton) {

            if (!confirm("Delete this saved trip?")) return;

            try {

                await roamlyApi(
                    "/trips/" + encodeURIComponent(deleteButton.dataset.id),
                    { method: "DELETE" }
                );

                loadTrips();

            } catch (error) {
                alert(error.message);
            }
        }
    });


// =========================================================
// GLOBAL NAVIGATION BUTTON HANDLER
// =========================================================

document.addEventListener("click", function (event) {

    // Airport / station navigation.
    const goButton = event.target.closest(".nav-go");

    if (goButton) {
        openDirections(goButton.dataset.destination);
        return;
    }

    // Attraction navigation.
    const attractionLink = event.target.closest(".attraction-navigate");

    if (attractionLink) {

        event.preventDefault();

        openDirections(attractionLink.dataset.destination);
    }
});


// =========================================================
// RUNNING TOTAL OBSERVER
// =========================================================

// Older selection cards are still created by selection functions.
// This observer transfers their information to the dashboard total
// and removes the temporary card from the main results area.

if (document.body) {

    const runningTotalObserver = new MutationObserver(mutations => {

        const cards = [];

        mutations.forEach(mutation => {

            mutation.addedNodes.forEach(node => {

                if (node.nodeType !== 1) return;

                if (node.classList.contains("selected-transport")) {
                    cards.push(node);
                }

                node.querySelectorAll?.(".selected-transport").forEach(card => {
                    cards.push(card);
                });
            });
        });

        if (!cards.length) return;

        renderRunningTotal();

        cards.forEach(card => card.remove());
    });

    runningTotalObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}


// =========================================================
// INITIALIZE ROAMLY
// =========================================================

renderRunningTotal();
updateAuthUI();
updateFinalizeButton();

// =========================================================
// ROAMLY — UX ENHANCEMENTS
// =========================================================

(function () {

    // ---------- Toast notifications (replace alert) ----------
    const stack = document.createElement("div");
    stack.className = "toast-stack";
    stack.setAttribute("aria-live", "polite");
    stack.setAttribute("role", "status");
    document.body.appendChild(stack);

    window.roamlyToast = function (message, type = "warn", duration = 4800) {
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.textContent = String(message);
        stack.appendChild(toast);

        const dismiss = () => {
            toast.classList.add("leaving");
            setTimeout(() => toast.remove(), 300);
        };

        toast.addEventListener("click", dismiss);
        setTimeout(dismiss, duration);
    };

    // Every existing alert("...") now shows a friendly toast instead.
    window.alert = function (message) {
        window.roamlyToast(message, "warn");
    };


    // ---------- Smarter date inputs ----------
    const startInput = document.getElementById("start-date");
    const endInput = document.getElementById("end-date");

    if (startInput && endInput) {

        const toISO = date => date.toISOString().split("T")[0];
        const today = new Date();

        startInput.min = toISO(today);
        endInput.min = toISO(today);

        startInput.addEventListener("change", () => {
            if (!startInput.value) return;

            const nextDay = new Date(startInput.value);
            nextDay.setDate(nextDay.getDate() + 1);

            endInput.min = toISO(nextDay);

            if (!endInput.value || new Date(endInput.value) <= new Date(startInput.value)) {
                endInput.value = toISO(nextDay);
            }
        });
    }


    // ---------- Press Enter to plan the trip ----------
    ["from", "destination", "start-date", "end-date", "people"].forEach(id => {
        const field = document.getElementById(id);
        if (!field) return;

        field.addEventListener("keydown", event => {
            if (event.key === "Enter" && planButton && !planButton.disabled) {
                event.preventDefault();
                planButton.click();
            }
        });
    });


    // ---------- Navbar shadow on scroll ----------
    const navbar = document.querySelector(".navbar");

    if (navbar) {
        const onScroll = () =>
            navbar.classList.toggle("scrolled", window.scrollY > 8);

        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
    }

})();

// =========================================================
// RESTORE SELECTION HIGHLIGHTS FROM SAVED STATE (EDIT PLAN)
// =========================================================

function highlightFromTripState() {

    const state = window.roamlyTripState;
    if (!state) return;

    const transport = state.transport;
    const hotel = state.hotel;

    const sameText = (el, text) =>
        !!el &&
        String(el.textContent).trim().toLowerCase() ===
        String(text || "").trim().toLowerCase();

    // ---------- TRANSPORT ----------
    const transportRoot = document.getElementById("transport-section");

    if (transportRoot && transport) {

        let target = null;

        if (transport.mode === "Flight") {

            target = [
                ...transportRoot.querySelectorAll(
                    "#roamly-flight-section .transport-category-card"
                )
            ].find(card =>
                sameText(card.querySelector("h3"), transport.airline) &&
                (!transport.departure_time ||
                    card.textContent.includes(transport.departure_time))
            );

        } else if (transport.mode === "Train") {

            target = transportRoot.querySelector(
                "#train-mode-results .train-option-card"
            );

        } else if (transport.mode === "Car") {

            target = transportRoot.querySelector(
                "#car-mode-results .car-estimator-card"
            );
        }

        if (target && !target.classList.contains("is-selected")) {
            clearSelected("#transport-section");
            markSelected(target);
        }
    }

    // ---------- HOTEL / ROOM ----------
    const hotelRoot = document.getElementById("hotel-dropdown");

    if (hotelRoot && hotel && hotel.name) {

        const hotelCard = [
            ...hotelRoot.querySelectorAll(".hotel-card")
        ].find(card =>
            sameText(card.querySelector(".hotel-header span"), hotel.name)
        );

        if (hotelCard && !hotelCard.classList.contains("is-selected")) {
            clearSelected("#hotel-dropdown");
            markSelected(hotelCard);
        }

        // Room cards load later, when the hotel is expanded.
        if (hotelCard && hotel.room_name) {

            const roomCard = [
                ...hotelCard.querySelectorAll(".transport-card")
            ].find(card =>
                sameText(card.querySelector("h4"), hotel.room_name)
            );

            if (roomCard) markSelected(roomCard);
        }
    }
}

// Re-apply whenever the results area re-renders (flights, hotels, rooms).
(function () {

    const results = document.getElementById("result-content");
    if (!results) return;

    let queued = false;

    new MutationObserver(() => {
        if (queued) return;
        queued = true;

        requestAnimationFrame(() => {
            queued = false;
            highlightFromTripState();
        });
    }).observe(results, { childList: true, subtree: true });

})();

// =========================================================
// FOOD NEARBY
// =========================================================

async function loadFoodNearby(box, vegOnly = false) {

    const d = box.dataset;

    box.hidden = false;
    box.innerHTML = `<p class="data-note">⏳ Finding good places to eat...</p>`;

    const params = new URLSearchParams({
        destination: d.destination || "",
        near: d.near || "",
        veg_only: vegOnly ? "true" : "false"
    });

    if (d.lat && d.lng) {
        params.set("latitude", d.lat);
        params.set("longitude", d.lng);
    }

    try {
        const response = await fetch(`${ROAMLY_API}/food?${params}`);
        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || "Could not load food places.");
        }

        if (!Array.isArray(data.restaurants)) {
            throw new Error("Invalid restaurant data received.");
        }

        box.dataset.loaded = "true";

        const header = `
            <label class="food-veg-filter">
                <input type="checkbox" class="food-veg-toggle"
                    ${vegOnly ? "checked" : ""}>
                Vegetarian only
            </label>
        `;

        if (!data.restaurants.length) {
            box.innerHTML = header +
                `<p class="data-note">No highly rated places found within 2.5 km.</p>`;
            return;
        }

        const note = data.located_by === "destination"
            ? `<p class="data-note">Exact location unavailable, showing places near the city centre.</p>`
            : "";

        box.innerHTML = header + note + data.restaurants.map(r => `
            <div class="food-card">
                <h4>${escapeHTML(r.name)}</h4>
                <p>
                    ⭐ ${escapeHTML(r.rating)}
                    (${escapeHTML(Number(r.reviews).toLocaleString("en-IN"))} reviews)
                    ${r.price ? " · " + escapeHTML(r.price) : ""}
                    · ${escapeHTML(r.distance_km)} km away
                </p>
                <p>${escapeHTML(r.type)}</p>
                ${r.address ? `<p class="data-note">${escapeHTML(r.address)}</p>` : ""}
                <a href="${escapeHTML(r.maps_link)}" target="_blank"
                   rel="noopener noreferrer">Navigate ↗</a>
            </div>
        `).join("");

    } catch (error) {
        box.dataset.loaded = "false";
        box.innerHTML = `<p>❌ ${safeErrorMessage(error)}</p>`;
    }
}

document.addEventListener("click", function (event) {

    const button = event.target.closest(".food-nearby-button");
    if (!button) return;

    const box = button.nextElementSibling;
    if (!box || !box.classList.contains("food-results")) return;

    // Toggle if already loaded.
    if (box.dataset.loaded === "true") {
        box.hidden = !box.hidden;
        return;
    }

    Object.assign(box.dataset, {
        destination: button.dataset.destination,
        near: button.dataset.near,
        lat: button.dataset.lat,
        lng: button.dataset.lng
    });

    loadFoodNearby(box, false);
});

document.addEventListener("change", function (event) {

    const toggle = event.target.closest(".food-veg-toggle");
    if (!toggle) return;

    const box = toggle.closest(".food-results");
    if (box) loadFoodNearby(box, toggle.checked);
});

// =========================================================
// TRIP EXPENSE TRACKER (JOURNEY SCREEN)
// =========================================================

const EXPENSE_CATEGORIES = [
    { key: "local_transport", icon: "🚕", label: "Local transport" },
    { key: "food",            icon: "🍽️", label: "Food" },
    { key: "tourism",         icon: "🎟️", label: "Tourism fares" },
    { key: "shopping",        icon: "🛍️", label: "Shopping" }
];

window.roamlyExpenses = [];

function expenseNotify(message) {
    if (typeof window.roamlyToast === "function") {
        window.roamlyToast(message, "warn");
    } else {
        alert(message);
    }
}

function categoryTotal(key) {
    return window.roamlyExpenses
        .filter(e => e.category === key)
        .reduce((sum, e) => sum + Number(e.amount || 0), 0);
}

function getTripMaximumBudget(trip) {
    if (!trip?.id) return null;

    const savedBudget = localStorage.getItem(
        `roamly_max_budget_${trip.id}`
    );

    const budget = Number(savedBudget);

    return Number.isFinite(budget) && budget > 0
        ? budget
        : null;
}

// =========================================================
// ROAMLY — SMART REMAINING BUDGET RECOMMENDATIONS
// =========================================================

function buildBudgetRecommendations(
    maximumBudget,
    remainingBudget,
    returnMissing
) {

    if (maximumBudget === null) {
        return `
            <div class="budget-advice-empty">
                <p>Set your maximum trip budget to receive
                personalized spending recommendations.</p>
            </div>
        `;
    }

    const foodSpent = categoryTotal("food");
    const transportSpent = categoryTotal("local_transport");
    const tourismSpent = categoryTotal("tourism");
    const shoppingSpent = categoryTotal("shopping");

    const essentialsSpent = foodSpent + transportSpent;

    const shoppingHigh = shoppingSpent > maximumBudget * 0.10;
    const tourismHigh = tourismSpent > maximumBudget * 0.20;

    let priority = "";
    let avoid = "";
    let nextAction = "";

    if (remainingBudget < 0) {

        priority = `
            Stop non-essential spending immediately.
            Focus only on essential food and necessary transport.
        `;

        avoid = `
            Shopping, expensive attractions and optional upgrades.
        `;

        nextAction = `
            Your budget has been exceeded by
            ${tripMoney(Math.abs(remainingBudget))}.
            Review your recent expenses and reduce optional spending.
        `;

    } else if (remainingBudget === 0) {

        priority = `
            Avoid further spending wherever possible.
            Keep any essential expenses within additional funds
            you can arrange.
        `;

        avoid = `
            Shopping, paid attractions and unnecessary travel.
        `;

        nextAction = `
            Your remaining budget is zero. Avoid making
            additional bookings or purchases.
        `;

    } else if (remainingBudget <= maximumBudget * 0.10) {

        priority = `
            Protect your remaining money for food and essential
            local transport.
        `;

        avoid = `
            Shopping, premium experiences and expensive
            sightseeing activities.
        `;

        nextAction = `
            Your remaining balance is very limited.
            Keep spending strictly to essential needs.
        `;

    } else if (remainingBudget <= maximumBudget * 0.25) {

        priority = `
            Prioritize food, local transport and any pending
            return journey.
        `;

        avoid = `
            Expensive attractions, shopping and unnecessary
            upgrades.
        `;

        nextAction = `
            Use budget-friendly alternatives and compare prices
            before making your next booking.
        `;

    } else {

        priority = `
            Maintain sufficient funds for food and local transport.
            Choose sightseeing experiences selectively.
        `;

        avoid = `
            Unplanned shopping and expensive activities that
            offer little value.
        `;

        nextAction = `
            You have some spending flexibility, but keep an
            emergency reserve instead of using the entire balance.
        `;
    }

    if (returnMissing && remainingBudget > 0) {
        priority += `
            Arrange and reserve money for your pending return journey
            before spending on optional activities.
        `;
    }

    if (shoppingHigh) {
        avoid += `
            Your shopping expenses are already relatively high
            compared with your total trip budget.
        `;
    }

    if (tourismHigh) {
        avoid += `
            Review additional paid sightseeing expenses before
            booking more attractions.
        `;
    }

    const emergencyReserve = Math.max(
        0,
        Math.round(remainingBudget * 0.15)
    );

    return `
        <div class="budget-advice-content">

            <div class="budget-advice-section">
                <h4>🎯 What to prioritize</h4>
                <p>${tripEsc(priority.trim())}</p>
            </div>

            <div class="budget-advice-section">
                <h4>⚠️ What to avoid or reduce</h4>
                <p>${tripEsc(avoid.trim())}</p>
            </div>

            <div class="budget-advice-section">
                <h4>💡 ROAMLY's next recommendation</h4>
                <p>${tripEsc(nextAction.trim())}</p>
            </div>

            <div class="budget-advice-reserve">
                <span>Suggested emergency reserve</span>
                <strong>${tripMoney(emergencyReserve)}</strong>
            </div>

        </div>
    `;
}

function renderExpensePanel(savedTrip, clearCategory = null) {
    const body = document.getElementById("expense-panel-body");
    if (!body) return;

    // Preserve unfinished expense entries.
    const drafts = {};

    body.querySelectorAll(".expense-form").forEach(form => {
        drafts[form.dataset.category] =
            form.querySelector(".expense-amount").value;
    });

    const selection = savedTrip.selection || {};

    const transportSelection = selection.transport || {};
    const hotelCost = Number(selection.hotel?.price) || 0;

    // Read the new departure/return transport structure.
    const departure = transportSelection.departure || null;
    const returnJourney = transportSelection.return || null;

    // Support older saved trips.
    const legacyTransportCost =
        Number(transportSelection.cost) || 0;

    const departureCost = departure
        ? Number(departure.cost) || 0
        : legacyTransportCost;

    const returnCost = returnJourney
        ? Number(returnJourney.cost) || 0
        : 0;

    const transportCost = departureCost + returnCost;
    const booked = transportCost + hotelCost;

    // Warn whenever a return journey has not been selected.
    const returnJourneyHTML = !returnJourney
        ? `
            <div class="return-journey-warning">
                <h3>⚠️ Return transport not booked</h3>

                <p>
                    Return transport not booked, Save budget for that!
                </p>

                <p>
                    You still need to arrange your return journey.
                    Its cost is not included in your current trip total.
                </p>
            </div>
        `
        : "";

    const spent = window.roamlyExpenses.reduce(
        (sum, expense) => sum + Number(expense.amount || 0),
        0
    );

    const maximumBudget = getTripMaximumBudget(savedTrip);

    const totalCommitted = booked + spent;

    const remainingBudget = maximumBudget === null
        ? null
        : maximumBudget - totalCommitted;

    const budgetPercentage = maximumBudget
        ? Math.min(100, Math.max(0,
            (totalCommitted / maximumBudget) * 100
        ))
        : 0;

    // Budget section.
    const budgetHTML = `
        <div class="expense-budget-card">

            <h3>💰 Your Trip Budget</h3>

            <label for="expense-maximum-budget">
                Maximum allowed budget (₹)
            </label>

            <div class="expense-budget-input-row">
                <input
                    type="number"
                    id="expense-maximum-budget"
                    class="expense-budget-input"
                    min="1"
                    step="1"
                    placeholder="Enter your maximum budget"
                    value="${maximumBudget ?? ""}">

                <button
                    type="button"
                    class="expense-budget-save">
                    Save
                </button>
            </div>

            ${
                maximumBudget !== null
                ? `
                    <div class="expense-budget-summary">

                        <div class="total-line">
                            <span>Maximum budget</span>
                            <strong>${tripMoney(maximumBudget)}</strong>
                        </div>

                        <div class="total-line">
                            <span>Booked + spent</span>
                            <strong>${tripMoney(totalCommitted)}</strong>
                        </div>

                        <div class="total-grand">
                            <span>
                                ${remainingBudget >= 0
                                    ? "Remaining budget"
                                    : "Budget exceeded"}
                            </span>

                            <strong>
                                ${tripMoney(Math.abs(remainingBudget))}
                            </strong>
                        </div>

                        <div class="expense-budget-progress">
                            <div style="width: ${budgetPercentage}%"></div>
                        </div>

                    </div>
                `
                : `
                    <p class="data-note">
                        Set your maximum budget to start tracking
                        your remaining balance.
                    </p>
                `
            }

        </div>
    `;

    // Generate recommendations using the current remaining balance.
    const budgetAdviceHTML = buildBudgetRecommendations(
        maximumBudget,
        remainingBudget,
        !returnJourney
    );

    // Display each transport leg separately.
    const bookedHTML = `
        <div class="expense-booked">

            <h3>Already booked</h3>

            <div class="total-line">
                <span>Departure transport</span>
                <strong>
                    ${departureCost
                        ? tripMoney(departureCost)
                        : "Not selected"}
                </strong>
            </div>

            <div class="total-line">
                <span>Return transport</span>
                <strong>
                    ${returnCost
                        ? tripMoney(returnCost)
                        : "Not selected"}
                </strong>
            </div>

            <div class="total-line">
                <span>Hotel</span>
                <strong>
                    ${hotelCost
                        ? tripMoney(hotelCost)
                        : "Not selected"}
                </strong>
            </div>

            <div class="total-line">
                <span>Booked subtotal</span>
                <strong>${tripMoney(booked)}</strong>
            </div>

        </div>
    `;

    // Expense categories.
    const categoriesHTML = EXPENSE_CATEGORIES.map(cat => {

        const entries = window.roamlyExpenses.filter(
            expense => expense.category === cat.key
        );

        const entriesHTML = entries.length
            ? `
                <ul class="expense-list">
                    ${entries.map(expense => `
                        <li>
                            <span class="expense-note-text">
                                ${tripEsc(
                                    parseServerDate(
                                        expense.created_at
                                    ).toLocaleString("en-IN", {
                                        day: "numeric",
                                        month: "short",
                                        hour: "numeric",
                                        minute: "2-digit"
                                    })
                                )}
                            </span>

                            <span class="expense-amount-text">
                                ${tripMoney(expense.amount)}
                            </span>

                            <button
                                type="button"
                                class="expense-delete"
                                data-id="${expense.id}"
                                aria-label="Delete expense">
                                ✕
                            </button>
                        </li>
                    `).join("")}
                </ul>
            `
            : "";

        return `
            <div class="expense-category">

                <div class="expense-category-head">
                    <span>${cat.icon} ${cat.label}</span>
                    <strong>${tripMoney(categoryTotal(cat.key))}</strong>
                </div>

                <div
                    class="expense-form"
                    data-category="${cat.key}">

                    <input
                        type="number"
                        class="expense-amount"
                        min="0"
                        step="0.01"
                        placeholder="₹ Amount">

                    <button
                        type="button"
                        class="expense-add"
                        data-category="${cat.key}">
                        Add
                    </button>

                </div>

                ${entriesHTML}

            </div>
        `;
    }).join("");

    body.innerHTML = `
        ${budgetHTML}

        <section class="budget-ai-advice">
            <h3>✨ ROAMLY Smart Budget Advice</h3>
            <p class="data-note">
                Recommendations based on your current remaining balance.
            </p>

            ${budgetAdviceHTML}
        </section>

        ${returnJourneyHTML}

        ${bookedHTML}

        <h3 class="expense-heading">Spent during the trip</h3>

        ${categoriesHTML}

        <div class="total-line">
            <span>Trip spending</span>
            <strong>${tripMoney(spent)}</strong>
        </div>

        <div class="total-grand">
            <span>Grand total</span>
            <strong>${tripMoney(totalCommitted)}</strong>
        </div>
    `;

    // Restore unfinished entries.
    body.querySelectorAll(".expense-form").forEach(form => {

        const draft = drafts[form.dataset.category];

        if (draft === undefined ||
            form.dataset.category === clearCategory) {
            return;
        }

        form.querySelector(".expense-amount").value = draft;
    });
}


async function initExpenseTracker(savedTrip) {

    const body = document.getElementById("expense-panel-body");
    if (!body) return;

    window.roamlyExpenses = [];

    body.innerHTML = `<p class="data-note">⏳ Loading expenses...</p>`;

    // ----- one delegated handler for add / delete -----
    body.onclick = async function (event) {

        const trip = window.roamlyActiveSavedTrip;
        if (!trip) return;

        // SAVE MAXIMUM TRIP BUDGET
        const budgetSaveButton = event.target.closest(".expense-budget-save");

        if (budgetSaveButton) {

            const budgetInput = body.querySelector("#expense-maximum-budget");
            const maximumBudget = Number(budgetInput?.value);

            if (
                !budgetInput?.value.trim() ||
                !Number.isFinite(maximumBudget) ||
                maximumBudget <= 0
            ) {
                expenseNotify("Please enter a valid maximum trip budget.");
                budgetInput?.focus();
                return;
            }

            localStorage.setItem(
                `roamly_max_budget_${trip.id}`,
                String(maximumBudget)
            );

            expenseNotify("Maximum trip budget saved successfully.");

            renderExpensePanel(trip);

            return;
        }

        // ADD
        const addButton = event.target.closest(".expense-add");

        if (addButton) {

            const form = addButton.closest(".expense-form");
            const amountInput = form.querySelector(".expense-amount");
            const amount = Number(amountInput.value);

            if (
                !amountInput.value.trim() ||
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                expenseNotify("Enter a valid amount.");
                amountInput.focus();
                return;
            }

            addButton.disabled = true;

            try {
                const saved = await roamlyApi(
                    `/trips/${encodeURIComponent(trip.id)}/expenses`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            category: addButton.dataset.category,
                            amount
                        })
                    }
                );

                window.roamlyExpenses.unshift(saved);

                renderExpensePanel(trip, addButton.dataset.category);

            } catch (error) {
                expenseNotify(error.message);
                addButton.disabled = false;
            }

            return;
        }

        // DELETE
        const deleteButton = event.target.closest(".expense-delete");

        if (deleteButton) {

            try {
                await roamlyApi(
                    `/trips/${encodeURIComponent(trip.id)}` +
                    `/expenses/${encodeURIComponent(deleteButton.dataset.id)}`,
                    { method: "DELETE" }
                );

                window.roamlyExpenses = window.roamlyExpenses.filter(
                    e => String(e.id) !== deleteButton.dataset.id
                );

                renderExpensePanel(trip);

            } catch (error) {
                expenseNotify(error.message);
            }
        }
    };

    // Press Enter in an input to add the expense.
    body.onkeydown = function (event) {

        if (event.key !== "Enter") return;

        const form = event.target.closest(".expense-form");
        if (!form) return;

        event.preventDefault();
        form.querySelector(".expense-add").click();
    };

    // ----- load saved expenses -----
    try {
        const data = await roamlyApi(
            `/trips/${encodeURIComponent(savedTrip.id)}/expenses`
        );

        window.roamlyExpenses = data.expenses || [];

    } catch (error) {
        console.error("Expense loading failed:", error);
    }

    renderExpensePanel(savedTrip);
}

function parseServerDate(value) {
    const text = String(value || "");
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
    return new Date(hasZone ? text : text.replace(" ", "T") + "Z");
}