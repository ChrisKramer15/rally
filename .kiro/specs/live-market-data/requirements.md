# Requirements Document

## Introduction

This feature provides a live market data dashboard for the Rally app, enabling users to monitor real-time stock and ETF prices on a dedicated page. The dashboard displays streaming price data for a user-curated watchlist, with visual indicators for price movements. This live data layer also serves as the foundation for creating asset valuations in a subsequent feature.

## Glossary

- **Market_Data_Dashboard**: The dedicated screen in the Rally app that displays live stock and ETF price data for assets on the user's watchlist.
- **Watchlist**: A user-managed collection of stock and ETF symbols that the user wants to monitor on the Market_Data_Dashboard.
- **Price_Ticker**: A UI component on the Market_Data_Dashboard that displays the current price, percentage change, and directional indicator for a single asset.
- **Market_Data_Service**: The existing backend service layer that provides REST and WebSocket access to real-time market data.
- **Market_Data_Repository**: The existing data layer that wraps the Market_Data_Service with caching, polling, and timeout handling.
- **Price_Update**: A real-time price change event received via WebSocket containing symbol, price, daily high, daily low, volume, percentage change, and timestamp.
- **Asset_Price**: The current price snapshot for an asset containing symbol, price, daily high, daily low, volume, percentage change, and timestamp.
- **Connection_Status**: The state of the WebSocket connection (connected, disconnected, or reconnecting).

## Requirements

### Requirement 1: Watchlist Management

**User Story:** As a user, I want to add and remove stocks and ETFs from my watchlist, so that I can curate which assets I monitor on the live market data dashboard.

#### Acceptance Criteria

1. WHEN a user searches for an asset and selects it, THE Market_Data_Dashboard SHALL add the asset symbol to the Watchlist and subscribe to its Price_Update stream, provided the symbol is not already present on the Watchlist.
2. WHEN a user removes an asset from the Watchlist, THE Market_Data_Dashboard SHALL remove the asset symbol and unsubscribe from its Price_Update stream.
3. THE Market_Data_Dashboard SHALL persist the Watchlist across app sessions using local storage. IF the local storage write fails, THEN THE Market_Data_Dashboard SHALL retain the Watchlist in memory and display a warning indicating that changes may not persist across sessions.
4. THE Market_Data_Dashboard SHALL support both stock and ETF asset types on the Watchlist.
5. IF the Watchlist is empty, THEN THE Market_Data_Dashboard SHALL display a prompt instructing the user to add assets.
6. IF a user attempts to add an asset that already exists on the Watchlist, THEN THE Market_Data_Dashboard SHALL not create a duplicate entry and SHALL indicate to the user that the asset is already on the Watchlist.
7. THE Market_Data_Dashboard SHALL support a maximum of 50 assets on the Watchlist. IF the user attempts to add an asset when the Watchlist contains 50 entries, THEN THE Market_Data_Dashboard SHALL display a message indicating the Watchlist is at capacity.

### Requirement 2: Live Price Streaming

**User Story:** As a user, I want to see live price updates for all assets on my watchlist, so that I can monitor market movements in real time.

#### Acceptance Criteria

1. WHEN the Market_Data_Dashboard is opened, THE Market_Data_Dashboard SHALL subscribe to WebSocket Price_Update streams for all symbols on the Watchlist, up to a maximum of 50 symbols.
2. WHEN a Price_Update is received for a subscribed symbol, THE Market_Data_Dashboard SHALL update the corresponding Price_Ticker within 100 milliseconds of receiving the event.
3. WHILE the Market_Data_Dashboard is visible, THE Market_Data_Dashboard SHALL maintain an active WebSocket connection for streaming price data.
4. WHEN the Market_Data_Dashboard is navigated away from, THE Market_Data_Dashboard SHALL unsubscribe from all Price_Update streams and close the WebSocket connection.
5. WHEN the Market_Data_Dashboard is opened, THE Market_Data_Dashboard SHALL display the most recent cached Asset_Price from the Market_Data_Repository for each Watchlist symbol while awaiting the first live Price_Update.
6. IF the Market_Data_Repository has no cached Asset_Price for a Watchlist symbol on initial load, THEN THE Market_Data_Dashboard SHALL display a loading indicator for that symbol's Price_Ticker until the first Price_Update is received or a timeout of 10 seconds elapses.
7. IF no Price_Update is received for a symbol within 10 seconds of subscribing, THEN THE Market_Data_Dashboard SHALL display a data unavailable indicator for that symbol's Price_Ticker.

### Requirement 3: Price Display

**User Story:** As a user, I want to see key price information for each asset on my watchlist, so that I can quickly assess market conditions.

#### Acceptance Criteria

1. THE Price_Ticker SHALL display the asset symbol, current price formatted to 2 decimal places, and percentage change formatted to 2 decimal places with a percent sign suffix for each Watchlist entry.
2. WHEN the percentage change is greater than zero, THE Price_Ticker SHALL display a green upward indicator and a plus sign prefix on the percentage change value.
3. WHEN the percentage change is less than zero, THE Price_Ticker SHALL display a red downward indicator and a minus sign prefix on the percentage change value.
4. WHEN the percentage change is exactly zero, THE Price_Ticker SHALL display a neutral indicator with no directional sign and no color emphasis.
5. WHEN a user taps a Price_Ticker, THE Market_Data_Dashboard SHALL navigate to the asset detail view displaying the daily high, daily low, volume, and full price history for the selected asset within 2 seconds of the tap.
6. IF the price data for a Watchlist entry is unavailable, THEN THE Price_Ticker SHALL display a placeholder indicating that data is unavailable in place of the price and percentage change values.
7. WHEN the Watchlist contains no entries, THE Market_Data_Dashboard SHALL display an empty-state message indicating no assets have been added to the Watchlist.

### Requirement 4: Connection Status Handling

**User Story:** As a user, I want to know when live data is unavailable, so that I understand the data I see may be stale.

#### Acceptance Criteria

1. WHILE the Connection_Status is disconnected, THE Market_Data_Dashboard SHALL display a warning banner indicating live data is unavailable within 2 seconds of the connection loss being detected.
2. WHILE the Connection_Status is reconnecting, THE Market_Data_Dashboard SHALL display a reconnecting indicator showing the current attempt number.
3. WHEN the Connection_Status changes from disconnected to connected, THE Market_Data_Dashboard SHALL remove the warning banner and refresh all Price_Tickers with current data within 2 seconds of reconnection.
4. WHILE the Connection_Status is disconnected, THE Market_Data_Dashboard SHALL display the last known prices with a timestamp indicating the date and time when data was last received.
5. IF the WebSocket connection fails, THEN THE Market_Data_Service SHALL attempt reconnection using exponential backoff starting at 1 second with a maximum delay of 30 seconds, up to a maximum of 10 attempts.
6. IF the Market_Data_Service exhausts all 10 reconnection attempts without success, THEN THE Market_Data_Dashboard SHALL display a persistent error banner indicating the connection could not be re-established and provide a manual retry option.

### Requirement 5: Data Freshness and Polling Fallback

**User Story:** As a user, I want my market data to stay current even during brief connection interruptions, so that I can rely on the displayed information.

#### Acceptance Criteria

1. WHILE the WebSocket connection is active, THE Market_Data_Repository SHALL update the price cache for each Watchlist symbol upon receiving a Price_Update.
2. WHILE the WebSocket connection is disconnected, THE Market_Data_Repository SHALL poll prices via REST for all Watchlist symbols, beginning immediately upon disconnect and repeating every 60 seconds thereafter.
3. WHEN the WebSocket connection transitions from disconnected to connected, THE Market_Data_Repository SHALL stop REST polling within 1 second of the connection being re-established.
4. THE Market_Data_Repository SHALL consider a cached price stale when the current time exceeds the Price_Update timestamp by more than 60 seconds.
5. WHEN a stale price is displayed, THE Price_Ticker SHALL display a visual indicator distinguishing stale data from live data.
6. WHEN a fresh price replaces a stale price, THE Price_Ticker SHALL remove the stale data indicator.
7. IF a REST poll request fails or does not respond within 10 seconds, THEN THE Market_Data_Repository SHALL retain the existing cached price and reattempt on the next polling interval.

### Requirement 6: Asset Price Data Parsing

**User Story:** As a developer, I want asset price data to be reliably parsed from JSON, so that the app handles malformed data gracefully.

#### Acceptance Criteria

1. WHEN a valid JSON payload containing all required fields (symbol as String, price as num, dailyHigh as num, dailyLow as num, volume as num, percentageChange as num, timestamp as ISO 8601 String) is received, THE Asset_Price parser SHALL produce an Asset_Price object where each numeric field is stored as a double (accepting both int and double input) and the timestamp is normalized to UTC.
2. IF a JSON payload is missing one or more required fields (symbol, price, dailyHigh, dailyLow, volume, percentageChange, timestamp), THEN THE Asset_Price parser SHALL throw a MarketDataException whose message identifies all missing field names.
3. IF a JSON payload contains a required field whose value is null or a non-matching type (symbol expects String; price, dailyHigh, dailyLow, volume, percentageChange expect num; timestamp expects String), THEN THE Asset_Price parser SHALL throw a MarketDataException identifying the field name and the expected type.
4. IF a JSON payload contains a timestamp field that is a String but not parseable as ISO 8601, THEN THE Asset_Price parser SHALL throw a MarketDataException indicating the invalid timestamp value.
5. FOR ALL valid Asset_Price objects, serializing to JSON via toJson and parsing back via fromJson SHALL produce an Asset_Price object that is field-by-field equal to the original (symbol, price, dailyHigh, dailyLow, volume, percentageChange, and timestamp all compare as equal).

### Requirement 7: Valuation Data Access

**User Story:** As a user, I want the live market data to be accessible for creating asset valuations, so that I can make informed trading decisions.

#### Acceptance Criteria

1. THE Market_Data_Repository SHALL expose a method to retrieve the current cached Asset_Price for a given symbol, returning the Asset_Price if the symbol exists in the cache, or null if no cached entry exists for that symbol.
2. THE Market_Data_Repository SHALL expose a method to retrieve all currently cached Asset_Price entries as an unmodifiable collection keyed by symbol.
3. WHEN a valuation module requests a price for a symbol not in the cache, THE Market_Data_Repository SHALL fetch the price from the Market_Data_Service within a 60-second timeout and cache the result before returning.
4. IF a fetch from the Market_Data_Service fails or times out and no cached Asset_Price exists for the requested symbol, THEN THE Market_Data_Repository SHALL propagate the error to the caller.
5. IF a fetch from the Market_Data_Service fails or times out and a cached Asset_Price exists for the requested symbol, THEN THE Market_Data_Repository SHALL return the previously cached Asset_Price.
6. THE Market_Data_Repository SHALL include the Asset_Price timestamp (the time the price was recorded by the source) with every returned Asset_Price, and SHALL expose a staleness check indicating whether the cached entry is older than 60 seconds.
