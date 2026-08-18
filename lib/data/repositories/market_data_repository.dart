import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../domain/models/asset_price.dart';
import '../../domain/models/asset_search_result.dart';
import '../../domain/models/enums.dart';
import '../../domain/models/ohlc_candle.dart';
import '../../domain/models/price_update.dart';
import '../../domain/services/i_market_data_service.dart';

/// Internal cache entry storing an [AssetPrice] alongside the time it was
/// fetched from the service.
class CacheEntry {
  final AssetPrice price;
  final DateTime fetchedAt;

  CacheEntry({required this.price, required this.fetchedAt});
}

/// Repository wrapping [IMarketDataService] with caching, polling, and
/// timeout handling.
///
/// Caches last-known prices per symbol for stale data fallback. Applies a
/// 60-second freshness window — cached prices younger than 60 seconds are
/// returned without a network call.
class MarketDataRepository {
  final IMarketDataService _service;

  /// Cache of last-known prices keyed by symbol.
  final Map<String, CacheEntry> _cache = {};

  /// Duration after which a cached price is considered stale.
  static const Duration staleDuration = Duration(seconds: 60);

  /// Timeout for chart/OHLC data fetches.
  static const Duration chartTimeout = Duration(seconds: 3);

  /// Timeout for portfolio price fetches.
  static const Duration portfolioTimeout = Duration(seconds: 60);

  /// Polling interval for refreshing prices.
  static const Duration pollingInterval = Duration(seconds: 60);

  Timer? _pollingTimer;
  Set<String> _pollingSymbols = {};

  /// Creates a [MarketDataRepository] wrapping the given [service].
  MarketDataRepository({required IMarketDataService service})
      : _service = service;

  /// Stream of real-time price updates forwarded from the underlying service.
  Stream<PriceUpdate> get priceStream => _service.priceStream;

  /// Stream of connection status forwarded from the underlying service.
  Stream<ConnectionStatus> get connectionStatus => _service.connectionStatus;

  /// Returns all currently cached prices.
  Map<String, AssetPrice> getCachedPrices() =>
      Map.unmodifiable(_cache.map((key, entry) => MapEntry(key, entry.price)));

  /// Returns the cached [AssetPrice] for [symbol], or `null` if not cached.
  ///
  /// This is a convenience accessor for downstream modules (e.g., valuation)
  /// that need a single symbol's cached price.
  AssetPrice? getCachedPrice(String symbol) => _cache[symbol]?.price;

  /// Returns all currently cached [AssetPrice] entries as an unmodifiable map
  /// keyed by symbol.
  Map<String, AssetPrice> getAllCachedPrices() =>
      Map.unmodifiable(_cache.map((key, entry) => MapEntry(key, entry.price)));

  /// Updates the cache with a [PriceUpdate] event.
  ///
  /// Converts the [PriceUpdate] fields into an [AssetPrice] and stores it in
  /// the cache, timestamped as fetched now.
  void updateCacheFromPriceUpdate(PriceUpdate update) {
    final assetPrice = AssetPrice(
      symbol: update.symbol,
      price: update.price,
      dailyHigh: update.dailyHigh,
      dailyLow: update.dailyLow,
      volume: update.volume,
      percentageChange: update.percentageChange,
      timestamp: update.timestamp,
    );
    _cache[update.symbol] = CacheEntry(
      price: assetPrice,
      fetchedAt: DateTime.now(),
    );
  }

  /// Returns `true` if the cached price for [symbol] is older than 60 seconds,
  /// or if no cached price exists.
  bool isStale(String symbol) {
    final entry = _cache[symbol];
    if (entry == null) return true;
    return DateTime.now().difference(entry.fetchedAt) > staleDuration;
  }

  /// Expires the cache entry for [symbol] by backdating its fetchedAt time.
  ///
  /// This is intended for testing purposes only, to simulate staleness without
  /// waiting for the full stale duration.
  @visibleForTesting
  void expireCacheEntry(String symbol) {
    final entry = _cache[symbol];
    if (entry != null) {
      _cache[symbol] = CacheEntry(
        price: entry.price,
        fetchedAt: DateTime.now().subtract(staleDuration + const Duration(seconds: 1)),
      );
    }
  }

  /// Fetches the current price for [symbol].
  ///
  /// Returns cached price if available and fresh (< 60s since fetch). Otherwise
  /// fetches from the service with a 60-second timeout. If the fetch fails
  /// but a cached price exists, returns the cached price as fallback.
  /// If no cached price exists, propagates the error.
  Future<AssetPrice> getPrice(String symbol) async {
    final entry = _cache[symbol];

    // Return fresh cached price without network call.
    if (entry != null && !isStale(symbol)) {
      return entry.price;
    }

    try {
      final price =
          await _service.getPrice(symbol).timeout(portfolioTimeout);
      _cache[symbol] = CacheEntry(price: price, fetchedAt: DateTime.now());
      return price;
    } on TimeoutException {
      if (entry != null) return entry.price;
      rethrow;
    } catch (_) {
      if (entry != null) return entry.price;
      rethrow;
    }
  }

  /// Fetches the current price for [symbol] specifically for valuation use.
  ///
  /// Always performs a network fetch with a 60-second timeout, caches the
  /// result on success. On failure: returns cached price if available,
  /// otherwise propagates the error to the caller.
  Future<AssetPrice> fetchAndCachePrice(String symbol) async {
    try {
      final price =
          await _service.getPrice(symbol).timeout(portfolioTimeout);
      _cache[symbol] = CacheEntry(price: price, fetchedAt: DateTime.now());
      return price;
    } on TimeoutException {
      final entry = _cache[symbol];
      if (entry != null) return entry.price;
      rethrow;
    } catch (_) {
      final entry = _cache[symbol];
      if (entry != null) return entry.price;
      rethrow;
    }
  }

  /// Searches assets by [query], delegating directly to the service.
  Future<List<AssetSearchResult>> searchAssets(String query) {
    return _service.searchAssets(query);
  }

  /// Subscribe to real-time updates for a set of [symbols].
  ///
  /// Delegates directly to the underlying service.
  void subscribe(Set<String> symbols) {
    _service.subscribe(symbols);
  }

  /// Unsubscribe from real-time updates for a set of [symbols].
  ///
  /// Delegates directly to the underlying service.
  void unsubscribe(Set<String> symbols) {
    _service.unsubscribe(symbols);
  }

  /// Fetches OHLC chart data with a 3-second timeout.
  ///
  /// Returns an empty list on timeout.
  Future<List<OhlcCandle>> getOhlcData({
    required String symbol,
    required TimeDuration duration,
    DateTime? startDate,
    DateTime? endDate,
  }) async {
    try {
      return await _service
          .getOhlcData(
            symbol: symbol,
            duration: duration,
            startDate: startDate,
            endDate: endDate,
          )
          .timeout(chartTimeout);
    } on TimeoutException {
      return [];
    }
  }

  /// Starts polling prices for the given [symbols] every 60 seconds.
  ///
  /// If already polling, replaces the set of symbols being polled.
  void startPolling(Set<String> symbols) {
    _pollingSymbols = Set.from(symbols);
    _pollingTimer?.cancel();
    _pollingTimer = Timer.periodic(pollingInterval, (_) => _pollPrices());
  }

  /// Stops the polling timer.
  void stopPolling() {
    _pollingTimer?.cancel();
    _pollingTimer = null;
    _pollingSymbols = {};
  }

  /// Refreshes prices for all polled symbols, updating the cache.
  Future<void> _pollPrices() async {
    for (final symbol in _pollingSymbols) {
      try {
        final price =
            await _service.getPrice(symbol).timeout(portfolioTimeout);
        _cache[symbol] = CacheEntry(price: price, fetchedAt: DateTime.now());
      } catch (_) {
        // Keep existing cached price on failure.
      }
    }
  }

  /// Resets the reconnection state in the underlying service and triggers a
  /// fresh reconnection attempt.
  ///
  /// Called when the user manually requests a retry after all automatic
  /// reconnection attempts have been exhausted.
  void resetReconnection() {
    _service.resetReconnection();
  }

  /// Disposes resources. Stops polling.
  void dispose() {
    stopPolling();
  }
}
