import 'package:equatable/equatable.dart';

import 'enums.dart';

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

  @override
  List<Object?> get props => [symbol, name, currentPrice, percentageChange, type];
}
