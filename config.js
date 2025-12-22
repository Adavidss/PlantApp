// ========================================
// API KEYS (Required)
// ========================================
const PERENUAL_API_KEY = "sk-FZ1q6935dcd53ff6513860"; // User-provided key
const TREFLE_API_KEY = "usr-bAHOHLtY_IMjLNcBIYnecNj4KnRjWBus5GBAAD15O84"; // Get from https://trefle.io
const MUSHROOM_OBSERVER_API_KEY = "iupgps0cr5iczgbgqvjo8biis8jnp6jp"; // Mushroom Observer API key (optional for read-only GET requests)

// ========================================
// APIs WITHOUT KEYS (Read-only access)
// ========================================
// Toxic Shrooms API - No authentication required
// Base URL: https://toxicshrooms.vercel.app/api/mushrooms
// Example: GET https://toxicshrooms.vercel.app/api/mushrooms

// GBIF API - No authentication required for read-only
// Base URL: https://api.gbif.org/v1/
// Example: GET https://api.gbif.org/v1/species/match?name=Passer%20domesticus

// iNaturalist API - No authentication required for read-only
// Base URL: https://api.inaturalist.org/v1/
// Example: GET https://api.inaturalist.org/v1/taxa?q=query
