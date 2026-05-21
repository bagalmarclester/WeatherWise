# WeatherWise Manual QA Test Script

This document provides a structured manual test plan for the WeatherWise application.

## 🛠 Prerequisites
*   The API Proxy Server must be running: `node server/proxy.js`.
*   A physical device or simulator with location permissions enabled.
*   Firebase configuration must be set in `.env`.

---

## 🧪 Test Cases

| Step | Action | Expected Result | Pass/Fail |
| :--- | :--- | :--- | :--- |
| **1. Happy Path** | Search "Ateneo de Davao University" for Origin and "SM Lanang Premier" for Destination. Tap "Compare Routes". | Map shows the route. Waypoints are sampled. Weather icons appear on the map. Summary banner appears at the top. | [ ] |
| **2. High Rain Path** | **Mocking:** Open `services/weather.ts`. Temporarily modify `fetchWeatherAtPoint` to return `precipitationProbability: 85` and `weatherCode: 95` for a specific coordinate. | The route segment/polyline color reflects the high risk (Red). A red "High Risk" banner appears. High-risk markers (🌧️) appear on the map. | [ ] |
| **3. Timeline Verification** | Navigate to the "Alerts" tab after performing Step 1. | A vertical timeline is visible. Cards show correct time, weather emoji, rain %, and segment labels. | [ ] |
| **4. Alternative Routes** | Analyze a route that offers multiple paths (e.g., across a city). | The bottom comparison sheet appears. At least two cards (Primary, Alt 1) are shown with duration and risk labels. | [ ] |
| **5. Selection Logic** | Tap on "Alt 1" in the bottom comparison sheet. | The polyline on the map updates to show Alt 1's path. Risk markers update to reflect the new route's weather. | [ ] |
| **6. Offline Resilience** | 1. Analyze a route while online.<br>2. Disable WiFi/Data on device.<br>3. Search for the **same** route again. | The amber banner "Offline — showing cached weather" appears at the top. The analysis completes instantly using cached data. | [ ] |
| **7. Error: No Route** | Enter origin coordinates in the middle of the ocean (e.g., `0, 0`) and a valid destination. | The app displays a clear error alert: "Could not fetch routes" or "No route found". No crash occurs. | [ ] |
| **8. Current Location** | Tap the "📍 Current" button next to the Origin field. | The Origin field is populated with the human-readable name of your current location (reverse geocoded). | [ ] |
| **9. Performance** | Perform a route analysis and check the Metro/Debug console logs. | A log entry appears: `[Performance] analyzeRoute took Xms for Y waypoints`. Duration should be < 2s for cached points. | [ ] |

---

## 🔬 Mocking Instructions for High Rain
To manually trigger high-risk UI states without actual rain:

1.  Open `C:\Users\xlr8m\OneDrive\2022\Documents\Codes\EmergingTech\Project\services\weather.ts`.
2.  Locate the `fetchWeatherAtPoint` function.
3.  Add this temporary override before the `return result;` line:

```typescript
// TEMP MOCK FOR TESTING
if (lat.toFixed(2) === "7.12") { // Match a specific lat on your route
  result.precipitationProbability = 85;
  result.precipitationMm = 12.5;
  result.weatherCode = 95; // Thunderstorm
  result.isRainy = true;
}
```
4.  Save and re-run the route analysis.
