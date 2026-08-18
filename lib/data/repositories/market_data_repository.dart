import 'dart:async';

import '../../domain/models/asset_price.dart';
import '../../domain/models/asset_search_result.dart';
import '../../domain/models/enums.dart';
import '../../domain/models/ohlc_candle.dart';
import '../../domain/models/price_update.dart';
import '../../domain/services/i_market_data_service.dart';

/// Repository wrapping [IMarketDataService] with caching, polling, and
/// timeout handling.
///
/// Caches last-known prices per symbol for stale data fallback. Polls at
/// 60-second intervals during market hours. Applies timeouts: 3 seconds for
/// chart data, 60 seconds for portfolio price fetches.
class MarketDataRepository {
  final IMarketDataService _service;

  /// Cache of last-known prices keyed by symbol.
  final Map<String, AssetPrice> _priceCache = {};

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
  Map<String, AssetPrice> getCachedPrices() => Map.unmodifiable(_priceCache);

  /// Returns `true` if the cached price for [symbol] is older than 60 seconds,
  /// or if no cached price exists.
  bool isStale(String symbol) {
    final cached = _priceCache[symbol];
    if (cached == null) return true;
    return DateTime.now().difference(cached.timestamp) > staleDuration;
  }

  /// Fetches the current price for [symbol].
  ///
  /// Returns cached price if available and fresh (< 60s old). Otherwise
  /// fetches from the service with a 60-second timeout. If the fetch fails
  /// but a cached price exists, returns the cached price.
  Future<AssetPrice> getPrice(String symbol) async {
    final cached = _priceCache[symbol];

    // Return fresh cached price.
    if (cached != null && !isStale(symbol)) {
      return cached;
    }

    try {
      final price = await _service
          .getPrice(symbol)
          .timeout(portfolioTimeout);
      _priceCache[symbol] = price;
      return price;
    } on TimeoutException {
      if (cached != null) return cached;
      rethrow;
    } catch (_) {
      if (cached != null) return cached;
      rethrow;
    }
  }

  /// Searches assets by [query], delegating directly to the service.
  Future<List<AssetSearchResult>> searchAssets(String query) {
    return _service.searchAssets(query);
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
        final price = await _service
            .getPrice(symbol)
            .timeout(portfolioTimeout);
        _priceCache[symbol] = price;
      } catch (_) {
        // Keep existing cached price on failure.
      }
    }
  }

  /// Disposes resources. Stops polling.
  void dispose() {
    stopPolling();
  }
}
