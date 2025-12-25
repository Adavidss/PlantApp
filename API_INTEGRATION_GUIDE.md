# API Integration Guide

This document provides detailed information about all integrated APIs and how they are used in the Plant & Fungi Browser application.

---

## Table of Contents
1. [API Overview](#api-overview)
2. [Plant APIs](#plant-apis)
3. [Fungi/Mushroom APIs](#fungimushroom-apis)
4. [AI Enhancement](#ai-enhancement)
5. [Configuration](#configuration)
6. [Usage Examples](#usage-examples)
7. [Troubleshooting](#troubleshooting)

---

## API Overview

The application integrates **7 different APIs** to provide comprehensive plant and fungi data:

| API | Type | Authentication | Cost | Status |
|-----|------|----------------|------|--------|
| Perenual | Plant Database | API Key Required | Free tier available | ✅ Active |
| Trefle | Plant Database | API Key Required | Free | ⚠️ Optional |
| iNaturalist | Biodiversity | Optional OAuth | Free | ✅ Active |
| GBIF | Biodiversity | None for read | Free | ✅ Active |
| Toxic Shrooms | Mushroom Toxicity | None | Free | ✅ Active |
| Mushroom Observer | Mushroom Observations | API Key for writes | Free | ✅ Active |
| Google Gemini | AI Generation | API Key Required | Free tier available | ✅ Active |

---

## Plant APIs

### 1. Perenual API

**Base URL:** `https://perenual.com/api/v2`

**Purpose:** Primary plant database with detailed care information

**Data Coverage:**
- 10,000+ plant species
- Detailed care requirements (watering, sunlight, soil)
- Disease and pest information
- Growth characteristics
- Hardiness zones

**Endpoints Used:**
```javascript
// Search plants
GET /species-list?key={API_KEY}&page={page}&q={query}

// Get plant details
GET /species/details/{id}?key={API_KEY}

// Get disease/pest info
GET /pest-disease-list?key={API_KEY}&q={query}
```

**Required:** Yes (primary data source)

**Get API Key:** [https://perenual.com/docs/api](https://perenual.com/docs/api)

---

### 2. Trefle API

**Base URL:** `https://trefle.io/api/v1`

**Purpose:** Comprehensive plant database with 1M+ plants

**Data Coverage:**
- 1,000,000+ total plants
- 422,511 species
- 28,478 varieties
- 29,918 sub-species
- 7,788 hybrids
- Taxonomic information
- Native/introduced status

**Endpoints Used:**
```javascript
// Search plants
GET /plants/search?token={API_KEY}&q={query}&page={page}

// Get plant details
GET /plants/{id}?token={API_KEY}
```

**Required:** No (optional enhancement)

**Get API Key:** [https://trefle.io](https://trefle.io)

**Enable in Code:**
```javascript
const API_SOURCES = {
    trefle: { enabled: true, name: "Trefle" }, // Change to true
};
const TREFLE_API_KEY = "your_actual_key_here";
```

---

### 3. iNaturalist API

**Base URL:** `https://api.inaturalist.org/v1`

**Purpose:** Community-driven biodiversity observations

**Data Coverage:**
- Millions of species observations
- Community identifications
- High-quality images
- Geographic data
- Taxonomic information
- Conservation status

**Endpoints Used:**
```javascript
// Search taxa (plants, fungi, etc.)
GET /taxa?q={query}&page={page}&per_page=30

// Search taxa by kingdom (e.g., Fungi = 47170)
GET /taxa?q={query}&taxon_id=47170

// Get observations
GET /observations?taxon_id={id}&page={page}
```

**Authentication:** Not required for read-only access

**Documentation:** [https://api.inaturalist.org/v1/docs/](https://api.inaturalist.org/v1/docs/)

---

### 4. GBIF API

**Base URL:** `https://api.gbif.org/v1`

**Purpose:** Global Biodiversity Information Facility - comprehensive taxonomy

**Data Coverage:**
- Complete taxonomic hierarchy
- Global species occurrences
- Scientific names and synonyms
- Distribution data
- Conservation status

**Endpoints Used:**
```javascript
// Search species
GET /species/search?q={query}&offset={offset}&limit=20

// Get species details
GET /species/{key}
```

**Authentication:** Not required for read-only access

**Documentation:** [https://techdocs.gbif.org/en/openapi/](https://techdocs.gbif.org/en/openapi/)

---

## Fungi/Mushroom APIs

### 5. Toxic Shrooms API

**Base URL:** `https://toxicshrooms.vercel.app/api`

**Purpose:** Database of toxic and deadly mushrooms

**Data Coverage:**
- Poisonous mushrooms
- Deadly mushrooms
- Toxic agents/compounds
- Geographic distribution
- Images from Wikipedia

**Endpoints Used:**
```javascript
// Get all toxic mushrooms
GET /mushrooms

// Filter by toxicity level
GET /mushrooms/deadly
GET /mushrooms/poisonous

// Random mushroom with image
GET /mushrooms/randompic

// Random mushroom
GET /mushrooms/randomshroom
```

**Authentication:** None required

**Data Source:** Wikipedia articles on poisonous/deadly fungi

---

### 6. Mushroom Observer API

**Base URL:** `https://mushroomobserver.org/api2`

**Purpose:** Community mushroom observations and identifications

**Data Coverage:**
- Mushroom observations with photos
- Location data
- Observer information
- Confidence ratings
- Scientific names

**Endpoints Used:**
```javascript
// Search observations
GET /observations?format=json&detail=high&has_name={query}&page={page}
```

**Authentication:**
- Not required for GET requests (read-only)
- API key required for POST/PATCH/DELETE

**Rate Limits:** 20 requests per minute for anonymous users

**Documentation:** [https://github.com/MushroomObserver/mushroom-observer/blob/main/README_API.md](https://github.com/MushroomObserver/mushroom-observer/blob/main/README_API.md)

---

## AI Enhancement

### 7. Google Gemini API

**Base URL:** `https://generativelanguage.googleapis.com/v1beta`

**Purpose:** Generate AI-powered plant personalities

**Model Used:** `gemini-pro`

**Endpoint Used:**
```javascript
POST /models/gemini-pro:generateContent?key={API_KEY}
```

**What It Does:**
- Analyzes plant characteristics
- Creates whimsical personality descriptions
- Generates mood alignments
- Provides metaphorical care tips
- Creates supportive quotes

**Required:** Yes (for personality feature)

**Get API Key:** [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)

---

## Configuration

### API Keys Setup

1. **Edit `script.js`** and update these constants:

```javascript
const PERENUAL_API_KEY = "your_perenual_key_here";
const GEMINI_API_KEY = "your_gemini_key_here";
const TREFLE_API_KEY = "your_trefle_key_here"; // Optional
```

2. **Enable/Disable APIs:**

```javascript
const API_SOURCES = {
    perenual: { enabled: true, name: "Perenual" },      // Required
    trefle: { enabled: false, name: "Trefle" },         // Optional
    inaturalist: { enabled: true, name: "iNaturalist" }, // No key needed
    gbif: { enabled: true, name: "GBIF" },              // No key needed
    toxicshrooms: { enabled: true, name: "Toxic Shrooms" }, // No key needed
    mushroomobserver: { enabled: true, name: "Mushroom Observer" } // No key needed
};
```

### Performance Tuning

The application includes built-in optimizations:

```javascript
// Cache total plants count (24-hour TTL)
async function getTotalPlantsCount() {
    const cached = localStorage.getItem('totalPlantsCount');
    const cacheTime = localStorage.getItem('totalPlantsCacheTime');
    // ... returns cached value if < 24 hours old
}

// Retry logic with reduced attempts
async function getPlantDetails(plantId, retries = 2) {
    // ... 2 retry attempts with 500ms delay
}
```

---

## Usage Examples

### Multi-Source Plant Search

```javascript
// Search across all enabled APIs
const results = await multiSourceSearch("rose", {
    includePerenual: true,
    includeTrefle: true,
    includeINaturalist: true,
    includeGBIF: true,
    includeFungi: false
});

// Results structure:
{
    perenual: [...plants from Perenual],
    trefle: [...plants from Trefle],
    inaturalist: [...taxa from iNaturalist],
    gbif: [...species from GBIF],
    total: 150
}

// Combine and deduplicate
const combined = combineSearchResults(results);
```

### Fungi-Only Search

```javascript
// Search only fungi databases
const fungiResults = await multiSourceSearch("amanita", {
    includePerenual: false,
    includeTrefle: false,
    includeINaturalist: true,
    includeGBIF: true,
    includeFungi: true  // Filter iNaturalist to Fungi kingdom (47170)
});
```

### Toxic Mushrooms

```javascript
// Get all toxic mushrooms
const allToxic = await getToxicShrooms();

// Get only deadly
const deadly = await getToxicShrooms('deadly');

// Get only poisonous
const poisonous = await getToxicShrooms('poisonous');

// Random mushroom
const random = await getRandomToxicShroom();
```

### Data Formatting

Each API has a formatter function to standardize data:

```javascript
// Trefle data
formatTrefleData(data) -> {
    id, source, common_name, scientific_name,
    description, image_url, family, genus,
    vegetable, edible, native, ...
}

// iNaturalist data
formatINaturalistData(taxon) -> {
    id, source, common_name, scientific_name,
    description, image_url, rank, observations_count,
    endemic, threatened, introduced, ...
}

// GBIF data
formatGBIFData(data) -> {
    id, source, common_name, scientific_name,
    kingdom, phylum, class, order, family, genus,
    taxonomic_status, num_occurrences, ...
}

// Toxic Shrooms data
formatToxicShroomData(data) -> {
    id, source, common_name, scientific_name,
    toxicity_type, toxic_agent, distribution, ...
}
```

---

## Troubleshooting

### Common Issues

#### 1. API Key Errors

**Symptom:** Console errors like "API request failed: 401" or "403"

**Solution:**
- Verify API keys are correct
- Check that keys haven't expired
- Ensure keys have proper permissions

#### 2. CORS Errors

**Symptom:** "Access-Control-Allow-Origin" errors

**Solution:**
- Run a local server (not opening HTML directly)
- Use `python3 -m http.server` or similar
- All integrated APIs support CORS for browser requests

#### 3. No Results Returned

**Symptom:** Empty results from searches

**Solution:**
- Check if API is enabled in `API_SOURCES`
- Verify internet connection
- Check browser console for error messages
- Try different search terms

#### 4. Slow Performance

**Symptom:** Searches taking too long

**Solution:**
- Disable unused APIs in `API_SOURCES`
- Check network connection speed
- Clear localStorage cache (Dev panel: Option+T)
- Reduce number of parallel API calls

#### 5. Trefle API Not Working

**Symptom:** No Trefle results even with key

**Solution:**
- Ensure `API_SOURCES.trefle.enabled = true`
- Verify API key is not "YOUR_TREFLE_KEY"
- Check Trefle API status
- Trefle may have rate limits - wait a moment

### Rate Limits

| API | Limit | Reset Period |
|-----|-------|--------------|
| Perenual | Varies by plan | Daily |
| Trefle | 120 req/min | Minute |
| iNaturalist | None (be reasonable) | - |
| GBIF | None | - |
| Toxic Shrooms | None | - |
| Mushroom Observer | 20 req/min (anonymous) | Minute |
| Gemini | 60 req/min (free tier) | Minute |

### Debug Mode

Enable developer mode to troubleshoot:

1. Press **Option+T** (or Alt+T)
2. View current state and API statuses
3. Check localStorage usage
4. Monitor performance metrics
5. Clear cache if needed

---

## API Status Checks

### Check if APIs are Working

Open browser console and test:

```javascript
// Test Perenual
fetch('https://perenual.com/api/v2/species-list?key=YOUR_KEY&page=1')
    .then(r => r.json())
    .then(console.log);

// Test iNaturalist
fetch('https://api.inaturalist.org/v1/taxa?q=rose')
    .then(r => r.json())
    .then(console.log);

// Test GBIF
fetch('https://api.gbif.org/v1/species/search?q=rose')
    .then(r => r.json())
    .then(console.log);

// Test Toxic Shrooms
fetch('https://toxicshrooms.vercel.app/api/mushrooms')
    .then(r => r.json())
    .then(console.log);
```

---

## Best Practices

1. **API Keys Security:**
   - Never commit API keys to public repositories
   - Use environment variables in production
   - Rotate keys regularly

2. **Rate Limiting:**
   - Implement retry logic with exponential backoff
   - Cache frequently accessed data
   - Disable unused APIs to reduce calls

3. **Error Handling:**
   - Always wrap API calls in try/catch
   - Provide fallback data when possible
   - Show user-friendly error messages

4. **Performance:**
   - Use Promise.all() for parallel requests
   - Implement caching strategies
   - Lazy load images
   - Debounce search inputs

5. **Data Quality:**
   - Validate API responses before use
   - Handle missing/null values gracefully
   - Standardize data formats across sources
   - Deduplicate results when combining sources

---

## Further Reading

- [Perenual API Documentation](https://perenual.com/docs/api)
- [Trefle API Documentation](https://docs.trefle.io)
- [iNaturalist API Reference](https://www.inaturalist.org/pages/api+reference)
- [GBIF API Documentation](https://techdocs.gbif.org/en/openapi/)
- [Mushroom Observer API](https://github.com/MushroomObserver/mushroom-observer/blob/main/README_API.md)
- [Google Gemini API](https://ai.google.dev/docs)
