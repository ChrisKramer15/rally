import '../models/asset_price.dart';
import '../models/asset_search_result.dart';
import '../models/enums.dart';
import '../models/ohlc_candle.dart';
import '../models/price_update.dart';

/// Abstract interface for fetching and streaming real-time market data.
///
/// Provides REST-based access to prices, search, and OHLC data, as well as
/// WebSocket-based real-time price streaming with connection status monitoring.
abstract class IMarketDataService {
  /// Stream of real-time price updates for subscribed assets.
  Stream<PriceUpdate> get priceStream;

  /// Fetch current price for a single asset identified by [symbol].
  Future<AssetPrice> getPrice(String symbol);

  /// Search assets by [query] string.
  ///
  /// Returns matching results with symbol, name, current price, and
  /// percentage change.
  Future<List<AssetSearchResult>> searchAssets(String query);

  /// Fetch OHLC data for charting.
  ///
  /// Returns candlestick data for the given [symbol] and [duration].
  /// Optionally constrained by [startDate] and [endDate].
  Future<List<OhlcCandle>> getOhlcData({
    required String symbol,
    required TimeDuration duration,
    DateTime? startDate,
    DateTime? endDate,
  });

  /// Subscribe to real-time updates for a set of [symbols].
  void subscribe(Set<String> symbols);

  /// Unsubscribe from real-time updates for a set of [symbols].
  void unsubscribe(Set<String> symbols);

  /// Stream indicating the current connection status (connected,
  /// disconnected, reconnecting).
  Stream<ConnectionStatus> get connectionStatus;
}
