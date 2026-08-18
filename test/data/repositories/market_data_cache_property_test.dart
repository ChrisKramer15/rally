import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rally/data/repositories/market_data_repository.dart';
import 'package:rally/domain/models/asset_price.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/models/market_data_exception.dart';
import 'package:rally/domain/models/price_update.dart';
import 'package:rally/domain/services/i_market_data_service.dart';

// --- Mocks ---
class MockMarketDataService extends Mock implements IMarketDataService {}

/// Feature: market-data-display
/// Property-based tests for MarketDataRepository cache behavior
///
/// Property 8: Cache stores fetched prices and returns fresh ones without
/// network call
/// "For any symbol, after a successful price fetch, subsequent requests within
/// 60 seconds SHALL return the cached price without making a network request to
/// the service."
///
/// **Validates: Requirements 6.1, 6.2**
///
/// Property 9: Cache fallback on network failure
/// "For any symbol with a cached price, if the network fetch fails, the
/// repository SHALL return the previously cached price rather than
/// propagating the error."
///
/// **Validates: Requirements 6.3**
void main() {
  group(
      'Feature: market-data-display, '
      'Property 8: Cache stores fetched prices and returns fresh ones without network call',
      () {
    // **Validates: Requirements 6.1, 6.2**

    late MockMarketDataService mockService;
    late MarketDataRepository repository;

    setUp(() {
      mockService = MockMarketDataService();

      // Stub streams required by MarketDataRepository
      when(() => mockService.priceStream)
          .thenAnswer((_) => const Stream<PriceUpdate>.empty());
      when(() => mockService.connectionStatus)
          .thenAnswer((_) => const Stream<ConnectionStatus>.empty());

      repository = MarketDataRepository(service: mockService);
    });

    property(
        'second getPrice call returns cached price without invoking service again',
        () {
      // Generate random symbol + AssetPrice pairs
      final symbolAndPriceArb = combine5(
        // symbol: random alphanumeric string (1-6 chars)
        string(minLength: 1, maxLength: 6),
        // price: positive double
        integer(min: 1, max: 99999999).map((i) => i / 100.0),
        // dailyHigh: positive double
        integer(min: 1, max: 99999999).map((i) => i / 100.0),
        // volume: non-negative double
        integer(min: 0, max: 9999999999).map((i) => i / 100.0),
        // percentageChange: can be negative
        integer(min: -10000, max: 100000).map((i) => i / 100.0),
      ).map((tuple) {
        final symbol = tuple.$1;
        final price = AssetPrice(
          symbol: symbol,
          price: tuple.$2,
          dailyHigh: tuple.$3,
          dailyLow: tuple.$2 * 0.95,
          volume: tuple.$4,
          percentageChange: tuple.$5,
          timestamp: DateTime.utc(2024, 1, 15, 14, 30, 0),
        );
        return (symbol: symbol, price: price);
      });

      forAll(
        symbolAndPriceArb,
        (record) async {
          // Reset mock for this iteration
          reset(mockService);

          // Re-stub streams after reset
          when(() => mockService.priceStream)
              .thenAnswer((_) => const Stream<PriceUpdate>.empty());
          when(() => mockService.connectionStatus)
              .thenAnswer((_) => const Stream<ConnectionStatus>.empty());

          // Create fresh repository for each iteration to avoid cross-contamination
          repository = MarketDataRepository(service: mockService);

          // Configure mock to return the generated price
          when(() => mockService.getPrice(record.symbol))
              .thenAnswer((_) async => record.price);

          // First call: populates the cache
          final firstResult = await repository.getPrice(record.symbol);
          expect(firstResult, equals(record.price),
              reason: 'First call should return the fetched price');

          // Second call: should use cache (within 60s window)
          final secondResult = await repository.getPrice(record.symbol);
          expect(secondResult, equals(record.price),
              reason: 'Second call should return the same cached price');

          // Verify service was called exactly once (first call only)
          verify(() => mockService.getPrice(record.symbol)).called(1);
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: market-data-display, '
      'Property 9: Cache fallback on network failure', () {
    // **Validates: Requirements 6.3**

    late MockMarketDataService mockService;
    late MarketDataRepository repository;

    setUp(() {
      mockService = MockMarketDataService();
      when(() => mockService.priceStream)
          .thenAnswer((_) => const Stream<PriceUpdate>.empty());
      when(() => mockService.connectionStatus)
          .thenAnswer((_) => const Stream<ConnectionStatus>.empty());
      repository = MarketDataRepository(service: mockService);
    });

    property(
        'returns cached price when network fails after cache is populated', () {
      // Generate random AssetPrice objects with random symbols
      final assetPriceArb = combine5(
        // symbol: random non-empty string
        string(minLength: 1, maxLength: 8),
        // price: positive double
        integer(min: 1, max: 99999999).map((i) => i / 100.0),
        // dailyHigh: positive double
        integer(min: 1, max: 99999999).map((i) => i / 100.0),
        // volume: non-negative double
        integer(min: 0, max: 9999999999).map((i) => i / 100.0),
        // percentageChange: can be negative
        integer(min: -10000, max: 100000).map((i) => i / 100.0),
      ).map((tuple) {
        final timestamp = DateTime.utc(2024, 1, 15, 14, 30, 0);
        return AssetPrice(
          symbol: tuple.$1,
          price: tuple.$2,
          dailyHigh: tuple.$3,
          dailyLow: tuple.$2 * 0.95,
          volume: tuple.$4,
          percentageChange: tuple.$5,
          timestamp: timestamp,
        );
      });

      forAll(
        assetPriceArb,
        (cachedPrice) async {
          // Reset mock and repository for each iteration
          reset(mockService);
          when(() => mockService.priceStream)
              .thenAnswer((_) => const Stream<PriceUpdate>.empty());
          when(() => mockService.connectionStatus)
              .thenAnswer((_) => const Stream<ConnectionStatus>.empty());
          repository = MarketDataRepository(service: mockService);

          final symbol = cachedPrice.symbol;

          // Step 1: Configure mock to return the price on first call
          when(() => mockService.getPrice(symbol))
              .thenAnswer((_) async => cachedPrice);

          // Step 2: Call getPrice to populate the cache
          final firstResult = await repository.getPrice(symbol);
          expect(firstResult, equals(cachedPrice));

          // Step 3: Expire the cache entry to force a re-fetch attempt
          repository.expireCacheEntry(symbol);

          // Step 4: Configure mock to throw an exception on next call
          when(() => mockService.getPrice(symbol))
              .thenThrow(MarketDataException('Network error'));

          // Step 5: Call getPrice again — should return cached price (fallback)
          final fallbackResult = await repository.getPrice(symbol);

          // Verify: cached price is returned, no exception thrown
          expect(fallbackResult, equals(cachedPrice),
              reason:
                  'Expected cached price fallback for symbol=$symbol but got different result');
        },
        maxExamples: 100,
      );
    });

    property(
        'propagates error when no cache exists and service fails', () {
      // Generate random symbols that have never been cached
      forAll(
        string(minLength: 1, maxLength: 8),
        (symbol) async {
          // Reset mock and repository for each iteration
          reset(mockService);
          when(() => mockService.priceStream)
              .thenAnswer((_) => const Stream<PriceUpdate>.empty());
          when(() => mockService.connectionStatus)
              .thenAnswer((_) => const Stream<ConnectionStatus>.empty());
          repository = MarketDataRepository(service: mockService);

          // Configure mock to throw an exception (no cache exists)
          when(() => mockService.getPrice(symbol))
              .thenThrow(MarketDataException('Network error'));

          // Verify error IS propagated when no cache exists
          expect(
            () => repository.getPrice(symbol),
            throwsA(isA<MarketDataException>()),
            reason:
                'Expected error to propagate for uncached symbol=$symbol',
          );
        },
        maxExamples: 100,
      );
    });
  });
}
