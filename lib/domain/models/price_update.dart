import 'package:equatable/equatable.dart';

import 'market_data_exception.dart';

/// Real-time price update from WebSocket.
class PriceUpdate extends Equatable {
  final String symbol;
  final double price;
  final double dailyHigh;
  final double dailyLow;
  final double volume;
  final double percentageChange;
  final DateTime timestamp;

  const PriceUpdate({
    required this.symbol,
    required this.price,
    required this.dailyHigh,
    required this.dailyLow,
    required this.volume,
    required this.percentageChange,
    required this.timestamp,
  });

  /// Creates a [PriceUpdate] from a JSON map.
  ///
  /// Throws [MarketDataException] if required fields are missing or have
  /// incorrect types.
  factory PriceUpdate.fromJson(Map<String, dynamic> json) {
    if (!json.containsKey('symbol') ||
        !json.containsKey('price') ||
        !json.containsKey('dailyHigh') ||
        !json.containsKey('dailyLow') ||
        !json.containsKey('volume') ||
        !json.containsKey('percentageChange') ||
        !json.containsKey('timestamp')) {
      final missing = <String>[];
      for (final key in [
        'symbol',
        'price',
        'dailyHigh',
        'dailyLow',
        'volume',
        'percentageChange',
        'timestamp',
      ]) {
        if (!json.containsKey(key)) missing.add(key);
      }
      throw MarketDataException(
        'Missing required fields: ${missing.join(', ')}',
      );
    }

    final symbol = json['symbol'];
    final price = json['price'];
    final dailyHigh = json['dailyHigh'];
    final dailyLow = json['dailyLow'];
    final volume = json['volume'];
    final percentageChange = json['percentageChange'];
    final timestamp = json['timestamp'];

    if (symbol is! String) {
      throw MarketDataException(
        'Invalid type for field "symbol": expected String, got ${symbol.runtimeType}',
      );
    }
    if (price is! num) {
      throw MarketDataException(
        'Invalid type for field "price": expected num, got ${price.runtimeType}',
      );
    }
    if (dailyHigh is! num) {
      throw MarketDataException(
        'Invalid type for field "dailyHigh": expected num, got ${dailyHigh.runtimeType}',
      );
    }
    if (dailyLow is! num) {
      throw MarketDataException(
        'Invalid type for field "dailyLow": expected num, got ${dailyLow.runtimeType}',
      );
    }
    if (volume is! num) {
      throw MarketDataException(
        'Invalid type for field "volume": expected num, got ${volume.runtimeType}',
      );
    }
    if (percentageChange is! num) {
      throw MarketDataException(
        'Invalid type for field "percentageChange": expected num, got ${percentageChange.runtimeType}',
      );
    }
    if (timestamp is! String) {
      throw MarketDataException(
        'Invalid type for field "timestamp": expected String, got ${timestamp.runtimeType}',
      );
    }

    final parsedTimestamp = DateTime.tryParse(timestamp);
    if (parsedTimestamp == null) {
      throw MarketDataException(
        'Invalid ISO 8601 timestamp: $timestamp',
      );
    }

    return PriceUpdate(
      symbol: symbol,
      price: price.toDouble(),
      dailyHigh: dailyHigh.toDouble(),
      dailyLow: dailyLow.toDouble(),
      volume: volume.toDouble(),
      percentageChange: percentageChange.toDouble(),
      timestamp: parsedTimestamp.toUtc(),
    );
  }

  /// Serializes this [PriceUpdate] to a JSON map.
  Map<String, dynamic> toJson() {
    return {
      'symbol': symbol,
      'price': price,
      'dailyHigh': dailyHigh,
      'dailyLow': dailyLow,
      'volume': volume,
      'percentageChange': percentageChange,
      'timestamp': timestamp.toUtc().toIso8601String(),
    };
  }

  @override
  List<Object?> get props => [
        symbol,
        price,
        dailyHigh,
        dailyLow,
        volume,
        percentageChange,
        timestamp,
      ];
}
