import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

import '../../domain/models/asset_price.dart';
import '../../domain/models/asset_search_result.dart';
import '../../domain/models/enums.dart';
import '../../domain/models/market_data_exception.dart';
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
  static const int maxReconnectAttempts = 10;

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
      return AssetPrice.fromJson(json);
    } on MarketDataException {
      rethrow;
    } on FormatException catch (e) {
      throw MarketDataException('Failed to parse price response: $e');
    } catch (e) {
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
          .map((item) =>
              AssetSearchResult.fromJson(item as Map<String, dynamic>))
          .toList();
    } on MarketDataException {
      rethrow;
    } on FormatException catch (e) {
      throw MarketDataException('Failed to parse search response: $e');
    } catch (e) {
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
      final priceUpdate = PriceUpdate.fromJson(json);
      _priceStreamController.add(priceUpdate);
    } on FormatException {
      // Silently discard malformed JSON messages
    } on MarketDataException {
      // Silently discard messages with missing/invalid fields
    } catch (_) {
      // Silently discard any other unparseable messages
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
  ///
  /// After [maxReconnectAttempts] failed attempts, emits a final
  /// [ConnectionStatus.disconnected] and stops retrying.
  void _scheduleReconnect() {
    if (_isDisposed || _isReconnecting) return;

    // If we've exhausted all attempts, emit final disconnected and stop.
    if (_reconnectAttempts >= maxReconnectAttempts) {
      _connectionStatusController.add(ConnectionStatus.disconnected);
      return;
    }

    _isReconnecting = true;
    _connectionStatusController.add(ConnectionStatus.reconnecting);

    final delay = calculateReconnectDelay(_reconnectAttempts);
    _reconnectTimer = Timer(delay, () {
      _reconnectAttempts++;
      _isReconnecting = false;
      _connect();
    });
  }

  /// Calculates the reconnect delay for a given [attempt] number using
  /// exponential backoff.
  ///
  /// Formula: min(1000 × 2^attempt, 30000) milliseconds.
  /// Valid for attempt values 0 ≤ N < 10.
  static Duration calculateReconnectDelay(int attempt) {
    final delayMs = _initialReconnectDelayMs * (1 << attempt);
    return Duration(
      milliseconds: delayMs.clamp(0, _maxReconnectDelayMs),
    );
  }

  /// Resets the reconnection state and triggers a fresh reconnection attempt.
  ///
  /// Called when the user manually requests a retry after all automatic
  /// reconnection attempts have been exhausted.
  void resetReconnection() {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _reconnectAttempts = 0;
    _isReconnecting = false;
    if (_subscribedSymbols.isNotEmpty) {
      _scheduleReconnect();
    }
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

  /// Disposes all resources. After calling this, the service should not be used.
  void dispose() {
    _isDisposed = true;
    _reconnectTimer?.cancel();
    _disconnect();
    _priceStreamController.close();
    _connectionStatusController.close();
  }
}
