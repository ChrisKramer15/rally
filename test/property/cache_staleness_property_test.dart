import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rally/data/repositories/market_data_repository.dart';
import 'package:rally/domain/models/asset_price.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/models/price_update.dart';
import 'package:rally/domain/services/i_market_data_service.dart';

// --- Mocks ---
class MockMarketDataService extends Mock implements IMarketDataService {}

/// Feature: live-market-data
/// Property-based tests for MarketDataRepository cache behavior
///
/// Property 7: Cache update from PriceUpdate
/// "For any valid PriceUpdate received while the WebSocket is connected, after
/// processing the update the repository cache for that symbol contains an
/// AssetPrice with matching price, dailyHigh, dailyLow, volume,
/// percentageChange, and timestamp values."
///
/// **Validates: Requirements 5.1**
///
/// Property 8: Staleness threshold
/// "For any cached price entry, the entry is considered stale if and only if
/// the current time minus the entry's fetch time exceeds 60 seconds. Entries
/// at or below 60 seconds are considered fresh."
///
/// **Validates: Requirements 5.4**
///
/// Property 13: Cache lookup correctness
/// "For any repository cache state and any query symbol, retrieving the cached
/// price returns the AssetPrice if and only if the symbol exists in the cache,
/// and returns null otherwise."
///
/// **Validates: Requirements 7.1**
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group(
      'Feature: live-market-data, '
      'Property 7: Cache update from PriceUpdate', () {
    // **Validates: Requirements 5.1**

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
        'cache contains matching AssetPrice after processing a random PriceUpdate',
        () {
      // Generator for random symbol strings (1–10 uppercase chars)
      final symbolArb = integer(min: 1, max: 10).flatMap((length) {
        return list(
          integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      // Generator for random prices (0.01–100000.0)
      final priceArb =
          integer(min: 1, max: 10000000).map((i) => i / 100.0);

      // Generator for random volume (0.0–1000000000.0)
      final volumeArb =
          integer(min: 0, max: 1000000000).map((i) => i.toDouble());

      // Generator for random percentage change (-100.0–100.0)
      final percentageArb =
          integer(min: -10000, max: 10000).map((i) => i / 100.0);

      // Generator for random UTC timestamps (years 2000–2030)
      final timestampArb = integer(
        min: 946684800000, // 2000-01-01T00:00:00Z in ms
        max: 1893456000000, // 2030-01-01T00:00:00Z in ms
      ).map((ms) => DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true));

      // Combined generator for PriceUpdate fields
      final priceUpdateArb = combine3(
        combine2(symbolArb, priceArb),
        combine3(priceArb, priceArb, volumeArb),
        combine2(percentageArb, timestampArb),
      );

      forAll(
        priceUpdateArb,
        (tuple) {
          final symbolAndPrice = tuple.$1;
          final highLowVol = tuple.$2;
          final pctAndTs = tuple.$3;

          final symbol = symbolAndPrice.$1;
          final price = symbolAndPrice.$2;
          final dailyHigh = highLowVol.$1;
          final dailyLow = highLowVol.$2;
          final volume = highLowVol.$3;
          final percentageChange = pctAndTs.$1;
          final timestamp = pctAndTs.$2;

          // Construct random PriceUpdate
          final update = PriceUpdate(
            symbol: symbol,
            price: price,
            dailyHigh: dailyHigh,
            dailyLow: dailyLow,
            volume: volume,
            percentageChange: percentageChange,
            timestamp: timestamp,
          );

          // Process the update through the repository
          repository.updateCacheFromPriceUpdate(update);

          // Retrieve the cached price
          final cached = repository.getCachedPrice(symbol);

          // Verify that the cache contains an entry for the symbol
          expect(cached, isNotNull,
              reason:
                  'Cache should contain an AssetPrice for symbol "$symbol" '
                  'after processing PriceUpdate');

          // Verify all fields match
          expect(cached!.symbol, equals(symbol),
              reason: 'Cached symbol mismatch: '
                  'expected "$symbol", got "${cached.symbol}"');
          expect(cached.price, equals(price),
              reason: 'Cached price mismatch: '
                  'expected $price, got ${cached.price}');
          expect(cached.dailyHigh, equals(dailyHigh),
              reason: 'Cached dailyHigh mismatch: '
                  'expected $dailyHigh, got ${cached.dailyHigh}');
          expect(cached.dailyLow, equals(dailyLow),
              reason: 'Cached dailyLow mismatch: '
                  'expected $dailyLow, got ${cached.dailyLow}');
          expect(cached.volume, equals(volume),
              reason: 'Cached volume mismatch: '
                  'expected $volume, got ${cached.volume}');
          expect(cached.percentageChange, equals(percentageChange),
              reason: 'Cached percentageChange mismatch: '
                  'expected $percentageChange, got ${cached.percentageChange}');
          expect(cached.timestamp, equals(timestamp),
              reason: 'Cached timestamp mismatch: '
                  'expected $timestamp, got ${cached.timestamp}');
        },
        maxExamples: 100,
      );
    });

    property(
        'later PriceUpdate for the same symbol overwrites previous cached value',
        () {
      // Generator for random symbol strings (1–6 uppercase chars)
      final symbolArb = integer(min: 1, max: 6).flatMap((length) {
        return list(
          integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      // Generator for random prices
      final priceArb =
          integer(min: 1, max: 10000000).map((i) => i / 100.0);

      // Generator for random volume
      final volumeArb =
          integer(min: 0, max: 1000000000).map((i) => i.toDouble());

      // Generator for random percentage change
      final percentageArb =
          integer(min: -10000, max: 10000).map((i) => i / 100.0);

      // Generator for random UTC timestamps
      final timestampArb = integer(
        min: 946684800000,
        max: 1893456000000,
      ).map((ms) => DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true));

      forAll(
        combine3(
          symbolArb,
          // First update fields
          combine3(
            combine2(priceArb, priceArb),
            combine2(priceArb, volumeArb),
            combine2(percentageArb, timestampArb),
          ),
          // Second update fields
          combine3(
            combine2(priceArb, priceArb),
            combine2(priceArb, volumeArb),
            combine2(percentageArb, timestampArb),
          ),
        ),
        (tuple) {
          final symbol = tuple.$1;
          final firstFields = tuple.$2;
          final secondFields = tuple.$3;

          // First PriceUpdate
          final update1 = PriceUpdate(
            symbol: symbol,
            price: firstFields.$1.$1,
            dailyHigh: firstFields.$1.$2,
            dailyLow: firstFields.$2.$1,
            volume: firstFields.$2.$2,
            percentageChange: firstFields.$3.$1,
            timestamp: firstFields.$3.$2,
          );

          // Second PriceUpdate (same symbol, different values)
          final update2 = PriceUpdate(
            symbol: symbol,
            price: secondFields.$1.$1,
            dailyHigh: secondFields.$1.$2,
            dailyLow: secondFields.$2.$1,
            volume: secondFields.$2.$2,
            percentageChange: secondFields.$3.$1,
            timestamp: secondFields.$3.$2,
          );

          // Process first update
          repository.updateCacheFromPriceUpdate(update1);

          // Process second update (should overwrite)
          repository.updateCacheFromPriceUpdate(update2);

          // Retrieve the cached price
          final cached = repository.getCachedPrice(symbol);

          // Verify the cache contains the SECOND update's values
          expect(cached, isNotNull,
              reason: 'Cache should contain an entry for "$symbol"');
          expect(cached!.price, equals(update2.price),
              reason: 'Price should be from the latest update');
          expect(cached.dailyHigh, equals(update2.dailyHigh),
              reason: 'dailyHigh should be from the latest update');
          expect(cached.dailyLow, equals(update2.dailyLow),
              reason: 'dailyLow should be from the latest update');
          expect(cached.volume, equals(update2.volume),
              reason: 'volume should be from the latest update');
          expect(cached.percentageChange, equals(update2.percentageChange),
              reason: 'percentageChange should be from the latest update');
          expect(cached.timestamp, equals(update2.timestamp),
              reason: 'timestamp should be from the latest update');
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: live-market-data, '
      'Property 8: Staleness threshold', () {
    // **Validates: Requirements 5.4**

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
        'a freshly cached entry (fetched just now) is NOT stale', () {
      // Generate random PriceUpdate instances
      final priceUpdateArb = combine5(
        // symbol: 1-6 uppercase chars
        integer(min: 1, max: 6).flatMap((length) {
          return list(
            integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
            minLength: length,
            maxLength: length,
          ).map((chars) => chars.join());
        }),
        // price: positive double
        integer(min: 1, max: 99999999).map((i) => i / 100.0),
        // dailyHigh: positive double
        integer(min: 1, max: 99999999).map((i) => i / 100.0),
        // volume: non-negative double
        integer(min: 0, max: 9999999999).map((i) => i / 100.0),
        // percentageChange: can be negative
        integer(min: -10000, max: 100000).map((i) => i / 100.0),
      ).map((tuple) {
        return PriceUpdate(
          symbol: tuple.$1,
          price: tuple.$2,
          dailyHigh: tuple.$3,
          dailyLow: tuple.$2 * 0.95,
          volume: tuple.$4,
          percentageChange: tuple.$5,
          timestamp: DateTime.now().toUtc(),
        );
      });

      forAll(
        priceUpdateArb,
        (update) {
          // Reset repository for each iteration
          reset(mockService);
          when(() => mockService.priceStream)
              .thenAnswer((_) => const Stream<PriceUpdate>.empty());
          when(() => mockService.connectionStatus)
              .thenAnswer((_) => const Stream<ConnectionStatus>.empty());
          repository = MarketDataRepository(service: mockService);

          // Cache the entry — fetchedAt will be DateTime.now()
          repository.updateCacheFromPriceUpdate(update);

          // Immediately after caching, the entry should NOT be stale
          // (offset is ~0 seconds, well under 60 seconds)
          final stale = repository.isStale(update.symbol);
          expect(stale, isFalse,
              reason:
                  'A freshly cached entry for "${update.symbol}" should not be '
                  'stale (fetchedAt ≈ now, offset < 60s)');
        },
        maxExamples: 100,
      );
    });

    property(
        'an expired cache entry (backdated beyond 60s) IS stale', () {
      // Generate random PriceUpdate instances
      final priceUpdateArb = combine5(
        // symbol: 1-6 uppercase chars
        integer(min: 1, max: 6).flatMap((length) {
          return list(
            integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
            minLength: length,
            maxLength: length,
          ).map((chars) => chars.join());
        }),
        // price: positive double
        integer(min: 1, max: 99999999).map((i) => i / 100.0),
        // dailyHigh: positive double
        integer(min: 1, max: 99999999).map((i) => i / 100.0),
        // volume: non-negative double
        integer(min: 0, max: 9999999999).map((i) => i / 100.0),
        // percentageChange: can be negative
        integer(min: -10000, max: 100000).map((i) => i / 100.0),
      ).map((tuple) {
        return PriceUpdate(
          symbol: tuple.$1,
          price: tuple.$2,
          dailyHigh: tuple.$3,
          dailyLow: tuple.$2 * 0.95,
          volume: tuple.$4,
          percentageChange: tuple.$5,
          timestamp: DateTime.now().toUtc(),
        );
      });

      forAll(
        priceUpdateArb,
        (update) {
          // Reset repository for each iteration
          reset(mockService);
          when(() => mockService.priceStream)
              .thenAnswer((_) => const Stream<PriceUpdate>.empty());
          when(() => mockService.connectionStatus)
              .thenAnswer((_) => const Stream<ConnectionStatus>.empty());
          repository = MarketDataRepository(service: mockService);

          // Cache the entry first
          repository.updateCacheFromPriceUpdate(update);

          // Expire the entry (backdates fetchedAt by 61 seconds)
          repository.expireCacheEntry(update.symbol);

          // The entry should now be stale (offset > 60s)
          final stale = repository.isStale(update.symbol);
          expect(stale, isTrue,
              reason:
                  'An expired cache entry for "${update.symbol}" should be '
                  'stale (fetchedAt backdated by 61s, offset > 60s)');
        },
        maxExamples: 100,
      );
    });

    property(
        'a non-existent cache entry is always considered stale', () {
      // Generate random symbol strings that won't be in the cache
      final symbolArb = integer(min: 1, max: 10).flatMap((length) {
        return list(
          integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      forAll(
        symbolArb,
        (symbol) {
          // Reset repository for each iteration (empty cache)
          reset(mockService);
          when(() => mockService.priceStream)
              .thenAnswer((_) => const Stream<PriceUpdate>.empty());
          when(() => mockService.connectionStatus)
              .thenAnswer((_) => const Stream<ConnectionStatus>.empty());
          repository = MarketDataRepository(service: mockService);

          // Without caching anything, the entry should be stale
          final stale = repository.isStale(symbol);
          expect(stale, isTrue,
              reason:
                  'A non-existent cache entry for "$symbol" should always be '
                  'considered stale');
        },
        maxExamples: 100,
      );
    });

    property(
        'staleness is exclusive: entry at exactly the boundary behaves per implementation (> 60s is stale)',
        () {
      // Generate random symbols and multiple price updates to test consistency
      final symbolCountArb = integer(min: 1, max: 10);

      forAll(
        symbolCountArb,
        (count) {
          // Reset repository
          reset(mockService);
          when(() => mockService.priceStream)
              .thenAnswer((_) => const Stream<PriceUpdate>.empty());
          when(() => mockService.connectionStatus)
              .thenAnswer((_) => const Stream<ConnectionStatus>.empty());
          repository = MarketDataRepository(service: mockService);

          final symbols = <String>[];
          // Cache multiple entries
          for (int i = 0; i < count; i++) {
            final symbol = 'SYM${i.toString().padLeft(3, '0')}';
            symbols.add(symbol);
            final update = PriceUpdate(
              symbol: symbol,
              price: 100.0 + i,
              dailyHigh: 110.0 + i,
              dailyLow: 90.0 + i,
              volume: 1000000.0 + i,
              percentageChange: 1.5 + i * 0.1,
              timestamp: DateTime.now().toUtc(),
            );
            repository.updateCacheFromPriceUpdate(update);
          }

          // All freshly cached entries are NOT stale
          for (final symbol in symbols) {
            expect(repository.isStale(symbol), isFalse,
                reason: 'Fresh entry "$symbol" should not be stale');
          }

          // Expire odd-indexed entries only
          for (int i = 0; i < symbols.length; i++) {
            if (i.isOdd) {
              repository.expireCacheEntry(symbols[i]);
            }
          }

          // Verify: even-indexed entries still fresh, odd-indexed are stale
          for (int i = 0; i < symbols.length; i++) {
            if (i.isOdd) {
              expect(repository.isStale(symbols[i]), isTrue,
                  reason:
                      'Expired entry "${symbols[i]}" should be stale');
            } else {
              expect(repository.isStale(symbols[i]), isFalse,
                  reason:
                      'Fresh entry "${symbols[i]}" should not be stale');
            }
          }
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: live-market-data, '
      'Property 13: Cache lookup correctness', () {
    // **Validates: Requirements 7.1**

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
        'getCachedPrice returns AssetPrice iff symbol is in cache, null otherwise',
        () {
      // Generator for random symbol strings (1–6 uppercase chars)
      final symbolArb = integer(min: 1, max: 6).flatMap((length) {
        return list(
          integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      // Generator for a set of symbols to cache (0–20 unique symbols)
      final cachedSymbolsArb = integer(min: 0, max: 20).flatMap((size) {
        return list(
          symbolArb,
          minLength: size + 5,
          maxLength: size + 15,
        ).map((symbols) {
          final unique = symbols.toSet().toList();
          return unique.take(size).toList();
        });
      });

      // Generator for query symbols (mix of potentially cached and non-cached)
      final querySymbolsArb = list(
        symbolArb,
        minLength: 5,
        maxLength: 15,
      );

      // Generator for random price data
      final priceArb =
          integer(min: 1, max: 10000000).map((i) => i / 100.0);
      final volumeArb =
          integer(min: 0, max: 1000000000).map((i) => i.toDouble());
      final percentageArb =
          integer(min: -10000, max: 10000).map((i) => i / 100.0);
      final timestampArb = integer(
        min: 946684800000,
        max: 1893456000000,
      ).map((ms) => DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true));

      forAll(
        combine3(
          cachedSymbolsArb,
          querySymbolsArb,
          combine3(priceArb, volumeArb, combine2(percentageArb, timestampArb)),
        ),
        (tuple) {
          final cachedSymbols = tuple.$1;
          final querySymbols = tuple.$2;
          final priceData = tuple.$3;
          final price = priceData.$1;
          final volume = priceData.$2;
          final pctAndTs = priceData.$3;
          final percentageChange = pctAndTs.$1;
          final timestamp = pctAndTs.$2;

          // Create a fresh repository for each test case
          reset(mockService);
          when(() => mockService.priceStream)
              .thenAnswer((_) => const Stream<PriceUpdate>.empty());
          when(() => mockService.connectionStatus)
              .thenAnswer((_) => const Stream<ConnectionStatus>.empty());
          repository = MarketDataRepository(service: mockService);

          // Populate the cache with the generated symbols
          for (final symbol in cachedSymbols) {
            final update = PriceUpdate(
              symbol: symbol,
              price: price,
              dailyHigh: price + 1.0,
              dailyLow: price - 1.0,
              volume: volume,
              percentageChange: percentageChange,
              timestamp: timestamp,
            );
            repository.updateCacheFromPriceUpdate(update);
          }

          // Query each query symbol and verify correctness
          for (final querySymbol in querySymbols) {
            final result = repository.getCachedPrice(querySymbol);
            final isInCache = cachedSymbols.contains(querySymbol);

            if (isInCache) {
              // Symbol was cached — getCachedPrice must return non-null AssetPrice
              expect(result, isNotNull,
                  reason:
                      'getCachedPrice("$querySymbol") should return non-null '
                      'because it was cached. Cached symbols: $cachedSymbols');
              expect(result, isA<AssetPrice>(),
                  reason:
                      'getCachedPrice("$querySymbol") should return an AssetPrice');
              expect(result!.symbol, equals(querySymbol),
                  reason:
                      'Returned AssetPrice symbol should match the queried symbol');
            } else {
              // Symbol was NOT cached — getCachedPrice must return null
              expect(result, isNull,
                  reason:
                      'getCachedPrice("$querySymbol") should return null '
                      'because it was not cached. Cached symbols: $cachedSymbols');
            }
          }
        },
        maxExamples: 100,
      );
    });

    property(
        'getCachedPrice returns correct AssetPrice data for cached symbols',
        () {
      // Generator for random symbol strings (1–6 uppercase chars)
      final symbolArb = integer(min: 1, max: 6).flatMap((length) {
        return list(
          integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      // Generator for random prices
      final priceArb =
          integer(min: 1, max: 10000000).map((i) => i / 100.0);
      final volumeArb =
          integer(min: 0, max: 1000000000).map((i) => i.toDouble());
      final percentageArb =
          integer(min: -10000, max: 10000).map((i) => i / 100.0);
      final timestampArb = integer(
        min: 946684800000,
        max: 1893456000000,
      ).map((ms) => DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true));

      forAll(
        combine3(
          symbolArb,
          combine3(priceArb, priceArb, priceArb),
          combine3(volumeArb, percentageArb, timestampArb),
        ),
        (tuple) {
          final symbol = tuple.$1;
          final prices = tuple.$2;
          final volPctTs = tuple.$3;

          final price = prices.$1;
          final dailyHigh = prices.$2;
          final dailyLow = prices.$3;
          final volume = volPctTs.$1;
          final percentageChange = volPctTs.$2;
          final timestamp = volPctTs.$3;

          // Create a fresh repository
          reset(mockService);
          when(() => mockService.priceStream)
              .thenAnswer((_) => const Stream<PriceUpdate>.empty());
          when(() => mockService.connectionStatus)
              .thenAnswer((_) => const Stream<ConnectionStatus>.empty());
          repository = MarketDataRepository(service: mockService);

          // Cache a PriceUpdate
          final update = PriceUpdate(
            symbol: symbol,
            price: price,
            dailyHigh: dailyHigh,
            dailyLow: dailyLow,
            volume: volume,
            percentageChange: percentageChange,
            timestamp: timestamp,
          );
          repository.updateCacheFromPriceUpdate(update);

          // Retrieve and verify all fields match
          final result = repository.getCachedPrice(symbol);
          expect(result, isNotNull,
              reason: 'Cached symbol "$symbol" should be retrievable');
          expect(result!.symbol, equals(symbol));
          expect(result.price, equals(price));
          expect(result.dailyHigh, equals(dailyHigh));
          expect(result.dailyLow, equals(dailyLow));
          expect(result.volume, equals(volume));
          expect(result.percentageChange, equals(percentageChange));
          expect(result.timestamp, equals(timestamp));
        },
        maxExamples: 100,
      );
    });
  });
}
