import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

import '../../domain/models/asset_price.dart';
import '../../domain/models/asset_search_result.dart';
import '../../domain/models/enums.dart';
import '../../domain/models/ohlc_candle.dart';
import '../../domain/models/price_update.dart';
import '../../domain/services/i_market_data_service.dart';

/// Factory function type for creating WebSocket channels.
/// Allows injecting mock WebSocket channels for testing.
typedef WebSocketChannelFactory = WebSocketChannel Function(Uri uri);

/// Concrete implementation of [IMarketDataService] using REST for data fetching
/// and WebSocket for real-time price streaming.
class MarketDataService implements IMarketDataService {
  final String _baseUrl;
  final String _webSocketUrl;
  final http.Client _httpClient;
  final WebSocketChannelFactory _channelFactory;

  final StreamController<PriceUpdate> _priceStreamController =
      StreamController<PriceUpdate>.broadcast();
  final StreamController<ConnectionStatus> _connectionStatusController =
      StreamController<ConnectionStatus>.broadcast();

  WebSocketChannel? _channel;
  StreamSubscription? _channelSubscription;
  final Set<String> _subscribedSymbols = {};

  bool _isDisposed = false;
  bool _isReconnecting = false;
  int _reconnectAttempts = 0;
  Timer? _reconnectTimer;

  static const int _initialReconnectDelayMs = 1000;
  static const int _maxReconnectDelayMs = 30000;

  MarketDataService({
    required String baseUrl,
    required String webSocketUrl,
    required http.Client httpClient,
    WebSocketChannelFactory? channelFactory,
  })  : _baseUrl = baseUrl,
        _webSocketUrl = webSocketUrl,
        _httpClient = httpClient,
        _channelFactory = channelFactory ?? _defaultChannelFactory;

  static WebSocketChannel _defaultChannelFactory(Uri uri) {
    return WebSocketChannel.connect(uri);
  }

  @override
  Stream<PriceUpdate> get priceStream => _priceStreamController.stream;

  @override
  Stream<ConnectionStatus> get connectionStatus =>
      _connectionStatusController.stream;

  // --- REST Methods ---

  @override
  Future<AssetPrice> getPrice(String symbol) async {
    final uri = Uri.parse('$_baseUrl/api/v1/price/$symbol');
    final response = await _httpClient.get(uri);

    if (response.statusCode != 200) {
      throw MarketDataException(
        'Failed to get price for $symbol: HTTP ${response.statusCode}',
      );
    }

    try {
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      return _parseAssetPrice(json);
    } on FormatException catch (e) {
      throw MarketDataException('Failed to parse price response: $e');
    }
  }

  @override
  Future<List<AssetSearchResult>> searchAssets(String query) async {
    final uri = Uri.parse('$_baseUrl/api/v1/search').replace(
      queryParameters: {'q': query},
    );
    final response = await _httpClient.get(uri);

    if (response.statusCode != 200) {
      throw MarketDataException(
        'Failed to search assets: HTTP ${response.statusCode}',
      );
    }

    try {
      final json = jsonDecode(response.body) as List<dynamic>;
      return json
          .map((item) => _parseAssetSearchResult(item as Map<String, dynamic>))
          .toList();
    } on FormatException catch (e) {
      throw MarketDataException('Failed to parse search response: $e');
    }
  }

  @override
  Future<List<OhlcCandle>> getOhlcData({
    required String symbol,
    required TimeDuration duration,
    DateTime? startDate,
    DateTime? endDate,
  }) async {
    final queryParams = <String, String>{
      'duration': duration.name,
    };
    if (startDate != null) {
      queryParams['start'] = startDate.toIso8601String();
    }
    if (endDate != null) {
      queryParams['end'] = endDate.toIso8601String();
    }

    final uri = Uri.parse('$_baseUrl/api/v1/ohlc/$symbol').replace(
      queryParameters: queryParams,
    );
    final response = await _httpClient.get(uri);

    if (response.statusCode != 200) {
      throw MarketDataException(
        'Failed to get OHLC data for $symbol: HTTP ${response.statusCode}',
      );
    }

    try {
      final json = jsonDecode(response.body) as List<dynamic>;
      return json
          .map((item) => _parseOhlcCandle(item as Map<String, dynamic>))
          .toList();
    } on FormatException catch (e) {
      throw MarketDataException('Failed to parse OHLC response: $e');
    }
  }

  // --- WebSocket Methods ---

  @override
  void subscribe(Set<String> symbols) {
    if (symbols.isEmpty) return;

    _subscribedSymbols.addAll(symbols);

    if (_channel == null) {
      _connect();
    } else {
      _sendSubscribeMessage(symbols);
    }
  }

  @override
  void unsubscribe(Set<String> symbols) {
    if (symbols.isEmpty) return;

    _subscribedSymbols.removeAll(symbols);
    _sendUnsubscribeMessage(symbols);

    // If no symbols remaining, disconnect
    if (_subscribedSymbols.isEmpty) {
      _disconnect();
    }
  }

  /// Establishes the WebSocket connection and sets up listeners.
  void _connect() {
    if (_isDisposed) return;

    try {
      final uri = Uri.parse(_webSocketUrl);
      _channel = _channelFactory(uri);

      _channelSubscription = _channel!.stream.listen(
        _onMessage,
        onError: _onError,
        onDone: _onDone,
      );

      _connectionStatusController.add(ConnectionStatus.connected);
      _reconnectAttempts = 0;
      _isReconnecting = false;

      // Re-subscribe to all symbols after connection
      if (_subscribedSymbols.isNotEmpty) {
        _sendSubscribeMessage(_subscribedSymbols);
      }
    } catch (e) {
      _connectionStatusController.add(ConnectionStatus.disconnected);
      _scheduleReconnect();
    }
  }

  void _disconnect() {
    _channelSubscription?.cancel();
    _channelSubscription = null;
    _channel?.sink.close();
    _channel = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
  }

  void _onMessage(dynamic message) {
    try {
      final json = jsonDecode(message as String) as Map<String, dynamic>;
      final priceUpdate = _parsePriceUpdate(json);
      _priceStreamController.add(priceUpdate);
    } on FormatException {
      // Silently ignore malformed messages
    } catch (_) {
      // Silently ignore other parsing errors
    }
  }

  void _onError(Object error) {
    _connectionStatusController.add(ConnectionStatus.disconnected);
    _cleanupChannel();
    _scheduleReconnect();
  }

  void _onDone() {
    if (_isDisposed) return;
    _connectionStatusController.add(ConnectionStatus.disconnected);
    _cleanupChannel();
    if (_subscribedSymbols.isNotEmpty) {
      _scheduleReconnect();
    }
  }

  void _cleanupChannel() {
    _channelSubscription?.cancel();
    _channelSubscription = null;
    _channel = null;
  }

  /// Schedules a reconnection attempt with exponential backoff.
  void _scheduleReconnect() {
    if (_isDisposed || _isReconnecting) return;

    _isReconnecting = true;
    _connectionStatusController.add(ConnectionStatus.reconnecting);

    final delayMs = _calculateReconnectDelay();
    _reconnectTimer = Timer(Duration(milliseconds: delayMs), () {
      _reconnectAttempts++;
      _isReconnecting = false;
      _connect();
    });
  }

  /// Calculates the reconnect delay using exponential backoff.
  /// Initial delay: 1s, max delay: 30s, multiply by 2 each attempt.
  int _calculateReconnectDelay() {
    final delay = _initialReconnectDelayMs * (1 << _reconnectAttempts);
    return delay.clamp(0, _maxReconnectDelayMs);
  }

  void _sendSubscribeMessage(Set<String> symbols) {
    final message = jsonEncode({
      'action': 'subscribe',
      'symbols': symbols.toList(),
    });
    _channel?.sink.add(message);
  }

  void _sendUnsubscribeMessage(Set<String> symbols) {
    final message = jsonEncode({
      'action': 'unsubscribe',
      'symbols': symbols.toList(),
    });
    _channel?.sink.add(message);
  }

  // --- JSON Parsing Helpers ---

  AssetPrice _parseAssetPrice(Map<String, dynamic> json) {
    return AssetPrice(
      symbol: json['symbol'] as String,
      price: (json['price'] as num).toDouble(),
      dailyHigh: (json['dailyHigh'] as num).toDouble(),
      dailyLow: (json['dailyLow'] as num).toDouble(),
      volume: (json['volume'] as num).toDouble(),
      percentageChange: (json['percentageChange'] as num).toDouble(),
      timestamp: DateTime.parse(json['timestamp'] as String),
    );
  }

  AssetSearchResult _parseAssetSearchResult(Map<String, dynamic> json) {
    return AssetSearchResult(
      symbol: json['symbol'] as String,
      name: json['name'] as String,
      currentPrice: (json['currentPrice'] as num).toDouble(),
      percentageChange: (json['percentageChange'] as num).toDouble(),
      type: AssetType.values.byName(json['type'] as String),
    );
  }

  OhlcCandle _parseOhlcCandle(Map<String, dynamic> json) {
    return OhlcCandle(
      timestamp: DateTime.parse(json['timestamp'] as String),
      open: (json['open'] as num).toDouble(),
      high: (json['high'] as num).toDouble(),
      low: (json['low'] as num).toDouble(),
      close: (json['close'] as num).toDouble(),
      volume: (json['volume'] as num).toDouble(),
    );
  }

  PriceUpdate _parsePriceUpdate(Map<String, dynamic> json) {
    return PriceUpdate(
      symbol: json['symbol'] as String,
      price: (json['price'] as num).toDouble(),
      dailyHigh: (json['dailyHigh'] as num).toDouble(),
      dailyLow: (json['dailyLow'] as num).toDouble(),
      volume: (json['volume'] as num).toDouble(),
      percentageChange: (json['percentageChange'] as num).toDouble(),
      timestamp: DateTime.parse(json['timestamp'] as String),
    );
  }

  /// Disposes all resources. After calling this, the service should not be used.
  void dispose() {
    _isDisposed = true;
    _reconnectTimer?.cancel();
    _disconnect();
    _priceStreamController.close();
    _connectionStatusController.close();
  }
}

/// Exception thrown by [MarketDataService] for API and parsing errors.
class MarketDataException implements Exception {
  final String message;

  const MarketDataException(this.message);

  @override
  String toString() => 'MarketDataException: $message';
}
