# Implementation Plan: Market Data Display

## Overview

Implement the Market Data Display feature following the existing layered architecture: domain models → data services → repositories → BLoC → UI. Tasks progress bottom-up from models through services, then wire everything into the presentation layer with real-time WebSocket streaming and caching.

## Tasks

- [x] 1. Define domain models and JSON parsing
  - [x] 1.1 Create domain models (AssetPrice, AssetSearchResult, PriceUpdate, ConnectionStatus)
    - Create `lib/domain/models/asset_price.dart` with `AssetPrice` class including fields: symbol, price, dailyHigh, dailyLow, volume, percentageChange, timestamp
    - Create `lib/domain/models/asset_search_result.dart` with `AssetSearchResult` class including fields: symbol, name, currentPrice, percentageChange, type
    - Create `lib/domain/models/price_update.dart` with `PriceUpdate` class including fields: symbol, price, dailyHigh, dailyLow, volume, percentageChange, timestamp
    - Create `lib/domain/models/connection_status.dart` with `ConnectionStatus` enum: connected, disconnected, reconnecting
    - Create `lib/domain/models/market_data_exception.dart` with `MarketDataException` class
    - Implement `fromJson` and `toJson` methods on AssetPrice, AssetSearchResult, and PriceUpdate
    - Throw `MarketDataException` when required fields are missing or have incorrect types
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 1.2 Write property tests for AssetPrice JSON round-trip
    - **Property 3: AssetPrice JSON round-trip**
    - Generate random AssetPrice objects and verify `fromJson(toJson(x)) == x`
    - Create `test/data/services/market_data_parsing_property_test.dart`
    - **Validates: Requirements 9.1, 9.3**

  - [x] 1.3 Write property tests for AssetSearchResult JSON round-trip
    - **Property 4: AssetSearchResult JSON round-trip**
    - Generate random AssetSearchResult objects and verify `fromJson(toJson(x)) == x`
    - Add to `test/data/services/market_data_parsing_property_test.dart`
    - **Validates: Requirements 9.2**

  - [x] 1.4 Write property tests for invalid JSON parsing
    - **Property 5: Invalid JSON throws MarketDataException**
    - Generate valid JSON then randomly remove or corrupt required fields
    - Verify parsing throws MarketDataException
    - Add to `test/data/services/market_data_parsing_property_test.dart`
    - **Validates: Requirements 9.4, 7.4**

- [x] 2. Implement MarketDataService with REST and WebSocket communication
  - [x] 2.1 Create IMarketDataService interface
    - Create `lib/data/services/i_market_data_service.dart` with the abstract class
    - Define priceStream, connectionStatus getters, getPrice, searchAssets, subscribe, unsubscribe methods
    - _Requirements: 3.1, 7.1, 7.2_

  - [x] 2.2 Implement MarketDataService REST methods
    - Create `lib/data/services/market_data_service.dart` implementing `IMarketDataService`
    - Implement `getPrice(symbol)` sending GET to `/api/v1/price/{symbol}`
    - Implement `searchAssets(query)` sending GET to `/api/v1/search?q=query`
    - Throw `MarketDataException` on non-200 status codes or invalid JSON responses
    - Use `http.Client` for HTTP communication
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 2.3 Write property test for HTTP error code handling
    - **Property 11: Non-200 HTTP status codes throw MarketDataException**
    - Generate random status codes 400-599 and verify MarketDataException is thrown with status code in message
    - Add to `test/data/services/market_data_parsing_property_test.dart`
    - **Validates: Requirements 7.3**

  - [x] 2.4 Implement MarketDataService WebSocket streaming
    - Add WebSocket connection management using `web_socket_channel`
    - Parse incoming messages as PriceUpdate JSON and emit on priceStream
    - Silently discard unparseable messages (no crash, no emission)
    - Implement subscribe/unsubscribe sending JSON action messages to WebSocket
    - Emit ConnectionStatus changes on connectionStatus stream
    - _Requirements: 3.1, 3.2, 3.3, 4.1_

  - [x] 2.5 Implement exponential backoff reconnection
    - Implement reconnection delay: `min(1000 * 2^attempts, 30000)` ms
    - Emit `reconnecting` status before each attempt
    - On success: reset counter, re-subscribe all symbols, emit `connected`
    - Emit `disconnected` when connection is lost
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 2.6 Write property test for exponential backoff calculation
    - **Property 10: Exponential backoff calculation**
    - Generate random attempt numbers 0..20 and verify delay = min(1000 × 2^n, 30000)
    - Create `test/data/services/market_data_reconnect_property_test.dart`
    - **Validates: Requirements 4.2**

  - [x] 2.7 Write property tests for WebSocket price update parsing
    - **Property 6: WebSocket price update parsing and emission**
    - Generate random valid PriceUpdate JSON and verify emitted PriceUpdate matches
    - Create `test/data/services/market_data_websocket_property_test.dart`
    - **Validates: Requirements 3.1, 3.2**

  - [x] 2.8 Write property tests for invalid WebSocket message handling
    - **Property 7: Invalid WebSocket messages are silently discarded**
    - Generate random invalid strings and malformed JSON
    - Verify no emission on priceStream and no exception thrown
    - Add to `test/data/services/market_data_websocket_property_test.dart`
    - **Validates: Requirements 3.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement MarketDataRepository with caching
  - [x] 4.1 Create MarketDataRepository with cache layer
    - Create `lib/data/repositories/market_data_repository.dart`
    - Wrap `IMarketDataService` with in-memory `Map<String, AssetPrice>` cache
    - Implement cache freshness check (60 seconds)
    - Return cached price when fresh without network call
    - Return cached price as fallback when fetch fails and cache exists
    - Propagate error when fetch fails and no cache exists
    - Forward priceStream and connectionStatus from the service
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 4.2 Write property tests for cache freshness
    - **Property 8: Cache stores fetched prices and returns fresh ones without network call**
    - Generate random symbols and AssetPrice objects
    - Verify cached price returned within 60s window without service call
    - Create `test/data/repositories/market_data_cache_property_test.dart`
    - **Validates: Requirements 6.1, 6.2**

  - [x] 4.3 Write property tests for cache fallback on failure
    - **Property 9: Cache fallback on network failure**
    - Generate random cached prices with simulated service failures
    - Verify cached price is returned instead of error
    - Add to `test/data/repositories/market_data_cache_property_test.dart`
    - **Validates: Requirements 6.3**

- [x] 5. Implement MarketDataBloc
  - [x] 5.1 Create MarketDataBloc events and states
    - Create `lib/presentation/blocs/market_data/market_data_event.dart` with SearchAsset, SelectAsset, SubscribeSymbols, ConnectionStatusChanged events
    - Create `lib/presentation/blocs/market_data/market_data_state.dart` with MarketDataInitial, Searching, SearchResults, NoResults, AssetDetail, MarketDataError, ConnectionWarning states
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.5_

  - [x] 5.2 Implement MarketDataBloc event handlers
    - Create `lib/presentation/blocs/market_data/market_data_bloc.dart`
    - Handle SearchAsset: emit Searching → call repository.searchAssets → emit SearchResults or NoResults or MarketDataError
    - Handle SelectAsset: call repository.getPrice → emit AssetDetail or MarketDataError
    - Handle SubscribeSymbols: call service subscribe via repository
    - Handle ConnectionStatusChanged: emit ConnectionWarning with lastUpdated timestamp when disconnected/reconnecting
    - Listen to repository priceStream and connectionStatus streams
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.5, 5.1, 5.3_

  - [x] 5.3 Write unit tests for MarketDataBloc
    - Test SearchAsset emits Searching then SearchResults with mock results
    - Test SearchAsset emits NoResults when empty list returned
    - Test SelectAsset emits AssetDetail with price data
    - Test ConnectionStatusChanged emits ConnectionWarning
    - Test error handling emits MarketDataError
    - Use `bloc_test` and `mocktail` for mocking
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.5, 5.1_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement MarketDataScreen UI
  - [x] 7.1 Create volume formatting utility
    - Create `lib/presentation/widgets/market_data/volume_formatter.dart`
    - Implement formatting: ≥1B → "X.XXB", ≥1M → "X.XXM", ≥1K → "X.XXK", <1K → "X.XX"
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 7.2 Write property tests for volume formatting
    - **Property 1: Volume formatting uses correct suffix based on magnitude**
    - Generate random non-negative doubles across all magnitude ranges
    - Verify correct suffix and format for each range
    - Create `test/presentation/market_data_formatting_property_test.dart`
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [x] 7.3 Write property tests for percentage change display
    - **Property 2: Percentage change display uses correct direction and color**
    - Generate random percentage values in [-100, +1000]
    - Verify up-arrow/green for non-negative, down-arrow/red for negative
    - Add to `test/presentation/market_data_formatting_property_test.dart`
    - **Validates: Requirements 2.3, 2.4**

  - [x] 7.4 Create MarketDataScreen with search input and results list
    - Create `lib/presentation/screens/market_data_screen.dart`
    - Implement search text field with onChanged dispatching SearchAsset events
    - Implement search results list showing symbol, name, price, percentage change
    - Implement loading indicator during Searching state
    - Implement empty state for NoResults
    - Implement error display for MarketDataError state
    - Use BlocBuilder to react to MarketDataBloc states
    - _Requirements: 1.1, 1.4, 2.3, 2.4_

  - [x] 7.5 Implement asset detail view within MarketDataScreen
    - Display current price, daily high, daily low, formatted volume, percentage change
    - Display directional icon (up arrow for positive, down arrow for negative)
    - Color percentage green for positive, red for negative using neon theme
    - Use volume formatter for human-readable volume display
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 8.1, 8.2, 8.3, 8.4_

  - [x] 7.6 Implement connection warning banner
    - Display warning banner when ConnectionStatus is disconnected or reconnecting
    - Show timestamp of last received data within the banner
    - Remove banner when ConnectionStatus returns to connected
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 8. Wire components together and register in service locator
  - [x] 8.1 Register services in dependency injection
    - Register MarketDataService, MarketDataRepository, and MarketDataBloc in `lib/di/service_locator.dart`
    - Configure base URL and WebSocket URL from environment/config
    - Wire IMarketDataService → MarketDataRepository → MarketDataBloc dependency chain
    - _Requirements: 7.1, 7.2, 3.4_

  - [x] 8.2 Add navigation to MarketDataScreen
    - Add route or navigation entry for MarketDataScreen in the app's navigation
    - Ensure BLoC is provided via BlocProvider at the screen level
    - Subscribe portfolio symbols on screen initialization
    - _Requirements: 3.4_

  - [x] 8.3 Write integration tests for market data flow
    - Test end-to-end search: type query → see results → tap → see detail
    - Test WebSocket lifecycle: connect → receive updates → disconnect → reconnect
    - Test cache fallback behavior during network issues
    - Create `test/integration/market_data_integration_test.dart`
    - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 3.1, 6.3_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses `kiri_check` (v1.3.1) for property-based testing
- BLoC tests use `bloc_test` and `mocktail` packages already in the project
- All file paths follow the existing layered architecture in `lib/`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "2.7", "2.8"] },
    { "id": 4, "tasks": ["2.6", "4.1", "7.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "5.1", "7.2", "7.3"] },
    { "id": 6, "tasks": ["5.2"] },
    { "id": 7, "tasks": ["5.3", "7.4"] },
    { "id": 8, "tasks": ["7.5", "7.6"] },
    { "id": 9, "tasks": ["8.1"] },
    { "id": 10, "tasks": ["8.2"] },
    { "id": 11, "tasks": ["8.3"] }
  ]
}
```
