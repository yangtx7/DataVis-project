// --- Configuration ---
const MAP_GEOJSON_URL = 'world-countries.json';
const DATA_CSV_URL = 'data.csv';
const GEOJSON_ID_PROPERTY = 'id'; // Using top-level ID based on previous fix
const CSV_COUNTRY_CODE_COLUMN = 'ISO';
const CSV_YEAR_COLUMN = 'Start Year';
// Constants for Hierarchical Filters
const CSV_GROUP_COLUMN = 'Disaster Subgroup';
const CSV_TYPE_COLUMN = 'Disaster Type';
const CSV_SUBTYPE_COLUMN = 'Disaster Subtype';

// --- D3 Setup ---
const svg = d3.select("#map");
const mapContent = d3.select("#map-content"); // Select the group for map content
const mapContainer = d3.select(".map-container");
const infoPanel = d3.select("#info-panel");
const countryInfoDiv = d3.select("#country-info");
const eventDetailsDiv = d3.select("#event-details");
const detailsContentDiv = d3.select("#details-content");
const tooltip = d3.select("#tooltip");
const legendDiv = d3.select("#legend");
const groupSelect = d3.select("#group-select");
const typeSelect = d3.select("#type-select");
const subtypeSelect = d3.select("#subtype-select");

// Get initial dimensions
let width = parseInt(mapContainer.style("width"));
let height = parseInt(mapContainer.style("height"));

// --- Map Projection and Path ---
const projection = d3.geoMercator()
    .scale(130)
    .center([0, 40])
    .translate([width / 2, height / 2]);

const pathGenerator = d3.geoPath().projection(projection);
let worldWidth = 0; // Will be calculated after projection is ready

// --- Color Scale ---
const colorScale = d3.scaleThreshold()
    .domain([1, 5, 10, 25, 50, 100])
    .range(d3.schemeOrRd[7]); // OrRd has 7 colors for 6 thresholds + >max

// --- State Variables ---
let geojsonData = null;
let disasterData = [];
let eventHierarchy = {};
let filteredData = [];
let eventsByCountry = new Map();
let selectedCountryISO = null;
let selectedEventId = null;
let currentFilterYear = null;
let currentFilterGroup = 'all';
let currentFilterType = 'all';
let currentFilterSubtype = 'all';
let zoomBehavior = null; // To store the zoom behavior instance

// --- Load Data ---
Promise.all([
    d3.json(MAP_GEOJSON_URL),
    d3.csv(DATA_CSV_URL)
]).then(([geoData, csvData]) => {
    console.log("GeoJSON loaded.");
    console.log("CSV loaded.");

    // Basic GeoJSON validation (using ID now)
    if (!geoData || !geoData.features || !geoData.features.length) {
       throw new Error("GeoJSON data is invalid or empty.");
    }
    const sampleFeature = geoData.features[0];
    if (!sampleFeature || typeof sampleFeature[GEOJSON_ID_PROPERTY] === 'undefined') {
        console.warn(`Warning: GeoJSON property "${GEOJSON_ID_PROPERTY}" not found in the first feature. Check configuration.`);
        // Potentially throw error depending on strictness
    }

    geojsonData = geoData;
    disasterData = processCsvData(csvData);
    console.log("Processed CSV Data Sample:", disasterData.slice(0, 5));

    if (!disasterData || disasterData.length === 0) {
        throw new Error("CSV data processing resulted in an empty dataset.");
    }
    const hasIsoCodes = disasterData.some(d => d.iso);
    if (!hasIsoCodes) {
        console.warn(`Warning: No valid "${CSV_COUNTRY_CODE_COLUMN}" codes found. Map/country features might not work.`);
    }

    const lon180 = projection([180, 0])[0];
    const lonNeg180 = projection([-180, 0])[0];
    worldWidth = lon180 - lonNeg180;
    console.log("Calculated world width:", worldWidth);
    if (worldWidth <= 0) {
        console.warn("World width calculation seems incorrect. Map wrapping might fail.");
        // Fallback or default width might be needed depending on projection
        worldWidth = width * 2; // A guess if calculation fails
    }

    // Build the hierarchy for filters
    eventHierarchy = buildHierarchy(disasterData);
    console.log("Built Event Hierarchy:", eventHierarchy);

    // Populate filters
    populateYearFilter(disasterData);
    populateGroupFilter(); // Start the cascade for hierarchical filters

    // Initial setup
    setupZoom();
    applyFilters(); // Initial draw with default filters

    console.log("Initialization complete.");

}).catch(error => {
    console.error("Error during initialization:", error);
    mapContainer.html(`<div class="loading" style="color: red; font-weight: bold;">Error loading or processing data: ${error.message}. Please check console and data files.</div>`);
});


// --- Data Processing ---
function processCsvData(csvData) {
    const parseNA = (value) => (value === 'NA' || value === '' || value === undefined || value === null) ? null : value;
    const parseFloatNA = (value) => { /* ... keep existing ... */ };
    const parseIntNA = (value) => { /* ... keep existing ... */ };

    // Check required columns (add new ones)
    if (csvData.length > 0) {
        const headers = Object.keys(csvData[0]);
        const requiredColumns = [
            'DisNo.', CSV_COUNTRY_CODE_COLUMN, 'Country', CSV_YEAR_COLUMN,
            'Start Year', 'End Year', 'Start Month', 'End Month',
            CSV_GROUP_COLUMN, CSV_TYPE_COLUMN, CSV_SUBTYPE_COLUMN, // Added hierarchy columns
            'Location', 'Total Deaths', 'No. Injured', 'Total Affected',
            "Total Damage, Adjusted ('000 US$)", 'Duration', 'Magnitude', 'Magnitude Scale'
        ];
        requiredColumns.forEach(col => {
            if (!headers.includes(col)) {
                console.warn(`Warning: Expected CSV column "${col}" not found.`);
            }
        });
    }

    return csvData.map((d, i) => ({
        id: d['DisNo.'] || `event-${i}`,
        iso: parseNA(d[CSV_COUNTRY_CODE_COLUMN]), // Critical for linking
        countryName: parseNA(d.Country),
        startYear: parseIntNA(d['Start Year']),
        // Add Group, Type, Subtype
        group: parseNA(d[CSV_GROUP_COLUMN]),
        type: parseNA(d[CSV_TYPE_COLUMN]),
        subtype: parseNA(d[CSV_SUBTYPE_COLUMN]),
        // ... keep other properties like location, deaths, damage, etc.
        location: parseNA(d.Location),
        origin: parseNA(d.Origin),
        endYear: parseIntNA(d['End Year']),
        startMonth: parseIntNA(d['Start Month']),
        endMonth: parseIntNA(d['End Month']),
        magnitude: parseFloatNA(d.Magnitude),
        magnitudeScale: parseNA(d['Magnitude Scale']),
        totalDeaths: parseIntNA(d['Total Deaths']),
        noInjured: parseIntNA(d['No. Injured']),
        noAffected: parseIntNA(d['No. Affected']),
        noHomeless: parseIntNA(d['No. Homeless']),
        totalAffected: parseIntNA(d['Total Affected']),
        totalDamageKUSD: parseFloatNA(d["Total Damage ('000 US$)"]),
        totalDamageAdjustedKUSD: parseFloatNA(d["Total Damage, Adjusted ('000 US$)"]),
        cpi: parseFloatNA(d.CPI),
        duration: parseIntNA(d.Duration)
    }));
}

// --- Hierarchy Building ---
function buildHierarchy(data) {
    const hierarchy = { all: {} }; // Start with 'all' group

    data.forEach(d => {
        const group = d.group || 'Unknown Group'; // Handle nulls
        const type = d.type || 'Unknown Type';
        const subtype = d.subtype || 'Unknown Subtype';

        if (!hierarchy[group]) {
            hierarchy[group] = { all: {} }; // Add 'all' type to each group
        }
        if (!hierarchy[group][type]) {
            hierarchy[group][type] = { all: 'All Subtypes' }; // Add 'all' subtype to each type
        }
        if (subtype) { // Only add specific subtypes if they exist
             hierarchy[group][type][subtype] = subtype; // Store subtype value (or just true)
        }
    });

     // Add top-level 'all' options for Types and Subtypes within the 'all' Group
    const allTypes = new Set();
    const allSubtypes = new Set();
    data.forEach(d => {
        if(d.type) allTypes.add(d.type);
        if(d.subtype) allSubtypes.add(d.subtype);
    });
    hierarchy.all = { all: { all: 'All Subtypes'} }; // Base 'all' structure
    [...allTypes].sort().forEach(type => {
        hierarchy.all[type] = { all: 'All Subtypes' }; // Add each type under 'all' group
        // Populate subtypes under the 'all' group's types if needed, or keep simple
    });
     // For simplicity, the 'all' group's types might just have 'All Subtypes'

    return hierarchy;
}
// --- Filter Population ---
function populateYearFilter(data) {
    // ... (keep existing year filter logic, ensure default text is "All")
    const years = [...new Set(data.map(d => d.startYear).filter(y => y !== null))].sort((a, b) => a - b);
    if (years.length === 0) { /* ... handle no years ... */ return; }
    const minYear = years[0];
    const maxYear = years[years.length - 1];

    const slider = d3.select("#year-slider");
    slider.attr("min", minYear)
          .attr("max", maxYear)
          .property("value", maxYear); // Set slider position, but filter starts at 'all'

    // Set initial state to show all years
    currentFilterYear = null;
    d3.select("#year-value").text("All");

    slider.on("input", function() {
        currentFilterYear = +this.value;
        d3.select("#year-value").text(currentFilterYear);
        applyFilters();
    });

    d3.select("#reset-year").on("click", () => {
        currentFilterYear = null; // Indicate all years
        slider.property("value", maxYear); // Visually reset slider position
        d3.select("#year-value").text("All");
        applyFilters();
    });
}

// Helper to populate a dropdown
function populateDropdown(selectElement, options, selectedValue = 'all') {
    // Ensure 'options' is an array. If it's an object (like subtypes), get keys.
    let optionsArray = Array.isArray(options) ? options : Object.keys(options);

    // Filter out the 'all' key if it exists in the keys, we'll add it manually
    optionsArray = optionsArray.filter(opt => opt !== 'all').sort();

    // Determine the text for the 'all' option based on the dropdown level
    let allText = "All";
    if (selectElement.attr('id') === 'group-select') allText = "All Groups";
    else if (selectElement.attr('id') === 'type-select') allText = "All Types";
    else if (selectElement.attr('id') === 'subtype-select') allText = "All Subtypes";

    // Prepend the 'All' option
    optionsArray.unshift('all');

    selectElement.selectAll("option")
        .data(optionsArray)
        .join("option")
        .attr("value", d => d)
        .text(d => (d === 'all' ? allText : d)); // Use specific "All" text

    selectElement.property("value", selectedValue); // Set the current selection
}

// Populate Group Filter (Top Level)
function populateGroupFilter() {
    const groups = Object.keys(eventHierarchy).sort(); // Get groups including 'all'
    populateDropdown(groupSelect, groups, currentFilterGroup);
    // Add event listener (only needs to be added once)
    groupSelect.on("change", function() {
        currentFilterGroup = this.value;
        currentFilterType = 'all'; // Reset lower levels
        currentFilterSubtype = 'all';
        updateTypeFilter(); // Update dependent dropdown
        applyFilters(); // Apply the change
    });
    // Initial call to populate lower levels
    updateTypeFilter();
}

// Update Type Filter (Depends on Group)
function updateTypeFilter() {
    let types = [];
    if (eventHierarchy[currentFilterGroup]) {
        types = Object.keys(eventHierarchy[currentFilterGroup]).sort();
    }
    populateDropdown(typeSelect, types, currentFilterType);
    // Add event listener (only needs to be added once)
    typeSelect.on("change", function() {
        currentFilterType = this.value;
        currentFilterSubtype = 'all'; // Reset lower level
        updateSubtypeFilter(); // Update dependent dropdown
        applyFilters(); // Apply the change
    });
     // Initial call to populate lower level
    updateSubtypeFilter();
}


// Update Subtype Filter (Depends on Group and Type)
function updateSubtypeFilter() {
    let subtypes = [];
    if (eventHierarchy[currentFilterGroup] && eventHierarchy[currentFilterGroup][currentFilterType]) {
        subtypes = Object.keys(eventHierarchy[currentFilterGroup][currentFilterType]).sort();
    }
    populateDropdown(subtypeSelect, subtypes, currentFilterSubtype);
     // Add event listener (only needs to be added once)
    subtypeSelect.on("change", function() {
        currentFilterSubtype = this.value;
        // No lower level to update
        applyFilters(); // Apply the change
    });
}

// --- Filtering Logic ---
function applyFilters() {
    console.log(`Applying filters: Year=${currentFilterYear ?? 'All'}, Group=${currentFilterGroup}, Type=${currentFilterType}, Subtype=${currentFilterSubtype}`);
    filteredData = disasterData.filter(d => {
        if (!d.iso) return false; // Must have ISO to link
        const yearMatch = currentFilterYear === null || (d.startYear !== null && d.startYear === currentFilterYear);
        const groupMatch = currentFilterGroup === 'all' || (d.group || 'Unknown Group') === currentFilterGroup;
        const typeMatch = currentFilterType === 'all' || (d.type || 'Unknown Type') === currentFilterType;
        const subtypeMatch = currentFilterSubtype === 'all' || (d.subtype || 'Unknown Subtype') === currentFilterSubtype;
        return yearMatch && groupMatch && typeMatch && subtypeMatch;
    });
    console.log(`Filter resulted in ${filteredData.length} events.`);

    // Aggregate data by country
    eventsByCountry.clear();
    filteredData.forEach(d => {
        // DEBUG: Log the ISO code being added
        // console.log(`Adding event for ISO: ${d.iso}`);
        if (!eventsByCountry.has(d.iso)) {
            eventsByCountry.set(d.iso, []);
        }
        eventsByCountry.get(d.iso).push(d);
    });
    // DEBUG: Log the final map
    // console.log("Events by Country Map:", eventsByCountry);
    console.log(`Aggregated events for ${eventsByCountry.size} countries.`);

    drawMap();
    updateLegend();
    // DEBUG: Force info panel update even if country selection hasn't changed
    // This helps if the underlying data for the selected country changed due to filters
    updateInfoPanel();
}


// --- Map Drawing (Implement Wrapping) ---
function drawMap() {
    if (!geojsonData || worldWidth <= 0) {
        console.error("Cannot draw map. GeoJSON not loaded or worldWidth invalid.");
        return;
    }
    // console.log("Redrawing map with wrapping...");

    // Data for map copies: center, left, right
    const mapDataCopies = [-1, 0, 1].map(offset => ({
        offset: offset,
        idSuffix: offset === -1 ? '-left' : (offset === 1 ? '-right' : ''), // Unique ID part for features in copies
        features: geojsonData.features
    }));

    // Bind data to groups for each copy
    mapContent.selectAll("g.map-copy")
        .data(mapDataCopies, d => d.offset) // Key by offset
        .join(
            enter => enter.append("g")
                .attr("class", "map-copy")
                .attr("transform", d => `translate(${d.offset * worldWidth}, 0)`), // Apply offset translation
            update => update // No need to update transform usually, unless worldWidth changes
        )
        .each(function(copyData) { // Use 'each' to handle paths within each group
            // Select paths within the current group 'this'
            d3.select(this).selectAll("path.country")
                // Key features by their original ID + suffix for uniqueness across copies
                .data(copyData.features, d => d.id ? (d.id + copyData.idSuffix) : null)
                .join(
                    enter => enter.append("path")
                        .attr("class", "country")
                        .attr("d", pathGenerator)
                        .attr("fill", d => getCountryColor(d.id)) // Color based on original ID
                        .on("click", handleCountryClick) // Events reference original data 'd'
                        .on("mouseover", handleMouseOver)
                        .on("mouseout", handleMouseOut),
                    update => update
                        .attr("fill", d => getCountryColor(d.id)) // Update fill based on original ID
                        // Update selection class based on comparison with selectedCountryISO (original ID)
                        .attr("class", d => `country ${d.id === selectedCountryISO ? 'selected' : ''}`),
                    exit => exit.remove()
                );
        });

     // console.log("Map redraw complete.");
}

function populateEventTypeFilter(data) {
    const types = [...new Set(data.map(d => d.type).filter(t => t !== null && t !== ''))].sort();
     if (types.length === 0) {
        console.warn("No valid event types found in data for type filter.");
        d3.select("#event-type-select").attr("disabled", true);
        return;
    }
    const select = d3.select("#event-type-select");

    // Clear previous dynamic options if any
    select.selectAll("option.dynamic").remove();

    // Add new options
    select.selectAll("option.dynamic")
        .data(types)
        .join("option")
        .attr("class", "dynamic")
        .attr("value", d => d)
        .text(d => d);

    // Reset selection to 'all'
    select.property("value", "all");
    currentFilterEventType = 'all';


    select.on("change", function() {
        currentFilterEventType = this.value;
        applyFilters();
    });
}



// --- Map Drawing ---
function drawMap() {
    if (!geojsonData || !geojsonData.features) {
        console.error("GeoJSON data is missing or invalid!");
        return;
    }
    console.log("Sample GeoJSON feature:", geojsonData.features[0]); // 查看第一个feature的结构

    geojsonData.features.forEach((feature, index) => {
        if (!feature.geometry) {
            console.error(`Feature at index ${index} has no geometry:`, feature);
        } else if (!feature.geometry.coordinates || feature.geometry.coordinates.length === 0) {
            console.error(`Feature at index ${index} has invalid coordinates:`, feature);
        }
        // 更细致的坐标检查可以深入到 coordinates 数组内部
    });

    svg.selectAll("path.country")
        .data(geojsonData.features, d => d.id) // Use top-level ID as key
        .join(
            enter => enter.append("path")
                .attr("class", "country")
                // .attr("d", pathGenerator)
                .attr("d", d => { // 修改这里进行调试
                    const pathString = pathGenerator(d);
                    if (typeof pathString === 'string' && pathString.includes("NaN")) {
                        console.error("NaN detected in path string for feature:", d);
                        console.log("Problematic path string:", pathString);
                        // 如果 pathGenerator 依赖一个 projection，可以打印 projection 的状态
                        // console.log("Current projection:", projection);
                        // console.log("Projection of a sample coordinate:", projection(d.geometry.coordinates[0][0][0])); // 取决于geometry类型
                    }
                    return pathString;
                })
                .attr("fill", d => getCountryColor(d.id)) // Use d.id
                .on("click", handleCountryClick)
                .on("mouseover", handleMouseOver)
                .on("mouseout", handleMouseOut),
            update => update
                .attr("fill", d => getCountryColor(d.id)) // Use d.id
                .attr("class", d => `country ${d.id === selectedCountryISO ? 'selected' : ''}`), // Use d.id
            exit => exit.remove()
        );
     // console.log("Map redraw complete.");
}


function getCountryColor(isoCode) {
    if (!isoCode) return '#ccc';
    const events = eventsByCountry.get(isoCode); // Lookup using original ISO code
    const count = events ? events.length : 0;
    const color = count > 0 ? colorScale(count) : '#e0e0e0';
    return color;
}

// --- Map Interactions ---
// Event handlers now receive data 'd' which is the original feature data,
// even if clicked on a translated copy.
function handleCountryClick(event, d) {
    const clickedISO = d.id; // Get original ID from the feature data 'd'
    if (!clickedISO) {
        console.log("Clicked on a feature with no ID property:", d);
        return;
    }
    console.log("Clicked country ID:", clickedISO);

    // Toggle selection
    selectedCountryISO = (selectedCountryISO === clickedISO) ? null : clickedISO;
    selectedEventId = null; // Reset selected event

    // Update map highlighting on ALL copies
    mapContent.selectAll("path.country") // Select all paths across all copies
        .classed("selected", featureData => featureData.id === selectedCountryISO); // Compare feature's original ID

    updateInfoPanel(); // Update the info panel
}

function handleMouseOver(event, d) {
    const isoCode = d.id; // Original ID from feature data 'd'
    if (isoCode) {
        const countryName = d.properties?.name || isoCode;
        const events = eventsByCountry.get(isoCode); // Use original ID
        const count = events ? events.length : 0;

        tooltip.style("opacity", 0.9)
               .html(`${countryName}<br/>Events: ${count}`)
               // Position relative to the event page coordinates
               .style("left", (event.pageX + 10) + "px")
               .style("top", (event.pageY - 28) + "px");
    }
     // Rely on CSS for hover effect on the specific path element hovered
}

function handleMouseOut(event, d) {
    tooltip.style("opacity", 0);
     // Rely on CSS for hover effect removal
}


// --- Zoom Functionality ---
function setupZoom() {
    zoomBehavior = d3.zoom()
        .scaleExtent([0.8, 15]) // Allow slight zoom out, increased max zoom
        .on("zoom", (event) => {
            // Apply the transform to the group containing all map copies
            mapContent.attr('transform', event.transform);
        });

    // Apply zoom behavior to the main SVG element
    svg.call(zoomBehavior);

    // Add zoom reset button listener (keep as is)
    d3.select('#reset-zoom').on('click', () => {
        svg.transition().duration(750).call(
            zoomBehavior.transform,
            d3.zoomIdentity // Resets to scale 1, translate 0,0
        );
    });
}

// --- Info Panel Update (DEBUGGING) ---
function updateInfoPanel() {
    // Clear previous content first
    countryInfoDiv.html(''); // Clear previous country info/list
    clearEventDetails();    // Clear previous event details

    console.log(`--- Updating info panel for selected country: ${selectedCountryISO} ---`); // LOG Start

    if (selectedCountryISO) {
        // DEBUG: Check if the selected ISO exists in the eventsByCountry map
        const hasData = eventsByCountry.has(selectedCountryISO);
        console.log(`Does eventsByCountry have data for ${selectedCountryISO}? ${hasData}`);

        // Get the events *after* filtering
        const countryEvents = eventsByCountry.get(selectedCountryISO) || []; // Default to empty array if no data
        console.log(`Found ${countryEvents.length} events for ${selectedCountryISO} in the filtered data.`); // LOG Event count

        // Try to find the country name from GeoJSON (using original ID)
        const countryData = geojsonData.features.find(f => f.id === selectedCountryISO);
        const countryName = countryData?.properties?.name || selectedCountryISO; // Use name from GeoJSON if available
        console.log(`Country Name: ${countryName}`); // LOG Country name

        // Add the country header
        countryInfoDiv.append("h3").text(countryName);

        if (countryEvents.length > 0) {
            countryInfoDiv.append("p").text(`Found ${countryEvents.length} event(s) matching filters.`);
            const list = countryInfoDiv.append("ul"); // Append the list container

            // DEBUG: Log before adding list items
            console.log("Attempting to add list items...");

            list.selectAll("li")
                .data(countryEvents, d => d.id) // Use event ID as key
                .join("li")
                .text(d => `${d.startYear}: ${d.type || 'Unknown Type'}`)
                .classed("selected-event", d => d.id === selectedEventId)
                .style("cursor", "pointer")
                .on("click", (event, d) => {
                     console.log("Clicked event list item:", d.id); // LOG Event click
                    if (selectedEventId !== d.id) {
                        selectedEventId = d.id;
                        displayEventDetails(d);
                        // Update highlighting on the list
                        list.selectAll("li")
                            .classed("selected-event", li_d => li_d.id === selectedEventId);
                    }
                });

             // DEBUG: Log after attempting to add list items
             console.log("Finished adding list items (if any).");

            // If an event was previously selected, try to re-display its details
            const currentlySelectedEventData = countryEvents.find(e => e.id === selectedEventId);
            if (currentlySelectedEventData) {
                 console.log("Re-displaying previously selected event details:", selectedEventId);
                 displayEventDetails(currentlySelectedEventData);
            } else {
                 // selectedEventId might be null or the event is no longer in the filtered list
                 selectedEventId = null; // Ensure it's cleared if not found
                 clearEventDetails(); // Clear details panel
            }

        } else {
            // No events found for the selected country with current filters
             console.log("No events found for this country/filter combination.");
            countryInfoDiv.append("p").text("No events found matching the current filters for this country.");
            clearEventDetails(); // Still clear details
        }
    } else {
        // No country selected - display default text
        console.log("No country selected, displaying default info text.");
        countryInfoDiv.html("<p>Select a country on the map to view its extreme events based on the current filters.</p>");
        clearEventDetails(); // Clear details panel
    }
     console.log("--- Finished updating info panel ---"); // LOG End
}

function displayEventDetails(eventData) {
    // ... (Keep existing table generation logic, including added Group/Type/Subtype rows)
    console.log("Displaying details for event:", eventData.id);
    eventDetailsDiv.style("display", "block"); // Ensure parent is visible

    const formatNum = (num) => num?.toLocaleString() ?? 'N/A';
    const formatText = (text) => text ?? 'N/A';
    const formatDate = (startYear, startMonth, endYear, endMonth) => {
        let start = `${formatText(startMonth)}/${formatText(startYear)}`;
        let end = `${formatText(endMonth)}/${formatText(endYear)}`;
        if (start.includes('N/A') && end.includes('N/A')) return 'N/A';
        if (start === end || end.includes('N/A')) return start; // Show only start if end is same or missing
        if (start.includes('N/A')) return end; // Show only end if start is missing
        return `${start} - ${end}`;
    };

    let tableHTML = `
        <h4>Event Details</h4>
        <table class="details-table">
            <tbody>
                <tr><td>ID</td><td>${formatText(eventData.id)}</td></tr>
                <tr><td>Group</td><td>${formatText(eventData.group)}</td></tr>
                <tr><td>Type</td><td>${formatText(eventData.type)}</td></tr>
                <tr><td>Subtype</td><td>${formatText(eventData.subtype)}</td></tr>
                <tr><td>Date</td><td>${formatDate(eventData.startYear, eventData.startMonth, eventData.endYear, eventData.endMonth)}</td></tr>
                <tr><td>Location</td><td>${formatText(eventData.location)}</td></tr>
                <tr><td>Deaths</td><td>${formatNum(eventData.totalDeaths)}</td></tr>
                <tr><td>Injured</td><td>${formatNum(eventData.noInjured)}</td></tr>
                <tr><td>Affected</td><td>${formatNum(eventData.totalAffected)}</td></tr>
                <tr><td>Damage (Adj. K USD)</td><td>${formatNum(eventData.totalDamageAdjustedKUSD)}</td></tr>
                <tr><td>Duration (days?)</td><td>${formatNum(eventData.duration)}</td></tr>
                <tr><td>Magnitude</td><td>${formatText(eventData.magnitude)} ${formatText(eventData.magnitudeScale) || ''}</td></tr>
            </tbody>
        </table>
    `;
    // Target the inner div for content replacement
    detailsContentDiv.html(tableHTML);
}


function clearEventDetails() {
     eventDetailsDiv.style("display", "block"); // Keep section visible
     detailsContentDiv.html("<p>Click an event in the list above for details.</p>"); // Clear content
}

// --- Legend ---
function updateLegend() {
    legendDiv.selectAll("*").remove(); // Clear existing legend items

    legendDiv.append("h3").text("Event Count per Country");

    // Add item for 0 events (using the grey color)
     const zeroItem = legendDiv.append("div").attr("class", "legend-item");
    zeroItem.append("div")
        .attr("class", "legend-color")
        .style("background-color", '#e0e0e0'); // Match the '0' color used in getCountryColor
    zeroItem.append("span").text("0");


    // Add items for the threshold ranges
    const thresholds = colorScale.domain(); // e.g., [1, 5, 10, 25, 50, 100]
    const colors = colorScale.range(); // e.g., 7 colors

    thresholds.forEach((threshold, i) => {
        const item = legendDiv.append("div").attr("class", "legend-item");
        item.append("div")
            .attr("class", "legend-color")
            .style("background-color", colors[i]); // colors[0] is for domain[0] (e.g., 1-5)

        const lowerBound = i === 0 ? 1 : thresholds[i-1] + 1;
        const upperBound = threshold;
        item.append("span").text(`${lowerBound} - ${upperBound}`);
    });

    // Add item for the highest range (above the last threshold)
    const lastItem = legendDiv.append("div").attr("class", "legend-item");
    lastItem.append("div")
        .attr("class", "legend-color")
        .style("background-color", colors[colors.length - 1]); // Last color in the range
    lastItem.append("span").text(`> ${thresholds[thresholds.length - 1]}`);
}


// --- Responsive Resizing (Basic Example - Optional) ---
// window.addEventListener('resize', () => {
//     // Debounce this function in a real application
//     width = parseInt(mapContainer.style("width"));
//     height = parseInt(mapContainer.style("height"));
//     projection.translate([width / 2, height / 2]);
//     // Maybe adjust scale based on width?
//     // projection.scale(newScale);
//     svg.selectAll("path.country").attr("d", pathGenerator); // Redraw paths
//     console.log("Window resized - map paths redrawn (can be slow).");
// });