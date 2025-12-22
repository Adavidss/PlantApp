// Global function to handle image load errors - must be outside DOMContentLoaded for inline handlers
function handleImageError(img) {
    const PLACEHOLDER_IMG = 'MushroomApp.png';
    if (img.src !== PLACEHOLDER_IMG && !img.src.includes('MushroomApp.png') && !img.src.endsWith(PLACEHOLDER_IMG)) {
        img.onerror = null; // Prevent infinite loop
        img.src = PLACEHOLDER_IMG;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    // API keys are loaded from config.js

    // API Configuration
    const API_SOURCES = {
        perenual: { enabled: true, name: "Perenual" },
        inaturalist: { enabled: true, name: "iNaturalist" },
        toxicshrooms: { enabled: true, name: "Toxic Shrooms" }
    };

    // --- GLOBAL STATE ---
    let favorites = JSON.parse(localStorage.getItem('plantFavorites')) || [];

    // Fallback image path
    const PLACEHOLDER_IMG = 'MushroomApp.png'; // Local fallback image

    // --- API LOGIC ---

    const API_BASE_URL = "https://perenual.com/api/v2";

    /**
     * Fetches plant list with optional filters and search
     */
    async function getPlantList(page = 1, filters = {}) {
        // Limit to 10 results per page to reduce API calls and bandwidth
        let url = `${API_BASE_URL}/species-list?key=${PERENUAL_API_KEY}&page=${page}&per_page=10`;

        // Add filters to URL
        if (filters.search) url += `&q=${encodeURIComponent(filters.search)}`;
        if (filters.edible !== undefined) url += `&edible=${filters.edible ? 1 : 0}`;
        if (filters.poisonous !== undefined) url += `&poisonous=${filters.poisonous ? 1 : 0}`;
        if (filters.indoor !== undefined) url += `&indoor=${filters.indoor ? 1 : 0}`;
        if (filters.cycle) url += `&cycle=${filters.cycle}`;
        if (filters.watering) url += `&watering=${filters.watering}`;
        if (filters.sunlight) url += `&sunlight=${filters.sunlight}`;
        if (filters.hardiness) url += `&hardiness=${filters.hardiness}`;

        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('🚫 API rate limit exceeded. The free tier allows limited requests per day. Please wait a few minutes and try again, or consider upgrading your API plan at https://perenual.com');
            }
            throw new Error(`Plant list request failed: ${response.status}`);
        }
        return await response.json();
    }

    /**
     * Fetches detailed information for a specific plant (with caching)
     */
    async function getPlantDetails(plantId, retries = 1) {
        console.log(`📡 getPlantDetails: Fetching plant ID ${plantId}`);

        // Check if this is a non-Perenual source ID
        const isNonPerenual = typeof plantId === 'string' && (
            plantId.startsWith('inat_') || 
            plantId.startsWith('toxic_') || 
            plantId.startsWith('gbif_') ||
            plantId.startsWith('trefle_')
        );

        // Check cache first (24-hour TTL) - check BEFORE any API calls
        const cacheKey = `plant_${plantId}`;
        const cached = localStorage.getItem(cacheKey);
        const cacheTime = localStorage.getItem(`${cacheKey}_time`);
        const now = Date.now();

        if (cached && cacheTime) {
            const age = now - parseInt(cacheTime);
            if (age < 86400000) { // 24 hours
                console.log(`📡 getPlantDetails: ✅ Using cached data for plant ${plantId} (age: ${Math.round(age / 1000 / 60)} minutes)`);
                return JSON.parse(cached);
            } else {
                console.log(`📡 getPlantDetails: Cache expired for plant ${plantId} (age: ${Math.round(age / 1000 / 60 / 60)} hours)`);
            }
        }

        // For non-Perenual sources, don't try to fetch from Perenual API
        if (isNonPerenual) {
            // Check in-memory cache
            const cachedPlant = plantCache.get(plantId);
            if (cachedPlant) {
                console.log(`📡 getPlantDetails: ✅ Using in-memory cache for non-Perenual plant ${plantId}`);
                return cachedPlant;
            }
            // If no cache, return error or basic structure
            throw new Error(`Cannot fetch details for non-Perenual plant ${plantId}. Please use cached data or loadPlantDetails with source parameter.`);
        }

        // Fetch from API with rate limiting protection (only for Perenual)
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                // Rate limiting: wait if we called API too recently
                const now = Date.now();
                const timeSinceLastCall = now - lastApiCallTime;
                if (timeSinceLastCall < API_COOLDOWN_MS) {
                    const waitTime = API_COOLDOWN_MS - timeSinceLastCall;
                    console.log(`📡 getPlantDetails: Rate limiting - waiting ${waitTime}ms before API call`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
                lastApiCallTime = Date.now();

                const url = `${API_BASE_URL}/species/details/${plantId}?key=${PERENUAL_API_KEY}`;
                console.log(`📡 getPlantDetails: Attempt ${attempt}, URL:`, url);

                const response = await fetch(url);
                console.log(`📡 getPlantDetails: Response status:`, response.status);

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`📡 getPlantDetails: Error response:`, errorText);

                    // Handle rate limiting specifically
                    if (response.status === 429) {
                        throw new Error('🚫 API rate limit exceeded. The free tier allows limited requests per day. Please wait a few minutes and try again, or consider upgrading your API plan at https://perenual.com');
                    }

                    if (attempt === retries) throw new Error(`Plant details failed: ${response.status}`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;
                }

                const data = await response.json();
                console.log(`📡 getPlantDetails: Got data for:`, data.common_name || data.scientific_name);

                // Validate that we have minimum required data
                if (!data.id) {
                    throw new Error('Invalid plant data: missing ID');
                }

                const formatted = formatPlantData(data);

                // Cache the result
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(formatted));
                    localStorage.setItem(`${cacheKey}_time`, now.toString());
                    console.log(`📡 getPlantDetails: Cached plant ${plantId}`);
                } catch (e) {
                    console.warn('Failed to cache plant data:', e);
                }

                return formatted;
            } catch (error) {
                console.error(`📡 getPlantDetails: Attempt ${attempt} error:`, error);
                if (attempt === retries) throw error;
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }

    /**
     * Formats raw API plant data into our app format
     */
    function formatPlantData(data) {
        const commonName = data.common_name || 'Unknown Plant';
        const scientificName = data.scientific_name?.join?.(', ') || data.scientific_name || 'N/A';
        const wikipediaUrl = getWikipediaUrl(commonName) || getWikipediaUrl(scientificName);
        
        return {
            id: data.id,
            source: 'perenual', // Add source for badge display
            common_name: commonName,
            scientific_name: scientificName,
            description: data.description || 'No description available.',
            image_url: data.default_image?.regular_url || data.default_image?.original_url || PLACEHOLDER_IMG,
            wikipedia_url: wikipediaUrl,

            // Basic traits
            cycle: data.cycle || 'N/A',
            watering: data.watering || 'N/A',
            sunlight: Array.isArray(data.sunlight) ? data.sunlight.join(', ') : (data.sunlight || 'N/A'),

            // Care requirements
            watering_period: data.watering_period || 'N/A',
            watering_general_benchmark: {
                value: data.watering_general_benchmark?.value || 'N/A',
                unit: data.watering_general_benchmark?.unit || ''
            },
            depth_water_requirement: {
                value: data.depth_water_requirement?.value || 'N/A',
                unit: data.depth_water_requirement?.unit || ''
            },
            volume_water_requirement: {
                value: data.volume_water_requirement?.value || 'N/A',
                unit: data.volume_water_requirement?.unit || ''
            },

            // Growth info
            dimension: data.dimension || 'N/A',
            type: data.type || 'N/A',
            growth_rate: data.growth_rate || 'N/A',
            maintenance: data.maintenance || 'N/A',
            care_level: data.care_level || 'N/A',
            flowers: data.flowers || false,
            flowering_season: data.flowering_season || 'N/A',
            flower_color: data.flower_color || 'N/A',

            // Special attributes
            edible_fruit: data.edible_fruit || false,
            edible_leaf: data.edible_leaf || false,
            poisonous_to_humans: data.poisonous_to_humans || 0,
            poisonous_to_pets: data.poisonous_to_pets || 0,
            medicinal: data.medicinal || false,
            invasive: data.invasive || false,
            tropical: data.tropical || false,
            indoor: data.indoor || false,
            cuisine: data.cuisine || false,

            // Environment
            hardiness: {
                min: data.hardiness?.min || 'N/A',
                max: data.hardiness?.max || 'N/A'
            },
            hardiness_location: {
                full_url: data.hardiness_location?.full_url || null,
                full_iframe: data.hardiness_location?.full_iframe || null
            },

            // Soil and propagation
            soil: Array.isArray(data.soil) ? data.soil.join(', ') : (data.soil || 'N/A'),
            propagation: Array.isArray(data.propagation) ? data.propagation.join(', ') : (data.propagation || 'N/A'),

            // Additional info
            attracts: Array.isArray(data.attracts) ? data.attracts.join(', ') : (data.attracts || 'N/A'),
            origin: Array.isArray(data.origin) ? data.origin.join(', ') : (data.origin || 'N/A'),
            other_name: Array.isArray(data.other_name) ? data.other_name.slice(0, 3).join(', ') : (data.other_name || 'N/A'),
        };
    }

    /**
     * Get total plants count (hardcoded to avoid API calls)
     */
    function getTotalPlantsCount() {
        // Hardcoded value to avoid unnecessary API calls
        // Perenual has approximately 10,102 plants as of their documentation
        return 10100;
    }

    /**
     * Curated list of plant IDs that are known to work well
     * This reduces failed API calls from random invalid IDs
     */
    const CURATED_PLANT_IDS = [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,           // Common plants
        50, 100, 150, 200, 250, 300, 350, 400,    // Well-distributed IDs
        500, 600, 700, 800, 900, 1000,
        1100, 1200, 1300, 1400, 1500, 1600,
        2000, 2500, 3000, 3500, 4000, 4500,
        5000, 5500, 6000, 6500, 7000, 7500,
        8000, 8500, 9000, 9500, 10000
    ];

    /**
     * Fetches a random plant using curated IDs (reduces API calls)
     */
    async function getRandomPlant() {
        console.log('🎲 getRandomPlant: Starting...');

        // Try to find a cached plant first to avoid API calls
        const cachedIds = [];
        for (const id of CURATED_PLANT_IDS) {
            const cacheKey = `plant_${id}`;
            const cached = localStorage.getItem(cacheKey);
            const cacheTime = localStorage.getItem(`${cacheKey}_time`);
            if (cached && cacheTime) {
                const age = Date.now() - parseInt(cacheTime);
                if (age < 86400000) { // 24 hours
                    cachedIds.push(id);
                }
            }
        }

        // Prefer cached IDs, but fall back to any curated ID if no cache
        let randomId;
        if (cachedIds.length > 0) {
            randomId = cachedIds[Math.floor(Math.random() * cachedIds.length)];
            console.log(`🎲 getRandomPlant: Using cached plant ID ${randomId} (${cachedIds.length} cached plants available)`);
        } else {
            randomId = CURATED_PLANT_IDS[Math.floor(Math.random() * CURATED_PLANT_IDS.length)];
            console.log(`🎲 getRandomPlant: Using curated plant ID ${randomId} (no cache available)`);
        }

        try {
            const plantDetails = await getPlantDetails(randomId, 1); // Only 1 retry
            console.log('🎲 getRandomPlant: ✅ Success!', plantDetails.common_name);
            return plantDetails;
        } catch (error) {
            console.error('🎲 getRandomPlant: Failed:', error.message);
            // If we hit rate limit, try to use ANY cached plant (even expired ones)
            if (error.message.includes('rate limit')) {
                console.log('🎲 getRandomPlant: Rate limited, searching for ANY cached plant...');
                // Try to find ANY cached plant in localStorage, even if expired
                for (const id of CURATED_PLANT_IDS) {
                    const cacheKey = `plant_${id}`;
                    const cached = localStorage.getItem(cacheKey);
                    if (cached) {
                        try {
                            const plantData = JSON.parse(cached);
                            console.log(`🎲 getRandomPlant: ✅ Using cached plant ID ${id} due to rate limit (may be expired)`);
                            return plantData;
                        } catch (parseError) {
                            console.warn(`Failed to parse cached plant ${id}:`, parseError);
                            continue;
                        }
                    }
                }
                // If no cached plants found, throw a more helpful error
                throw new Error('🚫 API rate limit exceeded and no cached plants available. Please wait a few minutes and try again, or try the 🍄 Random Mushroom button (uses different APIs).');
            }
            throw error;
        }
    }

    /**
     * Fetches disease/pest information
     */
    async function getDiseasePestInfo(searchQuery = '', page = 1) {
        try {
            let url = `${API_BASE_URL}/pest-disease-list?key=${PERENUAL_API_KEY}&page=${page}`;
            if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`Disease/pest request failed: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("Error fetching disease/pest info:", error);
            return { data: [], total: 0 };
        }
    }

    // ==================== WIKIPEDIA HELPER ====================
    
    /**
     * Generate Wikipedia URL from plant/mushroom name
     */
    function getWikipediaUrl(name) {
        if (!name) return null;
        // Convert to Wikipedia URL format (spaces to underscores, encode)
        const wikiName = encodeURIComponent(name.replace(/\s+/g, '_'));
        return `https://en.wikipedia.org/wiki/${wikiName}`;
    }

    // ==================== INATURALIST API ====================

    /**
     * Search taxa on iNaturalist
     * Based on official API reference: https://www.inaturalist.org/pages/api+reference
     * 
     * @param {string} query - Search query (species name)
     * @param {number} page - Page number (default: 1)
     * @param {number} taxonId - Optional taxon ID to filter by (e.g., 47170 for Fungi kingdom)
     * @param {number} perPage - Results per page (default: 30, max: 200)
     * @returns {Promise<Object>} API response with results array and total_results
     */
    async function searchINaturalist(query, page = 1, taxonId = null, perPage = 30) {
        if (!API_SOURCES.inaturalist.enabled) {
            return { results: [], total_results: 0 };
        }

        try {
            // Build URL with proper parameters according to API reference
            // Base URL: https://api.inaturalist.org/v1/taxa
            let url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(query)}&page=${page}&per_page=${Math.min(perPage, 200)}`;
            
            // Add taxon_id filter if provided (for hierarchical filtering)
            if (taxonId) {
                url += `&taxon_id=${taxonId}`;
            }
            
            // Add order_by for consistent results (by observation count)
            url += '&order_by=observations_count&order=desc';

            console.log("iNaturalist API request:", url);
            
            // Make request with proper headers (including User-Agent as recommended)
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Plant-of-the-Day-App/1.0'
                },
                mode: 'cors'
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`iNaturalist API error ${response.status}:`, errorText);
                throw new Error(`iNaturalist search failed: ${response.status}`);
            }
            
            const data = await response.json();
            console.log("iNaturalist API response:", data);
            
            // iNaturalist API returns results in 'results' array and 'total_results' count
            return {
                results: data.results || [],
                total_results: data.total_results || 0
            };
        } catch (error) {
            console.error("iNaturalist API error:", error);
            return { results: [], total_results: 0 };
        }
    }

    /**
     * Get observations from iNaturalist
     */
    async function getINaturalistObservations(taxonId, page = 1) {
        if (!API_SOURCES.inaturalist.enabled) {
            return { results: [], total_results: 0 };
        }

        try {
            const url = `https://api.inaturalist.org/v1/observations?taxon_id=${taxonId}&page=${page}&per_page=20&order=desc&order_by=created_at`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`iNaturalist observations failed: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("iNaturalist observations error:", error);
            return { results: [], total_results: 0 };
        }
    }

    function formatINaturalistData(taxon) {
        // Get the best available photo URL
        let imageUrl = PLACEHOLDER_IMG;
        if (taxon.default_photo) {
            // Try URLs in order of quality
            imageUrl = taxon.default_photo.medium_url ||
                       taxon.default_photo.original_url ||
                       taxon.default_photo.large_url ||
                       taxon.default_photo.small_url ||
                       taxon.default_photo.url ||
                       imageUrl;
        } else if (taxon.taxon_photos && taxon.taxon_photos.length > 0) {
            const photo = taxon.taxon_photos[0].photo;
            imageUrl = photo.medium_url || photo.original_url || photo.large_url || photo.url || imageUrl;
        }

        // Extract taxonomic hierarchy from ancestry or direct fields
        let kingdom = 'N/A', phylum = 'N/A', class_rank = 'N/A', order = 'N/A', family = 'N/A', genus = 'N/A';
        
        if (taxon.ancestry) {
            // Parse ancestry string (comma-separated taxon IDs)
            // We'd need to fetch each ancestor to get names, so for now use direct fields if available
        }
        
        // Use direct taxonomy fields if available
        if (taxon.ancestors) {
            // Ancestors is an array of ancestor taxa
            taxon.ancestors.forEach(ancestor => {
                if (ancestor.rank === 'kingdom') kingdom = ancestor.name;
                else if (ancestor.rank === 'phylum') phylum = ancestor.name;
                else if (ancestor.rank === 'class') class_rank = ancestor.name;
                else if (ancestor.rank === 'order') order = ancestor.name;
                else if (ancestor.rank === 'family') family = ancestor.name;
                else if (ancestor.rank === 'genus') genus = ancestor.name;
            });
        }
        
        // Also check if current taxon is at one of these ranks
        if (taxon.rank === 'kingdom') kingdom = taxon.name;
        else if (taxon.rank === 'phylum') phylum = taxon.name;
        else if (taxon.rank === 'class') class_rank = taxon.name;
        else if (taxon.rank === 'order') order = taxon.name;
        else if (taxon.rank === 'family') family = taxon.name;
        else if (taxon.rank === 'genus') genus = taxon.name;

        const commonName = taxon.preferred_common_name || taxon.name;
        const scientificName = taxon.name;
        const wikipediaUrl = taxon.wikipedia_url || getWikipediaUrl(commonName) || getWikipediaUrl(scientificName);

        return {
            id: `inat_${taxon.id}`,
            source: 'inaturalist',
            common_name: commonName,
            scientific_name: scientificName,
            description: taxon.wikipedia_summary || taxon.observations || null,
            image_url: imageUrl,
            rank: taxon.rank || 'N/A',
            iconic_taxon_name: taxon.iconic_taxon_name || 'N/A',
            observations_count: taxon.observations_count || 0,
            wikipedia_url: wikipediaUrl,
            is_active: taxon.is_active || false,
            endemic: taxon.endemic || false,
            threatened: taxon.threatened || false,
            introduced: taxon.introduced || false,
            native: taxon.native || false,
            taxon_id: taxon.id,
            kingdom: kingdom,
            phylum: phylum,
            class: class_rank,
            order: order,
            family: family,
            genus: genus
        };
    }

    // ==================== TOXIC SHROOMS API ====================

    /**
     * Get all toxic mushrooms
     */
    async function getToxicShrooms(type = null) {
        if (!API_SOURCES.toxicshrooms.enabled) {
            return [];
        }

        try {
            let url = 'https://toxicshrooms.vercel.app/api/mushrooms';
            if (type) url += `/${type}`; // 'poisonous' or 'deadly'

            const response = await fetch(url);
            if (!response.ok) throw new Error(`Toxic Shrooms failed: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error("Toxic Shrooms API error:", error);
            return [];
        }
    }

    /**
     * Get random toxic mushroom
     */
    async function getRandomToxicShroom() {
        if (!API_SOURCES.toxicshrooms.enabled) {
            throw new Error('Toxic shrooms API is disabled');
        }

        try {
            // Fetch all mushrooms and pick a random one
            // The /randompic endpoint only returns an image URL, not full data
            const url = 'https://toxicshrooms.vercel.app/api/mushrooms';
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Toxic shrooms API failed: ${response.status}`);
            
            const mushrooms = await response.json();
            if (!mushrooms || mushrooms.length === 0) {
                throw new Error('No mushrooms returned from API');
            }
            
            // Pick a random mushroom from the list
            const randomIndex = Math.floor(Math.random() * mushrooms.length);
            const randomMushroom = mushrooms[randomIndex];
            
            console.log('🍄 Got random mushroom:', randomMushroom.name);
            return randomMushroom;
        } catch (error) {
            console.error("Random toxic shroom error:", error);
            throw error; // Re-throw to trigger error handling in caller
        }
    }

    /**
     * Get random mushroom from iNaturalist (Fungi kingdom)
     */
    async function getRandomINaturalistMushroom() {
        if (!API_SOURCES.inaturalist.enabled) {
            throw new Error('iNaturalist API is disabled');
        }

        try {
            // Search for fungi (taxon_id 47170 = Fungi kingdom)
            // Use a random page to get variety
            const randomPage = Math.floor(Math.random() * 50) + 1; // Pages 1-50 for variety
            const results = await searchINaturalist('', randomPage, 47170);
            
            if (!results.results || results.results.length === 0) {
                throw new Error('No fungi found in iNaturalist');
            }
            
            // Pick a random result from the page
            const randomIndex = Math.floor(Math.random() * results.results.length);
            const randomFungi = results.results[randomIndex];
            
            console.log('🍄 Got random iNaturalist mushroom:', randomFungi.name);
            return formatINaturalistData(randomFungi);
        } catch (error) {
            console.error("Random iNaturalist mushroom error:", error);
            throw error;
        }
    }

    /**
     * Get a random mushroom from either Toxic Shrooms or iNaturalist
     */
    async function getRandomMushroom() {
        // Randomly choose between Toxic Shrooms and iNaturalist
        const useINaturalist = Math.random() < 0.5; // 50% chance for each
        
        if (useINaturalist && API_SOURCES.inaturalist.enabled) {
            try {
                return await getRandomINaturalistMushroom();
            } catch (error) {
                console.warn('Failed to get iNaturalist mushroom, trying Toxic Shrooms:', error);
                // Fallback to Toxic Shrooms if iNaturalist fails
                if (API_SOURCES.toxicshrooms.enabled) {
                    const toxicShroom = await getRandomToxicShroom();
                    return formatToxicShroomData(toxicShroom);
                }
                throw error;
            }
        } else if (API_SOURCES.toxicshrooms.enabled) {
            try {
                const toxicShroom = await getRandomToxicShroom();
                return formatToxicShroomData(toxicShroom);
            } catch (error) {
                console.warn('Failed to get Toxic Shrooms mushroom, trying iNaturalist:', error);
                // Fallback to iNaturalist if Toxic Shrooms fails
                if (API_SOURCES.inaturalist.enabled) {
                    return await getRandomINaturalistMushroom();
                }
                throw error;
            }
        } else {
            throw new Error('No mushroom APIs enabled');
        }
    }

    function formatToxicShroomData(data) {
        // Handle Wikipedia image URLs properly
        let imageUrl = PLACEHOLDER_IMG;
        if (data.img) {
            // Wikipedia images need special handling
            // Convert commons.wikimedia.org URLs to proper format
            if (data.img.includes('commons.wikimedia.org')) {
                imageUrl = data.img;
            } else if (data.img.startsWith('//')) {
                imageUrl = 'https:' + data.img;
            } else if (data.img.startsWith('http')) {
                imageUrl = data.img;
            }
        }

        // Format distribution - handle arrays and filter empty values
        let distribution = 'Unknown';
        if (Array.isArray(data.distribution)) {
            const filtered = data.distribution.filter(d => d && d.trim());
            distribution = filtered.length > 0 ? filtered.join(', ') : 'Unknown';
        } else if (data.distribution) {
            distribution = data.distribution;
        }

        const commonName = data.commonname || data.name;
        const scientificName = data.name;
        const wikipediaUrl = getWikipediaUrl(commonName) || getWikipediaUrl(scientificName);

        return {
            id: `toxic_${data.name.replace(/\s+/g, '_')}`,
            source: 'toxicshrooms',
            common_name: commonName,
            scientific_name: scientificName,
            description: `Toxic agent: ${data.agent || 'Unknown'}. Distribution: ${distribution}`,
            image_url: imageUrl,
            toxicity_type: data.type, // 'poisonous' or 'deadly'
            toxic_agent: data.agent || 'Unknown toxins',
            distribution: distribution,
            wikipedia_url: wikipediaUrl
        };
    }


    // ==================== MULTI-SOURCE SEARCH ====================

    /**
     * Search across all enabled APIs in parallel
     */
    async function multiSourceSearch(query, options = {}) {
        const {
            includePerenual = true,
            includeINaturalist = true,
            includeFungi = false // Special mode for fungi-only search
        } = options;

        const searchPromises = [];
        const results = {
            perenual: [],
            inaturalist: [],
            toxicshrooms: [],
            total: 0
        };

        try {
            // Search Perenual (existing API)
            if (includePerenual && API_SOURCES.perenual.enabled) {
                searchPromises.push(
                    getPlantList(1, { search: query })
                        .then(data => {
                            results.perenual = data.data || [];
                            results.total += data.total || 0;
                        })
                        .catch(err => console.warn('Perenual search failed:', err))
                );
            }

            // Search iNaturalist
            if (includeINaturalist && API_SOURCES.inaturalist.enabled) {
                const taxonId = includeFungi ? 47170 : null; // 47170 = Fungi kingdom
                searchPromises.push(
                    searchINaturalist(query, 1, taxonId)
                        .then(data => {
                            results.inaturalist = data.results?.map(taxon => formatINaturalistData(taxon)) || [];
                        })
                        .catch(err => console.warn('iNaturalist search failed:', err))
                );
            }

            // Search Toxic Shrooms (when in fungi mode)
            if (includeFungi && API_SOURCES.toxicshrooms.enabled) {
                searchPromises.push(
                    getToxicShrooms()
                        .then(data => {
                            // Filter mushrooms by query if provided
                            const filtered = query ? 
                                data.filter(shroom => 
                                    (shroom.name && shroom.name.toLowerCase().includes(query.toLowerCase())) ||
                                    (shroom.commonname && shroom.commonname.toLowerCase().includes(query.toLowerCase()))
                                ) : data;
                            results.toxicshrooms = filtered.map(shroom => formatToxicShroomData(shroom));
                        })
                        .catch(err => console.warn('Toxic Shrooms search failed:', err))
                );
            }

            // Wait for all searches to complete
            await Promise.all(searchPromises);

            return results;
        } catch (error) {
            console.error('Multi-source search error:', error);
            return results;
        }
    }

    /**
     * Combine and deduplicate results from multiple sources
     */
    function combineSearchResults(multiSourceResults) {
        const combined = [];
        const seen = new Set();

        // Helper to add unique results
        const addResults = (results, source) => {
            results.forEach(item => {
                // Create a key based on scientific name
                const key = (item.scientific_name || item.common_name || '').toLowerCase().trim();
                if (key && !seen.has(key)) {
                    seen.add(key);
                    combined.push({ ...item, source });
                } else if (!key) {
                    // Add items without names (shouldn't happen but safety first)
                    combined.push({ ...item, source });
                }
            });
        };

        // Add results from each source
        addResults(multiSourceResults.perenual, 'perenual');
        addResults(multiSourceResults.inaturalist, 'inaturalist');
        addResults(multiSourceResults.toxicshrooms, 'toxicshrooms');

        return combined;
    }


    // --- STATE MANAGEMENT ---

    let currentPage = 1;
    let currentFilters = {};
    let currentSearch = '';
    let lastPageData = null;
    let selectedPlant = null;
    let currentHomePlant = null;
    let homeRequestInProgress = false;
    let browseSearchMode = 'plants'; // 'plants' or 'fungi'
    let lastApiCallTime = 0;
    const API_COOLDOWN_MS = 2000; // 2 seconds between API calls to avoid rate limits
    
    // Cache for storing displayed plants/fungi for detail view
    const plantCache = new Map();

    // --- UI RENDERING FUNCTIONS ---

    /**
     * Creates a plant card element
     */
    function createPlantCard(plant) {
        const card = document.createElement('div');
        card.className = 'plant-card bg-white rounded-lg shadow-md overflow-hidden';
        card.dataset.plantId = plant.id;

        const badges = [];

        // Source badge (for multi-source results)
        const sourceBadges = {
            'perenual': '<span class="badge bg-green-100 text-green-800">🌿 Perenual</span>',
            'inaturalist': '<span class="badge bg-purple-100 text-purple-800">🔬 iNat</span>',
            'toxicshrooms': '<span class="badge bg-red-100 text-red-800">☠️ Toxic Shrooms</span>'
        };
        if (plant.source && sourceBadges[plant.source]) {
            badges.push(sourceBadges[plant.source]);
        }

        // Attribute badges
        if (plant.edible_fruit || plant.edible_leaf || plant.edible) badges.push('<span class="badge badge-green">Edible</span>');
        if (plant.poisonous_to_humans || plant.poisonous_to_pets) badges.push('<span class="badge badge-red">Poisonous</span>');
        if (plant.indoor) badges.push('<span class="badge badge-blue">Indoor</span>');
        if (plant.medicinal) badges.push('<span class="badge badge-purple">Medicinal</span>');
        if (plant.threatened) badges.push('<span class="badge badge-red">Threatened</span>');
        if (plant.endemic) badges.push('<span class="badge badge-yellow">Endemic</span>');

        // Handle sunlight data (can be array, string, or null from list API)
        let sunlightDisplay = '';
        if (plant.sunlight) {
            let sunlightText = '';
            if (Array.isArray(plant.sunlight) && plant.sunlight.length > 0) {
                sunlightText = plant.sunlight[0].replace(/_/g, ' ');
            } else if (typeof plant.sunlight === 'string') {
                sunlightText = plant.sunlight.replace(/_/g, ' ');
            }
            if (sunlightText) {
                sunlightDisplay = `<p>☀️ ${sunlightText}</p>`;
            }
        }

        // Handle watering data (can be string or null from list API)
        let wateringDisplay = '';
        if (plant.watering) {
            const wateringText = plant.watering.charAt(0).toUpperCase() + plant.watering.slice(1);
            wateringDisplay = `<p>💧 ${wateringText}</p>`;
        }

        // If no care data available, show hint (only for plants, not fungi)
        let careInfo = '';
        const isFungi = plant.source === 'toxicshrooms' || (plant.source === 'inaturalist' && (plant.iconic_taxon_name === 'Fungi' || plant.kingdom === 'Fungi'));
        if (isFungi) {
            // For fungi, show toxicity info if available
            if (plant.toxicity_type) {
                careInfo = `<div class="text-xs text-red-600 font-semibold">⚠️ ${plant.toxicity_type.toUpperCase()}</div>`;
            } else {
                careInfo = `<div class="text-xs text-gray-500 italic">Click for details</div>`;
            }
        } else if (sunlightDisplay || wateringDisplay) {
            careInfo = `<div class="text-xs text-gray-600">${sunlightDisplay}${wateringDisplay}</div>`;
        } else {
            careInfo = `<div class="text-xs text-gray-500 italic">Click for care details</div>`;
        }

        const imgSrc = plant.image_url || plant.default_image?.small_url || plant.default_image?.thumbnail || PLACEHOLDER_IMG;
        const wikiUrl = plant.wikipedia_url || getWikipediaUrl(plant.common_name) || getWikipediaUrl(plant.scientific_name);
        const wikiLink = wikiUrl ? `<a href="${wikiUrl}" target="_blank" class="text-blue-600 hover:underline text-xs mt-2 inline-block">📖 Wikipedia Article</a>` : '';
        
        card.innerHTML = `
            <img src="${imgSrc}"
                 alt="${plant.common_name}"
                 loading="lazy"
                 onerror="handleImageError(this)"
                 class="w-full h-48 object-cover">
            <div class="p-4">
                <h3 class="font-bold text-lg text-green-800 mb-1">${plant.common_name || 'Unknown Plant'}</h3>
                <p class="text-sm italic text-gray-500 mb-2">${Array.isArray(plant.scientific_name) ? plant.scientific_name[0] : plant.scientific_name || 'N/A'}</p>
                <div class="mb-2">${badges.join('')}</div>
                ${careInfo}
                ${wikiLink}
            </div>
        `;

        // Store plant in cache for detail view
        plantCache.set(plant.id, plant);
        
        card.addEventListener('click', () => loadPlantDetails(plant.id, plant.source));
        return card;
    }

    /**
     * Renders the plants grid
     */
    function renderPlantsGrid(plants) {
        const grid = document.getElementById('plants-grid');
        grid.innerHTML = '';

        if (!plants || plants.length === 0) {
            grid.innerHTML = '<div class="col-span-2 text-center text-gray-500 py-10">No plants found. Try adjusting your filters.</div>';
            return;
        }

        plants.forEach(plant => {
            grid.appendChild(createPlantCard(plant));
        });
    }

    /**
     * Updates pagination controls with page number selector
     */
    function updatePagination(currentPageNum, lastPage, total) {
        const pagination = document.getElementById('pagination');
        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');
        const pageInput = document.getElementById('page-input');
        const totalPagesSpan = document.getElementById('total-pages');
        const pageNumbersDiv = document.getElementById('page-numbers');

        if (lastPage > 1) {
            pagination.classList.remove('hidden');
            prevBtn.disabled = currentPageNum === 1;
            nextBtn.disabled = currentPageNum === lastPage;
            
            // Update page input
            pageInput.value = currentPageNum;
            pageInput.max = lastPage;
            totalPagesSpan.textContent = lastPage;
            
            // Generate page number buttons (show max 7 pages with ellipsis)
            let pageButtons = '';
            const maxButtons = 7;
            
            if (lastPage <= maxButtons) {
                // Show all pages
                for (let i = 1; i <= lastPage; i++) {
                    pageButtons += createPageButton(i, currentPageNum);
                }
            } else {
                // Show with ellipsis
                if (currentPageNum <= 4) {
                    for (let i = 1; i <= 5; i++) {
                        pageButtons += createPageButton(i, currentPageNum);
                    }
                    pageButtons += '<span class="px-2 py-1 text-gray-500">...</span>';
                    pageButtons += createPageButton(lastPage, currentPageNum);
                } else if (currentPageNum >= lastPage - 3) {
                    pageButtons += createPageButton(1, currentPageNum);
                    pageButtons += '<span class="px-2 py-1 text-gray-500">...</span>';
                    for (let i = lastPage - 4; i <= lastPage; i++) {
                        pageButtons += createPageButton(i, currentPageNum);
                    }
                } else {
                    pageButtons += createPageButton(1, currentPageNum);
                    pageButtons += '<span class="px-2 py-1 text-gray-500">...</span>';
                    for (let i = currentPageNum - 1; i <= currentPageNum + 1; i++) {
                        pageButtons += createPageButton(i, currentPageNum);
                    }
                    pageButtons += '<span class="px-2 py-1 text-gray-500">...</span>';
                    pageButtons += createPageButton(lastPage, currentPageNum);
                }
            }
            
            pageNumbersDiv.innerHTML = pageButtons;
            
            // Add click handlers to page buttons
            pageNumbersDiv.querySelectorAll('.page-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const page = parseInt(btn.dataset.page);
                    if (page !== currentPageNum) {
                        performSearch(page);
                    }
                });
            });
        } else {
            pagination.classList.add('hidden');
        }
    }
    
    /**
     * Creates a page button HTML string
     */
    function createPageButton(pageNum, currentPageNum) {
        const isActive = pageNum === currentPageNum;
        return `<button class="page-btn px-3 py-1 rounded text-sm ${isActive ? 'bg-green-600 text-white' : 'bg-white border border-gray-300 hover:bg-gray-100'}" data-page="${pageNum}">${pageNum}</button>`;
    }

    /**
     * Loads and displays plant details in the detail panel
     * Handles different data sources appropriately
     */
    async function loadPlantDetails(plantId, source = null) {
        const detailPanel = document.getElementById('detail-panel');
        const overlay = document.getElementById('detail-modal-overlay');

        try {
            // Show loading state - open modal
            if (overlay) {
                overlay.classList.remove('hidden');
                // Prevent background scrolling when modal is open
                document.body.style.overflow = 'hidden';
            }
            if (detailPanel) {
                detailPanel.classList.remove('hidden');
                const tabContent = document.getElementById('tab-content');
                if (tabContent) tabContent.innerHTML = '<div class="text-center py-4"><div class="spinner mx-auto"></div></div>';
            }

            let plant;
            
            // Check if we have cached data from a non-Perenual source
            const cachedPlant = plantCache.get(plantId);
            const plantSource = source || cachedPlant?.source || 'perenual';
            
            if (plantSource === 'perenual' && typeof plantId === 'number') {
                // Fetch full details from Perenual API
                plant = await getPlantDetails(plantId);
            } else {
                // Use cached data for other sources
                // Also check favorites in case it's not in cache
                if (!cachedPlant) {
                    const favorite = favorites.find(f => f.id === plantId);
                    if (favorite) {
                        plant = favorite;
                        // Store in cache for future use
                        plantCache.set(plantId, favorite);
                    } else {
                        plant = { id: plantId, common_name: 'Unknown', scientific_name: 'N/A', source: plantSource };
                    }
                } else {
                    plant = cachedPlant;
                }
            }
            
            selectedPlant = plant;

            // Update header
            const detailImage = document.getElementById('detail-image');
            if (detailImage) {
                detailImage.src = plant.image_url || PLACEHOLDER_IMG;
                detailImage.onerror = function() { handleImageError(this); };
            }
            document.getElementById('detail-name').textContent = plant.common_name || 'Unknown';
            document.getElementById('detail-scientific').textContent = plant.scientific_name || 'N/A';

            // Update badges based on source
            const badgesDiv = document.getElementById('detail-badges');
            const badges = [];
            
            // Source badge
            const sourceBadgeMap = {
                'perenual': '<span class="badge bg-green-100 text-green-800">🌿 Perenual</span>',
                'trefle': '<span class="badge bg-blue-100 text-blue-800">🍀 Trefle</span>',
                'inaturalist': '<span class="badge bg-purple-100 text-purple-800">🔬 iNaturalist</span>',
                'gbif': '<span class="badge bg-gray-100 text-gray-800">🌍 GBIF</span>',
                'toxicshrooms': '<span class="badge bg-red-100 text-red-800">☠️ Toxic Shrooms</span>',
                'mushroomobserver': '<span class="badge bg-orange-100 text-orange-800">🍄 Mushroom Observer</span>'
            };
            if (sourceBadgeMap[plantSource]) badges.push(sourceBadgeMap[plantSource]);
            
            // Attribute badges based on available data
            if (plant.edible_fruit || plant.edible_leaf || plant.edible) badges.push('<span class="badge badge-green">🍃 Edible</span>');
            if (plant.poisonous_to_humans > 0 || plant.toxicity_type) badges.push('<span class="badge badge-red">☠️ Toxic</span>');
            if (plant.poisonous_to_pets > 0) badges.push('<span class="badge badge-red">⚠️ Toxic to Pets</span>');
            if (plant.indoor) badges.push('<span class="badge badge-blue">🏠 Indoor</span>');
            if (plant.medicinal) badges.push('<span class="badge badge-purple">💊 Medicinal</span>');
            if (plant.invasive) badges.push('<span class="badge badge-yellow">⚡ Invasive</span>');
            if (plant.threatened) badges.push('<span class="badge badge-red">🔴 Threatened</span>');
            if (plant.endemic) badges.push('<span class="badge badge-yellow">📍 Endemic</span>');
            badgesDiv.innerHTML = badges.join('');

            // Update tabs based on source
            updateDetailTabs(plantSource);

            // Update favorite button state
            updateFavoriteButton();

            // Load default tab (Info)
            loadTab('info');
        } catch (error) {
            console.error('Error loading plant details:', error);
            document.getElementById('tab-content').innerHTML = '<div class="text-red-500 text-center py-4">Error loading details</div>';
        }
    }
    
    /**
     * Get taxon ID for a category name (searches iNaturalist if not in known list)
     */
    async function getTaxonIdForCategory(categoryName) {
        // Known iNaturalist taxon IDs for common plant categories
        const categoryTaxonIds = {
            'Plantae': 47126,      // Kingdom: Plants
            'Tracheophyta': 211194, // Phylum: Vascular Plants
            'Angiospermae': 47125,   // Class: Flowering Plants
            'Magnoliopsida': 47124,  // Class: Dicots
            'Liliopsida': 47219,     // Class: Monocots
            'Pinophyta': 58023,      // Phylum: Conifers
            'Pteridophyta': 121323   // Phylum: Ferns
        };

        // Check if we have a known ID
        if (categoryTaxonIds[categoryName]) {
            return categoryTaxonIds[categoryName];
        }

        // Otherwise, search for the taxon by name
        try {
            const results = await searchINaturalist(categoryName, 1);
            if (results.results && results.results.length > 0) {
                // Find exact match by name
                const exactMatch = results.results.find(t => 
                    t.name === categoryName || 
                    t.preferred_common_name === categoryName
                );
                if (exactMatch) {
                    return exactMatch.id;
                }
                // Return first result if no exact match
                return results.results[0].id;
            }
        } catch (error) {
            console.error('Error fetching taxon ID for category:', error);
        }
        return null;
    }

    /**
     * Search by iNaturalist category (taxon)
     */
    async function searchByINaturalistCategory(category, taxonId) {
        try {
            // Switch to browse tab
            switchTab('browse');

            // Set the search input to indicate category search
            document.getElementById('search-input').value = `Category: ${category}`;

            // Switch to fungi mode for iNaturalist search
            browseSearchMode = 'fungi';

            // Perform search with the taxon ID
            const loadingDiv = document.getElementById('loading');
            const loadingText = document.getElementById('loading-text');
            loadingDiv.classList.remove('hidden');
            loadingText.textContent = `Searching ${category} in iNaturalist...`;

            const results = await searchINaturalist('', 1, taxonId);

            const formattedResults = results.results?.map(taxon => formatINaturalistData(taxon)) || [];

            renderPlantsGrid(formattedResults);
            document.getElementById('results-count').textContent = `Found ${results.total_results || 0} results in ${category}`;
            document.getElementById('pagination').classList.add('hidden');

            loadingDiv.classList.add('hidden');
        } catch (error) {
            console.error('Error searching by category:', error);
            document.getElementById('plants-grid').innerHTML = '<div class="col-span-2 text-center text-red-500 py-10">Error loading category results.</div>';
            document.getElementById('loading').classList.add('hidden');
        }
    }


    /**
     * Updates the detail panel tabs based on the data source
     */
    function updateDetailTabs(source) {
        const tabNav = document.querySelector('#detail-panel nav');
        
        // Define tabs for each source
        const tabConfigs = {
            'perenual': [
                { id: 'info', label: 'Info' },
                { id: 'care', label: 'Care' },
                { id: 'pests', label: 'Pests' }
            ],
            'inaturalist': [
                { id: 'info', label: 'Info' },
                { id: 'taxonomy', label: 'Taxonomy' },
                { id: 'observations', label: 'Observations' }
            ],
            'gbif': [
                { id: 'info', label: 'Info' },
                { id: 'taxonomy', label: 'Taxonomy' },
                { id: 'distribution', label: 'Distribution' }
            ],
            'toxicshrooms': [
                { id: 'info', label: 'Info' },
                { id: 'toxicity', label: 'Toxicity' },
                { id: 'safety', label: 'Safety' }
            ],
            'mushroomobserver': [
                { id: 'info', label: 'Info' },
                { id: 'observation', label: 'Observation' },
                { id: 'location', label: 'Location' }
            ],
            'trefle': [
                { id: 'info', label: 'Info' },
                { id: 'taxonomy', label: 'Taxonomy' },
                { id: 'characteristics', label: 'Characteristics' }
            ]
        };
        
        const tabs = tabConfigs[source] || tabConfigs['perenual'];
        
        tabNav.innerHTML = tabs.map((tab, index) => `
            <button class="detail-tab ${index === 0 ? 'active border-b-2 border-green-600 text-green-700' : 'text-gray-600 hover:text-green-700'} px-2 py-2 font-semibold" data-tab="${tab.id}">
                ${tab.label}
            </button>
        `).join('');
        
        // Re-attach event listeners
        document.querySelectorAll('#detail-panel .detail-tab').forEach(tab => {
            tab.addEventListener('click', () => loadTab(tab.dataset.tab));
        });
    }

    /**
     * Loads content for a specific tab
     */
    async function loadTab(tabName) {
        const tabContent = document.getElementById('tab-content');
        const plant = selectedPlant;

        if (!plant) return;

        // Update active tab styling
        document.querySelectorAll('.detail-tab').forEach(tab => {
            tab.classList.remove('active', 'border-b-2', 'border-green-600', 'text-green-700');
            tab.classList.add('text-gray-600');
        });
        const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
        activeTab.classList.add('active', 'border-b-2', 'border-green-600', 'text-green-700');
        activeTab.classList.remove('text-gray-600');

        switch(tabName) {
            case 'info':
                // Build info tab content based on data source
                let infoContent = `<div class="space-y-3">`;
                
                // Description with Wikipedia link
                const description = plant.description;
                const wikiUrl = plant.wikipedia_url || getWikipediaUrl(plant.common_name) || getWikipediaUrl(plant.scientific_name);
                
                if (description) {
                    infoContent += `<p class="text-gray-700">${description}</p>`;
                } else if (plant.source === 'inaturalist') {
                    // For iNaturalist, if no description, just show Wikipedia link
                    infoContent += `<p class="text-gray-500 italic">No description available.</p>`;
                }
                
                // Add Wikipedia link for all plants/mushrooms
                if (wikiUrl) {
                    infoContent += `<p class="mt-3"><a href="${wikiUrl}" target="_blank" class="text-blue-600 hover:underline font-semibold">📖 Wikipedia Article</a></p>`;
                }
                
                infoContent += `<div class="border-t pt-3">
                        <h4 class="font-semibold text-gray-800 mb-2">Basic Information</h4>`;

                // Perenual-specific fields
                if (plant.type && plant.type !== 'N/A') infoContent += `<p><strong>Type:</strong> ${plant.type}</p>`;
                if (plant.cycle && plant.cycle !== 'N/A') infoContent += `<p><strong>Cycle:</strong> ${plant.cycle}</p>`;
                if (plant.growth_rate && plant.growth_rate !== 'N/A') infoContent += `<p><strong>Growth Rate:</strong> ${plant.growth_rate}</p>`;
                if (plant.dimension && plant.dimension !== 'N/A') infoContent += `<p><strong>Dimension:</strong> ${plant.dimension}</p>`;
                if (plant.flowers) infoContent += `<p><strong>Flowering Season:</strong> ${plant.flowering_season}</p>`;
                if (plant.flower_color && plant.flower_color !== 'N/A') infoContent += `<p><strong>Flower Color:</strong> ${plant.flower_color}</p>`;
                if (plant.attracts && plant.attracts !== 'N/A') infoContent += `<p><strong>Attracts:</strong> ${plant.attracts}</p>`;
                if (plant.origin && plant.origin !== 'N/A') infoContent += `<p><strong>Origin:</strong> ${plant.origin}</p>`;

                // iNaturalist-specific fields
                if (plant.rank && plant.rank !== 'N/A') infoContent += `<p><strong>Rank:</strong> ${plant.rank}</p>`;
                if (plant.iconic_taxon_name && plant.iconic_taxon_name !== 'N/A') infoContent += `<p><strong>Iconic Taxon:</strong> ${plant.iconic_taxon_name}</p>`;
                if (plant.observations_count) infoContent += `<p><strong>Observations:</strong> ${plant.observations_count.toLocaleString()}</p>`;
                if (plant.native) infoContent += `<p><strong>Native:</strong> Yes</p>`;
                if (plant.endemic) infoContent += `<p><strong>Endemic:</strong> Yes</p>`;
                if (plant.threatened) infoContent += `<p><strong>Threatened:</strong> Yes</p>`;
                if (plant.introduced) infoContent += `<p><strong>Introduced:</strong> Yes</p>`;

                // GBIF-specific fields
                if (plant.num_occurrences) infoContent += `<p><strong>Occurrences:</strong> ${plant.num_occurrences.toLocaleString()}</p>`;
                if (plant.taxonomic_status && plant.taxonomic_status !== 'N/A') infoContent += `<p><strong>Taxonomic Status:</strong> ${plant.taxonomic_status}</p>`;

                // Trefle-specific fields
                if (plant.family && plant.family !== 'N/A') infoContent += `<p><strong>Family:</strong> ${plant.family}</p>`;
                if (plant.genus && plant.genus !== 'N/A') infoContent += `<p><strong>Genus:</strong> ${plant.genus}</p>`;
                if (plant.year && plant.year !== 'N/A') infoContent += `<p><strong>Year:</strong> ${plant.year}</p>`;
                if (plant.author && plant.author !== 'N/A') infoContent += `<p><strong>Author:</strong> ${plant.author}</p>`;
                if (plant.vegetable) infoContent += `<p><strong>Vegetable:</strong> Yes</p>`;

                // Toxic Shrooms-specific fields
                if (plant.toxicity_type) infoContent += `<p><strong>Toxicity Type:</strong> <span class="text-red-600 font-semibold">${plant.toxicity_type.toUpperCase()}</span></p>`;
                if (plant.toxic_agent) infoContent += `<p><strong>Toxic Agent:</strong> ${plant.toxic_agent}</p>`;
                if (plant.distribution) infoContent += `<p><strong>Distribution:</strong> ${plant.distribution}</p>`;

                // Mushroom Observer-specific fields
                if (plant.location_name) infoContent += `<p><strong>Location:</strong> ${plant.location_name}</p>`;
                if (plant.observer_name) infoContent += `<p><strong>Observer:</strong> ${plant.observer_name}</p>`;
                if (plant.observed_date) infoContent += `<p><strong>Observed:</strong> ${plant.observed_date}</p>`;

                infoContent += `</div></div>`;
                tabContent.innerHTML = infoContent;
                break;

            case 'care':
                tabContent.innerHTML = `
                    <div class="space-y-3">
                        <div>
                            <h4 class="font-semibold text-gray-800 mb-2">💧 Watering</h4>
                            <p><strong>Frequency:</strong> ${plant.watering}</p>
                            <p><strong>Period:</strong> ${plant.watering_period}</p>
                            ${plant.watering_general_benchmark.value !== 'N/A' ? `<p><strong>Benchmark:</strong> ${plant.watering_general_benchmark.value} ${plant.watering_general_benchmark.unit}</p>` : ''}
                            ${plant.depth_water_requirement.value !== 'N/A' ? `<p><strong>Depth:</strong> ${plant.depth_water_requirement.value} ${plant.depth_water_requirement.unit}</p>` : ''}
                        </div>
                        <div class="border-t pt-3">
                            <h4 class="font-semibold text-gray-800 mb-2">☀️ Sunlight</h4>
                            <p>${plant.sunlight}</p>
                        </div>
                        <div class="border-t pt-3">
                            <h4 class="font-semibold text-gray-800 mb-2">🌱 Soil & Growing</h4>
                            <p><strong>Soil:</strong> ${plant.soil}</p>
                            <p><strong>Propagation:</strong> ${plant.propagation}</p>
                            <p><strong>Maintenance:</strong> ${plant.maintenance}</p>
                            <p><strong>Care Level:</strong> ${plant.care_level}</p>
                        </div>
                        <div class="border-t pt-3">
                            <h4 class="font-semibold text-gray-800 mb-2">🌍 Hardiness Zones</h4>
                            <p><strong>Range:</strong> ${plant.hardiness.min} - ${plant.hardiness.max}</p>
                        </div>
                    </div>
                `;
                break;

            case 'pests':
                tabContent.innerHTML = '<div class="text-center py-4"><div class="spinner mx-auto"></div><p class="mt-2">Loading disease & pest information...</p></div>';
                try {
                    const diseasePestData = await getDiseasePestInfo(plant.common_name, 1);
                    if (diseasePestData.data && diseasePestData.data.length > 0) {
                        const items = diseasePestData.data.slice(0, 5).map(item => `
                            <div class="border-b pb-3 mb-3">
                                <h5 class="font-semibold text-gray-800">${item.common_name || 'Unknown'}</h5>
                                <p class="text-sm text-gray-600 italic">${item.scientific_name || ''}</p>
                                ${item.description ? `<p class="text-sm mt-1">${item.description.substring(0, 200)}...</p>` : ''}
                            </div>
                        `).join('');
                        tabContent.innerHTML = `<div class="space-y-3">${items}</div>`;
                    } else {
                        tabContent.innerHTML = '<div class="text-center py-4 text-gray-500">No specific disease/pest information found for this plant.</div>';
                    }
                } catch (error) {
                    tabContent.innerHTML = '<div class="text-red-500 text-center py-4">Error loading pest information</div>';
                }
                break;

            case 'taxonomy':
                // Taxonomy tab for iNaturalist, GBIF, and Trefle
                let taxonomyContent = '<div class="space-y-3">';

                if (plant.source === 'inaturalist' || plant.source === 'gbif' || plant.source === 'trefle') {
                    taxonomyContent += '<h4 class="font-semibold text-gray-800 mb-2">Taxonomic Classification</h4>';

                    // For iNaturalist, make category names clickable to search within that category
                    if (plant.source === 'inaturalist') {
                        // Known iNaturalist taxon IDs for common plant categories
                        const categoryTaxonIds = {
                            'Plantae': 47126,      // Kingdom: Plants
                            'Tracheophyta': 211194, // Phylum: Vascular Plants
                            'Angiospermae': 47125,   // Class: Flowering Plants
                            'Magnoliopsida': 47124,  // Class: Dicots
                            'Liliopsida': 47219,     // Class: Monocots
                            'Pinophyta': 58023,      // Phylum: Conifers
                            'Pteridophyta': 121323   // Phylum: Ferns
                        };

                        if (plant.kingdom && plant.kingdom !== 'N/A') {
                            const taxonId = categoryTaxonIds[plant.kingdom] || null;
                            if (taxonId) {
                                taxonomyContent += `<p><strong>Kingdom:</strong> <button class="text-purple-600 hover:text-purple-800 underline category-search-btn" data-taxon-id="${taxonId}" data-category-name="${plant.kingdom}">${plant.kingdom}</button> <span class="text-purple-500">🔬 iNat</span></p>`;
                            } else {
                                taxonomyContent += `<p><strong>Kingdom:</strong> ${plant.kingdom}</p>`;
                            }
                        }
                        if (plant.phylum && plant.phylum !== 'N/A') {
                            const taxonId = categoryTaxonIds[plant.phylum] || null;
                            if (taxonId) {
                                taxonomyContent += `<p><strong>Phylum:</strong> <button class="text-purple-600 hover:text-purple-800 underline category-search-btn" data-taxon-id="${taxonId}" data-category-name="${plant.phylum}">${plant.phylum}</button> <span class="text-purple-500">🔬 iNat</span></p>`;
                            } else {
                                taxonomyContent += `<p><strong>Phylum:</strong> ${plant.phylum}</p>`;
                            }
                        }
                        if (plant.class && plant.class !== 'N/A') {
                            const taxonId = categoryTaxonIds[plant.class] || null;
                            if (taxonId) {
                                taxonomyContent += `<p><strong>Class:</strong> <button class="text-purple-600 hover:text-purple-800 underline category-search-btn" data-taxon-id="${taxonId}" data-category-name="${plant.class}">${plant.class}</button> <span class="text-purple-500">🔬 iNat</span></p>`;
                            } else {
                                taxonomyContent += `<p><strong>Class:</strong> ${plant.class}</p>`;
                            }
                        }
                        if (plant.order && plant.order !== 'N/A') taxonomyContent += `<p><strong>Order:</strong> ${plant.order}</p>`;
                        if (plant.family && plant.family !== 'N/A') taxonomyContent += `<p><strong>Family:</strong> ${plant.family}</p>`;
                        if (plant.genus && plant.genus !== 'N/A') taxonomyContent += `<p><strong>Genus:</strong> ${plant.genus}</p>`;
                        if (plant.rank && plant.rank !== 'N/A') taxonomyContent += `<p><strong>Rank:</strong> ${plant.rank}</p>`;
                    } else {
                        // For other sources, show as regular text
                        if (plant.kingdom && plant.kingdom !== 'N/A') taxonomyContent += `<p><strong>Kingdom:</strong> ${plant.kingdom}</p>`;
                        if (plant.phylum && plant.phylum !== 'N/A') taxonomyContent += `<p><strong>Phylum:</strong> ${plant.phylum}</p>`;
                        if (plant.class && plant.class !== 'N/A') taxonomyContent += `<p><strong>Class:</strong> ${plant.class}</p>`;
                        if (plant.order && plant.order !== 'N/A') taxonomyContent += `<p><strong>Order:</strong> ${plant.order}</p>`;
                        if (plant.family && plant.family !== 'N/A') taxonomyContent += `<p><strong>Family:</strong> ${plant.family}</p>`;
                        if (plant.genus && plant.genus !== 'N/A') taxonomyContent += `<p><strong>Genus:</strong> ${plant.genus}</p>`;
                        if (plant.rank && plant.rank !== 'N/A') taxonomyContent += `<p><strong>Rank:</strong> ${plant.rank}</p>`;
                    }

                    // Add anchor categories for iNaturalist
                    if (plant.source === 'inaturalist' && plant.taxon_id) {
                        taxonomyContent += '<div class="border-t pt-3 mt-3"><h4 class="font-semibold text-gray-800 mb-2">Explore by Category</h4>';
                        taxonomyContent += '<div class="flex flex-wrap gap-2">';
                        if (plant.kingdom) taxonomyContent += `<button class="category-btn px-3 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200 transition" data-category="kingdom" data-taxon-id="${plant.taxon_id}">🌍 Kingdom</button>`;
                        if (plant.phylum) taxonomyContent += `<button class="category-btn px-3 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200 transition" data-category="phylum" data-taxon-id="${plant.taxon_id}">📊 Phylum</button>`;
                        if (plant.class) taxonomyContent += `<button class="category-btn px-3 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200 transition" data-category="class" data-taxon-id="${plant.taxon_id}">📚 Class</button>`;
                        if (plant.order) taxonomyContent += `<button class="category-btn px-3 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200 transition" data-category="order" data-taxon-id="${plant.taxon_id}">📋 Order</button>`;
                        if (plant.family) taxonomyContent += `<button class="category-btn px-3 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200 transition" data-category="family" data-taxon-id="${plant.taxon_id}">🌿 Family</button>`;
                        taxonomyContent += '</div></div>';
                    }

                }

                taxonomyContent += '</div>';
                tabContent.innerHTML = taxonomyContent;

                // Attach event listeners for category search buttons (clickable category names)
                document.querySelectorAll('.category-search-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        let taxonId = btn.dataset.taxonId;
                        const categoryName = btn.dataset.categoryName;
                        
                        // If no taxon ID, try to fetch it
                        if (!taxonId || taxonId === 'null') {
                            taxonId = await getTaxonIdForCategory(categoryName);
                            if (!taxonId) {
                                alert(`Could not find taxon ID for ${categoryName}. Please try searching manually.`);
                                return;
                            }
                        }
                        
                        searchByINaturalistCategory(categoryName, taxonId);
                    });
                });

                // Attach event listeners for category buttons
                document.querySelectorAll('.category-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const category = btn.dataset.category;
                        const taxonId = btn.dataset.taxonId;
                        searchByINaturalistCategory(category, taxonId);
                    });
                });

                break;

            case 'observations':
                // Observations tab for iNaturalist
                tabContent.innerHTML = '<div class="text-center py-4"><div class="spinner mx-auto"></div><p class="mt-2">Loading observations...</p></div>';

                if (plant.source === 'inaturalist' && plant.taxon_id) {
                    try {
                        const observations = await getINaturalistObservations(plant.taxon_id, 1);
                        if (observations.results && observations.results.length > 0) {
                            const obsHtml = observations.results.slice(0, 10).map(obs => {
                                const photoUrl = obs.photos && obs.photos.length > 0 ?
                                    (obs.photos[0].url || PLACEHOLDER_IMG) :
                                    PLACEHOLDER_IMG;
                                const location = obs.place_guess || 'Unknown location';
                                const date = obs.observed_on_string || 'Unknown date';

                                return `<div class="border-b pb-3 mb-3 flex gap-3">
                                    <img src="${photoUrl}" alt="Observation" class="w-20 h-20 object-cover rounded">
                                    <div class="flex-1">
                                        <p class="text-sm font-semibold">${location}</p>
                                        <p class="text-xs text-gray-600">${date}</p>
                                        <p class="text-xs text-gray-500">Observer: ${obs.user?.login || 'Anonymous'}</p>
                                    </div>
                                </div>`;
                            }).join('');

                            tabContent.innerHTML = `<div class="space-y-3">
                                <p class="text-sm text-gray-600">Total observations: ${observations.total_results?.toLocaleString()}</p>
                                ${obsHtml}
                            </div>`;
                        } else {
                            tabContent.innerHTML = '<div class="text-center py-4 text-gray-500">No observations found.</div>';
                        }
                    } catch (error) {
                        tabContent.innerHTML = '<div class="text-red-500 text-center py-4">Error loading observations</div>';
                    }
                }
                break;

            case 'distribution':
                // Distribution tab for GBIF
                let distContent = '<div class="space-y-3">';
                distContent += '<h4 class="font-semibold text-gray-800 mb-2">Distribution Information</h4>';

                if (plant.origin && plant.origin !== 'N/A') distContent += `<p><strong>Origin:</strong> ${plant.origin}</p>`;
                if (plant.num_occurrences) distContent += `<p><strong>Recorded Occurrences:</strong> ${plant.num_occurrences.toLocaleString()}</p>`;
                if (plant.gbif_key) distContent += `<p><strong>GBIF Key:</strong> ${plant.gbif_key}</p>`;
                distContent += `<p class="text-sm text-gray-600 mt-3">For detailed distribution maps and occurrence data, visit <a href="https://www.gbif.org/species/${plant.gbif_key}" target="_blank" class="text-blue-600 hover:underline">GBIF Species Page</a></p>`;

                distContent += '</div>';
                tabContent.innerHTML = distContent;
                break;

            case 'toxicity':
                // Toxicity tab for Toxic Shrooms
                let toxContent = '<div class="space-y-3 bg-red-50 p-4 rounded-lg">';
                toxContent += '<h4 class="text-lg font-semibold text-red-900 mb-2">⚠️ TOXICITY WARNING</h4>';

                if (plant.toxicity_type) toxContent += `<p><strong>Toxicity Level:</strong> <span class="text-red-700 font-bold">${plant.toxicity_type.toUpperCase()}</span></p>`;
                if (plant.toxic_agent) toxContent += `<p><strong>Toxic Agent:</strong> ${plant.toxic_agent}</p>`;
                if (plant.symptoms) toxContent += `<p><strong>Symptoms:</strong> ${plant.symptoms}</p>`;

                toxContent += '<p class="text-sm text-red-800 mt-4 font-semibold">⚠️ Never consume wild mushrooms without expert identification. This mushroom can cause serious harm or death.</p>';
                toxContent += '</div>';
                tabContent.innerHTML = toxContent;
                break;

            case 'safety':
                // Safety tab for Toxic Shrooms
                let safetyContent = '<div class="space-y-3">';
                safetyContent += '<h4 class="font-semibold text-gray-800 mb-2">Safety Information</h4>';
                safetyContent += '<div class="bg-yellow-50 p-4 rounded-lg border-l-4 border-yellow-500">';
                safetyContent += '<p class="font-semibold text-yellow-900 mb-2">⚠️ Important Safety Guidelines</p>';
                safetyContent += '<ul class="list-disc list-inside text-sm text-yellow-800 space-y-1">';
                safetyContent += '<li>Never consume wild mushrooms without expert identification</li>';
                safetyContent += '<li>Many toxic mushrooms closely resemble edible species</li>';
                safetyContent += '<li>Even small amounts can be dangerous or fatal</li>';
                safetyContent += '<li>If ingested, seek immediate medical attention</li>';
                safetyContent += '<li>Contact poison control center immediately</li>';
                safetyContent += '</ul></div>';

                if (plant.distribution) safetyContent += `<p class="mt-3"><strong>Where Found:</strong> ${plant.distribution}</p>`;
                if (plant.similar_species) safetyContent += `<p><strong>Similar Species:</strong> ${plant.similar_species}</p>`;

                safetyContent += '</div>';
                tabContent.innerHTML = safetyContent;
                break;

            case 'observation':
                // Observation tab for Mushroom Observer
                let obsContent = '<div class="space-y-3">';
                obsContent += '<h4 class="font-semibold text-gray-800 mb-2">Observation Details</h4>';

                if (plant.observer_name) obsContent += `<p><strong>Observer:</strong> ${plant.observer_name}</p>`;
                if (plant.observed_date) obsContent += `<p><strong>Date Observed:</strong> ${plant.observed_date}</p>`;
                if (plant.confidence_level) obsContent += `<p><strong>Confidence:</strong> ${plant.confidence_level}</p>`;
                if (plant.notes) obsContent += `<p><strong>Notes:</strong> ${plant.notes}</p>`;

                obsContent += '</div>';
                tabContent.innerHTML = obsContent;
                break;

            case 'location':
                // Location tab for Mushroom Observer
                let locContent = '<div class="space-y-3">';
                locContent += '<h4 class="font-semibold text-gray-800 mb-2">Location Information</h4>';

                if (plant.location_name) locContent += `<p><strong>Location:</strong> ${plant.location_name}</p>`;
                if (plant.latitude && plant.longitude) locContent += `<p><strong>Coordinates:</strong> ${plant.latitude}, ${plant.longitude}</p>`;
                if (plant.altitude) locContent += `<p><strong>Altitude:</strong> ${plant.altitude}</p>`;
                if (plant.habitat) locContent += `<p><strong>Habitat:</strong> ${plant.habitat}</p>`;

                locContent += '</div>';
                tabContent.innerHTML = locContent;
                break;

            case 'characteristics':
                // Characteristics tab for Trefle
                let charContent = '<div class="space-y-3">';
                charContent += '<h4 class="font-semibold text-gray-800 mb-2">Plant Characteristics</h4>';

                if (plant.vegetable) charContent += '<p><strong>Vegetable:</strong> Yes</p>';
                if (plant.edible) charContent += '<p><strong>Edible:</strong> Yes</p>';
                if (plant.status && plant.status !== 'N/A') charContent += `<p><strong>Status:</strong> ${plant.status}</p>`;
                if (plant.bibliography && plant.bibliography !== 'N/A') charContent += `<p><strong>Bibliography:</strong> ${plant.bibliography}</p>`;

                charContent += '</div>';
                tabContent.innerHTML = charContent;
                break;
        }
    }

    // --- FAVORITES LOGIC ---

    function toggleDetailPanelFavorite() {
        if (!selectedPlant) return;

        const isFavorite = favorites.some(fav => fav.id === selectedPlant.id);

        if (isFavorite) {
            if (confirm(`Remove "${selectedPlant.common_name}" from favorites?`)) {
                removeFavorite(selectedPlant.id);
            }
        } else {
            favorites.push(selectedPlant);
            localStorage.setItem('plantFavorites', JSON.stringify(favorites));
            updateFavoritesUI();
        }

        updateFavoriteButton();
    }

    function updateFavoriteButton() {
        const btn = document.getElementById('detail-favorite-btn');
        const isFavorite = selectedPlant && favorites.some(fav => fav.id === selectedPlant.id);

        if (isFavorite) {
            btn.textContent = '🗑️ Remove from Favorites';
            btn.classList.remove('bg-yellow-400', 'hover:bg-yellow-500');
            btn.classList.add('bg-red-500', 'hover:bg-red-600', 'text-white');
        } else {
            btn.textContent = '⭐ Add to Favorites';
            btn.classList.remove('bg-red-500', 'hover:bg-red-600', 'text-white');
            btn.classList.add('bg-yellow-400', 'hover:bg-yellow-500');
        }
    }

    function removeFavorite(plantId) {
        favorites = favorites.filter(fav => fav.id !== plantId);
        localStorage.setItem('plantFavorites', JSON.stringify(favorites));
        updateFavoritesUI();

        // Update button states if plant is currently selected
        if (selectedPlant && selectedPlant.id === plantId) {
            updateFavoriteButton();
            updateModalFavoriteButton();
        }
    }

    function updateFavoritesUI() {
        const favoritesGrid = document.getElementById('favorites-grid');
        const favoritesEmpty = document.getElementById('favorites-empty');

        favoritesGrid.innerHTML = '';
        if (favorites.length > 0) {
            favoritesEmpty.classList.add('hidden');
            favoritesGrid.classList.remove('hidden');
            favorites.forEach(fav => {
                // Use the same createPlantCard function used in browse mode
                const card = createPlantCard(fav);
                
                // Make card container relative for absolute positioning of remove button
                card.classList.add('group', 'relative');
                
                // Clone the card to remove the existing click listener
                const newCard = card.cloneNode(true);
                
                // Add remove button overlay - insert before closing tag
                const removeBtn = document.createElement('button');
                removeBtn.className = 'remove-favorite-btn absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10';
                removeBtn.setAttribute('data-plant-id', fav.id);
                removeBtn.setAttribute('title', 'Remove from favorites');
                removeBtn.innerHTML = `
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                    </svg>
                `;
                newCard.appendChild(removeBtn);

                // Add click handler to switch to browse tab and open detail panel
                newCard.addEventListener('click', (e) => {
                    // Don't open modal if clicking remove button
                    if (!e.target.closest('.remove-favorite-btn')) {
                        // Ensure favorite data is in cache before loading details
                        plantCache.set(fav.id, fav);
                        // Switch to browse tab first
                        switchTab('browse');
                        // Then open the detail panel modal after a brief delay to ensure tab switch completes
                        setTimeout(() => {
                            loadPlantDetails(fav.id, fav.source);
                        }, 100);
                    }
                });

                // Remove button click handler - no confirmation popup
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent card click
                    removeFavorite(fav.id);
                });

                favoritesGrid.appendChild(newCard);
            });
        } else {
            favoritesEmpty.classList.remove('hidden');
            favoritesGrid.classList.add('hidden');
        }
    }

    // --- MODAL FUNCTIONS ---

    async function openPlantModalFromFavorite(favorite) {
        // Use the favorite object directly - it already has all the data
        const modal = document.getElementById('plant-modal');
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        try {
            selectedPlant = favorite;
            
            // Update modal header
            const modalImage = document.getElementById('modal-plant-image');
            if (modalImage) {
                modalImage.src = favorite.image_url || PLACEHOLDER_IMG;
                modalImage.onerror = function() { handleImageError(this); };
            }
            document.getElementById('modal-plant-name').textContent = favorite.common_name || 'Unknown';
            document.getElementById('modal-plant-scientific').textContent = favorite.scientific_name || 'N/A';

            // Update badges based on source
            const badgesDiv = document.getElementById('modal-plant-badges');
            const badges = [];
            
            // Source badge
            if (favorite.source === 'inaturalist') {
                badges.push('<span class="badge bg-purple-100 text-purple-800">🔬 iNaturalist</span>');
            } else if (favorite.source === 'toxicshrooms') {
                badges.push('<span class="badge bg-red-100 text-red-800">☠️ Toxic Shrooms</span>');
                if (favorite.toxicity_type) {
                    badges.push(`<span class="badge badge-red">${favorite.toxicity_type.toUpperCase()}</span>`);
                }
            }
            
            // Other badges
            if (favorite.edible_fruit || favorite.edible_leaf) badges.push('<span class="badge badge-green">🍃 Edible</span>');
            if (favorite.poisonous_to_humans > 0) badges.push('<span class="badge badge-red">☠️ Toxic to Humans</span>');
            if (favorite.poisonous_to_pets > 0) badges.push('<span class="badge badge-red">⚠️ Toxic to Pets</span>');
            if (favorite.indoor) badges.push('<span class="badge badge-blue">🏠 Indoor</span>');
            if (favorite.medicinal) badges.push('<span class="badge badge-purple">💊 Medicinal</span>');
            if (favorite.invasive) badges.push('<span class="badge badge-yellow">⚡ Invasive</span>');
            badgesDiv.innerHTML = badges.join('');

            // Update favorite button
            updateModalFavoriteButton();

            // Load default tab (Info)
            loadModalTab('info');
        } catch (error) {
            console.error('Error loading plant in modal:', error);
            document.getElementById('modal-tab-content').innerHTML = '<div class="text-red-500 text-center py-4">Error loading plant details</div>';
        }
    }

    async function openPlantModal(plantId) {
        const modal = document.getElementById('plant-modal');
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling

        try {
            // Show loading in modal
            document.getElementById('modal-tab-content').innerHTML = '<div class="text-center py-10"><div class="spinner mx-auto"></div></div>';

            // Check if this is a non-Perenual source
            const isNonPerenual = typeof plantId === 'string' && (
                plantId.startsWith('inat_') || 
                plantId.startsWith('toxic_') || 
                plantId.startsWith('gbif_') ||
                plantId.startsWith('trefle_')
            );

            let plant;
            
            if (isNonPerenual) {
                // For non-Perenual sources, check cache first
                const cacheKey = `plant_${plantId}`;
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    plant = JSON.parse(cached);
                } else {
                    // Check in-memory cache
                    const cachedPlant = plantCache.get(plantId);
                    if (cachedPlant) {
                        plant = cachedPlant;
                    } else {
                        // Check if it's in favorites (favorites have full data)
                        const favorite = favorites.find(f => f.id === plantId);
                        if (favorite) {
                            plant = favorite;
                        } else {
                            throw new Error(`Plant data not found for ${plantId}`);
                        }
                    }
                }
            } else {
                // For Perenual, use getPlantDetails
                plant = await getPlantDetails(plantId);
            }
            
            selectedPlant = plant;

            // Update modal header
            const modalImage = document.getElementById('modal-plant-image');
            if (modalImage) {
                modalImage.src = plant.image_url || PLACEHOLDER_IMG;
                modalImage.onerror = function() { handleImageError(this); };
            }
            document.getElementById('modal-plant-name').textContent = plant.common_name;
            document.getElementById('modal-plant-scientific').textContent = plant.scientific_name;

            // Update badges based on source
            const badgesDiv = document.getElementById('modal-plant-badges');
            const badges = [];
            
            // Source badge
            if (plant.source === 'inaturalist') {
                badges.push('<span class="badge bg-purple-100 text-purple-800">🔬 iNaturalist</span>');
            } else if (plant.source === 'toxicshrooms') {
                badges.push('<span class="badge bg-red-100 text-red-800">☠️ Toxic Shrooms</span>');
                if (plant.toxicity_type) {
                    badges.push(`<span class="badge badge-red">${plant.toxicity_type.toUpperCase()}</span>`);
                }
            } else if (plant.source === 'perenual') {
                badges.push('<span class="badge bg-green-100 text-green-800">🌿 Perenual</span>');
            }
            
            // Other badges
            if (plant.edible_fruit || plant.edible_leaf) badges.push('<span class="badge badge-green">🍃 Edible</span>');
            if (plant.poisonous_to_humans > 0) badges.push('<span class="badge badge-red">☠️ Toxic to Humans</span>');
            if (plant.poisonous_to_pets > 0) badges.push('<span class="badge badge-red">⚠️ Toxic to Pets</span>');
            if (plant.indoor) badges.push('<span class="badge badge-blue">🏠 Indoor</span>');
            if (plant.medicinal) badges.push('<span class="badge badge-purple">💊 Medicinal</span>');
            if (plant.invasive) badges.push('<span class="badge badge-yellow">⚡ Invasive</span>');
            badgesDiv.innerHTML = badges.join('');

            // Update favorite button
            updateModalFavoriteButton();

            // Load default tab (Info)
            loadModalTab('info');
        } catch (error) {
            console.error('Error loading plant in modal:', error);
            document.getElementById('modal-tab-content').innerHTML = '<div class="text-red-500 text-center py-4">Error loading plant details</div>';
        }
    }

    function closeModal() {
        const modal = document.getElementById('plant-modal');
        modal.classList.add('hidden');
        document.body.style.overflow = ''; // Restore scrolling
    }

    async function loadModalTab(tabName) {
        const tabContent = document.getElementById('modal-tab-content');
        const plant = selectedPlant;

        if (!plant) return;

        // Update active tab styling
        document.querySelectorAll('.modal-tab').forEach(tab => {
            tab.classList.remove('active', 'border-b-2', 'border-green-600', 'text-green-700');
            tab.classList.add('text-gray-600');
        });
        const activeTab = document.querySelector(`.modal-tab[data-tab="${tabName}"]`);
        activeTab.classList.add('active', 'border-b-2', 'border-green-600', 'text-green-700');
        activeTab.classList.remove('text-gray-600');

        // Load content based on source (similar to detail panel)
        switch(tabName) {
            case 'info':
                // Build info tab content based on data source
                let infoContent = `<div class="space-y-3">`;
                
                // Description with Wikipedia link
                const description = plant.description;
                const wikiUrl = plant.wikipedia_url || getWikipediaUrl(plant.common_name) || getWikipediaUrl(plant.scientific_name);
                
                if (description) {
                    infoContent += `<p class="text-gray-700">${description}</p>`;
                } else if (plant.source === 'inaturalist') {
                    // For iNaturalist, if no description, just show Wikipedia link
                    infoContent += `<p class="text-gray-500 italic">No description available.</p>`;
                }
                
                // Add Wikipedia link for all plants/mushrooms
                if (wikiUrl) {
                    infoContent += `<p class="mt-3"><a href="${wikiUrl}" target="_blank" class="text-blue-600 hover:underline font-semibold">📖 Wikipedia Article</a></p>`;
                }
                
                infoContent += `<div class="border-t pt-3">
                        <h4 class="font-semibold text-gray-800 mb-2">Basic Information</h4>`;

                // Perenual-specific fields
                if (plant.type && plant.type !== 'N/A') infoContent += `<p><strong>Type:</strong> ${plant.type}</p>`;
                if (plant.cycle && plant.cycle !== 'N/A') infoContent += `<p><strong>Cycle:</strong> ${plant.cycle}</p>`;
                if (plant.growth_rate && plant.growth_rate !== 'N/A') infoContent += `<p><strong>Growth Rate:</strong> ${plant.growth_rate}</p>`;
                if (plant.dimension && plant.dimension !== 'N/A') infoContent += `<p><strong>Dimension:</strong> ${plant.dimension}</p>`;
                if (plant.flowers) infoContent += `<p><strong>Flowering Season:</strong> ${plant.flowering_season}</p>`;
                if (plant.flower_color && plant.flower_color !== 'N/A') infoContent += `<p><strong>Flower Color:</strong> ${plant.flower_color}</p>`;
                if (plant.attracts && plant.attracts !== 'N/A') infoContent += `<p><strong>Attracts:</strong> ${plant.attracts}</p>`;
                if (plant.origin && plant.origin !== 'N/A') infoContent += `<p><strong>Origin:</strong> ${plant.origin}</p>`;

                // iNaturalist-specific fields
                if (plant.rank && plant.rank !== 'N/A') infoContent += `<p><strong>Rank:</strong> ${plant.rank}</p>`;
                if (plant.iconic_taxon_name && plant.iconic_taxon_name !== 'N/A') infoContent += `<p><strong>Iconic Taxon:</strong> ${plant.iconic_taxon_name}</p>`;
                if (plant.observations_count) infoContent += `<p><strong>Observations:</strong> ${plant.observations_count.toLocaleString()}</p>`;
                if (plant.native) infoContent += `<p><strong>Native:</strong> Yes</p>`;
                if (plant.endemic) infoContent += `<p><strong>Endemic:</strong> Yes</p>`;
                if (plant.threatened) infoContent += `<p><strong>Threatened:</strong> Yes</p>`;
                if (plant.introduced) infoContent += `<p><strong>Introduced:</strong> Yes</p>`;

                // Toxic Shrooms-specific fields
                if (plant.toxicity_type) infoContent += `<p><strong>Toxicity Type:</strong> <span class="text-red-600 font-semibold">${plant.toxicity_type.toUpperCase()}</span></p>`;
                if (plant.toxic_agent) infoContent += `<p><strong>Toxic Agent:</strong> ${plant.toxic_agent}</p>`;
                if (plant.distribution) infoContent += `<p><strong>Distribution:</strong> ${plant.distribution}</p>`;

                infoContent += `</div></div>`;
                tabContent.innerHTML = infoContent;
                break;

            case 'care':
                tabContent.innerHTML = `
                    <div class="space-y-3">
                        <div>
                            <h4 class="font-semibold text-gray-800 mb-2">💧 Watering</h4>
                            <p><strong>Frequency:</strong> ${plant.watering}</p>
                            <p><strong>Period:</strong> ${plant.watering_period}</p>
                            ${plant.watering_general_benchmark.value !== 'N/A' ? `<p><strong>Benchmark:</strong> ${plant.watering_general_benchmark.value} ${plant.watering_general_benchmark.unit}</p>` : ''}
                            ${plant.depth_water_requirement.value !== 'N/A' ? `<p><strong>Depth:</strong> ${plant.depth_water_requirement.value} ${plant.depth_water_requirement.unit}</p>` : ''}
                        </div>
                        <div class="border-t pt-3">
                            <h4 class="font-semibold text-gray-800 mb-2">☀️ Sunlight</h4>
                            <p>${plant.sunlight}</p>
                        </div>
                        <div class="border-t pt-3">
                            <h4 class="font-semibold text-gray-800 mb-2">🌱 Soil & Growing</h4>
                            <p><strong>Soil:</strong> ${plant.soil}</p>
                            <p><strong>Propagation:</strong> ${plant.propagation}</p>
                            <p><strong>Maintenance:</strong> ${plant.maintenance}</p>
                            <p><strong>Care Level:</strong> ${plant.care_level}</p>
                        </div>
                        <div class="border-t pt-3">
                            <h4 class="font-semibold text-gray-800 mb-2">🌍 Hardiness Zones</h4>
                            <p><strong>Range:</strong> ${plant.hardiness.min} - ${plant.hardiness.max}</p>
                        </div>
                    </div>
                `;
                break;

            case 'pests':
                tabContent.innerHTML = '<div class="text-center py-4"><div class="spinner mx-auto"></div><p class="mt-2">Loading disease & pest information...</p></div>';
                try {
                    const diseasePestData = await getDiseasePestInfo(plant.common_name, 1);
                    if (diseasePestData.data && diseasePestData.data.length > 0) {
                        const items = diseasePestData.data.slice(0, 5).map(item => `
                            <div class="border-b pb-3 mb-3">
                                <h5 class="font-semibold text-gray-800">${item.common_name || 'Unknown'}</h5>
                                <p class="text-sm text-gray-600 italic">${item.scientific_name || ''}</p>
                                ${item.description ? `<p class="text-sm mt-1">${item.description.substring(0, 200)}...</p>` : ''}
                            </div>
                        `).join('');
                        tabContent.innerHTML = `<div class="space-y-3">${items}</div>`;
                    } else {
                        tabContent.innerHTML = '<div class="text-center py-4 text-gray-500">No specific disease/pest information found for this plant.</div>';
                    }
                } catch (error) {
                    tabContent.innerHTML = '<div class="text-red-500 text-center py-4">Error loading pest information</div>';
                }
                break;
        }
    }

    function updateModalFavoriteButton() {
        const btn = document.getElementById('modal-favorite-btn');
        const isFavorite = selectedPlant && favorites.some(fav => fav.id === selectedPlant.id);

        if (isFavorite) {
            btn.textContent = '🗑️ Remove from Favorites';
            btn.classList.remove('bg-yellow-400', 'hover:bg-yellow-500');
            btn.classList.add('bg-red-500', 'hover:bg-red-600', 'text-white');
        } else {
            btn.textContent = '⭐ Add to Favorites';
            btn.classList.remove('bg-red-500', 'hover:bg-red-600', 'text-white');
            btn.classList.add('bg-yellow-400', 'hover:bg-yellow-500');
        }
    }

    function toggleModalPlantFavorite() {
        if (!selectedPlant) return;

        const isFavorite = favorites.some(fav => fav.id === selectedPlant.id);

        if (isFavorite) {
            if (confirm(`Remove "${selectedPlant.common_name}" from favorites?`)) {
                removeFavorite(selectedPlant.id);
            }
        } else {
            favorites.push(selectedPlant);
            localStorage.setItem('plantFavorites', JSON.stringify(favorites));
            updateFavoritesUI();
        }

        updateModalFavoriteButton();
    }

    // --- SEARCH AND FILTER FUNCTIONS ---

    async function performSearch(page = 1) {
        // Check if we're in fungi mode
        if (browseSearchMode === 'fungi' && currentSearch) {
            return performFungiSearch();
        }

        const loadingDiv = document.getElementById('loading');
        const loadingText = document.getElementById('loading-text');

        try {
            loadingDiv.classList.remove('hidden');
            loadingText.textContent = 'Searching Perenual...';

            const filters = { ...currentFilters };
            if (currentSearch) filters.search = currentSearch;

            const data = await getPlantList(page, filters);
            lastPageData = data;
            currentPage = page;

            // Add source field to list results for badge display
            const plantsWithSource = data.data.map(plant => ({
                ...plant,
                source: 'perenual'
            }));

            renderPlantsGrid(plantsWithSource);
            updatePagination(data.current_page, data.last_page, data.total);

            document.getElementById('results-count').textContent = `Found ${data.total} plants from Perenual`;
        } catch (error) {
            console.error('Search error:', error);
            document.getElementById('plants-grid').innerHTML = '<div class="col-span-2 text-center text-red-500 py-10">Error loading plants. Please try again.</div>';
        } finally {
            loadingDiv.classList.add('hidden');
        }
    }

    function gatherFilters() {
        const filters = {};

        const edible = document.getElementById('filter-edible').checked;
        const poisonous = document.getElementById('filter-poisonous').checked;
        const indoor = document.getElementById('filter-indoor').checked;

        if (edible) filters.edible = true;
        if (poisonous) filters.poisonous = true;
        if (indoor) filters.indoor = true;

        const cycle = document.getElementById('filter-cycle').value;
        const watering = document.getElementById('filter-watering').value;
        const sunlight = document.getElementById('filter-sunlight').value;

        if (cycle) filters.cycle = cycle;
        if (watering) filters.watering = watering;
        if (sunlight) filters.sunlight = sunlight;

        return filters;
    }

    function clearFilters() {
        document.querySelectorAll('.filter-checkbox').forEach(cb => cb.checked = false);
        document.getElementById('filter-cycle').value = '';
        document.getElementById('filter-watering').value = '';
        document.getElementById('filter-sunlight').value = '';
        currentFilters = {};
    }

    // --- EVENT LISTENERS ---

    document.getElementById('search-btn').addEventListener('click', () => {
        currentSearch = document.getElementById('search-input').value.trim();
        currentFilters = gatherFilters();
        performSearch(1);
    });

    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            currentSearch = e.target.value.trim();
            currentFilters = gatherFilters();
            performSearch(1);
        }
    });

    document.getElementById('apply-filters-btn').addEventListener('click', () => {
        currentFilters = gatherFilters();
        performSearch(1);
    });

    document.getElementById('clear-filters-btn').addEventListener('click', () => {
        clearFilters();
        currentSearch = '';
        document.getElementById('search-input').value = '';
        performSearch(1);
    });

    document.getElementById('prev-page').addEventListener('click', () => {
        const pageInput = document.getElementById('page-input');
        const currentPageNum = parseInt(pageInput.value) || 1;
        if (currentPageNum > 1) {
            currentPage = currentPageNum - 1;
            performSearch(currentPage);
        }
    });

    document.getElementById('next-page').addEventListener('click', () => {
        const pageInput = document.getElementById('page-input');
        const totalPages = parseInt(document.getElementById('total-pages').textContent) || 1;
        const currentPageNum = parseInt(pageInput.value) || 1;
        if (currentPageNum < totalPages) {
            currentPage = currentPageNum + 1;
            performSearch(currentPage);
        }
    });
    
    // Page input - jump to specific page
    document.getElementById('page-input').addEventListener('change', (e) => {
        const totalPages = parseInt(document.getElementById('total-pages').textContent) || 1;
        let page = parseInt(e.target.value) || 1;
        page = Math.max(1, Math.min(page, totalPages)); // Clamp between 1 and max
        e.target.value = page;
        currentPage = page;
        performSearch(page);
    });
    
    document.getElementById('page-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.target.blur(); // Trigger the change event
        }
    });

    document.getElementById('detail-favorite-btn').addEventListener('click', toggleDetailPanelFavorite);

    document.getElementById('toggle-filters-btn').addEventListener('click', () => {
        const container = document.getElementById('filters-container');
        const text = document.getElementById('filter-toggle-text');
        if (container.classList.contains('hidden')) {
            container.classList.remove('hidden');
            text.textContent = '▲ Hide Filters';
        } else {
            container.classList.add('hidden');
            text.textContent = '▼ Show Filters';
        }
    });

    // Tab switching
    document.querySelectorAll('.detail-tab').forEach(tab => {
        tab.addEventListener('click', () => loadTab(tab.dataset.tab));
    });

    // --- HOME TAB FUNCTIONS ---

    async function handleHomeRandomPlant() {
        if (homeRequestInProgress) {
            console.log('🌿 Random plant request already in progress, ignoring...');
            return;
        }
        homeRequestInProgress = true;

        const randomBtn = document.getElementById('home-random-plant-btn');
        const favoriteBtn = document.getElementById('home-favorite-btn');
        const loadingDiv = document.getElementById('home-loading');
        const loadingText = document.getElementById('home-loading-text');
        const plantContainer = document.getElementById('home-plant-container');
        const emptyState = document.getElementById('home-empty-state');

        // Safety check for elements
        if (!randomBtn || !favoriteBtn || !loadingDiv || !loadingText || !plantContainer || !emptyState) {
            console.error('Missing required DOM elements');
            homeRequestInProgress = false;
            return;
        }

        randomBtn.disabled = true;
        favoriteBtn.disabled = true;
        randomBtn.textContent = 'Discovering...';
        plantContainer.classList.add('opacity-0', 'hidden');
        emptyState.classList.add('hidden');
        loadingDiv.classList.remove('hidden');

        try {
            loadingText.textContent = 'Finding a new plant friend...';
            const plantData = await getRandomPlant();
            currentHomePlant = plantData;

            // Show plant data immediately - with safety checks
            const nameEl = document.getElementById('home-plant-common-name');
            const sciNameEl = document.getElementById('home-plant-scientific-name');
            const imageEl = document.getElementById('home-plant-image');
            const descEl = document.getElementById('home-plant-description');
            
            if (nameEl) nameEl.textContent = plantData.common_name || 'Unknown Plant';
            if (sciNameEl) sciNameEl.textContent = plantData.scientific_name || 'N/A';
            if (imageEl) {
                imageEl.src = plantData.image_url || PLACEHOLDER_IMG;
                imageEl.onerror = function() { handleImageError(this); };
            }
            if (descEl) descEl.textContent = plantData.description || 'No description available.';
            
            // Add Wikipedia link
            const wikiEl = document.getElementById('home-plant-wikipedia');
            if (wikiEl) {
                const wikiUrl = plantData.wikipedia_url || getWikipediaUrl(plantData.common_name) || getWikipediaUrl(plantData.scientific_name);
                if (wikiUrl) {
                    wikiEl.innerHTML = `<a href="${wikiUrl}" target="_blank" class="text-blue-600 hover:underline font-semibold inline-flex items-center gap-2">📖 Wikipedia Article</a>`;
                } else {
                    wikiEl.innerHTML = '';
                }
            }

            // Hide loading, show plant
            loadingDiv.classList.add('hidden');
            plantContainer.classList.remove('opacity-0', 'hidden');
            randomBtn.disabled = false;
            favoriteBtn.disabled = false;
            randomBtn.textContent = '🌿 Random Plant';
            homeRequestInProgress = false;

        } catch (error) {
            console.error("Failed to fetch new plant:", error);

            // Show error in the empty state area
            emptyState.classList.remove('hidden');
            emptyState.innerHTML = `
                <div class="text-center text-red-600 space-y-4">
                    <h2 class="text-2xl font-bold">⚠️ Error</h2>
                    <p class="text-lg">${error.message.includes('rate limit') ? error.message : "Could not fetch a plant. Please try again!"}</p>
                    <div class="mt-4 p-4 bg-red-50 rounded-lg border border-red-200">
                        <p class="text-sm text-red-800"><strong>💡 Tip:</strong> If you're seeing rate limit errors, try:</p>
                        <ul class="text-sm text-left mx-auto max-w-md space-y-1 mt-2">
                            <li>• Wait a few minutes before trying again</li>
                            <li>• Use the 🍄 Random Mushroom button (uses different APIs)</li>
                            <li>• Try the Browse tab with multi-source search</li>
                        </ul>
                    </div>
                </div>
            `;

            loadingDiv.classList.add('hidden');
            plantContainer.classList.add('hidden');
            randomBtn.disabled = false;
            favoriteBtn.disabled = false;
            randomBtn.textContent = '🌿 Random Plant';
            homeRequestInProgress = false;
        }
    }

    function addHomePlantToFavorites() {
        if (currentHomePlant && !favorites.some(fav => fav.id === currentHomePlant.id)) {
            favorites.push(currentHomePlant);
            localStorage.setItem('plantFavorites', JSON.stringify(favorites));
            updateFavoritesUI();

            const btn = document.getElementById('home-favorite-btn');
            btn.textContent = '✅ Added!';
            setTimeout(() => {
                btn.textContent = '⭐ Add to Favorites';
            }, 2000);
        }
    }

    // --- NAVIGATION ---

    function switchTab(tabName) {
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });

        // Show selected tab
        document.getElementById(`${tabName}-tab`).classList.add('active');

        // Update nav buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.classList.add('text-gray-500');
        });
        const activeNavBtn = document.querySelector(`[data-tab="${tabName}"]`);
        activeNavBtn.classList.add('active');
        activeNavBtn.classList.remove('text-gray-500');

        // Load content based on tab
        if (tabName === 'browse') {
            // Only load browse data if not already loaded
            if (!lastPageData) {
                performSearch(1);
            }
        } else if (tabName === 'favorites') {
            updateFavoritesUI();
        } else if (tabName === 'games') {
            // Show game menu when switching to games tab
            const menu = document.getElementById('game-menu');
            const display = document.getElementById('game-display');
            if (menu) menu.classList.remove('hidden');
            if (display) {
                display.classList.add('hidden');
                display.innerHTML = '';
            }
        }
    }

    // Bottom nav event listeners
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });

    // Home tab event listeners
    document.getElementById('home-random-plant-btn').addEventListener('click', handleHomeRandomPlant);
    document.getElementById('home-random-mushroom-btn').addEventListener('click', handleHomeRandomMushroom);
    document.getElementById('home-favorite-btn').addEventListener('click', addHomePlantToFavorites);

    /**
     * Handle Random Mushroom button in Home tab
     */
    async function handleHomeRandomMushroom() {
        if (homeRequestInProgress) return;
        homeRequestInProgress = true;

        console.log('🍄 Home: Getting random mushroom...');
        const randomBtn = document.getElementById('home-random-mushroom-btn');
        const favoriteBtn = document.getElementById('home-favorite-btn');
        const loadingDiv = document.getElementById('home-loading');
        const loadingText = document.getElementById('home-loading-text');
        const plantContainer = document.getElementById('home-plant-container');
        const emptyState = document.getElementById('home-empty-state');

        // Safety check for elements BEFORE any DOM manipulation
        if (!randomBtn || !favoriteBtn || !loadingDiv || !loadingText || !plantContainer || !emptyState) {
            console.error('Missing required DOM elements for mushroom display');
            homeRequestInProgress = false;
            return;
        }

        randomBtn.disabled = true;
        favoriteBtn.disabled = true;
        randomBtn.textContent = 'Finding...';
        plantContainer.classList.add('opacity-0', 'hidden');
        emptyState.classList.add('hidden');
        loadingDiv.classList.remove('hidden');

        try {
            loadingText.textContent = 'Finding a random mushroom...';
            const formattedFungi = await getRandomMushroom();
            console.log('🍄 Home: Got random mushroom:', formattedFungi);

            currentHomePlant = formattedFungi;

            // Get elements directly by ID (they exist in DOM even if container is hidden)
            const nameEl = document.getElementById('home-plant-common-name');
            const sciNameEl = document.getElementById('home-plant-scientific-name');
            const imageEl = document.getElementById('home-plant-image');
            const descriptionEl = document.getElementById('home-plant-description');

            // Verify all elements exist before proceeding
            if (!nameEl) {
                console.error('❌ home-plant-common-name element not found');
                throw new Error('home-plant-common-name element not found in DOM');
            }
            if (!sciNameEl) {
                console.error('❌ home-plant-scientific-name element not found');
                throw new Error('home-plant-scientific-name element not found in DOM');
            }
            if (!imageEl) {
                console.error('❌ home-plant-image element not found');
                throw new Error('home-plant-image element not found in DOM');
            }
            if (!descriptionEl) {
                console.error('❌ home-plant-description element not found');
                throw new Error('home-plant-description element not found in DOM');
            }

            // Update elements safely
            try {
                nameEl.textContent = formattedFungi.common_name || 'Unknown Mushroom';
                sciNameEl.textContent = formattedFungi.scientific_name || 'N/A';
                imageEl.src = formattedFungi.image_url || PLACEHOLDER_IMG;
                imageEl.onerror = function() { handleImageError(this); };
                
                // Add toxicity warning for Toxic Shrooms, or show description for iNaturalist
                if (!descriptionEl) {
                    throw new Error('descriptionEl became null before setting innerHTML');
                }
                
                let descriptionHtml = formattedFungi.description || 'Mushroom information.';
                
                // Add toxicity warning only for Toxic Shrooms
                if (formattedFungi.source === 'toxicshrooms' && formattedFungi.toxicity_type) {
                    const warningHtml = `
                        <div class="bg-red-50 p-4 rounded-lg border-2 border-red-200 mt-4">
                            <h3 class="text-lg font-semibold text-red-800 mb-2">⚠️ TOXIC MUSHROOM WARNING</h3>
                            <p class="text-red-900 mb-2"><strong>Toxicity Level:</strong> ${formattedFungi.toxicity_type?.toUpperCase() || 'POISONOUS'}</p>
                            <p class="text-red-900 mb-2"><strong>Toxic Agent:</strong> ${formattedFungi.toxic_agent || 'Unknown toxins'}</p>
                            <p class="text-red-800 mb-2"><strong>Distribution:</strong> ${formattedFungi.distribution || 'Various locations'}</p>
                            <p class="text-sm text-red-700 mt-3 italic font-semibold">⚠️ This mushroom is dangerous. Never consume wild mushrooms without expert identification.</p>
                        </div>
                    `;
                    descriptionHtml += warningHtml;
                }
                
                descriptionEl.innerHTML = descriptionHtml;
                
                // Add Wikipedia link
                const wikiEl = document.getElementById('home-plant-wikipedia');
                if (wikiEl) {
                    const wikiUrl = formattedFungi.wikipedia_url || getWikipediaUrl(formattedFungi.common_name) || getWikipediaUrl(formattedFungi.scientific_name);
                    if (wikiUrl) {
                        wikiEl.innerHTML = `<a href="${wikiUrl}" target="_blank" class="text-blue-600 hover:underline font-semibold inline-flex items-center gap-2">📖 Wikipedia Article</a>`;
                    } else {
                        wikiEl.innerHTML = '';
                    }
                }
            } catch (updateError) {
                console.error('Error updating display elements:', updateError);
                throw new Error(`Failed to update display: ${updateError.message}`);
            }

            // Hide loading, show mushroom
            loadingDiv.classList.add('hidden');
            plantContainer.classList.remove('opacity-0', 'hidden');
            randomBtn.disabled = false;
            favoriteBtn.disabled = false;
            randomBtn.textContent = '🍄 Random Mushroom';
            homeRequestInProgress = false;

        } catch (error) {
            console.error('🍄 Home: Error getting random mushroom:', error);

            // Show error - with safety checks
            if (emptyState) {
                emptyState.classList.remove('hidden');
                emptyState.innerHTML = `
                    <div class="text-center text-red-600 space-y-4">
                        <h2 class="text-2xl font-bold">⚠️ Error</h2>
                        <p class="text-lg">Could not fetch a random mushroom. Please try again!</p>
                        <div class="mt-4 p-4 bg-red-50 rounded-lg border border-red-200">
                            <p class="text-sm text-red-800">The mushroom database might be temporarily unavailable.</p>
                        </div>
                    </div>
                `;
            } else {
                console.error('emptyState element not found');
            }

            if (loadingDiv) loadingDiv.classList.add('hidden');
            if (plantContainer) plantContainer.classList.add('hidden');
            if (randomBtn) {
                randomBtn.disabled = false;
                randomBtn.textContent = '🍄 Random Mushroom';
            }
            if (favoriteBtn) favoriteBtn.disabled = false;
            homeRequestInProgress = false;
        }
    }

    // Modal event listeners
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-favorite-btn').addEventListener('click', toggleModalPlantFavorite);

    // Close modal when clicking outside
    document.getElementById('plant-modal').addEventListener('click', (e) => {
        if (e.target.id === 'plant-modal') {
            closeModal();
        }
    });

    // Modal tab switching
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', () => loadModalTab(tab.dataset.tab));
    });

    // --- BROWSE TAB SEARCH MODE SWITCHING ---

    // Search mode tab buttons
    document.querySelectorAll('.search-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            browseSearchMode = mode;

            // Update button styles
            document.querySelectorAll('.search-mode-btn').forEach(b => {
                b.classList.remove('border-b-2', 'border-green-600', 'text-green-700');
                b.classList.add('text-gray-600');
            });
            btn.classList.add('border-b-2', 'border-green-600', 'text-green-700');
            btn.classList.remove('text-gray-600');

            // Update placeholder text
            const searchInput = document.getElementById('search-input');
            const fungiActions = document.getElementById('fungi-quick-actions');
            const filtersBtn = document.getElementById('toggle-filters-btn');
            const filtersSection = document.getElementById('filters-section');
            const plantsGrid = document.getElementById('plants-grid');
            const resultsCount = document.getElementById('results-count');
            const pagination = document.getElementById('pagination');
            const overlay = document.getElementById('detail-modal-overlay');

            // Clear current results and reset view
            plantsGrid.innerHTML = '';
            resultsCount.textContent = '';
            pagination.classList.add('hidden');
            if (overlay) overlay.classList.add('hidden');
            searchInput.value = '';
            currentSearch = '';

            if (mode === 'fungi') {
                searchInput.placeholder = 'Search fungi and mushrooms...';
                fungiActions.classList.remove('hidden');
                // Hide plant filters for fungi mode
                if (filtersBtn) filtersBtn.style.display = 'none';
                if (filtersSection) filtersSection.classList.add('hidden');
                // Load fungi by default when switching to fungi mode
                performFungiSearch(1);
            } else {
                searchInput.placeholder = 'Search plants by name...';
                fungiActions.classList.add('hidden');
                if (filtersBtn) filtersBtn.style.display = '';

                // Show plants welcome message
                plantsGrid.innerHTML = `
                    <div class="col-span-2 text-center py-10">
                        <div class="text-6xl mb-4">🌿</div>
                        <h3 class="text-xl font-semibold text-gray-700 mb-2">Plant Browse Mode</h3>
                        <p class="text-gray-500 mb-4">Search for plants or apply filters to explore</p>
                        <div class="text-sm text-gray-400">
                            <p>🌿 Perenual</p>
                        </div>
                    </div>
                `;
            }

            console.log(`🔄 Browse mode switched to: ${mode}`);
        });
    });

    // Wire up Browse fungi filter checkboxes
    document.getElementById('filter-toxic-all')?.addEventListener('change', applyFungiFilters);
    document.getElementById('filter-toxic-deadly')?.addEventListener('change', applyFungiFilters);
    document.getElementById('filter-toxic-poisonous')?.addEventListener('change', applyFungiFilters);

    // Close detail modal handlers
    document.getElementById('detail-close-btn')?.addEventListener('click', closeDetailModal);
    document.getElementById('detail-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'detail-modal-overlay') {
            closeDetailModal();
        }
    });

    function closeDetailModal() {
        const overlay = document.getElementById('detail-modal-overlay');
        const panel = document.getElementById('detail-panel');
        if (overlay) overlay.classList.add('hidden');
        if (panel) panel.classList.add('hidden');
        // Restore background scrolling when modal is closed
        document.body.style.overflow = '';
    }

    async function applyFungiFilters() {
        if (browseSearchMode !== 'fungi') return;
        
        const allChecked = document.getElementById('filter-toxic-all')?.checked;
        const deadlyChecked = document.getElementById('filter-toxic-deadly')?.checked;
        const poisonousChecked = document.getElementById('filter-toxic-poisonous')?.checked;

        let filterType = null;
        if (deadlyChecked && !poisonousChecked) {
            filterType = 'deadly';
        } else if (poisonousChecked && !deadlyChecked) {
            filterType = 'poisonous';
        } else if (!allChecked && !deadlyChecked && !poisonousChecked) {
            // If nothing is checked, check "all" by default
            document.getElementById('filter-toxic-all').checked = true;
            filterType = null;
        }

        await displayToxicMushroomsInBrowse(filterType);
    }

    /**
     * Display toxic mushrooms in Browse tab
     */
    async function displayToxicMushroomsInBrowse(type = null) {
        const loadingDiv = document.getElementById('loading');
        const loadingText = document.getElementById('loading-text');
        const plantsGrid = document.getElementById('plants-grid');

        try {
            loadingDiv.classList.remove('hidden');
            loadingText.textContent = 'Loading toxic mushrooms...';

            const toxicData = await getToxicShrooms(type);
            const formattedFungi = toxicData.map(shroom => formatToxicShroomData(shroom));

            loadingDiv.classList.add('hidden');

            if (formattedFungi.length > 0) {
                const typeText = type === 'deadly' ? 'Deadly' : type === 'poisonous' ? 'Poisonous' : 'Toxic';
                
                // Paginate results (10 per page)
                const perPage = 10;
                const page = 1;
                const startIdx = (page - 1) * perPage;
                const endIdx = startIdx + perPage;
                const pageFungi = formattedFungi.slice(startIdx, endIdx);

                document.getElementById('results-count').textContent = `Found ${formattedFungi.length} ${typeText} Mushrooms`;

                renderPlantsGrid(pageFungi);
                
                // Show pagination if we have more than 10 results
                if (formattedFungi.length > 10) {
                    const totalPages = Math.ceil(formattedFungi.length / 10);
                    updatePagination(page, totalPages, formattedFungi.length);
                } else {
                    document.getElementById('pagination').classList.add('hidden');
                }
            }
        } catch (error) {
            console.error('Toxic mushrooms error:', error);
            loadingDiv.classList.add('hidden');
        }
    }


    /**
     * Perform fungi search in Browse tab
     */
    async function performFungiSearch(page = 1) {
        console.log('🍄 Browse: Searching fungi for:', currentSearch);
        const loadingDiv = document.getElementById('loading');
        const loadingText = document.getElementById('loading-text');

        try {
            loadingDiv.classList.remove('hidden');
            loadingText.textContent = 'Searching fungi databases...';

            // Get fungi filters
            const allChecked = document.getElementById('filter-toxic-all')?.checked;
            const deadlyChecked = document.getElementById('filter-toxic-deadly')?.checked;
            const poisonousChecked = document.getElementById('filter-toxic-poisonous')?.checked;

            let filterType = null;
            if (deadlyChecked && !poisonousChecked) {
                filterType = 'deadly';
            } else if (poisonousChecked && !deadlyChecked) {
                filterType = 'poisonous';
            }

            // Search iNaturalist for fungi (taxon_id 47170 = Fungi kingdom)
            const inatResults = await searchINaturalist(currentSearch || '', page, 47170, 10);
            const inatFungi = (inatResults.results || []).map(taxon => formatINaturalistData(taxon));

            // Search Toxic Shrooms
            let toxicFungi = [];
            if (API_SOURCES.toxicshrooms.enabled) {
                try {
                    const toxicData = await getToxicShrooms(filterType);
                    let filtered = currentSearch ? 
                        toxicData.filter(shroom => 
                            (shroom.name && shroom.name.toLowerCase().includes(currentSearch.toLowerCase())) ||
                            (shroom.commonname && shroom.commonname.toLowerCase().includes(currentSearch.toLowerCase()))
                        ) : toxicData;
                    
                    // Paginate toxic shrooms (10 per page)
                    const perPage = 10;
                    const startIdx = (page - 1) * perPage;
                    const endIdx = startIdx + perPage;
                    filtered = filtered.slice(startIdx, endIdx);
                    
                    toxicFungi = filtered.map(shroom => formatToxicShroomData(shroom));
                } catch (error) {
                    console.warn('Toxic Shrooms search failed:', error);
                }
            }

            // Combine results
            const allFungi = [...inatFungi, ...toxicFungi];
            const totalFungi = allFungi.length;

            loadingDiv.classList.add('hidden');

            if (allFungi.length > 0) {
                document.getElementById('results-count').textContent = `Found ${totalFungi} fungi`;
                renderPlantsGrid(allFungi);
                
                // Show pagination if we have more than 10 results
                if (totalFungi >= 10) {
                    const totalPages = Math.ceil(totalFungi / 10);
                    updatePagination(page, totalPages, totalFungi);
                } else {
                    document.getElementById('pagination').classList.add('hidden');
                }
            } else {
                document.getElementById('plants-grid').innerHTML = '<div class="col-span-2 text-center text-gray-500 py-10">No fungi found. Try different search terms.</div>';
                document.getElementById('pagination').classList.add('hidden');
            }
        } catch (error) {
            console.error('Fungi search error:', error);
            loadingDiv.classList.add('hidden');
        }
    }

    // --- FUNGI TAB FUNCTIONS ---

    /**
     * Create a fungi/mushroom card
     */
    function createFungiCard(fungi) {
        const card = document.createElement('div');
        card.className = 'bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition cursor-pointer';

        // Source badge with different colors
        const sourceBadges = {
            'inaturalist': '<span class="badge bg-blue-100 text-blue-800">🔬 iNaturalist</span>',
            'toxicshrooms': '<span class="badge bg-red-100 text-red-800">☠️ Toxic</span>'
        };

        const sourceBadge = sourceBadges[fungi.source] || '';

        // Toxicity warning badge
        let toxicityBadge = '';
        if (fungi.toxicity_type === 'deadly') {
            toxicityBadge = '<span class="badge bg-red-600 text-white">💀 DEADLY</span>';
        } else if (fungi.toxicity_type === 'poisonous') {
            toxicityBadge = '<span class="badge bg-orange-500 text-white">⚠️ POISONOUS</span>';
        }

        const imgSrc = fungi.image_url || PLACEHOLDER_IMG;
        card.innerHTML = `
            <img src="${imgSrc}"
                 alt="${fungi.common_name}"
                 loading="lazy"
                 onerror="handleImageError(this)"
                 class="w-full h-48 object-cover">
            <div class="p-4">
                <h3 class="font-bold text-lg text-gray-800 mb-1">${fungi.common_name}</h3>
                <p class="text-sm italic text-gray-500 mb-2">${fungi.scientific_name}</p>
                <div class="mb-2">${sourceBadge}${toxicityBadge}</div>
                ${fungi.toxic_agent ? `<p class="text-xs text-red-700"><strong>Toxic Agent:</strong> ${fungi.toxic_agent}</p>` : ''}
                ${fungi.observations_count ? `<p class="text-xs text-gray-600">📊 ${fungi.observations_count.toLocaleString()} observations</p>` : ''}
                ${fungi.location ? `<p class="text-xs text-gray-600">📍 ${fungi.location}</p>` : ''}
            </div>
        `;

        card.addEventListener('click', () => showFungiDetails(fungi));
        return card;
    }

    /**
     * Search fungi across multiple databases
     */
    async function searchFungi(query) {
        console.log('🍄 Searching fungi for:', query);
        const loadingDiv = document.getElementById('fungi-loading');
        const resultsSection = document.getElementById('fungi-results-section');
        const emptyState = document.getElementById('fungi-empty');
        const fungiGrid = document.getElementById('fungi-grid');

        try {
            loadingDiv.classList.remove('hidden');
            resultsSection.classList.add('hidden');
            emptyState.classList.add('hidden');

            console.log('🍄 Searching fungi...');
            // Search iNaturalist for fungi (taxon_id 47170 = Fungi kingdom)
            const inatResults = await searchINaturalist(query, 1, 47170);
            const inatFungi = (inatResults.results || []).map(taxon => formatINaturalistData(taxon));

            // Search Toxic Shrooms if query matches
            let toxicFungi = [];
            if (API_SOURCES.toxicshrooms.enabled) {
                try {
                    const toxicData = await getToxicShrooms();
                    const filtered = query ? 
                        toxicData.filter(shroom => 
                            (shroom.name && shroom.name.toLowerCase().includes(query.toLowerCase())) ||
                            (shroom.commonname && shroom.commonname.toLowerCase().includes(query.toLowerCase()))
                        ) : toxicData;
                    toxicFungi = filtered.map(shroom => formatToxicShroomData(shroom));
                } catch (error) {
                    console.warn('Toxic Shrooms search failed:', error);
                }
            }

            // Combine results
            const allFungi = [...inatFungi, ...toxicFungi];
            console.log('🍄 Combined fungi results:', allFungi.length, allFungi);

            loadingDiv.classList.add('hidden');

            if (allFungi.length > 0) {
                resultsSection.classList.remove('hidden');
                document.getElementById('fungi-results-title').textContent = `Found ${allFungi.length} fungi`;
                document.getElementById('fungi-results-count').textContent = `From iNaturalist and Toxic Shrooms databases`;

                fungiGrid.innerHTML = '';
                allFungi.forEach(fungi => {
                    const card = createFungiCard(fungi);
                    console.log('🍄 Created card for:', fungi.common_name);
                    fungiGrid.appendChild(card);
                });
                console.log('🍄 ✅ Search complete, displayed', allFungi.length, 'results');
            } else {
                console.log('🍄 ⚠️ No results found');
                emptyState.classList.remove('hidden');
            }
        } catch (error) {
            console.error('🍄 ❌ Fungi search error:', error);
            loadingDiv.classList.add('hidden');
            emptyState.classList.remove('hidden');
        }
    }

    /**
     * Display toxic mushrooms
     */
    async function displayToxicMushrooms(type = null) {
        const loadingDiv = document.getElementById('fungi-loading');
        const resultsSection = document.getElementById('fungi-results-section');
        const emptyState = document.getElementById('fungi-empty');
        const fungiGrid = document.getElementById('fungi-grid');

        try {
            loadingDiv.classList.remove('hidden');
            resultsSection.classList.add('hidden');
            emptyState.classList.add('hidden');

            const toxicData = await getToxicShrooms(type);
            const formattedFungi = toxicData.map(shroom => formatToxicShroomData(shroom));

            loadingDiv.classList.add('hidden');

            if (formattedFungi.length > 0) {
                resultsSection.classList.remove('hidden');
                const typeText = type === 'deadly' ? 'Deadly' : type === 'poisonous' ? 'Poisonous' : 'Toxic';
                document.getElementById('fungi-results-title').textContent = `${typeText} Mushrooms (${formattedFungi.length})`;
                document.getElementById('fungi-results-count').textContent = 'From Toxic Shrooms Database';

                fungiGrid.innerHTML = '';
                formattedFungi.forEach(fungi => {
                    fungiGrid.appendChild(createFungiCard(fungi));
                });
            } else {
                emptyState.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Toxic mushrooms error:', error);
            loadingDiv.classList.add('hidden');
            emptyState.classList.remove('hidden');
        }
    }

    /**
     * Get random toxic mushroom
     */
    async function displayRandomMushroom() {
        console.log('🎲 Getting random mushroom...');
        const loadingDiv = document.getElementById('fungi-loading');
        const resultsSection = document.getElementById('fungi-results-section');
        const emptyState = document.getElementById('fungi-empty');
        const fungiGrid = document.getElementById('fungi-grid');

        try {
            loadingDiv.classList.remove('hidden');
            resultsSection.classList.add('hidden');
            emptyState.classList.add('hidden');

            console.log('🎲 Calling getRandomToxicShroom API...');
            const randomShroom = await getRandomToxicShroom();
            console.log('🎲 Received random shroom:', randomShroom);

            loadingDiv.classList.add('hidden');

            if (randomShroom) {
                resultsSection.classList.remove('hidden');
                document.getElementById('fungi-results-title').textContent = 'Random Toxic Mushroom';
                document.getElementById('fungi-results-count').textContent = 'Click to see details';

                fungiGrid.innerHTML = '';
                const formattedFungi = formatToxicShroomData(randomShroom);
                console.log('🎲 Formatted fungi:', formattedFungi);
                fungiGrid.appendChild(createFungiCard(formattedFungi));
                console.log('🎲 ✅ Random mushroom displayed');
            } else {
                console.log('🎲 ⚠️ No random mushroom returned');
                emptyState.classList.remove('hidden');
            }
        } catch (error) {
            console.error('🎲 ❌ Random mushroom error:', error);
            loadingDiv.classList.add('hidden');
            emptyState.classList.remove('hidden');
        }
    }

    /**
     * Show fungi details in modal
     */
    function showFungiDetails(fungi) {
        selectedPlant = fungi; // Reuse the plant modal infrastructure
        openPlantModal(null); // We'll populate it manually

        // Override modal content with fungi-specific data
        const modal = document.getElementById('plant-modal');
        const modalImage = document.getElementById('modal-plant-image');
        if (modalImage) {
            modalImage.src = fungi.image_url || PLACEHOLDER_IMG;
            modalImage.onerror = function() { handleImageError(this); };
        }
        document.getElementById('modal-plant-name').textContent = fungi.common_name;
        document.getElementById('modal-plant-scientific').textContent = fungi.scientific_name;

        // Custom badges for fungi
        const badgesDiv = document.getElementById('modal-plant-badges');
        const badges = [];

        if (fungi.toxicity_type === 'deadly') {
            badges.push('<span class="badge bg-red-600 text-white">💀 DEADLY</span>');
        } else if (fungi.toxicity_type === 'poisonous') {
            badges.push('<span class="badge bg-orange-500 text-white">⚠️ POISONOUS</span>');
        }

        if (fungi.endemic) badges.push('<span class="badge badge-green">Endemic</span>');
        if (fungi.threatened) badges.push('<span class="badge badge-red">Threatened</span>');
        if (fungi.introduced) badges.push('<span class="badge badge-yellow">Introduced</span>');

        badgesDiv.innerHTML = badges.join('');

        // Custom content for fungi
        const tabContent = document.getElementById('modal-tab-content');
        tabContent.innerHTML = `
            <div class="space-y-4">
                <p class="text-gray-700">${fungi.description}</p>
                ${fungi.toxic_agent ? `
                    <div class="bg-red-50 p-4 rounded-lg border border-red-200">
                        <h4 class="font-semibold text-red-800 mb-2">⚠️ Toxicity Information</h4>
                        <p><strong>Toxic Agent:</strong> ${fungi.toxic_agent}</p>
                        ${fungi.toxicity_type ? `<p><strong>Type:</strong> ${fungi.toxicity_type.toUpperCase()}</p>` : ''}
                        ${fungi.distribution ? `<p><strong>Distribution:</strong> ${fungi.distribution}</p>` : ''}
                    </div>
                ` : ''}
                ${fungi.observations_count ? `
                    <div>
                        <h4 class="font-semibold text-gray-800 mb-2">📊 Observation Data</h4>
                        <p><strong>Total Observations:</strong> ${fungi.observations_count.toLocaleString()}</p>
                        ${fungi.rank ? `<p><strong>Taxonomic Rank:</strong> ${fungi.rank}</p>` : ''}
                        ${fungi.iconic_taxon_name ? `<p><strong>Iconic Taxon:</strong> ${fungi.iconic_taxon_name}</p>` : ''}
                    </div>
                ` : ''}
                ${fungi.location ? `
                    <div>
                        <h4 class="font-semibold text-gray-800 mb-2">📍 Location</h4>
                        <p>${fungi.location}</p>
                        ${fungi.date ? `<p><strong>Date:</strong> ${fungi.date}</p>` : ''}
                        ${fungi.observer ? `<p><strong>Observer:</strong> ${fungi.observer}</p>` : ''}
                    </div>
                ` : ''}
                ${fungi.kingdom || fungi.phylum || fungi.class || fungi.order || fungi.family || fungi.genus ? `
                    <div>
                        <h4 class="font-semibold text-gray-800 mb-2">🔬 Taxonomy</h4>
                        ${fungi.kingdom ? `<p><strong>Kingdom:</strong> ${fungi.kingdom}</p>` : ''}
                        ${fungi.phylum ? `<p><strong>Phylum:</strong> ${fungi.phylum}</p>` : ''}
                        ${fungi.class ? `<p><strong>Class:</strong> ${fungi.class}</p>` : ''}
                        ${fungi.order ? `<p><strong>Order:</strong> ${fungi.order}</p>` : ''}
                        ${fungi.family ? `<p><strong>Family:</strong> ${fungi.family}</p>` : ''}
                        ${fungi.genus ? `<p><strong>Genus:</strong> ${fungi.genus}</p>` : ''}
                    </div>
                ` : ''}
                ${fungi.wikipedia_url ? `
                    <div class="mt-4">
                        <a href="${fungi.wikipedia_url}" target="_blank" class="text-blue-600 hover:text-blue-800 underline">
                            📖 View on Wikipedia →
                        </a>
                    </div>
                ` : ''}
            </div>
        `;

        updateModalFavoriteButton();
    }

    // Fungi tab event listeners
    document.getElementById('fungi-search-btn').addEventListener('click', () => {
        const query = document.getElementById('fungi-search-input').value.trim();
        if (query) searchFungi(query);
    });

    document.getElementById('fungi-search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = e.target.value.trim();
            if (query) searchFungi(query);
        }
    });

    document.getElementById('fungi-random-btn').addEventListener('click', displayRandomMushroom);
    document.getElementById('toxic-all-btn').addEventListener('click', () => displayToxicMushrooms(null));
    document.getElementById('toxic-deadly-btn').addEventListener('click', () => displayToxicMushrooms('deadly'));
    document.getElementById('toxic-poisonous-btn').addEventListener('click', () => displayToxicMushrooms('poisonous'));

    // --- DEVELOPER MODE (Option+T) ---

    function openDevPanel() {
        const panel = document.getElementById('dev-panel');
        panel.classList.remove('hidden');
        updateDevPanelInfo();
    }

    function closeDevPanel() {
        const panel = document.getElementById('dev-panel');
        panel.classList.add('hidden');
    }

    function updateDevPanelInfo() {
        // Current state
        const stateInfo = {
            currentTab: document.querySelector('.nav-btn.active')?.dataset.tab || 'unknown',
            selectedPlant: selectedPlant ? {
                id: selectedPlant.id,
                name: selectedPlant.common_name
            } : null,
            homeRequestInProgress,
            currentPage,
            totalFavorites: favorites.length
        };
        document.getElementById('dev-state').textContent = JSON.stringify(stateInfo, null, 2);

        // Local storage
        const storageInfo = {
            totalPlantsCacheTime: localStorage.getItem('totalPlantsCacheTime'),
            totalPlantsCount: localStorage.getItem('totalPlantsCount'),
            favoritesCount: favorites.length,
            storageUsed: new Blob(Object.values(localStorage)).size + ' bytes'
        };
        document.getElementById('dev-storage').textContent = JSON.stringify(storageInfo, null, 2);

        // Performance
        const perfInfo = {
            userAgent: navigator.userAgent,
            onLine: navigator.onLine,
            connection: navigator.connection?.effectiveType || 'unknown',
            memory: performance.memory ? {
                used: Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB',
                total: Math.round(performance.memory.totalJSHeapSize / 1048576) + ' MB'
            } : 'not available'
        };
        document.getElementById('dev-performance').textContent = JSON.stringify(perfInfo, null, 2);
    }

    // Keyboard shortcut: Option+T (or Alt+T on Windows)
    document.addEventListener('keydown', (e) => {
        // Check for Option/Alt + T
        if ((e.altKey || e.metaKey) && e.key.toLowerCase() === 't') {
            e.preventDefault();
            const devPanel = document.getElementById('dev-panel');
            if (devPanel.classList.contains('hidden')) {
                openDevPanel();
            } else {
                closeDevPanel();
            }
        }
    });

    // Dev panel actions
    document.getElementById('dev-panel-close').addEventListener('click', closeDevPanel);

    document.getElementById('dev-clear-cache').addEventListener('click', () => {
        if (confirm('Clear all cached data? This will remove plant count cache.')) {
            localStorage.removeItem('totalPlantsCount');
            localStorage.removeItem('totalPlantsCacheTime');
            alert('Cache cleared!');
            updateDevPanelInfo();
        }
    });

    document.getElementById('dev-clear-favorites').addEventListener('click', () => {
        if (confirm('Clear all favorites? This cannot be undone.')) {
            favorites = [];
            localStorage.removeItem('plantFavorites');
            updateFavoritesUI();
            alert('Favorites cleared!');
            updateDevPanelInfo();
        }
    });

    document.getElementById('dev-export-data').addEventListener('click', () => {
        const exportData = {
            favorites: favorites.map(f => ({
                id: f.id,
                common_name: f.common_name,
                scientific_name: f.scientific_name
            })),
            cache: {
                totalPlantsCount: localStorage.getItem('totalPlantsCount'),
                cacheTime: localStorage.getItem('totalPlantsCacheTime')
            },
            exportDate: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `plant-browser-data-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // --- DEVICE SIMULATOR ---

    const deviceSizes = {
        'iphone-14-pro': { width: 393, height: 852, name: 'iPhone 14 Pro' },
        'iphone-se': { width: 375, height: 667, name: 'iPhone SE' },
        'ipad': { width: 768, height: 1024, name: 'iPad' },
        'desktop': { width: '100%', height: '100vh', name: 'Desktop' }
    };

    let currentDevice = 'desktop';

    function setDeviceSize(deviceType) {
        const appContainer = document.getElementById('app-container');
        const body = document.body;
        const viewportText = document.getElementById('current-viewport');

        currentDevice = deviceType;

        if (deviceType === 'desktop') {
            // Reset to normal
            body.classList.remove('device-sim-active', 'device-iphone');
            appContainer.style.width = '';
            appContainer.style.height = '';
            appContainer.style.maxWidth = '';
            appContainer.style.maxHeight = '';
            if (viewportText) viewportText.textContent = 'Desktop mode (normal)';
        } else {
            // Apply device simulation
            const device = deviceSizes[deviceType];
            body.classList.add('device-sim-active');

            if (deviceType.includes('iphone')) {
                body.classList.add('device-iphone');
            } else {
                body.classList.remove('device-iphone');
            }

            appContainer.style.width = device.width + 'px';
            appContainer.style.height = device.height + 'px';
            appContainer.style.maxWidth = device.width + 'px';
            appContainer.style.maxHeight = device.height + 'px';

            if (viewportText) {
                viewportText.textContent = `Currently viewing: ${device.name} (${device.width}×${device.height})`;
            }
        }

        // Save preference
        localStorage.setItem('dev-device-mode', deviceType);
    }

    // Device simulator buttons
    document.querySelectorAll('.device-sim-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const deviceType = btn.dataset.device;
            setDeviceSize(deviceType);

            // Update button states
            document.querySelectorAll('.device-sim-btn').forEach(b => {
                b.classList.remove('bg-green-700');
                b.classList.add('bg-gray-700');
            });
            btn.classList.remove('bg-gray-700');
            btn.classList.add('bg-green-700');
        });
    });

    // Toggle mobile view button
    document.getElementById('dev-toggle-mobile').addEventListener('click', () => {
        if (currentDevice === 'desktop') {
            setDeviceSize('iphone-14-pro');
        } else {
            setDeviceSize('desktop');
        }
    });

    // Restore device mode on load
    const savedDevice = localStorage.getItem('dev-device-mode');
    if (savedDevice && savedDevice !== 'desktop') {
        setTimeout(() => setDeviceSize(savedDevice), 100);
    }

    // --- INITIAL LOAD ---

    console.log('🌿 App initialized - no automatic API calls');

    // Only update favorites UI (no API calls)
    updateFavoritesUI();


    // Show welcome message instead of loading a plant automatically
    console.log('🌿 Ready! Click a button to discover plants or fungi.');

    // ==================== GAMES SECTION ====================
    // Make game functions globally accessible for onclick handlers
    
    // Game state variables
    let currentGamePlant = null;
    let currentGameType = null;
    let gameRevealed = false;
    let memoryCards = [];
    let flippedCards = [];
    let matchedPairs = 0;
    let quizScore = 0;
    let typingGameScore = 0;
    let typingGameRound = 0;
    let typingGamePlant = null;
    let speedMatchPlants = [];
    let speedMatchScore = 0;
    let speedMatchTimeLeft = 30;
    let speedMatchTimer = null;
    let speedMatchCurrentIndex = 0;
    let scrambleGameScore = 0;
    let scrambleGameRound = 0;
    let scrambleGamePlant = null;
    let scrambleGameScrambled = '';
    let trueFalseScore = 0;
    let trueFalseRound = 0;
    let trueFalsePlant = null;
    let trueFalseStatement = '';
    let trueFalseAnswer = false;
    let alphabetScore = 0;
    let alphabetRound = 0;
    let alphabetLetter = '';
    let alphabetPlants = [];
    let flashCardIndex = 0;
    let flashCardPlants = [];

    // Helper function to get random plant or mushroom for games
    async function getRandomGameItem() {
        const useMushroom = Math.random() < 0.3; // 30% chance for mushroom, 70% for plant
        if (useMushroom && API_SOURCES.toxicshrooms.enabled) {
            try {
                return await getRandomMushroom();
            } catch (error) {
                console.warn('Failed to get mushroom, using plant:', error);
                return await getRandomPlant();
            }
        } else {
            return await getRandomPlant();
        }
    }

    // Helper function to show loading in game display
    function showGameLoading() {
        const display = document.getElementById('game-display');
        if (display) {
            display.classList.remove('hidden');
            display.innerHTML = `
                <div class="text-center py-20">
                    <div class="spinner mx-auto"></div>
                    <p class="mt-4 text-gray-600">Loading game...</p>
                </div>
            `;
        }
    }

    // Helper function to go back to game menu
    function backToGameMenu() {
        const menu = document.getElementById('game-menu');
        const display = document.getElementById('game-display');
        if (menu) menu.classList.remove('hidden');
        if (display) {
            display.classList.add('hidden');
            display.innerHTML = '';
        }
    }

    // GAME 1: GUESS THE PLANT/MUSHROOM
    async function startGuessGame() {
        const menu = document.getElementById('game-menu');
        if (menu) menu.classList.add('hidden');
        showGameLoading();
        gameRevealed = false;

        try {
            currentGamePlant = await getRandomGameItem();
            const display = document.getElementById('game-display');
            if (!display) {
                console.error('game-display element not found');
                return;
            }
            display.classList.remove('hidden');
            const imageUrl = currentGamePlant.image_url || currentGamePlant.images?.[0]?.url || PLACEHOLDER_IMG;
            const name = currentGamePlant.common_name || currentGamePlant.name || 'Unknown';
            const sciName = currentGamePlant.scientific_name || currentGamePlant.scientificName || '';

            display.innerHTML = `
                <div class="text-center">
                    <h3 class="text-2xl font-bold text-green-800 mb-4">🖼️ Guess the Plant/Mushroom</h3>
                    <p class="text-gray-600 mb-6">Can you guess which plant or mushroom this is?</p>
                    
                    <div class="mb-6">
                        <img src="${imageUrl}" 
                             id="game-plant-image"
                             alt="Mystery Plant"
                             class="mx-auto rounded-lg shadow-lg max-w-md w-full h-64 object-cover blurred"
                             onerror="handleImageError(this)"
                             style="filter: blur(20px); transition: filter 0.3s;">
                    </div>

                    <div class="flex items-center justify-center gap-4 mb-6">
                        <span class="text-sm text-gray-600">Blurred</span>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="blur-toggle" class="sr-only peer" onchange="toggleBlur()">
                            <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                        </label>
                        <span class="text-sm text-gray-600">Clear</span>
                    </div>

                    <div class="space-y-3">
                        <button onclick="revealGuessAnswer()" class="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                            👁️ Reveal Answer
                        </button>
                        <button onclick="startGuessGame()" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                            ⏭️ Next
                        </button>
                        <button onclick="backToGameMenu()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                            🏠 Menu
                        </button>
                    </div>
                    <div id="game-answer" class="mt-6"></div>
                </div>
            `;
        } catch (error) {
            console.error('Error in startGuessGame:', error);
            document.getElementById('game-display').innerHTML = `
                <div class="text-center py-20 text-red-600">
                    <p class="text-xl">Could not load challenge. Please try again!</p>
                    <button onclick="backToGameMenu()" class="mt-4 bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg">
                        🏠 Menu
                    </button>
                </div>
            `;
        }
    }

    function toggleBlur() {
        const toggle = document.getElementById('blur-toggle');
        const image = document.getElementById('game-plant-image');
        if (toggle.checked) {
            image.style.filter = 'none';
        } else {
            image.style.filter = 'blur(20px)';
        }
    }

    function revealGuessAnswer() {
        if (gameRevealed || !currentGamePlant) return;
        gameRevealed = true;
        const answerDiv = document.getElementById('game-answer');
        const name = currentGamePlant.common_name || currentGamePlant.name || 'Unknown';
        const sciName = currentGamePlant.scientific_name || currentGamePlant.scientificName || '';
        
        const toggle = document.getElementById('blur-toggle');
        if (toggle) toggle.checked = true;
        toggleBlur();

        answerDiv.innerHTML = `
            <div class="bg-green-50 border-2 border-green-500 rounded-lg p-6 mt-6 animate-fadeIn">
                <div class="text-3xl font-bold text-green-800">✅ ${name}</div>
                ${sciName ? `<div class="text-lg italic text-gray-600 mt-2">${sciName}</div>` : ''}
            </div>
        `;
    }

    // GAME 2: MEMORY MATCH
    async function startMemoryGame() {
        const menu = document.getElementById('game-menu');
        if (menu) menu.classList.add('hidden');
        showGameLoading();
        matchedPairs = 0;
        flippedCards = [];

        try {
            const plants = [];
            for (let i = 0; i < 6; i++) {
                plants.push(await getRandomGameItem());
            }
            memoryCards = [...plants, ...plants].sort(() => Math.random() - 0.5);

            const display = document.getElementById('game-display');
            if (!display) {
                console.error('game-display element not found');
                return;
            }
            display.classList.remove('hidden');
            display.innerHTML = `
                <div class="text-center">
                    <h3 class="text-2xl font-bold text-purple-800 mb-4">🧠 Memory Match</h3>
                    <p class="text-gray-600 mb-6">Find all the matching pairs!</p>

                    <div class="flex justify-center gap-8 mb-6">
                        <div class="bg-purple-100 px-4 py-2 rounded-lg">
                            <div class="text-2xl font-bold text-purple-800" id="pairs-found">0</div>
                            <div class="text-sm text-gray-600">Pairs Found</div>
                        </div>
                        <div class="bg-purple-100 px-4 py-2 rounded-lg">
                            <div class="text-2xl font-bold text-purple-800">6</div>
                            <div class="text-sm text-gray-600">Total Pairs</div>
                        </div>
                    </div>

                    <div class="grid grid-cols-3 md:grid-cols-4 gap-4 mb-6" id="memory-grid"></div>

                    <div class="space-y-3">
                        <button onclick="startMemoryGame()" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                            🔄 New Game
                        </button>
                        <button onclick="backToGameMenu()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                            🏠 Menu
                        </button>
                    </div>
                </div>
            `;

            const grid = document.getElementById('memory-grid');
            memoryCards.forEach((plant, index) => {
                const card = document.createElement('div');
                card.className = 'memory-card relative cursor-pointer h-32 bg-gray-200 rounded-lg overflow-hidden transform transition-transform hover:scale-105';
                card.dataset.index = index;
                card.dataset.plantName = plant.common_name || plant.name || `plant_${index}`;
                const imageUrl = plant.image_url || plant.images?.[0]?.url || PLACEHOLDER_IMG;
                card.innerHTML = `
                    <div class="card-back absolute inset-0 bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-4xl">
                        🌿
                    </div>
                    <div class="card-front absolute inset-0">
                        <img src="${imageUrl}" alt="${plant.common_name || plant.name}" class="w-full h-full object-cover" onerror="handleImageError(this)">
                    </div>
                `;
                card.onclick = () => flipMemoryCard(index);
                grid.appendChild(card);
            });
        } catch (error) {
            console.error('Error in startMemoryGame:', error);
            document.getElementById('game-display').innerHTML = `
                <div class="text-center py-20 text-red-600">
                    <p class="text-xl">Could not load memory game!</p>
                    <button onclick="backToGameMenu()" class="mt-4 bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg">
                        🏠 Menu
                    </button>
                </div>
            `;
        }
    }

    function flipMemoryCard(index) {
        const card = document.querySelector(`.memory-card[data-index="${index}"]`);
        if (card.classList.contains('flipped') || card.classList.contains('matched') || flippedCards.length === 2) {
            return;
        }

        card.classList.add('flipped');
        const back = card.querySelector('.card-back');
        const front = card.querySelector('.card-front');
        if (back) back.classList.add('hidden');
        if (front) front.classList.remove('hidden');
        
        flippedCards.push({ index, name: card.dataset.plantName, element: card });

        if (flippedCards.length === 2) {
            setTimeout(checkMemoryMatch, 800);
        }
    }

    function checkMemoryMatch() {
        const [card1, card2] = flippedCards;
        if (card1.name === card2.name && card1.index !== card2.index) {
            card1.element.classList.add('matched');
            card2.element.classList.add('matched');
            matchedPairs++;
            document.getElementById('pairs-found').textContent = matchedPairs;

            if (matchedPairs === 6) {
                setTimeout(() => {
                    alert('🎉 Congratulations! You found all pairs!');
                }, 500);
            }
        } else {
            card1.element.classList.remove('flipped');
            card2.element.classList.remove('flipped');
            const back1 = card1.element.querySelector('.card-back');
            const front1 = card1.element.querySelector('.card-front');
            const back2 = card2.element.querySelector('.card-back');
            const front2 = card2.element.querySelector('.card-front');
            if (back1) back1.classList.remove('hidden');
            if (front1) front1.classList.add('hidden');
            if (back2) back2.classList.remove('hidden');
            if (front2) front2.classList.add('hidden');
        }
        flippedCards = [];
    }

    // GAME 3: PLANT QUIZ
    async function startQuizGame() {
        const menu = document.getElementById('game-menu');
        if (menu) menu.classList.add('hidden');
        showGameLoading();

        try {
            const correctPlant = await getRandomGameItem();
            const wrongPlants = [];
            while (wrongPlants.length < 3) {
                const plant = await getRandomGameItem();
                const correctName = correctPlant.common_name || correctPlant.name;
                const wrongName = plant.common_name || plant.name;
                if (wrongName !== correctName && !wrongPlants.find(p => (p.common_name || p.name) === wrongName)) {
                    wrongPlants.push(plant);
                }
            }

            const allOptions = [correctPlant, ...wrongPlants].sort(() => Math.random() - 0.5);
            const display = document.getElementById('game-display');
            if (!display) {
                console.error('game-display element not found');
                return;
            }
            display.classList.remove('hidden');
            const imageUrl = correctPlant.image_url || correctPlant.images?.[0]?.url || PLACEHOLDER_IMG;
            const correctName = correctPlant.common_name || correctPlant.name || 'Unknown';

            display.innerHTML = `
                <div class="text-center">
                    <h3 class="text-2xl font-bold text-blue-800 mb-4">❓ Plant/Mushroom Quiz</h3>
                    <p class="text-gray-600 mb-6">Which plant or mushroom is this?</p>
                    
                    <img src="${imageUrl}" alt="Quiz Plant" class="mx-auto rounded-lg shadow-lg max-w-md w-full h-64 object-cover mb-6" onerror="handleImageError(this)">

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 max-w-2xl mx-auto">
                        ${allOptions.map(plant => {
                            const name = plant.common_name || plant.name || 'Unknown';
                            return `
                                <button onclick="selectQuizAnswer('${name.replace(/'/g, "\\'")}', '${correctName.replace(/'/g, "\\'")}', this)" 
                                        class="quiz-option bg-blue-100 hover:bg-blue-200 text-blue-800 px-6 py-4 rounded-lg font-semibold transition-colors">
                                    ${name}
                                </button>
                            `;
                        }).join('')}
                    </div>

                    <div class="space-y-3">
                        <button onclick="startQuizGame()" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                            ⏭️ Next Question
                        </button>
                        <button onclick="backToGameMenu()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                            🏠 Menu
                        </button>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error in startQuizGame:', error);
            document.getElementById('game-display').innerHTML = `
                <div class="text-center py-20 text-red-600">
                    <p class="text-xl">Could not load quiz!</p>
                    <button onclick="backToGameMenu()" class="mt-4 bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg">
                        🏠 Menu
                    </button>
                </div>
            `;
        }
    }

    function selectQuizAnswer(selected, correct, element) {
        const options = document.querySelectorAll('.quiz-option');
        options.forEach(opt => opt.disabled = true);

        if (selected === correct) {
            element.classList.add('bg-green-500', 'text-white');
            element.classList.remove('bg-blue-100', 'hover:bg-blue-200', 'text-blue-800');
        } else {
            element.classList.add('bg-red-500', 'text-white');
            element.classList.remove('bg-blue-100', 'hover:bg-blue-200', 'text-blue-800');
            options.forEach(opt => {
                if (opt.textContent.trim() === correct) {
                    opt.classList.add('bg-green-500', 'text-white');
                    opt.classList.remove('bg-blue-100', 'hover:bg-blue-200', 'text-blue-800');
                }
            });
        }
    }

    // GAME 4: TYPE THE PLANT
    async function startTypingGame() {
        const menu = document.getElementById('game-menu');
        if (menu) menu.classList.add('hidden');
        showGameLoading();
        typingGameScore = 0;
        typingGameRound = 0;

        try {
            await showTypingGameRound();
        } catch (error) {
            console.error('Error in startTypingGame:', error);
            const display = document.getElementById('game-display');
            if (display) display.classList.remove('hidden');
            if (display) display.innerHTML = `
                <div class="text-center py-20 text-red-600">
                    <p class="text-xl">Could not load typing game!</p>
                    <button onclick="backToGameMenu()" class="mt-4 bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg">
                        🏠 Menu
                    </button>
                </div>
            `;
        }
    }

    async function showTypingGameRound() {
        typingGameRound++;
        typingGamePlant = await getRandomGameItem();
        const display = document.getElementById('game-display');
        if (!display) {
            console.error('game-display element not found');
            return;
        }
        display.classList.remove('hidden');
        const imageUrl = typingGamePlant.image_url || typingGamePlant.images?.[0]?.url || PLACEHOLDER_IMG;
        const name = typingGamePlant.common_name || typingGamePlant.name || 'Unknown';

        display.innerHTML = `
            <div class="text-center">
                <h3 class="text-2xl font-bold text-yellow-800 mb-4">⌨️ Type the Plant/Mushroom - Round ${typingGameRound}</h3>
                <p class="text-gray-600 mb-6">Type the name as fast as you can!</p>
                
                <img src="${imageUrl}" alt="${name}" class="mx-auto rounded-lg shadow-lg max-w-md w-full h-64 object-cover mb-6" onerror="handleImageError(this)">

                <div class="mb-6">
                    <input type="text" 
                           id="typing-input" 
                           placeholder="Type plant/mushroom name here..." 
                           autocomplete="off"
                           class="w-full max-w-md mx-auto px-6 py-4 text-xl border-3 border-yellow-600 rounded-lg text-center"
                           oninput="checkTypingAnswer()"
                           onkeydown="if(event.key === 'Enter') checkTypingAnswer()">
                </div>

                <div id="typing-feedback" class="min-h-[50px] mb-6"></div>

                <div class="mb-6">
                    <p class="text-gray-600">Score: <strong class="text-yellow-800">${typingGameScore}</strong> | Round: ${typingGameRound}</p>
                </div>

                <div class="space-y-3">
                    <button onclick="showTypingGameRound()" class="bg-yellow-600 hover:bg-yellow-700 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                        ⏭️ Next Plant
                    </button>
                    <button onclick="backToGameMenu()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                        🏠 Menu
                    </button>
                </div>
            </div>
        `;

        document.getElementById('typing-input')?.focus();
    }

    function checkTypingAnswer() {
        const input = document.getElementById('typing-input');
        const feedback = document.getElementById('typing-feedback');
        if (!input || !feedback || !typingGamePlant) return;

        const userInput = input.value.trim().toLowerCase();
        const correctName = (typingGamePlant.common_name || typingGamePlant.name || '').toLowerCase();

        if (userInput === correctName) {
            typingGameScore += 10;
            feedback.innerHTML = `
                <div class="bg-green-100 border-2 border-green-500 rounded-lg p-4 text-green-800">
                    ✅ Correct! (+10 points)
                </div>
            `;
            input.disabled = true;
            setTimeout(() => {
                showTypingGameRound();
            }, 2000);
        } else if (userInput.length > 0 && correctName.startsWith(userInput)) {
            feedback.innerHTML = `
                <div class="text-gray-600">Keep typing... "${userInput}" ✓</div>
            `;
        }
    }

    // GAME 5: SPEED MATCH
    async function startSpeedMatchGame() {
        document.getElementById('game-menu').classList.add('hidden');
        showGameLoading();
        speedMatchScore = 0;
        speedMatchTimeLeft = 30;
        speedMatchCurrentIndex = 0;

        try {
            speedMatchPlants = [];
            for (let i = 0; i < 10; i++) {
                speedMatchPlants.push(await getRandomGameItem());
            }
            await showSpeedMatchRound();
        } catch (error) {
            console.error('Error in startSpeedMatchGame:', error);
            document.getElementById('game-display').innerHTML = `
                <div class="text-center py-20 text-red-600">
                    <p class="text-xl">Could not load speed match game!</p>
                    <button onclick="backToGameMenu()" class="mt-4 bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg">
                        🏠 Menu
                    </button>
                </div>
            `;
        }
    }

    async function showSpeedMatchRound() {
        const display = document.getElementById('game-display');
        if (!display) {
            console.error('game-display element not found');
            return;
        }
        display.classList.remove('hidden');

        if (speedMatchCurrentIndex >= speedMatchPlants.length) {
            clearInterval(speedMatchTimer);
            display.innerHTML = `
                <div class="text-center py-20">
                    <h3 class="text-3xl font-bold text-red-800 mb-4">🎉 Game Over!</h3>
                    <p class="text-xl text-gray-600 mb-6">
                        Final Score: <strong class="text-red-800 text-2xl">${speedMatchScore}</strong> / ${speedMatchPlants.length}
                    </p>
                    <div class="space-y-3">
                        <button onclick="startSpeedMatchGame()" class="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                            🔄 Play Again
                        </button>
                        <button onclick="backToGameMenu()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                            🏠 Menu
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        const currentPlant = speedMatchPlants[speedMatchCurrentIndex];
        const imageUrl = currentPlant.image_url || currentPlant.images?.[0]?.url || PLACEHOLDER_IMG;
        const correctName = currentPlant.common_name || currentPlant.name || 'Unknown';

        const options = [correctName];
        while (options.length < 4) {
            const randomPlant = await getRandomGameItem();
            const randomName = randomPlant.common_name || randomPlant.name || 'Unknown';
            if (!options.includes(randomName)) {
                options.push(randomName);
            }
        }
        options.sort(() => Math.random() - 0.5);

        display.innerHTML = `
            <div class="text-center">
                <div class="flex justify-between items-center mb-6 max-w-2xl mx-auto">
                    <div class="text-gray-600">Score: <strong>${speedMatchScore}</strong></div>
                    <div class="text-gray-600">Time: <strong id="speed-timer">${speedMatchTimeLeft}</strong>s</div>
                    <div class="text-gray-600">${speedMatchCurrentIndex + 1} / ${speedMatchPlants.length}</div>
                </div>

                <h3 class="text-2xl font-bold text-red-800 mb-4">⚡ Match the Plant/Mushroom!</h3>
                
                <img src="${imageUrl}" alt="Plant" class="mx-auto rounded-lg shadow-lg max-w-xs w-full h-48 object-cover mb-6" onerror="handleImageError(this)">

                <div class="grid grid-cols-2 gap-4 mb-6 max-w-xl mx-auto">
                    ${options.map(name => `
                        <button onclick="selectSpeedMatchAnswer('${name.replace(/'/g, "\\'")}', '${correctName.replace(/'/g, "\\'")}', this)" 
                                class="bg-red-100 hover:bg-red-200 text-red-800 px-6 py-4 rounded-lg font-semibold transition-colors">
                            ${name}
                        </button>
                    `).join('')}
                </div>

                <button onclick="backToGameMenu()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold">
                    🏠 Menu
                </button>
            </div>
        `;

        if (speedMatchTimer) clearInterval(speedMatchTimer);
        speedMatchTimeLeft = 30;
        speedMatchTimer = setInterval(() => {
            speedMatchTimeLeft--;
            const timerEl = document.getElementById('speed-timer');
            if (timerEl) {
                timerEl.textContent = speedMatchTimeLeft;
                if (speedMatchTimeLeft <= 0) {
                    clearInterval(speedMatchTimer);
                    speedMatchCurrentIndex++;
                    showSpeedMatchRound();
                }
            }
        }, 1000);
    }

    function selectSpeedMatchAnswer(selected, correct, element) {
        clearInterval(speedMatchTimer);
        const options = document.querySelectorAll('button[onclick^="selectSpeedMatchAnswer"]');
        options.forEach(opt => opt.disabled = true);

        if (selected === correct) {
            element.classList.add('bg-green-500', 'text-white');
            element.classList.remove('bg-red-100', 'hover:bg-red-200', 'text-red-800');
            speedMatchScore++;
            setTimeout(() => {
                speedMatchCurrentIndex++;
                showSpeedMatchRound();
            }, 1000);
        } else {
            element.classList.add('bg-red-500', 'text-white');
            element.classList.remove('bg-red-100', 'hover:bg-red-200', 'text-red-800');
            options.forEach(opt => {
                if (opt.textContent.trim() === correct) {
                    opt.classList.add('bg-green-500', 'text-white');
                    opt.classList.remove('bg-red-100', 'hover:bg-red-200', 'text-red-800');
                }
            });
            setTimeout(() => {
                speedMatchCurrentIndex++;
                showSpeedMatchRound();
            }, 1500);
        }
    }

    // GAME 6: WORD SCRAMBLE
    async function startWordScrambleGame() {
        document.getElementById('game-menu').classList.add('hidden');
        showGameLoading();
        scrambleGameScore = 0;
        scrambleGameRound = 0;

        try {
            await showScrambleGameRound();
        } catch (error) {
            console.error('Error in startWordScrambleGame:', error);
            document.getElementById('game-display').innerHTML = `
                <div class="text-center py-20 text-red-600">
                    <p class="text-xl">Could not load word scramble game!</p>
                    <button onclick="backToGameMenu()" class="mt-4 bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg">
                        🏠 Menu
                    </button>
                </div>
            `;
        }
    }

    function scrambleWord(word) {
        const letters = word.split('');
        for (let i = letters.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [letters[i], letters[j]] = [letters[j], letters[i]];
        }
        return letters.join('').toUpperCase();
    }

    async function showScrambleGameRound() {
        scrambleGameRound++;
        scrambleGamePlant = await getRandomGameItem();
        const name = scrambleGamePlant.common_name || scrambleGamePlant.name || 'Unknown';
        scrambleGameScrambled = scrambleWord(name);

        const display = document.getElementById('game-display');
        if (!display) {
            console.error('game-display element not found');
            return;
        }
        display.classList.remove('hidden');
        const imageUrl = scrambleGamePlant.image_url || scrambleGamePlant.images?.[0]?.url || PLACEHOLDER_IMG;

        display.innerHTML = `
            <div class="text-center">
                <h3 class="text-2xl font-bold text-indigo-800 mb-4">🔤 Word Scramble - Round ${scrambleGameRound}</h3>
                <p class="text-gray-600 mb-6">Unscramble the plant/mushroom name!</p>
                
                <img src="${imageUrl}" alt="${name}" class="mx-auto rounded-lg shadow-lg max-w-md w-full h-64 object-cover mb-6" onerror="handleImageError(this)">

                <div class="mb-6">
                    <div class="text-3xl font-bold text-indigo-600 letter-spacing-wide mb-4 p-6 bg-indigo-50 rounded-lg max-w-md mx-auto">
                        ${scrambleGameScrambled}
                    </div>
                    <input type="text" 
                           id="scramble-input" 
                           placeholder="Unscramble the word..." 
                           autocomplete="off"
                           class="w-full max-w-md mx-auto px-6 py-4 text-xl border-3 border-indigo-600 rounded-lg text-center"
                           onkeydown="if(event.key === 'Enter') checkScrambleAnswer()">
                </div>

                <div id="scramble-feedback" class="min-h-[50px] mb-6"></div>

                <div class="mb-6">
                    <p class="text-gray-600">Score: <strong class="text-indigo-800">${scrambleGameScore}</strong> | Round: ${scrambleGameRound}</p>
                </div>

                <div class="space-y-3">
                    <button onclick="checkScrambleAnswer()" class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                        ✓ Check Answer
                    </button>
                    <button onclick="showScrambleGameRound()" class="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                        ⏭️ Skip
                    </button>
                    <button onclick="backToGameMenu()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                        🏠 Menu
                    </button>
                </div>
            </div>
        `;

        document.getElementById('scramble-input')?.focus();
    }

    function checkScrambleAnswer() {
        const input = document.getElementById('scramble-input');
        const feedback = document.getElementById('scramble-feedback');
        if (!input || !feedback || !scrambleGamePlant) return;

        const userInput = input.value.trim().toLowerCase();
        const correctName = (scrambleGamePlant.common_name || scrambleGamePlant.name || '').toLowerCase();

        if (userInput === correctName) {
            scrambleGameScore += 15;
            feedback.innerHTML = `
                <div class="bg-green-100 border-2 border-green-500 rounded-lg p-4 text-green-800">
                    ✅ Correct! "${input.value}" is right! (+15 points)
                </div>
            `;
            input.disabled = true;
            setTimeout(() => {
                showScrambleGameRound();
            }, 2000);
        } else {
            feedback.innerHTML = `
                <div class="bg-red-100 border-2 border-red-500 rounded-lg p-4 text-red-800">
                    ❌ Incorrect. Try again!
                </div>
            `;
        }
    }

    // GAME 7: TRUE OR FALSE
    async function startTrueFalseGame() {
        document.getElementById('game-menu').classList.add('hidden');
        showGameLoading();
        trueFalseScore = 0;
        trueFalseRound = 0;

        try {
            await showTrueFalseRound();
        } catch (error) {
            console.error('Error in startTrueFalseGame:', error);
            document.getElementById('game-display').innerHTML = `
                <div class="text-center py-20 text-red-600">
                    <p class="text-xl">Could not load true/false game!</p>
                    <button onclick="backToGameMenu()" class="mt-4 bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg">
                        🏠 Menu
                    </button>
                </div>
            `;
        }
    }

    async function showTrueFalseRound() {
        trueFalseRound++;
        trueFalsePlant = await getRandomGameItem();
        const name = trueFalsePlant.common_name || trueFalsePlant.name || 'Unknown';

        const statements = [
            { text: `The ${name} is a real plant/mushroom species.`, answer: true },
            { text: `The ${name} is a mammal.`, answer: false },
            { text: `The ${name} is poisonous.`, answer: Math.random() > 0.5 },
            { text: `The ${name} can be grown indoors.`, answer: Math.random() > 0.4 },
            { text: `The ${name} is extinct.`, answer: false },
            { text: `The ${name} is a type of animal.`, answer: false },
        ];

        const selected = statements[Math.floor(Math.random() * statements.length)];
        trueFalseStatement = selected.text;
        trueFalseAnswer = selected.answer;

        const display = document.getElementById('game-display');
        if (!display) {
            console.error('game-display element not found');
            return;
        }
        display.classList.remove('hidden');
        const imageUrl = trueFalsePlant.image_url || trueFalsePlant.images?.[0]?.url || PLACEHOLDER_IMG;

        display.innerHTML = `
            <div class="text-center">
                <h3 class="text-2xl font-bold text-pink-800 mb-4">✓ True or False - Round ${trueFalseRound}</h3>
                <p class="text-gray-600 mb-6">Is this statement true or false?</p>
                
                <img src="${imageUrl}" alt="${name}" class="mx-auto rounded-lg shadow-lg max-w-xs w-full h-48 object-cover mb-6" onerror="handleImageError(this)">

                <div class="bg-pink-50 border-2 border-pink-500 rounded-lg p-6 mb-6 max-w-2xl mx-auto">
                    <p class="text-xl font-semibold text-gray-800">${trueFalseStatement}</p>
                </div>

                <div class="flex gap-4 justify-center mb-6">
                    <button onclick="selectTrueFalse(true)" 
                            class="bg-green-600 hover:bg-green-700 text-white px-8 py-4 rounded-lg font-bold text-xl">
                        ✓ TRUE
                    </button>
                    <button onclick="selectTrueFalse(false)" 
                            class="bg-red-600 hover:bg-red-700 text-white px-8 py-4 rounded-lg font-bold text-xl">
                        ✗ FALSE
                    </button>
                </div>

                <div id="truefalse-feedback" class="min-h-[50px] mb-6"></div>

                <div class="mb-6">
                    <p class="text-gray-600">Score: <strong class="text-pink-800">${trueFalseScore}</strong> | Round: ${trueFalseRound}</p>
                </div>

                <button onclick="backToGameMenu()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold" id="truefalse-next" style="display: none;">
                    ⏭️ Next Question
                </button>
            </div>
        `;
    }

    function selectTrueFalse(selected) {
        const feedback = document.getElementById('truefalse-feedback');
        const nextBtn = document.getElementById('truefalse-next');
        const buttons = document.querySelectorAll('button[onclick^="selectTrueFalse"]');
        
        buttons.forEach(btn => btn.disabled = true);
        
        if (selected === trueFalseAnswer) {
            trueFalseScore += 10;
            feedback.innerHTML = `
                <div class="bg-green-100 border-2 border-green-500 rounded-lg p-4 text-green-800">
                    ✅ Correct! (+10 points)
                </div>
            `;
        } else {
            feedback.innerHTML = `
                <div class="bg-red-100 border-2 border-red-500 rounded-lg p-4 text-red-800">
                    ❌ Incorrect. The answer is ${trueFalseAnswer ? 'TRUE' : 'FALSE'}.
                </div>
            `;
        }
        
        if (nextBtn) nextBtn.style.display = 'block';
        setTimeout(() => {
            showTrueFalseRound();
        }, 2000);
    }

    // GAME 8: ALPHABET CHALLENGE
    async function startAlphabetGame() {
        const menu = document.getElementById('game-menu');
        if (menu) menu.classList.add('hidden');
        showGameLoading();
        alphabetScore = 0;
        alphabetRound = 0;

        try {
            await showAlphabetRound();
        } catch (error) {
            console.error('Error in startAlphabetGame:', error);
            const display = document.getElementById('game-display');
            if (display) {
                display.classList.remove('hidden');
                display.innerHTML = `
                    <div class="text-center py-20 text-red-600">
                        <p class="text-xl">Could not load alphabet game!</p>
                        <button onclick="backToGameMenu()" class="mt-4 bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg">
                            🏠 Menu
                        </button>
                    </div>
                `;
            }
        }
    }

    async function showAlphabetRound() {
        alphabetRound++;
        alphabetLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26));

        // Get plants/mushrooms starting with that letter
        alphabetPlants = [];
        for (let i = 0; i < 20; i++) {
            try {
                const plant = await getRandomGameItem();
                if (!plant) continue;
                const name = (plant.common_name || plant.name || '').toUpperCase();
                if (name && name.startsWith(alphabetLetter) && !alphabetPlants.find(p => (p.common_name || p.name) === (plant.common_name || plant.name))) {
                    alphabetPlants.push(plant);
                    if (alphabetPlants.length >= 10) break;
                }
            } catch (error) {
                continue;
            }
        }

        // If no plants found, try another letter
        if (alphabetPlants.length === 0) {
            alphabetLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
            for (let i = 0; i < 20; i++) {
                try {
                    const plant = await getRandomGameItem();
                    if (!plant) continue;
                    const name = (plant.common_name || plant.name || '').toUpperCase();
                    if (name.startsWith(alphabetLetter) && !alphabetPlants.find(p => (p.common_name || p.name) === (plant.common_name || plant.name))) {
                        alphabetPlants.push(plant);
                        if (alphabetPlants.length >= 10) break;
                    }
                } catch (error) {
                    continue;
                }
            }
        }

        // If still no plants found, try a few common letters or use any plant
        if (alphabetPlants.length === 0) {
            // Try common starting letters
            const commonLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'L', 'M', 'O', 'P', 'R', 'S', 'T'];
            for (const letter of commonLetters) {
                alphabetLetter = letter;
                for (let i = 0; i < 10; i++) {
                    try {
                        const plant = await getRandomGameItem();
                        if (!plant) continue;
                        const name = (plant.common_name || plant.name || '').toUpperCase();
                        if (name.startsWith(alphabetLetter) && !alphabetPlants.find(p => (p.common_name || p.name) === (plant.common_name || plant.name))) {
                            alphabetPlants.push(plant);
                            if (alphabetPlants.length >= 5) break;
                        }
                    } catch (error) {
                        continue;
                    }
                }
                if (alphabetPlants.length > 0) break;
            }
        }

        // If still no plants, just use any random plant (fallback)
        if (alphabetPlants.length === 0) {
            try {
                const fallbackPlant = await getRandomGameItem();
                if (fallbackPlant) {
                    alphabetPlants.push(fallbackPlant);
                    alphabetLetter = (fallbackPlant.common_name || fallbackPlant.name || 'A').toUpperCase().charAt(0);
                }
            } catch (error) {
                console.error('Failed to get fallback plant:', error);
            }
        }

        // Final check - if still no plants, show error
        if (alphabetPlants.length === 0) {
            const display = document.getElementById('game-display');
            if (display) {
                display.classList.remove('hidden');
                display.innerHTML = `
                    <div class="text-center py-20 text-red-600">
                        <p class="text-xl">Could not find any plants/mushrooms. Please try again!</p>
                        <button onclick="backToGameMenu()" class="mt-4 bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg">
                            🏠 Menu
                        </button>
                    </div>
                `;
            }
            return;
        }

        const randomPlant = alphabetPlants[Math.floor(Math.random() * alphabetPlants.length)];
        if (!randomPlant) {
            console.error('randomPlant is undefined');
            showAlphabetRound(); // Try again
            return;
        }

        const display = document.getElementById('game-display');
        if (!display) {
            console.error('game-display element not found');
            return;
        }
        display.classList.remove('hidden');
        const imageUrl = randomPlant.image_url || randomPlant.images?.[0]?.url || PLACEHOLDER_IMG;

        display.innerHTML = `
            <div class="text-center">
                <h3 class="text-2xl font-bold text-teal-800 mb-4">🔤 Alphabet Challenge - Round ${alphabetRound}</h3>
                <p class="text-gray-600 mb-6">Name a plant/mushroom that starts with the letter:</p>
                
                <div class="text-6xl font-bold text-teal-600 mb-6">${alphabetLetter}</div>
                
                <img src="${imageUrl}" alt="Plant" class="mx-auto rounded-lg shadow-lg max-w-xs w-full h-48 object-cover mb-6" onerror="handleImageError(this)">

                <div class="mb-6">
                    <input type="text" 
                           id="alphabet-input" 
                           placeholder="Type plant/mushroom name starting with ${alphabetLetter}..." 
                           autocomplete="off"
                           class="w-full max-w-md mx-auto px-6 py-4 text-xl border-3 border-teal-600 rounded-lg text-center"
                           onkeydown="if(event.key === 'Enter') checkAlphabetAnswer()">
                </div>

                <div id="alphabet-feedback" class="min-h-[50px] mb-6"></div>

                <div class="mb-6">
                    <p class="text-gray-600">Score: <strong class="text-teal-800">${alphabetScore}</strong> | Round: ${alphabetRound}</p>
                    ${alphabetPlants.length > 0 ? `<p class="text-sm text-gray-500 mt-2">Examples: ${alphabetPlants.slice(0, 3).map(p => p.common_name || p.name).join(', ')}</p>` : ''}
                </div>

                <div class="space-y-3">
                    <button onclick="checkAlphabetAnswer()" class="bg-teal-600 hover:bg-teal-700 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                        ✓ Check Answer
                    </button>
                    <button onclick="showAlphabetRound()" class="bg-teal-500 hover:bg-teal-600 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                        ⏭️ Next Letter
                    </button>
                    <button onclick="backToGameMenu()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                        🏠 Menu
                    </button>
                </div>
            </div>
        `;

        document.getElementById('alphabet-input')?.focus();
    }

    function checkAlphabetAnswer() {
        const input = document.getElementById('alphabet-input');
        const feedback = document.getElementById('alphabet-feedback');
        if (!input || !feedback) return;

        const userInput = input.value.trim();
        if (!userInput) {
            feedback.innerHTML = `<div class="text-gray-600">Please enter a plant/mushroom name.</div>`;
            return;
        }

        const userUpper = userInput.toUpperCase();
        const isValid = userUpper.startsWith(alphabetLetter) && 
                       alphabetPlants.some(plant => (plant.common_name || plant.name || '').toUpperCase() === userUpper);

        if (isValid) {
            alphabetScore += 15;
            feedback.innerHTML = `
                <div class="bg-green-100 border-2 border-green-500 rounded-lg p-4 text-green-800">
                    ✅ Correct! "${userInput}" is a valid plant/mushroom! (+15 points)
                </div>
            `;
            input.disabled = true;
            setTimeout(() => {
                showAlphabetRound();
            }, 2000);
        } else {
            feedback.innerHTML = `
                <div class="bg-red-100 border-2 border-red-500 rounded-lg p-4 text-red-800">
                    ❌ Incorrect. Make sure the name starts with "${alphabetLetter}" and is a real plant/mushroom from our database.
                </div>
            `;
        }
    }

    // GAME 9: FLASH CARDS
    async function startFlashCardGame() {
        document.getElementById('game-menu').classList.add('hidden');
        showGameLoading();
        flashCardIndex = 0;
        flashCardPlants = [];

        try {
            for (let i = 0; i < 20; i++) {
                flashCardPlants.push(await getRandomGameItem());
            }
            await showFlashCard();
        } catch (error) {
            console.error('Error in startFlashCardGame:', error);
            document.getElementById('game-display').innerHTML = `
                <div class="text-center py-20 text-red-600">
                    <p class="text-xl">Could not load flash cards!</p>
                    <button onclick="backToGameMenu()" class="mt-4 bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg">
                        🏠 Menu
                    </button>
                </div>
            `;
        }
    }

    let flashCardFlipped = false;

    async function showFlashCard() {
        const display = document.getElementById('game-display');
        if (!display) {
            console.error('game-display element not found');
            return;
        }
        display.classList.remove('hidden');

        if (flashCardIndex >= flashCardPlants.length) {
            display.innerHTML = `
                <div class="text-center py-20">
                    <h3 class="text-3xl font-bold text-orange-800 mb-4">🎉 All Done!</h3>
                    <p class="text-xl text-gray-600 mb-6">You've reviewed all ${flashCardPlants.length} flash cards!</p>
                    <div class="space-y-3">
                        <button onclick="startFlashCardGame()" class="bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                            🔄 New Set
                        </button>
                        <button onclick="backToGameMenu()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold w-full max-w-xs mx-auto block">
                            🏠 Menu
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        flashCardFlipped = false;
        const plant = flashCardPlants[flashCardIndex];
        const imageUrl = plant.image_url || plant.images?.[0]?.url || PLACEHOLDER_IMG;
        const name = plant.common_name || plant.name || 'Unknown';
        const sciName = plant.scientific_name || plant.scientificName || '';

        display.innerHTML = `
            <div class="text-center">
                <h3 class="text-2xl font-bold text-orange-800 mb-4">🃏 Flash Cards</h3>
                <p class="text-gray-600 mb-2">Card ${flashCardIndex + 1} of ${flashCardPlants.length}</p>
                
                <div class="mb-6">
                    <div id="flash-card" class="bg-orange-100 border-4 border-orange-600 rounded-lg p-8 max-w-md mx-auto cursor-pointer transform transition-transform hover:scale-105" onclick="flipFlashCard()">
                        <div id="flash-front">
                            <img src="${imageUrl}" alt="${name}" class="mx-auto rounded-lg shadow-lg max-w-sm w-full h-64 object-cover mb-4" onerror="handleImageError(this)">
                            <p class="text-gray-600 text-sm">Click to reveal name</p>
                        </div>
                        <div id="flash-back" class="hidden">
                            <div class="text-3xl font-bold text-orange-800 mb-2">${name}</div>
                            ${sciName ? `<div class="text-lg italic text-gray-600">${sciName}</div>` : ''}
                        </div>
                    </div>
                </div>

                <div class="flex gap-4 justify-center mb-6">
                    <button onclick="previousFlashCard()" ${flashCardIndex === 0 ? 'disabled class="bg-gray-300 text-gray-500 px-4 py-2 rounded-lg cursor-not-allowed"' : 'class="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg"'} >
                        ← Previous
                    </button>
                    <button onclick="flipFlashCard()" class="bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-lg font-semibold">
                        ${flashCardFlipped ? '👁️ Show Image' : '👁️ Show Name'}
                    </button>
                    <button onclick="nextFlashCard()" class="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg">
                        Next →
                    </button>
                </div>

                <button onclick="backToGameMenu()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold">
                    🏠 Menu
                </button>
            </div>
        `;
    }

    function flipFlashCard() {
        const front = document.getElementById('flash-front');
        const back = document.getElementById('flash-back');
        if (front && back) {
            flashCardFlipped = !flashCardFlipped;
            if (flashCardFlipped) {
                front.classList.add('hidden');
                back.classList.remove('hidden');
            } else {
                front.classList.remove('hidden');
                back.classList.add('hidden');
            }
        }
    }

    function nextFlashCard() {
        flashCardIndex++;
        showFlashCard();
    }

    function previousFlashCard() {
        if (flashCardIndex > 0) {
            flashCardIndex--;
            showFlashCard();
        }
    }

    // Expose game functions globally for onclick handlers
    window.startGuessGame = startGuessGame;
    window.startMemoryGame = startMemoryGame;
    window.startQuizGame = startQuizGame;
    window.startTypingGame = startTypingGame;
    window.startSpeedMatchGame = startSpeedMatchGame;
    window.startWordScrambleGame = startWordScrambleGame;
    window.startTrueFalseGame = startTrueFalseGame;
    window.startAlphabetGame = startAlphabetGame;
    window.startFlashCardGame = startFlashCardGame;
    window.backToGameMenu = backToGameMenu;
    window.toggleBlur = toggleBlur;
    window.revealGuessAnswer = revealGuessAnswer;
    window.flipMemoryCard = flipMemoryCard;
    window.selectQuizAnswer = selectQuizAnswer;
    window.checkTypingAnswer = checkTypingAnswer;
    window.selectSpeedMatchAnswer = selectSpeedMatchAnswer;
    window.checkScrambleAnswer = checkScrambleAnswer;
    window.showScrambleGameRound = showScrambleGameRound;
    window.selectTrueFalse = selectTrueFalse;
    window.showTrueFalseRound = showTrueFalseRound;
    window.checkAlphabetAnswer = checkAlphabetAnswer;
    window.showAlphabetRound = showAlphabetRound;
    window.flipFlashCard = flipFlashCard;
    window.nextFlashCard = nextFlashCard;
    window.previousFlashCard = previousFlashCard;
    window.showTypingGameRound = showTypingGameRound;
    window.showSpeedMatchRound = showSpeedMatchRound;
    window.showFlashCard = showFlashCard;

    // Attach event listeners to game menu buttons
    document.getElementById('btn-guess-game')?.addEventListener('click', startGuessGame);
    document.getElementById('btn-memory-game')?.addEventListener('click', startMemoryGame);
    document.getElementById('btn-quiz-game')?.addEventListener('click', startQuizGame);
    document.getElementById('btn-typing-game')?.addEventListener('click', startTypingGame);
    document.getElementById('btn-speed-match-game')?.addEventListener('click', startSpeedMatchGame);
    document.getElementById('btn-scramble-game')?.addEventListener('click', startWordScrambleGame);
    document.getElementById('btn-truefalse-game')?.addEventListener('click', startTrueFalseGame);
    document.getElementById('btn-alphabet-game')?.addEventListener('click', startAlphabetGame);
    document.getElementById('btn-flashcard-game')?.addEventListener('click', startFlashCardGame);
});
