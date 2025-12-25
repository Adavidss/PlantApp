# Plant & Fungi Browser - Discover, Explore, and Identify

A comprehensive plant and fungi discovery application with AI-generated personalities and multi-database integration. Browse over **1 million+ species** from multiple authoritative databases including plants, mushrooms, and fungi with advanced search, filtering, and identification features.

Built with **6 integrated APIs**: Perenual, Trefle, iNaturalist, GBIF, Toxic Shrooms Database, Mushroom Observer, and **Google Gemini AI**.

---

## **🌟 New Features**

### 🍄 **Fungi & Mushroom Tab**
- Dedicated fungi and mushroom exploration interface
- Search across iNaturalist and GBIF fungi databases
- Toxic mushroom database with deadly/poisonous classifications
- Toxicity information with toxic agents and distribution
- Mushroom observations from global community
- Random mushroom discovery feature

### 🌍 **Multi-Database Search**
- Search across **6 different plant and fungi databases** simultaneously
- Toggle between single-source (Perenual) and multi-source search
- Combine results from:
  - **Perenual** - 10,000+ plant species with care information
  - **Trefle** - 1M+ plants, 422,000+ species (when API key added)
  - **iNaturalist** - Community observations and species identifications
  - **GBIF** - Global Biodiversity Information Facility
  - **Toxic Shrooms** - Mushroom toxicity database
  - **Mushroom Observer** - Mushroom observations and images

### 📊 **Enhanced Data Display**
- Source badges showing which database each result comes from
- Taxonomic information (Kingdom, Phylum, Class, Order, Family, Genus)
- Observation counts and community data
- Geographic distribution and endemic species indicators
- Threatened and introduced species warnings
- Wikipedia integration for additional information

---

## **Features**

### 🏠 Home Tab - Plant of the Day
- Discover random plants with AI-generated personalities
- Get whimsical plant personality descriptions and care tips
- Add plants to your favorites collection
- Beautiful, centered interface perfect for daily plant discovery
- **Optimized performance**: Loads in 1-2 seconds (down from 5-10s)

### 🔍 Browse Tab - Advanced Plant Browser
- **Search** by plant name across multiple databases
- **Multi-source toggle** to search all databases simultaneously
- **Filter** by:
  - Plant type (Edible, Poisonous, Indoor)
  - Life cycle (Perennial, Annual, Biennial)
  - Watering needs (Frequent, Average, Minimum, None)
  - Sunlight requirements (Full Sun, Part Shade, Full Shade)
- **Grid view** with source-tagged plant cards
- **Pagination** for single-source results
- **Detail panel** with 4 tabs:
  - **Info:** Description, type, growth rate, flowering info, origin, taxonomy
  - **Care:** Watering schedule, sunlight, soil, propagation, hardiness zones
  - **Personality:** AI-generated personality profile
  - **Pests:** Disease and pest information

### 🍄 Fungi Tab - Mushroom & Fungi Explorer
- **Search fungi** across iNaturalist and GBIF databases
- **Toxic mushroom database** with filtering:
  - View all toxic mushrooms
  - Filter by deadly mushrooms only
  - Filter by poisonous mushrooms only
- **Random mushroom** discovery feature
- **Detailed toxicity information** including:
  - Toxic agents and compounds
  - Geographic distribution
  - Lethality classification
- **Community observations** with location and observer data
- **Taxonomic details** for scientific identification

### ⭐ Favorites Tab
- Save your favorite plants and fungi
- Click any favorite to view full details
- Persists across sessions with localStorage

---

## **Integrated APIs**

### Plant Databases
1. **Perenual API** - 10,000+ species with detailed care information
2. **Trefle API** - 1M+ plants, 422,000+ species (optional, requires API key)
3. **iNaturalist API** - Community observations, species ID, images
4. **GBIF API** - Global biodiversity database with taxonomy

### Fungi/Mushroom Databases
5. **Toxic Shrooms API** - Comprehensive mushroom toxicity database
6. **Mushroom Observer API** - Community mushroom observations

### AI Enhancement
7. **Google Gemini API** - AI-generated plant personalities

---

## **How to Run Locally**

### **Prerequisites**

*   A modern web browser (Chrome, Firefox, Safari)
*   **Google Gemini API Key** - Get one from [Google AI Studio](https://aistudio.google.com/app/apikey)
*   **Perenual API Key** - Get one from [Perenual.com](https://perenual.com/docs/api)
*   **Trefle API Key** (Optional) - Get one from [Trefle.io](https://trefle.io)

### **Setup**

1.  **Edit `script.js`:**
    *   Open the `script.js` file in a text editor
    *   Update these lines with your API keys:
        ```javascript
        const PERENUAL_API_KEY = "YOUR_PERENUAL_KEY";
        const GEMINI_API_KEY = "YOUR_GEMINI_KEY";
        const TREFLE_API_KEY = "YOUR_TREFLE_KEY"; // Optional
        ```

    > **Security Warning:** Do not commit API keys to public repositories. This setup is for local development only.

2.  **Enable/Disable Data Sources:**
    *   In `script.js`, configure which APIs to use:
        ```javascript
        const API_SOURCES = {
            perenual: { enabled: true, name: "Perenual" },
            trefle: { enabled: false, name: "Trefle" }, // Enable when you add your key
            inaturalist: { enabled: true, name: "iNaturalist" },
            gbif: { enabled: true, name: "GBIF" },
            toxicshrooms: { enabled: true, name: "Toxic Shrooms" },
            mushroomobserver: { enabled: true, name: "Mushroom Observer" }
        };
        ```

3.  **Run a Local Server:**
    *   Open your terminal in the project directory and run:
        ```bash
        python3 -m http.server
        ```

4.  **Open the App:**
    *   Navigate to **[http://localhost:8000](http://localhost:8000)**
    *   The app will load with your first random plant

---

## **How to Use**

### Bottom Navigation Bar
Use the bottom navigation to switch between:
- **Home:** Random plant discovery with AI personalities
- **Browse:** Search, filter, and explore plants across multiple databases
- **Fungi:** Dedicated fungi and mushroom exploration
- **Favorites:** View your saved plants and fungi

### Multi-Database Search
1. Go to the **Browse** tab
2. Enable **"🌍 Search Multiple Databases"** toggle
3. Enter your search query
4. Results will show plants from all enabled databases with source badges

### Fungi Exploration
1. Go to the **Fungi** tab
2. **Search** for specific mushrooms or fungi
3. **Browse toxic mushrooms** by danger level
4. **Get random mushroom** for discovery
5. Click any result to see detailed toxicity and taxonomic information

### Tips
- Start on **Home** to discover interesting plants
- Use **Browse** with multi-source search for comprehensive results
- Explore **Fungi** tab to learn about mushrooms and their toxicity
- Source badges show which database each result comes from
- Add plants and fungi to **Favorites** for quick access later

---

## **Technical Details**

### Performance Optimizations
- **Fast loading**: 1-2 second plant loads (80% improvement)
- **Parallel API calls**: Search multiple databases simultaneously
- **Smart caching**: 24-hour cache for frequently accessed data
- **Async personality generation**: UI shows immediately, AI loads in background
- **Lazy image loading**: Faster initial page load
- **Reduced API calls**: Direct ID lookup instead of pagination

### API Integration
- **Perenual API** endpoints:
  - `/species-list` - Search and filtering
  - `/species/details/{id}` - Full plant information
  - `/pest-disease-list` - Disease and pest data
- **Trefle API** endpoints (optional):
  - `/plants/search` - Plant search
  - `/plants/{id}` - Plant details
- **iNaturalist API**:
  - `/taxa` - Species and fungi search
  - `/observations` - Community observations
- **GBIF API**:
  - `/species/search` - Global species search
  - `/species/{key}` - Species details
- **Toxic Shrooms API**:
  - `/api/mushrooms` - All toxic mushrooms
  - `/api/mushrooms/{type}` - Filter by deadly/poisonous
  - `/api/mushrooms/randompic` - Random mushroom
- **Mushroom Observer API**:
  - `/api2/observations` - Mushroom observations
- **Gemini API** - AI personality generation

### Data Persistence
- Favorites stored in localStorage
- Plant count cache (24-hour TTL)
- Survives page refreshes and browser sessions

### Error Handling
- Retry logic with exponential backoff
- Data validation before display
- Graceful error messages
- Fallback handling for missing data
- API-specific error recovery

---

## **Database Information**

### Plant Data Coverage
- **Perenual**: 10,000+ species with detailed care instructions
- **Trefle**: 1M+ plants including 422,511 species, 28,478 varieties, 29,918 sub-species
- **iNaturalist**: Community-driven observations with millions of records
- **GBIF**: Global biodiversity database with comprehensive taxonomy

### Fungi Data Coverage
- **Toxic Shrooms**: Comprehensive database of deadly and poisonous mushrooms
- **iNaturalist**: Fungi kingdom observations (taxon ID: 47170)
- **GBIF**: Global fungi species records
- **Mushroom Observer**: Community mushroom observations with images and locations

---

## **Developer Mode**

Press **Option+T** (or Alt+T on Windows) to open the developer panel:
- View current application state
- Monitor localStorage usage
- Check performance metrics
- Clear cache and favorites
- Export data as JSON

---

## **Future Enhancements**

Potential improvements for future versions:
1. **BrAPI Integration** - Plant breeding and agricultural data
2. **Image Recognition** - Upload plant/fungi photos for AI identification
3. **Offline Support** - Service worker for offline access
4. **Advanced Comparison** - Side-by-side species comparison
5. **Geolocation** - Find plants/fungi native to your area
6. **Community Features** - Share discoveries and observations
7. **Mobile App** - Native iOS/Android applications

---

## **Credits**

- **APIs**: Perenual, Trefle, iNaturalist, GBIF, Toxic Shrooms Database, Mushroom Observer
- **AI**: Google Gemini
- **Fonts**: Google Fonts (Poppins, Lora)
- **Icons**: SVG icons
- **Styling**: Tailwind CSS

---

## **License**

This project is for educational and personal use. Please respect the terms of service of all integrated APIs:
- [Perenual API Terms](https://perenual.com/docs/api)
- [Trefle API Terms](https://trefle.io)
- [iNaturalist API Terms](https://www.inaturalist.org/pages/api+reference)
- [GBIF Data Use Agreement](https://www.gbif.org/terms)
- [Google Gemini Terms](https://ai.google.dev/terms)

---

## **Version History**

### v2.0.0 (Current)
- Added 5 new database integrations
- Created dedicated Fungi/Mushroom tab
- Implemented multi-source search
- Added source badges and taxonomic information
- Enhanced error handling and performance

### v1.0.0
- Initial release with Perenual and Gemini APIs
- Home, Browse, and Favorites tabs
- AI-generated plant personalities
- Performance optimizations
