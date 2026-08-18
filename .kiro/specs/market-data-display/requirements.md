# Requirements Document

## Introduction

The Market Data Display feature enables users to search for financial assets (stocks, ETFs, crypto) and view current market data within the Rally app. The feature connects to a backend market data service via REST API for on-demand queries and WebSocket for real-time price streaming. It provides search functionality, asset detail views with live-updating prices, and graceful handling of connectivity issues — all rendered in the app's neon-themed UI.

## Glossary

- **Market_Data_Screen**: The Flutter screen widget responsible for presenting asset search and detail views to the user.
- **Market_Data_Bloc**: The BLoC component managing market data state transitions, search events, and asset selection.
- **Market_Data_Service**: The data layer service that communicates with the backend via REST and WebSocket protocols.
- **Market_Data_Repository**: The repository layer wrapping the service with caching, polling, and timeout handling.
- **Asset_Price**: A domain model representing the current price data for an asset, including symbol, price, daily high/low, volume, percentage change, and timestamp.
- **Asset_Search_Result**: A domain model representing a search result with symbol, name, current price, percentage change, and asset type.
- **Price_Update**: A domain model representing a real-time price update received via WebSocket.
- **Connection_Status**: An enumeration of WebSocket connection states: connected, disconnected, reconnecting.

## Requirements

### Requirement 1: Asset Search

**User Story:** As a trader, I want to search for stocks, ETFs, and crypto by name or symbol, so that I can quickly find assets to view.

#### Acceptance Criteria

1. WHEN the user enters at least 1 character in the search field, THE Market_Data_Bloc SHALL emit a Searching state and request matching assets from the Market_Data_Repository.
2. WHEN the Market_Data_Repository returns results, THE Market_Data_Bloc SHALL emit a SearchResults state containing the list of Asset_Search_Result objects.
3. WHEN the Market_Data_Repository returns an empty list, THE Market_Data_Bloc SHALL emit a NoResults state.
4. THE Market_Data_Screen SHALL display each search result showing the asset symbol, name, current price, and percentage change.
5. IF the search request fails, THEN THE Market_Data_Bloc SHALL emit a MarketDataError state containing the error message.

### Requirement 2: Asset Detail View

**User Story:** As a trader, I want to select a search result and view detailed market data for that asset, so that I can make informed trading decisions.

#### Acceptance Criteria

1. WHEN the user taps a search result, THE Market_Data_Bloc SHALL request the full Asset_Price from the Market_Data_Repository for the selected symbol.
2. WHEN the Asset_Price is loaded, THE Market_Data_Screen SHALL display the current price, daily high, daily low, volume, and percentage change.
3. THE Market_Data_Screen SHALL display a directional icon (up arrow for positive change, down arrow for negative change) alongside the percentage change value.
4. THE Market_Data_Screen SHALL color positive percentage changes green and negative percentage changes red using the neon theme colors.
5. IF the price fetch fails, THEN THE Market_Data_Bloc SHALL emit a MarketDataError state containing the error message.

### Requirement 3: Real-Time Price Updates via WebSocket

**User Story:** As a trader, I want to receive live price updates for assets I'm viewing, so that I see current market conditions without manual refresh.

#### Acceptance Criteria

1. WHEN a WebSocket Price_Update is received for a subscribed symbol, THE Market_Data_Service SHALL emit the Price_Update on the price stream.
2. THE Market_Data_Service SHALL parse incoming WebSocket messages as JSON containing symbol, price, dailyHigh, dailyLow, volume, percentageChange, and timestamp fields.
3. IF a WebSocket message cannot be parsed, THEN THE Market_Data_Service SHALL silently discard the message without crashing.
4. WHEN the user's portfolio contains symbols, THE application SHALL subscribe those symbols for real-time updates on startup.

### Requirement 4: WebSocket Connection Management

**User Story:** As a trader, I want the app to automatically reconnect when the connection is lost, so that I continue receiving live data without manual intervention.

#### Acceptance Criteria

1. WHEN the WebSocket connection is lost, THE Market_Data_Service SHALL emit a disconnected Connection_Status.
2. WHILE the WebSocket is disconnected and subscribed symbols exist, THE Market_Data_Service SHALL attempt reconnection with exponential backoff starting at 1 second and capping at 30 seconds.
3. WHEN a reconnection attempt begins, THE Market_Data_Service SHALL emit a reconnecting Connection_Status.
4. WHEN the WebSocket connection is re-established, THE Market_Data_Service SHALL re-subscribe to all previously subscribed symbols.
5. WHEN the WebSocket connection is re-established, THE Market_Data_Service SHALL emit a connected Connection_Status and reset the reconnection attempt counter.

### Requirement 5: Connection Status Display

**User Story:** As a trader, I want to see a visual warning when live data is unavailable, so that I know the prices shown may be stale.

#### Acceptance Criteria

1. WHEN the Connection_Status changes to disconnected or reconnecting, THE Market_Data_Screen SHALL display a warning banner indicating the connection is lost.
2. THE Market_Data_Screen SHALL display the timestamp of the last received data within the warning banner.
3. WHEN the Connection_Status returns to connected, THE Market_Data_Screen SHALL remove the warning banner.

### Requirement 6: Price Caching and Staleness

**User Story:** As a trader, I want previously loaded prices to be available even when the network is slow, so that I can still reference recent data.

#### Acceptance Criteria

1. WHEN an Asset_Price is fetched successfully, THE Market_Data_Repository SHALL store the price in an in-memory cache keyed by symbol.
2. WHEN a cached price for a symbol is less than 60 seconds old, THE Market_Data_Repository SHALL return the cached price without making a network request.
3. IF a price fetch fails and a cached price exists for the symbol, THEN THE Market_Data_Repository SHALL return the cached price.
4. IF a price fetch fails and no cached price exists, THEN THE Market_Data_Repository SHALL propagate the error to the caller.

### Requirement 7: REST API Communication

**User Story:** As a developer, I want the market data service to communicate with the backend via well-defined REST endpoints, so that data retrieval is reliable and testable.

#### Acceptance Criteria

1. WHEN fetching a price for a symbol, THE Market_Data_Service SHALL send a GET request to `/api/v1/price/{symbol}`.
2. WHEN searching assets, THE Market_Data_Service SHALL send a GET request to `/api/v1/search` with a `q` query parameter.
3. IF the REST API returns a non-200 status code, THEN THE Market_Data_Service SHALL throw a MarketDataException containing the HTTP status code.
4. IF the REST API response body cannot be parsed as valid JSON, THEN THE Market_Data_Service SHALL throw a MarketDataException describing the parse failure.

### Requirement 8: Volume Formatting

**User Story:** As a trader, I want large volume numbers displayed in a human-readable format, so that I can quickly interpret trading volume.

#### Acceptance Criteria

1. WHEN the volume is 1,000,000,000 or greater, THE Market_Data_Screen SHALL format the volume with a "B" suffix (e.g., "1.50B").
2. WHEN the volume is 1,000,000 or greater but less than 1,000,000,000, THE Market_Data_Screen SHALL format the volume with an "M" suffix (e.g., "2.30M").
3. WHEN the volume is 1,000 or greater but less than 1,000,000, THE Market_Data_Screen SHALL format the volume with a "K" suffix (e.g., "450.00K").
4. WHEN the volume is less than 1,000, THE Market_Data_Screen SHALL display the volume as a decimal number with 2 decimal places.

### Requirement 9: JSON Parsing for Market Data Models

**User Story:** As a developer, I want market data JSON responses reliably parsed into domain models, so that the app handles backend data consistently.

#### Acceptance Criteria

1. THE Market_Data_Service SHALL parse Asset_Price JSON containing symbol (String), price (num), dailyHigh (num), dailyLow (num), volume (num), percentageChange (num), and timestamp (ISO 8601 String) fields.
2. THE Market_Data_Service SHALL parse Asset_Search_Result JSON containing symbol (String), name (String), currentPrice (num), percentageChange (num), and type (AssetType name String) fields.
3. FOR ALL valid Asset_Price JSON objects, parsing then serializing then parsing SHALL produce an equivalent Asset_Price object (round-trip property).
4. IF any required field is missing or has an incorrect type, THEN THE Market_Data_Service SHALL throw a MarketDataException.
