# Implementation Plan: Stock Trading Valuations Engine

## Overview

A Flutter-based stock trading valuations engine implementing real-time market data, portfolio tracking, trade recommendations via supply/demand zone analysis, interactive candlestick charting, and a neon-themed UI with light/dark mode. The implementation uses BLoC state management, the `fl_chart` package for charting, and a repository pattern for data access.

## Tasks

- [x] 1. Set up project structure, core models, and enums
  - [x] 1.1 Create directory structure and define core enums and value objects
    - Create `lib/domain/models/`, `lib/domain/services/`, `lib/data/repositories/`, `lib/data/services/`, `lib/presentation/blocs/`, `lib/presentation/screens/`, `lib/presentation/widgets/`, `lib/presentation/theme/` directories
    - Define all enums: `TimeDuration`, `TradeDirection`, `TradeCategory`, `ChartType`, `ZoneType`, `ConnectionStatus`, `ThemeMode`, `AssetType`, `RecommendationStatus`
    - Define data model classes: `OhlcCandle`, `PriceZone`, `Recommendation`, `RewardRiskRatio`, `Holding`, `PortfolioSummary`, `HoldingValuation`, `PriceUpdate`, `AssetSearchResult`, `AssetPrice`
    - Define a generic `Result<T>` type for operation outcomes with success/error states
    - _Requirements: 1.1, 3.2, 3.3, 5.5, 6.1_

  - [x] 1.2 Define abstract interfaces for all services
    - Create `IMarketDataService` interface with `priceStream`, `getPrice`, `searchAssets`, `getOhlcData`, `subscribe`, `unsubscribe`, `connectionStatus`
    - Create `IPortfolioTracker` interface with `addHolding`, `getHoldings`, `recalculate`, `removeHolding`
    - Create `IValuationsEngine` interface with `identifySupplyZones`, `identifyDemandZones`, `generateRecommendations`, `calculateRewardRisk`, `categorize`, `isCompleted`
    - Create `IChartController` interface with `loadChartData`, `toggleChartType`, `currentChartType`
    - Create `IThemeManager` interface with `currentTheme`, `toggleTheme`, `loadPersistedTheme`, `persistTheme`
    - _Requirements: 1.1, 2.1, 3.1, 5.1, 7.1_

  - [x] 1.3 Add project dependencies to pubspec.yaml
    - Add `flutter_bloc`, `equatable`, `fl_chart`, `web_socket_channel`, `http`, `shared_preferences`, `get_it` (DI)
    - Add dev dependencies: `bloc_test`, `mocktail`, `dart_check` (property-based testing)
    - _Requirements: All_

- [x] 2. Implement Portfolio Tracker
  - [x] 2.1 Implement PortfolioTracker with input validation and holding management
    - Implement `addHolding` with validation: symbol non-empty, quantity in [0.0001, 999999999] with ≤4 decimal places, price in [0.01, 999999999.99] with ≤2 decimal places
    - Implement weighted average recalculation for duplicate symbols: `(Q1*P1 + Q2*P2) / (Q1+Q2)`
    - Implement `getHoldings`, `removeHolding`, `recalculate` methods
    - Return `Result` with field-specific error messages for invalid inputs
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

  - [x] 2.2 Write property test for valid holding storage round-trip
    - **Property 1: Valid holding storage round-trip**
    - **Validates: Requirements 1.1**

  - [x] 2.3 Write property test for invalid input rejection
    - **Property 2: Invalid input rejection**
    - **Validates: Requirements 1.2**

  - [x] 2.4 Write property test for weighted average calculation
    - **Property 3: Weighted average calculation**
    - **Validates: Requirements 1.3**

  - [x] 2.5 Write property test for portfolio valuation arithmetic
    - **Property 4: Portfolio valuation arithmetic**
    - **Validates: Requirements 1.4**

- [x] 3. Implement Valuations Engine
  - [x] 3.1 Implement supply and demand zone detection
    - Implement `identifySupplyZones` — detect price areas with ≥2 price rejections
    - Implement `identifyDemandZones` — detect price areas with ≥2 price bounces
    - Return empty lists when insufficient historical data is available
    - _Requirements: 3.5, 3.6_

  - [x] 3.2 Implement recommendation generation and R:R calculation
    - Implement `calculateRewardRisk` — for buys: `(target - entry) / (entry - stopLoss)`, for shorts: `(entry - target) / (stopLoss - entry)`
    - Handle zero denominator (entry == stopLoss) by returning error, not generating recommendation
    - Implement `generateRecommendations` — generate buy when price within 1% of demand zone and R:R > 1.00, short when within 1% of supply zone and R:R > 1.00
    - Implement `categorize` — day trade (<24h), swing trade (1d–2wk), position trade (>2wk)
    - Implement `isCompleted` — mark completed when target or stop loss is hit
    - Filter incomplete recommendations (missing entry, stop, or target)
    - _Requirements: 3.1, 3.2, 3.3, 3.7, 3.8, 3.9, 4.7_

  - [x] 3.3 Write property test for trade category assignment
    - **Property 6: Trade category assignment**
    - **Validates: Requirements 3.2**

  - [x] 3.4 Write property test for Reward/Risk ratio formula
    - **Property 7: Reward/Risk ratio formula**
    - **Validates: Requirements 3.3**

  - [x] 3.5 Write property test for zone detection minimum touch count
    - **Property 9: Zone detection requires minimum touch count**
    - **Validates: Requirements 3.5, 3.6**

  - [x] 3.6 Write property test for recommendation generation near zone boundaries
    - **Property 10: Recommendation generation near zone boundaries**
    - **Validates: Requirements 3.7, 3.8**

  - [x] 3.7 Write property test for recommendation completion detection
    - **Property 11: Recommendation completion detection**
    - **Validates: Requirements 3.9**

  - [x] 3.8 Write property test for recommendations sorted by R:R descending
    - **Property 8: Recommendations sorted by R:R descending**
    - **Validates: Requirements 3.4**

  - [x] 3.9 Write property test for incomplete recommendation filtering
    - **Property 13: Incomplete recommendation filtering**
    - **Validates: Requirements 4.7**

- [x] 4. Checkpoint - Core domain logic validation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Market Data Service
  - [x] 5.1 Implement MarketDataService with REST and WebSocket
    - Implement REST calls for `getPrice`, `searchAssets`, `getOhlcData`
    - Implement WebSocket connection for real-time price streaming via `priceStream`
    - Implement `subscribe`/`unsubscribe` for symbol management
    - Expose `connectionStatus` stream with connected/disconnected/reconnecting states
    - Implement exponential backoff reconnection on WebSocket disconnection
    - _Requirements: 2.1, 2.2, 2.5, 2.6_

  - [x] 5.2 Implement MarketDataRepository with caching and fallback
    - Create repository wrapping MarketDataService
    - Cache last-known prices for stale data fallback
    - Implement 60-second polling interval during market hours
    - Handle API timeouts (3s for chart data, 60s for portfolio)
    - _Requirements: 1.5, 1.7, 2.5, 2.6, 6.7_

- [x] 6. Implement Local Storage and Theme Manager
  - [x] 6.1 Implement ThemeManager with SharedPreferences persistence
    - Implement `toggleTheme`, `loadPersistedTheme`, `persistTheme`
    - Default to dark theme on first launch or corrupted preference
    - Persist within 1 second of selection
    - Handle write failures gracefully (apply in memory, retry)
    - _Requirements: 7.1, 7.4, 7.5, 7.6_

  - [x] 6.2 Write property test for theme persistence round-trip
    - **Property 16: Theme persistence round-trip**
    - **Validates: Requirements 7.4**

  - [x] 6.3 Implement PortfolioRepository for local persistence
    - Persist portfolio holdings to local storage
    - Load holdings on app startup
    - _Requirements: 1.1_

- [x] 7. Implement BLoC State Management
  - [x] 7.1 Implement PortfolioBLoC
    - Handle events: `LoadPortfolio`, `AddHolding`, `RemoveHolding`, `PriceUpdated`
    - Emit states: `PortfolioLoading`, `PortfolioLoaded`, `PortfolioError`
    - Wire to PortfolioTracker and MarketDataRepository
    - Recalculate portfolio within 2 seconds of price update
    - Handle empty portfolio state
    - _Requirements: 1.4, 1.6, 1.7, 1.8_

  - [x] 7.2 Implement MarketDataBLoC
    - Handle events: `SearchAsset`, `SelectAsset`, `SubscribeSymbols`
    - Emit states: `MarketDataInitial`, `SearchResults`, `AssetDetail`, `ConnectionWarning`
    - Wire to MarketDataService
    - Enforce minimum 1 character search input
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 2.7_

  - [x] 7.3 Implement ValuationsBLoC
    - Handle events: `LoadRecommendations`, `PriceUpdated`, `CheckCompletion`
    - Emit states: `ValuationsLoading`, `ValuationsLoaded`, `NoRecommendations`
    - Sort active recommendations by R:R descending
    - Filter incomplete recommendations from display
    - _Requirements: 3.4, 3.9, 3.10, 4.7_

  - [x] 7.4 Implement ChartBLoC
    - Handle events: `LoadChart`, `ToggleChartType`, `ChangeDuration`
    - Emit states: `ChartLoading`, `ChartLoaded`, `ChartError`, `InsufficientData`
    - Default to 24hr duration on first display
    - Maintain chart type across duration changes
    - Show loading indicator during data fetches
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.8, 6.2, 6.3, 6.5, 6.6_

  - [x] 7.5 Write property test for chart type independence from time duration
    - **Property 15: Chart type independence from time duration**
    - **Validates: Requirements 6.5**

- [x] 8. Checkpoint - State management validation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Neon Theme and Color System
  - [x] 9.1 Define neon color palette and theme data for light and dark modes
    - Create `NeonTheme` class with light and dark `ThemeData`
    - Define neon green (buy/positive), neon red (short/negative), accent colors
    - Ensure 4.5:1 text contrast ratio and 3:1 non-text contrast ratio in both themes
    - Apply neon glow effects to buttons and toggles while maintaining contrast
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 9.2 Write property test for color contrast accessibility
    - **Property 17: Color contrast accessibility**
    - **Validates: Requirements 8.4, 8.5**

  - [x] 9.3 Write property test for directional color assignment
    - **Property 18: Directional color assignment**
    - **Validates: Requirements 8.2, 8.3**

- [x] 10. Implement Presentation Layer - Screens and Widgets
  - [x] 10.1 Implement Portfolio Screen
    - Display holdings list with symbol, quantity, current price, total value, unrealized gain/loss
    - All numeric values formatted to 2 decimal places
    - Show empty state message when no holdings
    - Show stale data indicator with elapsed time when prices are outdated
    - Add holding form with validation error display
    - _Requirements: 1.4, 1.7, 1.8, 2.4_

  - [x] 10.2 Implement Market Data and Search Screen
    - Search input with minimum 1-character threshold
    - Display search results: symbol, name, current price, percentage change
    - Asset detail view: price, daily high/low, volume, percentage change
    - Connection warning banner when disconnected
    - No results message
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 2.7_

  - [x] 10.3 Implement Recommendations Screen
    - Display recommendation cards: symbol, name, direction (BUY/SHORT), trade category, R:R, entry/stop/target prices
    - Sort by R:R descending
    - Visually distinguish trade categories with distinct neon colors
    - Use directional icons in addition to color for buy vs short (accessibility)
    - Show "no current trade setups" message when empty
    - _Requirements: 3.4, 3.10, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 8.6_

  - [x] 10.4 Write property test for numeric display formatting
    - **Property 5: Numeric display formatting**
    - **Validates: Requirements 2.4, 4.5**

  - [x] 10.5 Write property test for R:R display format
    - **Property 12: R:R display format**
    - **Validates: Requirements 4.3**

- [x] 11. Implement Chart View with Candlestick Toggle
  - [x] 11.1 Implement Chart Widget with line and candlestick rendering
    - Default to line chart displaying close prices
    - Implement candlestick rendering: body = open/close, wicks = high/low
    - Color bullish candles (close > open) and bearish candles (close < open) with distinct neon colors
    - Toggle button with visual indication of active chart type
    - Switch between chart types within 1 second
    - Handle insufficient data (< 2 points) with message
    - Skip invalid OHLC data (high < low)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 11.2 Implement Time Duration Selector
    - Display all 14 time duration options
    - Highlight selected duration with neon color
    - Default to 24hr on first display
    - Show loading indicator during data fetch
    - Reload chart data within 3 seconds of selection
    - Maintain chart type on duration change
    - Display error message on load failure, retain previous data
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 11.3 Write property test for candlestick geometry correctness
    - **Property 14: Candlestick geometry correctness**
    - **Validates: Requirements 5.5, 5.6**

- [x] 12. Implement Theme Toggle and App Shell
  - [x] 12.1 Implement theme toggle and app-wide theme application
    - Add toggle control for light/dark mode
    - Apply theme immediately without restart across all screens
    - Wire to ThemeManager for persistence
    - Default to dark theme on first launch
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 13. Wire all components together and integrate
  - [x] 13.1 Set up dependency injection and app entry point
    - Register all services and repositories with `get_it`
    - Initialize BLoCs with injected dependencies
    - Set up app routing/navigation between screens
    - Initialize WebSocket connection and subscriptions on startup
    - Load persisted theme and portfolio data on launch
    - _Requirements: All_

  - [x] 13.2 Write integration tests for end-to-end flows
    - Test price update → portfolio recalculation → UI update
    - Test search → select asset → view chart flow
    - Test recommendation generation → display → completion lifecycle
    - Test theme toggle persistence across app restart
    - _Requirements: 1.4, 1.6, 2.2, 3.4, 7.4_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation of core domain logic and state management
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `dart_check` library is used for property-based testing with minimum 100 iterations per property
- All BLoCs should be tested with `bloc_test` for event→state mapping verification

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "3.1", "6.1", "6.3"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.2", "5.1", "6.2"] },
    { "id": 3, "tasks": ["3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "5.2"] },
    { "id": 4, "tasks": ["7.1", "7.2", "7.3", "7.4", "9.1"] },
    { "id": 5, "tasks": ["7.5", "9.2", "9.3"] },
    { "id": 6, "tasks": ["10.1", "10.2", "10.3", "11.1", "11.2", "12.1"] },
    { "id": 7, "tasks": ["10.4", "10.5", "11.3"] },
    { "id": 8, "tasks": ["13.1"] },
    { "id": 9, "tasks": ["13.2"] }
  ]
}
```
