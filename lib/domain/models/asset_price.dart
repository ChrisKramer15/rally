import 'package:equatable/equatable.dart';

/// Current price data for an asset.
class AssetPrice extends Equatable {
  final String symbol;
  final double price;
  final double dailyHigh;
  final double dailyLow;
  final double volume;
  final double percentageChange;
  final DateTime timestamp;

  const AssetPrice({
    required this.symbol,
    required this.price,
    required this.dailyHigh,
    required this.dailyLow,
    required this.volume,
    required this.percentageChange,
    required this.timestamp,
  });

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
