import 'package:equatable/equatable.dart';

import 'enums.dart';
import 'market_data_exception.dart';

/// Asset search result returned from the market data service.
class AssetSearchResult extends Equatable {
  final String symbol;
  final String name;
  final double currentPrice;
  final double percentageChange;
  final AssetType type;

  const AssetSearchResult({
    required this.symbol,
    required this.name,
    required this.currentPrice,
    required this.percentageChange,
    required this.type,
  });

  /// Creates an [AssetSearchResult] from a JSON map.
  ///
  /// Throws [MarketDataException] if required fields are missing or have
  /// incorrect types.
  factory AssetSearchResult.fromJson(Map<String, dynamic> json) {
    if (!json.containsKey('symbol') ||
        !json.containsKey('name') ||
        !json.containsKey('currentPrice') ||
        !json.containsKey('percentageChange') ||
        !json.containsKey('type')) {
      final missing = <String>[];
      for (final key in [
        'symbol',
        'name',
        'currentPrice',
        'percentageChange',
        'type',
      ]) {
        if (!json.containsKey(key)) missing.add(key);
      }
      throw MarketDataException(
        'Missing required fields: ${missing.join(', ')}',
      );
    }

    final symbol = json['symbol'];
    final name = json['name'];
    final currentPrice = json['currentPrice'];
    final percentageChange = json['percentageChange'];
    final type = json['type'];

    if (symbol is! String) {
      throw MarketDataException(
        'Invalid type for field "symbol": expected String, got ${symbol.runtimeType}',
      );
    }
    if (name is! String) {
      throw MarketDataException(
        'Invalid type for field "name": expected String, got ${name.runtimeType}',
      );
    }
    if (currentPrice is! num) {
      throw MarketDataException(
        'Invalid type for field "currentPrice": expected num, got ${currentPrice.runtimeType}',
      );
    }
    if (percentageChange is! num) {
      throw MarketDataException(
        'Invalid type for field "percentageChange": expected num, got ${percentageChange.runtimeType}',
      );
    }
    if (type is! String) {
      throw MarketDataException(
        'Invalid type for field "type": expected String, got ${type.runtimeType}',
      );
    }

    final assetType = AssetType.values.where((e) => e.name == type).firstOrNull;
    if (assetType == null) {
      throw MarketDataException(
        'Invalid AssetType value: "$type". Expected one of: ${AssetType.values.map((e) => e.name).join(', ')}',
      );
    }

    return AssetSearchResult(
      symbol: symbol,
      name: name,
      currentPrice: currentPrice.toDouble(),
      percentageChange: percentageChange.toDouble(),
      type: assetType,
    );
  }

  /// Serializes this [AssetSearchResult] to a JSON map.
  Map<String, dynamic> toJson() {
    return {
      'symbol': symbol,
      'name': name,
      'currentPrice': currentPrice,
      'percentageChange': percentageChange,
      'type': type.name,
    };
  }

  @override
  List<Object?> get props =>
      [symbol, name, currentPrice, percentageChange, type];
}
