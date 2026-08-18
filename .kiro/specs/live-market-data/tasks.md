# Implementation Plan: Live Market Data Dashboard

## Overview

This plan implements the live market data dashboard feature for the Rally app, building on the existing clean architecture (data → domain → presentation). Tasks are ordered to establish domain models and interfaces first, then data layer logic, followed by BLoC state management, and finally UI widgets — wiring everything together at the end.

## Tasks

- [x] 1. Define domain models and interfaces
  - [x] 1.1 Create the `IWatchlistStore` interface and `WatchlistChangeResult` sealed class
    - Create `lib/domain/services/i_watchlist_store.dart` with the `IWatchlistStore` abstract class defining `getWatchlist()`, `addSymbol(String)`, `removeSymbol(String)`, `contains(String)`, and `isAtCapacity()` methods
    - Create `lib/domain/models/watchlist_change_result.dart` with the sealed class hierarchy: `WatchlistSymbolAdded`, `WatchlistAlreadyExists`, `WatchlistAtCapacity`, `WatchlistSymbolRemoved`, `WatchlistPersistenceWarning`
    - Export new models from `lib/domain/models/models.dart`
    - _Requirements: 1.1, 1.2, 1.6, 1.7_

  - [x] 1.2 Define `MarketDataDashboardBloc` events and states
    - Create `lib/presentation/blocs/market_data/market_data_dashboard_event.dart` with events: `DashboardOpened`, `DashboardClosed`, `AddToWatchlist(symbol)`, `RemoveFromWatchlist(symbol)`, `PriceUpdated(PriceUpdate)`, `ConnectionChanged(ConnectionStatus)`, `StaleCheckTriggered`, `ManualRetryRequested`
    - Create `lib/presentation/blocs/market_data/market_data_dashboard_state.dart` with states: `DashboardLoading`, `DashboardLoaded` (with `prices`, `stalePrices`, `unavailable`, `connectionStatus`, `reconnectAttempt`, `lastDataReceived`), `DashboardEmpty`, `DashboardError(message)`
    - _Requirements: 2.1, 2.5, 2.6, 2.7, 4.1, 4.2, 4.4_

- [x] 2. Implement WatchlistStore data layer
  - [x] 2.1 Implement `WatchlistStore` backed by `SharedPreferences`
    - Create `lib/data/services/watchlist_store.dart` implementing `IWatchlistStore`
    - Enforce max capacity of 50, duplicate rejection, and persist via `SharedPreferences` under key `watchlist_symbols`
    - Return appropriate `WatchlistChangeResult` values for add/remove outcomes
    - Handle `SharedPreferences` write failures by retaining in-memory state and returning `WatchlistPersistenceWarning`
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7_

  - [x] 2.2 Write property test: Watchlist add is set-like (Property 1)
    - **Property 1: Watchlist add is set-like**
    - Generate random symbol strings and watchlist states; verify adding a symbol results in it appearing exactly once
    - **Validates: Requirements 1.1, 1.6**

  - [x] 2.3 Write property test: Watchlist remove then absent (Property 2)
    - **Property 2: Watchlist remove then absent**
    - Generate random watchlists with 1–50 entries; verify removing a symbol makes it absent and reduces length by one
    - **Validates: Requirements 1.2**

  - [x] 2.4 Write property test: Watchlist persistence round-trip (Property 3)
    - **Property 3: Watchlist persistence round-trip**
    - Generate random lists of 0–50 unique symbols; verify persist then load produces identical list
    - **Validates: Requirements 1.3**

  - [x] 2.5 Write property test: Watchlist capacity invariant (Property 4)
    - **Property 4: Watchlist capacity invariant**
    - Start with watchlists at capacity; verify additional adds are rejected and length never exceeds 50
    - **Validates: Requirements 1.7**

  - [x] 2.6 Write unit tests for `WatchlistStore`
    - Test edge cases: empty string symbol handling, capacity boundary (49 → 50 → reject), remove non-existent symbol, persistence failure scenario
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7_

- [x] 3. Implement MarketDataRepository extensions
  - [x] 3.1 Add `getCachedPrice`, `updateCacheFromPriceUpdate`, and staleness check to `MarketDataRepository`
    - Add `AssetPrice? getCachedPrice(String symbol)` method
    - Add `void updateCacheFromPriceUpdate(PriceUpdate update)` method that converts a `PriceUpdate` into a cached `AssetPrice` entry
    - Ensure `isStale(String symbol)` method uses 60-second threshold
    - Add `Map<String, AssetPrice> getAllCachedPrices()` returning an unmodifiable map
    - Add `Future<AssetPrice> fetchAndCachePrice(String symbol)` with 60-second timeout, returning cached price on failure if available, propagating error otherwise
    - _Requirements: 5.1, 5.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 3.2 Write property test: Cache update from PriceUpdate (Property 7)
    - **Property 7: Cache update from PriceUpdate**
    - Generate random `PriceUpdate` instances; verify cache contains matching `AssetPrice` after processing
    - **Validates: Requirements 5.1**

  - [x] 3.3 Write property test: Staleness threshold (Property 8)
    - **Property 8: Staleness threshold**
    - Generate random `DateTime` offsets around the 60-second boundary; verify `isStale` returns correct boolean
    - **Validates: Requirements 5.4**

  - [x] 3.4 Write property test: Cache lookup correctness (Property 13)
    - **Property 13: Cache lookup correctness**
    - Generate random cache states and query symbols; verify retrieval returns `AssetPrice` iff symbol is in cache
    - **Validates: Requirements 7.1**

  - [x] 3.5 Write unit tests for MarketDataRepository extensions
    - Test `fetchAndCachePrice` timeout behavior, cached fallback on failure, error propagation when no cache, polling start/stop lifecycle
    - _Requirements: 5.2, 5.3, 5.7, 7.3, 7.4, 7.5_

- [x] 4. Checkpoint - Core data layer verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement AssetPrice parsing validation
  - [x] 5.1 Verify and harden `AssetPrice.fromJson` parsing logic
    - Ensure `fromJson` validates all 7 required fields are present, throws `MarketDataException` listing all missing field names
    - Ensure type validation throws `MarketDataException` identifying field name and expected type
    - Ensure invalid ISO 8601 timestamp strings throw `MarketDataException` with the invalid value
    - Ensure `num` values are stored as `double` via `.toDouble()` and timestamps are normalized to UTC
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 5.2 Write property test: AssetPrice serialization round-trip (Property 9)
    - **Property 9: AssetPrice serialization round-trip**
    - Generate random valid `AssetPrice` objects; verify `toJson` then `fromJson` produces field-by-field equal object
    - **Validates: Requirements 6.1, 6.5**

  - [x] 5.3 Write property test: Missing fields produce descriptive error (Property 10)
    - **Property 10: Missing fields produce descriptive error**
    - Generate random non-empty subsets of required fields to omit; verify `MarketDataException` message contains all omitted field names
    - **Validates: Requirements 6.2**

  - [x] 5.4 Write property test: Wrong-type fields produce descriptive error (Property 11)
    - **Property 11: Wrong-type fields produce descriptive error**
    - Generate random field + wrong-type value; verify `MarketDataException` identifies field name and expected type
    - **Validates: Requirements 6.3**

  - [x] 5.5 Write property test: Invalid timestamp string produces error (Property 12)
    - **Property 12: Invalid timestamp string produces error**
    - Generate random non-ISO-8601 strings; verify `MarketDataException` indicates the invalid timestamp value
    - **Validates: Requirements 6.4**

- [x] 6. Implement MarketDataDashboardBloc
  - [x] 6.1 Create `MarketDataDashboardBloc` with subscription management
    - Create `lib/presentation/blocs/market_data/market_data_dashboard_bloc.dart`
    - Handle `DashboardOpened`: load watchlist from `IWatchlistStore`, subscribe to WebSocket streams for all symbols, emit `DashboardLoaded` with cached prices (or `DashboardEmpty` if watchlist empty)
    - Handle `DashboardClosed`: unsubscribe all streams, cancel timers, stop polling
    - Handle `AddToWatchlist`: call `WatchlistStore.addSymbol`, subscribe to stream on success, emit appropriate user feedback for duplicates/capacity
    - Handle `RemoveFromWatchlist`: call `WatchlistStore.removeSymbol`, unsubscribe stream
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 2.1, 2.3, 2.4_

  - [x] 6.2 Implement price update handling and timeout logic in the BLoC
    - Handle `PriceUpdated`: update price map, remove from `unavailable` set, compute staleness, update `lastDataReceived`
    - Implement 10-second timeout per symbol: if no `PriceUpdate` received within 10 seconds of subscribing, mark symbol as unavailable
    - Handle `StaleCheckTriggered`: periodic timer (every 10 seconds) re-evaluates staleness set
    - _Requirements: 2.2, 2.5, 2.6, 2.7, 5.4, 5.5, 5.6_

  - [x] 6.3 Implement connection status and polling fallback logic in the BLoC
    - Handle `ConnectionChanged`: update `connectionStatus` and `reconnectAttempt` in state
    - On `ConnectionStatus.disconnected`: start REST polling via `MarketDataRepository.startPolling()`, update `lastDataReceived` timestamp
    - On `ConnectionStatus.connected`: stop polling via `MarketDataRepository.stopPolling()`, refresh all prices
    - On reconnection exhausted (attempt > 10): emit state with persistent error
    - Handle `ManualRetryRequested`: reset attempt counter, trigger reconnection
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.2, 5.3_

  - [x] 6.4 Write unit tests for `MarketDataDashboardBloc`
    - Test lifecycle events (opened/closed), watchlist add/remove, price update flow, timeout marking, connection status transitions, polling start/stop, manual retry
    - Use `bloc_test` and `mocktail` for mocking dependencies
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.4, 4.1, 4.3, 4.5, 4.6, 5.2, 5.3_

- [x] 7. Checkpoint - BLoC and business logic verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement presentation widgets
  - [x] 8.1 Create `PriceTickerWidget` with formatting and indicators
    - Create `lib/presentation/widgets/market_data/price_ticker_widget.dart`
    - Display symbol, price (2 decimal places), percentage change (2 decimal places with % suffix)
    - Green upward indicator + plus prefix for positive change, red downward + minus for negative, neutral for zero
    - Show stale data indicator when `isStale` is true
    - Show loading placeholder when price is null and not yet unavailable
    - Show "data unavailable" placeholder for unavailable symbols
    - Handle tap to navigate to asset detail view
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.5, 5.6_

  - [x] 8.2 Write property test: Price ticker formatting correctness (Property 5)
    - **Property 5: Price ticker formatting correctness**
    - Generate random `AssetPrice` instances with varied `percentageChange` signs; verify formatting output matches spec
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 8.3 Create `ConnectionBannerWidget`
    - Create `lib/presentation/widgets/market_data/connection_banner_widget.dart`
    - Show warning banner when disconnected with "live data unavailable" message and last received timestamp
    - Show reconnecting indicator with attempt number (e.g., "Reconnecting... attempt 3/10")
    - Show persistent error banner with manual retry button when all retries exhausted
    - Remove banner when status returns to connected
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

  - [x] 8.4 Create `WatchlistSearchWidget` for adding assets
    - Create `lib/presentation/widgets/market_data/watchlist_search_widget.dart`
    - Integrate with existing asset search functionality
    - On asset selection, dispatch `AddToWatchlist` event to BLoC
    - Display feedback for duplicates ("already on watchlist") and capacity ("watchlist is full")
    - _Requirements: 1.1, 1.4, 1.6, 1.7_

  - [x] 8.5 Write unit tests for `PriceTickerWidget` and `ConnectionBannerWidget`
    - Test rendering of all price states (positive, negative, zero, stale, loading, unavailable)
    - Test connection banner visibility for each `ConnectionStatus`
    - Test tap navigation on `PriceTickerWidget`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 4.1, 4.2, 4.6_

- [x] 9. Implement exponential backoff reconnection logic
  - [x] 9.1 Add exponential backoff reconnection to `MarketDataService`
    - Implement reconnection logic: delay = min(1000 × 2^N, 30000) ms for attempt N (0 ≤ N < 10)
    - After 10 failed attempts, emit final disconnected status and stop retrying
    - Emit `ConnectionStatus.reconnecting` with attempt number during retries
    - Emit `ConnectionStatus.connected` on successful reconnect
    - _Requirements: 4.5, 4.6_

  - [x] 9.2 Write property test: Exponential backoff delay calculation (Property 6)
    - **Property 6: Exponential backoff delay calculation**
    - Generate random attempt numbers 0–9; verify computed delay equals min(1000 × 2^N, 30000)
    - **Validates: Requirements 4.5**

  - [x] 9.3 Write unit tests for reconnection logic
    - Test backoff timing at each attempt (0–9), max delay cap at 30 seconds, stop after 10 attempts, successful reconnect resets counter
    - _Requirements: 4.5, 4.6_

- [x] 10. Wire up the Market Data Dashboard screen
  - [x] 10.1 Create `MarketDataDashboardScreen` and integrate all components
    - Create `lib/presentation/screens/market_data_dashboard_screen.dart`
    - Provide `MarketDataDashboardBloc` via `BlocProvider`
    - Dispatch `DashboardOpened` on init and `DashboardClosed` on dispose
    - Render `ConnectionBannerWidget` at top when connection is not active
    - Render list of `PriceTickerWidget` items from `DashboardLoaded.prices`
    - Render empty state prompt when `DashboardEmpty`
    - Include `WatchlistSearchWidget` FAB or header action for adding assets
    - Include swipe-to-remove for watchlist entries
    - _Requirements: 1.5, 2.1, 2.3, 2.4, 3.7, 4.1_

  - [x] 10.2 Register `WatchlistStore` and `MarketDataDashboardBloc` in service locator
    - Update `lib/di/service_locator.dart` to register `WatchlistStore` (with `SharedPreferences` dependency)
    - Register `MarketDataDashboardBloc` with its dependencies (`MarketDataRepository`, `WatchlistStore`, `MarketDataService`)
    - Add navigation route to dashboard screen from the app's navigation
    - _Requirements: 1.3, 2.1_

  - [x] 10.3 Write integration tests for dashboard lifecycle
    - Test full flow: open dashboard → load watchlist → receive price updates → close dashboard → unsubscribe
    - Test watchlist add → subscribe → receive update → display
    - Test connection loss → polling fallback → reconnect → polling stops
    - _Requirements: 2.1, 2.3, 2.4, 5.2, 5.3_

- [x] 11. Final checkpoint - Full feature verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing `MarketDataService`, `MarketDataRepository`, and `AssetPrice`/`PriceUpdate` models are leveraged — tasks extend rather than replace them
- All property tests use `kiri_check: ^1.3.1` (already a dev dependency)
- BLoC tests use `bloc_test` and `mocktail` packages (standard in the project)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "3.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5", "9.1"] },
    { "id": 4, "tasks": ["6.1", "9.2", "9.3"] },
    { "id": 5, "tasks": ["6.2", "6.3"] },
    { "id": 6, "tasks": ["6.4", "8.1", "8.3", "8.4"] },
    { "id": 7, "tasks": ["8.2", "8.5", "10.1"] },
    { "id": 8, "tasks": ["10.2", "10.3"] }
  ]
}
```
